// Question entries and lists (design specification 5.9, 9.6 – 9.8): the unboxed entry used by the lecture's Questions
// tab, by the concept detail and by the course question bank.
//
// An entry says, in this order: which question it is (collection and number, with the catalog's own title), its evidence
// state with what stands beside it, its wording at reading size, and what each of its links to the slides rests on. The
// four kinds of tie keep their own labels and are never rewritten into one another:
//
//   Exact / Stated                  the course's own anchors (a page, or transcript lines)
//   Stated for a part of the lecture  the course's study map places it in a range of pages and names no page
//   Suggested link                  agent work: what it supports, why, how far it was checked, and the learner's own
//                                   Accept / Reject / Take back (a local, versioned record that survives new suggestions)
//   Concept-related                 shares a concept with the slide; not a claim about the slide
//
// A question with none of them shows one of the two no-link lines with its recorded reason; "no slide named" alone is
// never written. Wording comes from lib/labels; nothing here derives a state from a count or a file name. Rows from a
// Brain that sends no R2 field fall back to the anchors of the course record and claim nothing more.
//
// Sizes (R2-V7): every SENTENCE of an entry is set at the reading size (the prompt, what a link rests on, its reason,
// the note under Accept and Reject); the interface size is kept for single labels (the question's name, the state
// word, "Sources") and for the buttons. A source of the Sources line is one press target that holds its whole label.
import { createContext, useContext, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Minus } from "lucide-react";
import { useApp } from "@/app/state";
import { BasisLabel, StateLabel } from "@/components/labels";
import { Button, EmptyState, ErrorState, LoadingState, PageHeader, StaleNotice, cn } from "@/components/ui";
import { ApiError } from "@/lib/api";
import {
  CATALOG_FIELD_LABEL, DECISION_NOTE, NARROWED_SENTENCE, NO_LINK_LINE, QUESTION_LIST_LABEL, R2_ACTION, TIE_SENTENCE, countLabel, criterionName, nb, noLinkSentence, pageRef, pageRuns, pageSupportCount,
  pageSupportSentence, pagesRef, positionLabel, relatedSentence, sectionTieSentence, staleViewLine, suggestionCheckOf, supportSentence, transcriptLinesRef,
} from "@/lib/labels";
import { queryKeys, useCourse, useQuestionBank, useSuggestionDecision } from "@/lib/queries";
import { lectureQuestionCounts, questionDivisionSentence, whereLine, type IdentityView } from "@/lib/r2";
import type {
  CatalogField, EvidenceObject, LectureQuestionTie, LectureSuggestedTie, LectureView, LineRange, NoLink, QuestionAnchor, QuestionRow, RelatedQuestion, SectionTieDetail, SlidePosition,
  SlideQuestionTie, SlideSuggestedTie, SuggestionDecision, SuggestionHistory, TieCriterion,
} from "@/lib/types";
import { Page, Picker } from "@/features/search/SearchOverlay";

const rangesText = (ranges: Array<[number, number]>) => ranges.map(([a, b]) => (a === b ? String(a) : `${a}–${b}`)).join(", ");

/** Where the catalog says a question points, in words, without claiming more than the catalog does (the question page's own line). */
export function anchorSummary(row: Pick<QuestionRow, "anchors" | "anchor_state" | "slide_anchor" | "locator_text">): { text: string; tone: "neutral" | "unassessed" | "caution" } {
  const slides = row.anchors.filter((a) => a.kind === "pages" && a.on_displayed_deck);
  const lines = row.anchors.filter((a) => a.kind === "transcript_lines");
  const pages = row.anchors.filter((a) => a.kind === "pages" && !slides.includes(a));
  const parts: string[] = [];
  if (slides.length) parts.push(`slides ${slides.map((a) => rangesText(a.ranges)).join(", ")}${slides.some((a) => a.basis === "stated") ? " (as stated; page numbers not yet confirmed)" : ""}`);
  if (pages.length) parts.push(`page ${pages.map((a) => rangesText(a.ranges)).join(", ")} of ${pages.some((a) => a.named_source) ? "the question sheet" : "its source file (not a slide of the deck)"}`);
  if (lines.length) parts.push(`transcript lines ${lines.map((a) => rangesText(a.ranges)).join(", ")}`);
  if (!parts.length) return { text: "No slide is named in the course record for this question.", tone: "unassessed" };
  return { text: `Course record: ${parts.join(" · ")}`, tone: slides.length ? "neutral" : "unassessed" };
}

// ---- pure parts: the name of a question, its one action, its citations ---------------------------------------------------
/** What an entry needs to name a question and show its wording. */
export interface EntryQuestion {
  question_id: string;
  collection: string | null;
  number: number | null;
  title: string | null;
  /** null or absent when the list does not carry the wording. */
  prompt?: string | null;
  /** false when the wording is kept in the question's original source. */
  prompt_in_index: boolean;
}

/**
 * How a question is named: its collection and number as the catalog writes them ("L05, question 1"), and the catalog's
 * own title when it has one. Nothing is expanded or guessed; a question without a collection is named by its identifier.
 */
export function questionName(question: Pick<EntryQuestion, "question_id" | "collection" | "number" | "title">): { place: string; title: string | null } {
  const collection = question.collection?.trim() || null;
  const place = collection ? (question.number != null ? nb(`${collection}, question ${question.number}`) : collection) : question.question_id;
  const title = question.title?.trim() || null;
  return { place, title: title && title !== question.question_id && title !== place ? title : null };
}
const nameText = (question: Pick<EntryQuestion, "question_id" | "collection" | "number" | "title">): string => {
  const { place, title } = questionName(question);
  return title ? `${place} · ${title}` : place;
};

/** One run of a prompt: plain, or the words between a pair of emphasis marks. */
export interface PromptPart { text: string; mark: "strong" | "em" | null }
// A pair of ** or * that hugs its words and stands at a word edge, as the course catalog writes a prompt's lead-in
// ("**Model one cell.** Find …"). An asterisk of a formula (2*x*y, a * b) and an unclosed mark are left as written.
const EMPHASIS = /(?<![\w*\\])(\*\*|\*)(?=[^\s*])([^*\n]*?[^\s*])\1(?![\w*])/g;
/**
 * A catalogued prompt as runs, its emphasis marks read instead of printed. Only `**strong**` and `*emphasis*` are read;
 * every other character of the wording is kept as recorded (no list, heading, link or underscore is interpreted).
 */
export function promptParts(text: string): PromptPart[] {
  const parts: PromptPart[] = [];
  let at = 0;
  for (const match of text.matchAll(EMPHASIS)) {
    const start = match.index ?? 0;
    if (start > at) parts.push({ text: text.slice(at, start), mark: null });
    parts.push({ text: match[2]!, mark: match[1] === "**" ? "strong" : "em" });
    at = start + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), mark: null });
  return parts;
}
/** The wording of a question with its emphasis drawn; the words themselves are the catalog's, unchanged. */
export function PromptText({ children }: { children: string }) {
  return (
    <>
      {promptParts(children).map((part, index) => (part.mark === "strong" ? <strong key={index}>{part.text}</strong> : part.mark === "em" ? <em key={index}>{part.text}</em> : <span key={index}>{part.text}</span>))}
    </>
  );
}

/** In place of the wording of a question whose wording is kept in its source (design spec 5.9). */
export const SOURCE_WORDING_SENTENCE = "The wording of this question is kept in its original source. Open the source to read it.";
/** The one button of an entry: "Answer" until an attempt is recorded, then "Answer again"; "Open the source question" when the wording is kept in the source. */
export function answerAction(question: Pick<EntryQuestion, "prompt_in_index">, evidence?: Pick<EvidenceObject, "attempts"> | null): string {
  if (!question.prompt_in_index) return "Open the source question";
  return evidence && evidence.attempts > 0 ? "Answer again" : "Answer";
}

/** One citation of the Sources line: a page or a run of pages, with what is said after it. */
export interface PageCitation {
  /** The first page of the run: where the link goes. */
  page: number;
  lastPage: number;
  /** "p. 22", "pp. 26–27" */
  label: string;
  /** "build 1 of 3", or "on screen" for the page on screen; null for a plain page. */
  qualifier: string | null;
  /** The page on screen: bold text, not a link. */
  current: boolean;
}
/** The qualifier of the page on screen. */
export const ON_SCREEN = nb("on screen");
/**
 * Pages as citations, in page order, each page once. A page of a group stands alone with its place in the group ("build
 * 1 of 3"); the page on screen stands alone as "on screen"; neighbouring plain pages are one run ("pp. 26–27").
 */
export function pageCitations(pages: readonly number[], options: { current?: number | null; positionOf?: (page: number) => SlidePosition | null } = {}): PageCitation[] {
  const sorted = [...new Set(pages.filter((page) => Number.isInteger(page)))].sort((a, b) => a - b);
  const cited: PageCitation[] = [];
  for (const page of sorted) {
    const current = options.current === page;
    const position = options.positionOf?.(page) ?? null;
    const last = cited[cited.length - 1];
    if (!current && !position && last && !last.current && last.qualifier === null && last.lastPage === page - 1) {
      last.lastPage = page;
      last.label = pagesRef(Array.from({ length: page - last.page + 1 }, (_, index) => last.page + index));
      continue;
    }
    cited.push({ page, lastPage: page, label: pageRef(page), qualifier: current ? ON_SCREEN : position ? positionLabel(position) : null, current });
  }
  return cited;
}

/** A course anchor as an entry words it: its kind, the pages and lines it names, and the file they are pages of. */
export interface CourseRef {
  tie: "exact" | "stated";
  pages: number[];
  lines: LineRange[];
  lectureId: string | null;
  sourceId: string | null;
  /** true when the pages are pages of the lecture's own deck. */
  onDeck: boolean;
  catalogField: CatalogField | null;
  /** Words for the file, when the pages are pages of another file and the course record says which kind. */
  fileWords: string | null;
}
const refOfTie = (tie: LectureQuestionTie): CourseRef => ({ tie: tie.tie === "exact" ? "exact" : "stated", pages: [...(tie.pages ?? [])], lines: [...(tie.transcript_lines ?? [])], lectureId: tie.lecture_id ?? null,
  sourceId: tie.source_id ?? null, onDeck: tie.on_displayed_deck !== false, catalogField: tie.catalog_field ?? null, fileWords: null });
/**
 * The course's own anchors of a row from a Brain that sends no tie data, read from the R1 anchors: one reference per
 * basis and file, with the transcript lines of that basis beside its first pages. Nothing is added to what the record names.
 */
export function courseRefsOfAnchors(anchors: readonly QuestionAnchor[]): CourseRef[] {
  const refs: CourseRef[] = [];
  for (const basis of ["exact", "stated"] as const) {
    const mine = anchors.filter((anchor) => anchor.basis === basis);
    const ofBasis: CourseRef[] = [];
    for (const anchor of mine.filter((entry) => entry.kind === "pages")) {
      const onDeck = anchor.on_displayed_deck === true;
      const pages = anchor.pages ?? anchor.ranges.flatMap(([first, last]) => Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index));
      const same = ofBasis.find((ref) => ref.sourceId === (anchor.source_id ?? null) && ref.onDeck === onDeck && ref.lectureId === (anchor.lecture_id ?? null));
      if (same) same.pages.push(...pages);
      else ofBasis.push({ tie: basis, pages: [...pages], lines: [], lectureId: anchor.lecture_id ?? null, sourceId: anchor.source_id ?? null, onDeck, catalogField: anchor.from === "page_field" ? "page" : null,
        fileWords: onDeck ? null : anchor.named_source ? "the question sheet" : "its source file, not a slide of the deck" });
    }
    const lines = mine.filter((entry) => entry.kind === "transcript_lines");
    if (lines.length) {
      const holder = ofBasis[0] ?? { tie: basis, pages: [], lines: [], lectureId: lines[0]!.lecture_id ?? null, sourceId: null, onDeck: false, catalogField: null, fileWords: null };
      holder.lines.push(...lines.flatMap((entry) => entry.ranges));
      if (!ofBasis.length) ofBasis.push(holder);
    }
    refs.push(...ofBasis);
  }
  return refs;
}

// ---- where a citation leads --------------------------------------------------------------------------------------------
/** What the list an entry stands in knows: the page on screen, how to turn to another, how to open transcript lines. */
export interface QuestionNav {
  /** The lecture whose deck is on screen; absent outside a lecture workspace. */
  lectureId?: string | null;
  /** The page on screen. */
  page?: number | null;
  /** Turns the slide to a page of the deck on screen (the draft and the recording stay as they are). */
  onGoToPage?: (page: number) => void;
  /** Opens the Transcript tab at these lines. */
  onOpenLines?: (start: number, end: number) => void;
  /** The place of a page in its group; null for a single page. */
  positionOf?: (page: number) => SlidePosition | null;
  /** The name of a file of the unit, for an anchor that names a page of another file than the deck. */
  fileName?: (sourceId: string) => string | null;
  /** The Brain refused a decision because the list is older than the suggestions (409). */
  onConflict?: () => void;
  /**
   * A decision on a suggested link was sent ("sent", at the press) or was not recorded ("failed"). The list uses it to
   * keep a line where a rejected link stood, since the link itself leaves the list with the next view.
   */
  onDecide?: (event: DecisionEvent) => void;
}
export interface DecisionEvent { suggestionId: string; decision: SuggestionDecision; outcome: "sent" | "failed" }
const NavContext = createContext<QuestionNav>({});
/** Gives the entries under it the lecture they stand in. Without it an entry links to the lecture or the file by address. */
export const QuestionNavProvider = NavContext.Provider;
export const useQuestionNav = (): QuestionNav => useContext(NavContext);

const plainClick = (event: MouseEvent): boolean => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
const lectureHref = (courseId: string, lectureId: string, query: Record<string, string | number>): string =>
  `/courses/${courseId}/lectures/${lectureId}?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)])).toString()}`;

interface RefTarget { courseId: string; lectureId: string | null; sourceId: string | null; onDeck: boolean }

// A source of the Sources line is one press target that holds its whole label ("p. 4  build 1 of 3"): the small text
// button of the sheet, 28 px high and 44 px to a finger, the page in the label's weight and what follows it in muted
// words. The page on screen is no link: it wears the selection idiom (tint, accent text, a 1.5 px ring) and says "on screen".
const SOURCE_BUTTON = "ll-btn ll-btn-xs ll-num gap-1.5 whitespace-nowrap font-normal";
const SOURCE_HERE = "ll-num inline-flex min-h-7 items-center gap-1.5 whitespace-nowrap rounded-row bg-tint px-2.5 py-0.5 text-ui shadow-[inset_0_0_0_1.5px_var(--ll-accent-text)]";
const SOURCE_PLAIN = "ll-num inline-flex min-h-7 items-center gap-1.5 whitespace-nowrap text-ui";

/**
 * One page citation: a link that turns the slide (or opens the lecture or the file at that page), then its qualifier.
 * In a sentence it is a text link and the page on screen is bold text; `as="source"` (the Sources line) makes it one
 * press target holding the qualifier too, and marks the page on screen instead.
 */
function PageLink({ citation, target, as = "text" }: { citation: PageCitation; target: RefTarget; as?: "text" | "source" }) {
  const nav = useQuestionNav();
  const source = as === "source";
  const qualifier = citation.qualifier ? <>{" "}<span className="ll-qualifier">{citation.qualifier}</span></> : null;
  if (citation.current) {
    return source ? <span className={SOURCE_HERE} aria-current="page"><b className="font-semibold text-accent-text">{citation.label}</b>{qualifier}</span>
      : <span className="whitespace-nowrap"><b className="ll-num font-semibold text-ink">{citation.label}</b>{qualifier}</span>;
  }
  const here = target.onDeck && !!nav.onGoToPage && (target.lectureId === null || target.lectureId === (nav.lectureId ?? null));
  const className = source ? SOURCE_BUTTON : "ll-link ll-num";
  const inside = source ? <><span className="font-semibold">{citation.label}</span>{qualifier}</> : citation.label;
  let link: ReactNode;
  if (here) {
    link = <a className={className} href={`?page=${citation.page}`} title={`Turn the slide to page ${citation.page}`}
      onClick={(event) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        nav.onGoToPage!(citation.page);
      }}>{inside}</a>;
  } else if (target.onDeck && target.lectureId) link = <Link className={className} to={lectureHref(target.courseId, target.lectureId, { page: citation.page })}>{inside}</Link>;
  else if (target.sourceId) link = <Link className={className} to={`/courses/${target.courseId}/sources/${encodeURIComponent(target.sourceId)}?page=${citation.page}`}>{inside}</Link>;
  else link = source ? <span className={SOURCE_PLAIN}>{inside}</span> : <span className="ll-num">{citation.label}</span>;
  return source ? link : <span className="whitespace-nowrap">{link}{qualifier}</span>;
}

/** Transcript lines as one citation: it opens the Transcript tab at those lines. Lines are never worded as pages. */
function LinesLink({ lines, target, as = "text" }: { lines: readonly LineRange[]; target: RefTarget; as?: "text" | "source" }) {
  const nav = useQuestionNav();
  const label = transcriptLinesRef(lines);
  const first = lines[0];
  if (!label || !first) return null;
  const source = as === "source";
  const className = source ? cn(SOURCE_BUTTON, "font-semibold") : "ll-link ll-num";
  const here = !!nav.onOpenLines && (target.lectureId === null || target.lectureId === (nav.lectureId ?? null));
  if (here) {
    return <a className={className} href={`?panel=transcript&line=${first[0]}`} title="Open these lines in the transcript"
      onClick={(event) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        nav.onOpenLines!(first[0], first[1]);
      }}>{label}</a>;
  }
  if (target.lectureId) return <Link className={className} to={lectureHref(target.courseId, target.lectureId, { panel: "transcript", line: first[0] })}>{label}</Link>;
  return <span className={source ? SOURCE_PLAIN : "ll-num"}>{label}</span>;
}

const listedNodes = (items: ReactNode[]): ReactNode[] => items.flatMap((item, index) => (index === 0 ? [item] : [index === items.length - 1 ? " and " : ", ", item]))
  .map((node, index) => <span key={index}>{node}</span>);

/** The pages and lines of an anchor inside a sentence: "p. 2 and transcript lines 120–164". Plain runs; no place in a group is said here. */
function refNodes(ref: Pick<CourseRef, "pages" | "lines">, target: RefTarget): ReactNode[] {
  const nodes: ReactNode[] = pageCitations(ref.pages).map((citation) => <PageLink key={`p${citation.page}`} citation={citation} target={target} />);
  if (ref.lines.length) nodes.push(<LinesLink key="lines" lines={ref.lines} target={target} />);
  return nodes;
}

// ---- the basis of a link ------------------------------------------------------------------------------------------------
const sentenceCase = (text: string): string => (text ? text[0]!.toUpperCase() + text.slice(1) : text);
const listedWords = (items: readonly string[]): string => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
const BLOCK = "flex flex-col gap-1";
/** Under a basis label, aligned with its words (the glyph is 15 px and 6 px away). */
const UNDER = "pl-[21px]";
/**
 * The measure of a sentence of a question entry. The sheet's 68ch lets a dense line of this face reach 85 characters
 * at the 18 px reading size (measured at 2560 px); 62ch keeps every rendered line under the 80 the contract allows (R2-V6).
 */
export const PROSE = "max-w-[62ch]";
/** A sentence of an entry: the reading size, in muted words, on the measure of prose. */
const SENTENCE = `${PROSE} text-read text-muted`;
/** A basis label whose words are a sentence: the label's own class sets the interface size, so the reading size and the glyph's place on the first line are set here. */
const BASIS = `${PROSE} text-read [&>svg]:mt-[calc((var(--ll-lh-read)-15px)/2)]`;

/** What a rejected link leaves in its place: "You rejected the suggested link pp. 5–6." */
export const rejectedSentence = (pages: readonly number[]): string => `You rejected the suggested link${pages.length ? ` ${pagesRef(pages)}` : ""}.`;

/** Sends a decision on one suggested link and tells the list it stands in; a 409 goes to the list, any other refusal is said beside the button. */
function useDecide(courseId: string, suggestionId: string) {
  const nav = useQuestionNav();
  const mutation = useSuggestionDecision(courseId);
  const [failure, setFailure] = useState<string | null>(null);
  const send = (next: SuggestionDecision) => {
    setFailure(null);
    nav.onDecide?.({ suggestionId, decision: next, outcome: "sent" });
    mutation.mutate({ suggestionId, decision: next }, {
      onError: (error) => {
        nav.onDecide?.({ suggestionId, decision: next, outcome: "failed" });
        // A decision made against an older list: the list says so and is read again; nothing was recorded.
        if (error instanceof ApiError && error.status === 409) nav.onConflict?.();
        else setFailure(error.message);
      },
    });
  };
  return { send, failure, pending: mutation.isPending, sending: mutation.isPending ? mutation.variables?.decision ?? null : null };
}
const NotRecorded = ({ failure }: { failure: string | null }) => (failure ? <p role="alert" className={SENTENCE}><span className="font-semibold text-ink">The decision was not recorded.</span> {failure}</p> : null);

/** Accept and Reject on a suggested link without a decision; Take back on one the learner confirmed. The decision is the learner's own local record. */
function DecisionControls({ courseId, suggestionId, decision, about }: { courseId: string; suggestionId: string; decision: "confirmed" | "rejected" | null; about: string }) {
  const { send, failure, pending, sending } = useDecide(courseId, suggestionId);
  return (
    <div className={cn(UNDER, "flex flex-col gap-1")} data-testid="question-decision">
      {decision === null ? (
        <>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <Button size="xs" busy={sending === "confirmed"} disabled={pending} aria-label={`${R2_ACTION.accept} the suggested link of ${about}`} onClick={() => send("confirmed")}>{R2_ACTION.accept}</Button>
            <Button size="xs" busy={sending === "rejected"} disabled={pending} aria-label={`${R2_ACTION.reject} the suggested link of ${about}`} onClick={() => send("rejected")}>{R2_ACTION.reject}</Button>
          </div>
          <p className={SENTENCE}>{DECISION_NOTE}</p>
        </>
      ) : (
        <div className="mt-0.5">
          <Button size="xs" busy={sending === "cleared"} disabled={pending} aria-label={`${R2_ACTION.take_back} your decision on the suggested link of ${about}`} onClick={() => send("cleared")}>{R2_ACTION.take_back}</Button>
        </div>
      )}
      <NotRecorded failure={failure} />
    </div>
  );
}

/**
 * What Reject leaves where the link stood, until the page changes: what was rejected and Take back beside it. The
 * rejected link is not a link any more (it stays in the history of the lecture's list); this line is only the way back.
 * `name` heads the line when the question itself left the list with its link.
 */
export function RejectedStub({ courseId, suggestionId, pages, about, name, as: Tag = "div", className }: {
  courseId: string; suggestionId: string; pages: readonly number[]; about: string; name?: ReactNode; as?: "li" | "div"; className?: string;
}) {
  const { send, failure, pending, sending } = useDecide(courseId, suggestionId);
  return (
    <Tag className={cn("flex flex-col gap-1", className)} data-testid="rejected-stub" data-suggestion-id={suggestionId}>
      {name ? <p className="min-w-0 text-ui font-semibold text-muted [overflow-wrap:anywhere]">{name}</p> : null}
      <p className={cn(SENTENCE, "flex flex-wrap items-center gap-x-3 gap-y-1")}>
        <span>{rejectedSentence(pages)}</span>
        <Button size="xs" busy={sending === "cleared"} disabled={pending} aria-label={`${R2_ACTION.take_back} your decision on the suggested link of ${about}`} onClick={() => send("cleared")}>{R2_ACTION.take_back}</Button>
      </p>
      <NotRecorded failure={failure} />
    </Tag>
  );
}

type SuggestedTie = SlideSuggestedTie | LectureSuggestedTie;
/** After the support sentence of a suggested link: what the second pass did to it, in its own words. */
function CheckNotes({ tie }: { tie: SuggestedTie }) {
  const check = suggestionCheckOf(tie);
  return (
    <>
      {tie.verdict === "narrowed" && <>{" "}{NARROWED_SENTENCE}</>}
      {check === "rejected_by_check" && tie.verdict_note ? <>{" "}{tie.verdict_note}</> : null}
    </>
  );
}
/** The producer's reason for a suggested link, verbatim, as a paragraph of its own under the support sentence. */
function Why({ tie }: { tie: SuggestedTie }) {
  return tie.rationale ? <p className={cn(UNDER, SENTENCE)} data-testid="question-rationale"><span className="text-ink">Why:</span> {tie.rationale}</p> : null;
}

/**
 * The criteria of a link that its producer placed on this page, by name; null when it made no page-by-page statement,
 * when what it placed here does not add up to the count shown, or when the page carries every criterion the link names
 * (they are named in the sentence before).
 */
function criteriaNamedHere(criteria: readonly TieCriterion[] | null | undefined, page: number, count: number | null): string | null {
  const all = criteria ?? [];
  const here = all.filter((criterion) => (criterion.pages ?? []).includes(page));
  return here.length > 0 && here.length === count && here.length < all.length ? listedWords(here.map(criterionName)) : null;
}

/** A tie of the slide on screen (`slides[].question_ties`): one basis label, its sentence, and where its support is inside a group. */
export function SlideTieBasis({ courseId, tie, identity, about }: { courseId: string; tie: SlideQuestionTie; identity: Pick<IdentityView, "page" | "position" | "groupPages">; about: string }) {
  const where = whereLine(identity, tie);
  const whereNode = where ? <>{" "}<span className="text-ink" data-testid="question-tie">{sentenceCase(where)}.</span></> : null;
  if (tie.tie === "agent_inferred") {
    const count = pageSupportCount(tie, identity.page);
    const supported = pageSupportSentence(count, tie.criteria_total);
    const named = supported ? criteriaNamedHere(tie.criteria, identity.page, count) : null;
    const here = supported && named ? `${supported.replace(/\.$/, "")}: ${named}.` : supported;
    return (
      <div className={BLOCK} data-testid="question-basis" data-tie="agent_inferred">
        <BasisLabel tie={tie} className={BASIS} sentence={<>{supportSentence(tie)}{here ? <>{" "}<strong className="font-semibold text-ink">{here}</strong></> : null}<CheckNotes tie={tie} />{whereNode}</>} />
        <Why tie={tie} />
        <DecisionControls courseId={courseId} suggestionId={tie.suggestion_id} decision={tie.learner_decision} about={about} />
      </div>
    );
  }
  // "Names this page" is said only when this page is among the pages the anchor names; otherwise the Brain's own sentence says which page it is.
  const named = tie.support_pages.includes(identity.page);
  const elsewhere = tie.why?.trim() || `${tie.tie === "exact" ? "A reviewed anchor of the course record names" : "The course record names"} ${pagesRef(tie.support_pages) || "another page of this sequence"}.`;
  return (
    <div className={BLOCK} data-testid="question-basis" data-tie={tie.tie}>
      <BasisLabel tie={tie} className={BASIS} sentence={<>{named ? TIE_SENTENCE[tie.tie] : elsewhere}{tie.catalog_field === "page" ? <>{" "}{sentenceCase(CATALOG_FIELD_LABEL.page)}.</> : null}{whereNode}</>} />
    </div>
  );
}

/** A course anchor in a list that is not about one slide: "Exact. A reviewed anchor of the course record names p. 2 and transcript lines 120–164." */
export function CourseRefBasis({ courseId, courseRef }: { courseId: string; courseRef: CourseRef }) {
  const nav = useQuestionNav();
  const target: RefTarget = { courseId, lectureId: courseRef.lectureId, sourceId: courseRef.sourceId, onDeck: courseRef.onDeck };
  const refs = refNodes(courseRef, target);
  const file = courseRef.onDeck || courseRef.pages.length === 0 ? null : (courseRef.sourceId && nav.fileName?.(courseRef.sourceId)) || courseRef.fileWords || "another file of this unit";
  const opening = courseRef.tie === "exact" ? "A reviewed anchor of the course record names" : "The course record names";
  return (
    <div className={BLOCK} data-testid="question-basis" data-tie={courseRef.tie}>
      <BasisLabel tie={{ tie: courseRef.tie }} className={BASIS} sentence={<>
        {refs.length ? <>{opening} {listedNodes(refs)}{file ? <> of <span className="break-words">{file}</span></> : null}.</> : TIE_SENTENCE[courseRef.tie]}
        {courseRef.tie === "stated" && courseRef.pages.length > 0 ? " Its page basis is not reviewed." : ""}
        {courseRef.catalogField === "page" ? <>{" "}{sentenceCase(CATALOG_FIELD_LABEL.page)}.</> : null}
      </>} />
    </div>
  );
}

/** A tie the course's study map states for a range of pages: listed apart from page ties and never drawn as a page anchor. */
export function SectionTieBasis({ section }: { section: SectionTieDetail | null | undefined }) {
  return (
    <div className={BLOCK} data-testid="question-basis" data-tie="section">
      <BasisLabel tie={{ tie: "stated", granularity: "section" }} className={BASIS} sentence={sectionTieSentence(section)} />
    </div>
  );
}

/** A suggested link in the lecture-wide list: "p. 40 supports 2 of 4 criteria: …", the pages as links. */
export function LectureSuggestedBasis({ courseId, tie, about }: { courseId: string; tie: LectureSuggestedTie; about: string }) {
  const target: RefTarget = { courseId, lectureId: tie.lecture_id ?? null, sourceId: tie.source_id ?? null, onDeck: tie.on_displayed_deck !== false };
  const pages = pageCitations(tie.pages ?? []).map((citation) => <PageLink key={citation.page} citation={citation} target={target} />);
  const single = pageRuns(tie.pages ?? []).length === 1 && (tie.pages ?? []).length === 1;
  const support = supportSentence(tie);
  const counted = tie.criteria_total > 0 && support.startsWith("Supports ");
  return (
    <div className={BLOCK} data-testid="question-basis" data-tie="agent_inferred">
      <BasisLabel tie={tie} className={BASIS} sentence={<>
        {pages.length === 0 ? support : counted ? <>{listedNodes(pages)} {single ? "supports" : "support"} {support.slice("Supports ".length)}</> : <>Names {listedNodes(pages)}. {support}</>}
        <CheckNotes tie={tie} />
      </>} />
      <Why tie={tie} />
      <DecisionControls courseId={courseId} suggestionId={tie.suggestion_id} decision={tie.learner_decision} about={about} />
    </div>
  );
}

/** Concept-related: through which concept, and that it is not a claim about the slide. */
export function RelatedBasis({ via }: { via: RelatedQuestion["via_concepts"] | null | undefined }) {
  return (
    <div className={BLOCK} data-testid="question-basis" data-tie="concept_related">
      <BasisLabel tie={{ tie: "concept_related" }} className={BASIS} sentence={relatedSentence(via)} />
    </div>
  );
}

/**
 * One of the two lines of a question without a link, with its recorded reason. A link the learner rejected is shown on
 * request ("Show it"), where the rejection can be taken back.
 */
export function NoLinkLine({ courseId, noLink, history, lectureId, about }: { courseId: string; noLink: NoLink; history?: SuggestionHistory | null; lectureId?: string | null; about: string }) {
  const [shown, setShown] = useState(false);
  const rejected = noLink.state === "no_suggestion" && noLink.reason === "rejected_by_learner" ? history?.rejected_by_learner ?? [] : [];
  return (
    <div className={BLOCK} data-testid="question-no-link" data-state={noLink.state}>
      <span className={cn("ll-basis", BASIS)}>
        <Minus aria-hidden />
        <span className="min-w-0">
          <span className="ll-basis-strong">{NO_LINK_LINE[noLink.state]?.label ?? String(noLink.state).replace(/_/g, " ")}.</span>{" "}{sentenceCase(noLinkSentence(noLink))}
          {rejected.length > 0 && <>{" "}<button type="button" className="ll-link" aria-expanded={shown} aria-label={`${R2_ACTION.show_it}: the link you rejected for ${about}`} onClick={() => setShown((open) => !open)}>{R2_ACTION.show_it}</button></>}
        </span>
      </span>
      {shown && rejected.map((entry) => (
        <div key={entry.suggestion_id} className={cn(UNDER, "flex flex-col gap-1")} data-testid="rejected-suggestion">
          <p className={SENTENCE}>
            The link you rejected{entry.pages.length ? <> named {listedNodes(pageCitations(entry.pages).map((citation) => <PageLink key={citation.page} citation={citation}
              target={{ courseId, lectureId: entry.lecture_id ?? lectureId ?? null, sourceId: entry.source_id, onDeck: true }} />))}</> : null}. It is not shown as a link.
          </p>
          <DecisionControls courseId={courseId} suggestionId={entry.suggestion_id} decision="rejected" about={about} />
        </div>
      ))}
    </div>
  );
}

// ---- the entry ----------------------------------------------------------------------------------------------------------
export interface QuestionEntryProps {
  courseId: string;
  question: EntryQuestion;
  /** The evidence object of the read API; absent when the list carries none (then no state is shown). */
  evidence?: EvidenceObject | null;
  /**
   * "slide": the full entry of the list of the slide on screen (Sources line, basis, Answer and the question bank).
   * "list": a compact row of Related concepts and of the lecture's list; its name opens the question.
   * "bank": a row of the question bank and of a concept's detail; Answer, and the way into its lecture.
   */
  variant?: "slide" | "list" | "bank";
  /** The Sources line of a "slide" entry. */
  sources?: ReactNode;
  /** The basis blocks and no-link line. */
  children?: ReactNode;
  /** Links after the Answer button of a "bank" entry. */
  links?: ReactNode;
}

/** One question, unboxed: a hairline above it, its name and state, its wording, what its links rest on, and its actions. */
export function QuestionEntry({ courseId, question, evidence, variant = "bank", sources, children, links }: QuestionEntryProps) {
  const { place, title } = questionName(question);
  const about = nameText(question);
  const compact = variant === "list";
  const href = `/courses/${courseId}/questions/${encodeURIComponent(question.question_id)}`;
  const location = useLocation();
  const returning = { returnTo: location.pathname + location.search, returnLabel: "Return" };
  const name = <><span>{place}</span>{title ? <> · <span>{title}</span></> : null}</>;
  const wording = question.prompt_in_index ? (question.prompt?.trim() ? question.prompt : null) : SOURCE_WORDING_SENTENCE;
  return (
    <li className={cn("flex flex-col border-t border-hairline first:border-t-0", compact ? "gap-1 py-3" : "gap-2 py-4")} data-testid="question-row" data-question-id={question.question_id} data-variant={variant}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="min-w-0 text-ui font-semibold text-muted [overflow-wrap:anywhere]" data-testid="question-name">
          {compact ? <Link className="ll-link" to={href} state={returning}>{name}</Link> : name}
        </p>
        {evidence ? <StateLabel evidence={evidence} /> : null}
      </div>
      {wording && <p className={cn(PROSE, "text-read", !question.prompt_in_index && "text-muted")} data-testid="question-prompt">{question.prompt_in_index ? <PromptText>{wording}</PromptText> : wording}</p>}
      {sources}
      {children}
      {!compact && (
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 text-ui" data-testid="question-actions">
          <Link className="ll-btn ll-btn-sm" to={href} state={returning} aria-label={`${answerAction(question, evidence)}: ${about}`}>{answerAction(question, evidence)}</Link>
          {variant === "slide" && <Link className="ll-link" to={`/courses/${courseId}/questions?q=${encodeURIComponent(question.question_id)}`} aria-label={`Open in the question bank: ${about}`}>Open in the question bank</Link>}
          {links}
        </div>
      )}
    </li>
  );
}

/**
 * The Sources line of an entry: the pages its ties name, then its transcript lines, each one press target with its
 * whole label inside; the page on screen is marked and is no link. On a touch screen the rows stand further apart, so
 * the 44 px press areas of two rows never meet.
 */
export function SourcesLine({ courseId, pages, lines, lectureId }: { courseId: string; pages: readonly number[]; lines: readonly LineRange[]; lectureId: string | null }) {
  const nav = useQuestionNav();
  const target: RefTarget = { courseId, lectureId, sourceId: null, onDeck: true };
  const cited = pageCitations(pages, { current: nav.page ?? null, positionOf: nav.positionOf });
  if (cited.length === 0 && lines.length === 0) return null;
  return (
    <p className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 text-ui" data-testid="question-sources">
      <span className="text-muted">Sources</span>{" "}
      <span className="flex flex-wrap items-center gap-x-2 gap-y-2 [@media(pointer:coarse)]:gap-y-4">
        {cited.map((citation) => <span key={citation.page} className="contents"><PageLink citation={citation} target={target} as="source" />{" "}</span>)}
        {lines.length > 0 && <LinesLink lines={lines} target={target} as="source" />}
      </span>
    </p>
  );
}

const linesKey = (lines: readonly LineRange[]): string => lines.map(([first, last]) => `${first}-${last}`).join(",");
/** Line ranges of several ties, each range once, in order. */
export function mergeLines(groups: ReadonlyArray<readonly LineRange[] | undefined>): LineRange[] {
  const seen = new Set<string>();
  const merged: LineRange[] = [];
  for (const lines of groups) for (const range of lines ?? []) {
    const key = linesKey([range]);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(range);
    }
  }
  return merged.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

interface QuestionListItemProps {
  courseId: string;
  row: QuestionRow;
  children?: ReactNode;
  variant?: "list" | "bank";
  /** Kept for callers of the earlier row; the list's own QuestionNavProvider is what turns the slide. */
  onGoToPage?: (page: number) => void;
  deckId?: string | null;
}

/**
 * A question row of the catalog (the lecture's list, the question bank, a concept's detail) as an entry: every tie it
 * carries with its own basis label, or its one no-link line. A row without tie data shows the anchors of the course
 * record and nothing else.
 */
export function QuestionListItem({ courseId, row, children, variant = "bank" }: QuestionListItemProps) {
  const nav = useQuestionNav();
  const about = nameText(row);
  const ties = row.ties;
  const refs = ties === undefined ? courseRefsOfAnchors(row.anchors ?? []) : [];
  const lectures = variant === "bank" && !nav.lectureId ? row.lecture_ids ?? [] : [];
  return (
    <QuestionEntry courseId={courseId} question={row} evidence={row.evidence ?? null} variant={variant}
      links={lectures.map((lectureId) => <Link key={lectureId} className="ll-link" to={lectureHref(courseId, lectureId, { panel: "questions" })}>Open in {lectureId.replace(/-/g, " ")}</Link>)}>
      {(ties ?? []).map((tie, index) => (tie.granularity === "section" ? <SectionTieBasis key={index} section={tie.section} />
        : tie.tie === "agent_inferred" ? <LectureSuggestedBasis key={index} courseId={courseId} tie={tie} about={about} />
          : <CourseRefBasis key={index} courseId={courseId} courseRef={refOfTie(tie)} />))}
      {refs.map((courseRef, index) => <CourseRefBasis key={`r${index}`} courseId={courseId} courseRef={courseRef} />)}
      {row.no_link ? <NoLinkLine courseId={courseId} noLink={row.no_link} history={row.suggestion_history} lectureId={nav.lectureId ?? row.lecture_ids?.[0] ?? null} about={about} /> : null}
      {children}
    </QuestionEntry>
  );
}

/** The list element of entries: no gaps of its own; each entry carries its hairline. */
export function QuestionEntries({ children, className, ...rest }: { children: ReactNode; className?: string; "data-testid"?: string; "aria-label"?: string }) {
  return <ul className={cn("ll-measure flex flex-col", className)} {...rest}>{children}</ul>;
}

/** The place of every page of a lecture in its group, for the citations of a list. */
export function positionsOf(lecture: Pick<LectureView, "slides">): (page: number) => SlidePosition | null {
  const positions = new Map(lecture.slides.map((slide) => [slide.page, slide.identity?.position ?? null]));
  return (page) => positions.get(page) ?? null;
}

const STEP = 20;
const words = (value: string): string => value.replace(/_/g, " ");
/** The value of a filter of the question bank that filters nothing (a picker's option cannot have an empty value). */
const ANY = "any";

/**
 * The lecture's own list: every question the catalog holds for the lecture, in catalog order, each with all its ties
 * or its no-link line; then, apart, the questions the catalog relates to one of them. It states how the questions divide.
 */
export function LectureQuestionsPanel({ courseId, lecture, onGoToPage }: { courseId: string; lecture: LectureView; onGoToPage?: (page: number) => void }) {
  const outer = useQuestionNav();
  const [shown, setShown] = useState(STEP);
  const [find, setFind] = useState("");
  const all = lecture.questions.all;
  const matching = useMemo(() => {
    const needle = find.trim().toLowerCase();
    return needle ? all.filter((q) => `${q.question_id} ${q.collection ?? ""} ${q.title ?? ""} ${q.prompt}`.toLowerCase().includes(needle)) : all;
  }, [all, find]);
  const related = lecture.questions.related_by_relationship;
  const counts = useMemo(() => lectureQuestionCounts(lecture), [lecture]);
  const nav = useMemo<QuestionNav>(() => ({ lectureId: lecture.lecture_id, onGoToPage, positionOf: positionsOf(lecture),
    fileName: (sourceId) => lecture.other_materials.find((item) => item.source_id === sourceId)?.filename ?? null, ...outer }), [lecture, onGoToPage, outer]);
  return (
    <QuestionNavProvider value={nav}>
      <div className="flex flex-col" data-testid="lecture-questions">
        {lecture.questions.gap ? (
          <div className="ll-measure flex flex-col gap-1 py-1" role="note">
            <p className="text-ui font-semibold">No question collection for this lecture</p>
            <p className={SENTENCE}>{lecture.questions.gap} Nothing was generated to fill the gap.</p>
          </div>
        ) : (
          <>
            <p className={cn(SENTENCE, "mb-1")} data-testid="lecture-questions-division">
              {counts.known
                ? questionDivisionSentence(counts)
                : `${lecture.questions.collections.map((c) => `${c.collection}: ${c.count}`).join(" · ")}. These belong to this lecture because the course catalog ties their collection to this unit's files.`}
            </p>
            {all.length > STEP && <input type="search" className="ll-input ll-measure mb-1 mt-1" placeholder="Find a question in this lecture" aria-label="Find a question in this lecture" value={find}
              onChange={(e) => { setFind(e.target.value); setShown(STEP); }} />}
            <QuestionEntries aria-label={QUESTION_LIST_LABEL.all_lecture}>
              {matching.slice(0, shown).map((row) => <QuestionListItem key={row.question_id} courseId={courseId} row={row} variant="list" />)}
            </QuestionEntries>
            {(matching.length > STEP || matching.length !== all.length) && (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-ui text-muted" data-testid="lecture-questions-count">
                Showing {Math.min(shown, matching.length)} of {matching.length}{matching.length !== all.length ? ` matching (${all.length} in this lecture)` : ""}
                {shown < matching.length && <Button size="sm" onClick={() => setShown((n) => n + STEP)}>Show {Math.min(STEP, matching.length - shown)} more</Button>}
              </p>
            )}
            {all.length > 0 && <p className="mt-2 text-ui"><Link className="ll-link" to={`/courses/${courseId}/questions?lecture=${encodeURIComponent(lecture.lecture_id)}`}>Open this lecture in the question bank</Link></p>}
          </>
        )}
        {related.length > 0 && (
          <section aria-labelledby="lq-related" className="mt-3 border-t border-hairline pt-3" data-testid="lecture-questions-related">
            <h4 id="lq-related" className="flex items-baseline justify-between gap-3 text-ui font-semibold text-muted"><span>Related through another question</span>{" "}<span className="ll-num font-normal">{related.length}</span></h4>
            <p className={cn(SENTENCE, "mt-1")}>Not part of this lecture's collections. The course catalog relates each to one of this lecture's questions; a relation is context and grants no credit.</p>
            <QuestionEntries>
              {related.map((row) => (
                <QuestionListItem key={row.question_id} courseId={courseId} row={row} variant="list">
                  {(row.via ?? []).length > 0 && <p className={SENTENCE}>{(row.via ?? []).map((v) => `${words(v.relation)} ${v.direction === "from_lecture_question" ? "of" : "for"} ${v.question_id}`).join(" · ")}</p>}
                </QuestionListItem>
              ))}
            </QuestionEntries>
          </section>
        )}
      </div>
    </QuestionNavProvider>
  );
}

/** The stale line of a question list whose suggested links changed under a decision (409), with Refresh. */
export function SuggestionsChangedNotice({ onRefresh, className }: { onRefresh: () => void; className?: string }) {
  return <StaleNotice className={className} onRefresh={onRefresh}>{staleViewLine(["inferred_anchors_sha256"], "list")}</StaleNotice>;
}

/** SC: course question bank. Every catalogued question, by collection, with real totals, search and filters. */
export function QuestionBankPage() {
  const { courseId = "" } = useParams();
  const app = useApp();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const course = useCourse(courseId);
  const filter = { collection: params.get("collection") ?? undefined, lecture: params.get("lecture") ?? undefined, q: params.get("q") ?? undefined, origin: params.get("origin") ?? undefined, anchor: params.get("anchor") ?? undefined };
  const bank = useQuestionBank(courseId, filter);
  const [text, setText] = useState(filter.q ?? "");
  const [conflict, setConflict] = useState(false);
  const nav = useMemo<QuestionNav>(() => ({ onConflict: () => setConflict(true) }), []);
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  if (bank.isLoading) return <LoadingState label="Loading questions…" />;
  if (bank.isError || !bank.data) return <ErrorState error={bank.error} retry={() => void bank.refetch()} />;
  const first = bank.data.pages[0]!;
  const rows = bank.data.pages.flatMap((p) => p.items);
  const filtered = Object.values(filter).some(Boolean);
  const lectureRow = filter.lecture ? first.lectures.find((l) => l.lecture_id === filter.lecture) : null;
  // A reading page of the page column (the kit's `Page`): its title starts where every other page's title starts, and
  // the title, the collections, the filters and the list share one measure, so the list no longer sits under a header
  // twice its width.
  return (
    <Page reading testId="question-bank">
      <PageHeader title="Question bank" subtitle={<span data-testid="bank-total">{first.total} question{first.total === 1 ? "" : "s"} in the course catalog{filtered ? ` · ${first.matching} match the filters` : ""}</span>}
        actions={<><Link className="ll-btn ll-btn-sm ll-btn-quiet" to={`/courses/${courseId}`}>{course.data?.display_name ?? courseId.toUpperCase()}</Link>
          <Link className="ll-btn ll-btn-sm" to="/review" onClick={() => app.setCourseId(courseId)}>Review</Link></>} />
      {first.total === 0 ? <EmptyState title="This course has no question catalog">Nothing is generated in its place. Slides, transcripts and the tutor remain available.</EmptyState> : (
        <>
          <section aria-label="Collections" className="mb-5">
            <ul className="grid gap-x-6 gap-y-1 [grid-template-columns:repeat(auto-fill,minmax(min(100%,19rem),1fr))]">
              {first.collections.map((c) => {
                const on = filter.collection === c.collection;
                return (
                  <li key={c.collection}>
                    <button type="button" aria-pressed={on} onClick={() => set("collection", on ? "" : c.collection)}
                      className={cn("flex w-full flex-col gap-0.5 rounded-control px-3 py-2 text-left transition-colors hover:bg-pad", on && "bg-tint shadow-[inset_0_0_0_1.5px_var(--ll-accent-text)] hover:bg-tint-strong")}>
                      <span className="flex items-baseline justify-between gap-2"><span className={cn("font-semibold", on && "text-accent-text")}>{c.collection}</span><span className="ll-num text-ui text-muted">{countLabel(c.count, "question")}</span></span>
                      <span className="text-ui text-muted">
                        {(c.lecture_ids ?? []).length ? (c.lecture_ids ?? []).map((l) => l.replace("-", " ")).join(", ") : "not tied to a lecture unit"}
                        {c.without_wording ? ` · ${c.without_wording} read in the original` : ""}{c.anchor_unresolved ? ` · ${c.anchor_unresolved} with no page or line named` : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
          {/* The search field with its button, then the three filters as the app's own pickers (never the browser's select). */}
          <form className="mb-3 flex flex-col gap-2" role="search" onSubmit={(e) => { e.preventDefault(); set("q", text.trim()); }}>
            <div className="flex items-center gap-2">
              <input type="search" className="ll-input min-w-0 flex-1" placeholder="Search by id, title or wording" aria-label="Search questions" value={text} onChange={(e) => setText(e.target.value)} />
              <Button type="submit">Search</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
              <Picker label="Lecture" testId="bank-filter-lecture" value={filter.lecture ?? ANY} onChange={(value) => set("lecture", value === ANY ? "" : value)}
                options={[{ value: ANY, label: "Any lecture" }, ...first.lectures.map((l) => ({ value: l.lecture_id, label: `${l.title ?? l.lecture_id} (${l.count})` }))]} />
              <Picker label="Origin" testId="bank-filter-origin" value={filter.origin ?? ANY} onChange={(value) => set("origin", value === ANY ? "" : value)}
                options={[{ value: ANY, label: "Any origin" }, { value: "course_source", label: "From course material" }, { value: "generated_practice", label: "Generated practice" }]} />
              <Picker label="Slide reference" testId="bank-filter-anchor" value={filter.anchor ?? ANY} onChange={(value) => set("anchor", value === ANY ? "" : value)}
                options={[{ value: ANY, label: "Any slide reference" }, { value: "slide_named", label: "Names a slide" }, { value: "no_slide", label: "Names no slide" }, { value: "unresolved", label: "No location in the record" }]} />
              {filtered && <Button variant="quiet" onClick={() => { setText(""); setParams(new URLSearchParams(), { replace: true }); }}>Clear filters</Button>}
            </div>
          </form>
          {conflict && <SuggestionsChangedNotice className="mb-2" onRefresh={() => { setConflict(false); void client.invalidateQueries({ queryKey: ["question-bank", courseId] }); void client.invalidateQueries({ queryKey: queryKeys.lecture(courseId).slice(0, 2) }); }} />}
          {lectureRow?.gap && (
            <div className="ll-measure mb-2 flex flex-col gap-1" role="note">
              <p className="text-ui font-semibold">No question collection for this lecture</p>
              <p className={SENTENCE}>{lectureRow.gap} Nothing was generated to fill the gap.</p>
            </div>
          )}
          {rows.length === 0 ? <EmptyState title="No question matches these filters">The catalog still holds {first.total}; clear a filter to see them.</EmptyState> : (
            <QuestionNavProvider value={nav}>
              <QuestionEntries className="max-w-none">{rows.map((row) => <QuestionListItem key={row.question_id} courseId={courseId} row={row} />)}</QuestionEntries>
            </QuestionNavProvider>
          )}
          <p className="mt-3 flex flex-wrap items-center gap-2 text-ui text-muted" data-testid="bank-count">
            Showing {rows.length} of {first.matching}{filtered ? ` matching (${first.total} in the catalog)` : ""}
            {bank.hasNextPage && <Button size="sm" busy={bank.isFetchingNextPage} onClick={() => void bank.fetchNextPage()}>Show more</Button>}
          </p>
          {first.guidance.errors.length > 0 && (
            <div className="ll-measure mt-3 flex flex-col gap-1" role="note">
              <p className="text-ui font-semibold">Some assessor guidance entries could not be matched</p>
              <p className={SENTENCE}>
                {first.guidance.errors.length} entr{first.guidance.errors.length === 1 ? "y" : "ies"} in the course's guidance files {first.guidance.errors.length === 1 ? "is" : "are"} not used ({[...new Set(first.guidance.errors.map((e) => words(e.code)))].join(", ")}). Questions stay available; those answers are assessed without that guidance.
              </p>
            </div>
          )}
          <p className={cn(SENTENCE, "mt-3")}>{first.note}</p>
        </>
      )}
    </Page>
  );
}
