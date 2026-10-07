// Amendment R2, slides and timing: the ON-SCREEN rows of R2-S1 … R2-S11 and R2-T1 … R2-T13 as the on-screen table of
// docs/features/evidence-alignment/test-plan.md states them, on the labelled synthetic showcase unit (be505, lecture 05),
// plus one journey (evidence R2-E3). Everything is reached by ordinary navigation from Study: no address is typed and the
// test makes no request of its own (it pairs its own device first, like every flow). One test per check id.
//
// The table is stated at 1440×900, so the desktop project is set to that size here; the phone project keeps 390×844,
// one of R2's test viewports. Wording follows the UI contract (docs/project/ui-state-and-interaction-contract.md, R2),
// which wins over the test plan where the two differ; each such place says so beside its assertion.
//
// What the fixture cannot show is said in the test that stands for the id ("Not in the fixture: …").
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { isNarrow, pair } from "../helpers";
import type { TestInfo } from "@playwright/test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const COURSE = "be505";
const LECTURE = "lecture-05";
const TITLE = "Fixture Lecture 05 - R2 showcase";
const PAGES = 14;
const RECORDING_S = 150;

/** The identity line of every page of the showcase deck, in the form of the UI contract ("Slide identity line"). */
const IDENTITY: Record<number, string> = {
  1: "PDF page 1 of 14", 2: "PDF page 2 of 14", 3: "PDF page 3 of 14",
  4: "PDF page 4 of 14 · build 1 of 3", 5: "PDF page 5 of 14 · build 2 of 3", 6: "PDF page 6 of 14 · build 3 of 3",
  7: "PDF page 7 of 14 · step 1 of 2", 8: "PDF page 8 of 14 · step 2 of 2",
  9: "PDF page 9 of 14", 10: "PDF page 10 of 14", 11: "PDF page 11 of 14", 12: "PDF page 12 of 14", 13: "PDF page 13 of 14", 14: "PDF page 14 of 14",
};
/** The generated ranges of the showcase recording, in milliseconds (page scope unless said). */
const VISIT_1 = { start: 5_120, end: 27_840 }; // page 3, first visit
const VISIT_2 = { start: 109_760, end: 123_840 }; // page 3, the revisit
const BUILD_GROUP = { start: 28_160, end: 58_880 }; // pages 4–6, one range for the group
const CALIBRATION = { start: 79_040, end: 89_920 }; // page 10
const WORKED_EXAMPLE = { start: 124_160, end: 141_440 }; // page 12
/** The digression of the talk (nobody's slide): no row of any page may reach into it. */
const DIGRESSION_S = { start: 98, end: 109 };

// ---- small helpers of this file ---------------------------------------------------------------------------------------------
const clean = (text: string | null | undefined): string => (text ?? "").replace(/[\u00a0\u2009\u202f]/g, " ").replace(/\s+/g, " ").trim();
const textOf = async (locator: Locator): Promise<string> => clean(await locator.innerText());
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A name whose spaces may be non-breaking in the page. */
const named = (text: string): RegExp => new RegExp(`^${escapeRegExp(text).replace(/ /g, "\\s+")}$`);

type Pane = "Slide" | "Outline" | "Tutor" | "Questions" | "Concepts" | "Transcript" | "Sources";
/** A tab of the context panel (wide) or of the pane switch (narrow); only one of the two tab lists exists at a time. */
async function openTab(page: Page, name: Pane): Promise<void> {
  const tab = page.getByRole("tab", { name: new RegExp(`^${name}( \\d+)?$`) });
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}
/** On a narrow window the slide, its identity line and the transport bar are the Slide pane. */
async function showSlide(page: Page): Promise<void> {
  if (isNarrow(page)) await openTab(page, "Slide");
}
async function showOutline(page: Page): Promise<Locator> {
  if (isNarrow(page)) await openTab(page, "Outline");
  else if ((await page.getByTestId("outline-toggle").getAttribute("aria-pressed")) !== "true") await page.getByTestId("outline-toggle").click();
  const outline = page.getByTestId("lecture-outline");
  await expect(outline.getByRole("navigation", { name: "Pages" })).toBeVisible();
  return outline;
}

const identityLine = async (page: Page): Promise<string> => textOf(page.getByTestId("slide-position"));
/** The identity line reads `words` and that page of the file is the one drawn. */
async function expectIdentityText(page: Page, physical: number, words: string): Promise<void> {
  await showSlide(page);
  await expect.poll(() => identityLine(page)).toBe(words);
  await expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", String(physical));
}
const expectIdentity = (page: Page, physical: number): Promise<void> => expectIdentityText(page, physical, IDENTITY[physical]!);

/** Study → the course → the lecture row, as a learner goes. */
async function openLecture(page: Page, lectureId: string, title: string): Promise<void> {
  await page.goto("/study");
  const tab = page.getByTestId("course-tabs").locator(`[data-course="${COURSE}"]`);
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await page.locator(`[data-testid="lecture-row"][data-lecture="${lectureId}"]`).getByRole("link", { name: title }).click();
  await expect(page.getByTestId("lecture-workspace")).toBeVisible();
}
async function openShowcase(page: Page): Promise<void> {
  await pair(page);
  await openLecture(page, LECTURE, TITLE);
  await expectIdentity(page, 1);
}
/** Page by page with the pager, the way the row "previous/next move through pages" describes. */
async function goToPage(page: Page, target: number): Promise<void> {
  await showSlide(page);
  for (let guard = 0; guard < 2 * PAGES; guard++) {
    const current = Number(/^PDF page (\d+) of/.exec(await identityLine(page))?.[1]);
    if (current === target) {
      await expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", String(target));
      return;
    }
    const next = current < target ? current + 1 : current - 1;
    await page.getByRole("button", { name: current < target ? /^Next page/ : /^Previous page/ }).click();
    await expect.poll(() => identityLine(page)).toMatch(new RegExp(`^PDF page ${next} of ${PAGES}\\b`));
  }
  throw new Error(`page ${target} was not reached`);
}

// ---- the one media element -------------------------------------------------------------------------------------------------
interface MediaState { count: number; t: number; paused: boolean; duration: number }
const media = (page: Page): Promise<MediaState> => page.evaluate(() => {
  const all = Array.from(document.querySelectorAll<HTMLMediaElement>("audio, video"));
  const one = all[0];
  return { count: all.length, t: one ? one.currentTime : -1, paused: one ? one.paused : true, duration: one ? one.duration : 0 };
});
async function expectAt(page: Page, seconds: number, slack = 0.5): Promise<void> {
  await expect.poll(async () => Math.abs((await media(page)).t - seconds), { message: `player position, expected ${seconds} s` }).toBeLessThanOrEqual(slack);
}
async function expectPaused(page: Page): Promise<void> {
  const state = await media(page);
  expect(state.count, "exactly one media element").toBe(1);
  expect(state.paused, "nothing plays by itself").toBe(true);
}
/**
 * With the bar's own keys (Home, then Right in its 5 s steps) the paused player is put a few seconds before the end of
 * the selected range, so that a real stretch is played and the wait stays bounded. Returns that position in seconds.
 */
async function cueBeforeEnd(page: Page, range: { start: number; end: number }): Promise<number> {
  const scrubber = page.getByTestId("clip-scrubber");
  await expect(scrubber).toHaveAccessibleName("Position in the selected range");
  await scrubber.focus();
  await page.keyboard.press("Home");
  await expectAt(page, range.start / 1000, 0.3);
  const steps = Math.floor(((range.end - range.start) / 1000 - 2.5) / 5);
  for (let step = 1; step <= steps; step++) {
    const expected = range.start + 5_000 * step;
    await page.keyboard.press("ArrowRight");
    await expectAt(page, expected / 1000, 0.3);
    await expect.poll(async () => Math.abs(Number(await scrubber.inputValue()) - expected)).toBeLessThanOrEqual(300);
  }
  await expectPaused(page);
  return (range.start + 5_000 * steps) / 1000;
}
/** Play is pressed; the range is played to its end and playback STOPS there and stays stopped. */
async function playToTheEndAndStop(page: Page, range: { start: number; end: number }): Promise<void> {
  await page.getByTestId("play-toggle").click();
  await expect.poll(async () => (await media(page)).paused, { message: "it plays" }).toBe(false);
  await expect.poll(async () => (await media(page)).paused, { message: "it stops at the end of the range", timeout: 15_000 }).toBe(true);
  const stopped = await media(page);
  expect(Math.abs(stopped.t - range.end / 1000), `stopped at ${stopped.t} s, the range ends at ${range.end / 1000} s`).toBeLessThanOrEqual(0.5);
  await expect(page.getByTestId("stopped-line")).toContainText("Stopped at the end");
  await page.waitForTimeout(1_200); // bounded: it does not go on by itself
  const later = await media(page);
  expect(later.paused).toBe(true);
  expect(Math.abs(later.t - stopped.t)).toBeLessThanOrEqual(0.05);
}

// ---- the transport bar and its range list ------------------------------------------------------------------------------------
async function openRangeList(page: Page): Promise<Locator> {
  await showSlide(page);
  const list = page.getByTestId("range-list");
  if (!(await list.isVisible())) await page.getByTestId("range-list-toggle").click();
  await expect(list).toBeVisible();
  return list;
}
async function closeRangeList(page: Page): Promise<void> {
  const list = page.getByTestId("range-list");
  if (await list.isVisible()) await page.getByTestId("range-list-toggle").click();
  await expect(list).toBeHidden();
}
interface RangeRow { text: string; scope: string | null; start: number; end: number; times: string }
/** The rows of the open range list of the page on screen: words, scope and the times they show (whole seconds). */
async function rangeRows(page: Page): Promise<RangeRow[]> {
  const list = await openRangeList(page);
  const raw = await list.getByTestId("range-row").evaluateAll((rows) => rows.map((row) => ({ text: (row as HTMLElement).innerText, scope: row.querySelector("[data-scope]")?.getAttribute("data-scope") ?? null })));
  return raw.map((row) => {
    const text = clean(row.text);
    const match = /(\d+):(\d\d) – (\d+):(\d\d)/.exec(text);
    expect(match, `a row shows its start and end: "${text.slice(0, 60)}"`).not.toBeNull();
    return { text, scope: row.scope, times: match![0], start: Number(match![1]) * 60 + Number(match![2]), end: Number(match![3]) * 60 + Number(match![4]) };
  });
}
/** Whole recording is a button on the range line where there is room and an item of the bar's More where there is not. */
async function setWholeRecording(page: Page, on: boolean): Promise<void> {
  const toggle = page.getByTestId("whole-toggle");
  if (await toggle.isVisible()) {
    if ((await toggle.getAttribute("aria-pressed")) !== String(on)) await toggle.click();
  } else {
    await page.getByTestId("transport-more-button").click();
    const item = page.getByTestId("transport-more").getByRole("menuitemcheckbox", { name: "Whole recording" });
    if ((await item.getAttribute("aria-checked")) !== String(on)) await item.click();
    else await page.keyboard.press("Escape");
  }
  await expect(page.getByTestId("transport")).toHaveAttribute("data-mode", on ? "whole" : "range");
}
/** The no-range line with everything it says: what stands on the line and what it opens in full where the line is short. */
async function noRangeWords(page: Page): Promise<string> {
  const line = page.getByTestId("no-range-line");
  await expect(line).toBeVisible();
  const full = line.getByRole("button", { name: /^Read in full: / });
  const label = (await full.count()) > 0 ? await full.first().getAttribute("aria-label") : "";
  return clean(`${await line.innerText()} ${label ?? ""}`);
}

// ---- corrections of the source map --------------------------------------------------------------------------------------------
/** The stage says what became of a correction; the ranges are matched to the pages again before anything is read. */
async function expectRematched(page: Page, done: string): Promise<void> {
  await showSlide(page);
  const notice = page.getByTestId("stage-notice");
  await expect(notice).toContainText(`${done} The recording was matched to the pages again with your correction.`, { timeout: 20_000 });
  await notice.getByRole("button", { name: "Dismiss this message" }).click();
  await expect(notice).toBeHidden();
}
/** The role control: a button of the band where there is room, a part of the band's More where there is not. */
async function openRoleMenu(page: Page): Promise<Locator> {
  await showSlide(page);
  await expect(page.getByTestId("pager")).toBeVisible();
  const button = page.getByTestId("role-button");
  if (await button.isVisible()) {
    await button.click();
    return page.getByTestId("role-menu");
  }
  await page.getByRole("button", { name: /^More: finish the session/ }).click();
  return page.getByTestId("pager-more");
}
async function closeMenu(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
}
async function setRole(page: Page, role: string): Promise<void> {
  const menu = await openRoleMenu(page);
  await menu.getByRole("menuitemradio", { name: role, exact: true }).click();
  await expectRematched(page, "The role of this page was recorded as your correction.");
}
async function takeBackRole(page: Page): Promise<void> {
  const menu = await openRoleMenu(page);
  await menu.getByRole("menuitem", { name: "Take back your correction" }).click();
  await expectRematched(page, "Your correction was taken back. The role is again what held before it.");
}
async function openGroupingDialog(page: Page): Promise<Locator> {
  await showSlide(page);
  await page.getByRole("button", { name: /^More: finish the session/ }).click();
  await page.getByRole("menuitem", { name: "Correct the grouping of this page" }).click();
  const dialog = page.getByRole("dialog", { name: "Correct the grouping of this page" });
  await expect(dialog.getByTestId("grouping-dialog")).toBeVisible();
  return dialog;
}
async function recordGrouping(page: Page, choice: RegExp): Promise<void> {
  const dialog = await openGroupingDialog(page);
  const takeBack = /Take back your correction/.test(choice.source);
  await dialog.getByRole("radio", { name: choice }).check();
  await dialog.getByRole("button", { name: "Record the correction" }).click();
  await expect(dialog).toBeHidden();
  await expectRematched(page, takeBack ? "Your correction was taken back. The grouping is again what held before it." : "The grouping was recorded as your correction. The file itself is unchanged.");
}
/** The facts of the page on screen under Sources ("the slide details"): position, group, printed number, role. */
async function pageFacts(page: Page): Promise<Locator> {
  await openTab(page, "Sources");
  const facts = page.getByTestId("page-facts");
  await expect(facts).toBeVisible();
  return facts;
}
async function openSearch(page: Page): Promise<Locator> {
  if (isNarrow(page)) {
    await page.getByRole("button", { name: /^Menu: / }).click();
    await page.getByRole("menuitem", { name: /^Search/ }).click();
  } else await page.getByRole("banner").getByRole("button", { name: /^Search/ }).click();
  const dialog = page.getByRole("dialog", { name: "Search" });
  await expect(dialog).toBeVisible();
  return dialog;
}

// ---- the pages of a deck by role (R2-S10, R2-T12) ------------------------------------------------------------------------------
interface DeckFigures { raw: number; instructional: number; uncertain: number; excluded: number; rawLabel: string; instructionalLabel: string; words: string }
/**
 * The two labelled figures of a deck and the counts of its other roles, read off the words on screen: the figure with
 * its label, then the sentence that counts the uncertain pages and the one that counts the excluded pages (0 when the
 * sentence is absent). `scope` is the "Pages by role" row of the Sources tab or a deck row of the coverage readback.
 */
async function deckFigures(scope: Locator): Promise<DeckFigures> {
  const words = await textOf(scope);
  const rawLabel = await textOf(scope.locator('[data-figure="raw"]'));
  const instructionalLabel = await textOf(scope.locator('[data-figure="instructional"]'));
  expect(rawLabel, "the raw figure is a number with its label").toMatch(/^(PDF pages \d+|\d+ PDF pages)$/);
  expect(instructionalLabel, "the instructional figure is a number with its label").toMatch(/^(Count as teaching content \d+|\d+ count as teaching content)$/);
  expect(words.indexOf(rawLabel), "the two figures stand together, the raw one first").toBeLessThan(words.indexOf(instructionalLabel));
  const leading = (pattern: RegExp): number => Number(pattern.exec(words)?.[1] ?? 0);
  return {
    raw: Number(/\d+/.exec(rawLabel)![0]), instructional: Number(/\d+/.exec(instructionalLabel)![0]),
    uncertain: leading(/(\d+) [^.:\d]*?(?:is|are) listed as uncertain, not excluded/), excluded: leading(/(\d+) [^.:\d]*?(?:is|are) excluded/),
    rawLabel, instructionalLabel, words,
  };
}
/** Study → Settings → Build and data: the speech-timing readback of a course with its lectures listed, as a learner gets there. */
async function openCoverage(page: Page, course: string): Promise<Locator> {
  await page.goto("/study");
  const tab = page.getByTestId("course-tabs").locator(`[data-course="${course}"]`);
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  if (isNarrow(page)) {
    await page.getByRole("button", { name: /^Menu: / }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
  } else await page.getByRole("link", { name: "Settings" }).first().click();
  await page.getByRole("link", { name: "Build and data" }).click();
  const readback = page.locator(`[data-testid="timing-readback"][data-course="${course}"]`);
  await showLectures(readback);
  return readback;
}
/** "Each lecture n" of a readback is opened; its rows are then on screen. */
async function showLectures(readback: Locator): Promise<void> {
  const toggle = readback.getByRole("button", { name: /^Each lecture/ });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(readback.locator("li[data-stage]").first()).toBeVisible();
}

// ---- the benchmark record of the test instance (R2-T6) ---------------------------------------------------------------------------
/** Where this instance's Brain reads its benchmark record: `<state>/benchmarks/alignment.json`. The fixture has none. */
const benchmarkFile = (testInfo: TestInfo): string => {
  const repo = resolve(testInfo.config.rootDir, "..", "..");
  const area = process.env.LL_E2E_AREA ? resolve(repo, process.env.LL_E2E_AREA) : join(repo, ".local", "e2e");
  return join(area, "state", "benchmarks", "alignment.json");
};
/** A LABELLED SYNTHETIC record in the contract `ll.alignment-benchmark/1`: invented for this test, it measures nothing. */
const syntheticBenchmark = (over: Record<string, unknown> = {}): string => JSON.stringify({
  contract: "ll.alignment-benchmark/1", method: { name: "lexical-sequence", version: "2" }, baseline: { name: "lexical-monotone-baseline" },
  compared_on: "invented labelled windows of the synthetic showcase lecture", labelled_windows: 24, result: "not_clearly_better",
  thresholds_fixed_before_reading_answers: true, produced_at: "2026-10-06T08:00:00Z", note: "LABELLED SYNTHETIC: written by a browser test; it measures nothing.", ...over,
}, null, 1);
function writeBenchmark(testInfo: TestInfo, content: string): void {
  mkdirSync(dirname(benchmarkFile(testInfo)), { recursive: true });
  writeFileSync(benchmarkFile(testInfo), content);
}
/** The instance as the fixture makes it: without a record and without the record's folder. */
function removeBenchmark(testInfo: TestInfo): void {
  rmSync(dirname(benchmarkFile(testInfo)), { recursive: true, force: true });
}

interface OverrideRecord { revision: number; author?: string | { kind?: string } | null; status?: string; reverted_by?: number | null; op?: { type?: string } | null }
async function restoreAfterFailure(page: Page): Promise<void> {
  const base = `/api/courses/${COURSE}/lectures/${LECTURE}`;
  const map = (await (await page.request.get(`${base}/source-map`)).json()) as { overrides?: OverrideRecord[] };
  const inForce = (map.overrides ?? [])
    .filter((record) => (typeof record.author === "string" ? record.author : record.author?.kind) === "learner" && record.status === "applied" && record.reverted_by == null && record.op?.type !== "revert")
    .map((record) => record.revision);
  if (inForce.length > 0) await page.request.post(`${base}/source-map/overrides`, { data: { op: "revert", value: inForce, reason: "Left in force by a failed browser test" } });
  await page.request.post(`${base}/timing/build`);
}

test.describe("R2 on screen: slide identity, roles and recording ranges of the showcase lecture", () => {
  test.beforeEach(async ({ page }) => {
    if (!isNarrow(page)) await page.setViewportSize({ width: 1440, height: 900 });
  });
  // Housekeeping after a FAILED test only; nothing is observed through it. Every test takes its own corrections back
  // on screen. When one fails half way, what it left in force is taken back here and the ranges are matched again, so
  // that the tests after it report on themselves and not on its leftovers (all tests share one Brain and one journal).
  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    await restoreAfterFailure(page).catch(() => undefined);
  });

  // ==== slides ================================================================================================================

  test("R2-S1 build 2 chosen from the outline: the identity line, the outline entry, This slide in Questions and in Concepts and an opened search hit name the same page of the same slide", async ({ page }) => {
    await openShowcase(page);
    let outline = await showOutline(page);
    await outline.getByRole("button", { name: /^Pages 4–6: Building the reporter construct/ }).click();
    // The entry opens on its first build, and on a narrow window choosing a row brings the Slide pane to the front.
    // That is waited for before the outline is asked for again (as R2-S3 does): asked for in the same instant, the
    // Outline tab still read as selected, nothing was clicked, and the pane then changed under the test (seen once
    // on the phone project of the whole-suite run).
    await expectIdentity(page, 4);
    outline = await showOutline(page);
    await outline.getByTestId("outline-builds").getByRole("button", { name: "Page 5, 2 of 3" }).click();
    await expectIdentity(page, 5);

    // The outline marks the same page, inside the one entry of its slide.
    outline = await showOutline(page);
    await expect(outline.getByTestId("outline-builds").getByRole("button", { name: "Page 5, 2 of 3" })).toHaveAttribute("aria-current", "true");
    await expect(outline.locator('button[aria-current="true"]')).toHaveCount(1);
    await expect(outline.locator('div[aria-current="true"]').getByRole("button", { name: /^Pages 4–6: Building the reporter construct, 3 builds, pp\. 4–6$/ })).toHaveAttribute("aria-expanded", "true");

    // Questions, This slide: the page on screen is p. 5, the other pages of the same slide are its builds 1 and 3.
    await openTab(page, "Questions");
    await expect(page.getByTestId("questions-tab").getByRole("button", { name: /^This slide \d+$/ })).toHaveAttribute("aria-expanded", "true");
    const exact = page.getByTestId("this-slide-list").locator('[data-testid="question-row"][data-question-id="BE505-L05-Q01"]');
    await expect.poll(async () => textOf(exact.locator('[aria-current="page"]'))).toMatch(/^p\. 5\b.*on screen$/);
    await expect(exact.getByRole("link", { name: named("p. 4 build 1 of 3") })).toBeVisible();
    await expect(exact.getByRole("link", { name: named("p. 6 build 3 of 3") })).toBeVisible();
    await expect.poll(async () => textOf(exact)).toContain("Group-level: all 3 builds");

    // Concepts, This slide: the same slide in three builds, and its map is the map of page 5.
    await openTab(page, "Concepts");
    const concepts = page.getByTestId("concepts-tab");
    await expect.poll(async () => textOf(concepts.getByTestId("concepts-heading"))).toMatch(/^On this slide: \d+ concepts?, \d+ skills?, \d+ questions?$/);
    await expect.poll(async () => textOf(concepts)).toContain("One slide in 3 builds, pp. 4–6.");
    await expect(concepts.getByRole("link", { name: "Open the concept map" })).toHaveAttribute("href", /scope=slide%3Alecture-05%3A5$/);

    // A search hit for that page, opened from another page, lands on the same page of the same slide.
    await goToPage(page, 9);
    const search = await openSearch(page);
    await search.getByRole("searchbox", { name: "Search query" }).fill("coding sequence");
    await search.getByRole("list", { name: "Search results" }).locator(`a[href$="/lectures/${LECTURE}?page=5"]`).click();
    await expect(search).toBeHidden();
    await expectIdentity(page, 5);
  });

  test("R2-S2 a question anchored to a physical page opens the page whose identity line reads that PDF page, and a deck without a PowerPoint file shows no PowerPoint number anywhere", async ({ page }) => {
    // Not in the fixture: a deck whose PowerPoint order differs from its PDF order (the showcase unit has no PowerPoint file).
    await openShowcase(page);
    // Page 1 is a title page: the Questions tab lists the lecture's questions with the pages their anchors name.
    await openTab(page, "Questions");
    const all = page.getByTestId("lecture-questions");
    await all.locator('[data-question-id="BE505-L05-PRACTICE-Q01"]').getByRole("link", { name: named("p. 12") }).click();
    await expectIdentity(page, 12);
    await openTab(page, "Questions");
    await page.getByTestId("this-slide-list").locator('[data-question-id="BE505-L05-PRACTICE-Q01"]').waitFor();
    await expect.poll(async () => textOf(page.getByTestId("this-slide-list").locator('[data-question-id="BE505-L05-PRACTICE-Q01"]'))).toContain("Stated. The course record names this page.");

    // No PowerPoint number on the lecture page: the band, the page's details and every tab, on a single page and in a group.
    for (const physical of [12, 5]) {
      await goToPage(page, physical);
      await expect.poll(() => identityLine(page)).not.toMatch(/PowerPoint|PPTX|Slide \d/i);
      const menu = await openRoleMenu(page);
      await expect.poll(async () => textOf(menu)).not.toMatch(/PowerPoint|PPTX/i);
      await closeMenu(page);
      for (const pane of ["Questions", "Concepts", "Transcript", "Sources"] as const) {
        await openTab(page, pane);
        await expect.poll(async () => textOf(page.getByRole("main")), `${pane} of page ${physical}`).not.toMatch(/PowerPoint|PPTX/i);
      }
      await expect((await pageFacts(page)).getByText("PowerPoint slide")).toHaveCount(0);
    }
  });

  test("R2-S3 the three-page reveal is ONE outline entry with three builds; each build opens by click and by Next and reads build i of 3; on build 1 what only build 3 shows is elsewhere in this sequence", async ({ page }) => {
    await openShowcase(page);
    let outline = await showOutline(page);
    const rows = outline.getByRole("navigation", { name: "Pages" });
    await expect(rows.getByRole("button", { name: /^Pages 4–6: Building the reporter construct, 3 builds, pp\. 4–6$/ })).toHaveCount(1);
    for (const physical of [4, 5, 6]) await expect(rows.getByRole("button", { name: new RegExp(`^Page ${physical}:`) })).toHaveCount(0);

    // By click: the entry opens on its first build and expands to three.
    await rows.getByRole("button", { name: /^Pages 4–6:/ }).click();
    await expectIdentity(page, 4);
    for (const [index, physical] of [4, 5, 6].entries()) {
      outline = await showOutline(page);
      const builds = outline.getByTestId("outline-builds");
      await expect(builds.getByRole("button")).toHaveCount(3);
      await builds.getByRole("button", { name: `Page ${physical}, ${index + 1} of 3` }).click();
      await expectIdentity(page, physical);
      await expect(page.getByTestId("slide-canvas")).toHaveAccessibleName(named(`PDF page ${physical} of 14 · build ${index + 1} of 3: Building the reporter construct — original source, colours unchanged`));
    }

    // By Next: the control says which build it goes to.
    await showOutline(page).then((list) => list.getByTestId("outline-builds").getByRole("button", { name: "Page 4, 1 of 3" }).click());
    await expectIdentity(page, 4);
    await page.getByRole("button", { name: "Next page: build 2 of 3" }).click();
    await expectIdentity(page, 5);
    await page.getByRole("button", { name: "Next page: build 3 of 3" }).click();
    await expectIdentity(page, 6);
    await page.getByRole("button", { name: "Previous page: build 2 of 3" }).click();
    await page.getByRole("button", { name: "Previous page: build 1 of 3" }).click();
    await expectIdentity(page, 4);

    // Build 1: the ribosome binding site is first shown on build 3. It is listed once, as elsewhere in this sequence,
    // naming the build (the contract's wording; the plan writes it "(build 3)"), and nothing says it is on this build.
    await openTab(page, "Concepts");
    const tree = page.getByTestId("concepts-tree");
    for (const entry of [/^Concept: Ribosome binding site/, /^Skill: Explain why a reporter construct carries a ribosome binding site\./]) {
      const item = tree.getByRole("link", { name: entry });
      await expect(item).toHaveCount(1);
      const words = await textOf(item);
      expect(words).toContain("elsewhere in this sequence: build 3");
      expect(words).not.toMatch(/on this build/i);
    }
    await expect.poll(async () => textOf(tree.getByRole("link", { name: /^Concept: Reporter gene/ }))).toContain("group-level: all 3 builds");
    // On build 3 the same entry is on this build.
    await goToPage(page, 6);
    await openTab(page, "Concepts");
    await expect.poll(async () => textOf(page.getByTestId("concepts-tree").getByRole("link", { name: /^Concept: Ribosome binding site/ }))).toContain("on this build");
  });

  test("R2-S4 the pages reachable from the outline equal the page count of the file: every entry opens its own page and no page is merged away or called a duplicate", async ({ page }) => {
    // Not in the fixture: two look-alike pages, a four-up handout page ("slide region i of 4") and an adjacent repeat ("duplicate of page N").
    await openShowcase(page);
    let outline = await showOutline(page);
    await expect.poll(async () => textOf(outline)).toContain(`${PAGES} pages`);
    const names = await outline.getByRole("navigation", { name: "Pages" }).locator("button[data-row]").evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label") ?? ""));
    const reachable: number[] = [];
    for (const name of names) {
      const one = /^Page (\d+):/.exec(name);
      const group = /^Pages (\d+)–(\d+):/.exec(name);
      expect(one ?? group, `an outline entry names its page or pages: "${name}"`).not.toBeNull();
      if (one) reachable.push(Number(one[1]));
      else for (let physical = Number(group![1]); physical <= Number(group![2]); physical++) reachable.push(physical);
    }
    expect(reachable).toEqual(Array.from({ length: PAGES }, (_, index) => index + 1));

    // Every entry opens the first of its pages; the pages of a group open from the entry.
    for (const name of names) {
      const first = Number(/^Pages? (\d+)/.exec(name)![1]);
      outline = await showOutline(page);
      await outline.getByRole("navigation", { name: "Pages" }).getByRole("button", { name, exact: true }).click();
      await expectIdentity(page, first);
      const group = /^Pages (\d+)–(\d+):/.exec(name);
      if (!group) continue;
      const size = Number(group[2]) - first + 1;
      for (let index = 1; index < size; index++) {
        outline = await showOutline(page);
        await outline.getByTestId("outline-builds").getByRole("button", { name: `Page ${first + index}, ${index + 1} of ${size}` }).click();
        await expectIdentity(page, first + index);
      }
    }
    // A step is never called a build, and nothing here is a duplicate or a region.
    for (const words of Object.values(IDENTITY)) expect(words).not.toMatch(/duplicate|region/);
    await goToPage(page, 7);
    await expect.poll(() => identityLine(page)).toBe("PDF page 7 of 14 · step 1 of 2");
  });

  test("R2-S5 a grouping, a split and a role correction change the outline and the identity line at once, survive the rebuild and a reload, keep an earlier link on its physical page, and are taken back", async ({ page }) => {
    // Not on screen in this app: a list of earlier groupings. The dialog names the correction in force and what taking it back restores.
    test.setTimeout(240_000);
    await openShowcase(page);

    // --- group two pages (13 and 14) -------------------------------------------------------------------------------------
    await goToPage(page, 13);
    const linkBefore = page.url();
    expect(linkBefore).toContain("page=13");
    await recordGrouping(page, /^The next page belongs with this one/);
    await expectIdentityText(page, 13, "PDF page 13 of 14 · part 1 of 2");
    let outline = await showOutline(page);
    const grouped = outline.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: /^Pages 13–14: .*2 pages grouped by you, pp\. 13–14$/ });
    await expect(grouped).toHaveCount(1);
    await expect(outline.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: /^Page 1[34]:/ })).toHaveCount(0);
    const facts = await pageFacts(page);
    await expect.poll(async () => textOf(facts)).toMatch(/Group Part 1 of 2, pp\. 13–14\. Set by a correction, human-confirmed/);

    // After the rebuild (the matching ran again with the correction) and a reload the outline still shows it as the learner's.
    await page.reload();
    await expectIdentityText(page, 13, "PDF page 13 of 14 · part 1 of 2");
    outline = await showOutline(page);
    await expect(outline.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: /^Pages 13–14: .*2 pages grouped by you, pp\. 13–14$/ })).toHaveCount(1);
    // A link copied before the regrouping opens the same physical page.
    await page.goto(linkBefore);
    await expectIdentityText(page, 13, "PDF page 13 of 14 · part 1 of 2");
    // The ranges were rebuilt, not lost.
    await goToPage(page, 12);
    await expect(page.getByTestId("range-times")).toHaveText(named("2:04 – 2:21"));

    // --- split a group (the two steps of pages 7–8) ----------------------------------------------------------------------
    await goToPage(page, 8);
    await recordGrouping(page, /^This page starts a new slide/);
    await expectIdentityText(page, 8, "PDF page 8 of 14");
    outline = await showOutline(page);
    await expect(outline.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: /^Page 7: Reading the plate/ })).toHaveCount(1);
    await expect(outline.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: /^Page 8: Reading the plate/ })).toHaveCount(1);
    await expect(outline.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: /^Pages 7–8:/ })).toHaveCount(0);
    await goToPage(page, 7);
    await expect.poll(() => identityLine(page)).toBe("PDF page 7 of 14");

    // --- change a role from the page's details under Sources -------------------------------------------------------------
    await goToPage(page, 8);
    await (await pageFacts(page)).getByRole("button", { name: "Correct the grouping or the role" }).click();
    const dialog = page.getByRole("dialog", { name: "Correct the grouping or the role" });
    await dialog.getByRole("radio", { name: /^Worked example or question/ }).check();
    await dialog.getByRole("button", { name: "Record the correction" }).click();
    await expect(dialog).toBeHidden();
    await expectRematched(page, "Your correction was recorded.");
    await expect.poll(async () => textOf(await pageFacts(page))).toMatch(/Role Worked example or question, human-confirmed\./);
    // The rebuild follows this correction too: the lecture keeps its ranges (they are not left at "Not matched yet").
    await goToPage(page, 3);
    await expect(page.getByTestId("range-times")).toHaveText(named("0:05 – 0:28"), { timeout: 20_000 });
    await expect(page.getByTestId("no-range-line")).toHaveCount(0);

    // After a reload all three corrections are still there.
    await page.reload();
    await goToPage(page, 8);
    await expect.poll(() => identityLine(page)).toBe("PDF page 8 of 14");
    await expect.poll(async () => textOf(await pageFacts(page))).toMatch(/Role Worked example or question, human-confirmed\./);
    await goToPage(page, 14);
    await expect.poll(() => identityLine(page)).toBe("PDF page 14 of 14 · part 2 of 2");

    // --- the corrections in force are named with what taking them back restores; each is taken back -------------------------
    let grouping = await openGroupingDialog(page);
    await expect.poll(async () => textOf(grouping)).toContain("Now: 2 pages grouped by you, pp. 13–14");
    await expect.poll(async () => textOf(grouping.getByRole("group", { name: "What is right?" }))).toContain("Take back your correction Earlier you grouped pp. 13–14. Taking it back restores what held before it; it stays in the history.");
    await grouping.getByRole("button", { name: "Cancel" }).click();
    await recordGrouping(page, /^Take back your correction Earlier you grouped pp\. 13–14/);
    await expectIdentity(page, 14);

    await goToPage(page, 8);
    await takeBackRole(page);
    await expect.poll(async () => textOf(await pageFacts(page))).toMatch(/Role Instructional, generated\./);
    grouping = await openGroupingDialog(page);
    await expect.poll(async () => textOf(grouping.getByRole("group", { name: "What is right?" }))).toContain("Take back your correction Earlier you started a new slide at p. 8.");
    await grouping.getByRole("button", { name: "Cancel" }).click();
    await recordGrouping(page, /^Take back your correction Earlier you started a new slide at p\. 8/);
    await expectIdentity(page, 8);

    // What was worked out from the file holds again, with its ranges.
    outline = await showOutline(page);
    await expect(outline.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: /^Pages 7–8: Reading the plate, 2 steps, pp\. 7–8$/ })).toHaveCount(1);
    await expect(outline.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: /^Page 13: Dynamic range and saturation$/ })).toHaveCount(1);
    await expect(outline.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: /^Page 14: Summary$/ })).toHaveCount(1);
    await showSlide(page);
    await expect(page.getByTestId("range-times")).toHaveText(named("0:59 – 1:19"));
    await expect.poll(async () => textOf(page.getByTestId("range-line"))).toContain("Suggestion");
  });

  test("R2-S6 the identity line says what is known and nothing stronger: the physical page, a build or a step of its sequence, and no slide number that is not established", async ({ page }) => {
    // Not in the fixture: a printed slide number, a PowerPoint match, a PowerPoint file without a match, a duplicate, a handout region, an uncertain grouping.
    await openShowcase(page);
    for (let physical = 1; physical <= PAGES; physical++) {
      await goToPage(page, physical);
      const words = await identityLine(page);
      expect(words).toBe(IDENTITY[physical]);
      expect(words, "no slide number is derived from the page index").not.toMatch(/Slide/);
    }
    // In a sequence the controls say which member they go to; a step is a step.
    await goToPage(page, 7);
    await expect(page.getByRole("button", { name: "Next page: step 2 of 2" })).toBeVisible();
    await expect(page.getByTestId("slide-canvas")).toHaveAccessibleName(named("PDF page 7 of 14 · step 1 of 2: Reading the plate — original source, colours unchanged"));

    // On request: how the grouping is known and that no printed number is established.
    let menu = await openRoleMenu(page);
    await expect.poll(async () => textOf(menu.getByTestId("identity-details"))).toMatch(/^2 steps, pp\. 7–8: inferred from the file, generated: /);
    await closeMenu(page);
    let facts = await pageFacts(page);
    await expect.poll(async () => textOf(facts)).toMatch(/Position PDF page 7 of 14/);
    await expect.poll(async () => textOf(facts)).toMatch(/Group Step 1 of 2, pp\. 7–8\. Inferred from the file, generated: /);
    await expect.poll(async () => textOf(facts)).toMatch(/Printed slide number Not established/);
    await goToPage(page, 5);
    menu = await openRoleMenu(page);
    await expect.poll(async () => textOf(menu.getByTestId("identity-details"))).toMatch(/^3 builds, pp\. 4–6: inferred from the file, generated: /);
    await closeMenu(page);
    // A page on its own has nothing more to say about a group.
    await goToPage(page, 3);
    menu = await openRoleMenu(page);
    await expect(menu.getByRole("menuitemradio", { name: "Instructional", exact: true })).toBeVisible();
    await expect(menu.getByTestId("identity-details")).toHaveCount(0);
    await closeMenu(page);
    facts = await pageFacts(page);
    await expect.poll(async () => textOf(facts)).toMatch(/Group A single page\./);
  });

  test("R2-S7 the slide details show the role and how it was established; the correction control changes it and after a reload it is the learner's; a generated role is never called reviewed or confirmed", async ({ page }) => {
    test.setTimeout(120_000);
    await openShowcase(page);
    await goToPage(page, 13);
    let facts = await pageFacts(page);
    await expect.poll(async () => textOf(facts)).toMatch(/Role Instructional, generated\. \d+ words of content/);
    await expect.poll(async () => textOf(facts), "a generated role is not worded as reviewed or confirmed").not.toMatch(/reviewed|confirmed/i);
    let menu = await openRoleMenu(page);
    await expect.poll(async () => textOf(menu)).toMatch(/Role of this page · generated/);
    await expect.poll(async () => textOf(menu)).toContain("How it was established");
    await expect.poll(async () => textOf(menu)).not.toMatch(/reviewed|confirmed/i);
    await expect(menu.getByRole("menuitemradio", { name: "Instructional", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(menu.getByRole("menuitem", { name: "Take back your correction" })).toHaveCount(0);
    await closeMenu(page);

    await setRole(page, "Worked example or question");
    try {
      // The contract's word for a role a person set is "human-confirmed" (the plan writes "set by you"); the basis names the learner's correction.
      const corrected = /Role Worked example or question, human-confirmed\. correction r\d+: Corrected by the learner in the lecture workspace/;
      await expect.poll(async () => textOf(await pageFacts(page))).toMatch(corrected);
      await page.reload();
      await expectIdentity(page, 13);
      facts = await pageFacts(page);
      await expect.poll(() => textOf(facts)).toMatch(corrected);
      menu = await openRoleMenu(page);
      await expect.poll(async () => textOf(menu)).toMatch(/Role of this page · human-confirmed/);
      await expect(menu.getByRole("menuitemradio", { name: "Worked example or question", exact: true })).toHaveAttribute("aria-checked", "true");
      await closeMenu(page);
      // Every other page keeps its generated role.
      await goToPage(page, 12);
      await expect.poll(async () => textOf(await pageFacts(page))).toMatch(/Role Worked example or question, generated\./);
      await goToPage(page, 13);
    } finally {
      await takeBackRole(page);
    }
    await expect.poll(async () => textOf(await pageFacts(page))).toMatch(/Role Instructional, generated\./);
  });

  test("R2-S8 a structural page asks for nothing: no explain-back, no question or concept list of its own, no missing-match line; Next content goes to the next content page and the lecture's questions stay", async ({ page }) => {
    // Not in the fixture: a title page with a supported interval (the showcase title page has no talk over it).
    await openShowcase(page);
    for (const [physical, role, next] of [[1, "Structural (title or section)", 2], [11, "Administrative", 12]] as const) {
      await goToPage(page, physical);
      // The recording: the structural line, which is not a missing match.
      const line = page.getByTestId("no-range-line");
      await expect(line).toHaveAttribute("data-state", "no_range_expected");
      const words = await noRangeWords(page);
      expect(words).toContain("Structural page");
      expect(words).toContain("No recording range is expected for this page.");
      expect(words).not.toMatch(/not found|not matched|not discussed|not processed|ambiguous|unavailable/i);

      // Tutor: no prompt to explain the page back.
      await openTab(page, "Tutor");
      const interaction = page.getByRole("radiogroup", { name: "Interaction" });
      await expect(interaction.getByRole("radio", { name: "Quick answer" })).toBeVisible();
      await expect(interaction.getByRole("radio", { name: "Explain back" })).toHaveCount(0);

      // Questions: the role is said; no This-slide list, no "no questions" warning, no generated practice; the lecture's list is there.
      await openTab(page, "Questions");
      const questions = page.getByTestId("questions-tab");
      await expect.poll(async () => textOf(questions.getByTestId("structural-note"))).toContain(role);
      await expect(questions.getByTestId("this-slide-list")).toHaveCount(0);
      await expect(questions.getByRole("button", { name: /^This slide/ })).toHaveCount(0);
      await expect(questions.getByTestId("lecture-questions-hint")).toHaveCount(0);
      await expect.poll(async () => textOf(questions)).not.toMatch(/no question|generated practice/i);
      await expect(questions.getByRole("button", { name: "All lecture questions 6" })).toHaveAttribute("aria-expanded", "true");
      await expect(questions.getByTestId("lecture-questions").getByTestId("question-row")).toHaveCount(6);

      // Concepts: no empty branch.
      await openTab(page, "Concepts");
      const concepts = page.getByTestId("concepts-tab");
      await expect(concepts.getByTestId("structural-note")).toContainText("No concept list is kept for a title, section, administrative or blank page.");
      await expect(concepts.getByTestId("concepts-tree")).toHaveCount(0);
      await expect(concepts.getByRole("tree")).toHaveCount(0);

      // Next content: the one action of the line, and it lands on the next content page.
      await showSlide(page);
      await expect(page.getByTestId("no-range-action")).toHaveText("Next content");
      await page.getByTestId("no-range-action").click();
      await expectIdentity(page, next);
    }
    // From a content page Next content steps over the administrative page.
    await goToPage(page, 10);
    await page.getByTestId("next-content").click();
    await expectIdentity(page, 12);
    // A content page does offer the explanation.
    await openTab(page, "Tutor");
    await expect(page.getByRole("radiogroup", { name: "Interaction" }).getByRole("radio", { name: "Explain back" })).toBeVisible();
  });

  test("R2-S9 the page that is only a formula is in the outline, is reached by Next content and behaves as an ordinary content page", async ({ page }) => {
    // Not in the fixture: a page that is only a picture.
    await openShowcase(page);
    const outline = await showOutline(page);
    const row = outline.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: /^Page 10: Calibration line$/ });
    await expect(row).toHaveAttribute("data-row", "page"); // not drawn as a structural row
    await goToPage(page, 9);
    await page.getByTestId("next-content").click();
    await expectIdentity(page, 10);
    // Its role is a content role although its text is sparse; the role says that it is uncertain, not that it is blank.
    await expect.poll(async () => textOf(await pageFacts(page))).toMatch(/Role Instructional, generated, uncertain\./);
    // It has its own question list, its own range and the ordinary kinds of help.
    await openTab(page, "Questions");
    await expect(page.getByTestId("questions-tab").getByTestId("structural-note")).toHaveCount(0);
    await expect(page.getByTestId("this-slide-list").locator('[data-question-id="BE505-L05-Q04"]')).toBeVisible();
    await openTab(page, "Tutor");
    await expect(page.getByRole("radiogroup", { name: "Interaction" }).getByRole("radio", { name: "Explain back" })).toBeVisible();
    await showSlide(page);
    await expect(page.getByTestId("range-times")).toHaveText(named("1:19 – 1:30"));
    await expect(page.getByTestId("no-range-line")).toHaveCount(0);
  });

  test("R2-S10 the deck shows its raw page count and its teaching-content count as two labelled figures with the counts of the other roles, adding up to the file's pages; after two pages are re-labelled structural the raw figure is unchanged, the excluded count is higher by two and says who set those roles, and nothing calls the deck complete", async ({ page }) => {
    // Where it is on screen: the Sources tab of the lecture ("Pages by role") and the deck's own row in the coverage readback
    // (Settings, Build and data). Pages 13 (teaching content) and 14 (a summary, listed as uncertain) are re-labelled with
    // the role menu of the page band, so the teaching-content figure moves by the one page that was teaching content.
    test.setTimeout(300_000);
    const NOT_COMPLETE = /\b(complete|completed|done|finished|all pages|covered)\b|%/i;
    await openShowcase(page);
    const timing = async (): Promise<string> => {
      await openTab(page, "Sources");
      return textOf(page.getByTestId("source-timing"));
    };
    const inSources = async (): Promise<DeckFigures> => {
      await openTab(page, "Sources");
      await expect(page.getByTestId("deck-pages")).toBeVisible();
      return deckFigures(page.getByTestId("deck-pages"));
    };
    const inCoverage = async (): Promise<DeckFigures> => {
      const readback = await openCoverage(page, COURSE);
      const row = readback.locator("li[data-stage]").filter({ hasText: TITLE }).getByTestId("deck-row");
      await expect(row).toHaveAttribute("data-deck-state", "pdf");
      return deckFigures(row);
    };
    /** The lecture again (after the coverage page), on a page of the file. */
    const backOn = async (physical: number): Promise<void> => {
      if (!(await page.getByTestId("lecture-workspace").isVisible().catch(() => false))) await openLecture(page, LECTURE, TITLE);
      await goToPage(page, physical);
    };

    // As the file is: two labelled figures, the other roles in words, and everything on screen adds up to the file's pages.
    await expect.poll(timing).toBe("Slide-linked. 8 ranges for 8 of 14 pages; 2 pages expect none.");
    await expect(page.getByTestId("source-deck")).toContainText("14 pages.");
    const before = await inSources();
    expect([before.raw, before.instructional, before.uncertain, before.excluded]).toEqual([PAGES, 10, 2, 2]);
    expect(before.instructional + before.uncertain + before.excluded).toBe(PAGES);
    expect(before.rawLabel).toBe("PDF pages 14");
    expect(before.instructionalLabel).toBe("Count as teaching content 10");
    expect(before.words).toContain("2 objectives or summary pages are listed as uncertain, not excluded. 2 pages are excluded: 1 title or section page, 1 administrative page.");
    expect(before.words).toContain("Roles: 14 generated by the detector, none set by you or by an agent.");
    expect(before.words, "nothing calls the deck complete").not.toMatch(NOT_COMPLETE);
    const coverageBefore = await inCoverage();
    expect([coverageBefore.raw, coverageBefore.instructional, coverageBefore.uncertain, coverageBefore.excluded]).toEqual([PAGES, 10, 2, 2]);
    expect(coverageBefore.words).toBe("Slides: Fixture Lecture 05 - R2 showcase.pdf. Readable PDF. 14 PDF pages, 10 count as teaching content. 2 objectives or summary pages are listed as uncertain, not excluded. "
      + "2 pages are excluded: 1 title or section page, 1 administrative page. Roles: 14 generated by the detector, none set by you or by an agent. Ranges on 8 of 14 pages.");

    await backOn(13);
    await setRole(page, "Blank");
    try {
      await goToPage(page, 14);
      await setRole(page, "Administrative");
      try {
        // The raw figure is the same; the excluded count is higher by exactly the two pages, and the line says who set them.
        await expect.poll(async () => (await inSources()).excluded, "the excluded count is higher by two").toBe(before.excluded + 2);
        const after = await inSources();
        expect(after.raw, "the raw figure is unchanged").toBe(before.raw);
        expect(after.excluded, "the excluded count is higher by two").toBe(before.excluded + 2);
        expect([after.instructional, after.uncertain]).toEqual([before.instructional - 1, before.uncertain - 1]); // one of the two was teaching content, the other a summary
        expect(after.instructional + after.uncertain + after.excluded).toBe(PAGES);
        expect(after.words).toContain("1 objectives or summary page is listed as uncertain, not excluded. 4 pages are excluded: 1 title or section page, 2 administrative pages, 1 blank page.");
        expect(after.words).toContain("Roles: 12 generated by the detector, 2 set by you. Of the 5 pages outside the teaching count: 2 set by you, 3 generated by the detector.");
        expect(after.words, "nothing calls the deck complete").not.toMatch(NOT_COMPLETE);
        await expect.poll(timing).toBe("Slide-linked. 8 ranges for 8 of 14 pages; 4 pages expect none.");
        await expect.poll(timing, "nothing calls the deck complete").not.toMatch(NOT_COMPLETE);
        // Each re-labelled page says who set its role, and its own state follows its role only.
        await expect.poll(async () => textOf(await pageFacts(page))).toMatch(/Role Administrative, human-confirmed\. correction r\d+: Corrected by the learner/);
        await showSlide(page);
        await expect(page.getByTestId("no-range-line")).toHaveAttribute("data-state", "no_range_expected");
        // A page that was not re-labelled keeps its own state.
        await goToPage(page, 9);
        await expect(page.getByTestId("no-range-line")).toHaveAttribute("data-state", "audio_unprocessed");
        await goToPage(page, 12);
        await expect(page.getByTestId("range-times")).toHaveText(named("2:04 – 2:21"));
        // The coverage readback states the same deck the same way.
        const coverageAfter = await inCoverage();
        expect(coverageAfter.raw).toBe(coverageBefore.raw);
        expect(coverageAfter.excluded).toBe(coverageBefore.excluded + 2);
        expect(coverageAfter.instructional + coverageAfter.uncertain + coverageAfter.excluded).toBe(PAGES);
        expect(coverageAfter.words).toBe("Slides: Fixture Lecture 05 - R2 showcase.pdf. Readable PDF. 14 PDF pages, 9 count as teaching content. 1 objectives or summary page is listed as uncertain, not excluded. "
          + "4 pages are excluded: 1 title or section page, 2 administrative pages, 1 blank page. Roles: 12 generated by the detector, 2 set by you. "
          + "Of the 5 pages outside the teaching count: 2 set by you, 3 generated by the detector. Ranges on 8 of 14 pages.");
        expect(coverageAfter.words, "nothing calls the deck complete").not.toMatch(NOT_COMPLETE);
      } finally {
        await backOn(14);
        await takeBackRole(page);
      }
      await expect.poll(timing).toBe("Slide-linked. 8 ranges for 8 of 14 pages; 3 pages expect none.");
    } finally {
      await backOn(13);
      await takeBackRole(page);
    }
    // Taken back: the fixture as it was found, on both screens.
    await expect.poll(timing).toBe("Slide-linked. 8 ranges for 8 of 14 pages; 2 pages expect none.");
    await expect.poll(async () => (await inSources()).words).toBe(before.words);
    expect((await inCoverage()).words).toBe(coverageBefore.words);
    // The raw figure on Study is the same one.
    await page.goto("/study");
    await page.getByTestId("course-tabs").locator(`[data-course="${COURSE}"]`).click();
    await expect(page.locator(`[data-testid="lecture-row"][data-lecture="${LECTURE}"]`)).toContainText("ranges on 8 of 14 pages");
  });

  test("R2-S11 the lecture says which version of the deck and of the recording its pages and links belong to", async ({ page }) => {
    // Not in the fixture: a second version of the deck. That links made for an earlier version are listed for review and never
    // shown on a page of the new version cannot be observed here; only the version a link is made for.
    await openShowcase(page);
    await goToPage(page, 3);
    await openTab(page, "Sources");
    await expect(page.getByTestId("source-deck")).toContainText(/version v1-[0-9a-f]{12}/);
    await expect(page.getByTestId("source-recording")).toContainText(/version v1-[0-9a-f]{12}/);
    const deck = await textOf(page.getByTestId("source-deck"));
    const version = /version (v1-[0-9a-f]{12})/.exec(deck)?.[1];
    expect(version, `the deck row names its version: "${deck}"`).toBeTruthy();
    await expect.poll(async () => textOf(page.getByTestId("deck-facts"))).toContain(`Fixture Lecture 05 - R2 showcase.pdf · version ${version}`);
    const recording = /version (v1-[0-9a-f]{12})/.exec(await textOf(page.getByTestId("source-recording")))?.[1];
    expect(recording).toBeTruthy();
    expect(recording).not.toBe(version);
    // A link the learner is about to make states the versions it will be made for (nothing is saved here).
    await showSlide(page);
    await page.getByTestId("transport-more-button").click();
    await page.getByRole("menuitem", { name: "Mark a range for this slide" }).click();
    const dialog = page.getByRole("dialog", { name: "Link this slide to the recording" });
    await expect.poll(async () => textOf(dialog)).toContain(`Page 3 · deck version ${version}`);
    await expect.poll(async () => textOf(dialog)).toContain(`Fixture Lec 5 Sep 15.wav · version ${recording}`);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("range-times")).toHaveText(named("0:05 – 0:28"));
  });

  // ==== timing ================================================================================================================

  test("R2-T1 the imported generated speech text stands under its own heading with the window it covers and 'generated, not reviewed'; the course transcript is not shown as timed and coverage shows the window as a part of the recording", async ({ page }) => {
    await openShowcase(page);
    await goToPage(page, 3);
    await openTab(page, "Transcript");
    const generated = page.getByTestId("generated-text");
    await expect(generated.getByRole("heading", { name: "Generated speech text" })).toBeVisible();
    await expect.poll(async () => textOf(generated.getByTestId("generated-window"))).toMatch(/^Covers 0:00 – 1:30 and 1:38 – 2:30 of the recording\. Not resolved: 1:30 – 1:38\. Generated, not reviewed\./);
    await expect(page.getByTestId("course-transcript").getByRole("heading", { name: "Course transcript" })).toBeVisible();
    await expect(page.getByTestId("course-transcript").getByTestId("generated-window")).toHaveCount(0);

    // The lecture's own transcript file is not turned into a timed transcript by the import.
    await openTab(page, "Sources");
    await expect.poll(async () => textOf(page.getByTestId("source-transcript"))).toContain("41 lines. Original text, without times.");
    await expect.poll(async () => textOf(page.getByTestId("source-timing"))).toMatch(/^Slide-linked\. 8 ranges for 8 of 14 pages/);

    // Coverage: the window is a part of the recording, with what is not resolved said beside it.
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Settings" }).click().catch(async () => {
      await page.getByRole("button", { name: /^Menu: / }).click();
      await page.getByRole("menuitem", { name: "Settings" }).click();
    });
    await page.getByRole("link", { name: "Build and data" }).click();
    const readback = page.locator(`[data-testid="timing-readback"][data-course="${COURSE}"]`);
    await readback.getByRole("button", { name: /^Each lecture/ }).click();
    const row = readback.getByRole("listitem").filter({ hasText: TITLE });
    await expect.poll(async () => textOf(row)).toContain("Fixture Lec 5 Sep 15.wav, 2 min 30 s. Covers 0:00 – 1:30 and 1:38 – 2:30 of the recording. Not resolved: 1:30 – 1:38.");
    await expect.poll(async () => textOf(readback)).toContain("Speech text was generated for 1 of 3 recordings and covers 2 min 22 s of them.");
    await expect.poll(async () => textOf(readback)).toContain("8 s could not be resolved");
  });

  test("R2-T2 coverage states the processing allowance only as recorded and names the command that continues; a generated range and the coverage name what made the speech text, its identifiers under a closed Details; of a prepared later run the fixture states that there is none and that nothing is scheduled", async ({ page }) => {
    // Not in the fixture: an allowance record (time used and remaining), a run paused at the ceiling or by a stop, its remaining queue.
    // Not in the fixture: a prepared binding. It is listed only where a speech tool is set up and its runner has published
    // text (brain/tests/test_speech_binding.py shows that state with the labelled fake worker); the fixture has no speech
    // tool, so the page says that none is prepared and that nothing is scheduled.
    await openShowcase(page);
    await goToPage(page, 3);
    const list = await openRangeList(page);
    await list.getByRole("button", { name: named("Qualities of the range 0:05 – 0:28") }).click();
    const qualities = await textOf(list.getByTestId("range-qualities"));
    expect(qualities).toContain("Times come from speech text generated on this computer (synthetic-fixture-speech-double, model none-synthetic-no-recognition). Nobody has listened.");
    await closeRangeList(page);

    await page.goto("/study");
    await page.getByRole("link", { name: "Settings" }).first().click().catch(async () => {
      await page.getByRole("button", { name: /^Menu: / }).click();
      await page.getByRole("menuitem", { name: "Settings" }).click();
    });
    await page.getByRole("link", { name: "Build and data" }).click();
    const readback = page.locator(`[data-testid="timing-readback"][data-course="${COURSE}"]`);
    // No allowance record exists in the fixture: that is said, and no time used or remaining is invented.
    await expect.poll(async () => textOf(readback.getByTestId("timing-allowance"))).toBe("The allowance record is absent or could not be read, so nothing is stated about it.");
    await expect.poll(async () => textOf(readback)).toContain("Allowance The allowance record is absent or could not be read, so nothing is stated about it."); // the fact is headed "Allowance"
    await expect.poll(async () => textOf(readback)).not.toMatch(/\bused of\b|\bremaining\b/);
    await expect(readback.getByRole("heading", { name: "Command that continues transcription" })).toBeVisible();
    await expect.poll(async () => textOf(readback)).toMatch(/-m lecture_brain --profile fixture --state-dir \S+ speech-run/);
    // Each generated speech text names what made it, in words: the tool, its version and the model, and how many recordings.
    const runners = readback.getByTestId("timing-runners");
    await expect(runners.getByRole("heading", { name: "What made the generated speech text" })).toBeVisible();
    await expect(runners.getByTestId("timing-runner")).toHaveCount(1); // one generated text in this course, so one identity
    await expect.poll(async () => textOf(runners.getByTestId("timing-runner"))).toMatch(/^synthetic-fixture-speech-double, version \d+, model none-synthetic-no-recognition\. 1 recording\. Details$/);
    // Its identifiers are under a closed "Details": the parameters identity as a short digest, who made it, the recording.
    const details = runners.getByRole("button", { name: "Details" });
    await expect(details).toHaveAttribute("aria-expanded", "false");
    await expect.poll(async () => textOf(runners)).not.toMatch(/[0-9a-f]{12}…/);
    await details.click();
    await expect.poll(async () => textOf(runners)).toMatch(/Parameters stated by the text [0-9a-f]{12}… Made by A labelled synthetic sample Recordings Fixture Lec 5 Sep 15\.wav$/);
    await expect.poll(async () => textOf(runners), "this text was not made by the installation's runner: no settings identity is claimed for it").not.toContain("Settings identity");
    // The prepared binding of later runs, as the fixture states it: no speech tool is set up, so none is prepared, nothing is scheduled and no command is offered for it.
    const binding = readback.getByTestId("timing-binding");
    await expect.poll(async () => textOf(binding)).toBe("Later transcription runs No speech tool is set up on this installation, so no later run is prepared and nothing is scheduled.");
    await expect(binding).toHaveAttribute("data-state", "none");
    await expect(binding.getByRole("button")).toHaveCount(0);
    // A recording that was not started says so with its cause, and nothing estimates what remains.
    await readback.getByRole("button", { name: /^Each lecture/ }).click();
    await expect.poll(async () => textOf(readback.getByRole("listitem").filter({ hasText: "Fixture Lecture 01 - Plasmid anatomy" }))).toContain("No speech text has been generated for this recording. Text alignment not run yet · Slide matching not run yet");
    await expect.poll(async () => textOf(page.getByRole("region", { name: "Speech timing and transcription" }))).toContain("nothing here estimates what remains");
  });

  test("R2-T3 the generated text shows every sentence once; its last line seeks to a time inside the recording and no line shows a time after the recording's end", async ({ page }) => {
    // Not in the fixture: a recording generated in several chunks with a sentence planted across a seam (its text is one generation).
    await openShowcase(page);
    await goToPage(page, 3);
    await openTab(page, "Transcript");
    const generated = page.getByTestId("generated-text");
    const heading = generated.getByRole("button", { name: "Generated speech text" });
    if ((await heading.getAttribute("aria-expanded")) !== "true") await heading.click();
    // 39 stretches of text, and between them the one stretch nobody resolved, which is an entry of its own without text.
    const entries = generated.getByRole("list", { name: "Generated speech text" }).getByRole("listitem");
    await expect(entries).toHaveCount(40);
    const lines = entries.filter({ has: page.getByRole("button", { name: /^Go to \d+:\d\d in the recording/ }) });
    await expect(lines).toHaveCount(39);
    await expect(generated.getByTestId("generated-gap")).toHaveCount(1);
    const sentences = (await lines.locator("p").allInnerTexts()).map(clean);
    expect(new Set(sentences).size, "no sentence is listed twice").toBe(sentences.length);
    expect(sentences.filter((sentence) => sentence === "Promoter fragment, coding sequence, binding site, terminator: that is the construct.")).toHaveLength(1);
    // The stretch nobody resolved has no text and says so.
    await expect.poll(async () => textOf(generated.getByTestId("generated-gap"))).toBe("No text for 1:30 – 1:38");

    // No time after the end of the recording (2:30), in either list.
    await expect(page.getByTestId("course-transcript").getByTestId("transcript-lines").getByRole("listitem")).toHaveCount(41);
    const times =(await page.getByTestId("transcript-tab").getByRole("button", { name: /^Go to \d+:\d\d in the recording/ }).allInnerTexts()).map(clean);
    expect(times.length).toBeGreaterThan(70);
    for (const time of times) {
      const [minutes, seconds] = time.split(":").map(Number);
      expect(minutes! * 60 + seconds!, `time ${time}`).toBeLessThanOrEqual(RECORDING_S);
    }
    // The last generated line seeks the one player to a time inside the recording; nothing starts playing.
    await lines.last().getByRole("button", { name: /^Go to 2:18 in the recording \(generated timing, not reviewed\)$/ }).click();
    await expectAt(page, 137.92, 0.5);
    const state = await media(page);
    expect(state.count).toBe(1);
    expect(state.t).toBeLessThan(state.duration);
    expect(Math.round(state.duration)).toBe(RECORDING_S);
    expect(state.paused).toBe(true);
  });

  test("R2-T4 the course transcript reads as its original file; an aligned line shows a time and seeks the one player to it; an unaligned line shows no time and offers no seek; the generated text has its own heading", async ({ page }) => {
    await openShowcase(page);
    await goToPage(page, 3);
    await openTab(page, "Transcript");
    const course = page.getByTestId("course-transcript");
    const generated = page.getByTestId("generated-text");
    await expect(course.getByRole("heading", { name: "Course transcript" })).toBeVisible();
    await expect(generated.getByRole("heading", { name: "Generated speech text" })).toBeVisible();
    const heading = generated.getByRole("button", { name: "Generated speech text" });
    if ((await heading.getAttribute("aria-expanded")) !== "true") await heading.click();

    // Wording that exists only in the generated text is not in the course transcript, and the other way round.
    const original = "Then add a ribosome binding site so the message is translated.";
    const planted = "Tan ladder rival zone fine dings sight sold mess edge trance.";
    const lines = course.getByTestId("transcript-lines");
    await expect(lines.getByRole("listitem")).toHaveCount(41);
    await expect.poll(async () => textOf(lines.locator('[data-line="14"]'))).toContain(original);
    await expect.poll(async () => textOf(lines)).not.toContain(planted);
    await expect.poll(async () => textOf(generated)).toContain(planted);
    await expect.poll(async () => textOf(generated)).not.toContain(original);

    // An aligned line: a time, labelled generated and not reviewed; selecting it puts the one player at that start. Nothing plays.
    await expectPaused(page);
    await lines.locator('[data-line="7"]').getByRole("button", { name: "Go to 0:20 in the recording (generated timing, not reviewed)" }).click();
    await expectAt(page, 20.16, 0.5);
    await expectPaused(page);
    await lines.locator('[data-line="38"]').getByRole("button", { name: "Go to 2:07 in the recording (generated timing, not reviewed)" }).click();
    await expectAt(page, 126.72, 0.5);
    await expectPaused(page);

    // The four lines the alignment could not place show no time and offer no seek; they can still be selected to ask about.
    for (const unaligned of [14, 21, 27, 28]) {
      const line = lines.locator(`[data-line="${unaligned}"]`);
      await expect(line.getByRole("button", { name: /^Go to / })).toHaveCount(0);
      await expect.poll(async () => textOf(line)).not.toMatch(/\d:\d\d/);
      await expect(line.getByRole("button", { name: `Select line ${unaligned}` })).toHaveCount(1);
    }
    await expect(lines.getByRole("button", { name: /^Go to \d+:\d\d in the recording \(generated timing, not reviewed\)$/ })).toHaveCount(37);
    await expect.poll(async () => textOf(course.getByTestId("transcript-closing"))).toBe("37 of 41 lines have a time. A line shows a time only where text alignment supports it; the times are generated and not reviewed.");
  });

  test("R2-T5 the revisited slide has two rows of its own, the slide that was skipped shows a no-range state and the digression's minutes are in no slide's rows", async ({ page }) => {
    await openShowcase(page);
    await goToPage(page, 3);
    const revisited = await rangeRows(page);
    const own = revisited.filter((row) => row.scope === "page");
    expect(own.map((row) => row.times)).toEqual(["0:05 – 0:28", "1:50 – 2:04"]);
    await expect.poll(async () => textOf(page.getByTestId("range-list"))).toContain("3 ranges: 2 for this page, 1 for its section (pp. 3–6)");
    await closeRangeList(page);

    // The slide the talk never came to: a no-range state, not a range.
    await goToPage(page, 9);
    await expect(page.getByTestId("no-range-line")).toBeVisible();
    await expect(page.getByTestId("range-line")).toHaveCount(0);
    await expect(page.getByTestId("range-times")).toHaveCount(0);

    // Every row of every page that has ranges: none reaches into 1:38 – 1:49, where nobody's slide was talked about.
    const all = [...revisited];
    for (const physical of [4, 7, 10, 12]) {
      await goToPage(page, physical);
      all.push(...await rangeRows(page));
      await closeRangeList(page);
    }
    expect(all.length).toBe(3 + 2 + 1 + 1 + 2);
    for (const row of all) expect(row.end <= DIGRESSION_S.start || row.start >= DIGRESSION_S.end, `row ${row.times} keeps out of the digression`).toBe(true);
  });

  test("R2-T6 a suggestion names its method and version and says whether that method is benchmarked on this installation: not benchmarked without a record, the record's method, version and result with one; no suggestion is worded as aligned, verified or confirmed", async ({ page }, testInfo) => {
    // Not on screen: the side-by-side figures of a comparison (a private readback). The fixture has no benchmark record;
    // the one written below into THIS instance's state folder is a labelled synthetic record and is removed again.
    test.setTimeout(180_000);
    const UNBENCHMARKED = "Wording match, version 2. Not benchmarked on this installation.";
    const BENCHMARKED = "Wording match, version 2. Compared with plain word overlap on invented labelled windows of the synthetic showcase lecture: not clearly better.";
    const COURSE_STATED = "Stated by the course's study map, not suggested by a matching method.";
    const inHead = (words: string): string => `How the suggestions were made: ${words[0]!.toLowerCase()}${words.slice(1)}`;
    const NOT_SO_WORDED = /\b(aligned|verified|confirmed)\b/i;
    /** Page 3 of the showcase with its list open: the three rows are still suggestions, and the head and the Method rows say `method`. */
    const expectOnPage3 = async (method: string): Promise<void> => {
      await goToPage(page, 3);
      await expect.poll(async () => textOf(page.getByTestId("range-line"))).toContain("Suggestion");
      const rows = await rangeRows(page);
      expect(rows.map((row) => /Suggestion \(([^)]+)\)/.exec(row.text)?.[1]), "a benchmark of the method leaves every range a suggestion").toEqual(["wording match", "course study map", "wording match"]);
      const list = page.getByTestId("range-list");
      await expect.poll(async () => textOf(list.getByTestId("range-list-method"))).toBe(inHead(method));
      await expect(list.getByTestId("range-list-method")).toHaveCount(1); // once in the head, not once per row
      const qualityButtons = list.getByRole("button", { name: /^Qualities of the range / });
      await list.getByRole("button", { name: named("Qualities of the range 0:05 – 0:28") }).click();
      const qualities = list.getByTestId("range-qualities");
      await expect.poll(async () => textOf(qualities.getByTestId("range-benchmark"))).toBe(method);
      expect((await qualities.locator("dt").allInnerTexts()).map(clean)).toContain("Method");
      // The recorded name of the method stands once, in the evidence line; the sentences are plain words.
      await expect.poll(async () => textOf(qualities.getByTestId("range-method"))).toContain("Method: lexical-sequence 2");
      expect((await textOf(qualities)).match(/lexical-sequence/g)).toHaveLength(1);
      await expect.poll(async () => textOf(qualities)).toContain("Suggested by a wording match. Nobody has checked it.");
      // What the course itself states is no method's suggestion, with or without a record.
      await qualityButtons.nth(1).click();
      await expect.poll(async () => textOf(list.getByTestId("range-benchmark"))).toBe(COURSE_STATED);
      await expect.poll(async () => textOf(list)).not.toMatch(NOT_SO_WORDED);
      // Closed again: the same section range is listed on pages 4 to 6, and its opened qualities would be read as part of its row there.
      await qualityButtons.nth(1).click();
      await expect(list.getByTestId("range-qualities")).toHaveCount(0);
      await closeRangeList(page);
    };

    removeBenchmark(testInfo); // as the fixture makes the instance
    try {
      // ---- without a record: every suggestion says "not benchmarked", once in the head and under each range
      await openShowcase(page);
      await expectOnPage3(UNBENCHMARKED);
      for (const physical of [4, 7, 10, 12]) {
        await goToPage(page, physical);
        const rows = await rangeRows(page);
        for (const row of rows) {
          expect(row.text).toMatch(/Suggestion \((wording match|course study map)\)/);
          expect(row.text).not.toMatch(/\b(aligned|verified|confirmed|reviewed)\b/i);
        }
        const head = page.getByTestId("range-list").getByTestId("range-list-method");
        if (rows.some((row) => /Suggestion \(wording match\)/.test(row.text))) await expect.poll(async () => textOf(head), `page ${physical}`).toBe(inHead(UNBENCHMARKED));
        else await expect(head, `page ${physical}: only the course's own statements`).toHaveCount(0);
        await expect.poll(async () => textOf(page.getByTestId("range-list"))).not.toMatch(NOT_SO_WORDED);
        await closeRangeList(page);
      }
      let readback = await openCoverage(page, COURSE);
      await expect(readback.getByTestId("timing-benchmark").getByRole("heading", { name: "Benchmark of the slide-matching method" })).toBeVisible();
      await expect.poll(async () => textOf(readback.getByTestId("timing-benchmark")))
        .toContain("No benchmark record on this installation. The method that suggests ranges now (wording match, version 2) is not benchmarked here.");

      // ---- with a record that names exactly this method and version: its method, version and result are named
      writeBenchmark(testInfo, syntheticBenchmark());
      await openLecture(page, LECTURE, TITLE);
      await expectOnPage3(BENCHMARKED);
      readback = await openCoverage(page, COURSE);
      const block = readback.getByTestId("timing-benchmark");
      await expect.poll(async () => textOf(block)).toContain("This installation has a benchmark record for the method that suggests ranges now.");
      await expect.poll(async () => textOf(block)).toMatch(
        /Method Wording match, version 2 Compared with Plain word overlap, on invented labelled windows of the synthetic showcase lecture Result Not clearly better Labelled windows 24 Thresholds Fixed before the answers were read Recorded .*\b2026\b/);
      await expect.poll(async () => textOf(block)).toContain("It checks no range: every suggested range stays a suggestion.");
      await expect.poll(async () => textOf(block)).not.toMatch(/%|lexical-sequence|\b(aligned|verified)\b/i);

      // ---- a record for another version of the method is not this method's benchmark
      writeBenchmark(testInfo, syntheticBenchmark({ method: { name: "lexical-sequence", version: "1" } }));
      await openLecture(page, LECTURE, TITLE);
      await expectOnPage3("Wording match, version 2. Not benchmarked on this installation: the benchmark record here is for another version of this method.");

      // ---- a file that is not a record is treated as absent, said so, and left exactly as it is
      const notARecord = syntheticBenchmark({ accuracy: 0.99 });
      writeBenchmark(testInfo, notARecord);
      await openLecture(page, LECTURE, TITLE);
      await expectOnPage3("Wording match, version 2. Not benchmarked on this installation: its benchmark record could not be read.");
      readback = await openCoverage(page, COURSE);
      await expect.poll(async () => textOf(readback.getByTestId("timing-benchmark")))
        .toContain("The benchmark record of this installation could not be read (not part of the contract: accuracy). It is treated as absent and was not changed: the method that suggests ranges now (wording match, version 2) is not benchmarked here.");
      expect(readFileSync(benchmarkFile(testInfo), "utf8"), "never repaired").toBe(notARecord);
    } finally {
      removeBenchmark(testInfo);
    }
    // Back as the fixture makes it: not benchmarked.
    await openLecture(page, LECTURE, TITLE);
    await goToPage(page, 3);
    await openRangeList(page);
    await expect.poll(async () => textOf(page.getByTestId("range-list").getByTestId("range-list-method"))).toBe(inHead(UNBENCHMARKED));
    await closeRangeList(page);
  });

  test("R2-T7 a range's details show the recording, its times, the method, the evidence and three separately named qualities; no confidence figure; on the audio-only recording no range says shown or displayed", async ({ page }) => {
    await openShowcase(page);
    await goToPage(page, 3);
    const list = await openRangeList(page);
    const first = list.getByTestId("range-row").first();
    await expect.poll(async () => textOf(first)).toMatch(/^0:05 – 0:28 .*Suggestion \(wording match\) Lecture recording · this page/);
    await first.getByRole("button", { name: named("Qualities of the range 0:05 – 0:28") }).click();
    const qualities = list.getByTestId("range-qualities");
    const terms = (await qualities.locator("dt").allInnerTexts()).map(clean);
    expect(terms.slice(0, 3)).toEqual(["Timestamp quality (are the times of the words right)", "Association quality (is this talk about this slide)", "Group-mapping quality (is this page correctly grouped)"]);
    const states = (await qualities.locator("dd").allInnerTexts()).map(clean);
    expect(states[0]).toMatch(/^Generated on this PC from the audio\. Not reviewed\./);
    expect(states[1]).toMatch(/^Candidate\. Matched by wording and order/);
    expect(states[2]).toMatch(/^Generated\. page 3: one page is one slide/);
    expect(new Set(states.slice(0, 3)).size, "three states, each its own").toBe(3);
    const evidence = await textOf(qualities);
    expect(evidence).toMatch(/Evidence transcript lines 3–8 · Terms: .+ · Method: lexical-sequence 2/);
    await expect.poll(async () => textOf(list), "no single confidence figure").not.toMatch(/confidence|score/i);
    await closeRangeList(page);

    // The recording of this lecture is audio only: nothing says the slide was shown or displayed, anywhere a range is worded.
    await expect(page.locator("video")).toHaveCount(0);
    await expect(page.locator("audio")).toHaveCount(1);
    for (const physical of [3, 4, 7, 10, 12]) {
      await goToPage(page, physical);
      await expect.poll(async () => textOf(page.getByTestId("transport"))).not.toMatch(/\b(shown|displayed)\b/i);
      await openRangeList(page);
      await expect.poll(async () => textOf(page.getByTestId("range-list"))).not.toMatch(/\b(shown|displayed)\b/i);
      await expect.poll(async () => textOf(page.getByTestId("transport")), "no confidence figure in the bar").not.toMatch(/confidence/i);
      await closeRangeList(page);
    }
  });

  test("R2-T8 two visits are two rows and playing the first stops before the minutes between them; slides with different amounts of talk have ranges of different lengths; the range of a build group is group-level on every build", async ({ page }) => {
    test.setTimeout(120_000);
    await openShowcase(page);
    await goToPage(page, 3);
    const visits = (await rangeRows(page)).filter((row) => row.scope === "page");
    expect(visits.map((row) => row.times)).toEqual(["0:05 – 0:28", "1:50 – 2:04"]);
    await closeRangeList(page);
    await expectAt(page, VISIT_1.start / 1000, 0.5);
    await expectPaused(page);
    await cueBeforeEnd(page, VISIT_1);
    await playToTheEndAndStop(page, VISIT_1);
    expect((await media(page)).t, "it stopped before the second visit and before the minutes between").toBeLessThan(DIGRESSION_S.start);

    // Lengths follow the talk: nothing is divided evenly among the slides.
    const lengths: number[] = visits.map((row) => row.end - row.start);
    for (const physical of [10, 12]) {
      await goToPage(page, physical);
      lengths.push(...(await rangeRows(page)).filter((row) => row.scope === "page").map((row) => row.end - row.start));
      await closeRangeList(page);
    }
    // One range for the three builds, labelled as the group's on each build; no build has a range of its own.
    for (const physical of [4, 5, 6]) {
      await goToPage(page, physical);
      const rows = await rangeRows(page);
      expect(rows.map((row) => `${row.scope} ${row.times}`)).toEqual(["section 0:05 – 0:59", "build_group 0:28 – 0:59"]);
      expect(rows[1]!.text).toContain("all 3 builds");
      await expect.poll(async () => textOf(page.getByTestId("range-list"))).toContain("2 ranges: 1 for these pages, 1 for their section (pp. 3–6)");
      if (physical === 4) lengths.push(rows[1]!.end - rows[1]!.start);
      await closeRangeList(page);
    }
    expect(new Set(lengths).size, `lengths in seconds: ${lengths.join(", ")}`).toBe(lengths.length);
    expect(Math.max(...lengths)).toBeGreaterThanOrEqual(2 * Math.min(...lengths));
  });

  test("R2-T9 each no-range state shows its own line with its one action: structural page, ambiguous with its candidates, not found in the transcribed part, recording unavailable", async ({ page }) => {
    // Not in the fixture: "Not discussed (searched)" (the recording is never processed whole), "Not matched yet" (no recording is
    // transcribed without being matched), the untranscribed form of "Audio not processed yet" (every such page has a reviewed or
    // suggested link of its own), and a title page with a supported interval.
    await openShowcase(page);
    const lineOf = async (physical: number, state: string): Promise<string> => {
      await goToPage(page, physical);
      await expect(page.getByTestId("no-range-line")).toHaveCount(1);
      await expect(page.getByTestId("no-range-line")).toHaveAttribute("data-state", state);
      await expect(page.getByTestId("range-line")).toHaveCount(0);
      await expect(page.getByTestId("no-range-action")).toHaveCount(1);
      await expectPaused(page);
      return noRangeWords(page);
    };

    // Structural page → Next content.
    expect(await lineOf(1, "no_range_expected")).toMatch(/^Structural page.*No recording range is expected for this page\./);
    await expect(page.getByTestId("no-range-action")).toHaveText("Next content");

    // Ambiguous → Show candidates: the candidate is listed as a candidate, never as a range.
    const ambiguous = await lineOf(2, "ambiguous");
    expect(ambiguous).toMatch(/^Ambiguous/);
    expect(ambiguous).toMatch(/1 candidate, none clear enough to show\.|Possible matches were found, none clear enough to show as this page's range\./);
    await expect(page.getByTestId("no-range-action")).toHaveText("Show candidates");
    await page.getByTestId("no-range-action").click();
    const candidates = page.getByTestId("range-list");
    await expect(candidates.getByTestId("candidate-row")).toHaveCount(1);
    await expect(candidates.getByTestId("range-row")).toHaveCount(0);
    await expect.poll(async () => textOf(candidates)).toContain("1 candidate. None was clear enough to show as the range.");
    await expect.poll(async () => textOf(candidates.getByTestId("candidate-row"))).toMatch(/^0:00 – 0:05 .*Candidate, not shown as a range/);
    await page.getByTestId("no-range-action").click();
    await expect(candidates).toBeHidden();

    // Only a part of the recording has timing and nothing for the page was found in it → Open whole recording.
    for (const physical of [9, 13, 14]) {
      const partly = await lineOf(physical, "audio_unprocessed");
      expect(partly).toMatch(/^Not found in the transcribed/);
      expect(partly).toContain("Timing covers 2:22 of the recording's 2:30; nothing was found for this page in that part.");
      expect(partly, "it is neither 'not discussed' nor 'not matched'").not.toMatch(/not discussed|not matched/i);
      await expect(page.getByTestId("no-range-action")).toHaveText("Open whole recording");
    }
    await page.getByTestId("no-range-action").click();
    await expect(page.getByTestId("transport")).toHaveAttribute("data-mode", /^(opened|whole)$/);
    await expect(page.getByTestId("clip-scrubber")).toHaveAccessibleName("Position in the whole recording");
    await expectPaused(page);

    // No recording at all: the reason is stated and no action is offered.
    await openLecture(page, "lecture-03", "Fixture Lecture 03 - Cloning workflow");
    await showSlide(page);
    await expect(page.getByTestId("transport")).toHaveAttribute("data-mode", "unavailable");
    await expect(page.getByTestId("no-range-line")).toHaveAttribute("data-state", "recording_unavailable");
    await expect.poll(async () => textOf(page.getByTestId("no-range-line"))).toBe("Recording unavailable No recording is available for this lecture.");
    await expect(page.getByTestId("no-range-action")).toHaveCount(0);
    await expect(page.getByTestId("transport").getByRole("button")).toHaveCount(0);
    await expect(page.locator("audio, video")).toHaveCount(0);
  });

  test("R2-T10 suggestions are shown without any confirmation, read 'suggestion' with their method and their times, and none reads confirmed; a range the learner entered stays theirs through a rebuild and no suggestion replaces it", async ({ page }) => {
    // Not in the fixture: a regenerated timing generation (ranges built from an older generation no longer shown as current).
    test.setTimeout(180_000);
    await openShowcase(page);
    await goToPage(page, 3);
    const before = await rangeRows(page);
    expect(before.map((row) => row.times)).toEqual(["0:05 – 0:28", "0:05 – 0:59", "1:50 – 2:04"]);
    for (const row of before) {
      expect(row.text).toMatch(/Suggestion \((wording match|course study map)\)/);
      expect(row.text).not.toMatch(/confirmed|reviewed|Marked by you/i);
    }
    await expect(page.getByTestId("range-list").getByRole("button", { name: /confirm/i })).toHaveCount(0);
    await closeRangeList(page);

    // The learner enters a range of their own on the page the matching found nothing for.
    const [from, to, times] = isNarrow(page) ? ["91", "97", "1:31 – 1:37"] : ["90", "96", "1:30 – 1:36"];
    await goToPage(page, 9);
    await page.getByTestId("transport-more-button").click();
    await page.getByRole("menuitem", { name: "Mark a range for this slide" }).click();
    const mark = page.getByRole("dialog", { name: "Link this slide to the recording" });
    await mark.getByLabel("Start (seconds)").fill(from);
    await mark.getByLabel("End (seconds)").fill(to);
    await mark.getByRole("button", { name: "Save link" }).click();
    await expect(mark).toBeHidden();
    await expect(page.getByTestId("range-times")).toBeVisible({ timeout: 30_000 }); // the Brain has recorded the link
    try {
      await expect(page.getByTestId("range-times")).toHaveText(named(times));
      await expect.poll(async () => textOf(page.getByTestId("range-line"))).toContain("Marked by you");
      // R2-T7 holds for the learner's own range too: the recording is a sound file, so nothing says the page was shown
      // there or that frames were looked at (the contract: "shown" only where video frames were visible and inspected).
      await expect(page.locator("video")).toHaveCount(0);
      const own = await openRangeList(page);
      await expect(own.getByRole("radiogroup", { name: "Where page 9 is discussed" })).toBeVisible();
      await own.getByRole("button", { name: named(`Qualities of the range ${times}`) }).click();
      await expect(own.getByTestId("range-qualities")).toBeVisible();
      await expect.poll(async () => textOf(own), "the learner's range on a sound file").not.toMatch(/\b(shown|displayed)\b|\bframes\b/i);
      await closeRangeList(page);
      await expect.poll(async () => textOf(page.getByTestId("transport"))).not.toMatch(/\b(shown|displayed)\b/i);
      // A rebuild runs twice (a role correction on another page and its take-back); the learner's range is still the learner's.
      await goToPage(page, 14);
      await setRole(page, "Blank");
      await takeBackRole(page);
      await page.reload();
      await goToPage(page, 9);
      const mine = await rangeRows(page);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.times).toBe(times);
      expect(mine[0]!.text).toContain("Marked by you");
      expect(mine[0]!.text).not.toContain("Suggestion");
      await closeRangeList(page);
      // The suggestions are the same suggestions after the rebuild: same rows, same times, still suggestions.
      await goToPage(page, 3);
      const after = await rangeRows(page);
      expect(after.map((row) => `${row.scope} ${row.times}`)).toEqual(before.map((row) => `${row.scope} ${row.times}`));
      for (const row of after) expect(row.text).toMatch(/Suggestion \((wording match|course study map)\)/);
      await closeRangeList(page);
    } finally {
      // The learner rejects their own link again, so the page is as the matching left it.
      await goToPage(page, 9);
      await page.getByTestId("transport-more-button").click();
      await page.getByRole("menuitem", { name: "Correct this range" }).click();
      const edit = page.getByRole("dialog", { name: "Edit match" });
      await edit.getByRole("button", { name: "Reject link" }).click();
      await expect(edit).toBeHidden();
      await expect(page.getByTestId("no-range-line")).toHaveAttribute("data-state", "audio_unprocessed", { timeout: 30_000 });
    }
    await expect(page.getByTestId("range-times")).toHaveCount(0);
  });

  test("R2-T11 (mechanical) selecting a range seeks the real media element to its start without playing; Play stops at its end; Repeat loops it; Whole recording removes the bounds", async ({ page }) => {
    test.setTimeout(120_000);
    await openShowcase(page);
    await goToPage(page, 3);
    await expectAt(page, VISIT_1.start / 1000, 0.5);
    await expectPaused(page);

    // Selecting the third range (the revisit): `seeked` fires and currentTime is within 0.5 s of its start. Nothing plays.
    await page.evaluate(() => {
      const element = document.querySelector<HTMLMediaElement>("audio, video")!;
      const seen: number[] = [];
      (window as unknown as { llSeeked: number[] }).llSeeked = seen;
      element.addEventListener("seeked", () => seen.push(element.currentTime));
    });
    await page.getByRole("button", { name: "Next range" }).click();
    await page.getByRole("button", { name: "Next range" }).click();
    await expect(page.getByTestId("range-times")).toHaveText(named("1:50 – 2:04"));
    await expectAt(page, VISIT_2.start / 1000, 0.5);
    // `currentTime` answers the new position as soon as it is set; the element reports `seeked` a moment later.
    await expect.poll(async () => {
      const seeked = await page.evaluate(() => (window as unknown as { llSeeked: number[] }).llSeeked);
      return seeked.length > 0 ? Math.abs(seeked[seeked.length - 1]! - VISIT_2.start / 1000) : Number.POSITIVE_INFINITY;
    }, "the element fired `seeked` at the start of the range").toBeLessThanOrEqual(0.5);
    await expectPaused(page);
    await expect(page.getByTestId("play-toggle")).toHaveAccessibleName("Play the range 1:50 to 2:04");

    // The stop at its end.
    await cueBeforeEnd(page, VISIT_2);
    await playToTheEndAndStop(page, VISIT_2);

    // Repeat: explicit and visible; at the end the range starts again and goes on playing.
    await page.getByRole("button", { name: "Previous range" }).click();
    await page.getByRole("button", { name: "Next range" }).click();
    await expectAt(page, VISIT_2.start / 1000, 0.5);
    const cued = await cueBeforeEnd(page, VISIT_2);
    const repeat = page.getByTestId("repeat-toggle");
    await repeat.click();
    await expect(repeat).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("play-toggle").click();
    await expect.poll(async () => (await media(page)).t, { message: "it plays towards the end" }).toBeGreaterThan(cued + 0.5);
    await expect.poll(async () => (await media(page)).t, { message: "at the end it starts the range again", timeout: 15_000 }).toBeLessThan(cued - 1);
    const looped = await media(page);
    expect(looped.paused, "it goes on playing").toBe(false);
    expect(looped.t).toBeGreaterThanOrEqual(VISIT_2.start / 1000 - 0.5);
    await page.getByTestId("play-toggle").click();
    await expect.poll(async () => (await media(page)).paused).toBe(true);
    await repeat.click();
    await expect(repeat).toHaveAttribute("aria-pressed", "false");

    // Whole recording: explicit and visible; playback passes the end of the range and goes on.
    await setWholeRecording(page, true);
    const scrubber = page.getByTestId("clip-scrubber");
    await expect(scrubber).toHaveAccessibleName("Position in the whole recording");
    await expectPaused(page);
    await scrubber.focus();
    let position = (await media(page)).t;
    while (position < VISIT_2.end / 1000 - 6) {
      await page.keyboard.press("ArrowRight");
      await expectAt(page, position + 5, 0.3);
      await expect.poll(async () => Math.abs(Number(await scrubber.inputValue()) - (position + 5) * 1000)).toBeLessThanOrEqual(400);
      position += 5;
    }
    expect(position).toBeLessThan(VISIT_2.end / 1000);
    await page.getByTestId("play-toggle").click();
    await expect.poll(async () => (await media(page)).t, { message: "it plays past the end of the range", timeout: 15_000 }).toBeGreaterThan(VISIT_2.end / 1000 + 0.7);
    expect((await media(page)).paused).toBe(false);
    await expect(page.getByTestId("stopped-line")).toHaveCount(0);
    await page.getByTestId("play-toggle").click();
    await expect.poll(async () => (await media(page)).paused).toBe(true);
    expect((await media(page)).count).toBe(1);
  });

  test("R2-T12 coverage lists every lecture of each course as a row with its stage, its recordings and its deck, each with its counts and its cause; the rows equal what the Brain reports at run time and a course with backlog is nowhere worded as done", async ({ page }) => {
    test.setTimeout(120_000);
    interface ReportedDeck {
      source_id: string | null; filename: string | null; state: string; page_count: number | null; map_state: string | null; cause: string | null;
      denominators: { raw: number; instructional: number; uncertain: number; excluded: number } | null; roles_established: { generated: number; agent_reviewed: number; human_confirmed: number } | null;
    }
    interface Reported {
      lectures: Array<{ lecture_id: string; title?: string | null; stage: string; summary?: { pages: number | null; pages_with_range: number | null } | null; deck: ReportedDeck;
        recordings: Array<{ filename?: string | null; source_id: string }> }>;
      summary: { stages?: Record<string, number> };
    }
    // What the page itself was told: the last answer of the Brain to the page's own request, per course.
    const reportedBy = new Map<string, Reported>();
    page.on("response", (response) => {
      const url = new URL(response.url());
      const course = /^\/api\/courses\/([^/]+)\/timing$/.exec(url.pathname)?.[1];
      if (response.request().method() !== "GET" || !course || url.search !== "") return;
      void response.json().then((body) => reportedBy.set(course, body as Reported)).catch(() => undefined);
    });
    const reportOf = async (course: string): Promise<Reported> => {
      await expect.poll(() => reportedBy.has(course), `the page asked for the timing of ${course}`).toBe(true);
      return reportedBy.get(course)!;
    };
    /** What a deck row says of its file and, where no page is counted, why. The words of the screen, written out here. */
    const STATE_WORDS: Record<string, string> = { pdf: "Readable PDF.", unreadable: "Unreadable.", no_deck: "No deck named." };
    const CAUSE_WORDS: Record<string, string> = {
      not_built: "Its pages are not counted yet: the source map of this file has not been built.",
      not_a_pdf: "Pages are counted in a PDF file only.",
      unreadable: "The file is missing, empty or could not be read, so no pages are counted.",
      no_deck: "No slides file is chosen for this lecture, so no pages are counted.",
    };
    /** Every lecture the Brain reports is a row with its stage, its recordings and its deck; the deck's figures are the Brain's. */
    const expectRowsEqual = async (readback: Locator, brain: Reported): Promise<void> => {
      const rows = readback.locator("li[data-stage]");
      await expect(rows).toHaveCount(brain.lectures.length);
      expect(await rows.evaluateAll((items) => items.map((item) => item.getAttribute("data-stage")))).toEqual(brain.lectures.map((lecture) => lecture.stage));
      await expect(readback.getByTestId("deck-row")).toHaveCount(brain.lectures.length);
      for (const [index, lecture] of brain.lectures.entries()) {
        const row = rows.nth(index);
        const all = await textOf(row);
        expect(all).toContain(lecture.title ?? lecture.lecture_id);
        for (const recording of lecture.recordings) expect(all).toContain(recording.filename ?? recording.source_id);
        const deck = row.getByTestId("deck-row");
        await expect(deck).toHaveAttribute("data-deck-state", lecture.deck.state);
        const words = await textOf(deck);
        if (lecture.deck.filename) expect(words).toContain(`Slides: ${lecture.deck.filename}.`);
        expect(words).toContain(lecture.deck.state === "not_a_pdf" ? (/\.pptx?$/i.test(lecture.deck.filename ?? "") ? "PowerPoint only: no pages." : "Not a PDF: no pages.") : STATE_WORDS[lecture.deck.state]!);
        if (lecture.deck.denominators && lecture.deck.roles_established) {
          const figures = await deckFigures(deck);
          const told = lecture.deck.denominators;
          expect([figures.raw, figures.instructional, figures.uncertain, figures.excluded], `${lecture.lecture_id}: the figures the Brain reports`).toEqual([told.raw, told.instructional, told.uncertain, told.excluded]);
          expect(figures.instructional + figures.uncertain + figures.excluded, "the visible counts add up to the file's page count").toBe(lecture.deck.page_count);
          expect(words).toContain(`Roles: ${lecture.deck.roles_established.generated} generated by the detector`);
          expect(lecture.deck.cause).toBeNull();
        } else {
          expect(lecture.deck.cause, `${lecture.lecture_id}: a deck without figures states its cause`).toBeTruthy();
          expect(words).toContain(CAUSE_WORDS[lecture.deck.cause!]!);
          await expect(deck.locator("[data-figure]")).toHaveCount(0);
        }
        const pages = lecture.summary?.pages;
        const withRange = lecture.summary?.pages_with_range;
        if (typeof pages === "number" && typeof withRange === "number") expect(words).toContain(`Ranges on ${withRange} of ${pages} page${pages === 1 ? "" : "s"}.`);
        else expect(words).not.toContain("Ranges on");
      }
    };
    await pair(page);
    await page.goto("/study");
    await page.getByTestId("course-tabs").locator(`[data-course="${COURSE}"]`).click();
    await expect(page.getByTestId("course-counts")).toContainText(/\d+\s+lectures?/);
    const counts = await textOf(page.getByTestId("course-counts"));
    const lecturesOnStudy = Number(/^(\d+) lectures?\b/.exec(counts)?.[1]);
    expect(lecturesOnStudy).toBe(5);
    const readback = await openCoverage(page, COURSE);
    const brain = await reportOf(COURSE);

    // One row per lecture the Brain reports, each with its stage; as many as Study counts.
    const rows = readback.locator("li[data-stage]");
    await expect(rows).toHaveCount(brain.lectures.length);
    expect(brain.lectures.length).toBe(lecturesOnStudy);
    expect(await rows.evaluateAll((items) => items.map((item) => item.getAttribute("data-stage")))).toEqual(brain.lectures.map((lecture) => lecture.stage));
    await expect(readback.getByRole("button", { name: `Each lecture ${brain.lectures.length}` })).toBeVisible();
    // Every recording of the course is in its lecture's row.
    const recordings = brain.lectures.flatMap((lecture) => lecture.recordings.map((recording) => ({ lecture: lecture.title ?? lecture.lecture_id, name: recording.filename ?? recording.source_id })));
    expect(recordings.map((recording) => recording.name).sort()).toEqual(["Fixture Lec 1 Sep 3.wav", "Fixture Lec 2 Sep 8.wav", "Fixture Lec 5 Sep 15.wav"]);
    for (const recording of recordings) await expect.poll(async () => textOf(rows.filter({ hasText: recording.lecture }))).toContain(recording.name);

    // The stage counts add up to the lectures and equal the Brain's.
    const stageWords = (await readback.locator("[data-count]").allInnerTexts()).map(clean);
    expect(stageWords).toEqual(["2 lectures · No recording", "2 lectures · Inventoried, not transcribed yet", "0 lectures · Transcribed in part", "0 lectures · Transcribed, slides not linked yet", "1 lecture · Slide-linked"]);
    expect(stageWords.reduce((sum, words) => sum + Number(/^\d+/.exec(words)![0]), 0)).toBe(brain.lectures.length);
    expect(Object.values(brain.summary.stages ?? {}).reduce((sum, count) => sum + count, 0)).toBe(brain.lectures.length);
    const words = await textOf(readback);
    expect(words).toContain("3 recordings, 4 min 15 s in all.");
    expect(words).toContain("Speech text was generated for 1 of 3 recordings and covers 2 min 22 s of them.");
    expect(words).toContain("Slides are linked for 1 of 3 recordings: 10 ranges.");

    // An unstarted recording shows its cause; a lecture without a recording says so; nothing is worded as done.
    await expect.poll(async () => textOf(rows.filter({ hasText: "Fixture Lecture 02 - Expression control" }))).toMatch(/Inventoried, not transcribed yet .*No speech text has been generated for this recording\. Text alignment not run yet · Slide matching not run yet/);
    await expect.poll(async () => textOf(rows.filter({ hasText: "Fixture Lecture 03 - Cloning workflow" }))).toContain("No recording");
    await expect.poll(async () => textOf(rows.filter({ hasText: TITLE }))).toMatch(/Slide-linked .*Text-aligned · Slide-linked/);
    const block = page.getByRole("region", { name: "Speech timing and transcription" });
    await expect.poll(async () => textOf(block)).not.toMatch(/\b(done|complete|completed|finished|up to date)\b/i);

    // The deck of every lecture is a row of its own beside the recordings: its file, what it is, both page figures with
    // the other roles (or the cause when no page is counted), and on how many pages a range lies. As the Brain reports it.
    await expectRowsEqual(readback, brain);
    const showcase = brain.lectures.find((lecture) => lecture.lecture_id === LECTURE)!;
    expect(showcase.deck.map_state, "the showcase deck has a stored source map").toBe("stored");
    const showcaseDeck = rows.filter({ hasText: TITLE }).getByTestId("deck-row");
    const figures = await deckFigures(showcaseDeck);
    expect([figures.raw, figures.instructional, figures.uncertain, figures.excluded]).toEqual([PAGES, 10, 2, 2]);
    expect(figures.rawLabel).toBe("14 PDF pages");
    expect(figures.instructionalLabel).toBe("10 count as teaching content");
    expect(figures.words).toContain("Slides: Fixture Lecture 05 - R2 showcase.pdf. Readable PDF.");
    expect(figures.words).toContain("Ranges on 8 of 14 pages.");

    // Every bound fixture course has its own readback, with every lecture, recording and deck the Brain reports for it.
    const decks: Array<{ course: string; file: string | null; state: string; cause: string | null }> = brain.lectures.map((lecture) => ({ course: COURSE, file: lecture.deck.filename, state: lecture.deck.state, cause: lecture.deck.cause }));
    for (const course of ["be562", "be572", "cs542", "ds551"]) {
      const name = new RegExp(`^FIXTURE ${course.slice(0, 2).toUpperCase()} ${course.slice(2)} `);
      await block.getByRole("button", { name }).click();
      const other = page.locator(`[data-testid="timing-readback"][data-course="${course}"]`);
      await expect(other.locator("[data-count]").first()).toBeVisible();
      await showLectures(other);
      const told = await reportOf(course);
      expect(told.lectures.length, `${course} has lectures`).toBeGreaterThan(0);
      await expectRowsEqual(other, told);
      await expect.poll(async () => textOf(other)).not.toMatch(/\b(done|complete|completed|finished)\b/i);
      decks.push(...told.lectures.map((lecture) => ({ course, file: lecture.deck.filename, state: lecture.deck.state, cause: lecture.deck.cause })));
    }
    // The sample courses hold one deck per lecture: readable PDFs, an empty file and two presentations without a PDF.
    expect(decks).toHaveLength(12);
    expect(decks.filter((deck) => deck.state === "pdf").length).toBe(9);
    expect(decks.filter((deck) => deck.state !== "pdf").map((deck) => `${deck.course}: ${deck.file}: ${deck.state}, ${deck.cause}`)).toEqual([
      "be572: Fixture 572 Empty.pdf: unreadable, unreadable", "be572: Fixture 572 Lecture 02.pptx: not_a_pdf, not_a_pdf", "cs542: Fixture 542 Lecture 01.pptx: not_a_pdf, not_a_pdf",
    ]);
    const empty = page.locator('[data-testid="timing-readback"][data-course="be572"]').locator("li[data-stage]").filter({ hasText: "Fixture 572 Empty" }).getByTestId("deck-row");
    await expect.poll(async () => textOf(empty)).toBe("Slides: Fixture 572 Empty.pdf. Unreadable. The file is missing, empty or could not be read, so no pages are counted.");
    const presentation = page.locator('[data-testid="timing-readback"][data-course="cs542"]').getByTestId("deck-row");
    await expect.poll(async () => textOf(presentation)).toBe("Slides: Fixture 542 Lecture 01.pptx. PowerPoint only: no pages. Pages are counted in a PDF file only.");
  });

  test("R2-T13 (the fixture's rendition of the private run) the lecture is studied from its first to its last content slide by Next content; ranges exist beyond the opening and selecting three of them moves the player", async ({ page }) => {
    // Not in this suite: the private run on the real profile, and any acoustic review.
    await openShowcase(page);
    const visited: number[] = [];
    const withRange: Array<{ page: number; start: number }> = [];
    for (let guard = 0; guard < PAGES; guard++) {
      const next = page.getByTestId("next-content");
      if ((await next.getAttribute("aria-disabled")) === "true") break;
      await next.click();
      await expect.poll(() => identityLine(page)).not.toBe(IDENTITY[visited[visited.length - 1] ?? 1]);
      const physical = Number(/^PDF page (\d+) of/.exec(await identityLine(page))![1]);
      await expectIdentity(page, physical);
      visited.push(physical);
      await expectPaused(page);
      if ((await page.getByTestId("range-times").count()) > 0) {
        const times = /(\d+):(\d\d)/.exec(await textOf(page.getByTestId("range-times")))!;
        withRange.push({ page: physical, start: Number(times[1]) * 60 + Number(times[2]) });
      }
    }
    expect(visited).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14]); // every page but the title page it started on and the administrative page
    expect(withRange.map((entry) => entry.page)).toEqual([3, 4, 5, 6, 7, 8, 10, 12]);
    // Beyond the opening: ranges begin in the second minute and in the third, not only at the start.
    expect(withRange.filter((entry) => entry.start >= 60).map((entry) => entry.page)).toEqual([10, 12]);
    expect(Math.max(...withRange.map((entry) => entry.start))).toBeGreaterThan(RECORDING_S * 0.8);

    // Selecting three of them moves the one player to their starts.
    for (const [physical, range] of [[12, WORKED_EXAMPLE], [10, CALIBRATION], [3, VISIT_1]] as const) {
      await goToPage(page, physical);
      await expectAt(page, range.start / 1000, 0.5);
      await expectPaused(page);
    }
    await page.getByRole("button", { name: "Next range" }).click();
    await page.getByRole("button", { name: "Next range" }).click();
    await expectAt(page, VISIT_2.start / 1000, 0.5);
    await expectPaused(page);
  });

  // ==== the journey ===========================================================================================================

  test("R2-E3 journey: Study, the showcase lecture, a slide in three builds, its range plays and stops, a question tied to it, the supporting build, a connected concept and its evidence, and back to the slide with page, tab, draft and player position kept", async ({ page }) => {
    test.setTimeout(150_000);
    await openShowcase(page);
    // From the title page to the first slide with substance, then into the slide that is built up in three pages.
    await page.getByTestId("next-content").click();
    await expectIdentity(page, 2);
    await page.getByTestId("next-content").click();
    await expectIdentity(page, 3);
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expectIdentity(page, 4);

    // Its range: nothing plays on arrival; a real stretch is played and playback stops at the end of the range.
    await expect(page.getByTestId("range-times")).toHaveText(named("0:28 – 0:59"));
    await expectAt(page, BUILD_GROUP.start / 1000, 0.5);
    await expectPaused(page);
    await cueBeforeEnd(page, BUILD_GROUP);
    await playToTheEndAndStop(page, BUILD_GROUP);

    // A question tied to the slide, and from it the build that supports it.
    await openTab(page, "Questions");
    const question = page.getByTestId("this-slide-list").locator('[data-testid="question-row"][data-question-id="BE505-L05-Q01"]');
    await expect.poll(async () => textOf(question)).toContain("Exact. A reviewed anchor of the course record names this page. Group-level: all 3 builds.");
    await question.getByRole("link", { name: named("p. 6 build 3 of 3") }).click();
    await expectIdentity(page, 6);

    // A player position of the learner's own on that build …
    await showSlide(page);
    const scrubber = page.getByTestId("clip-scrubber");
    await scrubber.focus();
    await page.keyboard.press("Home");
    await expectAt(page, BUILD_GROUP.start / 1000, 0.3);
    await expect.poll(async () => Math.abs(Number(await scrubber.inputValue()) - BUILD_GROUP.start)).toBeLessThanOrEqual(300);
    await page.keyboard.press("ArrowRight");
    await expectAt(page, BUILD_GROUP.start / 1000 + 5, 0.3);
    await expect.poll(async () => Math.abs(Number(await scrubber.inputValue()) - BUILD_GROUP.start - 5_000)).toBeLessThanOrEqual(300);
    await page.keyboard.press("ArrowRight");
    const left = BUILD_GROUP.start / 1000 + 10;
    await expectAt(page, left, 0.3);
    await expectPaused(page);
    // … and a draft, typed as the last thing before going on. The learner goes on at once: nothing is waited for
    // between the last keystroke and leaving the lecture, so the draft may not depend on a pause after typing.
    const draft = "My own words on why the terminator comes last";
    await openTab(page, "Tutor");
    await page.locator("#tutor-composer").fill(draft);

    // A concept connected to the slide, in the Concepts tab; its node in the concept map; the node's evidence.
    await openTab(page, "Concepts");
    await page.getByTestId("concepts-tab").getByRole("link", { name: /^Concept: Reporter gene/ }).click();
    await expect(page.getByTestId("concept-explorer")).toBeVisible();
    await expect(page).toHaveURL(/\/courses\/be505\/concepts\?scope=slide%3Alecture-05%3A6&node=be505\.concept\.reporter-gene/);
    const evidenceTab = page.getByRole("tab", { name: /^Evidence/ });
    await evidenceTab.click();
    await expect(evidenceTab).toHaveAttribute("aria-selected", "true");
    const evidence = page.getByRole("tabpanel", { name: /^Evidence/ });
    await expect(evidence.getByRole("heading", { name: "Reporter gene" })).toBeVisible();
    await expect.poll(async () => textOf(evidence)).toContain("Each line describes one recorded attempt and how it was made. Nothing is averaged into a score.");

    // Back to the slide: the same page, the same tab, the draft and the player position.
    await page.getByRole("link", { name: "Back to page 6" }).click();
    await expect(page.getByTestId("lecture-workspace")).toBeVisible();
    await expect(page.getByRole("tab", { name: /^Concepts$/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("concepts-tab")).toBeVisible();
    await expectAt(page, left, 0.3);
    await expectPaused(page);
    await expectIdentity(page, 6);
    await expect(page.getByTestId("range-times")).toHaveText(named("0:28 – 0:59"));
    await expect.poll(async () => textOf(page.getByTestId("time-readout"))).toBe("0:38 / 0:59");
    await openTab(page, "Tutor");
    await expect(page.locator("#tutor-composer")).toHaveValue(draft);
    await expect(page.getByTestId("context-chip")).toHaveText(named("About page 6, build 3 of 3")); // the draft is still about the build it was written on
  });
});
