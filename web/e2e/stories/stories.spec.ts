// LL005: every shared component state actually renders, in Light and Dark, without errors and
// passing the automated accessibility rules. Screenshots are attached for visual review.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const STORIES = `http://127.0.0.1:${process.env.LL_STORIES_PORT ?? 8793}`;

test("every component story renders cleanly in this theme", async ({ page, request }, testInfo) => {
  const theme = String(testInfo.project.use.colorScheme);
  const index = await (await request.get(`${STORIES}/index.json`)).json();
  const stories = Object.values(index.entries as Record<string, { id: string; type: string; name: string }>).filter((entry) => entry.type === "story");
  expect(stories.length, "stories were built").toBeGreaterThanOrEqual(9);

  for (const story of stories) {
    const problems: string[] = [];
    const onConsole = (message: import("@playwright/test").ConsoleMessage) => void (message.type() === "error" && problems.push(message.text()));
    const onError = (error: Error) => void problems.push(error.message);
    page.on("console", onConsole);
    page.on("pageerror", onError);
    await page.goto(`${STORIES}/iframe.html?id=${story.id}&viewMode=story&globals=theme:${theme}`);
    await expect(page.locator("#storybook-root > *").first()).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator(".sb-errordisplay")).toBeHidden();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
    expect(serious, `accessibility violations in story "${story.name}"`).toEqual([]);
    expect(problems, `errors while rendering story "${story.name}"`).toEqual([]);
    await testInfo.attach(`story-${story.id}-${theme}.png`, { body: await page.screenshot(), contentType: "image/png" });
    page.off("console", onConsole);
    page.off("pageerror", onError);
  }

  // Content safety is visible in the story: no active element or script link is produced from tutor text.
  await page.goto(`${STORIES}/iframe.html?id=${stories.find((s) => /markdown/i.test(s.id))!.id}&viewMode=story&globals=theme:${theme}`);
  const root = page.locator("#storybook-root");
  await expect(root.getByRole("link", { name: "safe link" })).toHaveAttribute("href", "https://example.org");
  expect(await root.locator("img, script, iframe").count()).toBe(0);
  expect(await root.locator('a[href^="javascript:"]').count()).toBe(0);
  await expect(root.locator(".katex").first()).toBeVisible(); // maths is typeset, not shown as raw TeX
});
