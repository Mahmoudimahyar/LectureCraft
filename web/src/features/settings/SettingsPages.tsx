// SC13 Settings (UI02, UI28–UI30) and SC15 Repair preview (UI32). Settings show what is installed,
// configured and verified as separate facts, never display credentials, and never offer a control
// that widens permissions. Every data action is previewed and reports its real scope.
//
// Amendment R2 adds the section "Build and data": the build identity as text that can be read and copied (R2-B1), and
// per course a readback of speech timing (stage, coverage, the allowance of local transcription, the one resumable
// command) and of the suggested question links (where the file stands, counts, refused entries with their reasons).
// The readbacks state what the Brain measured; nothing here estimates, and no figure is a percentage.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useApp } from "@/app/state";
import { BuildIdentity } from "@/components/BuildIdentity";
import { Button, cn, ErrorState, formatWhen, LoadingState, PageHeader, Section as OpenSection, Sections, SectionToggle, Segmented, StatusChip } from "@/components/ui";
import { apiGet, apiPost } from "@/lib/api";
import { clearLocalData, listDrafts, listOutbox } from "@/lib/db";
import { formatFingerprint } from "@/lib/device";
import { dotJoin } from "@/lib/format";
import {
  ASSOCIATION_STATE_LABEL, INFERRED_FILE_STATE_LABEL, TEXT_ALIGNMENT_STATE_LABEL, TIMING_STAGE_LABEL, countLabel, durationLabel, generatedCoverageSentence, nb, unlistedLabel,
} from "@/lib/labels";
import { useCourseTiming, useInferredAnchors, useSettings } from "@/lib/queries";
import { TEXT_SCALES, type ThemePref } from "@/lib/theme";
import { driveConfigFromEnv, DRIVE_SCOPES } from "@/lib/transport";
import type { CourseTimingSummary, CourseTimingView, InferredAnchorsReadback, TimingAllowance, TimingQueue, TimingStage } from "@/lib/types";
import { Callout, Fact, Facts, Page, Picker, keyWords } from "@/features/search/SearchOverlay";

const SECTIONS = [["appearance", "Appearance"], ["access", "Access and devices"], ["ai", "AI and Brain"], ["limits", "Limits"], ["data", "Data and privacy"], ["maintenance", "Maintenance"], ["build", "Build and data"]] as const;

// ---- readback wording (pure; tested in tests/features/other-pages.test.tsx) ------------------------------------------------
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const STAGE_ORDER: readonly TimingStage[] = ["no_recording", "audio_unprocessed", "partly_processed", "processed", "associated"];

/** Lectures per stage, in the order of preparation. A stage the Brain did not count is left out, never written as 0; one this build has no words for is shown as recorded. */
export function stageRows(summary: Pick<CourseTimingSummary, "stages"> | null | undefined): Array<{ stage: string; label: string; lectures: number }> {
  const stages = (summary?.stages ?? {}) as Record<string, unknown>;
  const known = STAGE_ORDER.filter((stage) => isNumber(stages[stage]));
  const other = Object.keys(stages).filter((stage) => !(STAGE_ORDER as readonly string[]).includes(stage) && isNumber(stages[stage])).sort();
  return [...known, ...other].map((stage) => ({ stage, label: (TIMING_STAGE_LABEL as Record<string, string | undefined>)[stage] ?? unlistedLabel(stage), lectures: stages[stage] as number }));
}

/** What was measured, as sentences of durations with their denominators. A line whose figures were not sent is left out. No percentage. */
export function coverageLines(summary: CourseTimingSummary | null | undefined): string[] {
  if (!summary) return [];
  const { recordings, duration_ms: duration, recordings_with_generated: withText, covered_ms: covered, unresolved_ms: unresolved, recordings_associated: linked, ranges } = summary;
  const lines: string[] = [];
  if (!isNumber(recordings)) return lines;
  lines.push(`${countLabel(recordings, "recording")}${isNumber(duration) && recordings > 0 ? `, ${durationLabel(duration)} in all` : ""}.`);
  if (recordings === 0) return lines;
  if (isNumber(withText)) {
    lines.push(withText === 0 ? "No speech text has been generated yet."
      : `Speech text was generated for ${withText} of ${countLabel(recordings, "recording")}${isNumber(covered) ? ` and covers ${durationLabel(covered)} of them` : ""}.`);
  }
  if (isNumber(unresolved) && unresolved > 0) lines.push(`${durationLabel(unresolved)} could not be resolved: neither speech nor silence is known there.`);
  if (isNumber(linked) && linked > 0) lines.push(`Slides are linked for ${linked} of ${countLabel(recordings, "recording")}${isNumber(ranges) ? `: ${countLabel(ranges, "range")}` : ""}.`);
  return lines;
}

/** The allowance of local transcription: used, ceiling and remaining, as durations. */
export function allowanceLine(allowance: TimingAllowance | null | undefined): string {
  if (!allowance) return "The allowance record is absent or could not be read, so nothing is stated about it.";
  return `${durationLabel(allowance.used_seconds * 1000)} used of ${durationLabel(allowance.ceiling_seconds * 1000)}; ${durationLabel(allowance.remaining_seconds * 1000)} remaining.`;
}

/** The speech runner's row for a recording, as recorded: its state, its chunks when it has any, what it covered. */
export function queueWords(queue: TimingQueue | null | undefined): string | null {
  if (!queue) return null;
  return dotJoin([
    nb(unlistedLabel(String(queue.state))),
    isNumber(queue.chunks_total) && queue.chunks_total > 0 && isNumber(queue.chunks_done) ? nb(`${queue.chunks_done} of ${countLabel(queue.chunks_total, "chunk")}`) : null,
    isNumber(queue.seconds_covered) && queue.seconds_covered > 0 ? nb(`${durationLabel(queue.seconds_covered * 1000)} covered`) : null,
  ]);
}

/** Where a lecture's stored ranges stand against the current inputs, naming what differs. */
export function linksWords(links: CourseTimingView["lectures"][number]["links"] | null | undefined): string | null {
  if (!links) return null;
  const state = unlistedLabel(String(links.state));
  return links.differs?.length ? `${state} (differs: ${links.differs.map(unlistedLabel).join(", ")})` : state;
}

export interface CountRow { key: string; label: string; count: number }
/** The counts of a course's suggestions file. A count the Brain did not send is left out. */
export function anchorCountRows(readback: Pick<InferredAnchorsReadback, "accepted" | "stale" | "rejected_by_verifier" | "refused" | "no_candidate">): CountRow[] {
  const refused = Object.values(readback.refused ?? {}).filter(isNumber).reduce((sum, count) => sum + count, 0);
  const rows: Array<[string, string, unknown]> = [
    ["accepted", "Suggested links in force", readback.accepted],
    ["stale", "Made for an earlier version (not shown as links)", readback.stale],
    ["rejected_by_verifier", "Rejected by the second pass (never shown as links)", readback.rejected_by_verifier],
    ["refused", "Refused entries (not valid; never repaired)", refused],
    ["no_candidate", "Questions inspected, no supporting page found", readback.no_candidate],
  ];
  return rows.filter((row): row is [string, string, number] => isNumber(row[2])).map(([key, label, count]) => ({ key, label, count }));
}

/** Refused entries by reason, most frequent first, the reason in its own words. */
export function refusedRows(refused: Record<string, number> | null | undefined): Array<{ reason: string; count: number }> {
  return Object.entries(refused ?? {}).filter(([, count]) => isNumber(count)).map(([reason, count]) => ({ reason: unlistedLabel(reason), count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

/** The learner's own decisions on suggested links, and those no current link carries. */
export function decisionRows(decisions: InferredAnchorsReadback["decisions"] | null | undefined): CountRow[] {
  if (!decisions) return [];
  const rows: CountRow[] = [];
  if (isNumber(decisions.confirmed)) rows.push({ key: "confirmed", label: "Confirmed by you", count: decisions.confirmed });
  if (isNumber(decisions.rejected)) rows.push({ key: "rejected", label: "Rejected by you", count: decisions.rejected });
  if (isNumber(decisions.cleared) && decisions.cleared > 0) rows.push({ key: "cleared", label: "Taken back by you", count: decisions.cleared });
  const apart: Array<[string, string, unknown[] | undefined]> = [
    ["orphaned", "Decisions on links the file no longer holds", decisions.orphaned],
    ["on_stale", "Decisions on links made for an earlier version", decisions.on_stale],
    ["on_rejected_by_verifier", "Decisions on links the second pass rejected", decisions.on_rejected_by_verifier],
  ];
  for (const [key, label, list] of apart) if (Array.isArray(list) && list.length > 0) rows.push({ key, label, count: list.length });
  return rows;
}

/** The kinds of data the Brain keeps, each named in words. The Brain sends a key; the sentence beside it is the Brain's own. */
const RETENTION_HEADING: Record<string, string> = {
  raw_teachback_audio: "Recordings of your spoken explanations",
  text_evidence: "The text you submit",
  referenced_sidecars: "Full responses an attempt refers to",
  operational_logs: "Activity logs",
  reproducible_cache: "Prepared copies that can be rebuilt",
  original_sources: "Original course files",
};
/** The heading of a retention row. A kind this build has no name for is shown as recorded, as words, never as the nearest known name. */
export const retentionHeading = (kind: string): string => RETENTION_HEADING[kind] ?? keyWords(kind);

// ---- page ---------------------------------------------------------------------------------------------------------------
export function SettingsPage() {
  const { section = "appearance" } = useParams();
  return (
    <Page>
      <PageHeader title="Settings" />
      <div className="grid gap-4 min-[900px]:grid-cols-[15rem_minmax(0,1fr)] min-[900px]:gap-6">
        <nav aria-label="Settings sections" className="grid grid-cols-2 gap-1 self-start min-[600px]:grid-cols-3 min-[900px]:grid-cols-1 min-[900px]:gap-0.5">
          {SECTIONS.map(([id, label]) => (
            <NavLink key={id} to={`/settings/${id}`} className={({ isActive }) => cn(
              "relative flex min-h-11 items-center rounded-control px-4 py-2 text-ui text-ink transition-colors duration-[var(--ll-motion-small)] hover:bg-pad",
              (isActive || (id === "appearance" && section === "appearance")) && "bg-tint font-semibold text-accent-text hover:bg-tint-strong before:absolute before:bottom-2.5 before:left-0 before:top-2.5 before:w-[3px] before:rounded-r-[3px] before:bg-accent-text before:content-['']")}>{label}</NavLink>
          ))}
        </nav>
        <div className="ll-region min-w-0 px-4 min-[900px]:px-6">
          {section === "appearance" && <Appearance />}
          {section === "access" && <Access />}
          {section === "ai" && <AiAndBrain />}
          {section === "limits" && <Limits />}
          {section === "data" && <DataAndPrivacy />}
          {section === "maintenance" && <Maintenance />}
          {section === "build" && <BuildAndData />}
        </div>
      </div>
    </Page>
  );
}

/** One block of a settings section: a heading, one sentence of what it is, its content. Blocks are parted by a hairline, not boxed. */
function Block({ title, children, intro }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <section className="border-t border-hairline py-5 first:border-t-0 min-[900px]:py-6" aria-label={title}>
      <h2 className="text-head font-semibold">{title}</h2>
      {intro && <p className="ll-measure mt-1 text-read text-muted">{intro}</p>}
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

/** A row of a list inside a block: parted from the next by a hairline. */
const ROW = "border-t border-hairline py-3 first:border-t-0 first:pt-0 last:pb-0";
/** An inset block inside a block (a result, a preview): a pad, no stroke. */
const INSET = "max-w-[38rem] rounded-control bg-pad p-3 text-ui";

function Appearance() {
  const app = useApp();
  const [persist, setPersist] = useState<boolean | null>(null);
  return (
    <Block title="Appearance" intro="Applies to the app's own surfaces on this device only. Slides, figures and recordings always keep their original colours.">
      <div className="flex flex-col gap-1.5">
        <span className="text-ui font-semibold" id="theme-label">Theme</span>
        <Segmented<ThemePref> label="Theme" className="self-start" value={app.theme} onChange={(value) => setPersist(app.setTheme(value).persisted)}
          options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }]} />
        <p className="ll-measure text-ui text-muted">System follows this device's setting. Changing theme does not reload the slide or the recording and does not touch drafts or requests.</p>
        {persist === false && <Callout tone="caution" title="Kept for this session only">This browser blocked storage, so the choice is not remembered after you close the page.</Callout>}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-ui font-semibold">Text size</span>
        <Segmented label="Text size" className="self-start" value={String(app.textScale)} onChange={(value) => app.setTextScale(Number(value))}
          options={TEXT_SCALES.map((scale) => ({ value: String(scale), label: `${scale}%` }))} />
        <p className="ll-measure text-ui text-muted">From 150% a lecture and the concept map show one pane at a time, so the text has room.</p>
      </div>
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-0.5 size-5 flex-none accent-accent" checked={app.motion === "reduced"} onChange={(e) => app.setMotion(e.target.checked ? "reduced" : "system")} />
        <span><span className="text-ui font-semibold">Reduce motion</span><span className="ll-measure block text-ui text-muted">Removes transitions and spinners' movement. The same information is shown without animation. Your system's reduced-motion setting is always honoured.</span></span>
      </label>
    </Block>
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
      <Block title="This device" intro="Pairing lets this device send signed requests. The private key stays in this browser and is never shown.">
        {app.device && <p className="break-all font-mono text-ui" aria-label="This device's key fingerprint">{formatFingerprint(app.device.fingerprint)}</p>}
        <p><StatusChip tone={app.pairing.state === "paired" ? "success" : "caution"}>{app.pairing.state === "paired" ? "Paired with this Brain" : app.pairing.state === "pending" ? "Pairing pending approval" : "Not paired"}</StatusChip></p>
        {app.pairing.state !== "paired" && <Link className="ll-btn self-start" to="/connect">Open Connect</Link>}
      </Block>
      <Block title="Paired devices on this Brain" intro="Approval happens here at the Brain PC after comparing fingerprints. A request arriving through Drive can never enrol or approve a key.">
        {settings.isLoading ? <LoadingState /> : devices.length === 0 ? <p className="text-ui text-muted">No device has requested pairing.</p> : (
          <ul className="flex flex-col">
            {devices.map((d) => (
              <li key={d.key_id} className={cn(ROW, "flex flex-col gap-1 text-ui")} data-testid="device-row">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="text-read font-semibold">{d.label}</span><StatusChip tone={d.state === "paired" ? "success" : d.state === "pending" ? "caution" : "unassessed"}>{d.state}</StatusChip>{d.key_id === app.device?.keyId && <span className="text-muted">(this device)</span>}</div>
                <p className="break-all font-mono text-muted">{formatFingerprint(d.fingerprint)}</p>
                <p className="text-muted">Courses: {d.courses.join(", ")} · requested {formatWhen(d.created_at)}</p>
                {(d.state === "pending" || d.state === "paired") && (
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
                )}
              </li>
            ))}
          </ul>
        )}
      </Block>
      <Block title="Google Drive (other devices)" intro="Needed only to use the app away from this PC. It is separate from the Brain reading its local course folders.">
        <p><StatusChip tone={drive ? "neutral" : "unassessed"}>{drive ? "OAuth client configured — not signed in" : "Not configured"}</StatusChip></p>
        <p className="ll-measure text-read text-muted">{drive ? "Sign-in is offered on the device that needs it. " : "No Google OAuth client id is bound to this app origin, so Drive sign-in is unavailable. "}
          When enabled the app asks for <code className="font-mono text-ink">{DRIVE_SCOPES.read.split("/").pop()}</code> (read your course archive — broad at Google's level; the app only touches the bound course folders) and <code className="font-mono text-ink">{DRIVE_SCOPES.appFiles.split("/").pop()}</code> (write only files this app creates). A refused or partial grant is reported; the app never asks for full Drive write access to work around it.</p>
      </Block>
      <Block title="Sign out of this device" intro="Signing out affects this device only.">
        <ul className="ll-measure list-disc pl-5 text-ui">
          <li>Drafts on this device: <strong>{local?.drafts ?? "…"}</strong> (they exist nowhere else until submitted).</li>
          <li>Signed requests not sent yet: <strong>{local?.outbox ?? "…"}</strong> — they will be discarded if you remove local data.</li>
          <li>Requests the Brain already accepted keep running; cancel them in Activity if you want. Synchronised history and your course records are not erased.</li>
        </ul>
        <label className="flex items-center gap-2 text-ui"><input type="checkbox" className="size-5 flex-none accent-accent" checked={keepDrafts} onChange={(e) => setKeepDrafts(e.target.checked)} /> Keep my drafts on this device</label>
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
        {notice && <p role="status" className="ll-measure text-read text-muted">{notice}</p>}
      </Block>
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
      <Block title="Native tutor connection" intro="Installed, configured and verified are different facts. The tutor is used only through an exact, proven route; nothing else is ever substituted.">
        <Facts>
          <Fact term="Status"><StatusChip tone={caps.native.status === "verified" ? "success" : caps.native.status === "fixture_double" ? "unassessed" : "caution"}>{caps.native.label}</StatusChip></Fact>
          <Fact term="Detail">{caps.native.detail}</Fact>
          {caps.native.installed !== undefined && <Fact term="Executable reachable">{caps.native.installed ? "yes" : "no"}</Fact>}
          {caps.native.configured !== undefined && <Fact term="Binding configured">{caps.native.configured ? "yes" : "no"}</Fact>}
          <Fact term="Last proof">{caps.native.last_proof_at ? formatWhen(caps.native.last_proof_at) : "none recorded"}</Fact>
          {caps.native.disposable_proof && (
            <Fact term="Single test request" testId="disposable-proof">{caps.native.disposable_proof.classification.replace(/_/g, " ").toLowerCase()} · {formatWhen(caps.native.disposable_proof.checked_at)}. {caps.native.disposable_proof.meaning}</Fact>
          )}
        </Facts>
        <Facts label="Optional tools on this PC" className="border-t border-hairline pt-3">
          {[caps.speech, caps.office_converter].map((tool) => tool && (
            <Fact key={tool.label} term={tool.status === "available" ? "Available" : "Not installed"}><strong>{tool.label}.</strong> {tool.detail}</Fact>
          ))}
        </Facts>
        <div><Button size="sm" onClick={async () => setProbe(await apiPost("probe-native"))}>Inspect (sends nothing)</Button></div>
        {probe && (
          <div className={INSET} data-testid="probe-result">
            <p className="font-semibold">Inspection: {probe.status.replace(/_/g, " ").toLowerCase()} · version {probe.version}</p>
            <ul className="mt-1">{Object.entries(probe.checks).map(([k, v]) => <li key={k}>{keyWords(k)}: <strong>{v}</strong></li>)}</ul>
            <ul className="mt-1 list-disc pl-5 text-muted">{probe.findings.map((f) => <li key={f}>{f}</li>)}</ul>
          </div>
        )}
        <Callout tone="neutral" title="What activating it needs">
          A disposable test thread (never a course thread), an explicit non-full-access sandbox and approval policy, and one proof run from the Brain PC's terminal. This screen cannot grant permissions, install or restart anything, or copy credentials.
        </Callout>
      </Block>
      <Block title="Course threads" intro="Each course is answered only in its own bound thread. A missing binding blocks that course; 'latest thread' is never used.">
        <ul className="flex flex-col">
          {settings.data.courses.map((c) => (
            <li key={c.course_id} className={cn(ROW, "flex flex-wrap items-center gap-x-4 gap-y-1")}>
              <span className="min-w-0 flex-1 basis-64 font-semibold">{c.display_name}</span>
              <StatusChip tone={c.status === "bound" ? "success" : "danger"}>{c.status === "bound" ? "folder bound" : c.problem ?? c.status}</StatusChip>
              <StatusChip tone={c.native_thread_bound ? "success" : "unassessed"}>{c.native_thread_bound ? "native thread bound" : "no native thread bound"}</StatusChip>
            </li>
          ))}
        </ul>
      </Block>
      <Block title="Default help" intro="A preference for new questions on this device. It changes nothing about requests already sent or how answers are assessed.">
        <Segmented label="Default help" className="self-start" value={help} onChange={(v) => {
          setHelp(v);
          try {
            window.localStorage.setItem("ll.defaultHelp", v);
          } catch {
            /* session only */
          }
        }} options={[{ value: "quick", label: "Quick answer" }, { value: "understand", label: "Understand" }, { value: "explain", label: "Explain back" }]} />
      </Block>
      {settings.data.fixture_modes && (
        <Block title="Fixture controls (test double only)" intro="Only in the fixture profile: make the labeled test tutor fail in specific ways to see how the app behaves. This never reaches a real tutor.">
          <div className="flex flex-wrap items-center gap-3 text-ui">
            <span>Behaviour</span>
            <Picker label="Behaviour" testId="fixture-mode" value={settings.data.fixture_mode ?? "normal"} options={settings.data.fixture_modes.map((mode) => ({ value: mode, label: mode.replace(/_/g, " ") }))}
              onChange={async (mode) => {
                await apiPost("fixture/native-mode", { mode });
                await queryClient.invalidateQueries({ queryKey: ["settings"] });
              }} />
          </div>
        </Block>
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
      <Block title="Operating limits" intro="Reviewed defaults. They are changed in the app's configuration on the Brain PC, never by a request or a course file.">
        <Facts className="ll-num">{rows.map(([k, v]) => <Fact key={k} term={k}>{v}</Fact>)}</Facts>
        <p className="ll-measure text-read text-muted">{caps.spending.note}</p>
      </Block>
      <Block title="Processing" intro="Pausing keeps receiving and storing what you send; nothing is dispatched until you resume. It does not cancel anything.">
        <p><StatusChip tone={caps.brain.paused ? "caution" : "success"}>{caps.brain.paused ? "Paused" : "Running"}</StatusChip> {caps.brain.paused && caps.brain.pause_reason && <span className="text-ui text-muted">{caps.brain.pause_reason.reason}</span>}</p>
        <div><Button data-testid="pause-toggle" onClick={async () => {
          await apiPost(`supervisor/${caps.brain.paused ? "resume" : "pause"}`);
          await queryClient.invalidateQueries();
        }}>{caps.brain.paused ? "Resume processing" : "Pause processing"}</Button></div>
      </Block>
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
  if (!courseId) return <p className="py-5 text-muted">Choose a course in the header.</p>;
  const kinds = exportPreview ? Object.entries(exportPreview.items.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.kind]: (acc[i.kind] ?? 0) + 1 }), {})) : [];
  return (
    <>
      {error && <Callout tone="danger" role="alert" title="That did not work" className="mt-5">{error}</Callout>}
      <Block title="Export" intro={`A private copy of your own records for ${courseId.toUpperCase()}, written on this PC. It is not uploaded or shared.`}>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => guard(async () => setExportPreview(await apiGet(`export/preview?courses=${courseId}`)))}>Preview export</Button>
          <Button variant="primary" disabled={!exportPreview} onClick={() => guard(async () => setExported(await apiPost("export", { courses: [courseId] })))}>Build export</Button>
        </div>
        {!exportPreview && <p className="text-ui text-muted">Preview first: the export is built from what the preview lists.</p>}
        {exportPreview && (
          <div className={INSET} data-testid="export-preview">
            <p className="font-semibold">Would include {exportPreview.items.length} file(s), {(exportPreview.total_bytes / 1024).toFixed(1)} KB:</p>
            <ul className="list-disc pl-5">{kinds.map(([kind, count]) => <li key={kind}>{count} × {kind.replace(/_/g, " ")}</li>)}</ul>
            <p className="mt-2 font-semibold">Left out:</p>
            <ul className="list-disc pl-5 text-muted">{exportPreview.excluded.map((e) => <li key={e.what}>{e.what} — {e.why}</li>)}</ul>
          </div>
        )}
        {exported && <Callout tone="success" role="status" title="Export written">{exported.files} file(s), {(exported.bytes / 1024).toFixed(1)} KB, with an integrity manifest: <span className="select-all break-all font-mono text-ink">{exported.path}</span></Callout>}
      </Block>
      <Block title="What is kept, and for how long">
        <ul className="flex flex-col">
          {(settings.data?.retention ?? []).map((r) => <li key={r.class} className={cn(ROW, "text-ui")}><span className="font-semibold">{retentionHeading(r.class)}</span><span className="ll-measure block text-muted">{r.default}</span></li>)}
        </ul>
      </Block>
      <Block title="Clean up local app data" intro="Removes only data this app can rebuild. Evidence, originals and unfinished work are never part of it.">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => guard(async () => { setReceipt(null); setCleanup(await apiGet(`cleanup/${courseId}/preview`)); })}>Preview cleanup</Button>
          <Button disabled={!cleanup || cleanup.removable.length === 0} onClick={() => guard(async () => {
            if (!window.confirm(`Remove ${cleanup!.removable.length} rebuildable item(s) (${(cleanup!.removable_bytes / 1024).toFixed(1)} KB)? Evidence and originals are not affected.`)) return;
            setReceipt(await apiPost(`cleanup/${courseId}/apply`, { preview_id: cleanup!.preview_id }));
            setCleanup(null);
          })}>Remove the previewed items</Button>
        </div>
        {!cleanup && !receipt && <p className="text-ui text-muted">Preview first: only the previewed items can be removed.</p>}
        {cleanup && (
          <div className={INSET} data-testid="cleanup-preview">
            <p className="font-semibold">Can be removed ({cleanup.removable.length}):</p>
            <ul className="list-disc pl-5">{cleanup.removable.map((i) => <li key={i.path}><span className="break-all">{i.path}</span> — {i.why}</li>)}{cleanup.removable.length === 0 && <li className="text-muted">Nothing rebuildable is stored right now.</li>}</ul>
            <p className="mt-2 font-semibold">Protected ({cleanup.blocked.length}):</p>
            <ul className="list-disc pl-5 text-muted">{cleanup.blocked.slice(0, 8).map((i) => <li key={i.path}><span className="break-all">{i.path.split("/").slice(-2).join("/")}</span> — {i.why}</li>)}</ul>
            <p className="mt-2 font-semibold">Kept ({cleanup.retained.length}) — captured text stays until you ask for a reference-aware deletion.</p>
            <p className="mt-2 font-semibold">Outside this app's reach:</p>
            <ul className="list-disc pl-5 text-muted">{cleanup.out_of_scope.map((o) => <li key={o.what}>{o.what} — {o.why}</li>)}</ul>
          </div>
        )}
        {receipt && <Callout tone={receipt.status === "done" ? "success" : "caution"} role="status" title={receipt.status === "done" ? "Cleanup receipt" : "Nothing was removed"}>
          {receipt.status === "done" ? `Removed ${receipt.removed?.length ?? 0} item(s); ${receipt.blocked?.length ?? 0} protected item(s) untouched. ${receipt.rebuild?.queued ? receipt.rebuild.note : ""} ${receipt.note ?? ""}` : receipt.reason}
        </Callout>}
        <p className="ll-measure text-read text-muted">There is no "delete everything" button: removing a response that an attempt refers to needs the course's own writer and an approved deletion policy. This app does not claim to erase copies held by a provider or on other devices.</p>
      </Block>
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
      <Block title="Things that need attention" intro="Each item says what kind of problem it is. A repair is always previewed first and changes only what it lists.">
        {list.length === 0 ? <p className="text-ui text-muted">Nothing needs attention.</p> : (
          <ul className="flex flex-col" data-testid="issue-list">
            {list.map((i) => (
              <li key={i.issue_id} className={cn(ROW, "flex flex-col items-start gap-1")}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><StatusChip tone="caution">{i.kind.replace(/_/g, " ")}</StatusChip><span className="text-ui font-semibold">{i.course_id.toUpperCase()}</span></div>
                <p className="ll-measure break-words">{i.summary}</p>
                <Link className="ll-btn ll-btn-sm mt-1" to={`/settings/maintenance/${encodeURIComponent(i.issue_id)}`}>{i.repair ? "Preview the repair" : "See details"}</Link>
              </li>
            ))}
          </ul>
        )}
      </Block>
      <Block title="Whole-product readiness" intro="A fail-closed report against the original live gates. Local tests and fixtures cannot make it pass.">
        <div><Button onClick={async () => setAcceptance(await apiPost("acceptance/run"))}>Run readiness report</Button></div>
        {acceptance && (
          <div className="text-ui" data-testid="acceptance">
            <p className="text-read font-semibold">Result: {acceptance.overall.replace(/_/g, " ")}</p>
            <ul className="mt-2 flex flex-col">{acceptance.checks.map((c) => (
              <li key={c.id} className={cn(ROW, "grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 max-[599px]:grid-cols-1")}>
                <StatusChip tone={c.status === "PASS" ? "success" : c.status === "FAIL" ? "danger" : "unassessed"}>{c.status.replace("_", " ")}</StatusChip>
                <span className="min-w-0"><span className="font-semibold">{keyWords(c.id)}</span> — <span className="text-muted">{c.detail}</span></span>
              </li>
            ))}</ul>
            <p className="ll-measure mt-3 text-muted">{acceptance.boundary}</p>
          </div>
        )}
      </Block>
    </>
  );
}

// ---- Build and data (R2-B1; readbacks of timing and of suggested links) ---------------------------------------------------
/** Copy text to the clipboard; where the browser refuses, select it in place so the learner can copy it by hand. */
async function copyOrSelect(text: string, node: HTMLElement | null): Promise<"copied" | "selected" | "failed"> {
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    if (!node) return "failed";
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return "selected";
  }
}
const COPY_OUTCOME = { copied: "Copied.", selected: "Selected. Press Ctrl+C to copy.", failed: "Could not be copied here; select the text by hand." } as const;

/** The one place of this page where monospace is right: a literal the learner copies into a terminal. */
function CopyText({ text, label }: { text: string; label: string }) {
  const node = useRef<HTMLElement>(null);
  const [outcome, setOutcome] = useState<keyof typeof COPY_OUTCOME | null>(null);
  return (
    <div className="flex flex-col items-start gap-2">
      <code ref={node} className="block w-full select-all break-all rounded-control bg-pad px-3 py-2 font-mono text-ui text-ink">{text}</code>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={async () => setOutcome(await copyOrSelect(text, node.current))}><Copy aria-hidden />{label}</Button>
        <span role="status" className="text-ui text-muted">{outcome ? COPY_OUTCOME[outcome] : ""}</span>
      </div>
    </div>
  );
}

/** The per-course parts of a block: each course a heading that opens, one step below the block's own heading. */
const COURSE_PARTS = "border-t border-hairline [&_.ll-sec]:text-read";

function BuildAndData() {
  const app = useApp();
  const identity = useRef<HTMLDivElement>(null);
  const [outcome, setOutcome] = useState<keyof typeof COPY_OUTCOME | null>(null);
  const courses = (app.workspace?.courses ?? []).filter((course) => course.binding === "bound");
  // Open at first: the course on screen elsewhere (or the first one), until the learner opens or closes one. A course's
  // readback is fetched only when its part is opened.
  const first = courses.find((course) => course.course_id === app.courseId)?.course_id ?? courses[0]?.course_id;
  const [timingOpen, setTimingOpen] = useState<string[] | null>(null);
  const [linksOpen, setLinksOpen] = useState<string[] | null>(null);
  const atFirst = first ? [first] : [];
  return (
    <>
      <Block title="This build" intro="Which app this page is, which Brain it talks to and which preparation each course uses, as text you can read and copy. A fact that was not established says so.">
        <div ref={identity}><BuildIdentity variant="settings" /></div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={async () => setOutcome(await copyOrSelect(identity.current?.innerText ?? "", identity.current))}><Copy aria-hidden />Copy the build identity</Button>
          <span role="status" className="text-ui text-muted">{outcome ? COPY_OUTCOME[outcome] : ""}</span>
        </div>
      </Block>
      <Block title="Speech timing and transcription" intro="Per course: how far local transcription and slide linking have come, as measured. Generated timing is not reviewed and the ranges are suggestions; nothing here estimates what remains.">
        {courses.length === 0 ? <p className="text-ui text-muted">No course is bound.</p> : (
          <Sections value={timingOpen ?? atFirst} onValueChange={setTimingOpen} className={COURSE_PARTS}>
            {courses.map((course) => <OpenSection key={course.course_id} value={course.course_id} title={course.display_name}><TimingReadback courseId={course.course_id} /></OpenSection>)}
          </Sections>
        )}
      </Block>
      <Block title="Suggested question links" intro="Per course: where the file of suggested links stands and what was read from it. Suggestions are agent work kept apart from the course record; counts only, never the file's text.">
        {courses.length === 0 ? <p className="text-ui text-muted">No course is bound.</p> : (
          <Sections value={linksOpen ?? atFirst} onValueChange={setLinksOpen} className={COURSE_PARTS}>
            {courses.map((course) => <OpenSection key={course.course_id} value={course.course_id} title={course.display_name}><SuggestedLinksReadback courseId={course.course_id} /></OpenSection>)}
          </Sections>
        )}
      </Block>
    </>
  );
}

/** A figure with its words: "3 lectures". */
function CountList({ rows, unit }: { rows: Array<{ key: string; label: string; count: number }>; unit?: [string, string] }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {rows.map((row) => <li key={row.key} data-count={row.key}><span className="ll-num font-semibold">{unit ? countLabel(row.count, unit[0], unit[1]) : row.count}</span> <span className="text-muted">·</span> {row.label}</li>)}
    </ul>
  );
}

function TimingReadback({ courseId }: { courseId: string }) {
  const timing = useCourseTiming(courseId);
  const [lecturesOpen, setLecturesOpen] = useState(false);
  if (timing.isLoading) return <LoadingState label="Reading the timing of this course…" />;
  if (timing.isError || !timing.data) return <ErrorState error={timing.error} retry={() => void timing.refetch()} title="The timing readback could not be loaded" stillWorks="Lectures and their recording ranges open as usual." />;
  const data = timing.data;
  const stages = stageRows(data.summary).map((row) => ({ key: row.stage, label: row.label, count: row.lectures }));
  const coverage = coverageLines(data.summary);
  return (
    <div className="flex flex-col gap-4 pt-1" data-testid="timing-readback" data-course={courseId}>
      <Facts>
        <Fact term="Lectures by stage">{stages.length ? <CountList rows={stages} unit={["lecture", "lectures"]} /> : <span className="text-muted">The Brain states no stage counts.</span>}</Fact>
        <Fact term="Coverage">{coverage.length ? coverage.map((line) => <p key={line}>{line}</p>) : <span className="text-muted">The Brain states no coverage figures.</span>}</Fact>
        <Fact term="Allowance" testId="timing-allowance">{allowanceLine(data.allowance)}</Fact>
      </Facts>
      <div className="flex flex-col gap-1.5">
        <h4 className="text-ui font-semibold">Command that continues transcription</h4>
        {data.resume_command ? (
          <>
            <p className="ll-measure text-ui text-muted">Run it in a terminal on the Brain PC. It continues where it stopped, keeps to the allowance and can be stopped at any time.</p>
            <CopyText text={data.resume_command} label="Copy the command" />
          </>
        ) : <p className="text-ui text-muted">The Brain states no command.</p>}
      </div>
      {data.build_command && (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-ui font-semibold">Command that rebuilds the recording ranges</h4>
          <p className="ll-measure text-ui text-muted">It rebuilds the generated ranges from the current inputs. Ranges you marked or confirmed are never touched.</p>
          <CopyText text={data.build_command} label="Copy the command" />
        </div>
      )}
      <div>
        <SectionToggle aria-expanded={lecturesOpen} count={data.lectures.length} className="text-ui" onClick={() => setLecturesOpen((value) => !value)}>Each lecture</SectionToggle>
        {lecturesOpen && (
          <ul className="flex flex-col">
            {data.lectures.map((lecture) => {
              const stored = linksWords(lecture.links);
              return (
                <li key={lecture.lecture_id} className={cn(ROW, "text-ui")} data-stage={lecture.stage}>
                  <p className="flex flex-wrap items-baseline justify-between gap-x-4"><span className="min-w-0 font-semibold">{lecture.title ?? lecture.lecture_id}</span><span>{(TIMING_STAGE_LABEL as Record<string, string | undefined>)[lecture.stage] ?? unlistedLabel(String(lecture.stage))}</span></p>
                  {lecture.recordings.map((recording) => (
                    <p key={recording.source_id} className="ll-measure mt-1 text-muted">
                      <span className="break-words text-ink">{recording.filename ?? recording.source_id}</span>{isNumber(recording.duration_ms) ? `, ${durationLabel(recording.duration_ms)}` : ""}. {generatedCoverageSentence(recording.generated)}{" "}
                      {dotJoin([
                        (TEXT_ALIGNMENT_STATE_LABEL as Record<string, string | undefined>)[recording.text_alignment?.state] ?? null,
                        (ASSOCIATION_STATE_LABEL as Record<string, string | undefined>)[recording.association?.state] ?? null,
                        queueWords(recording.queue) ? `queue: ${queueWords(recording.queue)}` : null,
                      ])}
                    </p>
                  ))}
                  {stored && <p className="mt-1 text-muted">Stored ranges: {stored}{lecture.links?.built_at ? `, built ${formatWhen(lecture.links.built_at)}` : ""}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {data.note && <p className="ll-measure text-read text-muted">{data.note}</p>}
    </div>
  );
}

function SuggestedLinksReadback({ courseId }: { courseId: string }) {
  const anchors = useInferredAnchors(courseId);
  if (anchors.isLoading) return <LoadingState label="Reading the suggested links of this course…" />;
  if (anchors.isError || !anchors.data) return <ErrorState error={anchors.error} retry={() => void anchors.refetch()} title="The readback of suggested links could not be loaded" stillWorks="Questions and their course-record anchors open as usual." />;
  const data = anchors.data;
  const refused = refusedRows(data.refused);
  const decisions = decisionRows(data.decisions);
  const fileState = (INFERRED_FILE_STATE_LABEL as Record<string, string | undefined>)[data.file.state] ?? unlistedLabel(String(data.file.state));
  return (
    <div className="flex flex-col gap-4 pt-1" data-testid="suggestions-readback" data-course={courseId} data-file-state={data.file.state}>
      <Facts>
        <Fact term="Suggestions file" testId="suggestions-file">
          {fileState}{data.file.produced_at ? `, produced ${formatWhen(data.file.produced_at)}` : ""}.{data.file_reason ? ` ${data.file_reason}` : ""}
          {data.file.sha256 && <span className="mt-0.5 block text-muted">Digest <span className="select-all break-all font-mono">{data.file.sha256}</span></span>}
        </Fact>
        <Fact term="Counts"><CountList rows={anchorCountRows(data)} /></Fact>
        <Fact term="Refused, by reason">
          {refused.length ? <ul className="flex flex-col gap-0.5">{refused.map((row) => <li key={row.reason}><span className="ll-num font-semibold">{row.count}</span> <span className="text-muted">·</span> {row.reason}</li>)}</ul>
            : <span className="text-muted">No entry was refused.</span>}
        </Fact>
        {decisions.length > 0 && <Fact term="Your decisions"><CountList rows={decisions} /></Fact>}
      </Facts>
      {data.by_collection.length > 0 && (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Suggested links by collection (scrolls sideways on a narrow screen)">
          <table className="ll-num w-full min-w-[34rem] border-collapse text-left text-ui">
            <thead><tr className="border-b border-hairline text-muted">
              <th scope="col" className="py-1.5 pr-3 font-normal">Collection</th><th scope="col" className="px-3 font-normal">Questions</th><th scope="col" className="px-3 font-normal">With a suggested link</th>
              <th scope="col" className="px-3 font-normal">Inspected, no supporting page</th><th scope="col" className="pl-3 font-normal">No suggested link</th></tr></thead>
            <tbody>
              {data.by_collection.map((row) => (
                <tr key={row.collection ?? "none"} className="border-b border-hairline last:border-b-0">
                  <th scope="row" className="py-1.5 pr-3 font-semibold">{row.collection ?? "no collection"}</th>
                  <td className="px-3">{row.questions}</td><td className="px-3">{row.questions_with_suggestion}</td><td className="px-3">{row.questions_inspected_no_support}</td><td className="pl-3">{row.questions_without_suggestion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.note && <p className="ll-measure text-read text-muted">{data.note}</p>}
    </div>
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
  if (preview.isLoading) return <Page reading><LoadingState /></Page>;
  if (!approved && (preview.isError || !preview.data)) return <Page reading><ErrorState error={preview.error} /></Page>;
  const p = approved ?? preview.data!;
  return (
    <Page reading>
      <Link to="/settings/maintenance" className="ll-btn ll-btn-sm mb-4">← Maintenance</Link>
      <PageHeader title="Repair preview" subtitle={p.issue?.summary ?? "This issue no longer exists."} />
      {p.status === "unknown_issue" ? <Callout tone="success" title="Nothing to repair">The problem is no longer present.</Callout> : (
        <div className="ll-region flex flex-col gap-4 p-4 min-[900px]:p-6" data-testid="repair-preview">
          <p><StatusChip tone="caution">{p.issue!.kind.replace(/_/g, " ")}</StatusChip></p>
          <Facts>
            <Fact term="Operation">{p.operation ?? "No automatic repair exists for this problem."}</Fact>
            {p.target_owner && <Fact term="Who owns the target">{p.target_owner}</Fact>}
            {p.inputs && <Fact term="Reads">{p.inputs.join("; ")}</Fact>}
            {p.expected_writes && <Fact term="Would write">{p.expected_writes.join("; ")}</Fact>}
            {p.unchanged && <Fact term="Stays unchanged">{p.unchanged.join("; ")}</Fact>}
          </Facts>
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
    </Page>
  );
}
