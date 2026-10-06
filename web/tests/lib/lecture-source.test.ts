// The source side of the lecture workspace (design specification 5.2 – 5.4): the pure rules behind the outline rows, the
// pager band, the size menu and the stage block, on the synthetic sample of every R2 state (src/lib/fixtures/r2-sample).
// No browser and no pdf.js document: the figures asserted for the stage are the specification's own table (4.3, 4.4).
import { describe, expect, it } from "vitest";
import { sampleLectureView, sampleLectureViewWithoutR2 } from "@/lib/fixtures/r2-sample";
import { identityOf } from "@/lib/r2";
import type { LectureView, SlideView, SourceMapOverrideRecord } from "@/lib/types";
import { NO_TITLE, findRows, outlineFacts, outlineRows, plainRows, rowName } from "@/features/lecture/LectureOutline";
import { STAGE_MIN_BLOCK_PX, groupingChoices, groupingRequest, learnerCorrections, stageBlock, takeBackChoice } from "@/features/lecture/LectureWorkspace";
import { PAGER_STEPS, ROLE_ORDER, identityDetails, pagerHolds, pagerLevelFor, stepName } from "@/features/lecture/Pager";
import { FIT_DATA, FIT_LABEL, PDF_CSS_UNITS, SLIDE_FITS, canvasDensity, slideWidth } from "@/features/lecture/SlideCanvas";
import { thumbRenderWidth } from "@/lib/thumbs";

/** Labels hold their facts together with non-breaking spaces; the assertions read them with plain ones. */
const plain = (text: string | null): string | null => (text === null ? null : text.replace(/ /g, " "));
const slidesOf = (view: LectureView): Map<number, SlideView> => new Map(view.slides.map((slide) => [slide.page, slide]));
const rowOf = (view: LectureView, page: number) => outlineRows(view, view.page_count ?? 0).find((row) => row.pages.includes(page))!;

describe("the stage block: slide and bar as one block of one width (5.4)", () => {
  // Stage height = window − header − band − 12 px above and below; widths are the specification's stage widths (4.3).
  const cases: Array<[string, { stageWidth: number; stageHeight: number; barHeight: number; aspect: number }, { width: number; slideHeight: number; slack: number }]> = [
    ["1180 × 800, 4:3, outline closed", { stageWidth: 672, stageHeight: 800 - 56 - 48 - 24, barHeight: 84, aspect: 4 / 3 }, { width: 672, slideHeight: 504, slack: 76 }],
    ["1440 × 900, 4:3, outline closed", { stageWidth: 919, stageHeight: 900 - 56 - 48 - 24, barHeight: 84, aspect: 4 / 3 }, { width: 906, slideHeight: 680, slack: 0 }],
    ["1440 × 900, 16:9, outline closed", { stageWidth: 919, stageHeight: 900 - 56 - 48 - 24, barHeight: 84, aspect: 16 / 9 }, { width: 919, slideHeight: 517, slack: 163 }],
    ["1440 × 900, 4:3, outline open", { stageWidth: 727, stageHeight: 900 - 56 - 48 - 24, barHeight: 84, aspect: 4 / 3 }, { width: 727, slideHeight: 545, slack: 135 }],
    ["1920 × 1080, 4:3, outline open", { stageWidth: 977, stageHeight: 1080 - 60 - 48 - 24, barHeight: 92, aspect: 4 / 3 }, { width: 977, slideHeight: 733, slack: 115 }],
    ["1920 × 1080, 4:3, outline closed", { stageWidth: 1217, stageHeight: 1080 - 60 - 48 - 24, barHeight: 92, aspect: 4 / 3 }, { width: 1130, slideHeight: 848, slack: 0 }],
    ["2560 × 1440, 4:3, outline open", { stageWidth: 1432, stageHeight: 1440 - 64 - 52 - 24, barHeight: 100, aspect: 4 / 3 }, { width: 1432, slideHeight: 1074, slack: 118 }],
    // One focused pane (4.4): the pane less 12 px each side; the pane switch and the pager are two bands.
    ["1024 × 768, one pane", { stageWidth: 1024 - 76 - 24, stageHeight: 768 - 56 - 48 - 48 - 24, barHeight: 84, aspect: 4 / 3 }, { width: 666, slideHeight: 500, slack: 0 }],
    ["768 × 1024, one pane", { stageWidth: 768 - 24, stageHeight: 1024 - 52 - 48 - 48 - 24, barHeight: 84, aspect: 4 / 3 }, { width: 744, slideHeight: 558, slack: 202 }],
    ["390 × 844, one pane", { stageWidth: 390 - 24, stageHeight: 844 - 52 - 48 - 44 - 24, barHeight: 126, aspect: 4 / 3 }, { width: 366, slideHeight: 275, slack: 267 }],
  ];
  for (const [name, input, expected] of cases) {
    it(`${name}: ${expected.width} × ${expected.slideHeight}, ${expected.slack} px of slack`, () => {
      expect(stageBlock(input)).toEqual(expected);
    });
  }
  it("never depends on anything but the stage, the bar's height and the page's shape, and never passes the stage's width", () => {
    for (const stageWidth of [437, 672, 919, 1432]) {
      for (const stageHeight of [300, 592, 772, 1300]) {
        const block = stageBlock({ stageWidth, stageHeight, barHeight: 84, aspect: 16 / 9 });
        expect(block.width).toBeLessThanOrEqual(stageWidth);
        expect(block.slideHeight).toBe(Math.round(block.width / (16 / 9)));
        if (block.width > STAGE_MIN_BLOCK_PX) expect(block.slideHeight + 8 + 84).toBeLessThanOrEqual(stageHeight);
      }
    }
  });
  it("counts a page shape nobody has reported yet as 4:3", () => {
    const known = stageBlock({ stageWidth: 919, stageHeight: 772, barHeight: 84, aspect: 4 / 3 });
    for (const aspect of [null, undefined, 0, Number.NaN]) expect(stageBlock({ stageWidth: 919, stageHeight: 772, barHeight: 84, aspect })).toEqual(known);
  });
  it("keeps the bar usable in a stage too short for the rule (the stage then scrolls inside itself)", () => {
    expect(stageBlock({ stageWidth: 672, stageHeight: 150, barHeight: 84, aspect: 4 / 3 })).toEqual({ width: 320, slideHeight: 240, slack: 0 });
    expect(stageBlock({ stageWidth: 280, stageHeight: 150, barHeight: 84, aspect: 4 / 3 }).width).toBe(280);
  });
  it("is nothing until the stage has been measured", () => {
    expect(stageBlock({ stageWidth: 0, stageHeight: 0, barHeight: 0, aspect: 4 / 3 })).toEqual({ width: 0, slideHeight: 0, slack: 0 });
  });
});

describe("the size menu: Fit page, Fit width, 100 % and two magnifications", () => {
  it("lists five entries, each with its words and its data-fit", () => {
    expect([...SLIDE_FITS]).toEqual(["page", "width", "100", "150", "200"]);
    expect(SLIDE_FITS.map((fit) => plain(FIT_LABEL[fit]))).toEqual(["Fit page", "Fit width", "100 %", "150 %", "200 %"]);
    expect(FIT_DATA.page).toBe("contain");
    expect(new Set(Object.values(FIT_DATA)).size).toBe(SLIDE_FITS.length);
  });
  it("sizes the page by the fit: the whole page, its place's width, or a percentage of its own size", () => {
    const sizes = { pageFitWidth: 906.7, boxWidth: 919, naturalWidth: 720 };
    expect(slideWidth("page", sizes)).toBe(906);
    expect(slideWidth("width", sizes)).toBe(919);
    expect(PDF_CSS_UNITS).toBeCloseTo(96 / 72);
    expect(slideWidth("100", sizes)).toBe(960); // 720 pt = 10 in = 960 CSS px
    expect(slideWidth("150", sizes)).toBe(1440);
    expect(slideWidth("200", sizes)).toBe(1920);
  });
  it("draws nothing at a percentage of a size it does not know yet, and nothing in a place without a width", () => {
    expect(slideWidth("100", { pageFitWidth: 906, boxWidth: 919, naturalWidth: null })).toBe(0);
    expect(slideWidth("width", { pageFitWidth: 0, boxWidth: 0, naturalWidth: 720 })).toBe(0);
    expect(slideWidth("page", { pageFitWidth: Number.NaN, boxWidth: 919, naturalWidth: 720 })).toBe(0);
  });
  it("draws at the screen's own density, at most 2, and softer when the canvas would pass its pixel budget", () => {
    expect(canvasDensity(906, 680, 1)).toBe(1);
    expect(canvasDensity(906, 680, 3)).toBe(2);
    expect(canvasDensity(1920, 1440, 2)).toBe(2);
    const dense = canvasDensity(3840, 2880, 2);
    expect(dense).toBeLessThan(2);
    expect(3840 * dense * 2880 * dense).toBeLessThanOrEqual(16_000_000 + 1);
  });
  it("asks for a thumbnail at twice the row's width, in steps of 80, never past 640", () => {
    expect([thumbRenderWidth(64), thumbRenderWidth(136), thumbRenderWidth(160), thumbRenderWidth(264), thumbRenderWidth(900)]).toEqual([160, 320, 320, 560, 640]);
  });
});

describe("the pager band: what leaves it, in the specified order (5.3)", () => {
  it("takes one step under each of 900, 780, 640 and 480 px, and none while the width is unknown", () => {
    expect([...PAGER_STEPS]).toEqual([900, 780, 640, 480]);
    expect([0, 1440, 900].map(pagerLevelFor)).toEqual([0, 0, 0]);
    expect([899, 780].map(pagerLevelFor)).toEqual([1, 1]);
    expect([779, 640].map(pagerLevelFor)).toEqual([2, 2]);
    expect([639, 480].map(pagerLevelFor)).toEqual([3, 3]);
    expect([479, 366].map(pagerLevelFor)).toEqual([4, 4]);
  });
  it("drops the role's state words, then Note and the size menu, then the role button, then the words of Next content and full screen", () => {
    expect(pagerHolds(0)).toEqual({ roleState: true, noteAndFit: true, role: true, nextContentWords: true, fullScreen: true, smallIdentity: false });
    expect(pagerHolds(1)).toMatchObject({ roleState: false, noteAndFit: true, role: true });
    expect(pagerHolds(2)).toMatchObject({ roleState: false, noteAndFit: false, role: true, fullScreen: true });
    expect(pagerHolds(3)).toMatchObject({ noteAndFit: false, role: false, nextContentWords: true, fullScreen: true, smallIdentity: false });
    expect(pagerHolds(4)).toEqual({ roleState: false, noteAndFit: false, role: false, nextContentWords: false, fullScreen: false, smallIdentity: true });
  });
  it("never brings something back at a deeper step", () => {
    const kept = (level: number) => Object.entries(pagerHolds(level)).filter(([name, held]) => name !== "smallIdentity" && held).map(([name]) => name);
    for (let level = 1; level <= 4; level += 1) for (const name of kept(level)) expect(kept(level - 1)).toContain(name);
  });
  it("lists the eight roles: the five of which something is forced, then the three of which nothing is", () => {
    expect([...ROLE_ORDER]).toEqual(["instructional", "worked_example_or_question", "objectives_or_summary", "mixed", "unknown", "structural_title_or_section", "administrative", "blank"]);
  });
});

describe("paging inside a group says which member it goes to", () => {
  const at = (page: number) => identityOf(sampleLectureView, page);
  it("names the build or the step it moves to", () => {
    expect(plain(stepName("Next", at(4), at(5)))).toBe("Next page: build 3 of 3");
    expect(plain(stepName("Previous", at(4), at(3)))).toBe("Previous page: build 1 of 3");
    expect(plain(stepName("Next", at(6), at(7)))).toBe("Next page: step 2 of 2");
  });
  it("is a plain page step across slides, at the ends and without a source map", () => {
    expect(stepName("Next", at(5), at(6))).toBe("Next page");
    expect(stepName("Previous", at(3), at(2))).toBe("Previous page");
    expect(stepName("Next", at(12), null)).toBe("Next page");
    expect(stepName("Next", identityOf(sampleLectureViewWithoutR2, 4), identityOf(sampleLectureViewWithoutR2, 5))).toBe("Next page");
  });
});

describe("what is said about a page on request (9.2)", () => {
  it("states the grouping with its basis, state and signals, and that no PowerPoint match is recorded", () => {
    expect(identityDetails(sampleLectureView, 4).map(plain)).toEqual([
      "3 builds, pp. 3–5: inferred from the file, generated: same heading, ordered text containment",
      "PowerPoint file: no match is recorded for this page",
    ]);
    expect(plain(identityDetails(sampleLectureView, 6)[0]!)).toBe("2 steps, pp. 6–7: inferred from the file, agent-reviewed: equal text, drawings not compared");
  });
  it("says how a printed number and a PowerPoint match are known", () => {
    expect(identityDetails(sampleLectureView, 8).map(plain)).toEqual(["Slide 5: printed on the page", "Slide 6 (PowerPoint): matched by title and text, generated"]);
    expect(identityDetails(sampleLectureView, 2).map(plain)).toContain("Slide 2: printed on the page");
  });
  it("says nothing about a page the Brain sent no identity for", () => {
    expect(identityDetails(sampleLectureViewWithoutR2, 4)).toEqual([]);
  });
});

describe("outline rows: one per logical slide, every page reachable (5.2)", () => {
  it("has one row per logical slide of the sample and covers all twelve pages once", () => {
    const rows = outlineRows(sampleLectureView, 12);
    expect(rows.map((row) => row.pages)).toEqual([[1], [2], [3, 4, 5], [6, 7], [8], [9], [10], [11], [12]]);
    expect(rows.flatMap((row) => row.pages)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
  it("falls back to plain pages, nothing grouped and no role claimed, when the view names none", () => {
    const empty: LectureView = { ...sampleLectureViewWithoutR2, slides: [], page_count: null };
    const rows = outlineRows(empty, 5);
    expect(rows).toEqual(plainRows(5));
    expect(rows.map((row) => [row.kind, row.role, row.structural, row.known])).toEqual(Array.from({ length: 5 }, () => ["single", "unknown", false, false]));
    expect(outlineRows(empty, 0)).toEqual([]);
  });
  it("names a row by its physical page or pages, its title, its group line and a structural role, never by a slide number", () => {
    const name = (page: number) => plain(rowName(rowOf(sampleLectureView, page), rowOf(sampleLectureView, page).title));
    expect(name(4)).toBe("Pages 3–5: A sample mechanism, step by step, 3 builds, pp. 3–5");
    expect(name(6)).toBe("Pages 6–7: A sample diagram in two states, 2 steps, pp. 6–7");
    expect(name(1)).toBe("Page 1: Sample lecture 90 (synthetic), Structural (title or section)");
    expect(name(12)).toBe("Page 12: Sample housekeeping, Administrative");
    expect(name(11)).toBe(`Page 11: ${NO_TITLE}`);
    expect(name(8)).not.toMatch(/Slide \d/);
  });
});

describe("outline rows: plain figures and the no-range line", () => {
  const slides = slidesOf(sampleLectureView);
  const facts = (page: number) => {
    const result = outlineFacts(rowOf(sampleLectureView, page), slides);
    return { figures: plain(result.figures), noRange: result.noRange };
  };
  it("counts a question and a range once per row; a section range gives no time for the page alone and is not counted", () => {
    expect(facts(2)).toEqual({ figures: "1 question · 2 ranges", noRange: false });
    expect(facts(4)).toEqual({ figures: "3 questions · 1 range", noRange: false }); // three builds, one group range, each question once
    expect(facts(7)).toEqual({ figures: "1 range", noRange: false }); // one step has a range: the row is not without one
  });
  it("writes No recording range for the first four no-range states only", () => {
    expect(facts(8)).toEqual({ figures: "1 question", noRange: true }); // not discussed (searched)
    expect(facts(9)).toEqual({ figures: "1 question", noRange: true }); // audio not processed yet
    expect(facts(10)).toEqual({ figures: null, noRange: true }); // not matched yet
    expect(facts(11)).toEqual({ figures: null, noRange: false }); // recording unavailable: said at the transport
  });
  it("says ambiguous on a group only when no member has a range", () => {
    const view: LectureView = { ...sampleLectureView, slides: sampleLectureView.slides.map((slide) => (slide.page === 7 ? { ...slide, ranges: [], no_range: sampleLectureView.slides[5]!.no_range } : slide)) };
    expect(outlineFacts(rowOf(view, 6), slidesOf(view))).toEqual({ figures: null, noRange: true });
  });
  it("never writes it on a structural page, with or without a range", () => {
    expect(facts(1)).toEqual({ figures: null, noRange: false });
    expect(facts(12)).toEqual({ figures: "1 range", noRange: false }); // talk over an administrative page is still listed
  });
  it("claims nothing from a view without R2 fields", () => {
    const old = slidesOf(sampleLectureViewWithoutR2);
    for (const row of outlineRows(sampleLectureViewWithoutR2, 12)) expect(outlineFacts(row, old)).toEqual({ figures: null, noRange: false });
  });
  it("counts what an older view does carry: its questions and its timed links", () => {
    const base = sampleLectureViewWithoutR2.slides[1]!;
    const question = { question_id: "S90-Q01", title: null, family_id: null, family_revision: null, prompt: "p", prompt_in_index: true, collection: "S90", basis: "stated" as const, why: "" };
    const link = (id: string) => ({ annotation_id: id }) as SlideView["occurrences"][number];
    const view: LectureView = { ...sampleLectureViewWithoutR2, slides: sampleLectureViewWithoutR2.slides.map((slide) => (slide.page === 2 ? { ...base, questions: [question], occurrences: [link("an-1"), link("an-2")] } : slide)) };
    expect(plain(outlineFacts(rowOf(view, 2), slidesOf(view)).figures)).toBe("1 question · 2 ranges");
  });
});

describe("Find in the outline", () => {
  const slides = slidesOf(sampleLectureView);
  const rows = outlineRows(sampleLectureView, 12);
  it("keeps every row for an empty search", () => {
    expect(findRows(rows, "  ", slides)).toHaveLength(rows.length);
  });
  it("finds a page by its number, inside a group too, and by a part of its title", () => {
    expect(findRows(rows, "5", slides).map((row) => row.pages)).toEqual([[3, 4, 5]]);
    expect(findRows(rows, "12", slides).map((row) => row.pages)).toEqual([[12]]);
    expect(findRows(rows, "WORKED", slides).map((row) => row.firstPage)).toEqual([8]);
    expect(findRows(rows, "sample idea", slides).map((row) => row.firstPage)).toEqual([2, 9]);
  });
  it("finds nothing for a number or a word no page has", () => {
    expect(findRows(rows, "99", slides)).toEqual([]);
    expect(findRows(rows, "no such title", slides)).toEqual([]);
  });
});

describe("correcting the grouping of a page", () => {
  const choices = (page: number) => groupingChoices(sampleLectureView, page).map((choice) => [choice.id, choice.op, choice.pages]);
  it("offers, inside a group, to start a new slide here, to ungroup, and to join either neighbour as a run of adjacent pages", () => {
    expect(choices(4)).toEqual([["start_here", "split_before", [4]], ["split_all", "split", [3, 4, 5]], ["join_previous", "group", [2, 3, 4, 5]], ["join_next", "group", [3, 4, 5, 6, 7]]]);
  });
  it("does not offer to start a new slide at the first page of a group", () => {
    expect(choices(3).map(([id]) => id)).toEqual(["split_all", "join_previous", "join_next"]);
  });
  it("offers a single page only its neighbours, and none beyond the ends of the file", () => {
    expect(choices(1)).toEqual([["join_next", "group", [1, 2]]]);
    expect(choices(12)).toEqual([["join_previous", "group", [11, 12]]]);
    expect(choices(8)).toEqual([["join_previous", "group", [6, 7, 8]], ["join_next", "group", [8, 9]]]);
  });
  it("says in page numbers what each correction does", () => {
    const details = Object.fromEntries(groupingChoices(sampleLectureView, 4).map((choice) => [choice.id, plain(choice.detail)]));
    expect(details).toEqual({ start_here: "p. 3 stands as before; pp. 4–5 become the next slide.", split_all: "pp. 3–5 are no longer grouped.", join_previous: "pp. 2–5 become one slide.", join_next: "pp. 3–7 become one slide." });
  });
  it("offers nothing without a source map: there is nothing to correct against", () => {
    expect(groupingChoices(sampleLectureViewWithoutR2, 4)).toEqual([]);
    expect(groupingChoices({ ...sampleLectureView, source_map: { state: "unavailable", reason: "not_built" } }, 4)).toEqual([]);
  });
  it("sends the correction the API reads: a run to group (its kind only when said), the one page that starts a slide, the pages that stand alone", () => {
    const [startHere, splitAll, joinPrevious] = groupingChoices(sampleLectureView, 4);
    expect(groupingRequest(joinPrevious!, "none", "  ")).toEqual({ op: "group", pages: [2, 3, 4, 5], reason: "Corrected by the learner in the lecture workspace" });
    expect(groupingRequest(joinPrevious!, "build_group", "they add one line each")).toEqual({ op: "group", pages: [2, 3, 4, 5], value: "build_group", reason: "they add one line each" });
    expect(groupingRequest(startHere!, "step_group", "")).toEqual({ op: "split_before", pages: [4], reason: "Corrected by the learner in the lecture workspace" });
    expect(groupingRequest(splitAll!, "none", "")).toEqual({ op: "split", pages: [3, 4, 5], reason: "Corrected by the learner in the lecture workspace" });
  });
});

describe("taking back the learner's own corrections", () => {
  // The history in the spelling `GET …/source-map` returns (read from a fixture-profile Brain on 2026-10-06).
  const record = (revision: number, op: Record<string, unknown>, extra: Record<string, unknown> = {}): SourceMapOverrideRecord => ({
    revision, op, author: { kind: "learner", ref: "lecture-view" }, created_at: "2026-10-06T14:04:48Z", in_force: true, reason: "r", replaces: [], reverted_by: null, status: "applied", type: op.type, ...extra,
  });
  const history: SourceMapOverrideRecord[] = [
    record(1, { type: "role", page: 9, role: "worked_example_or_question" }),
    record(2, { type: "group", pages: [9, 10], kind: "animation_steps" }, { status: "superseded" }),
    record(3, { type: "split", pages: [9, 10] }),
    record(4, { type: "group", pages: [3, 4, 5, 6], kind: "manual_group" }, { reverted_by: 6 }),
    record(5, { type: "split", before_page: 5 }),
    record(7, { type: "role", page: 9, role: "mixed" }),
    record(8, { type: "group", pages: [12, 13], kind: "manual_group" }, { author: { kind: "agent", ref: "pass-2" } }),
    record(9, { type: "role", page: 2, role: "administrative" }, { author: "learner" }),
  ];
  const revisions = (page: number) => {
    const found = learnerCorrections(history, page);
    return { role: found.role.map((entry) => entry.revision), grouping: found.grouping.map((entry) => entry.revision) };
  };
  it("lists the corrections in force that touch the page, newest first, and leaves out superseded and reverted ones", () => {
    expect(revisions(9)).toEqual({ role: [7, 1], grouping: [3] });
    expect(revisions(10)).toEqual({ role: [], grouping: [3] });
    expect(revisions(3)).toEqual({ role: [], grouping: [] }); // its group was taken back already
  });
  it("counts a new slide started at the page, or right after it, as a correction of its grouping", () => {
    expect(revisions(5).grouping).toEqual([5]);
    expect(revisions(4).grouping).toEqual([5]);
    expect(revisions(6).grouping).toEqual([]);
  });
  it("is the learner's own only: an agent's correction is never offered for taking back", () => {
    expect(revisions(12)).toEqual({ role: [], grouping: [] });
    expect(revisions(2).role).toEqual([9]); // an author written as a plain word is read too
  });
  it("is empty without a history", () => {
    expect(learnerCorrections(undefined, 9)).toEqual({ role: [], grouping: [] });
    expect(learnerCorrections([], 9)).toEqual({ role: [], grouping: [] });
  });
  it("words each one and sends a further revision that undoes it (never a deletion)", () => {
    const ungrouped = takeBackChoice(history[2]!);
    expect(ungrouped).toMatchObject({ id: "take_back:3", op: "revert", revisions: [3], label: "Take back your correction" });
    expect(plain(ungrouped.detail)).toBe("Earlier you ungrouped pp. 9–10. Taking it back restores what held before it; it stays in the history.");
    expect(plain(takeBackChoice(history[3]!).detail)).toMatch(/^Earlier you grouped pp\. 3–6\./);
    expect(plain(takeBackChoice(history[4]!).detail)).toMatch(/^Earlier you started a new slide at p\. 5\./);
    expect(groupingRequest(ungrouped, "build_group", "")).toEqual({ op: "revert", value: [3], reason: "Taken back by the learner in the lecture workspace" });
  });
});
