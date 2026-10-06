// Developer aid (not a test): screenshots of chosen routes at chosen sizes and themes against a running preview.
//
//   node e2e/shots.mjs <baseURL> <outDir> [--sizes 1440x900,390x844] [--themes light,dark] [--wait 1200] [--full] <route> [<route> ...]
//
// A route may carry steps after "@@": "/courses/be505/lectures/lecture-02?page=3@@role=tab[name=\"Questions\"]@@text=Answer"
// (each step is a Playwright selector that is clicked in order). The file name is derived from the route and steps.
// Also writes <name>.yaml (accessibility snapshot) for the first size of each theme and problems.txt.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const [base, out] = argv;
const option = (flag, fallback) => {
  const at = argv.indexOf(flag);
  return at >= 0 ? argv[at + 1] : fallback;
};
const flags = new Set(["--sizes", "--themes", "--wait"]);
// Git Bash on Windows rewrites an argument that starts with "/" into a Windows path; undo that, and accept "study" for "/study".
const asRoute = (text) => "/" + text.replace(/^[A-Za-z]:[\\/].*?[\\/]Git[\\/]/, "").replace(/^\/+/, "");
const routes = argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !flags.has(all[i - 1])).map(asRoute);
if (!base || !out || routes.length === 0) {
  console.error('usage: node e2e/shots.mjs <baseURL> <outDir> [--sizes WxH,...] [--themes light,dark] [--wait ms] [--full] <route>[@@selector...] ...');
  process.exit(2);
}
const sizes = option("--sizes", "1440x900").split(",").map((s) => s.split("x").map(Number));
const themes = option("--themes", "light").split(",");
const wait = Number(option("--wait", "1200"));
const fullPage = argv.includes("--full");
mkdirSync(out, { recursive: true });

const problems = [];
const written = [];
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
for (const theme of themes) {
  const context = await browser.newContext({ viewport: { width: sizes[0][0], height: sizes[0][1] }, colorScheme: theme });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && problems.push(`[${theme}] ${page.url()} console: ${m.text().slice(0, 400)}`));
  page.on("pageerror", (e) => problems.push(`[${theme}] ${page.url()} pageerror: ${e.message}`));
  page.on("response", (r) => r.status() >= 500 && problems.push(`[${theme}] ${page.url()} http ${r.status()} ${r.url()}`));
  await page.goto(`${base}/connect`);
  const request = page.getByRole("button", { name: "Request pairing" });
  if (await request.isVisible().catch(() => false)) {
    await request.click();
    await page.getByRole("button", { name: /fingerprints match/ }).click();
    await page.getByText(/^Paired with Brain/).waitFor();
  }
  for (const entry of routes) {
    const [route, ...steps] = entry.split("@@");
    const name = entry.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").slice(0, 90) || "index";
    for (const [index, [width, height]] of sizes.entries()) {
      await page.setViewportSize({ width, height });
      await page.goto(`${base}${route}`);
      await page.waitForTimeout(wait);
      for (const step of steps) {
        try {
          await page.locator(step).first().click({ timeout: 5000 });
          await page.waitForTimeout(400);
        } catch (error) {
          problems.push(`[${theme}] ${entry} @ ${width}x${height}: step "${step}" failed: ${String(error.message).split("\n")[0]}`);
        }
      }
      const file = join(out, `${name}-${width}x${height}-${theme}.png`);
      await page.screenshot({ path: file, fullPage });
      written.push(file);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) problems.push(`[${theme}] ${entry} @ ${width}x${height}: horizontal overflow ${overflow}px`);
      if (index === 0) writeFileSync(join(out, `${name}-${theme}.yaml`), await page.locator("body").ariaSnapshot().catch((e) => `snapshot failed: ${e.message}`));
    }
  }
  await context.close();
}
await browser.close();
writeFileSync(join(out, "problems.txt"), problems.join("\n"));
console.log(JSON.stringify({ written: written.length, problems }, null, 1));
