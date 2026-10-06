// Amendment R2: the pure helpers of web/src/lib/r2.ts, the R2 hooks of web/src/lib/queries.ts and the invariants of the
// synthetic sample (web/src/lib/fixtures/r2-sample.ts). The Brain is a LABELED DOUBLE here (a stubbed fetch); no server
// is contacted. Shapes follow docs/engineering/r2-read-api.md; wording follows the UI contract's R2 section.
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiGet, r2Paths } from "@/lib/api";
import {
  invalidatedBy, queryKeys, useConceptGraph, useCourseTiming, useInferredAnchors, useServedIdentity, useSourceMap, useSourceMapOverride, useSuggestionDecision, useTimingBuild,
} from "@/lib/queries";
import {
  NBSP, clampToRange, clockLabel, conceptGraphErrorCode, durationLabel, graphLayoutInput, identityOf, intervalBounds, isStale, isStructuralPage, lectureQuestionCounts, logicalSlides, questionDivisionSentence,
  nextContentPage, nextStop, noRangeDetail, noRangeSentence, pageRef, pagesRef, questionsForPage, rangeOrdinalLabel, rangesForPage, sourceMapPageProblems, stopAtEnd, supportOrdinals, timeSpanLabel, toMs, whereLine,
  withinRange,
} from "@/lib/r2";
import {
  SAMPLE_COURSE_ID, SAMPLE_LECTURE_ID, SAMPLE_PAGE_COUNT, sampleConceptGraphCourse, sampleConceptGraphLecture, sampleConceptGraphSlide, sampleCourseTiming, sampleEvidence, sampleInferredAnchors,
  sampleInferredAnchorsEarlierCatalog, sampleLectureTiming, sampleLectureView, sampleLectureViewWithoutR2, sampleNoLinkReasons, sampleNoRange, sampleQuestionRowRejectedByLearner, sampleRangeBuildGroup,
  sampleRangeConfirmed, sampleRangeFirstVisit, sampleRangeManual, sampleRangeSecondVisit, sampleRangeSection, sampleRevisions, sampleRevisionsLater, sampleSourceMap, sampleSourceMapDocument,
  sampleSuggestionDecision, sampleTieKeptByConfirmation,
} from "@/lib/fixtures/r2-sample";
import type {
  ConceptGraphRevisions, ConceptGraphView, EvidenceState, InferredAnchorsReadback, LectureView, NoRange, NoRangeState, OutlineNodeView, OutlineView, RelatedQuestion, SlideCourseTie, SlideSuggestedTie,
  SlideView, SuggestionDecisionResponse, SuggestionVerdict, TieCriterion, TieKind, TimingRange, ViewRevisions,
} from "@/lib/types";

const PAGES = Array.from({ length: SAMPLE_PAGE_COUNT }, (_, index) => index + 1);
/**
 * An identity line as the screen holds it: each part is one fact and stays on one line (non-breaking spaces inside it),
 * and the line may break only at " · " (design specification 9.11). `id(id("PDF page 4 of 12 · build 2 of 3"))`.
 */
const id = (line: string): string => line.split(" · ").map((part) => part.replace(/ /g, NBSP)).join(" · ");
const slideOf =(view: LectureView, page: number): SlideView => view.slides.find((slide) => slide.page === page)!;
/** A copy of the sample with one slide changed. */
function withSlide(page: number, change: (slide: SlideView) => SlideView): LectureView {
  return { ...sampleLectureView, slides: sampleLectureView.slides.map((slide) => (slide.page === page ? change(slide) : slide)) };
}

afterEach(() => vi.unstubAllGlobals());

// ---- wording helpers with non-breaking spaces ----------------------------------------------------------------------------
describe("short references that must not break across lines", () => {
  it("writes a page, a run of pages and separate runs", () => {
    expect(pageRef(12)).toBe(`p.${NBSP}12`);
    expect(pagesRef([12])).toBe(`p.${NBSP}12`);
    expect(pagesRef([22, 23, 24])).toBe(`pp.${NBSP}22–24`);
    expect(pagesRef([24, 22, 23, 22])).toBe(`pp.${NBSP}22–24`); // order and repeats do not change what is named
    expect(pagesRef([7, 9, 10, 11, 12, 13, 14])).toBe(`pp.${NBSP}7, 9–14`);
    expect(pagesRef([4, 9])).toBe(`pp.${NBSP}4, 9`);
    expect(pagesRef([])).toBe("");
  });

  it("writes a length of time in hours, minutes and seconds, each number tied to its unit", () => {
    expect(durationLabel(4_800_000)).toBe(`1${NBSP}h${NBSP}20${NBSP}min`);
    expect(durationLabel(3_600_000)).toBe(`1${NBSP}h`);
    expect(durationLabel(164_000)).toBe(`2${NBSP}min${NBSP}44${NBSP}s`);
    expect(durationLabel(120_000)).toBe(`2${NBSP}min`);
    expect(durationLabel(55_000)).toBe(`55${NBSP}s`);
    expect(durationLabel(0)).toBe(`0${NBSP}s`);
    expect(durationLabel(sampleRangeFirstVisit.end_ms - sampleRangeFirstVisit.start_ms)).toBe(`2${NBSP}min${NBSP}44${NBSP}s`);
  });

  it("numbers a range among the ranges of its slide and writes its start and end", () => {
    expect(rangeOrdinalLabel(1, 2)).toBe(`Range${NBSP}1${NBSP}of${NBSP}2`);
    expect(clockLabel(1_072_000)).toBe("17:52");
    expect(clockLabel(4_100_000)).toBe("1:08:20");
    expect(timeSpanLabel(1_072_000, 1_236_000)).toBe(`17:52${NBSP}–${NBSP}20:36`);
  });
});

// ---- slide identity ------------------------------------------------------------------------------------------------------
describe("identityOf", () => {
  it("states the physical page, and a build position inside a build sequence", () => {
    expect(identityOf(sampleLectureView, 9).label).toBe(id("PDF page 9 of 12"));
    const build = identityOf(sampleLectureView, 4);
    expect(build.label).toBe(id("PDF page 4 of 12 · build 2 of 3"));
    expect(build.parts).toEqual([id("PDF page 4 of 12"), id("build 2 of 3")]);
    expect(build).toMatchObject({ known: true, page: 4, pageCount: 12, groupPages: [3, 4, 5], logicalSlideKind: "build_group", logicalSlideId: "ls-dddddddddd-p3-5", groupingNote: null });
    expect(identityOf(sampleLectureView, 6).label).toBe(id("PDF page 6 of 12 · step 1 of 2"));
  });

  it("adds a slide number only when one is recorded for this page, each named by its kind when two differ", () => {
    expect(identityOf(sampleLectureView, 2).label).toBe(id("PDF page 2 of 12 · Slide 2"));
    expect(identityOf(sampleLectureView, 8).label).toBe(id("PDF page 8 of 12 · Slide 5 (printed) · Slide 6 (PowerPoint)"));
    const same = withSlide(8, (slide) => ({ ...slide, identity: { ...slide.identity!, pptx: { ...slide.identity!.pptx!, ordinal: 5 } } }));
    expect(identityOf(same, 8).label).toBe(id("PDF page 8 of 12 · Slide 5"));
    const pptxOnly = withSlide(8, (slide) => ({ ...slide, identity: { ...slide.identity!, printed_slide_number: null } }));
    expect(identityOf(pptxOnly, 8).label).toBe(id("PDF page 8 of 12 · Slide 6 (PowerPoint)"));
    // the page index never becomes a slide number: no page of the sample without a recorded number shows one
    for (const page of PAGES.filter((p) => p !== 2 && p !== 8)) expect(identityOf(sampleLectureView, page).label).not.toMatch(/Slide \d/);
  });

  it("shows a PDF page label as a label, never as the index", () => {
    const first = identityOf(sampleLectureView, 1);
    expect(first.label).toBe(id("PDF page 1 of 12 · PDF label i"));
    expect(first.page).toBe(1);
    const sameAsIndex = withSlide(9, (slide) => ({ ...slide, identity: { ...slide.identity!, page_label: "9" } }));
    expect(identityOf(sameAsIndex, 9).label).toBe(id("PDF page 9 of 12"));
  });

  it("words a page that repeats its neighbour as a duplicate, never as a build", () => {
    const copies: LectureView = {
      ...sampleLectureView,
      source_map: { ...sampleSourceMap, logical_slides: [...sampleSourceMap.logical_slides.filter((slide) => !slide.pages.includes(9) && !slide.pages.includes(10)),
        { id: "ls-dddddddddd-p9-10", kind: "duplicate_group", pages: [9, 10], title: null, role: "instructional", grouping: { basis: "inferred", state: "generated", confidence: "high", signals: ["equal_bytes"] } }] },
      slides: sampleLectureView.slides.map((slide) => (slide.page === 9 || slide.page === 10
        ? { ...slide, identity: { ...slide.identity!, logical_slide_id: "ls-dddddddddd-p9-10", position: { ordinal: slide.page - 8, of: 2, kind: "copy" as const }, label: `PDF page ${slide.page} of 12 · copy ${slide.page - 8} of 2` } }
        : slide)),
    };
    expect(identityOf(copies, 10).label).toBe(id("PDF page 10 of 12 · duplicate of page 9"));
    expect(identityOf(copies, 9).label).toBe(id("PDF page 9 of 12 · copy 1 of 2")); // the first of the pair repeats nothing: it is a copy, not a duplicate of a page before it
    expect(identityOf(copies, 10).label).not.toMatch(/build|copy/);
  });

  it("names the page before it as what a third copy repeats, as the contract's example does", () => {
    const three: LectureView = {
      ...sampleLectureView,
      source_map: { ...sampleSourceMap, logical_slides: [...sampleSourceMap.logical_slides.filter((slide) => !slide.pages.some((page) => page >= 9 && page <= 11)),
        { id: "ls-dddddddddd-p9-11", kind: "duplicate_group", pages: [9, 10, 11], title: null, role: "instructional", grouping: { basis: "inferred", state: "generated", confidence: "high", signals: ["equal_bytes"] } }] },
      slides: sampleLectureView.slides.map((slide) => (slide.page >= 9 && slide.page <= 11
        ? { ...slide, identity: { ...slide.identity!, logical_slide_id: "ls-dddddddddd-p9-11", position: { ordinal: slide.page - 8, of: 3, kind: "copy" as const } } }
        : slide)),
    };
    expect([9, 10, 11].map((page) => identityOf(three, page).label)).toEqual([id("PDF page 9 of 12 · copy 1 of 3"), id("PDF page 10 of 12 · duplicate of page 9"), id("PDF page 11 of 12 · duplicate of page 10")]);
    expect(identityOf(three, 11).groupPages).toEqual([9, 10, 11]);
  });

  it("falls back to the page alone when the Brain sent no identity, and says that the grouping is not established", () => {
    const old = identityOf(sampleLectureViewWithoutR2, 4);
    expect(old).toMatchObject({ known: false, label: id("PDF page 4 of 12"), parts: [id("PDF page 4 of 12")], position: null, groupPages: [4], logicalSlideId: null, groupingNote: "grouping not established" });
    expect(identityOf({ ...sampleLectureViewWithoutR2, page_count: null, slides: [] }, 4).label).toBe(id("PDF page 4"));
    expect(identityOf(null, 7).label).toBe(id("PDF page 7"));
    expect(old.outOfRange).toBe(false);
  });

  it("does not word a page the file does not have as one of its pages", () => {
    // "PDF page 99 of 12" reads like an identity. A page beyond the count, page 0, a negative page and a fraction are
    // not pages of the file: the helper says so, and the screen shows its explained state with a way back.
    for (const page of [40, 99, 0, -3, 2.5, Number.NaN]) {
      const missing = identityOf(sampleLectureView, page);
      expect(missing).toMatchObject({ known: false, outOfRange: true, position: null, logicalSlideId: null });
      expect(missing.label).not.toMatch(/ of 12/);
      expect(identityOf(sampleLectureViewWithoutR2, page).outOfRange).toBe(true); // an older Brain states the count too
    }
    expect(identityOf(sampleLectureView, 99).label).toBe(id("PDF page 99"));
    for (const page of PAGES) expect(identityOf(sampleLectureView, page).outOfRange).toBe(false);
    expect(identityOf(null, 7).outOfRange).toBe(false); // no count is known: nothing is claimed either way
    expect(identityOf(null, 0).outOfRange).toBe(true); // no file has a page 0
  });

  it("reads the Brain's bare identity (no source map) as the page alone, with the grouping not established", () => {
    const bare = withSlide(4, (slide) => ({ ...slide, identity: { page_index: 4, page_count: 12, page_label: null, printed_slide_number: null, pptx: null, logical_slide_id: null, position: null,
      label: "PDF page 4 of 12", label_parts: ["PDF page 4 of 12"] }, role: { value: "unknown" as const, state: null, uncertain: true, forced_requirements: true, basis: ["No source map."] } }));
    expect(identityOf(bare, 4)).toMatchObject({ known: true, label: id("PDF page 4 of 12"), position: null, groupPages: [4], logicalSlideId: null, groupingNote: "grouping not established" });
    expect(isStructuralPage(bare, 4)).toBe(false); // an unknown role keeps the ordinary behaviour
    const countless = withSlide(4, (slide) => ({ ...slide, identity: { ...slide.identity!, page_count: null, logical_slide_id: null, position: null } }));
    expect(identityOf({ ...countless, page_count: null, source_map: { state: "unavailable", reason: "not_built" } }, 4).label).toBe(id("PDF page 4 of 12")); // the count of the pages the view lists
  });

  it("says so in the details when a page was kept on its own because its grouping was uncertain, and words a part of a corrected group", () => {
    const unsure: LectureView = { ...sampleLectureView, source_map: { ...sampleSourceMap, logical_slides: sampleSourceMap.logical_slides.map((slide) => (slide.pages[0] === 9
      ? { ...slide, grouping: { basis: "page", state: "generated", confidence: "not_established", signals: ["same_heading"] } } : slide)) } };
    expect(identityOf(unsure, 9)).toMatchObject({ label: id("PDF page 9 of 12"), groupingNote: "grouping not established" });
    expect(identityOf(sampleLectureView, 9).groupingNote).toBeNull();
    const joined = withSlide(9, (slide) => ({ ...slide, identity: { ...slide.identity!, position: { ordinal: 1, of: 2, kind: "part" as const } } }));
    expect(identityOf(joined, 9).label).toBe(id("PDF page 9 of 12 · part 1 of 2"));
  });
});

describe("structural pages and Next content", () => {
  it("treats only structural, administrative and blank pages as structural; unknown and summary pages are ordinary content", () => {
    expect(PAGES.filter((page) => isStructuralPage(sampleLectureView, page))).toEqual([1, 12]);
    expect(isStructuralPage(sampleLectureView, 11)).toBe(false); // unknown role
    expect(isStructuralPage(sampleLectureView, 10)).toBe(false); // objectives or summary
    expect(isStructuralPage(sampleLectureViewWithoutR2, 1)).toBe(false); // no role was sent: nothing is assumed structural
  });

  it("jumps to the next page that is not structural, and offers nothing when there is none", () => {
    expect(nextContentPage(sampleLectureView, 1)).toBe(2);
    expect(nextContentPage(sampleLectureView, 5)).toBe(6);
    expect(nextContentPage(sampleLectureView, 11)).toBeNull(); // only the administrative page follows
    expect(nextContentPage(sampleLectureView, 12)).toBeNull();
    const titleInTheMiddle = withSlide(6, (slide) => ({ ...slide, role: { ...slide.role!, value: "structural_title_or_section", forced_requirements: false } }));
    expect(nextContentPage(titleInTheMiddle, 5)).toBe(7);
    expect(nextContentPage(sampleLectureViewWithoutR2, 1)).toBe(2);
    expect(nextContentPage(null, 1)).toBeNull();
  });
});

// ---- outline rows --------------------------------------------------------------------------------------------------------
describe("logicalSlides", () => {
  const rows = logicalSlides(sampleLectureView);

  it("gives one row per logical slide, in page order, every physical page reachable exactly once", () => {
    expect(rows.map((row) => [row.firstPage, row.kind, row.pages.length])).toEqual([[1, "single", 1], [2, "single", 1], [3, "build_group", 3], [6, "step_group", 2], [8, "single", 1], [9, "single", 1],
      [10, "single", 1], [11, "single", 1], [12, "single", 1]]);
    expect(rows.flatMap((row) => row.pages)).toEqual(PAGES);
    expect(rows.every((row) => row.known)).toBe(true);
  });

  it("carries the role and whether nothing is forced on the row", () => {
    expect(rows.map((row) => row.role)).toEqual(["structural_title_or_section", "instructional", "instructional", "instructional", "worked_example_or_question", "instructional", "objectives_or_summary",
      "unknown", "administrative"]);
    expect(rows.filter((row) => row.structural).map((row) => row.firstPage)).toEqual([1, 12]);
    expect(rows.find((row) => row.firstPage === 11)).toMatchObject({ roleUncertain: true, structural: false }); // unknown is never treated as excluded
    expect(rows.find((row) => row.firstPage === 12)?.roleState).toBe("human_confirmed");
  });

  it("counts each question and each range of a group once, however many of its pages carry it", () => {
    const counts = Object.fromEntries(rows.map((row) => [row.firstPage, row.counts]));
    expect(counts[2]).toEqual({ questions: 1, ranges: 2, sectionRanges: 1 });
    expect(counts[3]).toEqual({ questions: 3, ranges: 1, sectionRanges: 1 }); // three pages list the same three questions and the same group range
    expect(counts[6]).toEqual({ questions: 0, ranges: 1, sectionRanges: 0 });
    expect(counts[8]).toEqual({ questions: 1, ranges: 0, sectionRanges: 0 });
    expect(counts[12]).toEqual({ questions: 0, ranges: 1, sectionRanges: 0 });
  });

  it("lists every page as its own row when no source map came, and invents no group", () => {
    const old = logicalSlides(sampleLectureViewWithoutR2);
    expect(old.map((row) => row.pages)).toEqual(PAGES.map((page) => [page]));
    expect(old.every((row) => row.kind === "single" && !row.known && row.role === "unknown" && !row.structural)).toBe(true);
    const unavailable = logicalSlides({ ...sampleLectureView, source_map: { state: "unavailable", reason: "not_built" } });
    expect(unavailable).toHaveLength(SAMPLE_PAGE_COUNT);
    expect(unavailable[3]).toMatchObject({ firstPage: 4, kind: "single", role: "instructional" }); // the page's own role is still used
    expect(logicalSlides(null)).toEqual([]);
  });

  it("keeps a page the map forgot as its own row instead of dropping it", () => {
    const short = { ...sampleLectureView, source_map: { ...sampleSourceMap, logical_slides: sampleSourceMap.logical_slides.filter((slide) => !slide.pages.includes(9)) } };
    expect(logicalSlides(short).flatMap((row) => row.pages)).toEqual(PAGES);
    expect(sourceMapPageProblems(short)).toEqual({ repeated: [], missing: [9], outside: [] });
  });

  it("says which pages a map lists twice, not at all or beyond the file, while the rows still hold every page once", () => {
    expect(sourceMapPageProblems(sampleLectureView)).toEqual({ repeated: [], missing: [], outside: [] });
    const overlapping: LectureView = { ...sampleLectureView, source_map: { ...sampleSourceMap, logical_slides: [...sampleSourceMap.logical_slides,
      { id: "ls-dddddddddd-p4-5", kind: "build_group", pages: [4, 5], title: null, role: "instructional", grouping: { basis: "inferred", state: "generated", confidence: "low", signals: [] } },
      { id: "ls-dddddddddd-p13", kind: "single", pages: [13], title: null, role: "unknown", grouping: { basis: "page", state: "generated", confidence: null, signals: [] } }] } };
    expect(sourceMapPageProblems(overlapping)).toEqual({ repeated: [4, 5], missing: [], outside: [13] });
    const rows = logicalSlides(overlapping);
    expect(rows.flatMap((row) => row.pages).filter((page) => page <= SAMPLE_PAGE_COUNT)).toEqual(PAGES); // the first slide that names a page keeps it
    expect(rows.some((row) => row.id === "ls-dddddddddd-p4-5")).toBe(false);
    // nothing is claimed about a map that did not come
    expect(sourceMapPageProblems(sampleLectureViewWithoutR2)).toEqual({ repeated: [], missing: [], outside: [] });
    expect(sourceMapPageProblems(null)).toEqual({ repeated: [], missing: [], outside: [] });
  });
});

// ---- questions of a page -------------------------------------------------------------------------------------------------
describe("questionsForPage", () => {
  it("puts every tie of a page in exactly one group, on every page of the sample", () => {
    for (const page of PAGES) {
      const result = questionsForPage(sampleLectureView, page);
      const grouped = [...result.onThisSlide, ...result.elsewhereInSequence, ...result.groupLevel];
      const ties = slideOf(sampleLectureView, page).question_ties ?? [];
      expect(grouped).toHaveLength(ties.length);
      expect(new Set(grouped).size).toBe(ties.length);
      for (const tie of ties) expect(grouped.filter((entry) => entry === tie)).toHaveLength(1);
      expect(result.counts.ties).toBe(result.counts.onThisSlide + result.counts.elsewhereInSequence + result.counts.groupLevel);
      expect(result.counts.thisSlide).toBe(result.thisSlide.length);
      expect(result.thisSlide.flatMap((row) => row.ties)).toHaveLength(ties.length);
      expect(result.counts.section).toBe(result.section.length);
      expect(result.counts.related).toBe(result.related.length);
      expect(result.counts.allLecture).toBe(8);
    }
  });

  it("says in a build group whether the support is on this build, elsewhere in the sequence or group-level", () => {
    const second = questionsForPage(sampleLectureView, 4);
    expect(second.groupLevel.map((tie) => tie.question_id)).toEqual(["S90-Q02"]);
    expect(second.onThisSlide.map((tie) => tie.question_id)).toEqual(["S90-Q04"]);
    expect(second.elsewhereInSequence.map((tie) => [tie.question_id, tie.support_pages])).toEqual([["S90-Q03", [5]]]);
    // what the last build adds is not presented as on the first one
    const first = questionsForPage(sampleLectureView, 3);
    expect(first.onThisSlide).toEqual([]);
    expect(first.elsewhereInSequence.map((tie) => tie.question_id)).toEqual(["S90-Q03", "S90-Q04"]);
    expect(questionsForPage(sampleLectureView, 5).onThisSlide.map((tie) => tie.question_id)).toEqual(["S90-Q03"]);
  });

  it("lists each question of the slide once, with all of its ties, and keeps section and related questions apart", () => {
    const page = questionsForPage(sampleLectureView, 2);
    expect(page.thisSlide.map((row) => [row.question_id, row.ties.map((tie) => tie.tie)])).toEqual([["S90-Q01", ["exact"]]]);
    expect(page.section.map((tie) => tie.question_id)).toEqual(["S90-Q01", "S90-Q02", "S90-Q05"]);
    expect(page.related.map((row) => row.question_id)).toEqual(["S90-Q03", "P90-Q01"]);
    expect(page.counts).toEqual({ onThisSlide: 1, elsewhereInSequence: 0, groupLevel: 0, ties: 1, thisSlide: 1, section: 3, related: 2, relatedTotal: 2, allLecture: 8 });
    // a section tie is never counted as a tie of this slide
    expect(page.thisSlide.some((row) => row.question_id === "S90-Q05")).toBe(false);
    const twice = withSlide(4, (slide) => ({ ...slide, question_ties: [...slide.question_ties!, { ...(slide.question_ties![0] as SlideCourseTie), tie: "exact" as const }] }));
    const merged = questionsForPage(twice, 4);
    expect(merged.counts.ties).toBe(4);
    expect(merged.counts.thisSlide).toBe(3);
    expect(merged.thisSlide.find((row) => row.question_id === "S90-Q02")?.ties).toHaveLength(2);
  });

  it("reports the uncapped number of related questions when the list was capped", () => {
    const capped = withSlide(2, (slide) => ({ ...slide, related_questions_total: 41 }));
    expect(questionsForPage(capped, 2).counts).toMatchObject({ related: 2, relatedTotal: 41 });
  });

  it("forces no list on a structural page and still offers the lecture's questions", () => {
    const title = questionsForPage(sampleLectureView, 1);
    expect(title).toMatchObject({ known: true, forced: false, thisSlide: [], section: [], related: [] });
    expect(title.counts.allLecture).toBe(8);
    expect(questionsForPage(sampleLectureView, 11).forced).toBe(true); // unknown role keeps the ordinary behaviour
    expect(questionsForPage(sampleLectureView, 10).forced).toBe(true); // so does objectives or summary
  });

  it("returns empty groups and says that nothing is known for an older Brain or an unknown page", () => {
    expect(questionsForPage(sampleLectureViewWithoutR2, 4)).toMatchObject({ known: false, forced: true, onThisSlide: [], elsewhereInSequence: [], groupLevel: [], section: [], related: [], thisSlide: [] });
    expect(questionsForPage(sampleLectureViewWithoutR2, 4).counts.allLecture).toBe(8);
    expect(questionsForPage(sampleLectureView, 99).known).toBe(false);
    expect(questionsForPage(undefined, 1).counts.allLecture).toBe(0);
  });
});

describe("lectureQuestionCounts", () => {
  it("divides the lecture's questions into course anchor, suggested link and no link, and the parts add up", () => {
    const counts = lectureQuestionCounts(sampleLectureView);
    expect(counts).toMatchObject({ all: 8, courseAnchor: 3, agentInferred: 3, withoutLink: 2, courseSection: 3, consistent: true });
    expect(counts.courseAnchor + counts.agentInferred + counts.withoutLink).toBe(counts.all);
    expect(counts.all).toBe(sampleLectureView.questions.all.length);
    expect(counts.reported).toEqual(sampleLectureView.questions.counts);
    // a question with only a section tie and a suggestion is a suggested-link question, not a course anchor
    const fifth = sampleLectureView.questions.all.find((row) => row.question_id === "S90-Q05")!;
    expect(fifth.ties!.map((tie) => [tie.tie, tie.granularity])).toEqual([["stated", "section"], ["agent_inferred", "page"]]);
    // without link = the rows that carry one of the two no-link lines
    expect(sampleLectureView.questions.all.filter((row) => row.no_link).length).toBe(counts.withoutLink);
  });

  it("counts an anchored question that also carries a suggested link as a part of the anchored ones, and the sentence says so", () => {
    // the plain case keeps its wording
    expect(questionDivisionSentence(lectureQuestionCounts(sampleLectureView))).toBe("8 questions: 3 anchored by the course, 3 with a suggested link, 2 without a link.");
    expect(lectureQuestionCounts(sampleLectureView).anchoredWithSuggestion).toBe(0);
    // the course anchors a question (to a question sheet, say) and a suggestion names slide pages for it
    const anchored = sampleLectureView.questions.all.find((row) => (row.ties ?? []).some((tie) => tie.tie === "exact" && tie.granularity !== "section"))!;
    const suggestion = sampleLectureView.questions.all.flatMap((row) => row.ties ?? []).find((tie) => tie.tie === "agent_inferred" && tie.granularity !== "section")!;
    const rows = sampleLectureView.questions.all.map((row) => (row === anchored ? { ...row, ties: [...(row.ties ?? []), suggestion] } : row));
    const reported = { ...sampleLectureView.questions.counts!, course_anchor_with_suggestion: 1 };
    const both = lectureQuestionCounts({ ...sampleLectureView, questions: { ...sampleLectureView.questions, all: rows, counts: reported } });
    expect(both).toMatchObject({ all: 8, courseAnchor: 3, agentInferred: 3, withoutLink: 2, anchoredWithSuggestion: 1, consistent: true });
    expect(questionDivisionSentence(both)).toBe("8 questions: 3 anchored by the course (1 of them also carries a suggested link), 3 with a suggested link only, 2 without a link.");
    expect(questionDivisionSentence({ ...both, anchoredWithSuggestion: 2 })).toContain("(2 of them also carry a suggested link)");
    // a Brain that states another figure disagrees with its own rows; one that states none is not compared on it
    expect(lectureQuestionCounts({ ...sampleLectureView, questions: { ...sampleLectureView.questions, all: rows, counts: { ...reported, course_anchor_with_suggestion: 0 } } }).consistent).toBe(false);
    expect(lectureQuestionCounts({ ...sampleLectureView, questions: { ...sampleLectureView.questions, all: rows } }).consistent).toBe(true);
  });

  it("says when the Brain's own counts disagree with its rows, and reports nothing as reported when there are none", () => {
    const off = { ...sampleLectureView, questions: { ...sampleLectureView.questions, counts: { ...sampleLectureView.questions.counts!, course_anchor: 4 } } };
    expect(lectureQuestionCounts(off)).toMatchObject({ courseAnchor: 3, consistent: false });
    const old = lectureQuestionCounts(sampleLectureViewWithoutR2);
    expect(old).toMatchObject({ all: 8, reported: null, consistent: null, known: false });
    expect(old.courseAnchor + old.agentInferred + old.withoutLink).toBe(8);
    expect(lectureQuestionCounts(null)).toMatchObject({ all: 0, courseAnchor: 0, agentInferred: 0, withoutLink: 0, courseSection: 0 });
  });
});

// ---- ranges of a page ----------------------------------------------------------------------------------------------------
describe("rangesForPage", () => {
  it("keeps separate visits separate and selects the first range of the page itself", () => {
    const page = rangesForPage(sampleLectureView, 2);
    expect(page.ranges).toEqual([sampleRangeSection, sampleRangeFirstVisit, sampleRangeSecondVisit]);
    expect(page.pageRanges).toEqual([sampleRangeFirstVisit, sampleRangeSecondVisit]);
    expect(page.sectionRanges).toEqual([sampleRangeSection]);
    expect(page.selectedDefault).toBe(sampleRangeFirstVisit); // the section pairing carries no time of this page, so it is not the default
    expect(page.noRange).toBeNull();
    expect(sampleRangeFirstVisit.end_ms).toBeLessThan(sampleRangeSecondVisit.start_ms); // nothing joins the two visits
  });

  it("gives every build of a group the same group-level range", () => {
    for (const page of [3, 4, 5]) {
      const result = rangesForPage(sampleLectureView, page);
      expect(result.selectedDefault).toBe(sampleRangeBuildGroup);
      expect(result.selectedDefault?.support).toEqual({ scope: "build_group", pages: [3, 4, 5], builds: null });
    }
  });

  it("falls back to a section range only when the page has no range of its own", () => {
    const only = withSlide(2, (slide) => ({ ...slide, ranges: [sampleRangeSection] }));
    expect(rangesForPage(only, 2)).toMatchObject({ pageRanges: [], selectedDefault: sampleRangeSection, noRange: null });
  });

  it("reports exactly one of the six states for a page without a range, each on its own page of the sample", () => {
    const states = Object.fromEntries(PAGES.map((page) => [page, rangesForPage(sampleLectureView, page).noRange?.state ?? null]));
    expect(states).toEqual({ 1: "no_range_expected", 2: null, 3: null, 4: null, 5: null, 6: "ambiguous", 7: null, 8: "not_discussed", 9: "audio_unprocessed", 10: "association_not_run",
      11: "recording_unavailable", 12: null });
    expect(rangesForPage(sampleLectureView, 7).selectedDefault).toBe(sampleRangeConfirmed); // a link for one page of a group stays that page's
    const seen = new Set(Object.values(states).filter((state): state is NoRangeState => state !== null));
    expect([...seen].sort()).toEqual(Object.keys(sampleNoRange).sort());
    for (const page of PAGES) {
      const result = rangesForPage(sampleLectureView, page);
      expect(result.ranges.length > 0).toBe(result.noRange === null);
      expect(result.selectedDefault === null).toBe(result.ranges.length === 0);
    }
  });

  it("shows a supported range over a structural page instead of the structural line", () => {
    const last = rangesForPage(sampleLectureView, 12);
    expect(last.selectedDefault).toBe(sampleRangeManual);
    expect(last.noRange).toBeNull();
    const both = withSlide(12, (slide) => ({ ...slide, no_range: sampleNoRange.no_range_expected }));
    expect(rangesForPage(both, 12).noRange).toBeNull(); // a range outranks a no-range line that came with it
  });

  it("invents no state when the Brain sent none, and says when a page has neither a range nor one of the six lines", () => {
    expect(rangesForPage(sampleLectureViewWithoutR2, 2)).toEqual({ known: false, ranges: [], pageRanges: [], sectionRanges: [], noRange: null, selectedDefault: null, unexplained: false });
    expect(rangesForPage(sampleLectureView, 99)).toMatchObject({ known: false, unexplained: false });
    // range data came for the page, it is empty, and no reason came with it: the screen can tell this from an older Brain
    const silent = withSlide(8, (slide) => ({ ...slide, no_range: null }));
    expect(rangesForPage(silent, 8)).toMatchObject({ known: true, ranges: [], noRange: null, unexplained: true });
    const absent = withSlide(8, ({ no_range: _none, ...slide }) => slide);
    expect(rangesForPage(absent, 8)).toMatchObject({ known: true, noRange: null, unexplained: true });
    for (const page of PAGES) expect(rangesForPage(sampleLectureView, page).unexplained).toBe(false);
  });

  it("reads the cause, the processed part and the candidates of a no-range state", () => {
    expect(noRangeDetail(sampleNoRange.association_not_run)).toMatchObject({ cause: "inputs_changed", differs: ["map_revision"] });
    expect(noRangeDetail(sampleNoRange.audio_unprocessed)).toMatchObject({ coveredIntervals: [[0, 2_400_000]], reason: "partly_processed" }); // written as [recording, start, end]
    expect(noRangeDetail(sampleNoRange.recording_unavailable).reason).toBe("recording_unreadable");
    expect(noRangeDetail(sampleNoRange.ambiguous).candidates.map((candidate) => [candidate.kind, candidate.start_ms, candidate.end_ms])).toEqual([["occurrence", 1_700_000, 1_760_000],
      ["ambiguous_interval", 3_010_000, 3_055_000]]);
    expect(noRangeDetail(sampleNoRange.not_discussed)).toEqual({ reason: null, cause: null, differs: [], coveredIntervals: [], candidates: [] });
    expect(noRangeDetail(null)).toEqual({ reason: null, cause: null, differs: [], coveredIntervals: [], candidates: [] });
    expect(noRangeDetail({ state: "audio_unprocessed", text: "", detail: { processed: [], reason: "no_generated_timing" } })).toMatchObject({ coveredIntervals: [], reason: "no_generated_timing" });
    // another spelling of the same facts is read too; anything malformed is left out, not repaired
    expect(noRangeDetail({ state: "audio_unprocessed", text: "", detail: { processed_window: { start_ms: 0, end_ms: 90_000 } } }).coveredIntervals).toEqual([[0, 90_000]]);
    expect(noRangeDetail({ state: "ambiguous", text: "", detail: { candidates: [{ start_ms: 5, end_ms: 9 }, { start_ms: "x" }, null] } } as never).candidates).toEqual([{ start_ms: 5, end_ms: 9 }]);
    expect(intervalBounds([3, 9])).toEqual([3, 9]);
    expect(intervalBounds({ start_ms: 3, end_ms: 9, reason: "repetition" })).toEqual([3, 9]);
    expect(intervalBounds({ start_ms: 9, end_ms: 3 })).toBeNull();
  });
});

// ---- stop at the end of a range ------------------------------------------------------------------------------------------
describe("playing one range: [start, end) in integer milliseconds", () => {
  const range = { start_ms: 1_072_000, end_ms: 1_236_000 };

  it("includes the start and excludes the end", () => {
    expect(withinRange(range, 1_072_000)).toBe(true);
    expect(withinRange(range, 1_071_999)).toBe(false);
    expect(withinRange(range, 1_235_999)).toBe(true);
    expect(withinRange(range, 1_236_000)).toBe(false);
    expect(withinRange(range, Number.NaN)).toBe(false);
    expect(withinRange({ start_ms: 10, end_ms: 10 }, 10)).toBe(false); // an empty range holds nothing
  });

  it("names the end as the next stop until it is reached, and nothing after", () => {
    expect(nextStop(range, 1_072_000)).toBe(1_236_000);
    expect(nextStop(range, 1_235_999)).toBe(1_236_000);
    expect(nextStop(range, 1_236_000)).toBeNull();
    expect(nextStop(range, 1_300_000)).toBeNull();
    expect(nextStop(range, 0)).toBe(1_236_000); // before the range: the player is moved to the start, and the stop is still the end
    expect(nextStop(null, 5)).toBeNull(); // whole recording: no bound
  });

  it("stops at the end, loops to the start under Repeat, and plays on inside the range", () => {
    expect(stopAtEnd(range, 1_100_000)).toEqual({ action: "play" });
    expect(stopAtEnd(range, 1_235_999)).toEqual({ action: "play" });
    expect(stopAtEnd(range, 1_236_000)).toEqual({ action: "stop", at_ms: 1_236_000 });
    expect(stopAtEnd(range, 1_236_250)).toEqual({ action: "stop", at_ms: 1_236_000 });
    expect(stopAtEnd(range, 1_236_000, { repeat: true })).toEqual({ action: "loop", to_ms: 1_072_000 });
    expect(stopAtEnd(range, 1_235_970, { toleranceMs: 40 })).toEqual({ action: "stop", at_ms: 1_236_000 }); // a time update that lands just short of the end
    expect(stopAtEnd(range, 1_235_950, { toleranceMs: 40 })).toEqual({ action: "play" });
    expect(stopAtEnd(null, 9_999_999, { repeat: true })).toEqual({ action: "play" }); // whole recording
    expect(stopAtEnd(range, 1_000_000)).toEqual({ action: "seek", to_ms: 1_072_000 }); // outside before the start: go to the start, never play what lies between two visits
  });

  it("still plays a range that is shorter than the tolerance, also under Repeat", () => {
    // A tolerance as long as the range would stop (or loop) at the very start, so the range would never play. The
    // tolerance that counts is at most half the range.
    const short = { start_ms: 1_000, end_ms: 1_200 };
    expect(stopAtEnd(short, 1_000, { toleranceMs: 250 })).toEqual({ action: "play" });
    expect(stopAtEnd(short, 1_000, { toleranceMs: 250, repeat: true })).toEqual({ action: "play" });
    expect(stopAtEnd(short, 1_099, { toleranceMs: 250 })).toEqual({ action: "play" });
    expect(stopAtEnd(short, 1_100, { toleranceMs: 250 })).toEqual({ action: "stop", at_ms: 1_200 });
    expect(stopAtEnd(short, 1_100, { toleranceMs: 250, repeat: true })).toEqual({ action: "loop", to_ms: 1_000 });
    expect(stopAtEnd(short, 1_200, { toleranceMs: 250 })).toEqual({ action: "stop", at_ms: 1_200 });
    expect(stopAtEnd(short, 940, { toleranceMs: 250 })).toEqual({ action: "play" }); // just before the start, within the tolerance that counts: no seek back and forth
    expect(stopAtEnd(short, 800, { toleranceMs: 250 })).toEqual({ action: "seek", to_ms: 1_000 });
    // a range longer than twice the tolerance behaves as before
    const long = { start_ms: 1_000, end_ms: 2_000 };
    expect(stopAtEnd(long, 1_749, { toleranceMs: 250 })).toEqual({ action: "play" });
    expect(stopAtEnd(long, 1_750, { toleranceMs: 250 })).toEqual({ action: "stop", at_ms: 2_000 });
    expect(stopAtEnd(long, 1_000, { toleranceMs: 250, repeat: true })).toEqual({ action: "play" });
    // a negative or broken tolerance is no tolerance
    expect(stopAtEnd(long, 1_999, { toleranceMs: -5 })).toEqual({ action: "play" });
    expect(stopAtEnd(long, 1_999, { toleranceMs: Number.NaN })).toEqual({ action: "play" });
  });

  it("hands over cleanly between two ranges that touch: the shared instant belongs to the later one", () => {
    const first = { start_ms: 1_000, end_ms: 2_000 };
    const second = { start_ms: 2_000, end_ms: 3_000 };
    expect(withinRange(first, 2_000)).toBe(false);
    expect(withinRange(second, 2_000)).toBe(true);
    expect(stopAtEnd(first, 2_000)).toEqual({ action: "stop", at_ms: 2_000 });
    expect(stopAtEnd(second, 2_000)).toEqual({ action: "play" });
    expect(stopAtEnd(second, 2_000, { toleranceMs: 250 })).toEqual({ action: "play" });
    expect(nextStop(first, 2_000)).toBeNull();
    expect(nextStop(second, 2_000)).toBe(3_000);
  });

  it("clamps a seek to the range and converts media seconds to whole milliseconds", () => {
    expect(clampToRange(range, 5)).toBe(1_072_000);
    expect(clampToRange(range, 1_100_000)).toBe(1_100_000);
    expect(clampToRange(range, 9_000_000)).toBe(1_236_000);
    expect(clampToRange(null, -5)).toBe(0);
    expect(toMs(1072.0004)).toBe(1_072_000);
    expect(toMs(0.0006)).toBe(1);
    expect(Number.isInteger(toMs(17.123456))).toBe(true);
    expect(toMs(Number.NaN)).toBe(0);
  });

  it("holds for every range of the sample", () => {
    for (const sample of [sampleRangeFirstVisit, sampleRangeSecondVisit, sampleRangeSection, sampleRangeBuildGroup, sampleRangeConfirmed, sampleRangeManual]) {
      expect(Number.isInteger(sample.start_ms) && Number.isInteger(sample.end_ms) && sample.start_ms < sample.end_ms).toBe(true);
      expect(withinRange(sample, sample.start_ms)).toBe(true);
      expect(withinRange(sample, sample.end_ms)).toBe(false);
      expect(nextStop(sample, sample.end_ms - 1)).toBe(sample.end_ms);
      expect(stopAtEnd(sample, sample.end_ms)).toEqual({ action: "stop", at_ms: sample.end_ms });
    }
  });
});

// ---- where a tie's support is ---------------------------------------------------------------------------------------------
describe("whereLine", () => {
  it("names the build that carries the support, and says nothing on a page that is not in a group", () => {
    const second = identityOf(sampleLectureView, 4);
    const ties = questionsForPage(sampleLectureView, 4);
    expect(whereLine(second, ties.onThisSlide[0]!)).toBe("on this build");
    expect(whereLine(second, ties.elsewhereInSequence[0]!)).toBe("elsewhere in this sequence: build\u00a03");
    expect(whereLine(second, ties.groupLevel[0]!)).toBe("group-level: all\u00a03\u00a0builds");
    // a tie that names this page and another page of the group says both
    expect(whereLine(second, { where: "on_this_page", support_pages: [3, 4] })).toBe("on this build and on build\u00a01");
    expect(whereLine({ position: second.position, groupPages: second.groupPages }, { where: "on_this_page", support_pages: [3, 4] })).toBe("on this build"); // without the page nothing else is named
    expect(supportOrdinals([5], [3, 4, 5])).toEqual([3]);
    expect(supportOrdinals([4, 9], [3, 4, 5])).toEqual([2]); // a page outside the group has no place in it
    expect(whereLine(identityOf(sampleLectureView, 2), questionsForPage(sampleLectureView, 2).onThisSlide[0]!)).toBeNull();
    const step = identityOf(sampleLectureView, 6);
    expect(whereLine(step, { where: "elsewhere_in_sequence", support_pages: [7] })).toBe("elsewhere in this sequence: step\u00a02");
  });
});

// ---- revisions ------------------------------------------------------------------------------------------------------------
describe("isStale", () => {
  it("returns the keys that differ, sorted, and nothing when the view is current", () => {
    expect(isStale(sampleRevisions, sampleRevisions)).toEqual([]);
    expect(isStale(sampleRevisions, { ...sampleRevisions, timing_links: [...sampleRevisions.timing_links] })).toEqual([]); // equal content, another object
    expect(isStale(sampleRevisions, sampleRevisionsLater)).toEqual(["map_revision", "timing_links"]);
    expect(isStale(sampleConceptGraphSlide.revisions, { ...sampleConceptGraphSlide.revisions, scope_revision: "0000000000000000" })).toEqual(["scope_revision"]);
  });

  it("treats a missing key as null, compares keys of either side, and claims nothing without both sides", () => {
    expect(isStale({ a: "1", b: null }, { a: "1" })).toEqual([]);
    expect(isStale({ a: "1" }, { a: "1", b: "2" })).toEqual(["b"]);
    expect(isStale({ a: "1", b: "2" }, { a: "1" })).toEqual(["b"]);
    expect(isStale(undefined, sampleRevisions)).toEqual([]);
    expect(isStale(sampleRevisions, null)).toEqual([]);
  });

  it("reports every key the Brain's concept graph is built from, the one a decision on a suggested link changes among them", () => {
    const built = sampleConceptGraphSlide.revisions;
    expect(Object.keys(built).sort()).toEqual(["anchor_revision", "evidence_revision", "map_revision", "policy_revision", "question_index_sha256", "scope_revision", "skills_sha256"]);
    const afterDecision: ConceptGraphRevisions = { ...built, anchor_revision: "feedfeedfeedfeed", scope_revision: "0000000000000000" };
    expect(isStale(built, afterDecision)).toEqual(["anchor_revision", "scope_revision"]);
    expect(isStale(built, { ...built, skills_sha256: "5".repeat(64), policy_revision: "6".repeat(64) })).toEqual(["policy_revision", "skills_sha256"]);
  });

  it("compares two different kinds of view only on the revisions both of them state", () => {
    // A concept graph and the lecture view beside it are built from partly different inputs. Key by key (the default,
    // for two reads of one view) every key only one of them has would count as changed.
    expect(isStale(sampleConceptGraphLecture.revisions, sampleRevisions)).toEqual(["anchor_revision", "deck_sha256", "inferred_anchors_sha256", "policy_revision", "scope_revision", "skills_sha256", "timing_links"]);
    expect(isStale(sampleConceptGraphLecture.revisions, sampleRevisions, { shared: true })).toEqual([]);
    expect(isStale(sampleConceptGraphLecture.revisions, { ...sampleRevisions, evidence_revision: "ffffffffffffffff" }, { shared: true })).toEqual(["evidence_revision"]);
    expect(isStale(sampleConceptGraphLecture.revisions, sampleRevisionsLater, { shared: true })).toEqual(["map_revision"]);
    // a revision one side does not state (absent or null) claims nothing: the course graph states no map revision
    expect(sampleConceptGraphCourse.revisions.map_revision).toBeNull();
    expect(isStale(sampleConceptGraphCourse.revisions, sampleRevisions, { shared: true })).toEqual([]);
    expect(isStale({ a: "1", b: null }, { a: "2", b: "3", c: "4" }, { shared: true })).toEqual(["a"]);
    expect(isStale(null, sampleRevisions, { shared: true })).toEqual([]);
  });

  it("reads the lecture view of today's Brain, which states the timing links only", () => {
    const today: ViewRevisions = { timing_links: [] };
    expect(isStale(today, { timing_links: [{ recording_source_id: "src-sample-rec-90", links_revision: "9f8e7d6c5b4a3210" }] })).toEqual(["timing_links"]);
    expect(isStale(today, sampleRevisions, { shared: true })).toEqual(["timing_links"]);
    expect(isStale(today, today)).toEqual([]);
  });
});

// ---- graph layout input ---------------------------------------------------------------------------------------------------
describe("graphLayoutInput", () => {
  const shuffled = (graph: ConceptGraphView): ConceptGraphView => ({ ...graph, nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() });

  it("orders nodes by kind, then label, then id, whatever order they came in", () => {
    const course = graphLayoutInput(sampleConceptGraphCourse);
    expect(course.nodes.map((node) => node.id)).toEqual(["t-sample-a", "t-sample-b", "c-sample-1", "c-sample-3", "c-sample-2", "s-sample-2", "s-sample-1", "s-sample-3"]);
    expect(course.nodes.map((node) => node.rank)).toEqual([1, 1, 2, 2, 2, 3, 3, 3]);
    expect(graphLayoutInput(shuffled(sampleConceptGraphCourse))).toEqual(course);
    expect(course.sourcePage).toBeNull();
    expect(course.nodes.some((node) => node.kind === "source_page")).toBe(false);
  });

  it("keeps every edge whose ends are drawn, in a stable order, and tells the three families apart", () => {
    for (const graph of [sampleConceptGraphCourse, sampleConceptGraphLecture, sampleConceptGraphSlide]) {
      const input = graphLayoutInput(graph);
      const ids = new Set(input.nodes.map((node) => node.id));
      expect(input.edges).toHaveLength(graph.edges.length);
      expect(input.droppedEdges).toBe(0);
      for (const edge of input.edges) expect(ids.has(edge.source) && ids.has(edge.target)).toBe(true);
      expect(new Set(input.edges.map((edge) => edge.id)).size).toBe(input.edges.length);
      expect(graphLayoutInput(shuffled(graph))).toEqual(input);
    }
    expect([...new Set(graphLayoutInput(sampleConceptGraphCourse).edges.map((edge) => edge.family))]).toEqual(["structure"]);
    expect([...new Set(graphLayoutInput(sampleConceptGraphLecture).edges.map((edge) => edge.family))]).toEqual(["structure", "assessment"]);
    expect([...new Set(graphLayoutInput(sampleConceptGraphSlide).edges.map((edge) => edge.family))]).toEqual(["structure", "assessment", "source"]);
  });

  it("draws the page of a slide scope from the scope, because a source edge starts at something that is not a node", () => {
    const slide = graphLayoutInput(sampleConceptGraphSlide);
    expect(slide.sourcePage).toEqual({ id: "ls-dddddddddd-p3-5", lectureId: SAMPLE_LECTURE_ID, page: 4, pages: [3, 4, 5], label: "PDF page 4 of 12 · build 2 of 3" });
    expect(slide.nodes[0]).toMatchObject({ id: "ls-dddddddddd-p3-5", kind: "source_page", rank: 0, label: "PDF page 4 of 12 · build 2 of 3", inScope: true, data: null });
    const sources = slide.edges.filter((edge) => edge.family === "source");
    expect(sources).toHaveLength(5);
    expect(sources.every((edge) => edge.source === "ls-dddddddddd-p3-5" && edge.tie !== null && edge.supportPages !== null)).toBe(true);
    expect(sources.find((edge) => edge.target === "S90-Q02")).toMatchObject({ tie: "stated", supportPages: [3, 4, 5], relation: "slide_supports" });
    // a stated anchor and a suggested link stay two kinds of edge
    expect(new Set(sources.map((edge) => edge.tie))).toEqual(new Set(["stated", "agent_inferred"]));
    // without a label from the Brain the page is worded as the physical page, nothing more
    const bare = graphLayoutInput({ ...sampleConceptGraphSlide, scope: { ...sampleConceptGraphSlide.scope, label: null, logical_slide_id: null },
      edges: sampleConceptGraphSlide.edges.map((edge) => (edge.family === "source" ? { ...edge, from: `slide:${SAMPLE_LECTURE_ID}:4` } : edge)) });
    expect(bare.sourcePage).toMatchObject({ id: `slide:${SAMPLE_LECTURE_ID}:4`, label: id("PDF page 4") });
  });

  it("keeps a node outside the scope and marks it, and gives a layout direction from the higher rank to the lower", () => {
    const lecture = graphLayoutInput(sampleConceptGraphLecture);
    expect(lecture.nodes.filter((node) => !node.inScope).map((node) => node.id)).toEqual(["P90-Q01"]);
    const overlap = lecture.edges.find((edge) => edge.relation === "partial_overlap")!;
    expect(overlap).toMatchObject({ source: "S90-Q03", target: "P90-Q01", ranks: false }); // two questions: same rank, drawn after layout
    const assesses = lecture.edges.find((edge) => edge.relation === "criterion_assesses_concept")!;
    expect(assesses).toMatchObject({ source: "S90-Q03.C01", target: "c-sample-1", layoutSource: "c-sample-1", layoutTarget: "S90-Q03.C01", ranks: true });
    const includes = lecture.edges.find((edge) => edge.relation === "topic_includes_concept")!;
    expect(includes).toMatchObject({ layoutSource: "t-sample-a", layoutTarget: "c-sample-1", ranks: true });
  });

  it("drops an edge whose end was cut by the limit and counts it, and answers an empty graph with nothing", () => {
    const cut = graphLayoutInput({ ...sampleConceptGraphLecture, nodes: sampleConceptGraphLecture.nodes.filter((node) => node.id !== "S90-Q03.C01") });
    expect(cut.droppedEdges).toBe(3);
    expect(cut.edges.map((edge) => edge.relation)).toEqual(["concept_assessed_as_skill", "partial_overlap", "topic_includes_concept"]);
    expect(graphLayoutInput(null)).toEqual({ nodes: [], edges: [], sourcePage: null, droppedEdges: 0 });
  });
});

// ---- the sample itself ----------------------------------------------------------------------------------------------------
describe("the synthetic sample holds together", () => {
  it("has twelve pages with the groups, roles and identity the outline needs", () => {
    expect(sampleLectureView.slides.map((slide) => slide.page)).toEqual(PAGES);
    expect(sampleLectureView.page_count).toBe(SAMPLE_PAGE_COUNT);
    expect(sampleSourceMap.logical_slides.flatMap((slide) => slide.pages)).toEqual(PAGES);
    expect(sampleSourceMap.logical_slides.filter((slide) => slide.pages.length > 1).map((slide) => [slide.kind, slide.pages])).toEqual([["build_group", [3, 4, 5]], ["step_group", [6, 7]]]);
    for (const slide of sampleLectureView.slides) {
      const logical = sampleSourceMap.logical_slides.find((entry) => entry.id === slide.identity!.logical_slide_id)!;
      expect(logical.pages).toContain(slide.page);
      expect(slide.identity!.position === null).toBe(logical.pages.length === 1);
      expect(slide.identity!.label).toBe(slide.identity!.label_parts.join(" · "));
    }
    expect(slideOf(sampleLectureView, 1).role).toMatchObject({ value: "structural_title_or_section", forced_requirements: false });
  });

  it("reports raw and instructional denominators whose role counts add up to the page count", () => {
    const { raw, instructional, by_role, excluded, uncertain } = sampleSourceMap.denominators;
    expect(raw).toBe(SAMPLE_PAGE_COUNT);
    expect(Object.values(by_role).reduce((sum, count) => sum + count, 0)).toBe(raw);
    expect(instructional).toBe(by_role.instructional + by_role.worked_example_or_question + by_role.mixed);
    expect(excluded).toBe(by_role.structural_title_or_section + by_role.administrative + by_role.blank);
    const roles = sampleLectureView.slides.map((slide) => slide.role!);
    for (const [value, count] of Object.entries(by_role)) expect(roles.filter((role) => role.value === value)).toHaveLength(count);
    expect(uncertain).toBe(raw - instructional - excluded);
    expect(uncertain).toBe(by_role.objectives_or_summary + by_role.unknown); // listed as uncertain, never as excluded
    expect(roles.filter((role) => !role.forced_requirements)).toHaveLength(excluded);
  });

  it("holds every kind of tie, both no-link lines, every evidence state and every no-range state", () => {
    const kinds = new Set<TieKind>();
    for (const slide of sampleLectureView.slides) {
      for (const tie of slide.question_ties ?? []) kinds.add(tie.tie);
      for (const row of slide.related_questions ?? []) kinds.add(row.tie);
    }
    expect([...kinds].sort()).toEqual(["agent_inferred", "concept_related", "exact", "stated"]);
    const suggested = sampleLectureView.slides.flatMap((slide) => slide.question_ties ?? []).filter((tie) => tie.tie === "agent_inferred");
    expect(new Set(suggested.map((tie) => tie.state))).toEqual(new Set(["agent_inferred", "agent_reviewed"]));
    expect(new Set(suggested.map((tie) => tie.coverage))).toEqual(new Set(["main", "partial"]));
    expect(suggested.some((tie) => tie.learner_decision === "confirmed")).toBe(true);
    for (const tie of suggested) {
      expect(tie.criteria).toHaveLength(tie.criteria_supported);
      expect(tie.criteria_supported).toBeLessThanOrEqual(tie.criteria_total);
      expect(tie.criteria_supported_here).toBeLessThanOrEqual(tie.criteria_supported);
      expect(tie.rationale).toMatch(/^Synthetic rationale/);
    }
    expect(sampleLectureView.slides.some((slide) => (slide.section_ties ?? []).length > 0)).toBe(true);
    expect(sampleLectureView.questions.all.map((row) => row.no_link?.state ?? null).filter(Boolean).sort()).toEqual(["inspected_no_support", "no_suggestion"]);
    const states = new Set<EvidenceState>(sampleLectureView.questions.all.map((row) => row.evidence!.state));
    for (const graph of [sampleConceptGraphCourse, sampleConceptGraphLecture, sampleConceptGraphSlide]) for (const node of graph.nodes) if (node.evidence) states.add(node.evidence.state);
    expect([...states].sort()).toEqual(Object.keys(sampleEvidence).sort());
  });

  it("names, for every tie of a page, only pages of that page's logical slide as its support", () => {
    for (const slide of sampleLectureView.slides) {
      const members = identityOf(sampleLectureView, slide.page).groupPages;
      for (const tie of slide.question_ties ?? []) {
        expect(tie.support_pages.every((page) => members.includes(page))).toBe(true);
        expect(tie.other_pages.some((page) => members.includes(page))).toBe(false);
        if (tie.where === "on_this_page") expect(tie.support_pages).toContain(slide.page);
        if (tie.where === "elsewhere_in_sequence") expect(tie.support_pages).not.toContain(slide.page);
        if (tie.where === "group_level") expect(tie.support_pages).toEqual(members);
      }
    }
  });

  it("has a timing summary that adds up and agrees with the pages", () => {
    const { summary } = sampleLectureTiming;
    expect(summary.pages_with_range + summary.pages_no_range_expected + summary.pages_without_range).toBe(summary.pages);
    expect(summary.human_confirmed + summary.agent_reviewed + summary.generated).toBe(summary.ranges);
    const all = sampleLectureView.slides.map((slide) => rangesForPage(sampleLectureView, slide.page));
    expect(all.filter((page) => page.ranges.length > 0)).toHaveLength(summary.pages_with_range);
    expect(all.filter((page) => page.noRange?.state === "no_range_expected")).toHaveLength(summary.pages_no_range_expected);
    const distinct = new Map(all.flatMap((page) => page.ranges).map((range) => [range.range_id, range]));
    expect(distinct.size).toBe(summary.ranges);
    expect([...distinct.values()].filter((range) => range.review_state === "human_confirmed")).toHaveLength(summary.human_confirmed);
    for (const range of distinct.values()) expect(range.end_ms).toBeLessThanOrEqual(sampleLectureView.recordings[0]!.duration_ms!);
  });

  it("draws three scopes of one model, with a node outside the scope and source edges only at the slide", () => {
    expect([sampleConceptGraphCourse, sampleConceptGraphLecture, sampleConceptGraphSlide].map((graph) => graph.scope.kind)).toEqual(["course", "lecture", "slide"]);
    for (const graph of [sampleConceptGraphCourse, sampleConceptGraphLecture, sampleConceptGraphSlide]) {
      const ids = new Set(graph.nodes.map((node) => node.id));
      expect(ids.size).toBe(graph.nodes.length);
      for (const edge of graph.edges) {
        expect(ids.has(edge.to)).toBe(true);
        expect(edge.family === "source" ? edge.from === graph.scope.logical_slide_id : ids.has(edge.from)).toBe(true);
        expect(edge.tie === null).toBe(edge.family !== "source");
        expect(edge.automatic_credit).toBe(false);
      }
      if (graph.scope.kind !== "slide") expect(graph.nodes.every((node) => node.where === null && node.support_pages.length === 0)).toBe(true);
    }
    expect(sampleConceptGraphCourse.nodes.every((node) => node.in_scope)).toBe(true);
    expect(sampleConceptGraphLecture.nodes.filter((node) => !node.in_scope)).toHaveLength(1);
    expect(sampleConceptGraphSlide.nodes.filter((node) => !node.in_scope)).toHaveLength(1);
    expect(new Set(sampleConceptGraphSlide.nodes.map((node) => node.where))).toEqual(new Set(["on_this_page", "elsewhere_in_sequence", "group_level", null]));
    // an entry supported only on the last build is not presented as on the selected, earlier one
    expect(sampleConceptGraphSlide.nodes.find((node) => node.id === "S90-Q03.C01")).toMatchObject({ where: "elsewhere_in_sequence", support_pages: [5] });
  });

  it("spells the graphs as the Brain does: a question before its criteria, and the seven revisions a graph is built from", () => {
    for (const graph of [sampleConceptGraphCourse, sampleConceptGraphLecture, sampleConceptGraphSlide]) {
      const place = new Map(graph.nodes.map((node, index) => [node.id, index]));
      for (const node of graph.nodes.filter((entry) => entry.kind === "criterion")) {
        const question = node.id.slice(0, node.id.lastIndexOf(".C"));
        expect(place.has(question)).toBe(true); // a criterion is never returned without its question
        expect(place.get(question)!).toBeLessThan(place.get(node.id)!);
      }
      if (graph.focus) expect(graph.nodes[0]!.id).toBe(graph.focus);
      expect(Object.keys(graph.revisions).sort()).toEqual(["anchor_revision", "evidence_revision", "map_revision", "policy_revision", "question_index_sha256", "scope_revision", "skills_sha256"]);
    }
    // the course graph draws neither a slide nor an anchor: it states no revision of either
    expect(sampleConceptGraphCourse.revisions).toMatchObject({ map_revision: null, anchor_revision: null });
    expect(sampleConceptGraphLecture.revisions.anchor_revision).toBeTruthy();
  });

  it("holds the cases a screen must word that the sample lecture does not: a link kept by the learner's confirmation, every no-link reason, a file made for an earlier catalog", () => {
    expect(sampleTieKeptByConfirmation).toMatchObject({ verdict: "rejected", state: "agent_reviewed", learner_decision: "confirmed", where: "on_this_page" });
    expect(sampleTieKeptByConfirmation.verdict_note).toMatch(/^Synthetic note of the checking pass/);
    expect(sampleTieKeptByConfirmation.why).toMatch(/rejected it.*You confirmed this link, so it is kept/);
    expect(Object.keys(sampleNoLinkReasons).sort()).toEqual(["file_unreadable", "no_file", "no_item", "rejected_by_learner", "stale"]);
    for (const [reason, noLink] of Object.entries(sampleNoLinkReasons)) expect(noLink).toEqual({ state: "no_suggestion", reason });
    expect(sampleQuestionRowRejectedByLearner.no_link).toEqual({ state: "no_suggestion", reason: "rejected_by_learner" });
    expect(sampleQuestionRowRejectedByLearner.ties).toEqual([]);
    expect(sampleQuestionRowRejectedByLearner.suggestion_history!.rejected_by_learner).toHaveLength(1); // kept, so the rejection can be taken back
    expect(sampleInferredAnchorsEarlierCatalog.file).toMatchObject({ state: "made_for_earlier_catalog", question_index_matches: false });
    expect(sampleInferredAnchorsEarlierCatalog.accepted).toBe(0);
    expect(sampleInferredAnchorsEarlierCatalog.stale).toBeGreaterThan(0);
  });

  it("carries on its ties what the Brain writes beside the documented fields", () => {
    const suggested = sampleLectureView.slides.flatMap((slide) => slide.question_ties ?? []).filter((tie): tie is SlideSuggestedTie => tie.tie === "agent_inferred");
    for (const tie of suggested) {
      expect(tie.catalog_field).toBeNull();
      expect("verdict_note" in tie).toBe(true);
      for (const criterion of tie.criteria) expect(criterion.pages === null || Array.isArray(criterion.pages)).toBe(true);
    }
    // the partial link states page by page what it supports: each criterion names the page that carries it
    const partial = suggested.find((tie) => tie.question_id === "S90-Q04")!;
    expect(partial.criteria.map((criterion) => [criterion.number, criterion.pages])).toEqual([[1, [4]], [3, [9]]]);
    const course = sampleLectureView.slides.flatMap((slide) => slide.question_ties ?? []).filter((tie) => tie.tie !== "agent_inferred");
    for (const tie of course) expect(tie).toMatchObject({ catalog_field: "locator", verdict_note: null });
  });

  it("lists a processed, a partly processed and an unprocessed recording in the course timing view, and a lecture without one", () => {
    expect(sampleCourseTiming.lectures.map((lecture) => lecture.stage)).toEqual(["associated", "partly_processed", "audio_unprocessed", "no_recording"]);
    const [done, partly, none] = sampleCourseTiming.lectures.map((lecture) => lecture.recordings[0]);
    expect(done?.generated?.covers_whole_recording).toBe(true);
    expect(partly?.generated).toMatchObject({ covers_whole_recording: false });
    expect(partly!.generated!.covered_intervals.reduce((sum, [start, end]) => sum + (end - start), 0) + partly!.generated!.unresolved_ms).toBeLessThan(partly!.duration_ms!);
    expect(none?.generated).toBeNull();
    // unresolved parts are written as [start_ms, end_ms] pairs, like the covered ones
    expect(partly!.generated!.unresolved_intervals).toEqual([[1_500_000, 1_560_000]]);
    expect(partly!.generated!.unresolved_intervals.map((interval) => intervalBounds(interval)).every((bounds) => bounds !== null)).toBe(true);
    expect(partly!.generated!.unresolved_intervals.reduce((sum, interval) => sum + (intervalBounds(interval)![1] - intervalBounds(interval)![0]), 0)).toBe(partly!.generated!.unresolved_ms);
    expect(sampleCourseTiming.lectures[3]!.recordings).toEqual([]);
    const { ceiling_seconds, used_seconds, remaining_seconds } = sampleCourseTiming.allowance!;
    expect(used_seconds + remaining_seconds).toBe(ceiling_seconds);
  });

  it("is synthetic: every prompt, title and rationale says so or is a placeholder", () => {
    const text = JSON.stringify([sampleLectureView, sampleConceptGraphCourse, sampleConceptGraphLecture, sampleConceptGraphSlide, sampleCourseTiming, sampleInferredAnchors]);
    expect(text).not.toMatch(/G:\\\\|Boston|be5\d\d|BE ?5\d\d/i);
    for (const row of sampleLectureView.questions.all) expect(row.prompt_in_index ? row.prompt : "Synthetic").toMatch(/Synthetic/);
    expect(sampleLectureView.title).toMatch(/synthetic/i);
  });
});

// ---- the Brain's own spelling -----------------------------------------------------------------------------------------------
describe("objects spelled as the Brain builds them today satisfy the types", () => {
  // Each object below is written the way a Brain module writes it (the module is named beside it). The type annotations
  // are the test: `tsc` refuses this file when a type excludes what the Brain sends.
  it("a suggested link the learner confirmed and the checking pass rejected later (question_ties.suggest)", () => {
    const verdict: SuggestionVerdict = "rejected";
    const tie: SlideSuggestedTie = { ...sampleTieKeptByConfirmation, verdict, verdict_note: "Synthetic note." };
    const criterion: TieCriterion = { criterion_id: "S90-Q05.C02", number: 2, label: "Criterion 2 of 3", concept_id: null, concept_label: null, skill_id: null, action_types: [], pages: null };
    const via: RelatedQuestion["via_concepts"][number] = { concept_id: "c-sample-1", label: "Sample concept one", basis: "suggested_link" };
    expect([tie.verdict, criterion.pages, via.basis]).toEqual(["rejected", null, "suggested_link"]);
  });

  it("a cleared decision where nothing was decided (inferred_anchors.decide), and a file made for an earlier catalog (_classify)", () => {
    const cleared: SuggestionDecisionResponse = { course_id: SAMPLE_COURSE_ID, suggestion_id: "ia-0000000000000001", decision: null, revision: 0, status: "unchanged", decided_at: null, question_id: null };
    const states: Array<InferredAnchorsReadback["file"]["state"]> = ["ok", "missing", "unreadable", "made_for_earlier_catalog", "catalog_unavailable"];
    expect(cleared.decision).toBeNull();
    expect(states).toHaveLength(5);
  });

  it("source rows of a node that cannot be opened or are not text, and the scope of a slide with a question of another collection (concept_graph)", () => {
    const rows: OutlineNodeView["sources"] = [
      { kind: "transcript_lines", lecture_id: "lecture-90", source_id: null, pages: [], ranges: [[40, 52]], locator_text: null, label: "Transcript lines 40 to 52", tie: "exact", logical_slide_ids: [], href: null,
        basis: "question anchor (exact)", from: ["S90-Q08"] },
      { kind: "text", lecture_id: null, source_id: "src-sample-notes", pages: [], ranges: [], locator_text: "Synthetic: the second half of the notes", label: "Synthetic: the second half of the notes", tie: "stated",
        logical_slide_ids: [], href: "/courses/sample-course/sources/src-sample-notes", basis: "skill source reference", from: ["s-sample-1"] },
    ];
    const scope: OutlineView["scope"] = { kind: "slide", basis: "typed_anchor_or_suggested_link", note: "", questions_in_scope: 1, lecture_id: "lecture-90", page: 9, questions_of_other_collections: ["P90-Q01"] };
    expect(rows.map((row) => row.href)).toEqual([null, "/courses/sample-course/sources/src-sample-notes"]);
    expect(scope.questions_of_other_collections).toEqual(["P90-Q01"]);
  });

  it("a range whose reason was not recorded, the lecture view's revisions of today, and the no-range details (timing_links)", () => {
    const why: TimingRange["why"] = null;
    const today: ViewRevisions = { timing_links: [] };
    const untimed: NoRange = { state: "audio_unprocessed", text: "…", detail: { processed: [["src-sample-rec-90", 0, 10]], reason: "transcript_lines_without_time",
      coverage: [{ recording_source_id: "src-sample-rec-90", coverage_fraction: 1, covers_whole_recording: true, unresolved_ms: 0, lines_aligned: 310, lines_total: 420 }] } };
    const noText: NoRange = { state: "association_not_run", text: "…", detail: { cause: "not_run", differs: [], reason: "no_slide_text" } };
    expect(why).toBeNull();
    expect(Object.keys(today)).toEqual(["timing_links"]);
    expect(noRangeDetail(untimed)).toMatchObject({ reason: "transcript_lines_without_time", coveredIntervals: [[0, 10]] });
    expect(noRangeDetail(noText)).toMatchObject({ cause: "not_run", reason: "no_slide_text" });
  });
});

// ---- hooks -----------------------------------------------------------------------------------------------------------------
type Call = { url: string; method: string; body: unknown };
type Failure = { status: number; detail: string; code?: string };
/** A whole answer body with its status, written as the Brain would write it. */
type Raw = { status: number; body: unknown };
/** A labeled double of the Brain: answers each path with the body or the status it was given, and records the calls. */
function stubBrain(answers: Record<string, unknown | Failure | Raw>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    const path = Object.keys(answers).find((candidate) => url === `/api/${candidate}`);
    const answer = path === undefined ? { status: 404, detail: `no double for ${url}` } : answers[path];
    const raw = answer && typeof answer === "object" && "status" in answer && "body" in answer ? (answer as Raw) : null;
    if (raw) return new Response(JSON.stringify(raw.body), { status: raw.status, headers: { "content-type": "application/json" } });
    const failure = answer && typeof answer === "object" && "status" in answer && "detail" in answer ? (answer as Failure) : null;
    return new Response(JSON.stringify(failure ? { detail: failure.detail, code: failure.code } : answer), { status: failure?.status ?? 200, headers: { "content-type": "application/json" } });
  }));
  return calls;
}
function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}
const LECTURE = SAMPLE_LECTURE_ID;
const COURSE = SAMPLE_COURSE_ID;
/** Views of two lectures and two courses in the cache, so a mutation can be seen to touch exactly its own. */
const SEEDED: Record<string, unknown[]> = {
  lecture: ["lecture", COURSE, LECTURE, null],
  lectureOtherDeck: ["lecture", COURSE, LECTURE, "src-other-deck"],
  otherLecture: ["lecture", COURSE, "lecture-91", null],
  otherCourseLecture: ["lecture", "other-course", LECTURE, null],
  course: ["course", COURSE],
  questionBank: ["question-bank", COURSE, {}],
  question: ["question", COURSE, "S90-Q04"],
  graphCourse: queryKeys.conceptGraph(COURSE, {}),
  graphLecture: queryKeys.conceptGraph(COURSE, { scope: `lecture:${LECTURE}` }),
  graphSlide: queryKeys.conceptGraph(COURSE, { scope: `slide:${LECTURE}:4`, focus: "c-sample-1", depth: 2 }),
  graphOtherLecture: queryKeys.conceptGraph(COURSE, { scope: "lecture:lecture-91" }),
  graphOtherCourse: queryKeys.conceptGraph("other-course", {}),
  outlineCourse: ["outline", COURSE, "course", null],
  outlineSlide: ["outline", COURSE, `slide:${LECTURE}:4`, null],
  outlineOtherLecture: ["outline", COURSE, "lecture:lecture-91", null],
  outlineNode: ["outline-node", COURSE, "c-sample-1"],
  courseTiming: queryKeys.courseTiming(COURSE),
  inferredAnchors: queryKeys.inferredAnchors(COURSE),
  sourceMap: queryKeys.sourceMap(COURSE, LECTURE),
  otherSourceMap: queryKeys.sourceMap(COURSE, "lecture-91"),
  servedIdentity: queryKeys.servedIdentity(),
  progress: ["progress", COURSE],
};
function seed(client: QueryClient): void {
  for (const key of Object.values(SEEDED)) client.setQueryData(key, { seeded: true });
}
const invalidated = (client: QueryClient): string[] => Object.entries(SEEDED).filter(([, key]) => client.getQueryState(key)?.isInvalidated).map(([name]) => name).sort();

describe("paths of the R2 routes", () => {
  it("spells each route as the API document does", () => {
    expect(r2Paths.conceptGraph("c1", {})).toBe("courses/c1/concept-graph?scope=course");
    expect(r2Paths.conceptGraph("c1", { scope: "slide:lecture-03:23", focus: "c-rate law", depth: 2, limit: 80 })).toBe("courses/c1/concept-graph?scope=slide%3Alecture-03%3A23&focus=c-rate+law&depth=2&limit=80");
    expect(r2Paths.conceptGraph("c1", { scope: "lecture:lecture-03", focus: null })).toBe("courses/c1/concept-graph?scope=lecture%3Alecture-03");
    expect(r2Paths.courseTiming("c1")).toBe("courses/c1/timing");
    expect(r2Paths.timingBuild("c1", "lecture-03")).toBe("courses/c1/lectures/lecture-03/timing/build");
    expect(r2Paths.sourceMap("c1", "lecture-03")).toBe("courses/c1/lectures/lecture-03/source-map");
    expect(r2Paths.sourceMapOverrides("c1", "lecture-03")).toBe("courses/c1/lectures/lecture-03/source-map/overrides");
    expect(r2Paths.sourceMap("c1", "lecture-03", "src other")).toBe("courses/c1/lectures/lecture-03/source-map?deck=src%20other");
    expect(r2Paths.sourceMapOverrides("c1", "lecture-03", "src-notes")).toBe("courses/c1/lectures/lecture-03/source-map/overrides?deck=src-notes");
    expect(r2Paths.sourceMap("c1", "lecture-03", null)).toBe("courses/c1/lectures/lecture-03/source-map");
    expect(r2Paths.inferredAnchors("c1")).toBe("courses/c1/inferred-anchors");
    expect(r2Paths.suggestionDecision("c1", "ia-0123456789abcdef")).toBe("courses/c1/suggestions/ia-0123456789abcdef/decision");
    expect(r2Paths.suggestionDecision("c1", "a/b")).toBe("courses/c1/suggestions/a%2Fb/decision"); // an id never becomes a path
    expect(r2Paths.outlineNode("c1", "S90-Q03.C01")).toBe("courses/c1/outline/node?id=S90-Q03.C01");
  });
});

describe("reading the R2 views", () => {
  it("asks for the concept graph of a scope and keeps each scope, focus, depth and limit under its own key", async () => {
    const calls = stubBrain({ [r2Paths.conceptGraph(COURSE, { scope: `slide:${LECTURE}:4`, focus: "c-sample-1", depth: 2 })]: sampleConceptGraphSlide, [r2Paths.conceptGraph(COURSE, {})]: sampleConceptGraphCourse });
    const { wrapper } = harness();
    const slide = renderHook(() => useConceptGraph(COURSE, { scope: `slide:${LECTURE}:4`, focus: "c-sample-1", depth: 2 }), { wrapper });
    const course = renderHook(() => useConceptGraph(COURSE), { wrapper });
    await waitFor(() => expect(slide.result.current.isSuccess && course.result.current.isSuccess).toBe(true));
    expect(slide.result.current.data?.scope.kind).toBe("slide");
    expect(course.result.current.data?.scope.kind).toBe("course");
    expect(calls.map((call) => call.method)).toEqual(["GET", "GET"]);
    expect(queryKeys.conceptGraph(COURSE, {})).toEqual(["concept-graph", COURSE, "course", null, 1, null]);
    expect(queryKeys.conceptGraph(COURSE, { scope: `slide:${LECTURE}:4`, focus: "c-sample-1", depth: 2, limit: 80 })).toEqual(["concept-graph", COURSE, `slide:${LECTURE}:4`, "c-sample-1", 2, 80]);
  });

  it("does not ask before it knows the course (or when it is told to wait), and tells an unknown scope from an unknown focus", async () => {
    const calls = stubBrain({ [r2Paths.conceptGraph(COURSE, { scope: "lecture:nowhere" })]: { status: 404, detail: "Unknown scope" } });
    const { wrapper } = harness();
    renderHook(() => useConceptGraph(undefined), { wrapper });
    renderHook(() => useConceptGraph(COURSE, { enabled: false }), { wrapper });
    renderHook(() => useCourseTiming(undefined), { wrapper });
    renderHook(() => useSourceMap(COURSE, undefined), { wrapper });
    const missing = renderHook(() => useConceptGraph(COURSE, { scope: "lecture:nowhere" }), { wrapper });
    await waitFor(() => expect(missing.result.current.isError).toBe(true));
    expect(calls).toHaveLength(1);
    expect(conceptGraphErrorCode(missing.result.current.error)).toBe("unknown_scope");
    expect(conceptGraphErrorCode(new ApiError(404, "Unknown focus"))).toBe("unknown_focus");
    expect(conceptGraphErrorCode(new ApiError(422, "depth must be 1 to 3"))).toBe("malformed_request");
    expect(conceptGraphErrorCode(new ApiError(404, "Unknown course"))).toBeNull();
    expect(conceptGraphErrorCode(new ApiError(0, "The Brain on this PC is not reachable."))).toBeNull();
    expect(conceptGraphErrorCode(new Error("anything else"))).toBeNull();
  });

  it("reads the error document the API document fixes for the concept graph: the code and the detail of an unknown scope or focus", async () => {
    // r2-read-api.md 1.4: `{course_id, graph_version, error: {code, detail}}` with 404. The Brain of today answers
    // `{detail: "Unknown focus"}` instead; both spellings are an explained state, never a bare "Not Found".
    const focusPath = r2Paths.conceptGraph(COURSE, { focus: "c-nowhere" });
    const scopePath = r2Paths.conceptGraph(COURSE, { scope: "slide:lecture-90:99" });
    stubBrain({
      [focusPath]: { status: 404, body: { course_id: COURSE, graph_version: "concept-graph/1", error: { code: "unknown_focus", detail: "Unknown catalog object 'c-nowhere'" } } },
      [scopePath]: { status: 404, body: { course_id: COURSE, graph_version: "concept-graph/1", error: { code: "unknown_scope", detail: "Page 99 is not a page of the displayed deck, which has 12" } } },
    });
    const focus = await apiGet(focusPath).catch((error: unknown) => error);
    expect(focus).toBeInstanceOf(ApiError);
    expect(focus).toMatchObject({ status: 404, code: "unknown_focus", detail: "Unknown catalog object 'c-nowhere'" });
    expect(conceptGraphErrorCode(focus)).toBe("unknown_focus");
    const scope = await apiGet(scopePath).catch((error: unknown) => error);
    expect(scope).toMatchObject({ status: 404, code: "unknown_scope", detail: "Page 99 is not a page of the displayed deck, which has 12" });
    expect(conceptGraphErrorCode(scope)).toBe("unknown_scope");
    const { wrapper } = harness();
    const hook = renderHook(() => useConceptGraph(COURSE, { focus: "c-nowhere" }), { wrapper });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(conceptGraphErrorCode(hook.result.current.error)).toBe("unknown_focus");
    // the code decides when it is there; a code this build does not know claims nothing, and another route's 404 is not a graph error
    expect(conceptGraphErrorCode(new ApiError(404, "anything", "unknown_scope"))).toBe("unknown_scope");
    expect(conceptGraphErrorCode(new ApiError(404, "Unknown scope", "something_else"))).toBeNull();
    expect(conceptGraphErrorCode(new ApiError(409, "Course binding is not usable"))).toBeNull();
  });

  it("reads the messages of a malformed request (422), whose detail is a list, and keeps a refusal's own code and detail", async () => {
    const path = r2Paths.conceptGraph(COURSE, { depth: 9 });
    stubBrain({
      [path]: { status: 422, body: { detail: [{ type: "less_than_equal", loc: ["query", "depth"], msg: "Input should be less than or equal to 3", input: "9" }, { loc: ["query", "limit"], msg: "Input should be greater than or equal to 1" }] } },
      "courses/x/plain": { status: 404, detail: "Unknown course" },
      "courses/x/coded": { status: 409, detail: "A correction of yours is in force for these pages.", code: "learner_correction_in_force" },
      "courses/x/empty": { status: 500, body: null },
    });
    const malformed = await apiGet(path).catch((error: unknown) => error);
    expect(malformed).toMatchObject({ status: 422, detail: "depth: Input should be less than or equal to 3; limit: Input should be greater than or equal to 1" });
    expect(conceptGraphErrorCode(malformed)).toBe("malformed_request");
    expect(await apiGet("courses/x/plain").catch((error: unknown) => error)).toMatchObject({ status: 404, detail: "Unknown course", code: undefined });
    expect(await apiGet("courses/x/coded").catch((error: unknown) => error)).toMatchObject({ status: 409, detail: "A correction of yours is in force for these pages.", code: "learner_correction_in_force" });
    const empty = await apiGet("courses/x/empty").catch((error: unknown) => error);
    expect(empty).toBeInstanceOf(ApiError);
    expect((empty as ApiError).status).toBe(500);
    expect((empty as ApiError).detail).not.toBe("");
  });

  it("reads course timing, the suggestions readback, the stored source map and the served build", async () => {
    const identity = { app_version: "0.0.0-double", commit: null };
    stubBrain({ [r2Paths.courseTiming(COURSE)]: sampleCourseTiming, [r2Paths.inferredAnchors(COURSE)]: sampleInferredAnchors, [r2Paths.sourceMap(COURSE, LECTURE)]: sampleSourceMapDocument, health: { build: identity } });
    const { wrapper } = harness();
    const timing = renderHook(() => useCourseTiming(COURSE), { wrapper });
    const anchors = renderHook(() => useInferredAnchors(COURSE), { wrapper });
    const map = renderHook(() => useSourceMap(COURSE, LECTURE), { wrapper });
    const build = renderHook(() => useServedIdentity(), { wrapper });
    await waitFor(() => expect(timing.result.current.isSuccess && anchors.result.current.isSuccess && map.result.current.isSuccess && build.result.current.isSuccess).toBe(true));
    expect(timing.result.current.data?.lectures).toHaveLength(4);
    expect(anchors.result.current.data?.accepted).toBe(3);
    expect(map.result.current.data?.map_revision).toBe(sampleSourceMap.map_revision);
    expect(map.result.current.data?.pages.map((entry) => entry.page)).toEqual(PAGES);
    expect(map.result.current.data?.overrides.map((record) => record.revision)).toEqual([1]);
    expect(queryKeys.sourceMap(COURSE, LECTURE, "src-notes")).toEqual(["source-map", COURSE, LECTURE, "src-notes"]);
    expect(build.result.current.data).toEqual(identity);
  });
});

describe("changing app-private state invalidates exactly the views that change", () => {
  it("a decision on a suggested link: the course's lecture views, concept views and the readback — not the question bank, timing or source map", async () => {
    const calls = stubBrain({ [r2Paths.suggestionDecision(COURSE, "ia-0000000000000004")]: sampleSuggestionDecision });
    const { client, wrapper } = harness();
    seed(client);
    const { result } = renderHook(() => useSuggestionDecision(COURSE), { wrapper });
    let answer: unknown;
    await act(async () => { answer = await result.current.mutateAsync({ suggestionId: "ia-0000000000000004", decision: "confirmed", expectedRevision: 0 }); });
    expect(answer).toEqual(sampleSuggestionDecision);
    expect(calls).toEqual([{ url: `/api/courses/${COURSE}/suggestions/ia-0000000000000004/decision`, method: "POST", body: { decision: "confirmed", expected_revision: 0 } }]);
    expect(invalidated(client)).toEqual(["graphCourse", "graphLecture", "graphOtherLecture", "graphSlide", "inferredAnchors", "lecture", "lectureOtherDeck", "otherLecture", "outlineCourse", "outlineNode",
      "outlineOtherLecture", "outlineSlide"]);
  });

  it("sends only the decision when no revision is expected, and touches nothing when the Brain says it was unchanged", async () => {
    const calls = stubBrain({ [r2Paths.suggestionDecision(COURSE, "ia-0000000000000004")]: { ...sampleSuggestionDecision, status: "unchanged" } });
    const { client, wrapper } = harness();
    seed(client);
    const { result } = renderHook(() => useSuggestionDecision(COURSE), { wrapper });
    await act(async () => { await result.current.mutateAsync({ suggestionId: "ia-0000000000000004", decision: "cleared" }); });
    expect(calls[0]?.body).toEqual({ decision: "cleared" });
    expect(invalidated(client)).toEqual([]);
  });

  it("a conflict (409) refreshes the same views so the decision in force is shown, and any other failure changes nothing", async () => {
    stubBrain({ [r2Paths.suggestionDecision(COURSE, "ia-0000000000000004")]: { status: 409, detail: "Another decision was recorded first." } });
    const { client, wrapper } = harness();
    seed(client);
    const { result } = renderHook(() => useSuggestionDecision(COURSE), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync({ suggestionId: "ia-0000000000000004", decision: "rejected" })).rejects.toMatchObject({ status: 409 }); });
    expect(invalidated(client)).toContain("lecture");
    expect(invalidated(client)).toContain("inferredAnchors");

    stubBrain({ [r2Paths.suggestionDecision(COURSE, "ia-0000000000000009")]: { status: 404, detail: "Unknown suggestion" } });
    const second = harness();
    seed(second.client);
    const other = renderHook(() => useSuggestionDecision(COURSE), { wrapper: second.wrapper });
    await act(async () => { await expect(other.result.current.mutateAsync({ suggestionId: "ia-0000000000000009", decision: "confirmed" })).rejects.toMatchObject({ status: 404 }); });
    expect(invalidated(second.client)).toEqual([]);
  });

  it("a source-map correction: this lecture's views, its stored map, the concept views of the course and of this lecture, timing and the served identity — not another lecture", async () => {
    const calls = stubBrain({ [r2Paths.sourceMapOverrides(COURSE, LECTURE)]: { ...sampleSourceMap, override_revision: 1 } });
    const { client, wrapper } = harness();
    seed(client);
    const { result } = renderHook(() => useSourceMapOverride(COURSE, LECTURE), { wrapper });
    await act(async () => { await result.current.mutateAsync({ op: "role", pages: [11], value: "blank", reason: "The page is empty." }); });
    expect(calls).toEqual([{ url: `/api/courses/${COURSE}/lectures/${LECTURE}/source-map/overrides`, method: "POST", body: { op: "role", pages: [11], value: "blank", reason: "The page is empty." } }]);
    expect(invalidated(client)).toEqual(["courseTiming", "graphCourse", "graphLecture", "graphSlide", "lecture", "lectureOtherDeck", "outlineCourse", "outlineNode", "outlineSlide", "servedIdentity", "sourceMap"]);
  });

  it("a refused correction says which rule refused it and changes nothing", async () => {
    const calls = stubBrain({ [r2Paths.sourceMapOverrides(COURSE, LECTURE, "src-notes")]: { status: 409, detail: "A correction of yours is in force for these pages.", code: "learner_correction_in_force" } });
    const { client, wrapper } = harness();
    seed(client);
    const { result } = renderHook(() => useSourceMapOverride(COURSE, LECTURE, "src-notes"), { wrapper });
    let failure: unknown;
    await act(async () => { failure = await result.current.mutateAsync({ op: "split_before", pages: [4], reason: "Page 4 starts a new slide." }).catch((error: unknown) => error); });
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 409, code: "learner_correction_in_force", detail: "A correction of yours is in force for these pages." });
    expect(calls[0]).toMatchObject({ url: `/api/courses/${COURSE}/lectures/${LECTURE}/source-map/overrides?deck=src-notes`, body: { op: "split_before", pages: [4] } });
    expect(invalidated(client)).toEqual([]);
    expect(new ApiError(404, "Unknown course").code).toBeUndefined();
  });

  it("a rebuild of the timing links: this lecture's views and the course timing view, nothing else", async () => {
    const calls = stubBrain({ [r2Paths.timingBuild(COURSE, LECTURE)]: sampleLectureTiming });
    const { client, wrapper } = harness();
    seed(client);
    const { result } = renderHook(() => useTimingBuild(COURSE, LECTURE), { wrapper });
    let answer: unknown;
    await act(async () => { answer = await result.current.mutateAsync(); });
    expect(answer).toEqual(sampleLectureTiming);
    expect(calls).toEqual([{ url: `/api/courses/${COURSE}/lectures/${LECTURE}/timing/build`, method: "POST", body: undefined }]);
    expect(invalidated(client)).toEqual(["courseTiming", "lecture", "lectureOtherDeck"]);
  });

  it("states its invalidations as data, so a screen that makes the same change elsewhere can reuse them", () => {
    expect(invalidatedBy.timingBuild(COURSE, LECTURE)).toEqual([{ queryKey: ["lecture", COURSE, LECTURE] }, { queryKey: ["course-timing", COURSE] }]);
    expect(invalidatedBy.suggestionDecision(COURSE).map((filter) => filter.queryKey)).toEqual([["lecture", COURSE], ["concept-graph", COURSE], ["outline", COURSE], ["outline-node", COURSE], ["inferred-anchors", COURSE]]);
  });
});

// ---- the sentence of a no-range line (design specification 9.5) -------------------------------------------------------------
describe("noRangeSentence", () => {
  const empty = (state: NoRangeState, detail: Record<string, unknown> = {}): NoRange => ({ state, text: "", detail } as NoRange);

  it("shows the Brain's own sentence verbatim when it sent one", () => {
    for (const state of Object.keys(sampleNoRange) as NoRangeState[]) expect(noRangeSentence(sampleNoRange[state])).toBe(sampleNoRange[state].text);
  });

  it("falls back to one sentence per state, each from the state's own detail, when the Brain sent none", () => {
    expect(noRangeSentence(empty("not_discussed"))).toBe("The whole recording was processed and matched, and no talk about this slide was found.");
    expect(noRangeSentence(empty("audio_unprocessed"))).toBe("This recording has no speech timing yet.");
    expect(noRangeSentence(empty("audio_unprocessed", { processed: [["src-sample-rec-90", 0, 1_450_000]], reason: "partly_processed" })))
      .toBe(`Only 0:00${NBSP}–${NBSP}24:10 of this recording has speech timing, and nothing for this slide was found in that part.`);
    // the whole recording is transcribed and some transcript lines have no time: never worded as "no speech timing yet"
    expect(noRangeSentence(empty("audio_unprocessed", { processed: [["src-sample-rec-90", 0, 4_800_000]], reason: "transcript_lines_without_time" })))
      .toBe("The recording is transcribed, but some transcript lines could not be given a time; nothing for this slide was found among the lines that have one.");
    expect(noRangeSentence(empty("association_not_run", { cause: "not_run" }))).toBe("The recording has speech timing, but slide matching has not run on it yet.");
    expect(noRangeSentence(empty("association_not_run", { cause: "inputs_changed", differs: ["map_revision"] }))).toBe("The recording has speech timing, but its inputs changed since slide matching ran.");
    expect(noRangeSentence(empty("association_not_run", { cause: "no_adequate_method" }))).toBe("The recording has speech timing, but no adequate matching method is available.");
    expect(noRangeSentence(empty("association_not_run"))).toBe("The recording has speech timing, but slide matching has not run on it with the current inputs."); // no cause recorded: none is made up
    expect(noRangeSentence(empty("ambiguous", sampleNoRange.ambiguous.detail as Record<string, unknown>))).toBe(`2${NBSP}candidates, none good enough to show as the range.`);
    expect(noRangeSentence(empty("ambiguous"))).toBe("Several candidates, none good enough to show as the range.");
    expect(noRangeSentence(empty("recording_unavailable", { reason: "recording_unreadable" }))).toBe("The recording file cannot be read.");
    expect(noRangeSentence(empty("recording_unavailable", { reason: "no_session_linked" }))).toBe("No recording is linked to this lecture.");
    expect(noRangeSentence(empty("recording_unavailable", { reason: "no_recording_in_session" }))).toBe("No recording is linked to this lecture.");
    expect(noRangeSentence(empty("recording_unavailable"))).toBe("No recording exists or it cannot be read.");
    expect(noRangeSentence(empty("no_range_expected", { role: "structural_title_or_section" }))).toBe("No recording range is expected for a title or section page, and none was found.");
    expect(noRangeSentence(empty("no_range_expected", { role: "administrative" }))).toBe("No recording range is expected for an administrative page, and none was found.");
    expect(noRangeSentence(empty("no_range_expected", { role: "blank" }))).toBe("No recording range is expected for a blank page, and none was found.");
    expect(noRangeSentence(empty("no_range_expected"))).toBe("No recording range is expected for this page, and none was found.");
  });

  it("gives six different sentences: the same sentence never serves two states", () => {
    const sentences = (Object.keys(sampleNoRange) as NoRangeState[]).map((state) => noRangeSentence(empty(state)));
    expect(new Set(sentences).size).toBe(6);
    for (const sentence of sentences) expect(sentence).toMatch(/\.$/);
  });
});
