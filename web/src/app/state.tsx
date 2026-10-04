// App-wide client state: active course (per device), device pairing, storage health, announcements.
// None of this is learning evidence; it is navigation and connection state only.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "@/lib/api";
import { onStorageChange, storageProblem } from "@/lib/db";
import { getOrCreateDevice, getPairing, setBrain, setPairing, type DeviceIdentity, type PairingState } from "@/lib/device";
import { useWorkspace } from "@/lib/queries";
import { flushOutbox } from "@/lib/requests";
import { applyMotion, applyTextScale, applyTheme, getMotionPref, getTextScale, getThemePref, watchSystemTheme, type MotionPref, type ThemePref } from "@/lib/theme";
import type { BrainPublic, WorkspaceView } from "@/lib/types";

interface AppState {
  workspace: WorkspaceView | undefined;
  workspaceError: Error | null;
  workspaceLoading: boolean;
  courseId: string | undefined;
  setCourseId: (courseId: string) => void;
  device: DeviceIdentity | null;
  pairing: PairingState;
  /** False until the device key and pairing state have been read from this browser. */
  ready: boolean;
  requestPairing: () => Promise<{ challenge: string | null }>;
  approvePairing: () => Promise<void>;
  forgetPairing: () => Promise<void>;
  storageIssue: string | null;
  announce: (message: string) => void;
  announcement: string;
  theme: ThemePref;
  setTheme: (pref: ThemePref) => { persisted: boolean };
  motion: MotionPref;
  setMotion: (pref: MotionPref) => void;
  textScale: number;
  setTextScale: (percent: number) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
}

const Context = createContext<AppState | null>(null);

function readCourse(): string | undefined {
  try {
    return window.localStorage.getItem("ll.course") ?? undefined;
  } catch {
    return undefined;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const workspaceQuery = useWorkspace();
  const [courseId, setCourse] = useState<string | undefined>(readCourse);
  const [device, setDevice] = useState<DeviceIdentity | null>(null);
  const [pairing, setPairingState] = useState<PairingState>({ state: "unpaired" });
  const [storageIssue, setStorageIssue] = useState<string | null>(storageProblem());
  const [announcement, setAnnouncement] = useState("");
  const [theme, setThemeState] = useState<ThemePref>(getThemePref());
  const [motion, setMotionState] = useState<MotionPref>(getMotionPref());
  const [textScale, setTextScaleState] = useState<number>(getTextScale());
  const [searchOpen, setSearchOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const announceTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [identity, state] = [await getOrCreateDevice(), await getPairing()];
      if (alive) {
        setDevice(identity);
        setPairingState(state);
        setReady(true);
      }
    })();
    const offStorage = onStorageChange(() => setStorageIssue(storageProblem()));
    const offTheme = watchSystemTheme(() => setThemeState(getThemePref()));
    return () => {
      alive = false;
      offStorage();
      offTheme();
    };
  }, []);

  const workspace = workspaceQuery.data;
  useEffect(() => {
    if (!workspace) return;
    const usable = workspace.courses.filter((c) => c.binding === "bound");
    if ((!courseId || !usable.some((c) => c.course_id === courseId)) && usable[0]) setCourse(usable[0].course_id);
  }, [workspace, courseId]);

  // A changed trusted binding invalidates this device's pairing scope: requests would be refused as stale.
  useEffect(() => {
    if (workspace && pairing.state === "paired" && pairing.bindingRevision && pairing.bindingRevision !== workspace.binding_revision) {
      const next: PairingState = { ...pairing, bindingRevision: workspace.binding_revision };
      void setPairing(next);
      setPairingState(next);
    }
  }, [workspace, pairing]);

  // Requests kept on this device are handed over by themselves whenever the Brain answers again (each
  // successful workspace refresh is such a moment). Nothing is rebuilt or re-signed; nothing is sent twice.
  const reachableAt = workspace?.generated_at;
  useEffect(() => {
    if (!ready || pairing.state !== "paired" || !reachableAt) return;
    let cancelled = false;
    void flushOutbox()
      .then((result) => {
        if (cancelled || result.sent.length === 0) return;
        void queryClient.invalidateQueries({ queryKey: ["local-requests"] });
        void queryClient.invalidateQueries({ queryKey: ["activity"] });
        setAnnouncement(`${result.sent.length} request${result.sent.length === 1 ? "" : "s"} kept on this device ${result.sent.length === 1 ? "was" : "were"} sent to the Brain.`);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ready, pairing.state, reachableAt, queryClient]);

  const setCourseId = useCallback((id: string) => {
    setCourse(id);
    try {
      window.localStorage.setItem("ll.course", id);
    } catch {
      /* per-session only */
    }
  }, []);

  const announce = useCallback((message: string) => {
    setAnnouncement("");
    window.clearTimeout(announceTimer.current);
    announceTimer.current = window.setTimeout(() => setAnnouncement(message), 50);
  }, []);

  const requestPairing = useCallback(async () => {
    const identity = device ?? (await getOrCreateDevice());
    const label = `${navigator.platform || "Browser"} · ${new Date().toLocaleDateString()}`;
    const response = await apiPost<{ device: { state: string; challenge: string | null; courses: string[] }; brain: BrainPublic; binding_revision: string }>("pairing/request", {
      device_id: identity.deviceId, label, public_key_spki_b64: identity.spkiB64,
    });
    await setBrain(response.brain);
    const next: PairingState = { state: response.device.state === "paired" ? "paired" : "pending", bindingRevision: response.binding_revision, courses: response.device.courses };
    await setPairing(next);
    setPairingState(next);
    return { challenge: response.device.challenge };
  }, [device]);

  const approvePairing = useCallback(async () => {
    const identity = device ?? (await getOrCreateDevice());
    const response = await apiPost<{ device: { state: string; courses: string[] }; brain: BrainPublic }>(`pairing/${identity.keyId}/approve`, { reviewed_fingerprint: identity.fingerprint });
    await setBrain(response.brain);
    const next: PairingState = { state: "paired", bindingRevision: workspace?.binding_revision, courses: response.device.courses };
    await setPairing(next);
    setPairingState(next);
    void queryClient.invalidateQueries({ queryKey: ["settings"] });
  }, [device, workspace, queryClient]);

  const forgetPairing = useCallback(async () => {
    const next: PairingState = { state: "unpaired" };
    await setPairing(next);
    setPairingState(next);
  }, []);

  const value = useMemo<AppState>(() => ({
    workspace, workspaceError: workspaceQuery.error, workspaceLoading: workspaceQuery.isLoading, courseId, setCourseId, device, pairing, ready, requestPairing, approvePairing, forgetPairing,
    storageIssue, announce, announcement, theme,
    setTheme: (pref) => {
      setThemeState(pref);
      return applyTheme(pref);
    },
    motion,
    setMotion: (pref) => {
      setMotionState(pref);
      applyMotion(pref);
    },
    textScale,
    setTextScale: (percent) => {
      setTextScaleState(percent);
      applyTextScale(percent);
    },
    searchOpen, setSearchOpen,
  }), [workspace, workspaceQuery.error, workspaceQuery.isLoading, courseId, setCourseId, device, pairing, ready, requestPairing, approvePairing, forgetPairing, storageIssue, announce, announcement, theme, motion, textScale, searchOpen]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useApp(): AppState {
  const value = useContext(Context);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}

export function courseName(workspace: WorkspaceView | undefined, courseId: string | undefined): string {
  return workspace?.courses.find((c) => c.course_id === courseId)?.display_name ?? (courseId ? courseId.toUpperCase() : "No course");
}
