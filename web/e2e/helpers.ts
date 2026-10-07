// Shared helpers for the browser tests. Everything goes through the real UI and the real loopback
// Brain; the only test-only control is the labeled fixture tutor's behaviour switch.
import AxeBuilder from "@axe-core/playwright";
import { expect, type APIRequestContext, type ConsoleMessage, type Page, type TestInfo } from "@playwright/test";

export const COURSE = "be505";
export const LECTURE = "lecture-02";

/** Collects console errors and failed same-origin requests for the life of a page. */
export function watchProblems(page: Page): { problems: string[] } {
  const problems: string[] = [];
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") problems.push(`console: ${message.text().slice(0, 300)}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 500) problems.push(`http ${response.status()}: ${response.url()}`);
  });
  return { problems };
}

/** Pair this browser's own device key through the Connect screen (request, compare, approve at the Brain PC). */
export async function pair(page: Page): Promise<void> {
  await page.goto("/connect");
  await expect(page.getByRole("heading", { name: "Connect your course workspace" })).toBeVisible();
  const paired = page.getByText(/^Paired with Brain/);
  if (await paired.isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "Request pairing" }).click();
  await page.getByRole("button", { name: /fingerprints match — approve/ }).click();
  await expect(paired).toBeVisible();
}

/** A course's display name as the workspace gives it (the pickers of the header list courses by name, not by id). */
export async function courseDisplayName(page: Page, courseId: string = COURSE): Promise<string> {
  const workspace = (await (await page.request.get("/api/workspace")).json()) as { courses: Array<{ course_id: string; display_name: string }> };
  const course = workspace.courses.find((c) => c.course_id === courseId);
  if (!course) throw new Error(`no course ${courseId} in the workspace`);
  return course.display_name;
}

/**
 * Choose the active course the way a learner does since the rebuilt shell (the header's native select is gone):
 *  - on Study and on a course page: the course's tab of the "Courses" tablist;
 *  - on a page that follows the active course (Review, Progress, Library, History, Activity): the header picker
 *    "Active course: <name>" on a wide window, the "Active course" group of the header Menu on a narrow one;
 *  - anywhere else (a lecture, a question, Settings on a wide window …) no course control exists: it goes to Study
 *    and chooses there, and the caller navigates on.
 * The choice is kept on the device (it survives `page.goto`). Pinned by 01-access "UI03 the active course is chosen …".
 */
export async function selectCourse(page: Page, courseId: string = COURSE): Promise<void> {
  const tab = page.getByTestId("course-tabs").locator(`[data-course="${courseId}"]`);
  const chooseTab = async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(`[data-testid="course-pane"][data-course="${courseId}"]`)).toBeVisible();
  };
  const name = await courseDisplayName(page, courseId);
  const picker = page.getByRole("navigation", { name: "Where you are" }).getByRole("button", { name: /^Active course: / });
  const menu = page.getByRole("button", { name: /^Menu: / });
  const path = new URL(page.url()).pathname;
  if (/^\/(study|courses\/[^/]+)\/?$/.test(path)) return chooseTab(); // Study, or Study with a course chosen
  // A page below a course (a lecture, the question bank, a source …) has no course control at all, in the path or in
  // the Menu. Any other page is given the time to draw the control it has before the helper decides there is none.
  if (!/^\/courses\/[^/]+\/.+/.test(path)) {
    await picker.or(menu).first().waitFor({ state: "visible", timeout: 3_000 }).catch(() => undefined);
    if (await picker.isVisible()) {
      await picker.click();
      await page.getByRole("menu").getByRole("menuitemradio", { name, exact: true }).click();
      await expect(page.getByRole("menu")).toBeHidden();
      await expect(picker).toHaveAccessibleName(`Active course: ${name}`);
      return;
    }
    if (await menu.isVisible()) {
      await menu.click();
      const group = page.getByRole("menu").getByRole("group", { name: "Active course" });
      await group.waitFor({ state: "visible", timeout: 2_000 }).catch(() => undefined);
      if (await group.isVisible()) {
        await group.getByRole("menuitemradio", { name, exact: true }).click();
        await expect(page.getByRole("menu")).toBeHidden();
        return;
      }
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toBeHidden();
    }
  }
  await page.goto("/study");
  await chooseTab();
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Show one destination of a lecture: a tab of the "Context panel" on a wide window, of the "Workspace pane" switch on a
 * narrow one or with enlarged text (only one of the two tablists exists at a time). `name` is the tab's label without
 * its count: "Slide", "Outline", "Tutor", "Questions", "Concepts", "Transcript", "Sources".
 */
export async function openPane(page: Page, name: string): Promise<void> {
  const tab = page.getByRole("tab", { name: new RegExp(`^${escapeRegExp(name)}( \\d+)?$`) });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

export async function setFixtureMode(request: APIRequestContext, mode: string): Promise<void> {
  const response = await request.post("/api/fixture/native-mode", { data: { mode } });
  expect(response.ok(), `fixture mode ${mode}`).toBeTruthy();
}

/** Ask the Brain to prepare a course's lectures (text layers, clip suggestions) and wait until it settles. */
export async function prepare(request: APIRequestContext, courseId: string = COURSE): Promise<void> {
  const response = await request.post(`/api/prepare/${courseId}`);
  expect(response.ok(), "prepare").toBeTruthy();
  await settle(request);
}

/** Wait until the Brain has no runnable work left (bounded). */
export async function settle(request: APIRequestContext, timeoutMs = 30_000): Promise<void> {
  const open = new Set(["RECEIVED", "READY", "CLAIMED", "RUNNING", "STAGED", "COMMIT_PENDING", "FAILED_RETRYABLE"]);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const activity = await (await request.get("/api/activity")).json();
    const busy = (activity.jobs as Array<{ state: string }>).filter((j) => open.has(j.state));
    if (busy.length === 0) return;
    if (Date.now() > deadline) throw new Error(`Brain still busy: ${JSON.stringify(busy.map((j) => j.state))}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * No element may be wider than the viewport: no sideways scrolling at any required size.
 * Since the rebuilt shell the document itself never scrolls (the window is filled and `main` is the scroller of an
 * ordinary page), so the document alone would always pass: the page scroller `#main` is held to the same rule.
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const report = await page.evaluate(() => {
    const root = document.documentElement;
    const main = document.getElementById("main");
    const ofDocument = root.scrollWidth - root.clientWidth;
    const ofMain = main ? main.scrollWidth - main.clientWidth : 0;
    const overflow = Math.max(ofDocument, ofMain);
    if (overflow <= 1) return { overflow, where: "", offenders: [] as string[] };
    const inMain = ofMain > ofDocument && !!main;
    const limit = inMain ? main!.getBoundingClientRect().left + main!.clientWidth : root.clientWidth;
    const offenders = Array.from((inMain ? main! : document.body).querySelectorAll<HTMLElement>("*"))
      .map((el) => ({ el, right: el.getBoundingClientRect().right }))
      .filter((x) => x.right > limit + 1)
      .sort((a, b) => b.right - a.right)
      .slice(0, 6)
      .map((x) => `${x.el.tagName.toLowerCase()}.${String(x.el.className).split(" ").slice(0, 4).join(".")} → ${Math.round(x.right)}px`);
    return { overflow, where: inMain ? "main" : "document", offenders };
  });
  expect(report.overflow, `horizontal overflow of the ${report.where} in px; widest elements: ${report.offenders.join(" | ")}`).toBeLessThanOrEqual(1);
}

/**
 * Automated accessibility scan (WCAG 2.2 A/AA rules). Original course content is excluded: it is not ours to restyle.
 * (Since the rebuild no element carries `.ll-source-surface`: the page of the original file is `slide-surface`, and it is
 * scanned like everything else. The old exclusion is kept as written so that nothing more is left out than before.)
 */
export async function expectAccessible(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).exclude(".ll-source-surface").exclude("media-controller").analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  if (serious.length) {
    await testInfo.attach(`axe-${label}.json`, { body: JSON.stringify(serious, null, 2), contentType: "application/json" });
  }
  expect(serious.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`), `accessibility violations on ${label}`).toEqual([]);
}

export async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(`${name}.png`, { body: await page.screenshot({ fullPage: false }), contentType: "image/png" });
}

export const isNarrow = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 900;
