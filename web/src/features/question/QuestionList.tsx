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
import { createContext, useContext, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Minus } from "lucide-react";
import { useApp } from "@/app/state";
import { BasisLabel, StateLabel } from "@/components/labels";
import { Button, EmptyState, ErrorState, LoadingState, PageHeader, StaleNotice, cn } from "@/components/ui";
import { ApiError } from "@/lib/api";
import {
  CATALOG_FIELD_LABEL, DECISION_NOTE, NARROWED_SENTENCE, NO_LINK_LINE, QUESTION_LIST_LABEL, R2_ACTION, TIE_SENTENCE, countLabel, nb, noLinkSentence, pageRef, pageRuns, pageSupportCount,
  pageSupportSentence, pagesRef, positionLabel, relatedSentence, sectionTieSentence, staleViewLine, suggestionCheckOf, supportSentence, transcriptLinesRef,
} from "@/lib/labels";
import { queryKeys, useCourse, useQuestionBank, useSuggestionDecision } from "@/lib/queries";
import { lectureQuestionCounts, whereLine, type IdentityView } from "@/lib/r2";
import type {
  CatalogField, EvidenceObject, LectureQuestionTie, LectureSuggestedTie, LectureView, LineRange, NoLink, QuestionAnchor, QuestionRow, RelatedQuestion, SectionTieDetail, SlidePosition,
  SlideQuestionTie, SlideSuggestedTie, SuggestionDecision, SuggestionHistory,
} from "@/lib/types";

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
}
const NavContext = createContext<QuestionNav>({});
/** Gives the entries under it the lecture they stand in. Without it an entry links to the lecture or the file by address. */
export const QuestionNavProvider = NavContext.Provider;
export const useQuestionNav = (): QuestionNav => useContext(NavContext);

const plainClick = (event: MouseEvent): boolean => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
const lectureHref = (courseId: string, lectureId: string, query: Record<string, string | number>): string =>
  `/courses/${courseId}/lectures/${lectureId}?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)])).toString()}`;

interface RefTarget { courseId: string; lectureId: string | null; sourceId: string | null; onDeck: boolean }

/** One page citation: a link that turns the slide (or opens the lecture or the file at that page), then its qualifier. The page on screen is bold text. */
function PageLink({ citation, target }: { citation: PageCitation; target: RefTarget }) {
  const nav = useQuestionNav();
  const qualifier = citation.qualifier ? <>{" "}<span className="ll-qualifier">{citation.qualifier}</span></> : null;
  if (citation.current) return <span className="whitespace-nowrap"><b className="ll-num font-semibold text-ink">{citation.label}</b>{qualifier}</span>;
  const here = target.onDeck && !!nav.onGoToPage && (target.lectureId === null || target.lectureId === (nav.lectureId ?? null));
  const className = "ll-link ll-num";
  let link: ReactNode;
  if (here) {
    link = <a className={className} href={`?page=${citation.page}`} title={`Turn the slide to page ${citation.page}`}
      onClick={(event) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        nav.onGoToPage!(citation.page);
      }}>{citation.label}</a>;
  } else if (target.onDeck && target.lectureId) link = <Link className={className} to={lectureHref(target.courseId, target.lectureId, { page: citation.page })}>{citation.label}</Link>;
  else if (target.sourceId) link = <Link className={className} to={`/courses/${target.courseId}/sources/${encodeURIComponent(target.sourceId)}?page=${citation.page}`}>{citation.label}</Link>;
  else link = <span className="ll-num">{citation.label}</span>;
  return <span className="whitespace-nowrap">{link}{qualifier}</span>;
}

/** Transcript lines as one citation: it opens the Transcript tab at those lines. Lines are never worded as pages. */
function LinesLink({ lines, target }: { lines: readonly LineRange[]; target: RefTarget }) {
  const nav = useQuestionNav();
  const label = transcriptLinesRef(lines);
  const first = lines[0];
  if (!label || !first) return null;
  const here = !!nav.onOpenLines && (target.lectureId === null || target.lectureId === (nav.lectureId ?? null));
  if (here) {
    return <a className="ll-link ll-num" href={`?panel=transcript&line=${first[0]}`} title="Open these lines in the transcript"
      onClick={(event) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        nav.onOpenLines!(first[0], first[1]);
      }}>{label}</a>;
  }
  if (target.lectureId) return <Link className="ll-link ll-num" to={lectureHref(target.courseId, target.lectureId, { panel: "transcript", line: first[0] })}>{label}</Link>;
  return <span className="ll-num">{label}</span>;
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
const BLOCK = "flex flex-col gap-1";
/** Under a basis label, aligned with its words (the glyph is 15 px and 6 px away). */
const UNDER = "pl-[21px]";

/** Accept and Reject on a suggested link without a decision; Take back on one the learner confirmed. The decision is the learner's own local record. */
function DecisionControls({ courseId, suggestionId, decision, about }: { courseId: string; suggestionId: string; decision: "confirmed" | "rejected" | null; about: string }) {
  const nav = useQuestionNav();
  const mutation = useSuggestionDecision(courseId);
  const [failure, setFailure] = useState<string | null>(null);
  const send = (next: SuggestionDecision) => {
    setFailure(null);
    mutation.mutate({ suggestionId, decision: next }, {
      onError: (error) => {
        // A decision made against an older list: the list says so and is read again; nothing was recorded.
        if (error instanceof ApiError && error.status === 409) nav.onConflict?.();
        else setFailure(error.message);
      },
    });
  };
  const sending = mutation.isPending ? mutation.variables?.decision : null;
  return (
    <div className={cn(UNDER, "flex flex-col gap-1")} data-testid="question-decision">
      {decision === null ? (
        <>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <Button size="xs" busy={sending === "confirmed"} disabled={mutation.isPending} aria-label={`${R2_ACTION.accept} the suggested link of ${about}`} onClick={() => send("confirmed")}>{R2_ACTION.accept}</Button>
            <Button size="xs" busy={sending === "rejected"} disabled={mutation.isPending} aria-label={`${R2_ACTION.reject} the suggested link of ${about}`} onClick={() => send("rejected")}>{R2_ACTION.reject}</Button>
          </div>
          <p className="text-ui text-muted">{DECISION_NOTE}</p>
        </>
      ) : (
        <div className="mt-0.5">
          <Button size="xs" busy={sending === "cleared"} disabled={mutation.isPending} aria-label={`${R2_ACTION.take_back} your decision on the suggested link of ${about}`} onClick={() => send("cleared")}>{R2_ACTION.take_back}</Button>
        </div>
      )}
      {failure && <p role="alert" className="text-ui text-muted"><span className="font-semibold text-ink">The decision was not recorded.</span> {failure}</p>}
    </div>
  );
}

type SuggestedTie = SlideSuggestedTie | LectureSuggestedTie;
/** What follows the support sentence of every suggested link: what the second pass did to it, and the producer's reason, verbatim. */
function SuggestionTail({ tie }: { tie: SuggestedTie }) {
  const check = suggestionCheckOf(tie);
  return (
    <>
      {tie.verdict === "narrowed" && <>{" "}{NARROWED_SENTENCE}</>}
      {check === "rejected_by_check" && tie.verdict_note ? <>{" "}{tie.verdict_note}</> : null}
      {tie.rationale ? <>{" "}Why: {tie.rationale}</> : null}
    </>
  );
}

/** A tie of the slide on screen (`slides[].question_ties`): one basis label, its sentence, and where its support is inside a group. */
export function SlideTieBasis({ courseId, tie, identity, about }: { courseId: string; tie: SlideQuestionTie; identity: Pick<IdentityView, "page" | "position" | "groupPages">; about: string }) {
  const where = whereLine(identity, tie);
  const whereNode = where ? <>{" "}<span className="text-ink" data-testid="question-tie">{sentenceCase(where)}.</span></> : null;
  if (tie.tie === "agent_inferred") {
    const here = pageSupportSentence(pageSupportCount(tie, identity.page), tie.criteria_total);
    return (
      <div className={BLOCK} data-testid="question-basis" data-tie="agent_inferred">
        <BasisLabel tie={tie} sentence={<>{supportSentence(tie)}{here ? <>{" "}<strong className="font-semibold text-ink">{here}</strong></> : null}<SuggestionTail tie={tie} />{whereNode}</>} />
        <DecisionControls courseId={courseId} suggestionId={tie.suggestion_id} decision={tie.learner_decision} about={about} />
      </div>
    );
  }
  // "Names this page" is said only when this page is among the pages the anchor names; otherwise the Brain's own sentence says which page it is.
  const named = tie.support_pages.includes(identity.page);
  const elsewhere = tie.why?.trim() || `${tie.tie === "exact" ? "A reviewed anchor of the course record names" : "The course record names"} ${pagesRef(tie.support_pages) || "another page of this sequence"}.`;
  return (
    <div className={BLOCK} data-testid="question-basis" data-tie={tie.tie}>
      <BasisLabel tie={tie} sentence={<>{named ? TIE_SENTENCE[tie.tie] : elsewhere}{tie.catalog_field === "page" ? <>{" "}{sentenceCase(CATALOG_FIELD_LABEL.page)}.</> : null}{whereNode}</>} />
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
      <BasisLabel tie={{ tie: courseRef.tie }} sentence={<>
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
      <BasisLabel tie={{ tie: "stated", granularity: "section" }} sentence={sectionTieSentence(section)} />
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
      <BasisLabel tie={tie} sentence={<>
        {pages.length === 0 ? support : counted ? <>{listedNodes(pages)} {single ? "supports" : "support"} {support.slice("Supports ".length)}</> : <>Names {listedNodes(pages)}. {support}</>}
        <SuggestionTail tie={tie} />
      </>} />
      <DecisionControls courseId={courseId} suggestionId={tie.suggestion_id} decision={tie.learner_decision} about={about} />
    </div>
  );
}

/** Concept-related: through which concept, and that it is not a claim about the slide. */
export function RelatedBasis({ via }: { via: RelatedQuestion["via_concepts"] | null | undefined }) {
  return (
    <div className={BLOCK} data-testid="question-basis" data-tie="concept_related">
      <BasisLabel tie={{ tie: "concept_related" }} sentence={relatedSentence(via)} />
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
      <span className="ll-basis">
        <Minus aria-hidden />
        <span className="min-w-0">
          <span className="ll-basis-strong">{NO_LINK_LINE[noLink.state]?.label ?? String(noLink.state).replace(/_/g, " ")}.</span>{" "}{sentenceCase(noLinkSentence(noLink))}
          {rejected.length > 0 && <>{" "}<button type="button" className="ll-link" aria-expanded={shown} aria-label={`${R2_ACTION.show_it}: the link you rejected for ${about}`} onClick={() => setShown((open) => !open)}>{R2_ACTION.show_it}</button></>}
        </span>
      </span>
      {shown && rejected.map((entry) => (
        <div key={entry.suggestion_id} className={cn(UNDER, "flex flex-col gap-1")} data-testid="rejected-suggestion">
          <p className="text-ui text-muted">
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
      {wording && <p className={cn("ll-measure text-read", !question.prompt_in_index && "text-muted")} data-testid="question-prompt">{wording}</p>}
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

/** The Sources line of an entry: the pages its ties name as citations, then its transcript lines. */
export function SourcesLine({ courseId, pages, lines, lectureId }: { courseId: string; pages: readonly number[]; lines: readonly LineRange[]; lectureId: string | null }) {
  const nav = useQuestionNav();
  const target: RefTarget = { courseId, lectureId, sourceId: null, onDeck: true };
  const cited = pageCitations(pages, { current: nav.page ?? null, positionOf: nav.positionOf });
  if (cited.length === 0 && lines.length === 0) return null;
  return (
    <p className="flex flex-wrap gap-x-4 text-ui leading-6" data-testid="question-sources">
      <span className="text-muted">Sources</span>{" "}
      {cited.map((citation) => <span key={citation.page}><PageLink citation={citation} target={target} />{" "}</span>)}
      {lines.length > 0 && <LinesLink lines={lines} target={target} />}
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
            <p className="text-ui text-muted">{lecture.questions.gap} Nothing was generated to fill the gap.</p>
          </div>
        ) : (
          <>
            <p className="ll-measure mb-1 text-ui text-muted" data-testid="lecture-questions-division">
              {counts.known
                ? `${countLabel(counts.all, "question")}: ${counts.courseAnchor} anchored by the course, ${counts.agentInferred} with a suggested link, ${counts.withoutLink} without a link.`
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
            <p className="ll-measure mt-1 text-ui text-muted">Not part of this lecture's collections. The course catalog relates each to one of this lecture's questions; a relation is context and grants no credit.</p>
            <QuestionEntries>
              {related.map((row) => (
                <QuestionListItem key={row.question_id} courseId={courseId} row={row} variant="list">
                  {(row.via ?? []).length > 0 && <p className="text-ui text-muted">{(row.via ?? []).map((v) => `${words(v.relation)} ${v.direction === "from_lecture_question" ? "of" : "for"} ${v.question_id}`).join(" · ")}</p>}
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
  return (
    <div className="ll-page" data-testid="question-bank">
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
                        {c.without_wording ? ` · ${c.without_wording} read in the original` : ""}{c.anchor_unresolved ? ` · ${c.anchor_unresolved} name no location` : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
          <form className="mb-2 flex flex-wrap items-center gap-2" role="search" onSubmit={(e) => { e.preventDefault(); set("q", text.trim()); }}>
            <input type="search" className="ll-input max-w-sm" placeholder="Search by id, title or wording" aria-label="Search questions" value={text} onChange={(e) => setText(e.target.value)} />
            <Button type="submit">Search</Button>
            <select className="ll-input w-auto" aria-label="Lecture" value={filter.lecture ?? ""} onChange={(e) => set("lecture", e.target.value)}>
              <option value="">Any lecture</option>
              {first.lectures.map((l) => <option key={l.lecture_id} value={l.lecture_id}>{l.title ?? l.lecture_id} ({l.count})</option>)}
            </select>
            <select className="ll-input w-auto" aria-label="Origin" value={filter.origin ?? ""} onChange={(e) => set("origin", e.target.value)}>
              <option value="">Any origin</option>
              <option value="course_source">From course material</option>
              <option value="generated_practice">Generated practice</option>
            </select>
            <select className="ll-input w-auto" aria-label="Slide reference" value={filter.anchor ?? ""} onChange={(e) => set("anchor", e.target.value)}>
              <option value="">Any slide reference</option>
              <option value="slide_named">Names a slide</option>
              <option value="no_slide">Names no slide</option>
              <option value="unresolved">No location in the record</option>
            </select>
            {filtered && <Button variant="quiet" onClick={() => { setText(""); setParams(new URLSearchParams(), { replace: true }); }}>Clear filters</Button>}
          </form>
          {conflict && <SuggestionsChangedNotice className="mb-2" onRefresh={() => { setConflict(false); void client.invalidateQueries({ queryKey: ["question-bank", courseId] }); void client.invalidateQueries({ queryKey: queryKeys.lecture(courseId).slice(0, 2) }); }} />}
          {lectureRow?.gap && (
            <div className="ll-measure mb-2 flex flex-col gap-1" role="note">
              <p className="text-ui font-semibold">No question collection for this lecture</p>
              <p className="text-ui text-muted">{lectureRow.gap} Nothing was generated to fill the gap.</p>
            </div>
          )}
          {rows.length === 0 ? <EmptyState title="No question matches these filters">The catalog still holds {first.total}; clear a filter to see them.</EmptyState> : (
            <QuestionNavProvider value={nav}>
              <QuestionEntries className="max-w-[80ch]">{rows.map((row) => <QuestionListItem key={row.question_id} courseId={courseId} row={row} />)}</QuestionEntries>
            </QuestionNavProvider>
          )}
          <p className="mt-3 flex flex-wrap items-center gap-2 text-ui text-muted" data-testid="bank-count">
            Showing {rows.length} of {first.matching}{filtered ? ` matching (${first.total} in the catalog)` : ""}
            {bank.hasNextPage && <Button size="sm" busy={bank.isFetchingNextPage} onClick={() => void bank.fetchNextPage()}>Show more</Button>}
          </p>
          {first.guidance.errors.length > 0 && (
            <div className="ll-measure mt-3 flex flex-col gap-1" role="note">
              <p className="text-ui font-semibold">Some assessor guidance entries could not be matched</p>
              <p className="text-ui text-muted">
                {first.guidance.errors.length} entr{first.guidance.errors.length === 1 ? "y" : "ies"} in the course's guidance files {first.guidance.errors.length === 1 ? "is" : "are"} not used ({[...new Set(first.guidance.errors.map((e) => words(e.code)))].join(", ")}). Questions stay available; those answers are assessed without that guidance.
              </p>
            </div>
          )}
          <p className="ll-measure mt-3 text-ui text-muted">{first.note}</p>
        </>
      )}
    </div>
  );
}
