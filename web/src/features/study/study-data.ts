// What the Study home reads besides the workspace view: this device's last places (a per-device convenience, never
// learning evidence), the course names it kept of the last load (for the first frame only), the synchronised position
// of every bound course, the lecture view of the place you left, the unsent tutor draft kept for it, the picture of a
// page with its state, and what the page keeps for the session so a revisit does not start from grey. Hooks and
// storage only; the wording is in ./study-facts.
import { useEffect, useMemo, useState } from "react";
import { useQueries, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { getDraft } from "@/lib/db";
import { useLecture } from "@/lib/queries";
import { cachedThumb, requestThumb, type Thumb } from "@/lib/thumbs";
import type { LectureView, ResumeState, WorkspaceCourse } from "@/lib/types";
import { coursesToRemember, readLastPlace, readRememberedCourses, storedPlaceCourse, type LastPlace, type RememberedCourses } from "./study-facts";

function stored(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null; // blocked or cleared storage: the page renders its first-run state
  }
}

/** The lecture and page last opened in a course on this device (written by the lecture workspace as `ll.last.<course>`). */
export const lastPosition = (courseId: string): LastPlace | null => readLastPlace(stored(`ll.last.${courseId}`));

/**
 * Every place stored on this device, by course, read from the storage keys themselves. Used only on a first load that
 * remembers no course names: the device still knows where it was, before any answer of the Brain.
 */
export function storedLastPlaces(): Record<string, LastPlace | null> {
  const places: Record<string, LastPlace | null> = {};
  try {
    if (typeof window === "undefined") return places;
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      const courseId = key ? storedPlaceCourse(key) : null;
      if (key && courseId) places[courseId] = readLastPlace(window.localStorage.getItem(key));
    }
  } catch {
    // blocked storage: no place is known
  }
  return places;
}

const COURSES_KEY = "ll.study.courses";
/** The course names kept of the last successful load on this device; null on a first visit and when storage is blocked. */
export const rememberedCourses = (): RememberedCourses | null => readRememberedCourses(stored(COURSES_KEY));
/** Keeps the names of a loaded workspace for the next first frame. Written only when something changed. */
export function rememberCourses(workspace: { fixture_label?: string | null; courses: readonly WorkspaceCourse[] }): void {
  try {
    const next = coursesToRemember(workspace);
    if (window.localStorage.getItem(COURSES_KEY) !== next) window.localStorage.setItem(COURSES_KEY, next);
  } catch {
    // blocked or full storage: the next first frame draws its skeleton instead
  }
}

/** A file chosen earlier on this device for a unit with several equal candidates (written by the lecture workspace). */
const rememberedDeck = (courseId: string, lectureId: string): string | null => stored(`ll.deck.${courseId}.${lectureId}`) || null;

// ---- kept for the session ------------------------------------------------------------------------------------------------------
const sessions = new WeakMap<QueryClient, Map<string, unknown>>();
/**
 * The last answer seen under `key` while this page session lasts: returned when `data` is not there (the query cache
 * dropped it after five minutes in a lecture and the view is being read again), so coming back to Study shows what it
 * had instead of grey blocks. Fresh data always wins and replaces what was kept; nothing is written to the device.
 */
export function useKept<T>(key: string | null | undefined, data: T | undefined): T | undefined {
  const client = useQueryClient();
  let store = sessions.get(client);
  if (!store) {
    store = new Map();
    sessions.set(client, store);
  }
  if (key && data !== undefined) store.set(key, data);
  return data ?? (key ? (store.get(key) as T | undefined) : undefined);
}

/** True once `active` has lasted longer than `ms` without a break; false again as soon as it ends. */
export function useLongerThan(active: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!active) {
      setLate(false);
      return;
    }
    const timer = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return active && late;
}

// ---- the picture of a page -----------------------------------------------------------------------------------------------------
/** `loading`: a picture is expected and not there yet. `failed`: it could not be made. `none`: there is no file to draw. */
export type PictureState = "none" | "loading" | "ready" | "failed";

// Rows that come into view together ask for their pictures in the same instant. lib/thumbs draws one page at a time and
// serves the request made LAST first (what is in view wins over what was scrolled past), so asked in row order a list
// would fill from the bottom up. The requests of one instant are therefore made in this order: the top row (it starts
// at once when nothing is being drawn), then the others from the bottom up, then the top row once more (it moves to the
// head of the line when something else was being drawn; a page already drawn is answered from memory, not drawn twice).
const asks: Array<{ order: number; ask: () => void }> = [];
let asking: ReturnType<typeof setTimeout> | null = null;
function askInRowOrder(order: number, ask: () => void): () => void {
  const entry = { order, ask };
  asks.push(entry);
  asking ??= setTimeout(() => {
    asking = null;
    const [top, ...rest] = asks.splice(0).sort((a, b) => a.order - b.order);
    if (!top) return;
    top.ask();
    for (const next of rest.reverse()) next.ask();
    if (rest.length > 0) top.ask();
  }, 0);
  return () => {
    const at = asks.indexOf(entry);
    if (at >= 0) asks.splice(at, 1);
  };
}

/**
 * The picture of one page for a place `cssWidth` wide (lib/thumbs: one queue and one cache for the session), with what
 * the placeholder has to say meanwhile. It is asked for once `wanted` (the row is near the viewport); until it exists
 * the state is `loading`, and `failed` when the file could not be drawn, so a block that waits is told from one that
 * will stay empty. `order` is the row's place in its list: rows asking together are then served from the top down.
 */
export function usePagePicture(url: string | null | undefined, page: number, cssWidth: number, wanted: boolean, order?: number): { thumb: Thumb | null; state: PictureState } {
  const key = url ? `${url}#${page}@${cssWidth}` : null;
  const [made, setMade] = useState<{ key: string; thumb: Thumb | null } | null>(null);
  useEffect(() => {
    if (!url || !key || !wanted) return;
    const hit = cachedThumb(url, page, cssWidth);
    if (hit) {
      setMade({ key, thumb: hit });
      return;
    }
    const abort = new AbortController();
    const ask = () => {
      if (abort.signal.aborted) return;
      requestThumb(url, page, cssWidth, abort.signal).then(
        (thumb) => {
          if (!abort.signal.aborted) setMade({ key, thumb });
        },
        () => {
          if (!abort.signal.aborted) setMade({ key, thumb: null });
        },
      );
    };
    const withdraw = order === undefined ? (ask(), null) : askInRowOrder(order, ask);
    return () => {
      withdraw?.();
      abort.abort();
    };
  }, [url, key, page, cssWidth, wanted, order]);
  if (!url || !key) return { thumb: null, state: "none" };
  const mine = made && made.key === key ? made : null;
  const thumb = mine?.thumb ?? cachedThumb(url, page, cssWidth); // a picture made earlier in the session is there in the first frame
  return { thumb, state: thumb ? "ready" : mine ? "failed" : "loading" };
}

/**
 * The synchronised study position of each bound course, by course id. The same cache entries as `useResume` of
 * lib/queries (key and route are its own), read for a list of courses at once.
 */
export function useCourseResumes(courseIds: readonly string[]): { byCourse: Record<string, ResumeState | undefined>; settled: boolean } {
  return useQueries({
    queries: courseIds.map((courseId) => ({ queryKey: ["resume", courseId], queryFn: ({ signal }: { signal: AbortSignal }) => apiGet<ResumeState>(`courses/${courseId}/resume`, signal), retry: false as const, staleTime: 5_000 })),
    combine: (results) => ({
      byCourse: Object.fromEntries(courseIds.map((courseId, index) => [courseId, results[index]?.data])) as Record<string, ResumeState | undefined>,
      settled: results.every((result) => !result.isLoading),
    }),
  });
}

/**
 * The lecture view of the place you left: its real title, the identity of the page and the file its picture is drawn
 * from. A unit with several equal candidate files is read with the file chosen earlier on this device, as the lecture
 * workspace opens it. The view seen last is kept for the session, so Resume does not fall back to less while it is read again.
 */
export function useResumeLecture(courseId: string, lectureId: string): { lecture: LectureView | undefined; loading: boolean } {
  const first = useLecture(courseId, lectureId);
  const remembered = useMemo(() => {
    const view = first.data;
    if (!view || view.display.kind !== "choose_deck") return null;
    const deck = rememberedDeck(courseId, lectureId);
    return deck && view.deck_choice.candidates.some((candidate) => candidate.source_id === deck) ? deck : null;
  }, [first.data, courseId, lectureId]);
  const chosen = useLecture(remembered ? courseId : undefined, remembered ? lectureId : undefined, remembered);
  const lecture = useKept(`lecture:${courseId}/${lectureId}`, (remembered ? chosen.data : undefined) ?? first.data);
  return { lecture, loading: first.isLoading || (!!remembered && chosen.isLoading) };
}

/** 1 when an unsent tutor draft with text is kept on this device for the lecture, otherwise 0. */
export function useTutorDraftCount(courseId: string, lectureId: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    setCount(0);
    getDraft(`tutor:${courseId}:${lectureId}`).then((draft) => alive && setCount(draft && draft.text.trim() ? 1 : 0)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [courseId, lectureId]);
  return count;
}
