// SC01 Connect workspace (UI01/UI02). Separate, honest checks: which course folders are bound, whether
// this device may submit, whether the native tutor is verified and whether saves reach the course.
// Accepting this screen activates nothing; browsing works even when the tutor is not connected.
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { CheckCircle2, CircleDashed, ShieldCheck, TriangleAlert } from "lucide-react";
import { useApp } from "@/app/state";
import { Button, Callout, ErrorState, LoadingState, PageHeader, StatusChip } from "@/components/ui";
import { formatFingerprint } from "@/lib/device";

function Check({ ok, title, children }: { ok: boolean | "partial"; title: string; children: React.ReactNode }) {
  const Icon = ok === true ? CheckCircle2 : ok === "partial" ? TriangleAlert : CircleDashed;
  return (
    <li className="ll-card flex gap-3 p-3">
      <Icon aria-hidden className={ok === true ? "mt-0.5 size-5 shrink-0 text-success" : ok === "partial" ? "mt-0.5 size-5 shrink-0 text-caution" : "mt-0.5 size-5 shrink-0 text-unassessed"} />
      <div className="min-w-0">
        <p className="font-semibold">{title} <span className="sr-only">— {ok === true ? "ready" : ok === "partial" ? "limited" : "not set up"}</span></p>
        <div className="text-sm text-muted">{children}</div>
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
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <PageHeader title="Connect your course workspace" subtitle="One learner, your existing course folders. Nothing is reorganised, uploaded or written by connecting." />

      <section aria-labelledby="scope-heading" className="ll-card p-4">
        <h2 id="scope-heading" className="mb-2 text-lg font-semibold">What this app reads and what it may write</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li><strong>Reads</strong> your course folders on this PC: slides, recordings, transcripts, the course's own question and skill catalogs, and your recorded attempts.</li>
          <li><strong>May later write, only with your approval:</strong> your own submitted answers and reviewed slide–recording links, through each course's own writer. Until then they are staged, not saved.</li>
          <li><strong>Never:</strong> grades, calendars, email, other folders, or anything in a course you did not bind. No paid AI service is used.</li>
        </ul>
      </section>

      <section aria-labelledby="bindings-heading">
        <h2 id="bindings-heading" className="mb-2 text-lg font-semibold">Course bindings ({workspace.term})</h2>
        <ul className="flex flex-col gap-2">
          {workspace.courses.map((course) => (
            <li key={course.course_id} className="ll-card flex flex-wrap items-center justify-between gap-2 p-3">
              <div>
                <p className="font-medium">{course.display_name}</p>
                <p className="text-sm text-muted">{course.course_id}{course.binding === "bound" ? ` · ${course.lecture_units} lecture units · ${course.sessions} sessions` : ""}</p>
              </div>
              {course.binding === "bound" ? <StatusChip tone="success">Bound</StatusChip> : <StatusChip tone="danger" title={course.problem ?? undefined}>Not bound: {course.problem}</StatusChip>}
            </li>
          ))}
        </ul>
        {problems.length > 0 && <p className="mt-2 text-sm text-muted">A binding problem stops only that course. Similar-looking folders are never chosen by guess.</p>}
      </section>

      <section aria-labelledby="checks-heading">
        <h2 id="checks-heading" className="mb-2 text-lg font-semibold">Access checks (each is separate)</h2>
        <ul className="flex flex-col gap-2">
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
        <p className="mt-2 text-sm"><Link className="text-accent underline" to="/settings/ai">Setup details</Link> lists the exact next action for anything not ready — it never asks you to weaken permissions.</p>
      </section>

      <section aria-labelledby="pair-heading" className="ll-card p-4">
        <h2 id="pair-heading" className="mb-2 flex items-center gap-2 text-lg font-semibold"><ShieldCheck aria-hidden className="size-5 text-accent" /> Pair this device</h2>
        {!device ? <LoadingState label="Preparing this device's key…" /> : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">This device made its own signing key. The private key never leaves this browser. Compare this fingerprint with the one shown on the Brain PC before approving.</p>
            <p className="font-mono text-sm break-all" data-testid="device-fingerprint" aria-label="This device's key fingerprint">{formatFingerprint(device.fingerprint)}</p>
            {!device.durable && <Callout tone="caution" title="This browser cannot keep the key">Storage is unavailable, so the pairing lasts only until this page closes.</Callout>}
            {pairing.state === "unpaired" && <div><Button variant="primary" busy={busy} onClick={() => run(app.requestPairing)}>Request pairing</Button></div>}
            {pairing.state === "pending" && (
              <Callout tone="accent" title="Waiting for approval at the Brain PC" actions={<Button variant="primary" busy={busy} onClick={() => run(app.approvePairing)}>I am at the Brain PC and the fingerprints match — approve</Button>}>
                On another device, approve from the Brain PC instead (Settings → Devices, or <code>lecture-brain pair-approve</code>). A request arriving through Drive can never approve itself.
              </Callout>
            )}
            {pairing.state === "paired" && <StatusChip tone="success">Paired with Brain {workspace.brain.key_id}</StatusChip>}
            {error && <Callout tone="danger" role="alert" title="Pairing did not complete">{error}</Callout>}
          </div>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => navigate("/study")} disabled={bound.length === 0}>Open workspace</Button>
        {pairing.state !== "paired" && <p className="self-center text-sm text-muted">You can open the workspace now and pair later.</p>}
      </div>
    </div>
  );
}
