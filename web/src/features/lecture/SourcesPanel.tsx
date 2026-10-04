// Sources panel (UI09) and link correction (UI10). Every related item says why it is linked, to which
// exact source/version, and how precise the link is; a chapter-level relation is never shown as a page.
// A correction is a new revision submitted to the owner — never an in-place overwrite.
import { useState } from "react";
import { Link, useLocation } from "react-router";
import { BookMarked, FileQuestion, Files, Network } from "lucide-react";
import { Button, Callout, Dialog, Field, formatMs, StatusChip } from "@/components/ui";
import type { SourceRef } from "@/lib/db";
import { kindLabel, REVIEW_STATE, SOURCE_STATE } from "@/lib/labels";
import type { Occurrence, OtherMaterial, RecordingView, SlideView } from "@/lib/types";

function locatorText(source: SourceRef): string {
  const loc = source.locator as Record<string, unknown>;
  switch (loc.kind) {
    case "page":
      return `PDF page ${loc.page}${loc.printed_label ? ` (printed page ${loc.printed_label})` : ""}`;
    case "lines":
      return `lines ${loc.start}–${loc.end}`;
    case "media":
      return `${formatMs(loc.start_ms as number)}–${formatMs(loc.end_ms as number)}`;
    case "figure":
      return `figure on page ${loc.page}`;
    default:
      return String(loc.description ?? "broad reference");
  }
}

interface SourcesPanelProps {
  courseId: string;
  slide: SlideView | undefined;
  /** Other files stored in this lecture unit's folder. They belong to the unit, not to one slide. */
  others?: OtherMaterial[];
  onPin: (source: SourceRef, label: string) => void;
}

export function SourcesPanel({ courseId, slide, others = [], onPin }: SourcesPanelProps) {
  const location = useLocation();
  const back = { returnTo: location.pathname + location.search, returnLabel: "Return to slide" };
  if (!slide && others.length === 0) return <Callout tone="unassessed" title="No slide selected" />;
  if (!slide) return <div className="flex flex-col gap-4"><OtherFiles courseId={courseId} others={others} back={back} /></div>;
  const nothing = slide.related.length === 0 && slide.questions.length === 0 && slide.concepts.length === 0;
  return (
    <div className="flex flex-col gap-4">
      {nothing && <Callout tone="unassessed" title="Nothing is linked to this slide yet">No related question, reading or concept is recorded for it. That is a gap in the mapping, not a statement about you; the slide itself can still be studied and asked about.</Callout>}
      {slide.questions.length > 0 && (
        <section aria-labelledby="src-questions">
          <h3 id="src-questions" className="ll-label mb-1 flex items-center gap-1"><FileQuestion aria-hidden className="size-4" /> Questions on this slide</h3>
          <ul className="flex flex-col gap-1">
            {slide.questions.map((q) => (
              <li key={q.question_id}>
                <Link to={`/courses/${courseId}/questions/${encodeURIComponent(q.question_id)}`} state={back} className="ll-card flex items-center justify-between gap-2 p-2 hover:bg-raised">
                  <span><span className="font-medium">{q.title ?? q.question_id}</span> <span className="text-sm text-muted">{q.question_id}</span></span>
                  <span className="text-sm text-accent">Open</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {slide.related.length > 0 && (
        <section aria-labelledby="src-related">
          <h3 id="src-related" className="ll-label mb-1 flex items-center gap-1"><BookMarked aria-hidden className="size-4" /> Connected material</h3>
          <ul className="flex flex-col gap-2">
            {slide.related.map((link) => {
              const review = REVIEW_STATE[link.review_state]!;
              const broad = link.precision === "broad_reference";
              return (
                <li key={link.annotation_id} className="ll-card flex flex-col gap-1 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{link.filename ?? link.to.source_id}</span>
                    <StatusChip tone="neutral">{kindLabel(link.kind)}</StatusChip>
                    <StatusChip tone={review.tone}>{review.label}</StatusChip>
                  </div>
                  <p className="text-sm text-muted">
                    Why linked: {link.relation === "practiced_by" ? "practises this slide's idea" : "explains this slide's idea"} · basis: {link.basis.replace(/_/g, " ")} ·{" "}
                    {broad ? <strong>chapter-level reference — no exact page has been reviewed</strong> : <>location: {locatorText(link.to)}</>} · version {link.to.version_id}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {link.available ? <Link className="ll-btn ll-btn-sm" to={`/courses/${courseId}/sources/${encodeURIComponent(link.to.source_id)}${(link.to.locator as { page?: number }).page ? `?page=${(link.to.locator as { page?: number }).page}` : ""}`} state={back}>Open</Link>
                      : <StatusChip tone="unassessed">File not available</StatusChip>}
                    <Button size="sm" variant="quiet" onClick={() => onPin(link.to, `${link.filename ?? "source"} · ${locatorText(link.to)}`)}>Pin to my question</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <OtherFiles courseId={courseId} others={others} back={back} />
      {slide.concepts.length > 0 && (
        <section aria-labelledby="src-concepts">
          <h3 id="src-concepts" className="ll-label mb-1 flex items-center gap-1"><Network aria-hidden className="size-4" /> On this slide</h3>
          <ul className="flex flex-wrap gap-2">
            {slide.concepts.map((c) => (
              <li key={c.concept_id}><Link className="ll-chip hover:underline" to={`/courses/${courseId}/concepts/${encodeURIComponent(c.concept_id)}`} state={back} title={`Linked through a ${c.basis}`}>{c.label}</Link></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function sizeText(n: number | null): string {
  if (n === null) return "size unknown";
  return n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** Further decks and notes kept in the same lecture unit. Listed so no file of the unit is unreachable; each opens as its original. */
function OtherFiles({ courseId, others, back }: { courseId: string; others: OtherMaterial[]; back: { returnTo: string; returnLabel: string } }) {
  if (others.length === 0) return null;
  return (
    <section aria-label="Other files in this lecture unit">
      <h3 className="ll-label mb-1 flex items-center gap-1"><Files aria-hidden className="size-4" /> Other files in this lecture unit ({others.length})</h3>
      <ul className="flex flex-col gap-1">
        {others.map((item) => {
          const state = SOURCE_STATE[item.state] ?? { label: item.state.replace(/_/g, " "), tone: "neutral" as const, detail: "" };
          return (
            <li key={item.source_id} className="ll-card flex flex-wrap items-center justify-between gap-2 p-2">
              <div className="min-w-0">
                <p className="break-words font-medium">{item.filename ?? item.source_id}</p>
                <p className="text-sm text-muted">{item.role === "deck" ? "Slides or reading" : kindLabel(item.kind)} · {sizeText(item.bytes)}{item.registration === "unregistered" ? " · not registered by the course updater" : ""}{item.rendition === "needs_rendition" ? " · needs a PDF rendition to display here" : ""}</p>
              </div>
              {item.available
                ? <Link className="ll-btn ll-btn-sm" to={`/courses/${courseId}/sources/${encodeURIComponent(item.source_id)}`} state={back}>Open</Link>
                : <StatusChip tone={state.tone}>{state.label}</StatusChip>}
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-xs text-muted">Only the unit's main slides are prepared for search and slide links. These files open as their originals.</p>
    </section>
  );
}

interface EditMatchProps {
  occurrence: Occurrence | null;
  recording: RecordingView | undefined;
  onClose: () => void;
  onPreview: (startMs: number, endMs: number) => void;
  onSubmit: (occurrence: Occurrence, change: { startMs: number; endMs: number; state: "confirmed" | "rejected" | "suggested" }) => Promise<void>;
}

/** Numeric start/end fields with a preview — no dragging required. Saving creates a revision of the link. */
export function EditMatchDialog({ occurrence, recording, onClose, onPreview, onSubmit }: EditMatchProps) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState<string | null>(null);
  if (occurrence && seeded !== occurrence.annotation_id + occurrence.revision) {
    setSeeded(occurrence.annotation_id + occurrence.revision);
    setStart((occurrence.start_ms / 1000).toString());
    setEnd((occurrence.end_ms / 1000).toString());
    setError(null);
  }
  if (!occurrence) return null;
  const startMs = Math.round(Number(start) * 1000);
  const endMs = Math.round(Number(end) * 1000);
  const duration = recording?.duration_ms ?? null;
  const problem = !Number.isFinite(startMs) || !Number.isFinite(endMs) || start.trim() === "" || end.trim() === "" ? "Enter both times as seconds."
    : startMs < 0 ? "The start cannot be negative."
    : endMs <= startMs ? "The end must be after the start."
    : duration !== null && endMs > duration + 500 ? `The recording is ${formatMs(duration)} long; the end is outside it.` : null;

  const send = async (state: "confirmed" | "rejected" | "suggested") => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(occurrence, { startMs: state === "rejected" ? occurrence.start_ms : startMs, endMs: state === "rejected" ? occurrence.end_ms : endMs, state });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title="Edit match" description="Adjust which part of the recording belongs to this slide. Saving proposes a new revision; the previous one is kept."
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        {occurrence.review_state !== "suggested" && <Button busy={busy} onClick={() => send("suggested")} title="Return this link to unreviewed, as a new revision">Undo review</Button>}
        <Button busy={busy} onClick={() => send("rejected")}>Reject link</Button>
        <Button variant="primary" busy={busy} disabled={!!problem} onClick={() => send("confirmed")}>Confirm corrected match</Button>
      </>}>
      <div className="flex flex-col gap-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted">Current link</dt><dd>{formatMs(occurrence.start_ms)}–{formatMs(occurrence.end_ms)} · revision {occurrence.revision} · {REVIEW_STATE[occurrence.review_state]!.label}</dd>
          <dt className="text-muted">Basis</dt><dd>{occurrence.basis.replace(/_/g, " ")}</dd>
          <dt className="text-muted">Recording</dt><dd>{recording?.filename ?? occurrence.source.source_id} · version {occurrence.source.version_id}{duration ? ` · ${formatMs(duration)} long` : ""}</dd>
          <dt className="text-muted">Slide deck version</dt><dd>{occurrence.record.from.version_id}</dd>
        </dl>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start (seconds)" htmlFor="match-start"><input id="match-start" className="ll-input" inputMode="decimal" value={start} onChange={(e) => setStart(e.target.value)} aria-invalid={!!problem} aria-describedby="match-problem" /></Field>
          <Field label="End (seconds)" htmlFor="match-end"><input id="match-end" className="ll-input" inputMode="decimal" value={end} onChange={(e) => setEnd(e.target.value)} aria-invalid={!!problem} aria-describedby="match-problem" /></Field>
        </div>
        <p id="match-problem" role={problem ? "alert" : undefined} className={problem ? "text-sm font-medium text-danger" : "text-sm text-muted"}>
          {problem ?? `Proposed: ${formatMs(startMs)}–${formatMs(endMs)}. Preview plays it without saving.`}
        </p>
        <div><Button size="sm" disabled={!!problem} onClick={() => onPreview(startMs, endMs)}>Preview this range</Button></div>
        {error && <Callout tone="danger" role="alert" title="The correction was not sent">{error}</Callout>}
      </div>
    </Dialog>
  );
}
