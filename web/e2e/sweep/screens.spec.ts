// Every screen at every required viewport in Light and Dark (UXG01, UXG03, UXG04, UXG06–UXG08):
// it renders its real content, nothing scrolls sideways, the automated accessibility rules pass
// (names, roles, contrast, target size), and original course material keeps its own colours.
// A screenshot of each is attached to the report for human review.
import { COURSE, expectAccessible, expectNoHorizontalOverflow, pair, shot } from "../helpers";
import { expect, test } from "../fixtures";

const SCREENS: Array<{ id: string; name: string; path: string; ready: RegExp | string; level?: number }> = [
  { id: "SC01", name: "connect", path: "/connect", ready: "Connect your course workspace" },
  { id: "SC02", name: "study-home", path: "/study", ready: "Study" },
  { id: "SC03", name: "course-lectures", path: `/courses/${COURSE}`, ready: /FIXTURE BE 505/ },
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
  { id: "SC16", name: "session-summary", path: `/study/sessions/session-none/summary?course=${COURSE}&lecture=lecture-02&page=2`, ready: "Session summary" },
  { id: "sources", name: "sources", path: "/sources", ready: "Sources" },
  { id: "R1-bank", name: "question-bank", path: `/courses/${COURSE}/questions`, ready: "Question bank" },
  { id: "R1-outline", name: "concept-outline", path: `/courses/${COURSE}/outline`, ready: "Concept outline" },
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
      // System preference decides the theme unless the learner chose one.
      await expect(page.locator("html")).toHaveAttribute("data-theme", String(testInfo.project.use.colorScheme));
      await expectNoHorizontalOverflow(page);
      await expectAccessible(page, testInfo, screen.name);
      await shot(page, testInfo, `${screen.name}-${testInfo.project.name}`);
    });
  }

  test("SC04 lecture workspace: slide, recording, transcript and sources at this size; original colours unchanged in this theme", async ({ page }, testInfo) => {
    await page.goto(`/courses/${COURSE}/lectures/lecture-02?page=2`);
    const canvas = page.getByTestId("slide-canvas");
    await expect(canvas).toHaveAttribute("data-rendered", "2");
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page, testInfo, "lecture");
    await shot(page, testInfo, `lecture-${testInfo.project.name}`);

    // The synthetic slide has known saturated colours at known places; the app must not tint, invert or dim them.
    const sample = (fx: number, fy: number) => canvas.evaluate((c: HTMLCanvasElement, [x, y]) => Array.from(c.getContext("2d")!.getImageData(Math.round(c.width * x!), Math.round(c.height * y!), 1, 1).data.slice(0, 3)), [fx, fy]);
    const near = (actual: number[], expected: number[]) => actual.every((v, i) => Math.abs(v - expected[i]!) <= 3);
    expect(near(await sample(0.7087, 0.4462), [15, 110, 91]), `teal block: ${await sample(0.7087, 0.4462)}`).toBe(true);
    expect(near(await sample(0.7087, 0.5722), [192, 57, 43]), `red block: ${await sample(0.7087, 0.5722)}`).toBe(true);
    expect(near(await sample(0.04, 0.5), [255, 255, 255]), `slide background: ${await sample(0.04, 0.5)}`).toBe(true);
    // No CSS filter, blend or opacity is applied to the source surface or its ancestors.
    const effects = await page.getByTestId("slide-surface").evaluate((node) => {
      const found: string[] = [];
      for (let el: Element | null = node; el; el = el.parentElement) {
        const style = getComputedStyle(el);
        if (style.filter !== "none" || style.mixBlendMode !== "normal" || Number(style.opacity) !== 1) found.push(`${el.tagName}: ${style.filter} ${style.mixBlendMode} ${style.opacity}`);
      }
      return found;
    });
    expect(effects).toEqual([]);

    const narrow = (page.viewportSize()?.width ?? 0) < 1024;
    for (const pane of ["Transcript", "This slide", "Questions", "Tutor"] as const) {
      await page.getByRole("tab", { name: pane, exact: true }).click();
      await expectNoHorizontalOverflow(page);
      await expectAccessible(page, testInfo, `lecture-${pane.toLowerCase()}`);
      if (pane === "Tutor") await shot(page, testInfo, `lecture-tutor-${testInfo.project.name}`);
    }
    if (narrow) {
      await page.getByRole("tab", { name: "Slide", exact: true }).click();
      await expect(canvas).toBeVisible();
    }
    // Primary controls keep a comfortable touch size.
    for (const name of ["Next slide", "Previous slide"]) {
      const box = await page.getByRole("button", { name }).boundingBox();
      expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(44);
    }
    const play = await page.getByTestId("play-toggle").boundingBox();
    expect(Math.min(play!.width, play!.height)).toBeGreaterThanOrEqual(44);
  });

  test("SC08 review session and SC17 search overlay at this size", async ({ page }, testInfo) => {
    await page.goto("/study");
    await page.getByRole("button", { name: /^Search / }).click();
    const dialog = page.getByRole("dialog", { name: "Search" });
    await dialog.getByLabel("Search query").fill("promoter");
    await expect(dialog.getByRole("list", { name: "Search results" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page, testInfo, "search");
    await shot(page, testInfo, `search-${testInfo.project.name}`);
    await page.keyboard.press("Escape");

    await page.goto("/review/sessions/rs-not-a-session");
    await expect(page.getByText("This review session is no longer available")).toBeVisible();
    await expect(page.getByText("Nothing was recorded for unanswered items.")).toBeVisible();
    await expectAccessible(page, testInfo, "review-session-missing");
  });
});
