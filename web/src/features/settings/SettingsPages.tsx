// SC13 Settings (UI02, UI28–UI30) and SC15 Repair preview (UI32). Settings show what is installed,
// configured and verified as separate facts, never display credentials, and never offer a control
// that widens permissions. Every data action is previewed and reports its real scope.
import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/app/state";
import { Button, Callout, cn, ErrorState, formatWhen, LoadingState, PageHeader, Segmented, StatusChip } from "@/components/ui";
import { apiGet, apiPost } from "@/lib/api";
import { clearLocalData, listDrafts, listOutbox } from "@/lib/db";
import { formatFingerprint } from "@/lib/device";
import { useSettings } from "@/lib/queries";
import { TEXT_SCALES, type ThemePref } from "@/lib/theme";
import { driveConfigFromEnv, DRIVE_SCOPES } from "@/lib/transport";

const SECTIONS = [["appearance", "Appearance"], ["access", "Access and devices"], ["ai", "AI and Brain"], ["limits", "Limits"], ["data", "Data and privacy"], ["maintenance", "Maintenance"]] as const;

export function SettingsPage() {
  const { section = "appearance" } = useParams();
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Settings" />
      <div className="grid gap-4 md:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto md:flex-col">
          {SECTIONS.map(([id, label]) => (
            <NavLink key={id} to={`/settings/${id}`} className={({ isActive }) => cn("whitespace-nowrap rounded-[var(--ll-radius)] px-3 py-2 font-medium text-muted", (isActive || (id === "appearance" && section === "appearance")) && "bg-raised text-accent")}>{label}</NavLink>
          ))}
        </nav>
        <div className="min-w-0">
          {section === "appearance" && <Appearance />}
          {section === "access" && <Access />}
          {section === "ai" && <AiAndBrain />}
          {section === "limits" && <Limits />}
          {section === "data" && <DataAndPrivacy />}
          {section === "maintenance" && <Maintenance />}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children, intro }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section className="ll-card mb-4 p-4" aria-label={title}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {intro && <p className="mb-3 text-sm text-muted">{intro}</p>}
      <div className="mt-2 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Appearance() {
  const app = useApp();
  const [persist, setPersist] = useState<boolean | null>(null);
  return (
    <Section title="Appearance" intro="Applies to the app's own surfaces on this device only. Slides, figures and recordings always keep their original colours.">
      <div className="flex flex-col gap-1">
        <span className="font-medium" id="theme-label">Theme</span>
        <Segmented<ThemePref> label="Theme" value={app.theme} onChange={(value) => setPersist(app.setTheme(value).persisted)}
          options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }]} />
        <p className="text-sm text-muted">System follows this device's setting. Changing theme does not reload the slide or the recording and does not touch drafts or requests.</p>
        {persist === false && <Callout tone="caution" title="Kept for this session only">This browser blocked storage, so the choice is not remembered after you close the page.</Callout>}
      </div>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Text size</span>
        <select className="ll-input w-auto self-start" value={app.textScale} onChange={(e) => app.setTextScale(Number(e.target.value))}>
          {TEXT_SCALES.map((s) => <option key={s} value={s}>{s}%</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" className="size-5" checked={app.motion === "reduced"} onChange={(e) => app.setMotion(e.target.checked ? "reduced" : "system")} />
        <span><span className="font-medium">Reduce motion</span><span className="block text-sm text-muted">Removes transitions and spinners' movement. The same information is shown without animation. Your system's reduced-motion setting is always honoured.</span></span>
      </label>
    </Section>
  );
}

function Access() {
  const app = useApp();
  const settings = useSettings();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [local, setLocal] = useState<{ drafts: number; outbox: number } | null>(null);
  const [keepDrafts, setKeepDrafts] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const drive = driveConfigFromEnv();
  useEffect(() => {
    void Promise.all([listDrafts(), listOutbox()]).then(([d, o]) => setLocal({ drafts: d.length, outbox: o.length }));
  }, []);
  const devices = settings.data?.devices ?? [];
  return (
    <>
      <Section title="This device" intro="Pairing lets this device send signed requests. The private key stays in this browser and is never shown.">
        {app.device && <p className="break-all font-mono text-sm" aria-label="This device's key fingerprint">{formatFingerprint(app.device.fingerprint)}</p>}
        <p><StatusChip tone={app.pairing.state === "paired" ? "success" : "caution"}>{app.pairing.state === "paired" ? "Paired with this Brain" : app.pairing.state === "pending" ? "Pairing pending approval" : "Not paired"}</StatusChip></p>
        {app.pairing.state !== "paired" && <Link className="ll-btn self-start" to="/connect">Open Connect</Link>}
      </Section>
      <Section title="Paired devices on this Brain" intro="Approval happens here at the Brain PC after comparing fingerprints. A request arriving through Drive can never enrol or approve a key.">
        {settings.isLoading ? <LoadingState /> : devices.length === 0 ? <p className="text-muted">No device has requested pairing.</p> : (
          <ul className="flex flex-col gap-2">
            {devices.map((d) => (
              <li key={d.key_id} className="rounded border border-line/40 p-2 text-sm" data-testid="device-row">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{d.label}</span><StatusChip tone={d.state === "paired" ? "success" : d.state === "pending" ? "caution" : "unassessed"}>{d.state}</StatusChip>{d.key_id === app.device?.keyId && <span className="text-muted">(this device)</span>}</div>
                <p className="break-all font-mono text-xs text-muted">{formatFingerprint(d.fingerprint)}</p>
                <p className="text-muted">Courses: {d.courses.join(", ")} · requested {formatWhen(d.created_at)}</p>
                <div className="mt-1 flex gap-2">
                  {d.state === "pending" && <Button size="sm" onClick={async () => {
                    if (!window.confirm(`Approve this device?\n\nOnly approve if this fingerprint is the one shown on that device:\n${formatFingerprint(d.fingerprint)}`)) return;
                    await apiPost(`pairing/${d.key_id}/approve`, { reviewed_fingerprint: d.fingerprint });
                    await queryClient.invalidateQueries({ queryKey: ["settings"] });
                  }}>Approve after comparing</Button>}
                  {d.state === "paired" && <Button size="sm" variant="quiet" onClick={async () => {
                    if (!window.confirm("Revoke this device? It can no longer send requests. Work the Brain already accepted may still finish.")) return;
                    await apiPost(`pairing/${d.key_id}/revoke`);
                    if (d.key_id === app.device?.keyId) await app.forgetPairing();
                    await queryClient.invalidateQueries({ queryKey: ["settings"] });
                  }}>Revoke</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Google Drive (other devices)" intro="Needed only to use the app away from this PC. It is separate from the Brain reading its local course folders.">
        <p><StatusChip tone={drive ? "neutral" : "unassessed"}>{drive ? "OAuth client configured — not signed in" : "Not configured"}</StatusChip></p>
        <p className="text-sm text-muted">{drive ? "Sign-in is offered on the device that needs it. " : "No Google OAuth client id is bound to this app origin, so Drive sign-in is unavailable. "}
          When enabled the app asks for <code>{DRIVE_SCOPES.read.split("/").pop()}</code> (read your course archive — broad at Google's level; the app only touches the bound course folders) and <code>{DRIVE_SCOPES.appFiles.split("/").pop()}</code> (write only files this app creates). A refused or partial grant is reported; the app never asks for full Drive write access to work around it.</p>
      </Section>
      <Section title="Sign out of this device" intro="Signing out affects this device only.">
        <ul className="list-disc pl-5 text-sm">
          <li>Drafts on this device: <strong>{local?.drafts ?? "…"}</strong> (they exist nowhere else until submitted).</li>
          <li>Signed requests not sent yet: <strong>{local?.outbox ?? "…"}</strong> — they will be discarded if you remove local data.</li>
          <li>Requests the Brain already accepted keep running; cancel them in Activity if you want. Synchronised history and your course records are not erased.</li>
        </ul>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={keepDrafts} onChange={(e) => setKeepDrafts(e.target.checked)} /> Keep my drafts on this device</label>
        <div><Button onClick={async () => {
          if ((local?.outbox ?? 0) > 0 && !window.confirm(`${local!.outbox} signed request(s) were never sent and will be discarded. Send them from Activity first, or continue?`)) return;
          if (app.device && app.pairing.state === "paired") {
            try {
              await apiPost(`pairing/${app.device.keyId}/revoke`);
            } catch {
              setNotice("The Brain could not be reached to revoke this key; revoke it from the Brain PC later.");
            }
          }
          const result = await clearLocalData({ keepDrafts });
          await app.forgetPairing();
          setNotice(`Signed out of this device. Cleared: ${result.cleared.join(", ") || "nothing"}. Kept: ${result.kept.join(", ") || "nothing"}. No provider or Drive data was erased by this.`);
          window.setTimeout(() => navigate("/connect"), 1500);
        }}>Sign out this device</Button></div>
        {notice && <p role="status" className="text-sm text-muted">{notice}</p>}
      </Section>
    </>
  );
}

function AiAndBrain() {
  const settings = useSettings();
  const queryClient = useQueryClient();
  const [probe, setProbe] = useState<{ status: string; checks: Record<string, string>; findings: string[]; version: string } | null>(null);
  const [help, setHelp] = useState(() => {
    try {
      return window.localStorage.getItem("ll.defaultHelp") ?? "quick";
    } catch {
      return "quick";
    }
  });
  if (settings.isLoading) return <LoadingState />;
  if (settings.isError || !settings.data) return <ErrorState error={settings.error} />;
  const { capabilities: caps } = settings.data;
  return (
    <>
      <Section title="Native tutor connection" intro="Installed, configured and verified are different facts. The tutor is used only through an exact, proven route; nothing else is ever substituted.">
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted">Status</dt><dd><StatusChip tone={caps.native.status === "verified" ? "success" : caps.native.status === "fixture_double" ? "unassessed" : "caution"}>{caps.native.label}</StatusChip></dd>
          <dt className="text-muted">Detail</dt><dd>{caps.native.detail}</dd>
          {caps.native.installed !== undefined && <><dt className="text-muted">Executable reachable</dt><dd>{caps.native.installed ? "yes" : "no"}</dd></>}
          {caps.native.configured !== undefined && <><dt className="text-muted">Binding configured</dt><dd>{caps.native.configured ? "yes" : "no"}</dd></>}
          <dt className="text-muted">Last proof</dt><dd>{caps.native.last_proof_at ? formatWhen(caps.native.last_proof_at) : "none recorded"}</dd>
          {caps.native.disposable_proof && (
            <><dt className="text-muted">Single test request</dt>
              <dd data-testid="disposable-proof">{caps.native.disposable_proof.classification.replace(/_/g, " ").toLowerCase()} · {formatWhen(caps.native.disposable_proof.checked_at)}. {caps.native.disposable_proof.meaning}</dd></>
          )}
        </dl>
        <dl className="grid gap-x-4 gap-y-1 border-t border-line/40 pt-2 text-sm sm:grid-cols-[auto_1fr]" aria-label="Optional tools on this PC">
          {[caps.speech, caps.office_converter].map((tool) => tool && (
            <div key={tool.label} className="contents"><dt className="text-muted">{tool.status === "available" ? "Available" : "Not installed"}</dt><dd><strong>{tool.label}.</strong> {tool.detail}</dd></div>
          ))}
        </dl>
        <div><Button size="sm" onClick={async () => setProbe(await apiPost("probe-native"))}>Inspect (sends nothing)</Button></div>
        {probe && (
          <div className="rounded border border-line/40 p-2 text-sm" data-testid="probe-result">
            <p className="font-medium">Inspection: {probe.status.replace(/_/g, " ").toLowerCase()} · version {probe.version}</p>
            <ul className="mt-1">{Object.entries(probe.checks).map(([k, v]) => <li key={k}>{k.replace(/_/g, " ")}: <strong>{v}</strong></li>)}</ul>
            <ul className="mt-1 list-disc pl-5 text-muted">{probe.findings.map((f) => <li key={f}>{f}</li>)}</ul>
          </div>
        )}
        <Callout tone="neutral" title="What activating it needs">
          A disposable test thread (never a course thread), an explicit non-full-access sandbox and approval policy, and one proof run from the Brain PC's terminal. This screen cannot grant permissions, install or restart anything, or copy credentials.
        </Callout>
      </Section>
      <Section title="Course threads" intro="Each course is answered only in its own bound thread. A missing binding blocks that course; 'latest thread' is never used.">
        <ul className="flex flex-col gap-1 text-sm">
          {settings.data.courses.map((c) => <li key={c.course_id} className="flex flex-wrap items-center gap-2"><span className="font-medium">{c.display_name}</span><StatusChip tone={c.status === "bound" ? "success" : "danger"}>{c.status === "bound" ? "folder bound" : c.problem ?? c.status}</StatusChip><StatusChip tone={c.native_thread_bound ? "success" : "unassessed"}>{c.native_thread_bound ? "native thread bound" : "no native thread bound"}</StatusChip></li>)}
        </ul>
      </Section>
      <Section title="Default help" intro="A preference for new questions on this device. It changes nothing about requests already sent or how answers are assessed.">
        <Segmented label="Default help" value={help} onChange={(v) => {
          setHelp(v);
          try {
            window.localStorage.setItem("ll.defaultHelp", v);
          } catch {
            /* session only */
          }
        }} options={[{ value: "quick", label: "Quick answer" }, { value: "understand", label: "Understand" }, { value: "explain", label: "Explain back" }]} />
      </Section>
      {settings.data.fixture_modes && (
        <Section title="Fixture controls (test double only)" intro="Only in the fixture profile: make the labeled test tutor fail in specific ways to see how the app behaves. This never reaches a real tutor.">
          <label className="flex items-center gap-2 text-sm">Behaviour
            <select className="ll-input w-auto" value={settings.data.fixture_mode ?? "normal"} data-testid="fixture-mode" onChange={async (e) => {
              await apiPost("fixture/native-mode", { mode: e.target.value });
              await queryClient.invalidateQueries({ queryKey: ["settings"] });
            }}>
              {settings.data.fixture_modes.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}
            </select>
          </label>
        </Section>
      )}
    </>
  );
}

function Limits() {
  const settings = useSettings();
  const queryClient = useQueryClient();
  if (settings.isLoading) return <LoadingState />;
  if (settings.isError || !settings.data) return <ErrorState error={settings.error} />;
  const { limits, capabilities: caps } = settings.data;
  const rows: Array<[string, string]> = [
    ["Extra paid inference", `$${limits.additional_paid_inference_budget_usd} — no metered route exists in this app`],
    ["Native turns at once", String(limits.max_native_turns_total)], ["Background preparation jobs at once", String(limits.max_background_processing_jobs)],
    ["Time allowed for one tutor turn", `${limits.interactive_turn_budget_seconds} s, then the outcome is treated as unknown and checked — not re-sent`],
    ["Quick answer length", `about ${limits.quick_answer_default_max_words} words`], ["Diagnostic follow-ups", `${limits.diagnostic_default_followups}, then it is your choice to continue`],
    ["Review session size", String(limits.review_default_max_items)], ["Largest single response", `${(limits.max_input_characters ?? 0).toLocaleString()} characters`],
    ["Inbox rescans", `every ${limits.active_rescan_seconds} s while busy, ${limits.idle_rescan_seconds} s idle — no model is called while idle`],
  ];
  return (
    <>
      <Section title="Operating limits" intro="Reviewed defaults. They are changed in the app's configuration on the Brain PC, never by a request or a course file.">
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">{rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd>{v}</dd></div>)}</dl>
        <p className="text-sm text-muted">{caps.spending.note}</p>
      </Section>
      <Section title="Processing" intro="Pausing keeps receiving and storing what you send; nothing is dispatched until you resume. It does not cancel anything.">
        <p><StatusChip tone={caps.brain.paused ? "caution" : "success"}>{caps.brain.paused ? "Paused" : "Running"}</StatusChip> {caps.brain.paused && caps.brain.pause_reason && <span className="text-sm text-muted">{caps.brain.pause_reason.reason}</span>}</p>
        <div><Button data-testid="pause-toggle" onClick={async () => {
          await apiPost(`supervisor/${caps.brain.paused ? "resume" : "pause"}`);
          await queryClient.invalidateQueries();
        }}>{caps.brain.paused ? "Resume processing" : "Pause processing"}</Button></div>
      </Section>
    </>
  );
}

interface CleanupPreview {
  preview_id: string;
  removable: Array<{ path: string; bytes: number; why: string }>;
  retained: Array<{ path: string; why: string }>;
  blocked: Array<{ path: string; why: string }>;
  out_of_scope: Array<{ what: string; why: string }>;
  removable_bytes: number;
}

function DataAndPrivacy() {
  const app = useApp();
  const settings = useSettings();
  const courseId = app.courseId;
  const [exportPreview, setExportPreview] = useState<{ items: Array<{ kind: string; bytes: number }>; total_bytes: number; excluded: Array<{ what: string; why: string }> } | null>(null);
  const [exported, setExported] = useState<{ path: string; files: number; bytes: number } | null>(null);
  const [cleanup, setCleanup] = useState<CleanupPreview | null>(null);
  const [receipt, setReceipt] = useState<{ status: string; removed?: Array<{ path: string }>; blocked?: unknown[]; reason?: string; note?: string; rebuild?: { queued: boolean; note: string } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const guard = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (!courseId) return <p className="text-muted">Choose a course in the header.</p>;
  const kinds = exportPreview ? Object.entries(exportPreview.items.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.kind]: (acc[i.kind] ?? 0) + 1 }), {})) : [];
  return (
    <>
      {error && <Callout tone="danger" role="alert" title="That did not work">{error}</Callout>}
      <Section title="Export" intro={`A private copy of your own records for ${courseId.toUpperCase()}, written on this PC. It is not uploaded or shared.`}>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => guard(async () => setExportPreview(await apiGet(`export/preview?courses=${courseId}`)))}>Preview export</Button>
          <Button variant="primary" disabled={!exportPreview} onClick={() => guard(async () => setExported(await apiPost("export", { courses: [courseId] })))}>Build export</Button>
        </div>
        {exportPreview && (
          <div className="text-sm" data-testid="export-preview">
            <p className="font-medium">Would include {exportPreview.items.length} file(s), {(exportPreview.total_bytes / 1024).toFixed(1)} KB:</p>
            <ul className="list-disc pl-5">{kinds.map(([kind, count]) => <li key={kind}>{count} × {kind.replace(/_/g, " ")}</li>)}</ul>
            <p className="mt-1 font-medium">Left out:</p>
            <ul className="list-disc pl-5 text-muted">{exportPreview.excluded.map((e) => <li key={e.what}>{e.what} — {e.why}</li>)}</ul>
          </div>
        )}
        {exported && <Callout tone="success" role="status" title="Export written">{exported.files} file(s), {(exported.bytes / 1024).toFixed(1)} KB, with an integrity manifest: <span className="break-all font-mono">{exported.path}</span></Callout>}
      </Section>
      <Section title="What is kept, and for how long">
        <ul className="flex flex-col gap-2 text-sm">
          {(settings.data?.retention ?? []).map((r) => <li key={r.class} className="rounded border border-line/40 p-2"><span className="font-medium">{r.class.replace(/_/g, " ")}</span><span className="block text-muted">{r.default}</span></li>)}
        </ul>
      </Section>
      <Section title="Clean up local app data" intro="Removes only data this app can rebuild. Evidence, originals and unfinished work are never part of it.">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => guard(async () => { setReceipt(null); setCleanup(await apiGet(`cleanup/${courseId}/preview`)); })}>Preview cleanup</Button>
          <Button variant="primary" disabled={!cleanup || cleanup.removable.length === 0} onClick={() => guard(async () => {
            if (!window.confirm(`Remove ${cleanup!.removable.length} rebuildable item(s) (${(cleanup!.removable_bytes / 1024).toFixed(1)} KB)? Evidence and originals are not affected.`)) return;
            setReceipt(await apiPost(`cleanup/${courseId}/apply`, { preview_id: cleanup!.preview_id }));
            setCleanup(null);
          })}>Remove the previewed items</Button>
        </div>
        {cleanup && (
          <div className="text-sm" data-testid="cleanup-preview">
            <p className="font-medium">Can be removed ({cleanup.removable.length}):</p>
            <ul className="list-disc pl-5">{cleanup.removable.map((i) => <li key={i.path}><span className="font-mono">{i.path}</span> — {i.why}</li>)}{cleanup.removable.length === 0 && <li className="text-muted">Nothing rebuildable is stored right now.</li>}</ul>
            <p className="mt-2 font-medium">Protected ({cleanup.blocked.length}):</p>
            <ul className="list-disc pl-5 text-muted">{cleanup.blocked.slice(0, 8).map((i) => <li key={i.path}><span className="font-mono">{i.path.split("/").slice(-2).join("/")}</span> — {i.why}</li>)}</ul>
            <p className="mt-2 font-medium">Kept ({cleanup.retained.length}) — captured text stays until you ask for a reference-aware deletion.</p>
            <p className="mt-2 font-medium">Outside this app's reach:</p>
            <ul className="list-disc pl-5 text-muted">{cleanup.out_of_scope.map((o) => <li key={o.what}>{o.what} — {o.why}</li>)}</ul>
          </div>
        )}
        {receipt && <Callout tone={receipt.status === "done" ? "success" : "caution"} role="status" title={receipt.status === "done" ? "Cleanup receipt" : "Nothing was removed"}>
          {receipt.status === "done" ? `Removed ${receipt.removed?.length ?? 0} item(s); ${receipt.blocked?.length ?? 0} protected item(s) untouched. ${receipt.rebuild?.queued ? receipt.rebuild.note : ""} ${receipt.note ?? ""}` : receipt.reason}
        </Callout>}
        <p className="text-sm text-muted">There is no "delete everything" button: removing a response that an attempt refers to needs the course's own writer and an approved deletion policy. This app does not claim to erase copies held by a provider or on other devices.</p>
      </Section>
    </>
  );
}

interface Issue {
  issue_id: string;
  course_id: string;
  kind: string;
  summary: string;
  repair: string | null;
}

function Maintenance() {
  const issues = useQuery<{ issues: Issue[] }, Error>({ queryKey: ["issues"], queryFn: () => apiGet("maintenance/issues"), retry: false });
  const [acceptance, setAcceptance] = useState<{ overall: string; checks: Array<{ id: string; status: string; detail: string }>; boundary: string } | null>(null);
  if (issues.isLoading) return <LoadingState />;
  if (issues.isError) return <ErrorState error={issues.error} />;
  const list = issues.data?.issues ?? [];
  return (
    <>
      <Section title="Things that need attention" intro="Each item says what kind of problem it is. A repair is always previewed first and changes only what it lists.">
        {list.length === 0 ? <p className="text-muted">Nothing needs attention.</p> : (
          <ul className="flex flex-col gap-2" data-testid="issue-list">
            {list.map((i) => (
              <li key={i.issue_id} className="rounded border border-line/40 p-2 text-sm">
                <div className="flex flex-wrap items-center gap-2"><StatusChip tone="caution">{i.kind.replace(/_/g, " ")}</StatusChip><span className="font-medium">{i.course_id.toUpperCase()}</span></div>
                <p>{i.summary}</p>
                <Link className="ll-btn ll-btn-sm mt-1" to={`/settings/maintenance/${encodeURIComponent(i.issue_id)}`}>{i.repair ? "Preview the repair" : "See details"}</Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Whole-product readiness" intro="A fail-closed report against the original live gates. Local tests and fixtures cannot make it pass.">
        <div><Button onClick={async () => setAcceptance(await apiPost("acceptance/run"))}>Run readiness report</Button></div>
        {acceptance && (
          <div className="text-sm" data-testid="acceptance">
            <p className="font-semibold">Result: {acceptance.overall.replace(/_/g, " ")}</p>
            <ul className="mt-1 flex flex-col gap-1">{acceptance.checks.map((c) => <li key={c.id}><StatusChip tone={c.status === "PASS" ? "success" : c.status === "FAIL" ? "danger" : "unassessed"}>{c.status.replace("_", " ")}</StatusChip> <span className="font-medium">{c.id.replace(/-/g, " ")}</span> — <span className="text-muted">{c.detail}</span></li>)}</ul>
            <p className="mt-2 text-muted">{acceptance.boundary}</p>
          </div>
        )}
      </Section>
    </>
  );
}

interface RepairPreviewData {
  status: string;
  issue?: Issue;
  operation?: string | null;
  inputs?: string[];
  target_owner?: string;
  expected_writes?: string[];
  unchanged?: string[];
  allowed?: boolean;
  blocked_reason?: string;
}

export function RepairPreview() {
  const { operationId = "" } = useParams();
  const queryClient = useQueryClient();
  const preview = useQuery<RepairPreviewData, Error>({ queryKey: ["repair", operationId], queryFn: () => apiGet(`maintenance/preview?issue_id=${encodeURIComponent(operationId)}`), retry: false });
  const [result, setResult] = useState<{ status: string; reason?: string; wrote?: string[]; job_state?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // Once approved, keep showing what was approved next to its receipt even though the issue itself is now gone.
  const [approved, setApproved] = useState<RepairPreviewData | null>(null);
  if (preview.isLoading) return <LoadingState />;
  if (!approved && (preview.isError || !preview.data)) return <ErrorState error={preview.error} />;
  const p = approved ?? preview.data!;
  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/settings/maintenance" className="ll-btn ll-btn-sm mb-3">← Maintenance</Link>
      <PageHeader title="Repair preview" subtitle={p.issue?.summary ?? "This issue no longer exists."} />
      {p.status === "unknown_issue" ? <Callout tone="success" title="Nothing to repair">The problem is no longer present.</Callout> : (
        <div className="ll-card flex flex-col gap-3 p-4" data-testid="repair-preview">
          <p><StatusChip tone="caution">{p.issue!.kind.replace(/_/g, " ")}</StatusChip></p>
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted">Operation</dt><dd>{p.operation ?? "No automatic repair exists for this problem."}</dd>
            {p.target_owner && <><dt className="text-muted">Who owns the target</dt><dd>{p.target_owner}</dd></>}
            {p.inputs && <><dt className="text-muted">Reads</dt><dd>{p.inputs.join("; ")}</dd></>}
            {p.expected_writes && <><dt className="text-muted">Would write</dt><dd>{p.expected_writes.join("; ")}</dd></>}
            {p.unchanged && <><dt className="text-muted">Stays unchanged</dt><dd>{p.unchanged.join("; ")}</dd></>}
          </dl>
          {p.allowed && !result ? (
            <div><Button variant="primary" busy={busy} onClick={async () => {
              setBusy(true);
              try {
                setApproved(p);
                setResult(await apiPost("maintenance/apply", { issue_id: operationId }));
                await queryClient.invalidateQueries();
              } finally {
                setBusy(false);
              }
            }}>Approve this repair only</Button></div>
          ) : !p.allowed ? <Callout tone="caution" title="Not something this app does">{p.blocked_reason}</Callout> : null}
          {result && <Callout tone={result.status === "done" ? "success" : "caution"} role="status" title={result.status === "done" ? "Repair receipt" : "Not completed"}>
            {result.status === "done" ? `Done.${result.wrote ? ` Wrote: ${result.wrote.join(", ")}.` : ""}${result.job_state ? ` Request is now ${result.job_state.toLowerCase().replace(/_/g, " ")}.` : ""} Nothing else was changed.` : result.reason ?? `Still pending${result.job_state ? ` (${result.job_state})` : ""}.`}
          </Callout>}
        </div>
      )}
    </div>
  );
}
