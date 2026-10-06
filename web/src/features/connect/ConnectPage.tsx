// SC01 Connect workspace (UI01/UI02). Separate, honest checks: which course folders are bound, whether
// this device may submit, whether the native tutor is verified and whether saves reach the course.
// Accepting this screen activates nothing; browsing works even when the tutor is not connected.
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Check as Tick, Flag, Minus } from "lucide-react";
import { useApp } from "@/app/state";
import { Button, ErrorState, LoadingState, PageHeader } from "@/components/ui";
import { formatFingerprint } from "@/lib/device";
import { Callout, Lead, StateWords } from "@/features/search/SearchOverlay";

/** A list of entries on one surface, parted by hairlines: never a wall of boxes. */
const ROWS = "ll-region flex flex-col";
const ROW = "border-t border-hairline p-4 first:border-t-0 min-[900px]:px-5";
const SECTION_HEAD = "mb-3 text-head font-semibold";

/**
 * One access check. Its state is said in words for assistive technology and drawn with a plain mark that is not a
 * ring (rings are evidence states): a tick when ready, a flag when limited, a dash when not set up.
 */
function Check({ ok, title, children }: { ok: boolean | "partial"; title: string; children: React.ReactNode }) {
  const Icon = ok === true ? Tick : ok === "partial" ? Flag : Minus;
  return (
    <li className={`${ROW} flex gap-3`}>
      <Icon aria-hidden className={ok === true ? "mt-0.5 size-5 flex-none text-success" : ok === "partial" ? "mt-0.5 size-5 flex-none text-caution" : "mt-0.5 size-5 flex-none text-unassessed"} />
      <div className="min-w-0">
        <p className="font-semibold">{title} <span className="sr-only">— {ok === true ? "ready" : ok === "partial" ? "limited" : "not set up"}</span></p>
        <div className="ll-measure text-ui text-muted">{children}</div>
      </div>
    </li>
  );
}

export function ConnectPage() {
  const app = useApp();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (app.workspaceLoading) return <LoadingState label="Checking this PC's workspace…" />;
  if (!app.workspace) return <ErrorState error={app.workspaceError} />;
  const { workspace, pairing, device } = app;
  const caps = workspace.capabilities;
  const bound = workspace.courses.filter((c) => c.binding === "bound");
  const problems = workspace.courses.filter((c) => c.binding !== "bound");

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ll-page ll-page-reading flex flex-col gap-8">
      <PageHeader title="Connect your course workspace" subtitle={<Lead>One learner, your existing course folders. Nothing is reorganised, uploaded or written by connecting.</Lead>} />

      <section aria-labelledby="scope-heading" className="-mt-2">
        <h2 id="scope-heading" className={SECTION_HEAD}>What this app reads and what it may write</h2>
        <ul className="ll-measure list-disc space-y-1.5 pl-5">
          <li><strong>Reads</strong> your course folders on this PC: slides, recordings, transcripts, the course's own question and skill catalogs, and your recorded attempts.</li>
          <li><strong>May later write, only with your approval:</strong> your own submitted answers and reviewed slide–recording links, through each course's own writer. Until then they are staged, not saved.</li>
          <li><strong>Never:</strong> grades, calendars, email, other folders, or anything in a course you did not bind. No paid AI service is used.</li>
        </ul>
      </section>

      <section aria-labelledby="bindings-heading">
        <h2 id="bindings-heading" className={SECTION_HEAD}>Course bindings <span className="ll-sec-n">({workspace.term})</span></h2>
        <ul className={ROWS}>
          {workspace.courses.map((course) => (
            <li key={course.course_id} className={`${ROW} flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1`}>
              <div className="min-w-0">
                <p className="font-semibold">{course.display_name}</p>
                <p className="ll-num text-ui text-muted">{course.course_id}{course.binding === "bound" ? ` · ${course.lecture_units} lecture units · ${course.sessions} sessions` : ""}</p>
              </div>
              {course.binding === "bound" ? <StateWords tone="success">Bound</StateWords> : <StateWords tone="danger" detail={course.problem}>Not bound: {course.problem}</StateWords>}
            </li>
          ))}
        </ul>
        {problems.length > 0 && <p className="ll-measure mt-3 text-ui text-muted">A binding problem stops only that course. Similar-looking folders are never chosen by guess.</p>}
      </section>

      <section aria-labelledby="checks-heading">
        <h2 id="checks-heading" className={SECTION_HEAD}>Access checks (each is separate)</h2>
        <ul className={ROWS}>
          <Check ok={bound.length > 0} title="Reading course sources on this PC">
            {bound.length} of {workspace.courses.length} courses readable through the Brain on this PC. Cross-device Drive access is separate and {caps.drive.status === "not_configured" ? "not configured" : caps.drive.label.toLowerCase()}.
          </Check>
          <Check ok={pairing.state === "paired"} title="Sending your questions and answers from this device">
            {pairing.state === "paired" ? "This device is paired with the Brain. Its requests are signed and checked." : pairing.state === "pending" ? "Pairing requested. It must be approved at the Brain PC after comparing fingerprints." : "Not paired. You can browse and draft; nothing can be sent until this device is paired."}
          </Check>
          <Check ok={caps.native.status === "verified" ? true : caps.native.status === "fixture_double" ? "partial" : false} title={caps.native.label}>
            {caps.native.detail} {caps.native.status !== "verified" && "The PC being on does not mean the tutor is connected."}
          </Check>
          <Check ok={caps.writer.status === "enabled" ? true : caps.writer.status === "fixture_isolated" ? "partial" : false} title={caps.writer.label}>{caps.writer.detail}</Check>
        </ul>
        <p className="ll-measure mt-3 text-ui"><Link className="ll-link" to="/settings/ai">Setup details</Link> lists the exact next action for anything not ready — it never asks you to weaken permissions.</p>
      </section>

      <section aria-labelledby="pair-heading" className="ll-region p-4 min-[900px]:p-6">
        <h2 id="pair-heading" className={SECTION_HEAD}>Pair this device</h2>
        {!device ? <LoadingState label="Preparing this device's key…" /> : (
          <div className="flex flex-col gap-4">
            <p className="ll-measure text-ui text-muted">This device made its own signing key. The private key never leaves this browser. Compare this fingerprint with the one shown on the Brain PC before approving.</p>
            <p className="select-all break-all font-mono text-ui" data-testid="device-fingerprint" aria-label="This device's key fingerprint">{formatFingerprint(device.fingerprint)}</p>
            {!device.durable && <Callout tone="caution" title="This browser cannot keep the key">Storage is unavailable, so the pairing lasts only until this page closes.</Callout>}
            {pairing.state === "unpaired" && <div><Button variant="primary" busy={busy} onClick={() => run(app.requestPairing)}>Request pairing</Button></div>}
            {pairing.state === "pending" && (
              <Callout tone="accent" title="Waiting for approval at the Brain PC" actions={<Button variant="primary" busy={busy} onClick={() => run(app.approvePairing)}>I am at the Brain PC and the fingerprints match — approve</Button>}>
                On another device, approve from the Brain PC instead (Settings → Devices, or <code className="font-mono text-ink">lecture-brain pair-approve</code>). A request arriving through Drive can never approve itself.
              </Callout>
            )}
            {pairing.state === "paired" && <p className="ll-state"><Tick aria-hidden className="text-success" /><span>Paired with Brain {workspace.brain.key_id}</span></p>}
            {error && <Callout tone="danger" role="alert" title="Pairing did not complete">{error}</Callout>}
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button variant={pairing.state === "paired" ? "primary" : "default"} onClick={() => navigate("/study")} disabled={bound.length === 0}>Open workspace</Button>
        {bound.length === 0 ? <p className="text-ui text-muted">No course folder is bound, so there is nothing to open yet.</p>
          : pairing.state !== "paired" && <p className="text-ui text-muted">You can open the workspace now and pair later.</p>}
      </div>
    </div>
  );
}
