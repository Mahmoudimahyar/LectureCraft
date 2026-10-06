// The Sources tab (design specification 5.12; UI09) and the dialogs that correct a link (UI10).
//
//   Sources of this lecture   the slides with their file and version facts, the recording, the course transcript, and
//                             where the speech timing stands; each original opens in the Library
//   This page                 what is known of the page on screen and nothing stronger: position, group, printed slide
//                             number, PowerPoint slide, role, each with how it was established; and the way to correct
//                             the grouping or the role (a new revision of the learner's own, never an overwrite)
//   What the map cannot tell  the limitations the source map states, verbatim
//   Related material          what is linked to this page, with why and how precisely (a chapter-level relation is
//                             never shown as a page), and the other files of the unit
//
// Answer material stays closed: its row says so and opens the file's own page, where it is revealed deliberately.
// Questions and concepts of the slide are in their own tabs. A correction of a recording link is a new revision
// submitted to the owner, never an in-place overwrite.
import { useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { AlignLeft, ChevronRight, Clock, ExternalLink, FileText, Mic, Paperclip } from "lucide-react";
import { BasisLabel } from "@/components/labels";
import { Button, Callout, Dialog, Field, cn, formatMs } from "@/components/ui";
import { ApiError } from "@/lib/api";
import type { SourceRef } from "@/lib/db";
import {
  GROUPING_NOT_ESTABLISHED, NO_PPTX_MATCH_LABEL, RANGE_KIND_LABEL, ROLE_LABEL, SOURCE_MAP_UNAVAILABLE_LABEL, SOURCE_STATE, TIMING_STAGE_LABEL, associationSentence, copyOfOneSlideLabel, countLabel,
  durationLabel, groupingLabel, kindLabel, nb, pagesRef, positionLabel, pptxMatchLabel, printedBasisLabel, recordingLabel, roleStateLabel, unlistedLabel,
} from "@/lib/labels";
import { useSourceMapOverride } from "@/lib/queries";
import { identityOf } from "@/lib/r2";
import type { LectureView, Occurrence, OtherMaterial, QuestionRow, RecordingView, RelatedLink, SlideRoleValue, SlideView, SourceMapOverrideRequest } from "@/lib/types";
import { useLectureWorkspace } from "./workspace-state";

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
  /** The lecture and the page on screen. When left out they are read from the lecture workspace the panel stands in. */
  lecture?: LectureView;
  page?: number;
  onPin: (source: SourceRef, label: string) => void;
  // The questions and concepts of the slide moved to their own tabs (5.12); these are accepted and no longer drawn.
  relatedByConcept?: QuestionRow[];
  lectureQuestionCount?: number;
  onShowLectureQuestions?: () => void;
  outlineHref?: string;
}

/** The lecture workspace the panel stands in, or null outside one (a story, a test). */
function useWorkspaceOrNull(): { lecture: LectureView; page: number } | null {
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useLectureWorkspace();
  } catch {
    return null;
  }
}

type Back = { returnTo: string; returnLabel: string };
const HEAD = "text-head font-semibold";

/** One row of a list of sources: an icon, a title at reading size, one muted line, and where it opens. */
function SourceRow({ icon, title, children, to, back, end = "open" }: { icon: ReactNode; title: ReactNode; children?: ReactNode; to?: string | null; back?: Back; end?: "open" | "more" | null }) {
  const body = (
    <>
      <span aria-hidden className="mt-0.5 flex-none text-muted [&>svg]:size-[18px]">{icon}</span>
      <span className="grid min-w-0">
        <span className="break-words text-read font-semibold">{title}</span>
        {children ? <span className="text-ui text-muted [overflow-wrap:anywhere]">{children}</span> : null}
      </span>
      {to && end ? <span aria-hidden className="mt-1 flex-none text-muted [&>svg]:size-4">{end === "open" ? <ExternalLink /> : <ChevronRight />}</span> : null}
    </>
  );
  const row = "-mx-2 grid grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-3 rounded-row px-2 py-3";
  return (
    <li className="border-t border-hairline first:border-t-0">
      {to ? <Link to={to} state={back} className={cn(row, "transition-colors hover:bg-pad")}>{body}</Link> : <div className={row}>{body}</div>}
    </li>
  );
}

/** One fact of the page: the term in muted text, the value at reading size. */
function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,10.5em)_minmax(0,1fr)] gap-3 border-t border-hairline py-2 first:border-t-0">
      <dt className="text-ui text-muted">{term}</dt>
      <dd className="text-read [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

const sentence = (text: string): string => (text ? `${text[0]!.toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}` : text);

/** How a link between this page and other material was established: a suggestion nobody reviewed, or a reviewed link. */
const LINK_STATE: Record<string, { words: string; glyph: "suggested" | "by_you" }> = {
  suggested: { words: `${RANGE_KIND_LABEL.suggestion}, not reviewed`, glyph: "suggested" },
  confirmed: { words: RANGE_KIND_LABEL.reviewed, glyph: "by_you" },
  rejected: { words: "Rejected", glyph: "suggested" },
};

export function SourcesPanel({ courseId, slide, others = [], lecture: lectureProp, page: pageProp, onPin }: SourcesPanelProps) {
  const location = useLocation();
  const workspace = useWorkspaceOrNull();
  const lecture = lectureProp ?? workspace?.lecture ?? null;
  const page = pageProp ?? workspace?.page ?? slide?.page ?? null;
  const back: Back = { returnTo: location.pathname + location.search, returnLabel: "Return to slide" };
  const [correcting, setCorrecting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const sourceHref = (sourceId: string, at?: number | null) => `/courses/${courseId}/sources/${encodeURIComponent(sourceId)}${at ? `?page=${at}` : ""}`;

  return (
    <div className="flex flex-col gap-6" data-testid="sources-tab">
      {lecture && (
        <section aria-labelledby="src-lecture">
          <h3 id="src-lecture" className={HEAD}>Sources of this lecture</h3>
          <ul className="ll-measure mt-1 flex flex-col">
            {lecture.deck ? (
              <SourceRow icon={<FileText />} title="Lecture slides" to={sourceHref(lecture.deck.source_id, page)} back={back}>
                <span data-testid="source-deck">
                  {lecture.page_count ? `${countLabel(lecture.page_count, "page")}. ` : ""}{lecture.deck.filename} · version {lecture.deck.version_id ?? "not yet identified"}
                  {lecture.display.kind === "rendition_pdf" ? " · shown as a static PDF rendition" : ""}{lecture.deck.registration === "unregistered" ? " · not registered by the course updater" : ""}
                  {lecture.deck_choice.basis === "this_request" ? " · shown by your choice on this device" : ""}
                </span>
              </SourceRow>
            ) : (
              <SourceRow icon={<FileText />} title="Lecture slides">{lecture.display.reason ?? "No slides file is shown for this lecture."}</SourceRow>
            )}
            {lecture.recordings.length === 0 && <SourceRow icon={<Mic />} title="Lecture recording">No recording is linked to this lecture.</SourceRow>}
            {lecture.recordings.map((recording) => (
              <SourceRow key={recording.source_id} icon={<Mic />} title={recordingLabel(lecture.recordings, recording.source_id)} to={sourceHref(recording.source_id)} back={back}>
                {recording.duration_ms ? `${durationLabel(recording.duration_ms)}. ` : ""}{recording.filename}{recording.version_id ? ` · version ${recording.version_id}` : ""}
              </SourceRow>
            ))}
            {lecture.transcripts.map((transcript) => (
              <SourceRow key={transcript.source_id} icon={<AlignLeft />} title="Course transcript" to={sourceHref(transcript.source_id)} back={back}>
                {countLabel(transcript.lines.length, "line")}. {transcript.timing === "annotated" ? "Original text; a line has a time where a link gives one." : "Original text, without times."} {transcript.filename}
              </SourceRow>
            ))}
            {lecture.timing && (
              <SourceRow icon={<Clock />} title="Speech timing">
                <span data-testid="source-timing">
                  {TIMING_STAGE_LABEL[lecture.timing.stage] ?? unlistedLabel(String(lecture.timing.stage))}.
                  {lecture.timing.recordings.map((recording) => <span key={recording.source_id}>{" "}{associationSentence(recording.association.state, lecture.timing?.summary)}</span>)}
                </span>
              </SourceRow>
            )}
          </ul>
        </section>
      )}

      {lecture && page !== null && <PageFacts lecture={lecture} page={page} slide={slide} onCorrect={lecture.source_map?.state === "ready" ? () => setCorrecting(true) : undefined} notice={notice} />}

      {lecture?.source_map && (lecture.source_map.limitations ?? []).length > 0 && (
        <section aria-labelledby="src-limits">
          <h3 id="src-limits" className={HEAD}>What the map cannot tell</h3>
          <ul className="ll-measure mt-1 flex list-disc flex-col gap-1 pl-5 text-ui text-muted">
            {(lecture.source_map.limitations ?? []).map((line, index) => <li key={index}>{line}</li>)}
          </ul>
        </section>
      )}

      <section aria-labelledby="src-material">
        <h3 id="src-material" className={HEAD}>Related material</h3>
        {slide ? <LinkedMaterial courseId={courseId} links={slide.related} back={back} onPin={onPin} /> : null}
        <OtherFiles courseId={courseId} others={others} back={back} />
        {(!slide || slide.related.length === 0) && others.length === 0 && <p className="ll-measure mt-1 text-ui text-muted">No reading, practice file or other file of the unit is linked to this page.</p>}
      </section>

      {lecture && page !== null && correcting && (
        <CorrectPageDialog courseId={courseId} lecture={lecture} page={page} onClose={() => setCorrecting(false)} onDone={(message) => { setCorrecting(false); setNotice(message); }} />
      )}
    </div>
  );
}

/** "This page": position, group, printed slide number, PowerPoint slide, role. Each line says how it was established; nothing stronger is said. */
function PageFacts({ lecture, page, slide, onCorrect, notice }: { lecture: LectureView; page: number; slide: SlideView | undefined; onCorrect?: () => void; notice: string | null }) {
  const identity = useMemo(() => identityOf(lecture, page), [lecture, page]);
  const map = lecture.source_map;
  const role = slide?.role ?? null;
  const printed = slide?.identity?.printed_slide_number ?? null;
  const pptx = slide?.identity?.pptx ?? null;
  const group = identity.position
    ? `${sentence(identity.position.kind === "copy" ? copyOfOneSlideLabel(identity.position) : positionLabel(identity.position)).replace(/\.$/, "")}, ${pagesRef(identity.groupPages)}.`
    : identity.known && !identity.groupingNote ? "A single page." : sentence(GROUPING_NOT_ESTABLISHED);
  // How the grouping came about (basis, state, signals), said under the fact; a page on its own has nothing to state.
  const grouped = identity.position && identity.grouping ? sentence(groupingLabel(identity.grouping)) : null;
  return (
    <section aria-labelledby="src-page" data-testid="page-facts">
      <h3 id="src-page" className={HEAD}>This page</h3>
      <dl className="ll-measure mt-1">
        <Fact term="Position"><span className="ll-num">{identity.parts[0]}</span>{identity.pageLabel && identity.pageLabel !== String(page) ? <span className="text-muted"> · {nb(`PDF label ${identity.pageLabel}`)}</span> : null}</Fact>
        <Fact term="Group">{group}{grouped ? <span className="block text-ui text-muted">{grouped}</span> : null}</Fact>
        <Fact term="Printed slide number">{printed ? `${printed.value}, ${printedBasisLabel(printed.basis)}` : "Not established"}</Fact>
        {map?.state === "ready" && map.pptx ? <Fact term="PowerPoint slide">{pptx ? `${pptx.ordinal}, ${pptxMatchLabel(pptx)}` : NO_PPTX_MATCH_LABEL}</Fact> : null}
        <Fact term="Role">
          {role ? <>{ROLE_LABEL[role.value] ?? unlistedLabel(String(role.value))}, {roleStateLabel(role)}.</> : "Not established"}
          {role && role.basis.length > 0 ? <span className="block text-ui text-muted">{role.basis.map((line) => unlistedLabel(line)).join(" · ")}</span> : null}
        </Fact>
      </dl>
      {map?.state === "unavailable" && <p className="ll-measure mt-2 text-ui text-muted">{sentence(SOURCE_MAP_UNAVAILABLE_LABEL[map.reason] ?? unlistedLabel(String(map.reason)))} Each page is identified by its position in the file only.</p>}
      {onCorrect && <p className="mt-2 text-ui"><button type="button" className="ll-link" onClick={onCorrect}>Correct the grouping or the role</button></p>}
      {notice && <p role="status" className="ll-measure mt-1 text-ui text-muted">{notice}</p>}
    </section>
  );
}

/** What is linked to this page: why, on what basis, how precisely, in which version; a suggestion is said to be one. */
function LinkedMaterial({ courseId, links, back, onPin }: { courseId: string; links: RelatedLink[]; back: Back; onPin: (source: SourceRef, label: string) => void }) {
  if (links.length === 0) return null;
  return (
    <section aria-label="Connected material" className="ll-measure mt-1">
      <h4 className="flex items-baseline justify-between gap-3 text-ui font-semibold text-muted"><span>Linked to this page</span>{" "}<span className="ll-num font-normal">{links.length}</span></h4>
      <ul className="flex flex-col">
        {links.map((link) => {
          const state = LINK_STATE[link.review_state] ?? { words: unlistedLabel(String(link.review_state)), glyph: "suggested" as const };
          const broad = link.precision === "broad_reference";
          const restricted = link.disclosure === "restricted_solution";
          const at = (link.to.locator as { page?: number }).page;
          return (
            <li key={link.annotation_id} className="flex flex-col gap-1 border-t border-hairline py-3 first:border-t-0">
              <p className="break-words text-read font-semibold">{link.filename ?? link.to.source_id} <span className="text-ui font-normal text-muted">· {kindLabel(link.kind)}</span></p>
              <BasisLabel basis={state.glyph}>{state.words}</BasisLabel>
              <p className="text-ui text-muted">
                Why linked: {link.relation === "practiced_by" ? "practises this slide's idea" : "explains this slide's idea"} · basis: {link.basis.replace(/_/g, " ")} ·{" "}
                {broad ? <strong className="font-semibold text-ink">chapter-level reference — no exact page has been reviewed</strong> : <>location: {locatorText(link.to)}</>} · version {link.to.version_id}
              </p>
              {restricted && <p className="text-ui text-muted">Answer material. It stays closed here and opens only by a deliberate reveal on its own page.</p>}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {link.available ? <Link className="ll-btn ll-btn-sm" to={`/courses/${courseId}/sources/${encodeURIComponent(link.to.source_id)}${at ? `?page=${at}` : ""}`} state={back}>Open</Link>
                  : <span className="text-ui text-muted">File not available</span>}
                <Button size="sm" variant="quiet" onClick={() => onPin(link.to, `${link.filename ?? "source"} · ${locatorText(link.to)}`)}>Pin to my question</Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function sizeText(n: number | null): string {
  if (n === null) return "size unknown";
  return n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** Further decks and notes kept in the same lecture unit. Listed so no file of the unit is unreachable; each opens as its original. */
function OtherFiles({ courseId, others, back }: { courseId: string; others: OtherMaterial[]; back: Back }) {
  if (others.length === 0) return null;
  return (
    <section aria-label="Other files in this lecture unit" className="ll-measure mt-3">
      <h4 className="flex items-baseline justify-between gap-3 text-ui font-semibold text-muted"><span>Other files of this lecture unit</span>{" "}<span className="ll-num font-normal">{others.length}</span></h4>
      <ul className="flex flex-col">
        {others.map((item) => {
          const state = SOURCE_STATE[item.state] ?? { label: item.state.replace(/_/g, " "), tone: "neutral" as const, detail: "" };
          return (
            <li key={item.source_id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-hairline py-3 first:border-t-0">
              <div className="grid min-w-0 grid-cols-[20px_minmax(0,1fr)] gap-3">
                <Paperclip aria-hidden className="mt-0.5 size-[18px] text-muted" />
                <div className="min-w-0">
                  <p className="break-words text-read font-semibold">{item.filename ?? item.source_id}</p>
                  <p className="text-ui text-muted">{item.role === "deck" ? "Slides or reading" : kindLabel(item.kind)} · {sizeText(item.bytes)}{item.registration === "unregistered" ? " · not registered by the course updater" : ""}{item.rendition === "needs_rendition" ? " · needs a PDF rendition to display here" : ""}</p>
                </div>
              </div>
              {item.available
                ? <Link className="ll-btn ll-btn-sm" to={`/courses/${courseId}/sources/${encodeURIComponent(item.source_id)}`} state={back}>Open</Link>
                : <span className="text-ui text-muted">{state.label}</span>}
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-ui text-muted">Slide-to-recording links exist for the unit's main slides only. Other PDF files are searchable by page and open as originals.</p>
    </section>
  );
}

// ---- correcting the grouping or the role of a page ---------------------------------------------------------------------
/** One correction of the grouping the learner can choose for the page on screen. */
export interface GroupingChoice {
  id: "split_before" | "split" | "group_before" | "group_after";
  label: string;
  request: Pick<Extract<SourceMapOverrideRequest, { op: "group" | "split" | "split_before" }>, "op" | "pages">;
}
/**
 * The corrections of the grouping that apply to a page: inside a group, start a new slide here or let every page of the
 * group stand alone; and join the page's slide with the slide before or after it. Only adjacent pages are ever joined,
 * and nothing is offered that the file cannot hold.
 */
export function groupingChoices(lecture: LectureView, page: number): GroupingChoice[] {
  const here = identityOf(lecture, page);
  if (here.outOfRange) return [];
  const group = here.groupPages.length ? here.groupPages : [page];
  const first = group[0]!;
  const last = group[group.length - 1]!;
  const choices: GroupingChoice[] = [];
  if (group.length > 1) {
    if (page !== first) choices.push({ id: "split_before", label: `${nb(`Page ${page}`)} starts a new slide`, request: { op: "split_before", pages: [page] } });
    choices.push({ id: "split", label: `Each of ${pagesRef(group)} is a slide of its own`, request: { op: "split", pages: [...group] } });
  }
  if (first > 1) {
    const joined = [...identityOf(lecture, first - 1).groupPages, ...group];
    choices.push({ id: "group_before", label: `${pagesRef(joined)} are one slide`, request: { op: "group", pages: joined } });
  }
  if (here.pageCount !== null && last < here.pageCount) {
    const joined = [...group, ...identityOf(lecture, last + 1).groupPages];
    choices.push({ id: "group_after", label: `${pagesRef(joined)} are one slide`, request: { op: "group", pages: joined } });
  }
  return choices;
}
const ROLE_ORDER: SlideRoleValue[] = ["instructional", "worked_example_or_question", "objectives_or_summary", "mixed", "unknown", "structural_title_or_section", "administrative", "blank"];

/** Records the learner's own correction of the grouping and of the role as new revisions of the source map; the file and every earlier revision stay. */
function CorrectPageDialog({ courseId, lecture, page, onClose, onDone }: { courseId: string; lecture: LectureView; page: number; onClose: () => void; onDone: (message: string) => void }) {
  const [params] = useSearchParams();
  const override = useSourceMapOverride(courseId, lecture.lecture_id, params.get("deck"));
  const choices = useMemo(() => groupingChoices(lecture, page), [lecture, page]);
  const current = lecture.slides.find((entry) => entry.page === page)?.role?.value ?? "unknown";
  const [grouping, setGrouping] = useState<string>("keep");
  const [role, setRole] = useState<SlideRoleValue>(current);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = choices.find((choice) => choice.id === grouping) ?? null;
  const nothing = !chosen && role === current;
  const identity = identityOf(lecture, page);

  const save = async () => {
    setBusy(true);
    setError(null);
    const why = reason.trim() || "Corrected by the learner in the Sources tab";
    try {
      if (chosen) await override.mutateAsync({ ...chosen.request, reason: why } as SourceMapOverrideRequest);
      if (role !== current) await override.mutateAsync({ op: "role", pages: [page], value: role, reason: why });
      onDone("Your correction was recorded as a new revision. Earlier revisions are kept, and views built on the old grouping are refreshed.");
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.detail : (failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const option = "flex cursor-pointer items-start gap-2 rounded-row px-2 py-1.5 text-ui hover:bg-pad";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title="Correct the grouping or the role" description={`${identity.label}. A correction is your own record on this PC: the file is not changed and every earlier revision is kept.`}
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={busy} disabled={nothing} onClick={() => void save()}>Record the correction</Button>
      </>}>
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col">
          <legend className="mb-1 text-ui font-semibold">Grouping</legend>
          <label className={option}><input type="radio" name="ll-grouping" className="mt-0.5 size-4 accent-[var(--ll-accent-text)]" checked={grouping === "keep"} onChange={() => setGrouping("keep")} /><span>Leave the grouping as it is</span></label>
          {choices.map((choice) => (
            <label key={choice.id} className={option}><input type="radio" name="ll-grouping" className="mt-0.5 size-4 accent-[var(--ll-accent-text)]" checked={grouping === choice.id} onChange={() => setGrouping(choice.id)} /><span>{choice.label}</span></label>
          ))}
        </fieldset>
        <fieldset className="flex flex-col">
          <legend className="mb-1 text-ui font-semibold">Role of this page</legend>
          <div className="grid gap-x-3 sm:grid-cols-2">
            {ROLE_ORDER.map((value) => (
              <label key={value} className={option}><input type="radio" name="ll-role" className="mt-0.5 size-4 accent-[var(--ll-accent-text)]" checked={role === value} onChange={() => setRole(value)} />
                <span>{ROLE_LABEL[value]}{value === current ? <span className="text-muted"> · as it is now</span> : null}</span></label>
            ))}
          </div>
        </fieldset>
        <Field label="Why (optional)" htmlFor="ll-correct-reason" hint="Kept with the revision.">
          <input id="ll-correct-reason" className="ll-input" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={400} />
        </Field>
        <p className="text-ui text-muted" id="ll-correct-note">{nothing ? "Choose a grouping or another role to record a correction." : "Recording refreshes the outline, the questions and the ranges of the pages it touches."}</p>
        {error && <Callout tone="danger" role="alert" title="The correction was not recorded">{error}</Callout>}
      </div>
    </Dialog>
  );
}

// ---- linking this slide to the recording by typed times ------------------------------------------------------------------
export interface NewMatchDraft {
  page: number;
  recordingName: string;
  recordingVersion: string;
  deckVersion: string;
  startMs: number;
  durationMs: number | null;
}

/** Create the first (or another) link between this slide and the recording, by typed times — no dragging. */
export function AddMatchDialog({ draft, onClose, onPreview, onSubmit }: { draft: NewMatchDraft | null; onClose: () => void; onPreview: (startMs: number) => void;
  onSubmit: (startMs: number, endMs: number) => Promise<void> }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState<NewMatchDraft | null>(null);
  if (draft && seeded !== draft) {
    setSeeded(draft);
    const from = Math.floor(draft.startMs / 1000);
    setStart(String(from));
    setEnd(String(draft.durationMs !== null ? Math.min(from + 60, Math.floor(draft.durationMs / 1000)) : from + 60));
    setError(null);
  }
  if (!draft) return null;
  const startMs = Math.round(Number(start) * 1000);
  const endMs = Math.round(Number(end) * 1000);
  const problem = !Number.isFinite(startMs) || !Number.isFinite(endMs) || start.trim() === "" || end.trim() === "" ? "Enter both times as seconds."
    : startMs < 0 ? "The start cannot be negative."
    : endMs <= startMs ? "The end must be after the start."
    : draft.durationMs !== null && endMs > draft.durationMs + 500 ? `The recording is ${formatMs(draft.durationMs)} long; the end is outside it.` : null;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title="Link this slide to the recording"
      description="Say which part of the recording belongs to this slide. It is saved as your own reviewed link; you can correct or reject it later, and every version is kept."
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={busy} disabled={!!problem} onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onSubmit(startMs, endMs);
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}>Save link</Button>
      </>}>
      <div className="flex flex-col gap-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ui">
          <dt className="text-muted">Page</dt><dd>{draft.page} · deck version {draft.deckVersion}</dd>
          <dt className="text-muted">Recording</dt><dd className="break-words">{draft.recordingName} · version {draft.recordingVersion}{draft.durationMs !== null ? ` · ${formatMs(draft.durationMs)} long` : ""}</dd>
        </dl>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start (seconds)" htmlFor="new-match-start"><input id="new-match-start" className="ll-input" inputMode="decimal" value={start} onChange={(e) => setStart(e.target.value)} aria-invalid={!!problem} aria-describedby="new-match-problem" /></Field>
          <Field label="End (seconds)" htmlFor="new-match-end"><input id="new-match-end" className="ll-input" inputMode="decimal" value={end} onChange={(e) => setEnd(e.target.value)} aria-invalid={!!problem} aria-describedby="new-match-problem" /></Field>
        </div>
        <p id="new-match-problem" role={problem ? "alert" : undefined} className={problem ? "text-ui font-semibold text-danger" : "text-ui text-muted"}>
          {problem ?? `Proposed: ${formatMs(startMs)}–${formatMs(endMs)}. The start is filled in from where the recording is now.`}
        </p>
        <div><Button size="sm" disabled={!!problem} onClick={() => onPreview(startMs)}>Preview from the start</Button></div>
        {error && <Callout tone="danger" role="alert" title="The link was not sent">{error}</Callout>}
      </div>
    </Dialog>
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
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ui">
          <dt className="text-muted">Current link</dt><dd>{formatMs(occurrence.start_ms)}–{formatMs(occurrence.end_ms)} · revision {occurrence.revision} · {(LINK_STATE[occurrence.review_state] ?? { words: unlistedLabel(String(occurrence.review_state)) }).words}</dd>
          <dt className="text-muted">Basis</dt><dd>{occurrence.basis.replace(/_/g, " ")}</dd>
          <dt className="text-muted">Recording</dt><dd>{recording?.filename ?? occurrence.source.source_id} · version {occurrence.source.version_id}{duration ? ` · ${formatMs(duration)} long` : ""}</dd>
          <dt className="text-muted">Slide deck version</dt><dd>{occurrence.record.from.version_id}</dd>
        </dl>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start (seconds)" htmlFor="match-start"><input id="match-start" className="ll-input" inputMode="decimal" value={start} onChange={(e) => setStart(e.target.value)} aria-invalid={!!problem} aria-describedby="match-problem" /></Field>
          <Field label="End (seconds)" htmlFor="match-end"><input id="match-end" className="ll-input" inputMode="decimal" value={end} onChange={(e) => setEnd(e.target.value)} aria-invalid={!!problem} aria-describedby="match-problem" /></Field>
        </div>
        <p id="match-problem" role={problem ? "alert" : undefined} className={problem ? "text-ui font-semibold text-danger" : "text-ui text-muted"}>
          {problem ?? `Proposed: ${formatMs(startMs)}–${formatMs(endMs)}. Preview plays it without saving.`}
        </p>
        <div><Button size="sm" disabled={!!problem} onClick={() => onPreview(startMs, endMs)}>Preview this range</Button></div>
        {error && <Callout tone="danger" role="alert" title="The correction was not sent">{error}</Callout>}
      </div>
    </Dialog>
  );
}
