// Pure helpers over the R2 read shapes (./types; spelling in docs/engineering/r2-read-api.md). No React, no fetch, no
// storage: each takes a view the Brain sent and returns what a screen needs, without adding a fact. A view from an
// older Brain (no R2 field) gives empty results with `known: false`, never an invented identity, tie, range or state.
// Wording comes from ./labels (the UI contract's R2 section); the short references with non-breaking spaces are
// re-exported here so a screen has one import for both.
import { ApiError } from "./api";
import { GROUPING_NOT_ESTABLISHED, associationCauseLabel, countLabel, duplicateOfLabel, pdfLabelLabel, pdfPageLabel, positionLabel, pptxSlideLabel, printedSlideLabel, timeSpanLabel, whereLabel } from "./labels";
import type {
  AnchorTieKind, ConceptGraphEdge, ConceptGraphErrorCode, ConceptGraphNode, ConceptGraphView, GraphEdgeFamily, GraphNodeKind, LectureQuestionCountsBlock, LectureView, LogicalSlideGrouping,
  LogicalSlideKind, MsInterval, NoRange, NoRangeCandidate, QuestionRow, RelatedQuestion, RoleState, SlidePosition, SlideQuestionTie, SlideRoleValue, SlideSectionTie, SlideView, SourceMapReady,
  TieWhere, TimingRange,
} from "./types";

// The short references of ./labels, so a screen imports helpers and their wording from one module.
export { NBSP, clockLabel, countLabel, durationLabel, nb, pageRef, pageRuns, pagesRef, rangeOrdinalLabel, timeSpanLabel, transcriptLinesRef } from "./labels";
const listed = (items: readonly string[]): string => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

type View = LectureView | null | undefined;
const slideAt = (view: View, page: number): SlideView | null => view?.slides?.find((slide) => slide.page === page) ?? null;
const readyMap = (view: View): SourceMapReady | null => (view?.source_map?.state === "ready" ? view.source_map : null);
/** Roles of which nothing is forced: no prompt, no generated practice, no concept requirement, no missing-match warning. */
const NO_FORCED_REQUIREMENT: ReadonlySet<SlideRoleValue> = new Set<SlideRoleValue>(["structural_title_or_section", "administrative", "blank"]);
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// ---- slide identity ------------------------------------------------------------------------------------------------------
export interface IdentityView {
  page: number;
  pageCount: number | null;
  /** false when the Brain sent no identity for the page: the label is then the physical page alone. */
  known: boolean;
  /**
   * true when `page` cannot be a page of this file: it is not a whole number from 1, or it lies beyond the page count
   * the view states. Nothing is then worded as an identity ("PDF page 99 of 12" is never produced); the screen shows
   * its explained state with a way back. false also when no count is known: nothing is claimed either way.
   */
  outOfRange: boolean;
  /** The identity line: what is known, and nothing stronger. `parts` joined by " · ". */
  label: string;
  parts: string[];
  /** The page's place in its group; null for a single page. */
  position: SlidePosition | null;
  /** Member pages of the page's logical slide (the page alone when it is single or unknown). */
  groupPages: number[];
  logicalSlideId: string | null;
  logicalSlideKind: LogicalSlideKind | null;
  /** How the grouping was established (a generated grouping is a suggestion). */
  grouping: LogicalSlideGrouping | null;
  printedSlideNumber: number | null;
  pptxOrdinal: number | null;
  pageLabel: string | null;
  /** "grouping not established" for the details, when nothing is known about the page's grouping. */
  groupingNote: string | null;
  /** The Brain's own label, for comparison; screens show `label`. */
  brainLabel: string | null;
}

/**
 * What is known about one physical page, worded as the UI contract's identity line: "PDF page 23 of 91", with
 * "· build 2 of 3" in a build sequence, "· duplicate of page 23" for a page that repeats the page before it, "· Slide 17"
 * only for a number recorded on this page, "· Slide 17 (PowerPoint)" only for a recorded match. Without an identity
 * from the Brain: "PDF page N of M". For a page the file does not have: `outOfRange`, and no "of M".
 */
export function identityOf(view: View, page: number): IdentityView {
  const map = readyMap(view);
  const stated = map?.page_count ?? view?.page_count ?? (view?.slides?.length || null);
  const outOfRange = !Number.isInteger(page) || page < 1 || (stated !== null && page > stated);
  const identity = outOfRange ? null : slideAt(view, page)?.identity ?? null;
  const pageCount = identity?.page_count ?? stated;
  const parts = [pdfPageLabel(page, outOfRange ? null : pageCount)];
  if (!identity) {
    return { page, pageCount, known: false, outOfRange, label: parts.join(" · "), parts, position: null, groupPages: [page], logicalSlideId: null, logicalSlideKind: null, grouping: null,
      printedSlideNumber: null, pptxOrdinal: null, pageLabel: null, groupingNote: GROUPING_NOT_ESTABLISHED, brainLabel: null };
  }
  const logical = map?.logical_slides.find((slide) => slide.id === identity.logical_slide_id) ?? null;
  const position = identity.position ?? null;
  const groupPages = logical?.pages.length ? [...logical.pages]
    : position ? Array.from({ length: position.of }, (_, index) => page - (position.ordinal - 1) + index) : [page];
  // The first of the repeats repeats nothing and is worded as a copy ("copy 1 of 2"); each later one repeats the page
  // before it (the contract's example: page 24 is a duplicate of page 23). Never "build".
  if (position?.kind === "copy" && position.ordinal > 1) parts.push(duplicateOfLabel(groupPages[position.ordinal - 2] ?? page - 1));
  else if (position) parts.push(positionLabel(position));
  const printed = identity.printed_slide_number?.value ?? null;
  const pptx = identity.pptx?.ordinal ?? null;
  if (printed !== null && pptx !== null) {
    if (printed === pptx) parts.push(printedSlideLabel(printed)); // both agree: said once
    else parts.push(printedSlideLabel(printed, true), pptxSlideLabel(pptx)); // both exist and differ: both, each named by its kind
  } else if (printed !== null) parts.push(printedSlideLabel(printed));
  else if (pptx !== null) parts.push(pptxSlideLabel(pptx));
  if (identity.page_label != null && identity.page_label !== "" && identity.page_label !== String(page)) parts.push(pdfLabelLabel(identity.page_label));
  // Nothing is known about the grouping when the page has no logical slide (no source map), and the Brain says so when
  // it kept a page on its own because grouping it with a neighbour was uncertain.
  const unsure = !identity.logical_slide_id || logical?.grouping?.confidence === "not_established";
  return { page, pageCount, known: true, outOfRange: false, label: parts.join(" · "), parts, position, groupPages, logicalSlideId: identity.logical_slide_id ?? null, logicalSlideKind: logical?.kind ?? null,
    grouping: logical?.grouping ?? null, printedSlideNumber: printed, pptxOrdinal: pptx, pageLabel: identity.page_label ?? null, groupingNote: unsure ? GROUPING_NOT_ESTABLISHED : null,
    brainLabel: identity.label ?? null };
}

/** True when nothing is forced on the page (its role is structural, administrative or blank). Unknown and objectives-or-summary pages are ordinary content. */
export function isStructuralPage(view: View, page: number): boolean {
  return slideAt(view, page)?.role?.forced_requirements === false;
}
/** The next page after `page` that is not structural ("Next content"), or null when there is none. */
export function nextContentPage(view: View, page: number): number | null {
  const pages = (view?.slides ?? []).map((slide) => slide.page).filter((candidate) => candidate > page).sort((a, b) => a - b);
  return pages.find((candidate) => !isStructuralPage(view, candidate)) ?? null;
}

// ---- outline rows --------------------------------------------------------------------------------------------------------
export interface LogicalSlideRow {
  id: string;
  kind: LogicalSlideKind;
  firstPage: number;
  pages: number[];
  title: string | null;
  role: SlideRoleValue;
  roleState: RoleState | null;
  /** A member page's role is uncertain. */
  roleUncertain: boolean;
  /** Nothing is forced on any page of the row. */
  structural: boolean;
  grouping: LogicalSlideGrouping | null;
  /** false for a row made from the page alone because no source map names it. */
  known: boolean;
  /** Each question and each range once per row, however many member pages carry it. Section ranges are counted apart. */
  counts: { questions: number; ranges: number; sectionRanges: number };
}

/** Rows for the lecture outline: one per logical slide, in page order, every physical page reachable exactly once. */
export function logicalSlides(view: View): LogicalSlideRow[] {
  if (!view) return [];
  const map = readyMap(view);
  const slides = new Map((view.slides ?? []).map((slide) => [slide.page, slide]));
  const row = (id: string, kind: LogicalSlideKind, pages: number[], title: string | null, logicalRole: SlideRoleValue | null, grouping: LogicalSlideGrouping | null, known: boolean): LogicalSlideRow => {
    const members = pages.map((page) => slides.get(page)).filter((slide): slide is SlideView => slide !== undefined);
    const roles = members.map((slide) => slide.role).filter((role) => role !== undefined);
    const role = logicalRole ?? roles[0]?.value ?? "unknown";
    const questions = new Set<string>();
    const ranges = new Set<string>();
    const sectionRanges = new Set<string>();
    for (const slide of members) {
      for (const tie of slide.question_ties ?? []) if ((tie as { granularity?: string }).granularity !== "section") questions.add(tie.question_id);
      for (const range of slide.ranges ?? []) (range.support?.scope === "section" ? sectionRanges : ranges).add(range.range_id);
    }
    return { id, kind, firstPage: pages[0] ?? 0, pages, title: title ?? members[0]?.title ?? null, role, roleState: roles[0]?.state ?? null, roleUncertain: roles.some((entry) => entry.uncertain),
      structural: roles.length ? roles.every((entry) => entry.forced_requirements === false) : NO_FORCED_REQUIREMENT.has(role), grouping, known,
      counts: { questions: questions.size, ranges: ranges.size, sectionRanges: sectionRanges.size } };
  };
  const rows: LogicalSlideRow[] = [];
  const covered = new Set<number>();
  for (const logical of map?.logical_slides ?? []) {
    const pages = [...new Set(logical.pages)].filter((page) => Number.isInteger(page) && !covered.has(page)).sort((a, b) => a - b);
    if (pages.length === 0) continue;
    for (const page of pages) covered.add(page);
    rows.push(row(logical.id, pages.length === 1 ? "single" : logical.kind, pages, logical.title, logical.role, logical.grouping, true));
  }
  const count = map?.page_count ?? view.page_count ?? 0;
  const every = new Set<number>([...slides.keys(), ...Array.from({ length: Math.max(0, count) }, (_, index) => index + 1)]);
  for (const page of every) if (!covered.has(page)) rows.push(row(`page-${page}`, "single", [page], null, null, null, false)); // never dropped, never grouped by guess
  return rows.sort((a, b) => a.firstPage - b.firstPage);
}

/**
 * What is wrong with the pages a ready source map lists, for a details line: pages named by more than one logical slide
 * (`logicalSlides` keeps each with the first slide that names it, so a later slide that only repeats pages has no row),
 * pages of the file no logical slide names (each is its own row), and pages the map names that the file does not have.
 * All empty for a valid map, and when no map came: nothing is claimed about a map that was not sent.
 */
export function sourceMapPageProblems(view: View): { repeated: number[]; missing: number[]; outside: number[] } {
  const map = readyMap(view);
  if (!map) return { repeated: [], missing: [], outside: [] };
  const count = map.page_count ?? view?.page_count ?? 0;
  const seen = new Set<number>();
  const repeated = new Set<number>();
  const outside = new Set<number>();
  for (const logical of map.logical_slides ?? []) {
    for (const page of new Set(logical.pages ?? [])) {
      if (!Number.isInteger(page) || page < 1 || (count > 0 && page > count)) outside.add(page);
      else if (seen.has(page)) repeated.add(page);
      else seen.add(page);
    }
  }
  const missing = Array.from({ length: Math.max(0, count) }, (_, index) => index + 1).filter((page) => !seen.has(page));
  const ascending = (pages: Iterable<number>): number[] => [...pages].sort((a, b) => a - b);
  return { repeated: ascending(repeated), missing, outside: ascending(outside) };
}

// ---- questions of a page -------------------------------------------------------------------------------------------------
export interface PageQuestions {
  page: number;
  /** false when the slide carries no R2 tie data (an older Brain, or a page the view does not hold). */
  known: boolean;
  /** false on a structural page: no This-slide list is forced; the lecture's questions stay available. */
  forced: boolean;
  /** Ties whose support is on this page (in a build group: "on this build"). */
  onThisSlide: SlideQuestionTie[];
  /** Ties whose support is on another page of this logical slide. */
  elsewhereInSequence: SlideQuestionTie[];
  /** Ties made for the whole group. */
  groupLevel: SlideQuestionTie[];
  /** The course's coarse statements about a range of pages: listed apart, never ties of this slide. */
  section: SlideSectionTie[];
  /** Concept-related questions: not a claim about this slide. */
  related: RelatedQuestion[];
  /** The This-slide list: one row per question, with all of its ties on this logical slide (the course's own first). */
  thisSlide: Array<{ question_id: string; ties: SlideQuestionTie[] }>;
  counts: {
    onThisSlide: number; elsewhereInSequence: number; groupLevel: number;
    /** onThisSlide + elsewhereInSequence + groupLevel. */
    ties: number;
    /** Rows of the This-slide list (questions, each once). */
    thisSlide: number;
    section: number;
    /** Rows listed under Related concepts. */
    related: number;
    /** The number before the Brain's cap; equals `related` when nothing was cut. */
    relatedTotal: number;
    /** Every question of the lecture's collections, with or without a slide. */
    allLecture: number;
  };
}

/** The questions of one page in the groups the Questions tab shows. A tie appears in exactly one group. */
export function questionsForPage(view: View, page: number): PageQuestions {
  const slide = slideAt(view, page);
  const onThisSlide: SlideQuestionTie[] = [];
  const elsewhereInSequence: SlideQuestionTie[] = [];
  const groupLevel: SlideQuestionTie[] = [];
  const section: SlideSectionTie[] = [...(slide?.section_ties ?? [])];
  const thisSlide: PageQuestions["thisSlide"] = [];
  for (const tie of slide?.question_ties ?? []) {
    if ((tie as { granularity?: string }).granularity === "section") {
      section.push(tie as unknown as SlideSectionTie); // a coarse tie stays coarse wherever the Brain listed it
      continue;
    }
    (tie.where === "group_level" ? groupLevel : tie.where === "elsewhere_in_sequence" ? elsewhereInSequence : onThisSlide).push(tie);
    const row = thisSlide.find((entry) => entry.question_id === tie.question_id);
    if (row) row.ties.push(tie);
    else thisSlide.push({ question_id: tie.question_id, ties: [tie] });
  }
  const related = [...(slide?.related_questions ?? [])];
  const ties = onThisSlide.length + elsewhereInSequence.length + groupLevel.length;
  return {
    page, known: slide?.question_ties !== undefined, forced: slide?.role?.forced_requirements !== false, onThisSlide, elsewhereInSequence, groupLevel, section, related, thisSlide,
    counts: { onThisSlide: onThisSlide.length, elsewhereInSequence: elsewhereInSequence.length, groupLevel: groupLevel.length, ties, thisSlide: thisSlide.length, section: section.length,
      related: related.length, relatedTotal: Math.max(related.length, slide?.related_questions_total ?? 0), allLecture: view?.questions?.all?.length ?? 0 },
  };
}

/** How the questions of a lecture divide (result of `lectureQuestionCounts`); the three parts add up to `all`. */
export interface LectureQuestionCounts {
  /** Rows of All lecture questions. courseAnchor + agentInferred + withoutLink = all. */
  all: number;
  /** Questions with an exact or stated anchor of the course record (a page, or transcript lines). */
  courseAnchor: number;
  /** Questions without a course anchor that have a suggested link. */
  agentInferred: number;
  /** Questions with neither: they carry one of the two no-link lines. */
  withoutLink: number;
  /** Questions the course's study map places in a section of pages. Counted apart; never a course anchor. */
  courseSection: number;
  /** A part of courseAnchor: questions the course anchors (to whatever file) that also carry a suggested link to pages. */
  anchoredWithSuggestion: number;
  /** false when the rows carry no R2 ties (an older Brain): the division then rests on the R1 anchors alone. */
  known: boolean;
  /** The Brain's own counts, when it sent them. */
  reported: LectureQuestionCountsBlock | null;
  /** Whether the rows listed agree with the Brain's counts; null when it sent none. */
  consistent: boolean | null;
}

/** How the lecture's questions divide, counted from the rows that are listed (so a count equals its rows). */
export function lectureQuestionCounts(view: View): LectureQuestionCounts {
  const rows: QuestionRow[] = view?.questions?.all ?? [];
  let courseAnchor = 0, agentInferred = 0, courseSection = 0, anchoredWithSuggestion = 0;
  for (const row of rows) {
    const ties = row.ties ?? [];
    const pageTies = ties.filter((tie) => tie.granularity !== "section");
    const suggested = pageTies.some((tie) => tie.tie === "agent_inferred");
    if (ties.some((tie) => tie.granularity === "section")) courseSection += 1;
    if (row.ties === undefined ? (row.anchors?.length ?? 0) > 0 : pageTies.some((tie) => tie.tie === "exact" || tie.tie === "stated")) {
      courseAnchor += 1;
      if (suggested) anchoredWithSuggestion += 1;
    } else if (suggested) agentInferred += 1;
  }
  const all = rows.length;
  const withoutLink = all - courseAnchor - agentInferred;
  const reported = view?.questions?.counts ?? null;
  const consistent = reported === null ? null
    : reported.all === all && reported.course_anchor === courseAnchor && reported.agent_inferred === agentInferred && reported.without_link === withoutLink
      && (reported.course_section === undefined || reported.course_section === courseSection)
      && (reported.course_anchor_with_suggestion === undefined || reported.course_anchor_with_suggestion === anchoredWithSuggestion);
  return { all, courseAnchor, agentInferred, withoutLink, courseSection, anchoredWithSuggestion, known: rows.some((row) => row.ties !== undefined), reported, consistent };
}

/**
 * How the lecture's questions divide, as one sentence. A question is counted once, by the strongest link it carries; the
 * anchored ones that ALSO carry a suggested link are named inside their clause, and the suggested-link clause then says
 * "only", so the list never reads "0 with a suggested link" above entries that offer Accept and Reject.
 */
export function questionDivisionSentence(counts: Pick<LectureQuestionCounts, "all" | "courseAnchor" | "agentInferred" | "withoutLink" | "anchoredWithSuggestion">): string {
  const also = counts.anchoredWithSuggestion;
  const anchored = `${counts.courseAnchor} anchored by the course${also > 0 ? ` (${also} of them also ${also === 1 ? "carries" : "carry"} a suggested link)` : ""}`;
  return `${counts.all} ${counts.all === 1 ? "question" : "questions"}: ${anchored}, ${counts.agentInferred} with a suggested link${also > 0 ? " only" : ""}, ${counts.withoutLink} without a link.`;
}

/** The positions (1-based) in a group of the pages that carry a support: [5] in [3, 4, 5] → [3]. A page outside the group has no place in it. */
export function supportOrdinals(supportPages: readonly number[], groupPages: readonly number[]): number[] {
  return [...new Set(supportPages.map((page) => groupPages.indexOf(page) + 1).filter((ordinal) => ordinal > 0))].sort((a, b) => a - b);
}
/**
 * Where a tie's (or a concept's) support is, in the contract's words, naming the build when it is elsewhere: "on this
 * build", "on this build and on build 1" (the tie names this page and others; needs `identity.page`), "elsewhere in
 * this sequence: build 3", "group-level: all 3 builds". Lower case, no full stop. null on a page that is not in a
 * group (labels.whereLabel with a null kind words a single page for the Concepts tab).
 */
export function whereLine(identity: Pick<IdentityView, "position" | "groupPages"> & { page?: number }, entry: { where: TieWhere | null; support_pages: readonly number[] }): string | null {
  if (!identity.position || !entry.where) return null;
  const { kind } = identity.position;
  if (entry.where === "group_level") return whereLabel("group_level", kind, [], identity.groupPages.length);
  if (entry.where === "elsewhere_in_sequence") return whereLabel("elsewhere_in_sequence", kind, supportOrdinals(entry.support_pages, identity.groupPages));
  const others = identity.page === undefined ? [] : supportOrdinals(entry.support_pages.filter((page) => page !== identity.page), identity.groupPages);
  return whereLabel("on_this_page", kind, others);
}

// ---- ranges of a page ----------------------------------------------------------------------------------------------------
export interface PageRanges {
  /** false when the slide carries no R2 range data (an older Brain, or a page the view does not hold). */
  known: boolean;
  /**
   * Every range the player can seek to for this page, in the Brain's order: links a person entered or confirmed first,
   * then the others by time. Separate visits stay separate. "Range i of k" is the position in this list
   * (`rangeOrdinalLabel(index + 1, ranges.length)`): `occurrence_index` numbers each of those two parts on its own.
   */
  ranges: TimingRange[];
  /** Ranges of this page or its build group. */
  pageRanges: TimingRange[];
  /** The course's own pairing of a section of pages with transcript lines: no time of this page alone. */
  sectionRanges: TimingRange[];
  /** Exactly one of six states when there is no range; null when a range exists, or when the Brain stated none. */
  noRange: NoRange | null;
  /** The range the transport shows first: the first range of the page itself, else the first section range, else none. */
  selectedDefault: TimingRange | null;
  /**
   * true when range data came for the page, it holds no range, and none of the six states came with it. That is not one
   * of the contract's lines and not an older Brain (`known` is then false): the screen says that no reason was stated,
   * and words nothing as "not discussed" or "not processed".
   */
  unexplained: boolean;
}

/** The ranges of one page and, when it has none, its one no-range state. Nothing is derived: a page the view does not hold gives `known: false`. */
export function rangesForPage(view: View, page: number): PageRanges {
  const slide = slideAt(view, page);
  const ranges = [...(slide?.ranges ?? [])];
  const pageRanges = ranges.filter((range) => range.support?.scope !== "section");
  const sectionRanges = ranges.filter((range) => range.support?.scope === "section");
  const known = slide?.ranges !== undefined;
  const noRange = ranges.length ? null : slide?.no_range ?? null;
  return { known, ranges, pageRanges, sectionRanges, noRange, selectedDefault: pageRanges[0] ?? sectionRanges[0] ?? null, unexplained: known && ranges.length === 0 && noRange === null };
}

/** [start, end) of an interval written as `[start_ms, end_ms]` or `{start_ms, end_ms}`; null for anything else or an empty interval. */
export function intervalBounds(value: unknown): MsInterval | null {
  const pair = Array.isArray(value) ? [value[0], value[1]] : value && typeof value === "object" ? [(value as { start_ms?: unknown }).start_ms, (value as { end_ms?: unknown }).end_ms] : null;
  if (!pair) return null;
  const [start, end] = pair;
  return typeof start === "number" && typeof end === "number" && Number.isFinite(start) && Number.isFinite(end) && start < end ? [start, end] : null;
}
/** What `noRangeDetail` reads from a no-range state's `detail`. */
export interface NoRangeDetailView {
  /** A recorded reason code: why the recording is unavailable (labels.recordingUnavailableReasonLabel words it), or what kept matching from running. */
  reason: string | null;
  /** Why slide matching has no result under the current inputs (labels.associationCauseLabel words it). */
  cause: string | null;
  /** The inputs that changed since matching ran. */
  differs: string[];
  /** The part of the recording that has timing ("only the stated part of it has"). */
  coveredIntervals: MsInterval[];
  /** The candidates of an ambiguous slide. */
  candidates: NoRangeCandidate[];
}
const INTERVAL_KEYS = ["processed", "covered_intervals", "processed_intervals", "processed_window", "window"] as const;
/** An interval as written in a no-range detail: `[start, end]`, `{start_ms, end_ms}` or `[recording source id, start, end]`. */
const detailInterval = (value: unknown): MsInterval | null =>
  (Array.isArray(value) && value.length === 3 && typeof value[0] === "string" ? intervalBounds([value[1], value[2]]) : intervalBounds(value));
/**
 * The reason, the processed part and the candidates of a no-range state. The API document says that `detail` carries
 * them and does not spell their keys; this is the one place that reads them. Anything malformed is left out, not repaired.
 */
export function noRangeDetail(noRange: NoRange | null | undefined): NoRangeDetailView {
  const detail = (noRange?.detail ?? {}) as Record<string, unknown>;
  const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);
  let coveredIntervals: MsInterval[] = [];
  for (const key of INTERVAL_KEYS) {
    const value = detail[key];
    const single = detailInterval(value);
    const list = single ? [single] : Array.isArray(value) ? value.map(detailInterval).filter((entry): entry is MsInterval => entry !== null) : [];
    if (list.length) {
      coveredIntervals = list;
      break;
    }
  }
  const candidates = Array.isArray(detail.candidates) ? detail.candidates.filter((entry): entry is NoRangeCandidate => !Array.isArray(entry) && intervalBounds(entry) !== null) : [];
  const differs = Array.isArray(detail.differs) ? detail.differs.filter((entry): entry is string => typeof entry === "string") : [];
  return { reason: text(detail.reason), cause: text(detail.cause), differs, coveredIntervals, candidates };
}
const NO_RANGE_ROLE_WORDS: Record<string, string> = { structural_title_or_section: "a title or section page", administrative: "an administrative page", blank: "a blank page" };
/**
 * The sentence of a no-range line (design spec 9.5): the Brain's own `text` verbatim when it sent one; otherwise one
 * sentence per state, built from the state's own detail (the processed part, the cause, the number of candidates, the
 * reason, the role) and from nothing else. The same sentence never serves two states.
 */
export function noRangeSentence(noRange: NoRange): string {
  if (typeof noRange.text === "string" && noRange.text.trim() !== "") return noRange.text;
  const detail = noRangeDetail(noRange);
  switch (noRange.state) {
    case "not_discussed":
      return "The whole recording was processed and matched, and no talk about this slide was found.";
    case "audio_unprocessed":
      if (detail.reason === "transcript_lines_without_time") return "The recording is transcribed, but some transcript lines could not be given a time; nothing for this slide was found among the lines that have one.";
      return detail.coveredIntervals.length
        ? `Only ${listed(detail.coveredIntervals.map(([start, end]) => timeSpanLabel(start, end)))} of this recording has speech timing, and nothing for this slide was found in that part.`
        : "This recording has no speech timing yet.";
    case "association_not_run": {
      const cause = detail.cause === "stale" ? "inputs_changed" : detail.cause;
      if (cause === "not_run") return "The recording has speech timing, but slide matching has not run on it yet.";
      if (cause === "inputs_changed") return "The recording has speech timing, but its inputs changed since slide matching ran.";
      if (cause === "no_adequate_method") return "The recording has speech timing, but no adequate matching method is available.";
      return `The recording has speech timing, but slide matching has not run on it with the current inputs${cause ? ` (${associationCauseLabel(cause)})` : ""}.`;
    }
    case "ambiguous":
      return `${detail.candidates.length ? countLabel(detail.candidates.length, "candidate") : "Several candidates"}, none good enough to show as the range.`;
    case "recording_unavailable":
      if (detail.reason === "recording_unreadable") return "The recording file cannot be read.";
      if (detail.reason === "no_session_linked" || detail.reason === "no_recording_in_session") return "No recording is linked to this lecture.";
      return "No recording exists or it cannot be read.";
    case "no_range_expected": {
      const role = (noRange.detail as { role?: unknown } | undefined)?.role;
      return `No recording range is expected for ${(typeof role === "string" && NO_RANGE_ROLE_WORDS[role]) || "this page"}, and none was found.`;
    }
    default: {
      const unhandled: never = noRange;
      return unhandled;
    }
  }
}

// ---- playing one range ---------------------------------------------------------------------------------------------------
/** A bounded part of a recording: integer milliseconds from the original source start, [start_ms, end_ms). */
export interface MsRange { start_ms: number; end_ms: number }
/** Media time in seconds as whole milliseconds. */
export const toMs = (seconds: number): number => (Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0);
/** True when `ms` lies in [start_ms, end_ms): the start belongs to the range, the end does not. */
export const withinRange = (range: MsRange, ms: number): boolean => ms >= range.start_ms && ms < range.end_ms;
/** Where playback of the range stops as seen from `currentMs`: its end until the end is reached, then null. null for the whole recording (no range). */
export const nextStop = (range: MsRange | null | undefined, currentMs: number): number | null => (range && currentMs < range.end_ms ? range.end_ms : null);
/** A position for a seek inside the range: [start_ms, end_ms] (the end itself is the stopped position). Without a range, any time from 0. */
export const clampToRange = (range: MsRange | null | undefined, ms: number): number => (range ? Math.min(Math.max(ms, range.start_ms), range.end_ms) : Math.max(0, ms));
/** What the one player does next while a range is selected (result of `stopAtEnd`). */
export type StopDecision = { action: "play" } | { action: "stop"; at_ms: number } | { action: "loop"; to_ms: number } | { action: "seek"; to_ms: number };
/**
 * What the one player does at a time update while a range is selected: play on inside it; at its end stop there, or
 * under Repeat go back to its start; before its start go to the start (what lies between two visits is never played).
 * `toleranceMs` lets a time update that lands just short of the end count as the end (the player's time updates come
 * a few times a second, so without it playback runs past the end by up to one update). What a tolerance takes off the
 * end is not played, under Repeat on every pass; it never counts for more than half the range, so a range shorter than
 * the tolerance still plays instead of stopping (or looping) at its very start. Without a range (Whole recording): play.
 */
export function stopAtEnd(range: MsRange | null | undefined, currentMs: number, options: { repeat?: boolean; toleranceMs?: number } = {}): StopDecision {
  if (!range) return { action: "play" };
  const asked = Number.isFinite(options.toleranceMs) ? Math.max(0, options.toleranceMs ?? 0) : 0;
  const tolerance = Math.min(asked, Math.floor(Math.max(0, range.end_ms - range.start_ms) / 2));
  if (currentMs >= range.end_ms - tolerance) return options.repeat ? { action: "loop", to_ms: range.start_ms } : { action: "stop", at_ms: range.end_ms };
  if (currentMs < range.start_ms - tolerance) return { action: "seek", to_ms: range.start_ms };
  return { action: "play" };
}

// ---- revisions -----------------------------------------------------------------------------------------------------------
const stable = (value: unknown): string => JSON.stringify(value ?? null, (_key, entry: unknown) => (entry && typeof entry === "object" && !Array.isArray(entry)
  ? Object.fromEntries(Object.entries(entry as Record<string, unknown>).sort(([a], [b]) => byText(a, b))) : entry));
/**
 * The revision keys that differ between what a view was built from and what holds now, sorted; [] means the view is
 * current. Without both sides nothing is claimed. labels.staleViewLine words the result.
 *
 * By default the two sides are two reads of ONE kind of view (the graph in hand and the same graph read again; a
 * lecture view and its refetch): every key of either side is compared, and a missing key is null.
 *
 * Two views of different kinds are built from partly different inputs (a concept graph states `scope_revision` and
 * `anchor_revision`, a lecture view `deck_sha256` and `timing_links`), so key by key every key only one of them has
 * would count as changed. To set a view beside another kind — the Concepts tab against the lecture view it is shown
 * with — pass `{ shared: true }`: only the revisions BOTH sides state are compared, and a key one side does not state
 * (absent or null) claims nothing.
 */
export function isStale(revisionsBuiltFrom: object | null | undefined, revisionsNow: object | null | undefined, options: { shared?: boolean } = {}): string[] {
  if (!revisionsBuiltFrom || !revisionsNow) return [];
  const built = revisionsBuiltFrom as Record<string, unknown>;
  const now = revisionsNow as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(built), ...Object.keys(now)])];
  const compared = options.shared ? keys.filter((key) => built[key] != null && now[key] != null) : keys;
  return compared.filter((key) => stable(built[key]) !== stable(now[key])).sort(byText);
}

// ---- concept graph -------------------------------------------------------------------------------------------------------
export type LayoutNodeKind = GraphNodeKind | "source_page";
/** One node of `graphLayoutInput`, ranked by kind for a layered layout. */
export interface LayoutNode {
  id: string;
  kind: LayoutNodeKind;
  label: string;
  /** One rank per kind, top to bottom: the page of a slide scope 0, topic 1, concept 2, skill 3, question 4, criterion 5. */
  rank: number;
  /** false for a node drawn although it lies outside the scope. */
  inScope: boolean;
  /** The node as the Brain sent it; null for the page of a slide scope, which is not a node of the model. */
  data: ConceptGraphNode | null;
}
/** One edge of `graphLayoutInput`: the recorded direction, and the same edge turned top-down for the layout. */
export interface LayoutEdge {
  id: string;
  /** Direction as recorded (drawn this way). */
  source: string;
  target: string;
  family: GraphEdgeFamily;
  relation: string;
  /** Source edges only: the kind of tie; a stated anchor and a suggested link stay two edges. */
  tie: AnchorTieKind | null;
  supportPages: number[] | null;
  /** The same edge from the rank above to the rank below, for a layered layout. */
  layoutSource: string;
  layoutTarget: string;
  /** false when both ends are of one kind (two questions, two concepts): leave it out of the ranking and draw it after layout. */
  ranks: boolean;
  data: ConceptGraphEdge;
}
/** What a layout engine is given (result of `graphLayoutInput`). */
export interface GraphLayoutInput {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  /** Slide scope: the page the source edges start at, taken from `scope` (it is not among `graph.nodes`). */
  sourcePage: { id: string; lectureId: string | null; page: number | null; pages: number[]; label: string } | null;
  /** Edges left out because one end is not drawn (cut by the limit). */
  droppedEdges: number;
}
const RANK: Record<LayoutNodeKind, number> = { source_page: 0, topic: 1, concept: 2, skill: 3, question: 4, criterion: 5 };
const FAMILY_ORDER: Record<GraphEdgeFamily, number> = { structure: 0, assessment: 1, source: 2 };

/**
 * Nodes and edges of a concept graph ready for a layout engine, in an order that does not depend on the order they
 * arrived in: nodes by kind, label and id; edges by family, relation and ends. In a slide scope the page is added as a
 * node of its own kind, because a source edge starts at the logical slide, which the model does not list as a node.
 */
export function graphLayoutInput(graph: ConceptGraphView | null | undefined): GraphLayoutInput {
  if (!graph) return { nodes: [], edges: [], sourcePage: null, droppedEdges: 0 };
  const scope = graph.scope;
  const sourcePage = scope?.kind === "slide"
    ? { id: scope.logical_slide_id ?? `slide:${scope.lecture_id}:${scope.page}`, lectureId: scope.lecture_id ?? null, page: scope.page ?? null, pages: [...(scope.pages ?? [])],
        label: scope.label ?? (scope.page != null ? pdfPageLabel(scope.page, null) : "This slide") }
    : null;
  const nodes: LayoutNode[] = (graph.nodes ?? []).map((node) => ({ id: node.id, kind: node.kind, label: node.label, rank: RANK[node.kind] ?? RANK.criterion, inScope: node.in_scope !== false, data: node }));
  const rankOf = new Map(nodes.map((node) => [node.id, node.rank]));
  const edges: LayoutEdge[] = [];
  let droppedEdges = 0;
  let pageDrawn = false;
  for (const edge of graph.edges ?? []) {
    const fromPage = edge.family === "source" && sourcePage !== null && !rankOf.has(edge.from);
    const source = fromPage ? sourcePage.id : edge.from;
    const sourceRank = fromPage ? RANK.source_page : rankOf.get(source);
    const targetRank = rankOf.get(edge.to);
    if (sourceRank === undefined || targetRank === undefined) {
      droppedEdges += 1;
      continue;
    }
    pageDrawn = pageDrawn || fromPage;
    const downward = sourceRank <= targetRank;
    edges.push({ id: edge.id, source, target: edge.to, family: edge.family, relation: edge.relation, tie: edge.tie ?? null, supportPages: edge.support_pages ?? null,
      layoutSource: downward ? source : edge.to, layoutTarget: downward ? edge.to : source, ranks: sourceRank !== targetRank, data: edge });
  }
  if (sourcePage && pageDrawn) nodes.push({ id: sourcePage.id, kind: "source_page", label: sourcePage.label, rank: RANK.source_page, inScope: true, data: null });
  nodes.sort((a, b) => a.rank - b.rank || byText(a.label.toLowerCase(), b.label.toLowerCase()) || byText(a.id, b.id));
  edges.sort((a, b) => FAMILY_ORDER[a.family] - FAMILY_ORDER[b.family] || byText(a.relation, b.relation) || byText(a.source, b.source) || byText(a.target, b.target)
    || byText(a.tie ?? "", b.tie ?? "") || byText(a.id, b.id));
  return { nodes, edges, sourcePage, droppedEdges };
}

/**
 * Why a concept-graph request failed, from the error the read layer throws: an unknown scope or focus (404, an
 * explained state with a way back), a malformed request (422), or null for anything else (unknown course, Brain not
 * reachable). The code of the documented error document decides when the answer carries one (`ApiError.code`, read
 * from `{error: {code, detail}}`; `ApiError.detail` is then the document's own detail). The Brain of today answers
 * `{detail: "Unknown scope" | "Unknown focus"}` without a code: that spelling is read from its text.
 */
export function conceptGraphErrorCode(error: unknown): ConceptGraphErrorCode | "malformed_request" | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 422) return "malformed_request";
  if (error.status !== 404) return null;
  if (error.code !== undefined) return error.code === "unknown_focus" || error.code === "unknown_scope" ? error.code : null;
  return /unknown focus/i.test(error.detail) ? "unknown_focus" : /unknown scope/i.test(error.detail) ? "unknown_scope" : null;
}
