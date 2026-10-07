// The pure layout rules of the three-zone workspace frame (design specification 4.1, 4.3, 4.4, 5.4): which arrangement a
// window gets, the first-run layout, the bounds, what is stored, what a separator announces and the slide-and-bar block.
// No browser, no panel library: the figures asserted here are the specification's own table (4.3), so a change of a rule
// shows up as a changed stage width.
import { describe, expect, it } from "vitest";
import {
  FRAME_MIN_WIDTH, FRAME_SPECS, SEPARATOR_PX, contextDefaultPx, contextMinPx, firstRunLayout, frameArrangement, frameBounds, frameGroupWidth, layoutPixels, outlineDefaultPx, parseStoredLayout,
  railWidth, separatorValueText, stageBlockWidth,
} from "@/app/WorkspaceFrame";

const sum = (layout: Record<string, number>): number => Object.values(layout).reduce((total, value) => total + value, 0);

describe("which arrangement a window gets", () => {
  it("is one focused pane below 1180 px and the three-zone frame from 1180 px", () => {
    expect(FRAME_MIN_WIDTH).toBe(1180);
    expect(frameArrangement({ width: 1179 })).toBe("panes");
    expect(frameArrangement({ width: 1180 })).toBe("frame");
    expect(frameArrangement({ width: 390 })).toBe("panes");
    for (const width of [1679, 1680, 1920, 2560]) expect(frameArrangement({ width })).toBe("frame");
  });
  it("is one focused pane at every width when the text is enlarged", () => {
    for (const width of [1180, 1680, 1920, 2560]) expect(frameArrangement({ width, largeText: true })).toBe("panes");
  });
  it("is the slide and the bar alone in focus mode, whatever the width", () => {
    for (const width of [390, 1179, 1180, 2560]) expect(frameArrangement({ width, focus: true })).toBe("focus");
    expect(frameArrangement({ width: 1920, focus: true, largeText: true })).toBe("focus");
  });
});

describe("the shell measures the frame is computed from", () => {
  it("has no rail under 900 px, 76 px up to 1919 and 84 px from 1920", () => {
    expect([railWidth(899), railWidth(900), railWidth(1919), railWidth(1920), railWidth(2560)]).toEqual([0, 76, 76, 84, 84]);
  });
  it("gives the Group the window less the rail and the 12 px right gutter", () => {
    expect([frameGroupWidth(1180), frameGroupWidth(1440), frameGroupWidth(1680), frameGroupWidth(1920), frameGroupWidth(2560)]).toEqual([1092, 1352, 1592, 1824, 2464]);
  });
});

describe("default sizes", () => {
  it("lecture outline: clamp(184, 0.10 w + 48, 288)", () => {
    expect([1180, 1440, 1679, 1680, 1920, 2400, 2560].map((width) => outlineDefaultPx("lecture", width))).toEqual([184, 192, 216, 216, 240, 288, 288]);
  });
  it("concept outline: clamp(280, 0.22 w, 400), 440 from 2400", () => {
    expect([1180, 1440, 1680, 1920, 2399, 2400, 2560].map((width) => outlineDefaultPx("concepts", width))).toEqual([280, 317, 370, 400, 400, 440, 440]);
  });
  it("context panel: clamp(396, 0.362 w - 112, 720)", () => {
    expect([1179, 1180, 1403, 1440, 1679, 1680, 1920, 2299, 2560].map(contextDefaultPx)).toEqual([396, 396, 396, 409, 496, 496, 583, 720, 720]);
  });
});

describe("firstRunLayout", () => {
  // window, outline px (0 = collapsed), context px, stage px: the rows of the table in 4.3
  const LECTURE: Array<[number, number, number, number]> = [
    [1180, 0, 396, 672],
    [1440, 0, 409, 919],
    [1679, 0, 496, 1071],
    [1680, 216, 496, 856],
    [1920, 240, 583, 977],
    [2560, 288, 720, 1432],
  ];
  it.each(LECTURE)("lecture at %i px: outline %i, context %i, stage %i", (width, outline, context, stage) => {
    const layout = firstRunLayout("lecture", width);
    expect(Object.keys(layout).sort()).toEqual(["context", "outline", "stage"]);
    expect(sum(layout)).toBeCloseTo(100, 6);
    const px = layoutPixels(layout, frameGroupWidth(width));
    expect(px.outline).toBe(outline);
    expect(px.context).toBe(context);
    expect(px.stage).toBe(stage);
    expect(px.outline + px.stage + px.context + 2 * SEPARATOR_PX).toBe(frameGroupWidth(width));
  });
  it("collapses the lecture outline below 1680 px and opens it from 1680, by width alone", () => {
    expect(firstRunLayout("lecture", 1679).outline).toBe(0);
    expect(firstRunLayout("lecture", 1680).outline).toBeGreaterThan(0);
  });
  it("collapses the concept outline below 1440 px and opens it from 1440", () => {
    expect(firstRunLayout("concepts", 1439).outline).toBe(0);
    expect(layoutPixels(firstRunLayout("concepts", 1440), frameGroupWidth(1440)).outline).toBe(317);
    expect(layoutPixels(firstRunLayout("concepts", 2560), frameGroupWidth(2560)).outline).toBe(440);
  });
  it("still answers for a window below the frame (1179 px), where no Group is rendered", () => {
    const layout = firstRunLayout("lecture", 1179);
    expect(layout.outline).toBe(0);
    expect(sum(layout)).toBeCloseTo(100, 6);
    expect(frameArrangement({ width: 1179 })).toBe("panes");
  });
  it("keeps the lecture stage at more than half of the workspace at every default (R2-V1)", () => {
    for (const width of [1180, 1440, 1679, 1680, 1920, 2560]) {
      const group = frameGroupWidth(width);
      expect(layoutPixels(firstRunLayout("lecture", width), group).stage / group, `at ${width}`).toBeGreaterThan(0.5);
    }
  });
  it("keeps the concept stage above its 40 % share at every default, also with the tree open", () => {
    for (const width of [1180, 1440, 1680, 1920, 2560]) {
      const group = frameGroupWidth(width);
      expect(layoutPixels(firstRunLayout("concepts", width), group).stage, `at ${width}`).toBeGreaterThanOrEqual(frameBounds("concepts", group).stageMinPx);
    }
  });
  it("uses the measured Group width when one is given", () => {
    const px = layoutPixels(firstRunLayout("lecture", 1440, 1400), 1400);
    expect(px.context).toBe(409);
    expect(px.stage).toBe(1400 - 409 - 2 * SEPARATOR_PX);
  });
});

describe("bounds", () => {
  it("are the specification's pixel bounds for each workspace", () => {
    expect(FRAME_SPECS.lecture.outline).toMatchObject({ min: 184, max: 320, openFrom: 1680 });
    expect(FRAME_SPECS.concepts.outline).toMatchObject({ min: 280, max: 480, openFrom: 1440 });
    expect(FRAME_SPECS.lecture.context).toEqual({ min: 396, max: 820 });
    expect(FRAME_SPECS.concepts.context).toEqual({ min: 396, max: 820 });
    expect(FRAME_SPECS.lecture.storageKey).toBe("ll.frame.lecture");
    expect(FRAME_SPECS.concepts.storageKey).toBe("ll.frame.concepts");
    expect(FRAME_SPECS.lecture.groupId).toBe("ll-frame-lecture");
    expect(FRAME_SPECS.concepts.groupId).toBe("ll-frame-concepts");
  });
  it("the lecture's context panel is never narrower than its five tabs at the type size of the window (R2-V3)", () => {
    // Measured in the browser (web/e2e/flows/08-r2-visual-identity.spec.ts, R2-V3): five `ui` tabs with one count need a
    // row of 378 px at 14 px type, 395 px at 15 px (from 1920) and 414 px at 16 px (from 2400); the panel's sides take
    // 18 px below 1920 and 26 px from there.
    const needed = (width: number): number => (width < 1920 ? 378 + 18 : width < 2400 ? 395 + 26 : 414 + 26);
    for (const width of [1180, 1440, 1919, 1920, 2399, 2400, 2560, 3840]) expect(contextMinPx("lecture", width), `at ${width}`).toBeGreaterThanOrEqual(needed(width));
    expect([1180, 1919, 1920, 2399, 2400, 3840].map((width) => contextMinPx("lecture", width))).toEqual([396, 396, 422, 422, 442, 442]);
    expect([1180, 1920, 2560].map((width) => contextMinPx("concepts", width))).toEqual([396, 396, 396]); // three tabs: the specification's bound at every size
    // the stepped bound still leaves the stage its share and the outline its minimum
    for (const width of [1920, 2560]) expect(frameBounds("lecture", frameGroupWidth(width)).context.maxPx).toBeGreaterThan(contextMinPx("lecture", width));
  });
  it("keep the stage at no less than 40 % of the Group at every frame width (R2-V3)", () => {
    for (const width of [1180, 1280, 1440, 1679, 1680, 1920, 2560, 3840]) {
      const group = frameGroupWidth(width);
      const bounds = frameBounds("lecture", group);
      expect(bounds.stageMinPx / group, `at ${width}`).toBeGreaterThanOrEqual(0.4);
      expect(bounds.stageMinPx / group, `at ${width}`).toBeLessThan(0.42); // and no more than it has to
    }
  });
  it("hold together at 1180 px with the outline open: both minimum widths and the stage's 40 %", () => {
    const group = frameGroupWidth(1180);
    const bounds = frameBounds("lecture", group);
    expect(bounds.outline.minPx + bounds.context.minPx + bounds.stageMinPx + 2 * SEPARATOR_PX).toBeLessThanOrEqual(group);
  });
  it("never let the context panel pass 820 px or what leaves the stage its share", () => {
    const wide = frameBounds("lecture", frameGroupWidth(2560));
    expect(wide.context.maxPx).toBe(820);
    const narrow = frameBounds("lecture", frameGroupWidth(1180));
    expect(narrow.context.maxPx).toBe(frameGroupWidth(1180) - 2 * SEPARATOR_PX - narrow.stageMinPx);
    expect(narrow.context.maxPx).toBeLessThan(820);
    expect(narrow.context.maxPx).toBeGreaterThanOrEqual(narrow.context.minPx);
  });
  it("squeeze an open outline before the stage goes under its share", () => {
    const bounds = frameBounds("lecture", frameGroupWidth(1180));
    expect(bounds.outline.maxPx).toBe(frameGroupWidth(1180) - 2 * SEPARATOR_PX - bounds.stageMinPx - bounds.context.minPx);
    expect(frameBounds("lecture", frameGroupWidth(2560)).outline.maxPx).toBe(320);
  });
});

describe("a stored layout", () => {
  it("is read back when it names the three panels with shares that sum to 100", () => {
    expect(parseStoredLayout(JSON.stringify({ outline: 0, stage: 62.5, context: 37.5 }))).toEqual({ outline: 0, stage: 62.5, context: 37.5 });
    expect(parseStoredLayout(JSON.stringify({ outline: 14, stage: 54.4, context: 31.6 }))).toEqual({ outline: 14, stage: 54.4, context: 31.6 });
  });
  it("is ignored when nothing is stored, or it is not such a layout", () => {
    expect(parseStoredLayout(null)).toBeNull();
    expect(parseStoredLayout("")).toBeNull();
    expect(parseStoredLayout("not json")).toBeNull();
    expect(parseStoredLayout("[1,2,3]")).toBeNull();
    expect(parseStoredLayout(JSON.stringify({ outline: 10, stage: 50 }))).toBeNull();
    expect(parseStoredLayout(JSON.stringify({ outline: 10, stage: 50, context: 50 }))).toBeNull();
    expect(parseStoredLayout(JSON.stringify({ outline: -5, stage: 70, context: 35 }))).toBeNull();
    expect(parseStoredLayout(JSON.stringify({ outline: "10", stage: 55, context: 35 }))).toBeNull();
    expect(parseStoredLayout(JSON.stringify({ outline: 10, stage: 55, context: 35, extra: 0 }))).toBeNull();
  });
});

describe("what a separator announces", () => {
  it("says the width in whole pixels, and that the outline is closed", () => {
    expect(separatorValueText("context", 409.4)).toBe("Context panel 409 pixels wide");
    expect(separatorValueText("outline", 216)).toBe("Outline 216 pixels wide");
    expect(separatorValueText("outline", 0)).toBe("Outline closed");
  });
});

describe("the slide and the bar are one block of one width (5.4)", () => {
  // stage height = window height - header 56 - band 48 - 12 above - 12 below; bar 84 under 1920
  it("is bound by the height for a 4:3 page at 1440 x 900 with the outline closed", () => {
    expect(stageBlockWidth({ stageWidth: 919, stageHeight: 900 - 56 - 48 - 24, barHeight: 84, aspect: 4 / 3 })).toBe(906);
  });
  it("is bound by the width for a 16:9 page at 1440 x 900", () => {
    expect(stageBlockWidth({ stageWidth: 919, stageHeight: 900 - 56 - 48 - 24, barHeight: 84, aspect: 16 / 9 })).toBe(919);
  });
  it("never returns a negative width, and falls back to 4:3 when the page shape is unknown", () => {
    expect(stageBlockWidth({ stageWidth: 300, stageHeight: 40, barHeight: 84, aspect: 4 / 3 })).toBe(0);
    expect(stageBlockWidth({ stageWidth: 919, stageHeight: 772, barHeight: 84, aspect: null })).toBe(906);
  });
});

// The default-tab rule of the context panel (5.7) and the pane the address names (4.4): features/lecture/contracts.ts.
describe("which tab and which pane the lecture workspace shows", () => {
  it("is Questions the first time on a device", async () => {
    const { resolveTab, FIRST_TAB } = await import("@/features/lecture/contracts");
    expect(FIRST_TAB).toBe("questions");
    expect(resolveTab(null, null)).toBe("questions");
    expect(resolveTab("", "")).toBe("questions");
  });
  it("is the tab last used after that, unless the address names one", async () => {
    const { resolveTab } = await import("@/features/lecture/contracts");
    expect(resolveTab(null, "transcript")).toBe("transcript");
    expect(resolveTab("sources", "transcript")).toBe("sources");
    expect(resolveTab("tutor", null)).toBe("tutor");
  });
  it("does not take a pane that is not a tab, or an unknown word, for a tab", async () => {
    const { resolveTab } = await import("@/features/lecture/contracts");
    expect(resolveTab("slide", "concepts")).toBe("concepts");
    expect(resolveTab("outline", null)).toBe("questions");
    expect(resolveTab("nonsense", "nonsense")).toBe("questions");
  });
  it("offers seven panes in order, each in its zone, and falls back to the slide", async () => {
    const { LECTURE_PANES, resolvePane } = await import("@/features/lecture/contracts");
    expect(LECTURE_PANES.map((pane) => pane.label)).toEqual(["Slide", "Outline", "Tutor", "Questions", "Concepts", "Transcript", "Sources"]);
    expect(LECTURE_PANES.map((pane) => pane.zone)).toEqual(["stage", "outline", "context", "context", "context", "context", "context"]);
    expect(resolvePane("questions")).toBe("questions");
    expect(resolvePane("outline")).toBe("outline");
    expect(resolvePane(null)).toBe("slide");
    expect(resolvePane("nonsense")).toBe("slide");
  });
});
