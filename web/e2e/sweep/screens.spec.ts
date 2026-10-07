// Every screen at every required viewport in Light and Dark (UXG01, UXG03, UXG04, UXG06–UXG08):
// it renders its real content, nothing scrolls sideways, the automated accessibility rules pass
// (names, roles, contrast, target size), and original course material keeps its own colours.
// A screenshot of each is attached to the report for human review.
//
// Amendment R2 rebuilt the shell and the lecture workspace, and added the concept explorer and the showcase lecture
// (fixture lecture-05: build sequence, structural pages, several ranges, pages without a range). They are swept here
// with the same gates as every older screen.
import type { Locator, Page, TestInfo } from "@playwright/test";
import { COURSE, expectAccessible, expectNoHorizontalOverflow, pair, shot } from "../helpers";
import { expect, test } from "../fixtures";

const SHOWCASE = `/courses/${COURSE}/lectures/lecture-05`;
/** From this width the workspace is outline · stage · context panel side by side; below it ONE pane at a time (R2-V3, R2-V4). */
const FRAME_MIN_WIDTH = 1180;
const isFramed = (page: Page): boolean => (page.viewportSize()?.width ?? 0) >= FRAME_MIN_WIDTH;
/** The five destinations of the lecture context panel, in their fixed order (R2-V3). */
const CONTEXT_TABS = ["Tutor", "Questions", "Concepts", "Transcript", "Sources"] as const;
/** A tab or pane by its label; a tab that carries a count is named "Questions 2". */
const tab = (page: Page, label: string): Locator => page.getByRole("tab", { name: new RegExp(`^${label}( \\d+)?$`) });

/**
 * Nothing scrolls or is cut sideways. The rebuilt shell does not scroll the document: `main` scrolls on ordinary pages
 * and the zones of a workspace scroll inside themselves, so the document-level measure alone would no longer see a
 * sideways overflow. This also measures `main`, every visible scrolling container and every visible control.
 * Three things scroll inside themselves on purpose and are the only exceptions: a strip of tabs, a labelled keyboard-
 * focusable region that holds a table, and the canvas of the concept map (R2-C: what does not fit is reached by panning).
 */
async function expectNothingSideways(page: Page): Promise<void> {
  await expectNoHorizontalOverflow(page);
  const offenders = await page.evaluate(() => {
    const describe = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""}.${String(el.getAttribute("class") ?? "").split(/\s+/).slice(0, 3).join(".")}`;
    const shown = (el: Element) => {
      const box = el.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1) return false;
      const style = getComputedStyle(el);
      return style.visibility !== "hidden" && style.display !== "none" && !el.closest("[inert], [hidden]");
    };
    const scrolls = (value: string) => value === "auto" || value === "scroll";
    const byDesign = (el: Element) => el.matches('[role="tablist"]')
      || (el.matches('[role="region"][tabindex="0"]') && (el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby")) && el.querySelector("table") !== null)
      || el.closest('[data-testid="concept-map"]') !== null;
    const found: string[] = [];
    const main = document.querySelector("main");
    if (main && main.scrollWidth - main.clientWidth > 1) found.push(`main is ${main.scrollWidth - main.clientWidth}px wider inside than outside`);
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const style = getComputedStyle(el);
      if (!scrolls(style.overflowX) && !scrolls(style.overflowY)) continue;
      if (!shown(el) || byDesign(el)) continue;
      const over = el.scrollWidth - el.clientWidth;
      if (over > 1) found.push(`${describe(el)} scrolls ${over}px sideways`);
    }
    const limit = document.documentElement.clientWidth;
    for (const el of Array.from(document.querySelectorAll('button, a[href], input, select, textarea, [role="tab"], [role="radio"]'))) {
      if (!shown(el)) continue;
      const box = el.getBoundingClientRect();
      if (box.right <= limit + 1 && box.left >= -1) continue;
      let inside = false;
      for (let up = el.parentElement; up && !inside; up = up.parentElement) inside = byDesign(up);
      if (!inside) found.push(`${describe(el)} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}" is at ${Math.round(box.left)}..${Math.round(box.right)} of ${limit}px`);
    }
    return found.slice(0, 8);
  });
  expect(offenders, "something scrolls or is cut sideways").toEqual([]);
}

/** One screen state: nothing sideways, the automated accessibility rules pass. */
async function expectSound(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  await expectNothingSideways(page);
  await expectAccessible(page, testInfo, label);
}

/** The pager's identity line; its parts are held together by no-break spaces. */
const identityLine = async (page: Page): Promise<string> => ((await page.getByTestId("slide-position").textContent()) ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

/** A colour of the rendered source page at a fraction of its width and height. */
const sample = (canvas: Locator, fx: number, fy: number): Promise<number[]> =>
  canvas.evaluate((c: HTMLCanvasElement, [x, y]) => Array.from(c.getContext("2d")!.getImageData(Math.round(c.width * x!), Math.round(c.height * y!), 1, 1).data.slice(0, 3)), [fx, fy]);
const near = (actual: number[], expected: number[]): boolean => actual.every((v, i) => Math.abs(v - expected[i]!) <= 3);

/** No CSS filter, blend or opacity is applied to the source surface or anything around it. */
async function expectSourceUntouched(page: Page): Promise<void> {
  const effects = await page.getByTestId("slide-surface").evaluate((node) => {
    const found: string[] = [];
    for (let el: Element | null = node; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.filter !== "none" || style.mixBlendMode !== "normal" || Number(style.opacity) !== 1) found.push(`${el.tagName}: ${style.filter} ${style.mixBlendMode} ${style.opacity}`);
    }
    return found;
  });
  expect(effects).toEqual([]);
}

/**
 * The size of what a press on a control lands on, found by hit-testing outward from its centre. On a touch screen a
 * control may be drawn smaller than the area that answers the press, so its drawn box is not the measure.
 */
async function pressTarget(control: Locator): Promise<{ width: number; height: number }> {
  return control.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const hit = (x: number, y: number) => {
      const at = document.elementFromPoint(x, y);
      return at !== null && (at === el || el.contains(at));
    };
    const reach = (dx: number, dy: number) => {
      let n = 0;
      while (n < 64 && hit(cx + dx * (n + 1), cy + dy * (n + 1))) n += 1;
      return n;
    };
    return { width: reach(-1, 0) + reach(1, 0) + 1, height: reach(0, -1) + reach(0, 1) + 1 };
  });
}

interface Screen { id: string; name: string; path: string; ready: RegExp | string; content?: (page: Page) => Promise<void> }
const SCREENS: Screen[] = [
  { id: "SC01", name: "connect", path: "/connect", ready: "Connect your course workspace" },
  // The real content of Study, not the grey places of its first frame: the five courses and the lectures of the chosen one.
  { id: "SC02", name: "study-home", path: "/study", ready: "Study", content: async (page) => {
    await expect(page.getByRole("tablist", { name: "Courses" }).getByRole("tab")).toHaveCount(5);
    await expect(page.getByTestId("course-pane").getByTestId("lecture-row").first()).toBeVisible();
  } },
  // The course address is the Study page with that course chosen (design specification section 6): the course is named in its pane.
  { id: "SC03", name: "course-lectures", path: `/courses/${COURSE}`, ready: "Study", content: async (page) => {
    const pane = page.getByTestId("course-pane");
    await expect(pane).toHaveAttribute("data-course", COURSE);
    await expect(pane.getByTestId("course-name")).toHaveText(/FIXTURE BE 505/);
    await expect(pane.getByTestId("lecture-row")).toHaveCount(5); // four older units and the showcase unit lecture-05
  } },
  { id: "SC05", name: "source-detail", path: `/courses/${COURSE}/sources/src-ps-01-brief`, ready: /Fixture PS01\.pdf/ },
  { id: "SC06", name: "question", path: `/courses/${COURSE}/questions/BE505-L01-Q03`, ready: "Replication is not transcription" },
  { id: "SC07", name: "review", path: "/review", ready: "Review" },
  { id: "SC09", name: "progress", path: "/progress", ready: "Progress" },
  { id: "SC10", name: "concept", path: `/courses/${COURSE}/concepts/be505.concept.promoter`, ready: "Promoter" },
  { id: "SC11", name: "history", path: "/history", ready: "Study history" },
  { id: "SC12", name: "activity", path: "/activity", ready: "Activity" },
  { id: "SC13a", name: "settings-appearance", path: "/settings/appearance", ready: "Settings" },
  { id: "SC13b", name: "settings-access", path: "/settings/access", ready: "Settings" },
  { id: "SC13c", name: "settings-ai", path: "/settings/ai", ready: "Settings" },
  { id: "SC13d", name: "settings-limits", path: "/settings/limits", ready: "Settings" },
  { id: "SC13e", name: "settings-data", path: "/settings/data", ready: "Settings" },
  { id: "SC13f", name: "settings-maintenance", path: "/settings/maintenance", ready: "Settings" },
  // R2-B1: the build and data identity as text the learner can read and copy.
  { id: "SC13g", name: "settings-build", path: "/settings/build", ready: "Settings", content: async (page) => {
    await expect(page.getByTestId("build-identity")).toBeVisible();
    await expect(page.getByTestId("timing-readback").first()).toBeVisible();
    await expect(page.getByTestId("suggestions-readback").first()).toBeVisible();
  } },
  { id: "SC16", name: "session-summary", path: `/study/sessions/session-none/summary?course=${COURSE}&lecture=lecture-02&page=2`, ready: "Session summary" },
  { id: "sources", name: "sources", path: "/sources", ready: "Library" }, // the rail names this page "Library"; the address is unchanged
  { id: "R1-bank", name: "question-bank", path: `/courses/${COURSE}/questions`, ready: "Question bank" },
  // R2-C1 supersedes R1's outline page as a place of its own: its address now opens the concept map of the course,
  // which holds the outline (the map itself is swept in every scope further down).
  { id: "R1-outline", name: "concept-outline", path: `/courses/${COURSE}/outline`, ready: "Concept map", content: async (page) => {
    await expect(page).toHaveURL(new RegExp(`/courses/${COURSE}/concepts$`));
    await expect(page.getByTestId("concept-explorer")).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Scope of the concept map" }).getByRole("radio", { name: "Course" })).toBeChecked();
  } },
];

test.describe("every screen", () => {
  test.beforeEach(async ({ page }) => {
    await pair(page);
  });

  for (const screen of SCREENS) {
    test(`${screen.id} ${screen.name} renders, reflows and passes automated accessibility`, async ({ page }, testInfo) => {
      await page.goto(screen.path);
      await expect(page.getByRole("heading", { level: 1, name: screen.ready })).toBeVisible();
      await expect(page.getByText("Loading…")).toHaveCount(0);
      // A page that draws grey places while it reads does not write "Loading…": it marks what is being read with
      // aria-busy (Study: the title is there in the first frame, the courses and lectures are not). The gates below
      // are for the screen with its real content, as for every other screen, so they wait until nothing in the page
      // is still being read. Seen in the whole suite on one Brain: after the flow projects the workspace answers a
      // little later, and the rules were run on Study's first frame (11 of 20 runs at 360 and 390 px).
      await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
      if (screen.content) await screen.content(page);
      // System preference decides the theme unless the learner chose one.
      await expect(page.locator("html")).toHaveAttribute("data-theme", String(testInfo.project.use.colorScheme));
      await expectNothingSideways(page);
      await expectAccessible(page, testInfo, screen.name);
      await shot(page, testInfo, `${screen.name}-${testInfo.project.name}`);
    });
  }

  test("SC04 lecture workspace: slide, recording, transcript and sources at this size; original colours unchanged in this theme", async ({ page, browser }, testInfo) => {
    const lecture = `/courses/${COURSE}/lectures/lecture-02?page=2`;
    await page.goto(lecture);
    const canvas = page.getByTestId("slide-canvas");
    await expect(canvas).toHaveAttribute("data-rendered", "2");
    await expectSound(page, testInfo, "lecture");
    await shot(page, testInfo, `lecture-${testInfo.project.name}`);

    // The synthetic slide has known saturated colours at known places; the app must not tint, invert or dim them.
    expect(near(await sample(canvas, 0.7087, 0.4462), [15, 110, 91]), `teal block: ${await sample(canvas, 0.7087, 0.4462)}`).toBe(true);
    expect(near(await sample(canvas, 0.7087, 0.5722), [192, 57, 43]), `red block: ${await sample(canvas, 0.7087, 0.5722)}`).toBe(true);
    expect(near(await sample(canvas, 0.04, 0.5), [255, 255, 255]), `slide background: ${await sample(canvas, 0.04, 0.5)}`).toBe(true);
    await expectSourceUntouched(page);

    // R2-V3 replaces R1's four tabs (Tutor, Transcript, This slide, Questions) by five destinations in a fixed order.
    // From 1180 px they are the tabs of the context panel; below it they are panes of the workspace beside Slide and Outline.
    const framed = isFramed(page);
    const strip = page.getByRole("tablist", { name: framed ? "Context panel" : "Workspace pane" });
    await expect(strip.getByRole("tab")).toHaveText(framed ? [/^Tutor$/, /^Questions/, /^Concepts$/, /^Transcript$/, /^Sources$/] : [/^Slide$/, /^Outline$/, /^Tutor$/, /^Questions/, /^Concepts$/, /^Transcript$/, /^Sources$/]);
    for (const pane of [...CONTEXT_TABS, ...(framed ? [] : ["Outline"])]) {
      await tab(page, pane).click();
      await expect(tab(page, pane)).toHaveAttribute("aria-selected", "true");
      await expectSound(page, testInfo, `lecture-${pane.toLowerCase()}`);
      if (pane === "Tutor") await shot(page, testInfo, `lecture-tutor-${testInfo.project.name}`);
    }
    if (!framed) {
      await tab(page, "Slide").click();
      await expect(canvas).toBeVisible();
    }

    // Primary controls keep a comfortable touch size: 44 px. The rebuilt controls are drawn smaller for a mouse
    // (design specification 9: icon buttons 36 px, the play disc 40 px) and answer a larger press on a touch screen,
    // so the gate is the area that takes the press, measured on a touch screen of this size and theme.
    let touch = page;
    if (!testInfo.project.use.hasTouch) {
      const context = await browser.newContext({ viewport: page.viewportSize()!, colorScheme: testInfo.project.use.colorScheme, hasTouch: true });
      touch = await context.newPage();
      await pair(touch);
      await touch.goto(lecture);
      await expect(touch.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", "2");
    }
    expect(await touch.evaluate(() => matchMedia("(pointer: coarse)").matches), "the measured page is a touch screen").toBe(true);
    for (const name of ["Next page", "Previous page"]) {
      const target = await pressTarget(touch.getByRole("button", { name, exact: true }));
      expect(target.height, `${name}: height of the press target`).toBeGreaterThanOrEqual(44);
    }
    const play = await pressTarget(touch.getByTestId("play-toggle"));
    expect(Math.min(play.width, play.height), "play: the press target").toBeGreaterThanOrEqual(44);
    if (touch !== page) await touch.context().close();
  });

  test("R2 showcase lecture: a build page with several ranges, a structural page and a page without a range, every tab at this size", async ({ page }, testInfo) => {
    const framed = isFramed(page);
    await page.goto(`${SHOWCASE}?page=5`);
    const canvas = page.getByTestId("slide-canvas");
    await expect(canvas).toHaveAttribute("data-rendered", "5");
    expect(await identityLine(page)).toBe("PDF page 5 of 14 · build 2 of 3"); // R2-S2, R2-S3: the physical page and its place in the build
    await expectSound(page, testInfo, "showcase");
    await shot(page, testInfo, `showcase-${testInfo.project.name}`);
    // The source page keeps its own colours here too.
    expect(near(await sample(canvas, 0.04, 0.5), [255, 255, 255]), `slide background: ${await sample(canvas, 0.04, 0.5)}`).toBe(true);
    await expectSourceUntouched(page);

    // The ranges of the page open as a list over the stage (R2 "Recording ranges at the transport"); nothing is pushed sideways by it.
    await page.getByTestId("range-list-toggle").click();
    await expect(page.getByTestId("range-list").getByTestId("range-row")).toHaveCount(2);
    await expectSound(page, testInfo, "showcase-ranges");
    await shot(page, testInfo, `showcase-ranges-${testInfo.project.name}`);
    await page.getByTestId("range-list-toggle").click();
    await expect(page.getByTestId("range-list")).toHaveCount(0);

    // Every destination of the context panel on the build page (R2-V3), each with its own content.
    const content: Record<(typeof CONTEXT_TABS)[number], Locator> = {
      Tutor: page.locator("#tutor-composer"),
      Questions: page.getByTestId("this-slide-list").getByTestId("question-row").first(),
      Concepts: page.getByTestId("concepts-tab").getByRole("tree").first(),
      Transcript: page.getByTestId("transcript-lines"),
      Sources: page.getByTestId("sources-tab"),
    };
    for (const pane of CONTEXT_TABS) {
      await tab(page, pane).click();
      await expect(content[pane]).toBeVisible();
      // Below 1180 px the one transport stays reachable from every pane (R2-V4).
      if (!framed) await expect(page.getByTestId("dock")).toBeVisible();
      await expectSound(page, testInfo, `showcase-${pane.toLowerCase()}`);
      await shot(page, testInfo, `showcase-${pane.toLowerCase()}-${testInfo.project.name}`);
    }
    if (!framed) {
      await tab(page, "Outline").click();
      await expect(page.getByTestId("lecture-outline")).toBeVisible();
      await expectSound(page, testInfo, "showcase-outline");
    }

    // A structural page: no forced list for the slide, the lecture's questions stay (R2-S8), one stated no-range line.
    // (Below 1180 px the address opens the Questions pane alone; the page itself is drawn once the Slide pane is shown.)
    await page.goto(`${SHOWCASE}?page=1&panel=questions`);
    await expect(page.getByTestId("structural-note")).toBeVisible();
    await expectSound(page, testInfo, "showcase-structural-questions");
    if (!framed) await tab(page, "Slide").click();
    await expect(canvas).toHaveAttribute("data-rendered", "1");
    expect(await identityLine(page)).toBe("PDF page 1 of 14");
    await expect(page.getByTestId("no-range-line")).toContainText("Structural page");
    await expectSound(page, testInfo, "showcase-structural");
    await shot(page, testInfo, `showcase-structural-${testInfo.project.name}`);

    // A page whose part of the recording has no timing yet: the line says so and the layout holds.
    await page.goto(`${SHOWCASE}?page=9`);
    await expect(canvas).toHaveAttribute("data-rendered", "9");
    await expect(page.getByTestId("no-range-line")).toBeVisible();
    await expectSound(page, testInfo, "showcase-no-range");
    await shot(page, testInfo, `showcase-no-range-${testInfo.project.name}`);
  });

  test("R2 concept map: course, lecture and slide scope, outline and map, and the selected item with its sources, questions and evidence at this size", async ({ page }, testInfo) => {
    const framed = isFramed(page);
    const scope = page.getByRole("radiogroup", { name: "Scope of the concept map" });
    const explorer = page.getByTestId("concept-explorer");
    /** From 1180 px the outline is a zone that opens beside the map (it stays mounted while closed); below it Outline and Map are two panes. */
    const showOutline = async () => {
      if (!framed) await tab(page, "Outline").click();
      else {
        const toggle = page.getByTestId("outline-toggle");
        await expect(toggle).toBeVisible();
        if ((await toggle.getAttribute("aria-pressed")) !== "true") await page.getByRole("button", { name: "Show the outline" }).click();
        await expect(page.getByRole("button", { name: "Hide the outline" })).toHaveAttribute("aria-pressed", "true");
      }
      await expect(page.getByTestId("outline-tree")).toBeVisible();
    };
    const showMap = async () => {
      if (!framed) await tab(page, "Map").click();
      await expect(page.getByTestId("concept-map")).toBeVisible();
      await expect(page.getByTestId("map-pending")).toHaveCount(0);
    };

    // Course scope (R2-C2, R2-C3): the map opens grouped at topic level and nothing is selected.
    await page.goto(`/courses/${COURSE}/concepts`);
    await expect(explorer).toBeVisible();
    await expect(scope.getByRole("radio", { name: "Course" })).toBeChecked();
    await showMap();
    await expect(page.getByTestId("concept-map")).toHaveAttribute("data-view", "topics");
    await expectSound(page, testInfo, "concept-map-course");
    await shot(page, testInfo, `concept-map-course-${testInfo.project.name}`);
    await showOutline();
    await expect(page.getByTestId("outline-scope-count")).toContainText(/^Course: \d+\sconcepts, \d+\sskills, \d+\squestions/); // a number and its unit are held together by a no-break space
    await expectSound(page, testInfo, "concept-outline-course");
    await shot(page, testInfo, `concept-outline-course-${testInfo.project.name}`);

    // Lecture scope: the showcase lecture, its first topic selected.
    await page.goto(`/courses/${COURSE}/concepts?scope=lecture:lecture-05`);
    await expect(scope.getByRole("radio", { name: "Lecture" })).toBeChecked();
    await showMap();
    await expectSound(page, testInfo, "concept-map-lecture");
    await showOutline();
    await expectSound(page, testInfo, "concept-outline-lecture");

    // This slide: build 2 of 3 of the showcase lecture, with the three views of the selected item (R2-C7).
    await page.goto(`/courses/${COURSE}/concepts?scope=slide:lecture-05:5`);
    await expect(scope.getByRole("radio", { name: "This slide" })).toBeChecked();
    await showMap();
    // R2-S2, R2-S3: the page is named by its identity line: on the page's own marker in the map at every size, and in
    // the band of the map from 1180 px (below it the band is replaced by the scope bar above the pane switch).
    await expect(page.getByTestId("concept-map").locator('[data-type="marker"]')).toContainText("PDF page 5 of 14 · build 2 of 3");
    if (framed) await expect(page.getByTestId("concept-scope-identity")).toContainText("PDF page 5 of 14 · build 2 of 3");
    await expectSound(page, testInfo, "concept-map-slide");
    await shot(page, testInfo, `concept-map-slide-${testInfo.project.name}`);
    for (const view of ["Sources", "Questions", "Evidence"]) {
      await tab(page, view).click();
      await expect(tab(page, view)).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("detail-pending")).toHaveCount(0);
      await expect(page.getByTestId("outline-detail").getByRole("heading", { name: "Reporter assays" })).toBeVisible();
      await expectSound(page, testInfo, `concept-${view.toLowerCase()}`);
      await shot(page, testInfo, `concept-${view.toLowerCase()}-${testInfo.project.name}`);
    }
    await showOutline();
    await expect(page.getByTestId("outline-scope-count")).toContainText("On this slide: 2 concepts, 2 skills, 2 questions");
    await expectSound(page, testInfo, "concept-outline-slide");
  });

  test("SC08 review session and SC17 search overlay at this size", async ({ page }, testInfo) => {
    await page.goto("/study");
    // From 900 px Search is a button of the header; under it the header has one Menu that holds it (design specification 4.2).
    if ((page.viewportSize()?.width ?? 0) >= 900) await page.getByRole("button", { name: /^Search / }).click();
    else {
      await page.getByRole("button", { name: /^Menu: / }).click();
      await page.getByRole("menuitem", { name: /^Search / }).click();
    }
    const dialog = page.getByRole("dialog", { name: "Search" });
    await dialog.getByLabel("Search query").fill("promoter");
    await expect(dialog.getByRole("list", { name: "Search results" })).toBeVisible();
    await expectNothingSideways(page);
    await expectAccessible(page, testInfo, "search");
    await shot(page, testInfo, `search-${testInfo.project.name}`);
    await page.keyboard.press("Escape");

    await page.goto("/review/sessions/rs-not-a-session");
    await expect(page.getByText("This review session is no longer available")).toBeVisible();
    await expect(page.getByText("Nothing was recorded for unanswered items.")).toBeVisible();
    await expectAccessible(page, testInfo, "review-session-missing");
  });
});
