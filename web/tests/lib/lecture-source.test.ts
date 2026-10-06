// The source side of the lecture workspace (design specification 5.2 – 5.4): the pure rules behind the outline rows, the
// pager band, the size menu and the stage block, on the synthetic sample of every R2 state (src/lib/fixtures/r2-sample).
// No browser and no pdf.js document: the figures asserted for the stage are the specification's own table (4.3, 4.4).
import { describe, expect, it } from "vitest";
import { sampleLectureView, sampleLectureViewWithoutR2 } from "@/lib/fixtures/r2-sample";
import { identityOf, rangesForPage } from "@/lib/r2";
import type { LectureView, SlideView, SourceMapOverrideRecord } from "@/lib/types";
import { NO_TITLE, findRows, outlineFacts, outlineKeyAction, outlineRows, plainRows, rangeNote, rowName, type OutlineStop } from "@/features/lecture/LectureOutline";
import { STAGE_MIN_BLOCK_PX, fileSize, groupingChoices, groupingRequest, learnerCorrections, offeredSessionNote, rangesFollowTheMap, slideFirstWidths, stageBlock, takeBackChoice } from "@/features/lecture/LectureWorkspace";
import { frameGroupWidth } from "@/app/WorkspaceFrame";
import { PAGER_LAST_LEVEL, PAGER_STEPS, ROLE_ORDER, identityDetails, pagerHolds, pagerLevelFor, stepName } from "@/features/lecture/Pager";
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
    expect(pagerHolds(0)).toEqual({ roleState: true, noteAndFit: true, role: true, nextContentWords: true, fullScreen: true, smallIdentity: false, wrapIdentity: false });
    expect(pagerHolds(1)).toMatchObject({ roleState: false, noteAndFit: true, role: true });
    expect(pagerHolds(2)).toMatchObject({ roleState: false, noteAndFit: false, role: true, fullScreen: true });
    expect(pagerHolds(3)).toMatchObject({ noteAndFit: false, role: false, nextContentWords: true, fullScreen: true, smallIdentity: false });
    expect(pagerHolds(4)).toEqual({ roleState: false, noteAndFit: false, role: false, nextContentWords: false, fullScreen: false, smallIdentity: true, wrapIdentity: false });
  });
  it("lets the identity line break between its parts only once nothing more can leave the band, and never for a width alone", () => {
    expect(PAGER_LAST_LEVEL).toBe(5);
    expect(pagerHolds(5)).toEqual({ roleState: false, noteAndFit: false, role: false, nextContentWords: false, fullScreen: false, smallIdentity: true, wrapIdentity: true });
    for (const width of [1, 200, 320, 366, 479]) expect(pagerLevelFor(width)).toBeLessThan(PAGER_LAST_LEVEL);
    for (let level = 0; level < PAGER_LAST_LEVEL; level += 1) expect(pagerHolds(level).wrapIdentity).toBe(false);
  });
  it("never brings something back at a deeper step", () => {
    const kept = (level: number) => Object.entries(pagerHolds(level)).filter(([name, held]) => name !== "smallIdentity" && name !== "wrapIdentity" && held).map(([name]) => name);
    for (let level = 1; level <= PAGER_LAST_LEVEL; level += 1) for (const name of kept(level)) expect(kept(level - 1)).toContain(name);
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
  /** A row as the outline draws it: standing on its first page, or on `shown` when that page of it is the one on screen. */
  const facts = (page: number, shown?: number) => {
    const result = outlineFacts(rowOf(sampleLectureView, page), slides, shown);
    return { figures: plain(result.figures), noRange: result.noRange };
  };
  it("counts what the range list of the page shows: its own ranges, then those of its section, each worded by its scope", () => {
    expect(facts(2)).toEqual({ figures: "1 question · 2 ranges · 1 for its section", noRange: false }); // the list of page 2 has three rows
    expect(facts(4)).toEqual({ figures: "3 questions · 1 range · 1 for its section", noRange: false }); // three builds: the group's range and the section's, each question once
    expect(facts(12)).toEqual({ figures: "1 range", noRange: false });
  });
  it("words ranges of the section alone as that, with their number", () => {
    expect(plain(rangeNote({ own: 0, section: 3 }))).toBe("3 ranges for its section only");
    expect(plain(rangeNote({ own: 0, section: 1 }))).toBe("1 range for its section only");
    expect(plain(rangeNote({ own: 1, section: 3 }))).toBe("1 range · 3 for its section");
    expect(plain(rangeNote({ own: 2, section: 0 }))).toBe("2 ranges");
    expect(rangeNote({ own: 0, section: 0 })).toBeNull();
    const view: LectureView = { ...sampleLectureView, slides: sampleLectureView.slides.map((slide) => (slide.page === 2 ? { ...slide, ranges: slide.ranges!.filter((range) => range.support.scope === "section") } : slide)) };
    const result = outlineFacts(rowOf(view, 2), slidesOf(view));
    expect(plain(result.figures)).toBe("1 question · 1 range for its section only");
    expect(result.noRange).toBe(false); // a page with a section range is not a page without a range
  });
  it("names the page of a range that only another page of the row carries, so the number of the page on screen stays the list's", () => {
    expect(facts(7)).toEqual({ figures: "1 range on p. 7", noRange: false }); // the row stands on page 6, whose list is empty; one step has a range
    expect(facts(7, 7)).toEqual({ figures: "1 range", noRange: false }); // on page 7 the list shows it
    expect(outlineFacts(rowOf(sampleLectureView, 6), slides, 6).listed).toEqual({ own: 0, section: 0 });
  });
  it("says for every page of the sample exactly the number of rows its range list shows", () => {
    for (const slide of sampleLectureView.slides) {
      const listed = outlineFacts(rowOf(sampleLectureView, slide.page), slides, slide.page).listed;
      const list = rangesForPage(sampleLectureView, slide.page);
      expect([slide.page, listed.own + listed.section]).toEqual([slide.page, list.ranges.length]);
      expect([slide.page, listed.own, listed.section]).toEqual([slide.page, list.pageRanges.length, list.sectionRanges.length]);
    }
  });
  it("writes No recording range for the first four no-range states only", () => {
    expect(facts(8)).toEqual({ figures: "1 question", noRange: true }); // not discussed (searched)
    expect(facts(9)).toEqual({ figures: "1 question", noRange: true }); // audio not processed yet
    expect(facts(10)).toEqual({ figures: null, noRange: true }); // not matched yet
    expect(facts(11)).toEqual({ figures: null, noRange: false }); // recording unavailable: said at the transport
  });
  it("says ambiguous on a group only when no member has a range", () => {
    const view: LectureView = { ...sampleLectureView, slides: sampleLectureView.slides.map((slide) => (slide.page === 7 ? { ...slide, ranges: [], no_range: sampleLectureView.slides[5]!.no_range } : slide)) };
    expect(outlineFacts(rowOf(view, 6), slidesOf(view))).toMatchObject({ figures: null, noRange: true });
  });
  it("never writes it on a structural page, with or without a range", () => {
    expect(facts(1)).toEqual({ figures: null, noRange: false });
    expect(facts(12)).toEqual({ figures: "1 range", noRange: false }); // talk over an administrative page is still listed
  });
  it("claims nothing from a view without R2 fields", () => {
    const old = slidesOf(sampleLectureViewWithoutR2);
    for (const row of outlineRows(sampleLectureViewWithoutR2, 12)) expect(outlineFacts(row, old)).toMatchObject({ figures: null, noRange: false });
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

describe("the outline by keyboard: one stop, the arrow keys move inside it", () => {
  // A page, an open group with its three pages, a closed group, a page.
  const stops: OutlineStop[] = [{ kind: "row" }, { kind: "row", group: true, open: true }, { kind: "member" }, { kind: "member" }, { kind: "member" }, { kind: "row", group: true, open: false }, { kind: "row" }];
  it("moves down and up through what is shown and stops at the ends", () => {
    expect(outlineKeyAction("ArrowDown", 0, stops)).toEqual({ type: "focus", index: 1 });
    expect(outlineKeyAction("ArrowDown", 1, stops)).toEqual({ type: "focus", index: 2 });
    expect(outlineKeyAction("ArrowUp", 5, stops)).toEqual({ type: "focus", index: 4 });
    expect(outlineKeyAction("ArrowDown", 6, stops)).toEqual({ type: "stay" });
    expect(outlineKeyAction("ArrowUp", 0, stops)).toEqual({ type: "stay" });
  });
  it("goes to the first and the last with Home and End", () => {
    expect(outlineKeyAction("Home", 4, stops)).toEqual({ type: "focus", index: 0 });
    expect(outlineKeyAction("End", 1, stops)).toEqual({ type: "focus", index: 6 });
  });
  it("opens a closed group with Right, and from an open one goes to its first page", () => {
    expect(outlineKeyAction("ArrowRight", 5, stops)).toEqual({ type: "open", index: 5 });
    expect(outlineKeyAction("ArrowRight", 1, stops)).toEqual({ type: "focus", index: 2 });
  });
  it("closes an open group with Left, and from one of its pages goes back to its row", () => {
    expect(outlineKeyAction("ArrowLeft", 1, stops)).toEqual({ type: "close", index: 1 });
    expect(outlineKeyAction("ArrowLeft", 4, stops)).toEqual({ type: "focus", index: 1 });
    expect(outlineKeyAction("ArrowLeft", 2, stops)).toEqual({ type: "focus", index: 1 });
  });
  it("keeps Left and Right for itself where they have nothing to do, so they never turn the page from inside the outline", () => {
    expect(outlineKeyAction("ArrowLeft", 0, stops)).toEqual({ type: "stay" });
    expect(outlineKeyAction("ArrowRight", 6, stops)).toEqual({ type: "stay" });
    expect(outlineKeyAction("ArrowLeft", 5, stops)).toEqual({ type: "stay" }); // a closed group
    expect(outlineKeyAction("ArrowRight", 3, stops)).toEqual({ type: "stay" }); // a page of a group
  });
  it("leaves every other key alone: Enter and Space press the row, Tab leaves the outline", () => {
    for (const key of ["Enter", " ", "Tab", "a", "PageDown", "Escape"]) expect(outlineKeyAction(key, 1, stops)).toBeNull();
    expect(outlineKeyAction("ArrowDown", -1, stops)).toBeNull(); // the key did not come from a row
    expect(outlineKeyAction("ArrowDown", 0, [])).toBeNull();
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

describe("a candidate file's size in words (the choice among several files)", () => {
  it("is whole kilobytes under a megabyte and megabytes with one decimal from there; a small file is never 0.0 MB", () => {
    expect([1, 1639, 2172, 1_048_575].map((bytes) => plain(fileSize(bytes)))).toEqual(["1 KB", "2 KB", "2 KB", "1024 KB"]);
    expect([1_048_576, 5_600_000].map((bytes) => plain(fileSize(bytes)))).toEqual(["1.0 MB", "5.3 MB"]);
  });
  it("holds the figure and its unit together with a non-breaking space", () => {
    expect(fileSize(2172)).toBe(`2${String.fromCharCode(0xa0)}KB`);
  });
});

describe("a correction of the map is followed by matching the recording again", () => {
  // The Brain serves no range that was matched under another map revision, so a correction would otherwise leave every
  // page of the lecture at "Not matched yet" with nothing on screen to run the matching again.
  const withAssociation = (state: "current" | "stale" | "not_run"): LectureView => ({ ...sampleLectureView,
    timing: { ...sampleLectureView.timing!, recordings: sampleLectureView.timing!.recordings.map((recording) => ({ ...recording, association: { ...recording.association, state } })) } });
  it("when the recording's ranges were matched to the pages at some time, current or already stale", () => {
    expect(sampleLectureView.timing!.recordings.length).toBeGreaterThan(0);
    expect(rangesFollowTheMap(withAssociation("current"))).toBe(true);
    expect(rangesFollowTheMap(withAssociation("stale"))).toBe(true);
  });
  it("and not when nothing was ever matched, when there is no recording, or when the view states no timing", () => {
    expect(rangesFollowTheMap(withAssociation("not_run"))).toBe(false);
    expect(rangesFollowTheMap({ ...sampleLectureView, timing: { ...sampleLectureView.timing!, recordings: [] } })).toBe(false);
    expect(rangesFollowTheMap(sampleLectureViewWithoutR2)).toBe(false);
  });
});

describe("a first-run layout made for the slide: the slide gets the width it can use, the panel the rest", () => {
  // Stage height = window − header − band − 12 px above and below (the figures of the stage-block table above).
  const at = (windowWidth: number, windowHeight: number, aspect: number | null) => {
    const header = windowWidth >= 2560 ? 64 : windowWidth >= 1920 ? 60 : 56;
    const band = windowWidth >= 2560 ? 52 : 48;
    const barHeight = windowWidth >= 2560 ? 100 : windowWidth >= 1920 ? 92 : 84;
    return slideFirstWidths({ windowWidth, groupWidth: frameGroupWidth(windowWidth), stageHeight: windowHeight - header - band - 24, barHeight, aspect });
  };
  const cases: Array<[string, [number, number, number], { outline: number; context: number; slide: [number, number]; slack: number }]> = [
    // A wide deck is bound by the stage's width at every size: the outline starts closed and the panel takes its floor.
    ["1440 × 900, 16:9", [1440, 900, 16 / 9], { outline: 0, context: 396, slide: [932, 524], slack: 156 }],
    ["1680 × 1050, 16:9", [1680, 1050, 16 / 9], { outline: 0, context: 396, slide: [1172, 659], slack: 171 }],
    ["1920 × 1080, 16:9", [1920, 1080, 16 / 9], { outline: 0, context: 422, slide: [1378, 775], slack: 73 }],
    ["2560 × 1440, 16:9", [2560, 1440, 16 / 9], { outline: 0, context: 520, slide: [1920, 1080], slack: 112 }],
    // A 4:3 deck is bound by the stage's height: the panel takes what the slide cannot use, and the outline opens where it costs the slide nothing.
    ["1280 × 800, 4:3", [1280, 800, 4 / 3], { outline: 0, context: 396, slide: [772, 579], slack: 1 }],
    ["1440 × 900, 4:3", [1440, 900, 4 / 3], { outline: 0, context: 409, slide: [906, 680], slack: 0 }],
    ["1680 × 1050, 4:3", [1680, 1050, 4 / 3], { outline: 0, context: 462, slide: [1106, 830], slack: 0 }],
    ["1920 × 1080, 4:3", [1920, 1080, 4 / 3], { outline: 240, context: 430, slide: [1130, 848], slack: 0 }],
    ["2560 × 1440, 4:3", [2560, 1440, 4 / 3], { outline: 288, context: 563, slide: [1589, 1192], slack: 0 }],
  ];
  for (const [name, [width, height, aspect], expected] of cases) {
    it(`${name}: outline ${expected.outline || "closed"}, panel ${expected.context}, slide ${expected.slide[0]} × ${expected.slide[1]}`, () => {
      const got = at(width, height, aspect)!;
      expect({ outline: got.outline, context: got.context, slide: [got.slide.width, got.slide.height], slack: got.slack }).toEqual(expected);
      expect(got.outline + got.stage + got.context).toBe(frameGroupWidth(width) - 24); // the three and both separators are the Group
    });
  }
  it("keeps the slide the largest object, the stage at least half the workspace, and the slide's share of the window from falling on a bigger one", () => {
    for (const aspect of [4 / 3, 16 / 9]) {
      const sizes: Array<[number, number]> = [[1440, 900], [1680, 1050], [1920, 1080], [2560, 1440]];
      for (const [width, height] of sizes) {
        const got = at(width, height, aspect)!;
        const header = width >= 2560 ? 64 : width >= 1920 ? 60 : 56;
        expect(got.slide.width * got.slide.height).toBeGreaterThan(got.context * (height - header - 24)); // R2-V1: the largest object
        expect(got.stage / (frameGroupWidth(width) - 24)).toBeGreaterThanOrEqual(0.5); // R2-V1: the stage is at least half the workspace
        expect((got.slide.width * got.slide.height) / (width * height)).toBeGreaterThanOrEqual(aspect > 1.5 ? 0.37 : 0.46); // today: 16:9 falls to 0.23, 4:3 to 0.31
      }
    }
  });
  it("opens the outline in a short window too, where the slide is bound by height whatever the outline does", () => {
    expect(at(1440, 700, 4 / 3)).toMatchObject({ outline: 192, context: 409 });
  });
  it("counts a shape nobody has reported yet as 4:3, and answers nothing before the stage has been measured", () => {
    expect(at(1920, 1080, null)).toEqual(at(1920, 1080, 4 / 3));
    expect(slideFirstWidths({ windowWidth: 1920, groupWidth: 1824, stageHeight: 0, barHeight: 0, aspect: 4 / 3 })).toBeNull();
    expect(slideFirstWidths({ windowWidth: 1920, groupWidth: 0, stageHeight: 948, barHeight: 92, aspect: 4 / 3 })).toBeNull();
  });
});

describe("a recording and transcript that are only offered to the lecture by a file name are said to be that", () => {
  // The spelling of `session_link_evidence` in the lecture view (docs/engineering/r2-read-api.md, D79).
  const evidence = { state: "suggested", rule: "lecture number in the recording or transcript file name equals the unit number", number: 3, session_id: "session-2026-09-17",
    files: ["Sample Lec 3 recording.m4a", "Sample Lec 3 transcript.txt"], note: "Suggested from file names only." };
  const offered = { ...sampleLectureView, session_link: "suggested_by_file_name", session_link_evidence: evidence } as LectureView;
  it("with the unit's number and the files that carry it, and never as linked or confirmed", () => {
    const note = offeredSessionNote(offered)!;
    expect(note.state).toBe("offered");
    expect(note.lead).toBe("Offered by file name.");
    expect(plain(note.sentence)).toBe("The course records link no session to this lecture. The recording and the transcript shown with it are offered because a file name carries this unit's number (3). "
      + "Nobody has confirmed the suggestion, and every recording range of this lecture rests on it.");
    expect(note.files).toEqual(["Sample Lec 3 recording.m4a", "Sample Lec 3 transcript.txt"]);
  });
  it("without the number or the files when the view does not state them, and never with invented ones", () => {
    const bare = offeredSessionNote({ ...sampleLectureView, session_link: "suggested_by_file_name" } as LectureView)!;
    expect(plain(bare.sentence)).toContain("because a file name carries this unit's number. ");
    expect(bare.files).toEqual([]);
  });
  it("says that nothing is offered when several sessions carry the unit's number", () => {
    const note = offeredSessionNote({ ...sampleLectureView, session_link: "none_recorded", session_link_evidence: { state: "ambiguous", number: 3, candidates: ["a", "b"], note: "n" } } as LectureView)!;
    expect(note.state).toBe("ambiguous");
    expect(note.lead).toBe("Nothing is offered.");
    expect(plain(note.sentence)).toBe("Two or more sessions carry this unit's number (3) in a file name, so none of them is offered as this lecture's recording.");
  });
  it("says nothing for a session the course records link, or when none is recorded", () => {
    expect(offeredSessionNote(sampleLectureView)).toBeNull();
    expect(offeredSessionNote({ ...sampleLectureView, session_link: "none_recorded" })).toBeNull();
    expect(offeredSessionNote({ ...sampleLectureView, session_link: "owner_related_sources", session_link_evidence: evidence } as LectureView)).toBeNull();
  });
});
