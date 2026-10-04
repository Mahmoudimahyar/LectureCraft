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

export async function selectCourse(page: Page, courseId: string = COURSE): Promise<void> {
  await page.getByLabel("Course", { exact: true }).selectOption(courseId);
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

/** No element may be wider than the viewport: no sideways scrolling at any required size. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(1);
}

/** Automated accessibility scan (WCAG 2.2 A/AA rules). Original course content is excluded: it is not ours to restyle. */
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
