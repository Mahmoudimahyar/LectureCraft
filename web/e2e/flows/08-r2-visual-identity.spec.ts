// Amendment R2, on-screen rows of the visual checks R2-V1 … R2-V10 and of the build and data identity checks
// R2-B1 … R2-B3, as the two on-screen tables state them (docs/features/evidence-alignment/test-plan.md for R2-V1 … V3,
// docs/features/workspace-access/test-plan.md for the rest). One test per check id.
//
// - Everything is measured in the browser on the built app with the synthetic fixture courses: boxes, computed styles,
//   rendered line boxes, pixels of the slide. Nothing is read from a token or a class name.
// - "Both themes": the file runs in two projects, and the theme of a run is the project's colour scheme (Light in
//   flows-desktop-light, Dark in flows-phone-dark). The sizes are set by each test, as its row names them.
// - R2-V1 … R2-V3 (and the lecture parts of the others) reach the lecture by ordinary navigation from Study and make no
//   request of their own. R2-V5, R2-B1 and R2-B2 compare what is on screen with the Brain's own answers, as their rows
//   ask. Only R2-B3 opens addresses directly, because an address that resolves to nothing is the case under test.
// - What a row asks for and this file cannot observe on the synthetic fixture is not asserted in a weaker form; it is
//   named in a comment at the test and in the engineer's report.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { COURSE, expectAccessible, expectNoHorizontalOverflow, pair, selectCourse } from "../helpers";
import { expect, test } from "../fixtures";
import { borderNesting, indicatorContrast, installMeasures, pillCensus, readingText, renderedLines, styleSignature, textCensus, textContrast, type PillFound } from "../r2-measure";

const DESKTOPS: ReadonlyArray<readonly [number, number]> = [[1440, 900], [1920, 1080], [2560, 1440]];
const NARROW: ReadonlyArray<readonly [number, number]> = [[390, 844], [768, 1024]];
/** The fixture's showcase unit: 14 pages, a build group, a recording with generated timing; its page 3 has three ranges. */
const SHOWCASE = "R2 showcase";
const THREE_RANGES_PAGE = 3;
const TABS = ["Tutor", "Questions", "Concepts", "Transcript", "Sources"] as const;
/** The pane of each destination on a narrow screen, by the test id of what it shows. */
const PANES: ReadonlyArray<readonly [string, string]> = [["Slide", "slide-canvas"], ["Outline", "lecture-outline"], ["Tutor", "tutor-panel"], ["Questions", "questions-tab"], ["Concepts", "concepts-tab"],
  ["Transcript", "transcript-tab"], ["Sources", "sources-tab"]];

const scheme = (testInfo: TestInfo): "light" | "dark" => (testInfo.project.use.colorScheme === "dark" ? "dark" : "light");
const plain = async (locator: Locator): Promise<string> => (await locator.innerText()).replace(/\s+/g, " ").trim();
const rendered = (page: Page, n: number) => expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", String(n));
const pageShown = async (page: Page): Promise<number> => Number(/PDF page (\d+)/.exec(await plain(page.getByTestId("slide-position")))?.[1] ?? NaN);
const media = (page: Page): Locator => page.getByTestId("lecture-media");
const mediaState = (page: Page) => media(page).evaluate((m: HTMLMediaElement) => ({ t: m.currentTime, paused: m.paused, src: m.currentSrc, mark: (m as unknown as { llMark?: string }).llMark ?? null }));

/** Study, with the fixture course chosen: where every ordinary navigation of this file starts. */
async function openStudy(page: Page): Promise<void> {
  await page.goto("/study");
  await expect(page.getByTestId("study-home")).toBeVisible();
  await selectCourse(page, COURSE);
  await expect(page.getByTestId("lecture-row").first()).toBeVisible();
}

/** Turn pages with the pager until `target` is on screen (a lecture opens where this device left it). */
async function turnTo(page: Page, target: number): Promise<void> {
  for (let guard = 0; guard < 40; guard += 1) {
    const now = await pageShown(page);
    if (now === target) break;
    await page.getByRole("button", { name: now < target ? /^Next page/ : /^Previous page/ }).click();
    await expect.poll(() => pageShown(page)).toBe(now + (now < target ? 1 : -1));
  }
  await rendered(page, target);
}

/** From Study, by its row, into a lecture of the fixture course, then to one of its pages with the pager. */
async function openLecture(page: Page, title: string, target: number): Promise<void> {
  await openStudy(page);
  await page.getByTestId("lecture-row").filter({ hasText: title }).getByRole("link").click();
  await expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", /\d+/);
  await turnTo(page, target);
}

/** A device that has not arranged the lecture workspace yet: the widths are then the defaults of the window's size. */
const forgetArrangement = (page: Page) => page.evaluate(() => {
  for (const key of Object.keys(window.localStorage)) if (key.startsWith("ll.frame.")) window.localStorage.removeItem(key);
});

interface Box { x: number; y: number; w: number; h: number; right: number; bottom: number }
interface Geometry {
  window: [number, number]; arrangement: string | null; outlineState: string | null;
  group: Box; stage: Box; context: Box; outline: Box; slide: Box; bar: Box; edge: Box;
  /** The largest box among everything else on the page that is an object of its own: panels, bars, pictures. */
  largestOther: { area: number; what: string };
  pageScroll: [number, number, number]; fit: string | null; frameScroll: [number, number]; sourceAspect: number;
  separator: { now: number; min: number; max: number; text: string | null };
}
/** Boxes of the three-zone frame as laid out. Workspace = the Group of the three panels; stage = its middle panel. */
const geometry = (page: Page): Promise<Geometry> => page.evaluate(() => {
  const box = (el: Element | null) => {
    const r = el?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom } : { x: 0, y: 0, w: 0, h: 0, right: 0, bottom: 0 };
  };
  const q = (selector: string) => document.querySelector(selector);
  const frame = q('[data-testid="workspace-frame"]') as HTMLElement | null;
  const surface = q('[data-testid="slide-surface"]');
  const canvas = q('[data-testid="slide-canvas"]') as HTMLCanvasElement | null;
  const slideFrame = q('[data-testid="slide-frame"]') as HTMLElement | null;
  const edge = q("#panel-edge");
  let largestOther = { area: 0, what: "" };
  const others = document.querySelectorAll('[data-testid="context-panel"], [data-testid="lecture-outline"], [data-testid="transport"], header, nav, aside, img, canvas, video, svg, iframe, [role="dialog"]');
  for (const el of others) {
    if (surface && (surface.contains(el) || el.contains(surface))) continue;
    if (!(el as HTMLElement).checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height > largestOther.area) largestOther = { area: r.width * r.height, what: `${el.tagName.toLowerCase()} ${el.getAttribute("data-testid") ?? el.getAttribute("aria-label") ?? ""}`.trim() };
  }
  const root = document.documentElement;
  return {
    window: [window.innerWidth, window.innerHeight], arrangement: frame?.dataset.arrangement ?? null, outlineState: frame?.dataset.outline ?? null,
    group: box(q("#ll-frame-lecture")), stage: box(q("#stage")), context: box(q("#context")), outline: box(q("#outline")), slide: box(surface), bar: box(q('[data-testid="transport"]')), edge: box(edge),
    largestOther,
    pageScroll: [root.scrollWidth - window.innerWidth, root.scrollHeight - window.innerHeight, window.scrollX + window.scrollY],
    fit: slideFrame?.dataset.fit ?? null, frameScroll: slideFrame ? [slideFrame.scrollWidth - slideFrame.clientWidth, slideFrame.scrollHeight - slideFrame.clientHeight] : [-1, -1],
    sourceAspect: canvas ? canvas.width / canvas.height : 0,
    separator: { now: Number(edge?.getAttribute("aria-valuenow")), min: Number(edge?.getAttribute("aria-valuemin")), max: Number(edge?.getAttribute("aria-valuemax")), text: edge?.getAttribute("aria-valuetext") ?? null },
  } as Geometry;
});

/**
 * A measurement taken when the layout has stopped moving (a panel change runs for 180 ms, and the slide is fitted again
 * by an observer of the stage's size, one or two frames after the stage has its new width). Each reading is taken after
 * the page has drawn two frames, and the layout counts as settled when three readings in a row are the same.
 */
async function settled(page: Page): Promise<Geometry> {
  const drawn = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const key = (m: Geometry) => JSON.stringify([m.stage, m.context, m.outline, m.slide, m.bar]);
  let last = await geometry(page);
  let same = 0;
  await expect.poll(async () => {
    await drawn();
    const next = await geometry(page);
    same = key(next) === key(last) ? same + 1 : 0;
    last = next;
    return same >= 2;
  }, { intervals: [120, 120, 150, 200, 300] }).toBe(true);
  return last;
}

/** Open the outline if this size starts with it closed: every other pane stays at its default size. */
async function withOutlineOpen(page: Page): Promise<Geometry> {
  const frame = page.getByTestId("workspace-frame");
  if ((await frame.getAttribute("data-outline")) === "closed") await page.getByTestId("outline-toggle").click();
  await expect(frame).toHaveAttribute("data-outline", "open");
  await expect(page.getByTestId("lecture-outline")).toBeVisible();
  return settled(page);
}

/** The R2-V1 measures of an open-outline layout: the stage is at least half of the workspace, the slide is the largest object. */
function expectSlideLeads(m: Geometry, label: string): void {
  expect(m.arrangement, `${label}: the three-zone frame`).toBe("frame");
  expect(m.stage.w / m.group.w, `${label}: the stage's share of the workspace width (stage ${Math.round(m.stage.w)} of ${Math.round(m.group.w)} px)`).toBeGreaterThanOrEqual(0.5);
  expect(m.slide.w * m.slide.h, `${label}: the slide (${Math.round(m.slide.w)}×${Math.round(m.slide.h)}) is larger than the largest other object, ${m.largestOther.what}`).toBeGreaterThan(m.largestOther.area);
}

/** The slide is fitted to its stage (R1-U2): whole, undistorted, in view, not scrolling inside its frame. */
function expectSlideFitted(m: Geometry, label: string): void {
  expect(m.fit, `${label}: fit`).toBe("contain");
  expect(m.frameScroll, `${label}: the slide does not scroll inside its own frame`).toEqual([0, 0]);
  expect(Math.abs(m.slide.w / m.slide.h - m.sourceAspect), `${label}: the slide is not distorted`).toBeLessThan(0.01);
  expect(m.slide.x, `${label}: the slide starts inside the stage`).toBeGreaterThanOrEqual(m.stage.x - 0.5);
  expect(m.slide.right, `${label}: the slide ends inside the stage`).toBeLessThanOrEqual(m.stage.right + 0.5);
  expect(m.slide.y).toBeGreaterThanOrEqual(0);
  expect(m.slide.bottom, `${label}: the slide is inside the window`).toBeLessThanOrEqual(m.window[1]);
}

/**
 * Controls of the recording that are on screen now, counted over the whole page: by test id and by what they are.
 * A control counts when it is laid out and can be operated; opacity is not asked, because the scrubber is a transparent
 * range input lying over the track that is drawn for it.
 */
const transportCensus = (page: Page) => page.evaluate(() => {
  const seen = (el: Element) => (el as HTMLElement).checkVisibility({ checkVisibilityCSS: true }) && el.getBoundingClientRect().width > 0 && !el.closest("[inert]");
  const all = (selector: string) => Array.from(document.querySelectorAll(selector)).filter(seen);
  const name = (el: Element) => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
  const play = new Set<Element>([...all('[data-testid="play-toggle"], [data-testid="dock-play"], media-play-button'), ...all('button, [role="button"]').filter((el) => /^(play|pause)\b/i.test(name(el)))]);
  const timelines = new Set<Element>([...all('[data-testid="clip-scrubber"], media-time-range'), ...all('input[type="range"], [role="slider"]').filter((el) => /position|seek|timeline/i.test(name(el)))]);
  const readouts = new Set<Element>([...all('[data-testid="time-readout"], media-time-display'), ...all("p, span, div, time").filter((el) => el.children.length === 0 && /^\d+:\d\d\s*\/\s*\d+:\d\d$/.test((el.textContent ?? "").trim()))
    .map((el) => el.closest('[data-testid="time-readout"]') ?? el)]);
  const mediaElements = document.querySelectorAll("audio, video");
  return { play: play.size, timelines: timelines.size, readouts: readouts.size, media: mediaElements.length, nativeControls: Array.from(mediaElements).filter((m) => (m as HTMLMediaElement).controls).length,
    controllers: document.querySelectorAll("media-controller").length, sliders: all('input[type="range"], [role="slider"]').length };
});

/** Start the recording with the one play control and wait until it moves. The media element is marked, so a later check can tell it is the same element. */
async function startPlayback(page: Page, control = "play-toggle"): Promise<void> {
  await media(page).evaluate((m: HTMLMediaElement) => { (m as unknown as { llMark?: string }).llMark = "r2-check"; });
  const before = (await mediaState(page)).t;
  await page.getByTestId(control).click();
  await expect.poll(async () => (await mediaState(page)).paused).toBe(false);
  await expect.poll(async () => (await mediaState(page)).t).toBeGreaterThan(before + 0.2);
}

/** The five sizes of the UI contract's "Test viewports" for these checks. */
const ALL_SIZES: ReadonlyArray<readonly [number, number]> = [...DESKTOPS, ...NARROW];
/** Words a state or basis label of the shared contract starts with (UI contract R2: anchor states, evidence states, range kinds). */
const STATE_LABEL = /^(Exact|Stated|Suggested link|Concept-related|Inspected|No suggested link|Unknown|Not applicable|Not separately observed|Assisted|Independent|Suggestion|Reviewed|Entered by you|Generated|Agent-reviewed|Human-confirmed|Confirmed by you)\b/;
/** A pill is allowed for an interactive filter, a state label of the shared contract or a link to a source reference; a count or a plain fact in a pill is not. */
const wrongPills = (pills: PillFound[]): string[] => pills.filter((pill) => /^[\d\s.,:/–-]+$/.test(pill.text) || /^\d+\s+\w+$/.test(pill.text) || !(pill.interactive || STATE_LABEL.test(pill.text))).map((pill) => `"${pill.text}" ${pill.where}`);
/** Where running prose of the app is read: paragraphs, list items, definitions, quotations, the composer. */
const READING_CONTENT = ["p", "li", "dd", "blockquote", "textarea"];

/** The folder the evidence of this run is kept in, beside the test results (synthetic fixture content only). */
function evidenceFolder(testInfo: TestInfo, ...parts: string[]): string {
  const folder = resolve(testInfo.project.outputDir, "..", "r2-visual", ...parts);
  mkdirSync(folder, { recursive: true });
  return folder;
}

/** The type scale the token source declares: for each step of the window's width, the seven sizes in px. */
function declaredSizes(testInfo: TestInfo, width: number): number[] {
  const tokens = JSON.parse(readFileSync(resolve(testInfo.config.rootDir, "..", "..", "docs", "project", "design-tokens.json"), "utf8")) as { typography?: { scale_from_px?: number[]; scale_px?: Record<string, { size?: number[] }> } };
  const from = tokens.typography?.scale_from_px ?? [];
  const step = from.reduce((at, start, index) => (width >= start ? index : at), -1);
  return Object.values(tokens.typography?.scale_px ?? {}).map((role) => role.size?.[step]).filter((size): size is number => typeof size === "number");
}

/** Brightness of a picture (an image or a canvas) on a coarse grid, to tell which page of a file it shows. */
const pictureSignature = (locator: Locator): Promise<number[]> => locator.evaluate((source) => {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 24;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 32, 24);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source as HTMLImageElement | HTMLCanvasElement, 0, 0, 32, 24);
  const data = ctx.getImageData(0, 0, 32, 24).data;
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 4) out.push(Math.round(0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!));
  return out;
});
const pictureDistance = (a: number[], b: number[]): number => a.reduce((sum, value, index) => sum + Math.abs(value - (b[index] ?? 0)), 0) / Math.max(1, a.length);

/** "2 min 30 s", "45 s", "1 h 5 min": a length as the app words it. */
function lengthWords(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const [hours, minutes, seconds] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  if (hours) return [`${hours} h`, ...(minutes ? [`${minutes} min`] : [])].join(" ");
  return minutes ? [`${minutes} min`, ...(seconds ? [`${seconds} s`] : [])].join(" ") : `${seconds} s`;
}
const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** Keyboard focus on a control, as a learner who tabs to it gets it: the focus ring is then drawn. */
async function focusByKeyboard(page: Page, locator: Locator): Promise<void> {
  await page.keyboard.press("Tab"); // the last input was the keyboard
  await locator.focus();
  expect(await locator.evaluate((el) => el.matches(":focus-visible") && document.activeElement === el), "the control has visible keyboard focus").toBe(true);
}

/** Everything in the document whose transition or animation would still take time. */
const movingParts = (page: Page) => page.evaluate(() => {
  const seconds = (value: string) => Math.max(0, ...value.split(",").map((part) => (part.trim().endsWith("ms") ? parseFloat(part) / 1000 : parseFloat(part) || 0)));
  const found: string[] = [];
  let measured = 0;
  for (const el of document.querySelectorAll("*")) {
    for (const pseudo of [null, "::before", "::after"]) {
      const style = getComputedStyle(el, pseudo);
      if (pseudo && (style.content === "none" || style.content === "normal")) continue;
      measured += 1;
      const transition = seconds(style.transitionDuration);
      const animation = style.animationName === "none" ? 0 : seconds(style.animationDuration);
      if (transition > 0.001 || animation > 0.001) found.push(`${el.tagName.toLowerCase()}${pseudo ?? ""} ${el.getAttribute("data-testid") ?? String(el.getAttribute("class") ?? "").slice(0, 40)} transition ${transition}s animation ${animation}s`);
    }
  }
  return { measured, found: found.slice(0, 12) };
});

test.describe("R2 visual and identity checks", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await installMeasures(page);
    await pair(page);
    await expect(page.locator("html"), "the theme of this run is the project's colour scheme").toHaveAttribute("data-theme", scheme(testInfo));
  });

  test("R2-V1 at the three desktop sizes the stage is at least half of the workspace, the slide is the largest object, and collapsing the outline is one remembered click", async ({ page }) => {
    test.setTimeout(180_000);
    const grew: string[] = [];
    for (const [width, height] of DESKTOPS) {
      const label = `${width}x${height}`;
      await page.setViewportSize({ width, height });
      await forgetArrangement(page);
      await openLecture(page, SHOWCASE, THREE_RANGES_PAGE);
      const open = await withOutlineOpen(page); // the outline open, the other panes at their default sizes
      expectSlideLeads(open, label);
      expectSlideFitted(open, label);
      expect(open.pageScroll, `${label}: the page does not scroll`).toEqual([0, 0, 0]);

      const toggle = page.getByTestId("outline-toggle");
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await toggle.click(); // one click
      await expect(page.getByTestId("workspace-frame")).toHaveAttribute("data-outline", "closed");
      await expect(page.getByTestId("lecture-outline")).toBeHidden();
      const closed = await settled(page);
      expect(closed.outline.w, `${label}: the outline is closed`).toBeLessThanOrEqual(1);
      expect(closed.stage.w - open.stage.w, `${label}: the stage takes the width the outline had (${Math.round(open.outline.w)} px)`).toBeGreaterThanOrEqual(open.outline.w - 1.5);
      expect(Math.abs(closed.context.w - open.context.w), `${label}: the context panel keeps its width`).toBeLessThanOrEqual(1);
      expectSlideFitted(closed, `${label} closed`);
      // The slide's rendered width grows by what the outline gives back, wherever the open outline was what held the
      // slide back. Where the default layout already gave the slide all the height the stage has (ground under the bar
      // no more than the stage's own 12 px margin), a wider stage cannot make a slide of this shape any larger: there
      // the slide must keep its size, and the clause "grows" is not observable on the fixture's 4:3 decks.
      const spareUnderBar = open.stage.bottom - open.bar.bottom;
      if (spareUnderBar > 13) {
        expect(closed.slide.w, `${label}: the slide's rendered width grows when the outline is collapsed (${Math.round(open.slide.w)} → ${Math.round(closed.slide.w)} px)`).toBeGreaterThan(open.slide.w + 1);
        grew.push(label);
      } else {
        expect(closed.stage.bottom - closed.bar.bottom, `${label}: the slide already fills the height of the stage`).toBeLessThanOrEqual(13);
        expect(Math.abs(closed.slide.w - open.slide.w), `${label}: the slide keeps the size it had`).toBeLessThanOrEqual(1);
      }

      await page.reload();
      await rendered(page, THREE_RANGES_PAGE);
      await expect(page.getByTestId("workspace-frame"), `${label}: the collapsed outline is still there after a reload`).toHaveAttribute("data-outline", "closed");
      await expect(page.getByTestId("lecture-outline")).toBeHidden();
      await expect(page.getByTestId("outline-toggle")).toHaveAttribute("aria-pressed", "false");
      const reloaded = await settled(page);
      expect(Math.abs(reloaded.slide.w - closed.slide.w), `${label}: the slide is as wide as before the reload`).toBeLessThanOrEqual(1);
      expect(Math.abs(reloaded.stage.w - closed.stage.w)).toBeLessThanOrEqual(1);
    }
    // On the fixture the growth of the slide is observed where the open outline costs the slide width: at 1440×900.
    expect(grew, "sizes at which the slide was seen to grow").toContain("1440x900");
    test.info().annotations.push({ type: "R2-V1 slide growth observed at", description: grew.join(", ") });
  });

  test("R2-V2 with each of the five tabs open the page has one play control, one timeline and one readout in a bar of at most 128 px that names the selected range", async ({ page }) => {
    test.setTimeout(180_000);
    for (const [width, height] of DESKTOPS) {
      const label = `${width}x${height}`;
      await page.setViewportSize({ width, height });
      await forgetArrangement(page);
      await openLecture(page, SHOWCASE, THREE_RANGES_PAGE);
      const bar = page.getByTestId("transport");
      await expect(bar).toHaveAttribute("data-mode", "range");
      const tablist = page.getByRole("tablist", { name: "Context panel" });
      for (const name of TABS) {
        const tab = tablist.getByRole("tab", { name: new RegExp(`^${name}( \\d+)?$`) });
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        await expect(page.locator(`#ll-ctx-${name.toLowerCase()}`)).toBeVisible();
        const census = await transportCensus(page);
        expect([census.play, census.timelines, census.readouts], `${label}, ${name}: play controls, timelines, time readouts on the whole page`).toEqual([1, 1, 1]);
        expect([census.media, census.nativeControls, census.controllers, census.sliders], `${label}, ${name}: one media element, no native controls, one controller, one slider`).toEqual([1, 0, 1, 1]);
        const m = await geometry(page);
        expect(m.bar.h, `${label}, ${name}: height of the transport bar`).toBeLessThanOrEqual(128);
        expect(m.bar.h).toBeGreaterThan(0);
        expect([m.bar.y >= 0, m.bar.bottom <= m.window[1] + 0.5, m.bar.x >= 0, m.bar.right <= m.window[0] + 0.5], `${label}, ${name}: the bar is inside the window`).toEqual([true, true, true, true]);
        expect(m.pageScroll, `${label}, ${name}: the page does not scroll`).toEqual([0, 0, 0]);
      }

      // the one line of the selected range: its start–end, "range 1 of 3", previous and next
      const times = await plain(bar.getByTestId("range-times"));
      expect(times, `${label}: start–end of the selected range`).toMatch(/^\d+:\d\d – \d+:\d\d$/);
      const [start, end] = times.split(" – ") as [string, string];
      await expect(bar.getByTestId("play-toggle")).toHaveAccessibleName(`Play the range ${start} to ${end}`);
      expect(await plain(bar.getByTestId("range-stepper"))).toBe("Range 1 of 3");
      await expect(bar.getByRole("button", { name: "Previous range" })).toBeVisible();
      await expect(bar.getByRole("button", { name: "Previous range" })).toBeDisabled(); // the first of three
      await expect(bar.getByRole("button", { name: "Next range" })).toBeEnabled();

      // the range list: three rows, the bar as high as before, the page where it was, no second media element
      const before = await geometry(page);
      await bar.getByTestId("range-list-toggle").click();
      const list = page.getByTestId("range-list");
      await expect(list).toBeVisible();
      await expect(list.getByTestId("range-row")).toHaveCount(3);
      await expect(list.getByRole("radio", { checked: true })).toContainText(times); // the row of the range the bar names
      const withList = await settled(page);
      expect(withList.bar.h, `${label}: the bar keeps its height with the range list open`).toBe(before.bar.h);
      expect([withList.bar.y, withList.slide.w, withList.slide.h], `${label}: neither the bar nor the slide moves or shrinks`).toEqual([before.bar.y, before.slide.w, before.slide.h]);
      expect(withList.pageScroll, `${label}: the page does not scroll with the range list open`).toEqual([0, 0, 0]);
      const census = await transportCensus(page);
      expect([census.media, census.play, census.timelines, census.readouts], `${label}: the list adds no media element, play control, timeline or readout`).toEqual([1, 1, 1, 1]);
      const listBox = (await list.boundingBox())!;
      expect([listBox.y >= 0, listBox.y + listBox.height <= height + 0.5], `${label}: the list is inside the window`).toEqual([true, true]);
      await page.keyboard.press("Escape");
      await expect(list).toBeHidden();

      // the next range becomes the one the bar names
      await bar.getByRole("button", { name: "Next range" }).click();
      expect(await plain(bar.getByTestId("range-stepper"))).toBe("Range 2 of 3");
      expect(await plain(bar.getByTestId("range-times"))).not.toBe(times);
      expect((await geometry(page)).bar.h, `${label}: the bar keeps its height on another range`).toBe(before.bar.h);
      await bar.getByRole("button", { name: "Previous range" }).click(); // and back (the lecture remembers the range chosen)
      expect(await plain(bar.getByTestId("range-stepper"))).toBe("Range 1 of 3");
      expect(await plain(bar.getByTestId("range-times"))).toBe(times);
    }
  });

  test("R2-V3 the five tabs are text in order with no overflow menu, and the panel resizes by pointer and keyboard to both bounds with the stage at 40 % or more", async ({ page }) => {
    test.setTimeout(240_000);
    for (const [width, height] of DESKTOPS) {
      const label = `${width}x${height}`;
      await page.setViewportSize({ width, height });
      await forgetArrangement(page);
      await openLecture(page, SHOWCASE, THREE_RANGES_PAGE);
      const tablist = page.getByRole("tablist", { name: "Context panel" });

      /** The five labels as drawn: their words, whether each is whole inside the panel, and anything else in the tab row. */
      const tabRow = () => tablist.evaluate((list) => {
        const panel = (list.closest('[data-testid="context-panel"]') ?? list).getBoundingClientRect();
        const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'));
        const row = list.parentElement ?? list;
        return {
          labels: tabs.map((tab) => (tab.innerText ?? "").replace(/\s+/g, " ").trim()),
          whole: tabs.map((tab) => {
            const r = tab.getBoundingClientRect();
            const text = document.createRange();
            text.selectNodeContents(tab);
            const words = text.getBoundingClientRect();
            return tab.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && r.width > 0 && words.left >= panel.left - 0.5 && words.right <= panel.right + 0.5 && r.left >= panel.left - 0.5 && r.right <= panel.right + 0.5
              && tab.scrollWidth <= tab.clientWidth + 1 && parseFloat(getComputedStyle(tab).fontSize) >= 12;
          }),
          order: tabs.map((tab) => Math.round(tab.getBoundingClientRect().left)),
          scrolls: list.scrollWidth - list.clientWidth,
          extras: Array.from(row.querySelectorAll('button:not([role="tab"]), [aria-haspopup], select, [role="combobox"]')).map((el) => el.getAttribute("aria-label") ?? el.textContent ?? el.tagName),
        };
      });
      const expectTabs = async (when: string) => {
        const row = await tabRow();
        expect(row.labels.map((text) => text.replace(/ \d+$/, "")), `${label}, ${when}: the five tab labels, in order`).toEqual([...TABS]);
        expect(row.whole, `${label}, ${when}: each label is whole and inside the panel`).toEqual([true, true, true, true, true]);
        expect([...row.order].sort((a, b) => a - b), `${label}, ${when}: left to right in that order`).toEqual(row.order);
        expect(row.scrolls, `${label}, ${when}: the tab row does not scroll`).toBeLessThanOrEqual(1);
        expect(row.extras, `${label}, ${when}: no overflow menu or other control in the tab row`).toEqual([]);
      };
      await expectTabs("default width");

      // a draft and playback, started before the panel is resized
      await tablist.getByRole("tab", { name: "Tutor" }).click();
      const composer = page.locator("#tutor-composer");
      const draft = `A draft kept while the panel is resized at ${label}.`;
      await composer.fill(draft);
      await startPlayback(page);
      const playing = await mediaState(page);

      const edge = page.locator("#panel-edge");
      await expect(edge).toHaveAttribute("role", "separator");
      await expect(edge).toHaveAccessibleName("Resize the context panel");
      const start = await settled(page);
      const announced = (m: Geometry) => Number(/(\d+) pixels wide/.exec(m.separator.text ?? "")?.[1] ?? NaN);
      expect(Math.abs(announced(start) - start.context.w), `${label}: the announced width is the width on screen`).toBeLessThanOrEqual(1);

      // keyboard: arrows step, Home and End go to the bounds
      await edge.focus();
      await expect(edge).toBeFocused();
      await page.keyboard.press("ArrowLeft");
      const stepped = await settled(page);
      expect(stepped.context.w, `${label}: Arrow Left makes the panel wider`).toBeGreaterThan(start.context.w + 8);
      expect(Math.abs(announced(stepped) - stepped.context.w), `${label}: the new width is announced`).toBeLessThanOrEqual(1);
      await page.keyboard.press("ArrowRight");
      const back = await settled(page);
      expect(Math.abs(back.context.w - start.context.w), `${label}: Arrow Right takes the step back`).toBeLessThanOrEqual(1.5);

      await page.keyboard.press("Home");
      const widest = await settled(page);
      expect(widest.separator.now, `${label}: Home is the bound the separator announces`).toBe(widest.separator.min);
      expect(widest.context.w, `${label}: the widest panel`).toBeGreaterThan(start.context.w);
      expect(widest.context.w, `${label}: never wider than 820 px`).toBeLessThanOrEqual(820.5);
      expect(widest.stage.w / widest.group.w, `${label}: at the panel's widest the stage keeps 40 % of the workspace (stage ${Math.round(widest.stage.w)} of ${Math.round(widest.group.w)} px)`).toBeGreaterThanOrEqual(0.4);
      expect(widest.context.w >= 819.5 || widest.stage.w / widest.group.w < 0.42, `${label}: the bound is 820 px or the stage's 40 %, whichever comes first`).toBe(true);
      expectSlideFitted(widest, `${label} widest`);
      await expectTabs("widest panel");
      await page.keyboard.press("ArrowLeft"); // past the bound: nothing more
      expect(Math.abs((await settled(page)).context.w - widest.context.w)).toBeLessThanOrEqual(1);

      await page.keyboard.press("End");
      const narrowest = await settled(page);
      expect(narrowest.separator.now, `${label}: End is the other bound the separator announces`).toBe(narrowest.separator.max);
      expect(narrowest.context.w, `${label}: the narrowest panel`).toBeLessThan(start.context.w + 0.5);
      await expectTabs("narrowest panel");
      await page.keyboard.press("ArrowRight");
      expect(Math.abs((await settled(page)).context.w - narrowest.context.w)).toBeLessThanOrEqual(1);

      // pointer: the same two bounds by dragging the edge
      const drag = async (toX: number) => {
        const grip = (await edge.boundingBox())!;
        await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
        await page.mouse.down();
        await page.mouse.move(toX, grip.y + grip.height / 2, { steps: 16 });
        await page.mouse.up();
        return settled(page);
      };
      const draggedWide = await drag(narrowest.group.x + 40);
      expect(Math.abs(draggedWide.context.w - widest.context.w), `${label}: dragging the edge left stops at the same widest bound (${Math.round(widest.context.w)} px)`).toBeLessThanOrEqual(1.5);
      expect(draggedWide.stage.w / draggedWide.group.w).toBeGreaterThanOrEqual(0.4);
      const draggedNarrow = await drag(narrowest.group.right - 20);
      expect(Math.abs(draggedNarrow.context.w - narrowest.context.w), `${label}: dragging the edge right stops at the same narrowest bound (${Math.round(narrowest.context.w)} px)`).toBeLessThanOrEqual(1.5);
      const kept = await drag(draggedNarrow.edge.x + draggedNarrow.edge.w / 2 - 90); // a width of the learner's own, between the bounds
      expect(kept.context.w).toBeGreaterThan(narrowest.context.w + 40);
      expect(kept.context.w).toBeLessThan(widest.context.w - 10);

      // the draft and the playback are as they were: same element, still running, not rewound
      await expect(composer).toHaveValue(draft);
      const after = await mediaState(page);
      expect([after.mark, after.src, after.paused], `${label}: the recording is the same element and still plays`).toEqual(["r2-check", playing.src, false]);
      expect(after.t, `${label}: the recording was not rewound`).toBeGreaterThan(playing.t);
      await page.getByTestId("play-toggle").click();
      await expect.poll(async () => (await mediaState(page)).paused).toBe(true);

      await page.reload();
      await rendered(page, THREE_RANGES_PAGE);
      const reloaded = await settled(page);
      expect(Math.abs(reloaded.context.w - kept.context.w), `${label}: the width is kept after a reload (${Math.round(kept.context.w)} px)`).toBeLessThanOrEqual(1.5);
      await expect(page.locator("#tutor-composer"), `${label}: the draft is still in the composer after the reload`).toHaveValue(draft);
      await page.locator("#tutor-composer").fill(""); // leave no draft for the next size
    }
  });

  test("R2-V4 on a narrow screen exactly one pane is visible, each pane is reached from the pane control, and play and pause work from every pane", async ({ page }) => {
    test.setTimeout(180_000);
    for (const [width, height] of NARROW) {
      const label = `${width}x${height}`;
      await page.setViewportSize({ width, height });
      await openLecture(page, SHOWCASE, THREE_RANGES_PAGE);
      await expect(page.getByTestId("workspace-frame")).toHaveAttribute("data-arrangement", "panes");
      const control = page.getByRole("tablist", { name: "Workspace pane" });
      await expect(control).toBeVisible();
      expect((await control.getByRole("tab").allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim().replace(/ \d+$/, "")), `${label}: the pane control names every pane`).toEqual(PANES.map(([name]) => name));
      await media(page).evaluate((m: HTMLMediaElement) => { (m as unknown as { llMark?: string }).llMark = "r2-check"; });

      for (const [name, shows] of PANES) {
        const tab = control.getByRole("tab", { name: new RegExp(`^${name}( \\d+)?$`) });
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        await expect(page.getByTestId(shows), `${label}: the ${name} pane shows its content`).toBeVisible();
        const visible = await page.evaluate((ids) => ids.filter((id) => {
          const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
          return !!el && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
        }), PANES.map(([, id]) => id));
        expect(visible, `${label}, ${name}: exactly one pane is visible`).toEqual([shows]);
        await expect(control, `${label}, ${name}: the pane control stays`).toBeVisible();

        // play and pause from this pane: the bar in the Slide pane, the docked strip in every other one
        const play = page.getByTestId(name === "Slide" ? "play-toggle" : "dock-play");
        await expect(play, `${label}, ${name}: a play control is on screen`).toBeInViewport();
        const census = await transportCensus(page);
        expect([census.play, census.media], `${label}, ${name}: one play control, one media element`).toEqual([1, 1]);
        const before = await mediaState(page);
        await play.click();
        await expect.poll(async () => (await mediaState(page)).paused, { message: `${label}, ${name}: play starts the recording` }).toBe(false);
        await expect.poll(async () => (await mediaState(page)).t).toBeGreaterThan(before.t);
        await expect(play).toHaveAccessibleName(/^Pause/);
        await play.click();
        await expect.poll(async () => (await mediaState(page)).paused, { message: `${label}, ${name}: pause stops it` }).toBe(true);
        await expect(play).toHaveAccessibleName(/^Play/);
        expect((await mediaState(page)).mark, `${label}, ${name}: the same media element throughout`).toBe("r2-check");

        const widths = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth, document.body.scrollWidth]);
        expect(widths, `${label}, ${name}: the document's scroll width equals the viewport width`).toEqual([width, width, width]);
        await expectNoHorizontalOverflow(page);
      }
    }
  });

  test("R2-V5 Study leads with Resume or its explained absence, then courses and lectures, with the Brain's own totals, real first pages and nothing invented", async ({ page, request }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    interface Head { cursor: { lecture_id: string; position_ms: number | null; source?: { locator?: { page?: number } } }; updated_at: string }
    interface CourseView {
      lectures: Array<{ lecture_id: string; title: string; pages: number | null; questions: { count: number } }>;
      question_bank: { total: number }; recorded_attempts: number; unlinked_sessions: unknown[];
    }
    interface TimingRow { lecture_id: string; stage: string; summary: { pages: number | null; pages_with_range: number | null } | null; recordings: Array<{ duration_ms: number | null }> }
    const workspace = (await (await request.get("/api/workspace")).json()) as { courses: Array<{ course_id: string; display_name: string; binding: string }> };
    const bound = workspace.courses.filter((course) => course.binding === "bound");
    expect(bound.length, "the fixture binds its courses").toBeGreaterThan(1);
    const heads = new Map<string, Head | null>();
    for (const course of bound) heads.set(course.course_id, ((await (await request.get(`/api/courses/${course.course_id}/resume`)).json()) as { current?: Head | null }).current ?? null);
    const synchronised = [...heads.values()].some(Boolean);

    const home = page.getByTestId("study-home");
    const resume = page.getByTestId("continue-studying");
    /** Resume (or the sentence in its place) is the first thing after the title; the courses and their lectures come after it. */
    const expectOrder = async (state: string) => {
      const order = await home.evaluate((root) => {
        const top = (selector: string) => root.querySelector(selector)?.getBoundingClientRect().top ?? null;
        const resumeTop = top('[data-testid="continue-studying"]') ?? 0;
        const before: string[] = [];
        for (const el of root.querySelectorAll<HTMLElement>("*")) {
          const own = Array.from(el.childNodes).some((node) => node.nodeType === 3 && (node.textContent ?? "").trim());
          if (!own || !el.checkVisibility({ checkVisibilityCSS: true }) || el.getBoundingClientRect().bottom > resumeTop + 0.5) continue;
          if (!el.closest('h1, [data-testid="sample-data-sentence"]')) before.push((el.textContent ?? "").trim().slice(0, 60));
        }
        return { tops: [top("h1"), resumeTop, top('[data-testid="course-tabs"]'), top('[data-testid="lecture-row"]')], before };
      });
      expect(order.before, `Study ${state}: nothing but the title and the sample-data sentence stands before Resume`).toEqual([]);
      expect(order.tops.every((value) => typeof value === "number"), `Study ${state}: title, Resume, courses and lectures are all there`).toBe(true);
      expect([...(order.tops as number[])].sort((a, b) => a - b), `Study ${state}: title, then Resume, then the courses, then the lectures`).toEqual(order.tops);
    };
    /** No progress bar, percentage, date or chart; every picture is a page drawn in this browser from a course file. */
    const expectNothingInvented = async (state: string) => {
      const found = await home.evaluate((root) => {
        const seen = (el: Element) => (el as HTMLElement).checkVisibility({ checkVisibilityCSS: true });
        const tag = (el: Element) => `${el.tagName.toLowerCase()} ${el.getAttribute("data-testid") ?? el.getAttribute("role") ?? ""}`.trim();
        const meters = Array.from(root.querySelectorAll('progress, meter, [role="progressbar"], [role="meter"], time, canvas, figure, [class*="chart" i], [data-testid*="chart" i], [data-testid*="progress" i]')).filter(seen).map(tag);
        const drawings = Array.from(root.querySelectorAll("svg")).filter(seen).filter((svg) => svg.getBoundingClientRect().width > 32 || svg.getBoundingClientRect().height > 32).map(tag);
        let text = "";
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        // a position another device synchronised is a recorded fact with its recorded time: it is checked apart
        for (let node = walker.nextNode(); node; node = walker.nextNode()) if (!node.parentElement?.closest('[data-testid="synchronised-place"]')) text += ` ${node.textContent ?? ""}`;
        const dates = text.match(/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}|\d{1,2}(?:st|nd|rd|th)? (?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|(?:mon|tues|wednes|thurs|fri|satur|sun)day|yesterday|today|tomorrow|\d+ (?:days?|weeks?|months?|hours?|minutes?) ago|(?:19|20)\d{2})\b/gi) ?? [];
        const pictures = Array.from(root.querySelectorAll("img")).map((img) => ({ blob: img.src.startsWith("blob:"), loaded: img.complete && img.naturalWidth > 0 }));
        return { meters, drawings, percent: text.match(/\d\s*%|\bpercent/gi) ?? [], dates, pictures, synchronisedPlaces: root.querySelectorAll('[data-testid="synchronised-place"]').length };
      });
      expect([found.meters, found.drawings], `Study ${state}: no progress bar, meter, time element or chart`).toEqual([[], []]);
      expect([found.percent, found.dates], `Study ${state}: no percentage and no date`).toEqual([[], []]);
      if (found.synchronisedPlaces > 0) expect(synchronised, `Study ${state}: a synchronised place is shown only when the Brain recorded one`).toBe(true);
      expect(found.pictures.filter((picture) => !picture.blob || !picture.loaded), `Study ${state}: every picture is a page drawn here from a course file, and none is broken`).toEqual([]);
    };

    // ---- a device that has opened nothing ----
    await page.goto("/study");
    await expect(home).toBeVisible();
    await expect(page.getByTestId("lecture-row").first()).toBeVisible();
    await expect(resume).toHaveCount(1);
    if (!synchronised) {
      // the explained absence: one sentence where Resume would be
      await expect(resume).toHaveText("Nothing has been opened on this device yet. Choose a lecture below. Your place is remembered from then on.");
      await expect(page.getByRole("region", { name: "Resume" })).toHaveCount(0);
    } else {
      // Earlier tests of this run finished study sessions, and the Brain keeps where they stopped: Resume states that
      // place as a finished session. The sentence for "nothing opened yet" cannot be seen in such a run.
      await expect(page.getByRole("region", { name: "Resume" })).toBeVisible();
      await expect(page.getByTestId("resume-where")).toContainText("Your last finished session stopped on PDF page");
      test.info().annotations.push({ type: "R2-V5", description: "a synchronised position existed, so the explained absence of Resume was not observable in this run" });
    }
    await expectOrder("on a device that has opened nothing");
    await expectNothingInvented("on a device that has opened nothing");

    // every number of every course equals what the Brain answers
    for (const course of bound) {
      const tab = page.getByTestId("course-tabs").locator(`[data-course="${course.course_id}"]`);
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      const pane = page.locator(`[data-testid="course-pane"][data-course="${course.course_id}"]`);
      await expect(pane).toBeVisible();
      const view = (await (await request.get(`/api/courses/${course.course_id}`)).json()) as CourseView;
      const timing = ((await (await request.get(`/api/courses/${course.course_id}/timing`)).json()) as { lectures: TimingRow[] }).lectures;
      await expect(pane.getByTestId("course-name")).toHaveText(course.display_name);
      const totals = [view.lectures.length > 0 ? count(view.lectures.length, "lecture") : "no lectures", view.question_bank.total > 0 ? `${count(view.question_bank.total, "question")} in the catalog` : "no questions in the catalog",
        view.recorded_attempts > 0 ? count(view.recorded_attempts, "recorded attempt") : "no recorded attempts"].join(", ");
      await expect.poll(() => plain(pane.getByTestId("course-counts")), { message: `${course.course_id}: the totals of the course` }).toBe(`${totals}.`);
      await expect(pane.getByTestId("lecture-row"), `${course.course_id}: one row per lecture unit`).toHaveCount(view.lectures.length);
      const head = heads.get(course.course_id) ?? null;
      for (const lecture of view.lectures) {
        const row = pane.locator(`[data-testid="lecture-row"][data-lecture="${lecture.lecture_id}"]`);
        const timed = timing.find((entry) => entry.lecture_id === lecture.lecture_id);
        const lengths = (timed?.recordings ?? []).map((recording) => recording.duration_ms);
        const facts: string[] = [];
        if (typeof lecture.pages === "number") facts.push(count(lecture.pages, "page"));
        if (lengths.length > 0 && lengths.every((ms) => typeof ms === "number" && ms > 0)) {
          const total = lengthWords((lengths as number[]).reduce((sum, ms) => sum + ms, 0));
          facts.push(lengths.length === 1 ? `recording ${total}` : `${count(lengths.length, "recording")} (${total})`);
        } else if (lengths.length > 0) facts.push(count(lengths.length, "recording"));
        if (timed?.stage === "associated" && typeof timed.summary?.pages === "number" && typeof timed.summary.pages_with_range === "number" && timed.summary.pages > 0) {
          facts.push(`ranges on ${timed.summary.pages_with_range} of ${count(timed.summary.pages, "page")}`);
        }
        facts.push(lecture.questions.count > 0 ? count(lecture.questions.count, "question") : "no questions in the catalog");
        await expect.poll(async () => { const text = await plain(row); return facts.filter((fact) => !text.includes(fact)); }, { message: `${course.course_id} ${lecture.lecture_id}: facts of the row that the Brain's totals give` }).toEqual([]);
        // … and no other figure stands in the row
        // (the name of the unit is not a figure: its title, and "Lecture 03" before it where the unit id carries the number)
        let rest = (await plain(row)).replace(lecture.title, " ").replace(new RegExp(`^\\s*Lecture ${/(\d+)$/.exec(lecture.lecture_id)?.[1] ?? "\\d+"}\\b`), " ");
        for (const fact of [...facts].sort((a, b) => b.length - a.length)) rest = rest.replace(fact, " ");
        const headPage = head && head.cursor.lecture_id === lecture.lecture_id ? head.cursor.source?.locator?.page : undefined;
        if (headPage) rest = rest.replace(`You left this at page ${headPage}`, " ");
        expect(rest, `${course.course_id} ${lecture.lecture_id}: a figure in the row that no total of the Brain gives ("${rest.trim()}")`).not.toMatch(/\d/);
      }
      const unlinked = pane.getByTestId("unlinked-sessions");
      if (view.unlinked_sessions.length > 0) expect(await plain(unlinked), `${course.course_id}: dated sessions linked to no lecture`).toMatch(new RegExp(`^${view.unlinked_sessions.length} dated sessions? (is|are) not linked to a lecture`));
      else await expect(unlinked).toHaveCount(0);
    }

    // ---- with a resume point: a lecture is opened, left on a page, and Study is opened again ----
    const rail = page.getByRole("navigation", { name: "Main", exact: true });
    const courseName = bound.find((course) => course.course_id === COURSE)!.display_name;
    await selectCourse(page, COURSE);
    const paneOf = page.locator(`[data-testid="course-pane"][data-course="${COURSE}"]`);
    // what the first page of two lectures and the page left look like, to tell later which page a picture shows
    await paneOf.getByTestId("lecture-row").filter({ hasText: "Lecture 01" }).getByRole("link").click();
    await expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", /\d+/);
    await turnTo(page, 1);
    const firstOfLecture01 = await pictureSignature(page.getByTestId("slide-canvas"));
    await rail.getByRole("link", { name: "Study" }).click();
    await paneOf.getByTestId("lecture-row").filter({ hasText: SHOWCASE }).getByRole("link").click();
    await expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", /\d+/);
    await turnTo(page, 1);
    const firstOfShowcase = await pictureSignature(page.getByTestId("slide-canvas"));
    await turnTo(page, 4);
    const fourthOfShowcase = await pictureSignature(page.getByTestId("slide-canvas"));
    const leftOn = await plain(page.getByTestId("slide-position")); // "PDF page 4 of 14 · build 1 of 3"
    await rail.getByRole("link", { name: "Study" }).click();

    const region = page.getByRole("region", { name: "Resume" });
    await expect(region).toBeVisible();
    await expect(region).toHaveAttribute("data-testid", "continue-studying");
    await expect(resume).toHaveCount(1);
    await expectOrder("with a resume point");
    const showcase = ((await (await request.get(`/api/courses/${COURSE}`)).json()) as CourseView).lectures.find((lecture) => lecture.title.includes(SHOWCASE))!;
    expect(leftOn, "the page left, as the lecture named it, with the file's page count").toMatch(new RegExp(`^PDF page 4 of ${showcase.pages}\\b`));
    expect(await plain(region.getByTestId("resume-where")), "Resume says where this device stopped, in the words of the identity line").toMatch(new RegExp(`^You stopped on ${leftOn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[.,]`));
    await expect(region.getByRole("heading")).toContainText(showcase.title.replace(/^Fixture /, ""));
    await expect(region).toContainText(`Resume in ${courseName}`);
    await expect(region.getByRole("link", { name: "Resume lecture" })).toHaveAttribute("href", `/courses/${COURSE}/lectures/${showcase.lecture_id}?page=4`);
    await expect(region.getByRole("link", { name: "Start from page 1" })).toHaveAttribute("href", `/courses/${COURSE}/lectures/${showcase.lecture_id}?page=1`);
    const showcaseRow = paneOf.locator(`[data-testid="lecture-row"][data-lecture="${showcase.lecture_id}"]`);
    await expect(showcaseRow).toContainText("You left this at page 4");
    expect(await plain(page.getByTestId("course-tabs").locator(`[data-course="${COURSE}"]`))).toContain("page 4");

    // the pictures: Resume shows the page left; a lecture's row shows the first page of its own file
    const resumePicture = region.getByTestId("resume-picture").locator("img");
    await expect(resumePicture).toBeVisible();
    const lecture01Row = paneOf.getByTestId("lecture-row").filter({ hasText: "Lecture 01" });
    await expect(showcaseRow.locator("img")).toBeVisible();
    await expect(lecture01Row.locator("img")).toBeVisible();
    await expect.poll(() => resumePicture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    const [ofResume, ofShowcaseRow, ofLecture01Row] = [await pictureSignature(resumePicture), await pictureSignature(showcaseRow.locator("img")), await pictureSignature(lecture01Row.locator("img"))];
    const distances = {
      resume: { pageLeft: pictureDistance(ofResume, fourthOfShowcase), firstPage: pictureDistance(ofResume, firstOfShowcase) },
      showcaseRow: { ownFirst: pictureDistance(ofShowcaseRow, firstOfShowcase), pageLeft: pictureDistance(ofShowcaseRow, fourthOfShowcase), otherLecture: pictureDistance(ofShowcaseRow, firstOfLecture01) },
      lecture01Row: { ownFirst: pictureDistance(ofLecture01Row, firstOfLecture01), otherLecture: pictureDistance(ofLecture01Row, firstOfShowcase) },
    };
    test.info().annotations.push({ type: "R2-V5 picture distances", description: JSON.stringify(distances) });
    expect(distances.resume.pageLeft, "Resume's picture is the page left, not the first page").toBeLessThan(distances.resume.firstPage);
    expect(distances.showcaseRow.ownFirst, "the row's thumbnail is the first page of its own file").toBeLessThan(Math.min(distances.showcaseRow.pageLeft, distances.showcaseRow.otherLecture));
    expect(distances.lecture01Row.ownFirst, "the row's thumbnail is the first page of its own file").toBeLessThan(distances.lecture01Row.otherLecture);
    expect(Math.max(distances.resume.pageLeft, distances.showcaseRow.ownFirst, distances.lecture01Row.ownFirst), "each picture is that page, drawn smaller").toBeLessThan(6);
    await expectNothingInvented("with a resume point");

    await region.getByRole("link", { name: "Resume lecture" }).click();
    await rendered(page, 4);
    expect(await plain(page.getByTestId("slide-position"))).toBe(leftOn);
  });

  test("R2-V6 on Study and on a lecture no rendered line of prose is longer than 80 characters, Study's margins are balanced and the slide is fitted to its stage", async ({ page }) => {
    test.setTimeout(240_000);
    for (const [width, height] of DESKTOPS) {
      const label = `${width}x${height}`;
      await page.setViewportSize({ width, height });
      await forgetArrangement(page);
      const linesOf = async (where: string) => {
        const lines = await renderedLines(page, "#main");
        expect(lines.lines, `${label}, ${where}: lines of text were measured`).toBeGreaterThan(8);
        expect(lines.long.map((line) => `${line.chars} characters: "${line.text}" (${line.where})`), `${label}, ${where}: rendered lines longer than 80 characters`).toEqual([]);
      };
      const studyColumn = async (state: string) => {
        await linesOf(`Study ${state}`);
        const margins = await page.evaluate(() => {
          const main = document.getElementById("main")!;
          const column = document.querySelector<HTMLElement>('[data-testid="study-home"]')!;
          const area = main.getBoundingClientRect();
          const areaRight = area.left + main.clientWidth; // without a scroll bar
          const box = column.getBoundingClientRect();
          const style = getComputedStyle(column);
          let [left, right] = [Infinity, -Infinity];
          for (const el of column.querySelectorAll<HTMLElement>("*")) { // what is drawn in the column: its outermost edges
            if (!el.checkVisibility({ checkVisibilityCSS: true })) continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            left = Math.min(left, r.left);
            right = Math.max(right, r.right);
          }
          main.scrollLeft = 200; // a page that could scroll sideways would move
          window.scrollTo(200, window.scrollY);
          const moved = [main.scrollLeft, window.scrollX];
          main.scrollLeft = 0;
          window.scrollTo(0, window.scrollY);
          return { box: [box.left - area.left, areaRight - box.right], content: [box.left + parseFloat(style.paddingLeft) - area.left, areaRight - (box.right - parseFloat(style.paddingRight))], drawn: [left - area.left, areaRight - right], moved, areaWidth: main.clientWidth };
        });
        expect(Math.abs(margins.box[0]! - margins.box[1]!), `${label}, Study ${state}: left and right margin of the column (${margins.box.map(Math.round).join(" / ")} px)`).toBeLessThanOrEqual(3);
        expect(Math.abs(margins.content[0]! - margins.content[1]!), `${label}, Study ${state}: left and right margin of the column's content (${margins.content.map(Math.round).join(" / ")} px)`).toBeLessThanOrEqual(3);
        expect(Math.abs(margins.drawn[0]! - margins.drawn[1]!), `${label}, Study ${state}: left and right margin of what is drawn (${margins.drawn.map(Math.round).join(" / ")} px)`).toBeLessThanOrEqual(3);
        expect(margins.drawn[0]!, `${label}, Study ${state}: the content has a margin`).toBeGreaterThan(8);
        expect(margins.moved, `${label}, Study ${state}: the page does not scroll sideways`).toEqual([0, 0]);
        await expectNoHorizontalOverflow(page);
      };
      await openStudy(page);
      await studyColumn("as opened");

      // a lecture: the reading layout is the slide's (R2-V1), the slide is fitted (R1-U2), and the prose of every tab keeps its measure
      await page.getByTestId("lecture-row").filter({ hasText: SHOWCASE }).getByRole("link").click();
      await expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", /\d+/);
      await turnTo(page, 4);
      const open = await withOutlineOpen(page);
      expectSlideLeads(open, label);
      expectSlideFitted(open, label);
      expect(open.pageScroll, `${label}: the lecture page does not scroll`).toEqual([0, 0, 0]);
      const tablist = page.getByRole("tablist", { name: "Context panel" });
      for (const name of TABS) {
        await tablist.getByRole("tab", { name: new RegExp(`^${name}( \\d+)?$`) }).click();
        await expect(page.locator(`#ll-ctx-${name.toLowerCase()}`)).toBeVisible();
        await linesOf(`lecture, ${name}`);
      }
      await page.getByTestId("range-list-toggle").click();
      await expect(page.getByTestId("range-list")).toBeVisible();
      await linesOf("lecture, range list open");
      await page.keyboard.press("Escape");

      // Study again, now with the Resume block
      await page.getByRole("navigation", { name: "Main", exact: true }).getByRole("link", { name: "Study" }).click();
      await expect(page.getByRole("region", { name: "Resume" })).toBeVisible();
      await expect(page.getByTestId("lecture-row").first()).toBeVisible();
      await studyColumn("with Resume");
    }
  });

  test("R2-V7 the app's own text, as rendered: reading text 16 to 18 px with line height 1.45 or more, at most a tenth under 14 px, nothing under 12 px, at most seven sizes, all of the declared scale", async ({ page }, testInfo) => {
    test.setTimeout(420_000);
    const record: Array<{ size: string; screen: string; chars: number; sizes: Record<string, number>; below14: number; smallest: number }> = [];
    for (const [width, height] of ALL_SIZES) {
      const label = `${width}x${height}`;
      const narrow = width < 1180;
      await page.setViewportSize({ width, height });
      await forgetArrangement(page);
      const declared = declaredSizes(testInfo, width);
      // "While the token source declares no type scale … the check stays open": it declares one, of seven sizes.
      expect(declared.length, `${label}: the token source declares a type scale for this width`).toBeGreaterThan(0);
      expect(new Set(declared).size, `${label}: sizes of the declared scale`).toBeLessThanOrEqual(7);
      const seen = new Set<number>();
      /** The census of one screen as it stands, and the reading text that is on it. */
      const census = async (screen: string, reading: string[] = []) => {
        await page.mouse.move(2, 2);
        await page.waitForTimeout(250); // a tab or pane change has finished
        const found = await textCensus(page);
        const where = `${label}, ${screen}`;
        expect(found.chars, `${where}: text was measured`).toBeGreaterThan(50);
        expect(found.smallest, `${where}: smallest rendered text (${found.small.slice(0, 4).join("; ")})`).toBeGreaterThanOrEqual(12);
        expect(found.below14, `${where}: share of the characters below 14 px (${found.small.slice(0, 6).join("; ")})`).toBeLessThanOrEqual(0.1);
        const sizes = Object.keys(found.sizes).map(Number);
        expect(sizes.filter((size) => !declared.includes(size)), `${where}: rendered sizes that are not of the declared scale (${declared.join(", ")})`).toEqual([]);
        for (const size of sizes) seen.add(size);
        for (const sample of await readingText(page, reading)) {
          expect(sample.count, `${where}: reading text ${sample.selector} is on screen`).toBeGreaterThan(0);
          expect([sample.minSize >= 16, sample.maxSize <= 18], `${where}: reading text ${sample.selector} is ${sample.minSize} to ${sample.maxSize} px ("${sample.text}")`).toEqual([true, true]);
          expect(sample.minLineHeight, `${where}: line height of reading text ${sample.selector}`).toBeGreaterThanOrEqual(1.45);
        }
        record.push({ size: label, screen, chars: found.chars, sizes: found.sizes, below14: Math.round(found.below14 * 1000) / 1000, smallest: found.smallest });
      };

      // Study
      await openStudy(page);
      await census("Study", ['[data-testid="sample-data-sentence"]', (await page.getByTestId("resume-where").count()) > 0 ? '[data-testid="resume-where"]' : '[data-testid="continue-studying"]']);

      // a lecture, every destination of it; page 4 belongs to a build group that questions and concepts are tied to
      await page.getByTestId("lecture-row").filter({ hasText: SHOWCASE }).getByRole("link").click();
      await expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", /\d+/);
      await turnTo(page, 4);
      const identity = width >= 900 ? ['[data-testid="slide-position"]'] : []; // under 900 px the identity line is set in the control size
      const readingOf: Record<string, string[]> = { Tutor: ["#tutor-composer"], Questions: ['[data-testid="question-prompt"]'], Transcript: ['[data-testid="transcript-lines"] li p:not([data-testid])'] };
      const destinations = page.getByRole("tablist", { name: narrow ? "Workspace pane" : "Context panel" });
      for (const name of narrow ? PANES.map(([pane]) => pane) : [...TABS]) {
        const tab = destinations.getByRole("tab", { name: new RegExp(`^${name}( \\d+)?$`) });
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        if (name === "Transcript") await expect(page.getByTestId("transcript-lines")).toBeVisible();
        await census(`lecture, ${name}`, [...(narrow ? (name === "Slide" ? identity : []) : identity), ...(readingOf[name] ?? [])]);
      }
      if (!narrow) {
        await page.getByTestId("range-list-toggle").click(); // the range list counts as well
        await expect(page.getByTestId("range-list")).toBeVisible();
        await census("lecture, range list open", identity);
        await page.keyboard.press("Escape");
        await withOutlineOpen(page); // and the outline
        await census("lecture, outline open", identity);
      }

      // the concept map: the outline, the graph's labels (the default view, at the graph's own zoom) and the detail of a node
      await openStudy(page);
      await page.locator(`[data-testid="course-pane"][data-course="${COURSE}"]`).getByRole("link", { name: "Concept map" }).click();
      const explorer = page.getByTestId("concept-explorer");
      await expect(explorer).toBeVisible();
      const tree = page.getByTestId("outline-tree");
      if (narrow) {
        const panes = page.getByRole("tablist", { name: "Concept map pane" });
        await panes.getByRole("tab", { name: /^Outline/ }).click();
        await expect(tree.getByRole("treeitem").first()).toBeVisible();
        await census("concept map, Outline");
        await tree.getByRole("button", { name: "Expand Plasmid structure" }).click();
        await tree.locator('[data-kind="concept"]').filter({ hasText: "Origin of replication" }).locator("[data-tree-action]").first().click();
        for (let at = 0; at < (await panes.getByRole("tab").count()); at += 1) { // Outline, Map, Sources, Questions, Evidence
          const tab = panes.getByRole("tab").nth(at);
          await tab.click();
          await expect(tab).toHaveAttribute("aria-selected", "true");
          await census(`concept map, ${(await plain(tab)).replace(/ \d+$/, "")}`);
        }
      } else {
        await expect(tree.getByRole("treeitem").first()).toBeVisible();
        const map = page.getByTestId("concept-map");
        await expect(map).toBeVisible();
        await expect(page.getByRole("button", { name: /^Zoom out\. The map does not go below 100/ }), `${label}: the default view of the graph cannot be zoomed below 100 %`).toBeDisabled();
        await census("concept map, as opened");
        await tree.getByRole("button", { name: "Expand Plasmid structure" }).click();
        await tree.locator('[data-kind="concept"]').filter({ hasText: "Origin of replication" }).locator("[data-tree-action]").first().click();
        const detail = page.getByTestId("concept-detail-zone");
        await expect(detail.getByRole("heading", { name: "Origin of replication" })).toBeVisible();
        await expect(map.locator("[data-map-node]").first()).toBeVisible(); // the neighbourhood of the node is drawn: its labels are counted
        await census("concept map, a concept selected", ['[data-testid="detail-summary"]']);
        for (const name of ["Questions", "Evidence"]) {
          await detail.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
          await census(`concept map, ${name} of the concept`, ['[data-testid="detail-summary"]']);
        }
      }
      expect([...seen].sort((a, b) => a - b).length, `${label}: distinct text sizes over Study, the lecture and the concept map (${[...seen].sort((a, b) => a - b).join(", ")})`).toBeLessThanOrEqual(7);
    }
    await testInfo.attach("r2-v7-type-census.json", { body: JSON.stringify(record, null, 2), contentType: "application/json" });
    writeFileSync(join(evidenceFolder(testInfo), `type-census-${scheme(testInfo)}.json`), JSON.stringify(record, null, 2));
  });

  // The hover state of R2-V8 exists only where the pointer can hover. The dark project emulates a touch screen, on which
  // the app (rightly) applies no hover style, so this one check is run with a mouse in both projects.
  test.describe("with a pointer that hovers", () => {
    test.use({ hasTouch: false });

  test("R2-V8 reading content sits in at most one bordered container, no count or plain fact is a pill, the four states of a control differ with a cue that is not colour, and contrast holds as rendered", async ({ page }, testInfo) => {
    test.setTimeout(420_000);
    const recorded: Array<Record<string, unknown>> = [];
    /** The census of one screen: containers, pills, text contrast as rendered, and (once per screen) the accessibility scan. */
    const census = async (screen: string, scan = false) => {
      await page.mouse.move(2, 2);
      await page.waitForTimeout(250);
      const nesting = await borderNesting(page, READING_CONTENT);
      const pills = await pillCensus(page);
      const contrast = await textContrast(page);
      expect(nesting.deepest, `${screen}: depth of bordered containers around reading content (deepest: ${nesting.where})`).toBeLessThanOrEqual(1);
      expect(wrongPills(pills), `${screen}: pills that hold a count or a plain fact, or are neither a filter, a state label nor a source link`).toEqual([]);
      expect(contrast.sampled, `${screen}: text was sampled`).toBeGreaterThan(10);
      expect(contrast.misses.map((miss) => `${miss.ratio}:1 (needs ${miss.needed}) "${miss.text}" ${miss.color} on ${miss.on}, ${miss.where}`), `${screen}: text under 4.5:1, or 3:1 when large`).toEqual([]);
      if (scan) await expectAccessible(page, testInfo, `r2-v8-${screen.replace(/[^a-z0-9]+/gi, "-")}`);
      recorded.push({ screen, bordered_containers: nesting.containers, deepest_nesting: nesting.deepest, pills: pills.length, pills_interactive: pills.filter((pill) => pill.interactive).length, text_pairs_sampled: contrast.sampled });
    };

    for (const [width, height] of [[1440, 900], [390, 844]] as const) {
      const label = `${width}x${height}`;
      const narrow = width < 1180;
      await page.setViewportSize({ width, height });
      await forgetArrangement(page);
      await openStudy(page);
      await census(`${label} Study`, true);
      await page.getByTestId("lecture-row").filter({ hasText: SHOWCASE }).getByRole("link").click();
      await expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", /\d+/);
      await turnTo(page, 4);
      if (!narrow) await withOutlineOpen(page);
      const destinations = page.getByRole("tablist", { name: narrow ? "Workspace pane" : "Context panel" });
      for (const name of narrow ? PANES.map(([pane]) => pane) : [...TABS]) {
        const tab = destinations.getByRole("tab", { name: new RegExp(`^${name}( \\d+)?$`) });
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        await census(`${label} lecture ${name}`, true);
      }
      await openStudy(page); // now with the Resume block and its primary action
      await expect(page.getByRole("region", { name: "Resume" })).toBeVisible();
      await census(`${label} Study with Resume`);
      const primary = await indicatorContrast(page.getByRole("region", { name: "Resume" }).getByRole("link", { name: "Resume lecture" }), "background-color", null, "parent");
      expect(primary.ratio, `${label}: the accent of the primary action on its surface (${primary.colour} on ${primary.ground})`).toBeGreaterThanOrEqual(3);
      await page.locator(`[data-testid="course-pane"][data-course="${COURSE}"]`).getByRole("link", { name: "Concept map" }).click();
      await expect(page.getByTestId("concept-explorer")).toBeVisible();
      const tree = page.getByTestId("outline-tree");
      if (narrow) await page.getByRole("tablist", { name: "Concept map pane" }).getByRole("tab", { name: /^Outline/ }).click();
      await expect(tree.getByRole("treeitem").first()).toBeVisible();
      await census(`${label} concept map`, true);
      await tree.getByRole("button", { name: "Expand Plasmid structure" }).click();
      await tree.locator('[data-kind="concept"]').filter({ hasText: "Origin of replication" }).locator("[data-tree-action]").first().click();
      if (narrow) {
        const panes = page.getByRole("tablist", { name: "Concept map pane" });
        for (let at = 0; at < (await panes.getByRole("tab").count()); at += 1) { // Outline, Map, Sources, Questions, Evidence
          const tab = panes.getByRole("tab").nth(at);
          await tab.click();
          await expect(tab).toHaveAttribute("aria-selected", "true");
          await census(`${label} concept map ${(await plain(tab)).replace(/ \d+$/, "")}`, true);
        }
      } else {
        const detail = page.getByTestId("concept-detail-zone");
        await expect(detail.getByRole("heading", { name: "Origin of replication" })).toBeVisible();
        await census(`${label} concept map, a concept selected`, true);
        for (const name of ["Questions", "Evidence"]) {
          await detail.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
          await census(`${label} concept map, ${name} of the concept`, true);
        }
      }
    }

    // The instrument itself: a count drawn as a pill is found and refused.
    await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.id = "r2-probe-pill";
      probe.textContent = "12 questions";
      probe.style.cssText = "position:fixed;left:12px;top:12px;z-index:99999;display:inline-block;padding:2px 10px;border-radius:999px;background:rgb(120,130,150);color:#fff;font-size:14px;line-height:20px";
      document.body.append(probe);
    });
    expect(wrongPills(await pillCensus(page)), "a count styled as a pill is found by the census").toEqual([expect.stringContaining('"12 questions"')]);
    await page.evaluate(() => document.getElementById("r2-probe-pill")?.remove());

    // ---- the states of tabs, outline entries, range rows and buttons, at 1440×900 ----
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLecture(page, SHOWCASE, THREE_RANGES_PAGE);
    await withOutlineOpen(page);
    const rest = async () => {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.mouse.move(700, 4);
      await page.waitForTimeout(280); // hover and focus transitions (120 ms) have ended
    };
    /**
     * One control in its four states: at rest, under the pointer, with keyboard focus, and selected. `select` makes it
     * the selected one; the same element is read each time, so a difference is a difference of state.
     */
    const expectStates = async (kind: string, control: Locator, focusable: Locator, select: () => Promise<void>, indicator: () => Promise<{ ratio: number; colour: string; ground: string }>) => {
      await rest();
      const atRest = await styleSignature(control);
      await control.hover();
      await page.waitForTimeout(280);
      const hovered = await styleSignature(control);
      await rest();
      await focusByKeyboard(page, focusable);
      await page.waitForTimeout(280);
      const focused = await styleSignature(control);
      const ring = await indicatorContrast(focusable, "outline-color", null, "parent");
      const ringDrawn = await focusable.evaluate((el) => getComputedStyle(el).outlineStyle !== "none" && parseFloat(getComputedStyle(el).outlineWidth) >= 2);
      await rest();
      await select();
      await rest();
      const selected = await styleSignature(control);
      expect([hovered.all !== atRest.all, focused.all !== atRest.all, selected.all !== atRest.all, hovered.all !== focused.all, hovered.all !== selected.all, focused.all !== selected.all],
        `${kind}: hover≠default, focus-visible≠default, selected≠default, hover≠focus-visible, hover≠selected, focus-visible≠selected`).toEqual([true, true, true, true, true, true]);
      expect(selected.shape, `${kind}: the selected state has a cue that is not colour`).not.toBe(atRest.shape);
      expect(ringDrawn, `${kind}: keyboard focus draws a ring of 2 px or more`).toBe(true);
      expect(ring.ratio, `${kind}: the focus ring against what it adjoins (${ring.colour} on ${ring.ground})`).toBeGreaterThanOrEqual(3);
      const mark = await indicator();
      expect(mark.ratio, `${kind}: the selected-state indicator against what it adjoins (${mark.colour} on ${mark.ground})`).toBeGreaterThanOrEqual(3);
      recorded.push({ states_of: kind, focus_ring_contrast: ring.ratio, selected_indicator_contrast: mark.ratio });
    };

    const tablist = page.getByRole("tablist", { name: "Context panel" });
    await tablist.getByRole("tab", { name: /^Questions/ }).click();
    const sources = tablist.getByRole("tab", { name: "Sources" });
    await expectStates("tab", sources, sources, async () => { await sources.click(); await expect(sources).toHaveAttribute("aria-selected", "true"); },
      () => indicatorContrast(sources, "background-color", "::after", "own")); // the 3 px line under the chosen tab

    const outline = page.getByTestId("lecture-outline");
    const entry = outline.getByRole("button", { name: /^Page 2:/ });
    await expectStates("outline entry", entry, entry, async () => { await entry.click(); await expect(entry).toHaveAttribute("aria-current", "true"); await rendered(page, 2); },
      () => indicatorContrast(entry.locator('[data-current="true"]').first(), "box-shadow", null, "parent")); // the ring around the current page's picture
    await turnTo(page, THREE_RANGES_PAGE);

    const whole = page.getByTestId("whole-toggle"); // "Whole recording": a button that stays pressed
    await expect(whole).toHaveAttribute("aria-pressed", "false");
    await expectStates("button", whole, whole, async () => { await whole.click(); await expect(whole).toHaveAttribute("aria-pressed", "true"); },
      () => indicatorContrast(whole, "box-shadow", null, "parent")); // the ring of a pressed button
    await whole.click();
    await expect(whole).toHaveAttribute("aria-pressed", "false");

    await page.getByTestId("range-list-toggle").click();
    const list = page.getByTestId("range-list");
    await expect(list.getByTestId("range-row")).toHaveCount(3);
    const row = list.getByTestId("range-row").nth(2);
    await expect(row).toHaveAttribute("data-chosen", "false");
    await expectStates("range row", row, row.getByRole("radio"), async () => { await row.getByRole("radio").click(); await expect(row).toHaveAttribute("data-chosen", "true"); },
      () => indicatorContrast(row.locator("svg").first(), "color", null, "parent")); // the glyph of the chosen row
    if (!(await mediaState(page)).paused) await page.getByTestId("play-toggle").click(); // pressing a row plays it
    await page.keyboard.press("Escape");

    // the accent on its surface: the play disc on the bar, as it stands (the pointer elsewhere)
    await rest();
    const disc = await indicatorContrast(page.getByTestId("play-toggle"), "background-color", null, "parent");
    expect(disc.ratio, `the play disc on the bar (${disc.colour} on ${disc.ground})`).toBeGreaterThanOrEqual(3);
    // Under the pointer the disc takes the darker hover accent. The row names the accent on its surface, not its hover
    // tone, so that figure is recorded for the critique and not asserted here (it is in the engineer's report).
    await page.getByTestId("play-toggle").hover();
    await page.waitForTimeout(280);
    const discHovered = await indicatorContrast(page.getByTestId("play-toggle"), "background-color", null, "parent");
    await rest();
    recorded.push({ accent_on_surface: "play disc", contrast: disc.ratio, contrast_while_hovered_not_asserted: discHovered.ratio });

    // Recorded for the critique as information: not a pass criterion, compared with no earlier build.
    await testInfo.attach("r2-v8-containers-and-pills.json", { body: JSON.stringify(recorded, null, 2), contentType: "application/json" });
    writeFileSync(join(evidenceFolder(testInfo), `containers-and-pills-${scheme(testInfo)}.json`), JSON.stringify(recorded, null, 2));
  });
  });

  test("R2-V9 a draft, the place in the recording, the selected range, the slide, the tab and the panel width survive theme, outline, panel, tab and pane changes; the slide's pixels are the same in both themes; reduced motion stops all motion", async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const [ownTheme, otherTheme] = scheme(testInfo) === "dark" ? ["Dark", "Light"] : ["Light", "Dark"];
    await page.setViewportSize({ width: 1440, height: 900 });
    await forgetArrangement(page);
    await openLecture(page, SHOWCASE, THREE_RANGES_PAGE);
    await withOutlineOpen(page);
    const frame = page.getByTestId("workspace-frame");
    const bar = page.getByTestId("transport");
    const canvas = page.getByTestId("slide-canvas");
    const tablist = page.getByRole("tablist", { name: "Context panel" });
    const composer = page.locator("#tutor-composer");
    const seconds = (clock: string): number => clock.split(":").map(Number).reduce((total, part) => total * 60 + part, 0);

    // the second of the page's three ranges, a draft, and playback started inside that range
    if ((await plain(bar.getByTestId("range-stepper"))) === "Range 1 of 3") await bar.getByRole("button", { name: "Next range" }).click();
    await expect.poll(() => plain(bar.getByTestId("range-stepper"))).toBe("Range 2 of 3");
    const times = await plain(bar.getByTestId("range-times"));
    const [from, to] = times.split(" – ").map(seconds) as [number, number];
    await tablist.getByRole("tab", { name: "Tutor" }).click();
    const draft = "A draft that stays through theme, outline, panel, tab and pane changes.";
    await composer.fill(draft);
    await startPlayback(page);
    const started = await mediaState(page);
    expect(started.t >= from - 0.3 && started.t <= to, `playback started inside the selected range ${times} (at ${started.t.toFixed(1)} s)`).toBe(true);

    /** What must not change, read from the screen. */
    const facts = async () => {
      const m = await geometry(page);
      const state = await mediaState(page);
      return { draft: await composer.inputValue(), range: `${await plain(bar.getByTestId("range-stepper"))}, ${await plain(bar.getByTestId("range-times"))}`, slide: `${await pageShown(page)} / ${await canvas.getAttribute("data-rendered")}`,
        tab: (await plain(tablist.getByRole("tab", { selected: true }))).replace(/ \d+$/, ""), panel: Math.round(m.context.w), element: `${state.mark} ${state.src}` };
    };
    const theme = async (name: string) => {
      await page.getByRole("radiogroup", { name: "Appearance" }).getByRole("radio", { name, exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", name.toLowerCase());
    };
    const toggleOutline = async (to: "open" | "closed") => {
      await page.getByTestId("outline-toggle").click();
      await expect(frame).toHaveAttribute("data-outline", to);
      await settled(page);
    };
    const resizePanel = async (key: "ArrowLeft" | "ArrowRight") => {
      await page.locator("#panel-edge").focus();
      await page.keyboard.press(key);
      return settled(page);
    };
    const tabsRound = async () => {
      for (const name of ["Questions", "Concepts", "Transcript", "Sources", "Tutor"]) await tablist.getByRole("tab", { name: new RegExp(`^${name}( \\d+)?$`) }).click();
      await expect(tablist.getByRole("tab", { name: "Tutor" })).toHaveAttribute("aria-selected", "true");
    };

    // while it plays: none of the changes stops it, rewinds it or replaces the media element
    const base = await facts();
    expect(base.tab).toBe("Tutor");
    let last = started.t;
    const stillPlaying = async (after: string) => {
      const now = await mediaState(page);
      expect([now.mark, now.src, now.paused], `after ${after}: the same media element, still playing`).toEqual(["r2-check", started.src, false]);
      expect(now.t, `after ${after}: the recording went on from where it was`).toBeGreaterThanOrEqual(last);
      expect(now.t, `after ${after}: still inside the selected range`).toBeLessThanOrEqual(to + 0.3);
      last = now.t;
    };
    await theme(otherTheme);
    await stillPlaying("the theme change");
    await toggleOutline("closed");
    await stillPlaying("collapsing the outline");
    const wider = await resizePanel("ArrowLeft");
    expect(wider.context.w).toBeGreaterThan(base.panel + 8);
    await stillPlaying("resizing the panel");
    await tabsRound();
    await stillPlaying("the tab changes");
    await expect.poll(async () => (await mediaState(page)).t).toBeGreaterThan(started.t + 0.5);
    await page.getByTestId("play-toggle").click();
    await expect.poll(async () => (await mediaState(page)).paused).toBe(true);

    // paused: each change leaves every one of the facts as it was
    await rendered(page, THREE_RANGES_PAGE);
    const pausedAt = (await mediaState(page)).t;
    let kept = await facts();
    expect({ ...kept, panel: 0 }, "after the changes made while it played").toEqual({ ...base, panel: 0 });
    expect(kept.panel, "the panel has the width it was given").toBe(Math.round(wider.context.w));
    const unchanged = async (after: string) => {
      expect(await facts(), `after ${after}: draft, selected range, slide, tab, panel width, media element`).toEqual(kept);
      expect((await mediaState(page)).t, `after ${after}: the position in the recording`).toBeCloseTo(pausedAt, 1);
    };
    /** The slide as drawn on screen (inside its rounded edge) and the pixels of its canvas. */
    const slidePixels = async () => {
      await page.mouse.move(2, 2);
      const box = (await page.getByTestId("slide-surface").boundingBox())!;
      const shot = await page.screenshot({ clip: { x: Math.ceil(box.x) + 10, y: Math.ceil(box.y) + 10, width: Math.floor(box.width) - 20, height: Math.floor(box.height) - 20 } });
      const data = await canvas.evaluate((c: HTMLCanvasElement) => {
        const pixels = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
        let hash = 2166136261;
        for (let i = 0; i < pixels.length; i += 1) hash = Math.imul(hash ^ pixels[i]!, 16777619);
        const filters = [];
        for (let node: Element | null = c; node && node !== document.body; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.filter !== "none" || style.mixBlendMode !== "normal" || parseFloat(style.opacity) !== 1 || style.backdropFilter !== "none") filters.push(`${node.tagName} ${style.filter} ${style.mixBlendMode} ${style.opacity}`);
        }
        return { canvas: `${c.width}x${c.height}:${hash >>> 0}`, filters };
      });
      return { ...data, screen: shot.toString("base64") };
    };

    const inOtherTheme = await slidePixels();
    expect(inOtherTheme.filters, "nothing tints, blends or fades the slide").toEqual([]);
    await theme(ownTheme);
    await unchanged("the theme change");
    const inOwnTheme = await slidePixels();
    expect(inOwnTheme.canvas, "the slide's canvas holds the same pixels in both themes").toBe(inOtherTheme.canvas);
    expect(inOwnTheme.screen === inOtherTheme.screen, "the slide as drawn on screen is pixel for pixel the same in both themes").toBe(true);
    expect(inOwnTheme.filters).toEqual([]);

    await toggleOutline("open");
    await unchanged("opening the outline");
    await toggleOutline("closed");
    await unchanged("collapsing the outline");
    await tabsRound();
    await unchanged("the tab changes");
    const narrower = await resizePanel("ArrowRight"); // the panel is resized: its width is the one thing that changes
    expect(narrower.context.w).toBeLessThan(kept.panel - 8);
    kept = { ...kept, panel: Math.round(narrower.context.w) };
    await unchanged("resizing the panel");

    // a narrow screen: the same page becomes panes; changing the pane changes none of it
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(frame).toHaveAttribute("data-arrangement", "panes");
    const panes = page.getByRole("tablist", { name: "Workspace pane" });
    const narrowFacts = async () => ({ draft: await composer.inputValue(), slide: await canvas.getAttribute("data-rendered"), element: (({ mark, src }) => `${mark} ${src}`)(await mediaState(page)), dock: await page.getByTestId("dock-open").or(page.getByTestId("range-times")).first().innerText().then((text) => /\d+:\d\d – \d+:\d\d/.exec(text.replace(/\s+/g, " "))?.[0] ?? "") });
    for (const name of ["Tutor", "Questions", "Transcript", "Slide", "Sources", "Tutor"]) {
      const tab = panes.getByRole("tab", { name: new RegExp(`^${name}( \\d+)?$`) });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      expect(await narrowFacts(), `narrow, ${name} pane: draft, slide, media element and the selected range`).toEqual({ draft, slide: String(THREE_RANGES_PAGE), element: kept.element, dock: times });
      expect((await mediaState(page)).t, `narrow, ${name} pane: the position in the recording`).toBeCloseTo(pausedAt, 1);
      if (name === "Slide") expect(await plain(bar.getByTestId("range-stepper")), "the bar of the Slide pane names the same range (in a narrow bar as \"2 of 3\")").toMatch(/^(Range )?2 of 3$/);
    }
    await expect(composer).toBeVisible(); // the Tutor pane, with the draft in it
    await expect(composer).toHaveValue(draft);

    // reduced motion: nothing in the page keeps a transition or an animation that takes time
    await page.emulateMedia({ reducedMotion: "reduce" });
    const expectStill = async (where: string) => {
      const moving = await movingParts(page);
      expect(moving.measured, `${where}: elements were measured`).toBeGreaterThan(100);
      expect(moving.found, `${where}: transitions or animations with a duration, under reduced motion`).toEqual([]);
    };
    await expectStill("lecture, narrow");
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(frame).toHaveAttribute("data-arrangement", "frame");
    await page.getByTestId("range-list-toggle").click();
    await expect(page.getByTestId("range-list")).toBeVisible();
    await expectStill("lecture, range list open");
    await page.keyboard.press("Escape");
    await page.getByRole("navigation", { name: "Main", exact: true }).getByRole("link", { name: "Study" }).click();
    await expect(page.getByTestId("lecture-row").first()).toBeVisible();
    await expectStill("Study");
    await page.locator(`[data-testid="course-pane"][data-course="${COURSE}"]`).getByRole("link", { name: "Concept map" }).click();
    await expect(page.getByTestId("outline-tree").getByRole("treeitem").first()).toBeVisible();
    await expectStill("concept map");
    await page.emulateMedia({ reducedMotion: "no-preference" });
  });

  test("R2-V10 the captures for the critique: Study, a lecture and the concept map at the five sizes in this theme, kept with the identity of the build they show", async ({ page, request }, testInfo) => {
    test.setTimeout(300_000);
    // What this test is: the fifteen captures of this theme (the other project makes the other fifteen) of the build whose
    // identity R2-B1 reads, written beside the test results. What it is not: the critique. The reviewer's pass against the
    // two reference images, the findings table and its dispositions are a record made by people or by a separate review
    // agent; a browser test cannot make it and does not pretend to.
    const theme = scheme(testInfo);
    const folder = evidenceFolder(testInfo, "captures", theme);
    const build = (await (await request.get("/api/health")).json()).build as { commit_short: string | null; profile: string; port: number | null; assets: { script: string[]; style: string[] }; web_build: { commit_short: string | null } | null };
    const captures: Array<{ file: string; screen: string; size: string; bytes: number }> = [];
    const capture = async (screen: string, width: number, height: number) => {
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expectNoHorizontalOverflow(page);
      await page.mouse.move(2, 2);
      await page.waitForTimeout(400); // pictures of pages and panel transitions have settled
      const loadedHere = await page.evaluate(() => Array.from(document.querySelectorAll("script[src], link[rel~='stylesheet'][href]")).map((el) => new URL(el.getAttribute("src") ?? el.getAttribute("href") ?? "", location.href).pathname.replace(/^\/+/, "")));
      expect(loadedHere, `${screen} at ${width}x${height}: the page captured is the build whose identity is recorded`).toEqual(expect.arrayContaining([...build.assets.script, ...build.assets.style]));
      const file = `${screen}-${width}x${height}-${theme}.png`;
      const shot = await page.screenshot({ path: join(folder, file) });
      expect([shot.readUInt32BE(16), shot.readUInt32BE(20)], `${file}: the capture is the window at its size`).toEqual([width, height]);
      expect(shot.length, `${file}: the capture shows a drawn page`).toBeGreaterThan(12_000);
      await testInfo.attach(file, { body: shot, contentType: "image/png" });
      captures.push({ file, screen, size: `${width}x${height}`, bytes: shot.length });
    };
    for (const [width, height] of ALL_SIZES) {
      await page.setViewportSize({ width, height });
      await forgetArrangement(page);
      await openStudy(page);
      // the pictures of the pages that are in view have been drawn (rows below the fold draw theirs when they are reached)
      await expect.poll(() => page.evaluate(() => {
        // in view: its middle is on screen and nothing (the bar at the foot of a narrow window) lies over it
        const inView = (el: Element) => {
          const box = el.getBoundingClientRect();
          const [x, y] = [box.left + box.width / 2, box.top + box.height / 2];
          if (box.width === 0 || y < 0 || y > window.innerHeight) return false;
          const top = document.elementFromPoint(x, y);
          return !!top && (el.contains(top) || top.contains(el));
        };
        const pictures = Array.from(document.querySelectorAll<HTMLImageElement>('[data-testid="study-home"] img'));
        const waiting = Array.from(document.querySelectorAll('[data-testid="study-home"] [data-state="loading"], [data-testid="study-home"] [data-skeleton], [data-testid="study-home"] [data-pending]')).filter(inView);
        return pictures.every((img) => img.complete && img.naturalWidth > 0) && waiting.length === 0;
      })).toBe(true);
      await capture("study", width, height);
      await openLecture(page, SHOWCASE, THREE_RANGES_PAGE);
      await expect(page.getByTestId("transport")).toBeVisible();
      await capture("lecture", width, height);
      await openStudy(page);
      await page.locator(`[data-testid="course-pane"][data-course="${COURSE}"]`).getByRole("link", { name: "Concept map" }).click();
      await expect(page.getByTestId("concept-explorer")).toBeVisible();
      await expect(page.getByText(/^Course: \d+/).or(page.getByTestId("concept-map")).first()).toBeVisible();
      await capture("concept-map", width, height);
    }
    expect(captures.length, "three screens at five sizes in this theme").toBe(15);
    expect(new Set(captures.map((entry) => entry.file)).size).toBe(15);
    writeFileSync(join(folder, "identity.json"), JSON.stringify({ theme, profile: build.profile, captured_at: new Date().toISOString(), build, captures, record: "captures only: the critique (reviewer, findings, dispositions) is not made by this test" }, null, 2));
    expect(build.profile, "the captures show synthetic fixture courses").toBe("fixture");
  });

  test("R2-B1 Settings shows the commit, the loaded script and style files, the profile and port, and each course's preparation generation and source-map revision as selectable text", async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const loaded = new Set<string>();
    page.on("response", (response) => {
      if (response.status() === 200 || response.status() === 304) loaded.add(new URL(response.url()).pathname.replace(/^\/+/, ""));
    });
    await openStudy(page); // a full load of the app: the files it loads are recorded above
    await page.getByRole("navigation", { name: "Main", exact: true }).getByRole("link", { name: "Settings" }).click();
    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Build and data" }).click();
    const identity = page.getByTestId("build-identity");
    await expect(identity).toBeVisible();
    const fact = (term: string) => identity.locator("div").filter({ has: page.locator(`dt:text-is("${term}")`) }).locator("dd").last();
    await expect(fact("Brain")).toContainText("profile ");

    const build = (await (await request.get("/api/health")).json()).build as {
      commit_short: string | null; profile: string; port: number | null; assets: { script: string[]; style: string[] }; web_build: { commit_short: string | null; dirty: boolean | null } | null; static: { served: boolean };
      courses: Record<string, { preparation_generation: string | null; prepared_lectures: number; map_revisions: Record<string, Array<{ map_revision: string | null }>> }>;
    };
    expect(build.static.served, "the Brain serves the built app").toBe(true);
    expect(build.web_build?.commit_short, "the served page states its commit").toBeTruthy();

    // commit of the page, as the served page states it
    expect(await plain(fact("This page"))).toMatch(new RegExp(`^commit ${build.web_build!.commit_short}\\b`));
    // the files: the names on screen = the names the Brain says it serves = files this page really loaded
    const scripts = (await plain(fact("Script files"))).split(", ");
    const styles = (await plain(fact("Style files"))).split(", ");
    expect(scripts, "script files as the status interface names them").toEqual(build.assets.script);
    expect(styles, "style files as the status interface names them").toEqual(build.assets.style);
    expect(scripts.length + styles.length).toBeGreaterThanOrEqual(2);
    for (const name of [...scripts, ...styles]) expect([...loaded], `the page actually loaded ${name}`).toContain(name);
    const inDocument = await page.evaluate(() => {
      const names = (selector: string, attribute: string) => Array.from(document.querySelectorAll(selector)).map((el) => new URL(el.getAttribute(attribute) ?? "", location.href).pathname.replace(/^\/+/, ""));
      return { script: names("script[src]", "src"), style: names('link[rel~="stylesheet"][href]', "href") };
    });
    expect(inDocument.script, "every script of the document is named").toEqual(scripts.filter((name) => inDocument.script.includes(name)));
    expect(scripts, "and every named script is a script of the document").toEqual(expect.arrayContaining(inDocument.script));
    expect(inDocument.style).toEqual(styles);
    // profile and port: of the Brain, and the port this page talks to
    expect(await plain(fact("Brain"))).toMatch(new RegExp(`^profile ${build.profile}, port ${build.port}\\b`));
    expect(String(build.port)).toBe(new URL(page.url()).port);
    expect(build.profile).toBe("fixture");
    // per course: the preparation generation and the source-map revisions in use
    const courses = Object.entries(build.courses);
    expect(courses.length).toBeGreaterThan(0);
    let revisions = 0;
    for (const [courseId, course] of courses) {
      const text = await plain(fact(courseId));
      expect(course.preparation_generation, `${courseId} has a preparation generation on the fixture`).toBeTruthy();
      expect(text, `${courseId}: preparation generation`).toContain(`preparation generation ${course.preparation_generation}`);
      const maps = Object.entries(course.map_revisions).flatMap(([deck, versions]) => versions.map((version) => `${deck}: ${version.map_revision ?? "no map"}`));
      for (const map of maps) expect(text, `${courseId}: source-map revision`).toContain(map);
      if (maps.length === 0) expect(text, `${courseId}: no source map is stored, and none is claimed`).not.toContain("Source-map revisions");
      revisions += maps.length;
    }
    expect(revisions, "the fixture stores at least one source map (the showcase deck)").toBeGreaterThan(0);

    // selectable text: the learner can select it, and what is selected holds every fact
    const selection = await identity.evaluate((section) => {
      const blocked = Array.from(section.querySelectorAll<HTMLElement>("dd, dd *")).filter((el) => getComputedStyle(el).userSelect === "none").length;
      const range = window.getSelection()!;
      range.selectAllChildren(section);
      const text = range.toString();
      range.removeAllRanges();
      return { blocked, text: text.replace(/\s+/g, " ") };
    });
    expect(selection.blocked, "no fact is excluded from selection").toBe(0);
    for (const value of [build.web_build!.commit_short!, ...scripts, ...styles, `profile ${build.profile}`, `port ${build.port}`, ...courses.map(([, course]) => course.preparation_generation!)]) {
      expect(selection.text, `the selected text holds ${value}`).toContain(value);
    }
    // the same build in the shell's one discreet line
    await expect(page.getByTestId("build-line").first()).toHaveAttribute("aria-label", new RegExp(`build ${build.web_build!.commit_short}\\b.*${build.profile} profile on port ${build.port}`));
    await expect(page.getByTestId("older-page-line")).toHaveCount(0);

    // the identity, kept with the evidence of this run (R2-E1 copies it from here)
    const text = await identity.innerText();
    await testInfo.attach("r2-b1-build-identity.txt", { body: text, contentType: "text/plain" });
    const folder = resolve(testInfo.project.outputDir, "..", "r2-visual");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, `build-identity-${scheme(testInfo)}.txt`), `${text}\n\nGET /api/health → build\n${JSON.stringify(build, null, 2)}\n`);
  });

  test("R2-B2 when the served build changes, the open page says once that it is older and offers Reload; after Reload the line is gone and Settings shows the new identity", async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    const health = async () => (await (await request.get("/api/health")).json()).build as { assets: { script: string[]; style: string[] }; static: { served: boolean; directory: string | null } };
    const first = await health();
    expect(first.static.served && first.static.directory, "the Brain serves a built app from a folder of this repository").toBeTruthy();
    const served = resolve(testInfo.config.rootDir, "..", "..", first.static.directory!);
    const index = join(served, "index.html");
    const backup = join(served, "index.html.r2-b2-original");
    if (existsSync(backup)) copyFileSync(backup, index); // an earlier run was cut off before it could restore the page
    const original = readFileSync(index, "utf8");
    const copies: string[] = [];
    const noWorker = () => page.evaluate(async () => ("serviceWorker" in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0));

    await page.setViewportSize({ width: 1440, height: 900 });
    // The page asks the Brain what it serves once a minute. The page's clock is driven by the test, so that the minute
    // need not be waited for; everything else is the app's own code.
    await page.clock.install();
    await openStudy(page);
    const line = page.getByTestId("older-page-line");
    await expect(line).toHaveCount(0);
    expect(await noWorker(), "no service worker is registered").toBe(0);

    try {
      // Another build: the same compiled files under the names another build would give them, named by the served page,
      // with its own build stamp. The Brain reads the page it serves at each request.
      const before = (await health()).assets;
      let switched = original;
      for (const name of [...before.script, ...before.style].filter((file) => /^assets\/.+-[\w-]{8}\.(js|css)$/.test(file))) {
        const renamed = name.replace(/-([\w-]{8})\.(js|css)$/, (_all, hash: string, ext: string) => `-${hash.slice(0, 4)}R2B2.${ext}`);
        copyFileSync(join(served, name), join(served, renamed));
        copies.push(join(served, renamed));
        expect(switched, `the served page names ${name}`).toContain(`/${name}`);
        switched = switched.split(`/${name}`).join(`/${renamed}`);
      }
      expect(copies.length, "the served page names a script and a style file of the build").toBeGreaterThanOrEqual(2);
      switched = switched.replace(/built_at=[^";]+/, `built_at=${new Date().toISOString().replace(/\.\d+Z$/, "Z")}`);
      writeFileSync(backup, original);
      writeFileSync(index, switched);
      const now = (await health()).assets;
      expect(now.script.concat(now.style), "the Brain now serves the other build").not.toEqual(before.script.concat(before.style));

      // the open page: one line, in words, with Reload
      await page.clock.fastForward(61_000);
      await expect(line).toHaveCount(1);
      await expect(line).toBeVisible();
      expect(await plain(line)).toBe("This page is older than the app now being served. Reload");
      await expect(page.getByText("This page is older than the app now being served.")).toHaveCount(1); // said once
      await expect(page.getByTestId("study-home")).toBeVisible(); // the page under it is still the page
      const reload = line.getByRole("button", { name: "Reload" });
      await expect(reload).toBeVisible();

      await Promise.all([page.waitForEvent("load"), reload.click()]);
      await expect(page.getByTestId("study-home")).toBeVisible();
      await expect(line).toHaveCount(0);
      const loadedNow = await page.evaluate(() => Array.from(document.querySelectorAll("script[src], link[rel~='stylesheet'][href]")).map((el) => new URL(el.getAttribute("src") ?? el.getAttribute("href") ?? "", location.href).pathname.replace(/^\/+/, "")));
      expect(loadedNow, "the reloaded page is the other build").toEqual(expect.arrayContaining([...now.script, ...now.style]));

      await page.getByRole("navigation", { name: "Main", exact: true }).getByRole("link", { name: "Settings" }).click();
      await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Build and data" }).click();
      const identity = page.getByTestId("build-identity");
      const fact = (term: string) => identity.locator("div").filter({ has: page.locator(`dt:text-is("${term}")`) }).locator("dd").last();
      expect((await plain(fact("Script files"))).split(", "), "Settings names the script files of the new build").toEqual(now.script);
      expect((await plain(fact("Style files"))).split(", "), "Settings names the style files of the new build").toEqual(now.style);
      await expect(fact("Page and server")).toContainText("This page is the build the Brain serves now.");
      await expect(line).toHaveCount(0);
      expect(await noWorker(), "no service worker is registered after the reload either").toBe(0);
    } finally {
      writeFileSync(index, original);
      rmSync(backup, { force: true });
      for (const copy of copies) rmSync(copy, { force: true });
    }
    expect((await health()).assets, "the served build is the first one again").toEqual(first.assets);
  });

  test("R2-B3 Study says once that the data is synthetic, and an unknown course, lecture, page or empty scope shows an explained state with a way back and no blank panel", async ({ page, problems }) => {
    test.setTimeout(120_000);
    problems.allow(/Failed to load resource: the server responded with a status of 404/); // the Brain's answer to an address that names nothing
    await page.setViewportSize({ width: 1440, height: 900 });
    await openStudy(page);
    const sentence = page.getByTestId("sample-data-sentence");
    await expect(sentence).toHaveCount(1);
    await expect(sentence).toHaveText("These are synthetic sample courses, not your own.");
    await expect(sentence).toBeVisible();
    expect(((await page.locator("body").innerText()).match(/synthetic sample/gi) ?? []).length, "Study says it once").toBe(1);

    /** No region, panel or zone that is on screen is empty of words. */
    const blankPanels = () => page.evaluate(() => {
      const zones = Array.from(document.querySelectorAll<HTMLElement>('main, [role="main"], [role="region"], [role="complementary"], [role="tabpanel"], aside, section, #outline, #stage, #context'));
      return zones.filter((zone) => zone.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && zone.getBoundingClientRect().width > 40 && zone.getBoundingClientRect().height > 40 && !zone.closest("media-controller")
        && (zone.innerText ?? "").trim().length === 0 && zone.querySelectorAll("canvas, img").length === 0)
        .map((zone) => `${zone.tagName.toLowerCase()}#${zone.id} ${zone.getAttribute("data-testid") ?? ""} ${zone.getAttribute("aria-label") ?? ""}`.trim());
    });
    const main = page.locator("main");

    // an unknown course
    await page.goto("/courses/nope");
    await expect(main.getByRole("heading", { name: "No course is configured under this address" })).toBeVisible();
    await expect(main).toContainText("“nope” is not one of the configured courses. Your records are not affected.");
    expect(await blankPanels()).toEqual([]);
    await main.getByRole("link", { name: "Back to Study" }).click();
    await expect(page).toHaveURL(/\/study$/);
    await expect(page.getByTestId("lecture-row").first()).toBeVisible();

    // an unknown course under a lecture address and under the concept map
    await page.goto("/courses/nope/lectures/lecture-01");
    await expect(page.getByTestId("lecture-unresolved")).toContainText("No lecture is recorded under this address");
    await expect(page.getByTestId("lecture-unresolved")).toContainText("“lecture-01” in “nope”");
    expect(await blankPanels()).toEqual([]);
    await page.getByTestId("lecture-unresolved").getByRole("link", { name: "Back to the lectures of this course" }).click();
    await expect(main.getByRole("heading", { name: "No course is configured under this address" })).toBeVisible(); // which says so in turn, with its own way back
    await expect(main.getByRole("link", { name: "Back to Study" })).toBeVisible();
    await page.goto("/courses/nope/concepts");
    await expect(page.getByTestId("concept-course-unresolved")).toContainText("No course is configured under this address");
    await expect(page.getByTestId("concept-course-unresolved")).toContainText("“nope” is not one of the configured courses.");
    expect(await blankPanels()).toEqual([]);
    await page.getByTestId("concept-course-unresolved").getByRole("link", { name: "Back to Study" }).click();
    await expect(page).toHaveURL(/\/study$/);

    // an unknown lecture
    await page.goto(`/courses/${COURSE}/lectures/lecture-99`);
    const unresolved = page.getByTestId("lecture-unresolved");
    await expect(unresolved).toContainText("No lecture is recorded under this address");
    await expect(unresolved).toContainText(`“lecture-99” in “${COURSE}”. Your records are not affected.`);
    await expect(page.getByText("This could not be loaded")).toHaveCount(0); // an explained state, not a failed load
    expect(await blankPanels()).toEqual([]);
    await unresolved.getByRole("link", { name: "Back to the lectures of this course" }).click();
    await expect(page).toHaveURL(new RegExp(`/courses/${COURSE}$`));
    await expect(page.getByTestId("lecture-row").first()).toBeVisible();

    // an unknown page of a known lecture: the page shown is said, with a way to a page that exists
    await page.goto(`/courses/${COURSE}/lectures/lecture-01?page=99`);
    await rendered(page, 4);
    const notice = page.getByTestId("stage-notice");
    await expect(notice).toContainText("“99” is not a page of this file, which has 4 pages. Page 4 is shown.");
    expect(await plain(page.getByTestId("slide-position"))).toBe("PDF page 4 of 4");
    await expect(page).toHaveURL(/[?&]page=4\b/); // the address names the page shown
    expect(await blankPanels()).toEqual([]);
    await notice.getByRole("button", { name: "Go to page 1" }).click();
    await rendered(page, 1);
    expect(await plain(page.getByTestId("slide-position"))).toBe("PDF page 1 of 4");
    await expect(page.getByTestId("stage-notice")).toHaveCount(0);

    // the scope of the concept map: empty, malformed, an unknown lecture, an unknown page
    const scopes: Array<[string, RegExp]> = [
      ["", /^The address names an empty scope\. The course scope lists everything\.$/],
      ["lecture:", /^“lecture:” is not a scope\. The course scope lists everything\.$/],
      ["lecture:lecture-99", /^Unknown scope 'lecture:lecture-99'\. The course scope lists everything\.$/],
      ["slide:lecture-01:99", /^Page 99 is not a page of the displayed deck, which has 4\. The course scope lists everything\.$/],
    ];
    for (const [scope, words] of scopes) {
      await page.goto(`/courses/${COURSE}/concepts?scope=${encodeURIComponent(scope)}`);
      const explorer = page.getByTestId("concept-explorer");
      await expect(explorer).toBeVisible();
      const outline = page.getByRole("complementary", { name: "Concept outline" });
      await expect(outline.getByText(words), `scope "${scope}": the outline says why nothing is listed`).toBeVisible();
      await expect(page.getByRole("region", { name: "Concept map" }).first().getByText(words), `scope "${scope}": so does the map`).toBeVisible();
      await expect(page.getByText("The map could not be drawn")).toHaveCount(0);
      expect(await blankPanels(), `scope "${scope}": no blank panel`).toEqual([]);
      await outline.getByRole("button", { name: "Show the course" }).click();
      await expect(page.getByRole("radio", { name: "Course", exact: true })).toBeChecked();
      await expect.poll(() => plain(page.getByTestId("outline-scope-count"))).toMatch(/^Course: \d+ concepts, \d+ skills, \d+ questions$/);
      await expect(page.getByTestId("outline-tree").getByRole("treeitem").first()).toBeVisible();
      await expect(page.getByText(words)).toHaveCount(0);
    }
  });
});
