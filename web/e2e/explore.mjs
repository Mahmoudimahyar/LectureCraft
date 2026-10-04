// Developer aid (not a test): pair a device against a running Brain and dump each screen's
// accessibility snapshot plus console problems.  node e2e/explore.mjs <baseURL> <outDir> [route...]
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [base, out, ...only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 800) }, colorScheme: process.env.SCHEME ?? "light" });
const page = await context.newPage();
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(`${page.url()} console: ${m.text().slice(0, 400)}`));
page.on("pageerror", (e) => problems.push(`${page.url()} pageerror: ${e.message}\n${(e.stack ?? "").split("\n").slice(0, 4).join("\n")}`));
page.on("response", (r) => r.status() >= 400 && problems.push(`${page.url()} http ${r.status()} ${r.url()}`));

await page.goto(`${base}/connect`);
await page.getByRole("button", { name: "Request pairing" }).click();
await page.getByRole("button", { name: /fingerprints match/ }).click();
await page.getByText(/^Paired with Brain/).waitFor();

const routes = only.length ? only : ["/study", "/courses/be505", "/courses/be505/lectures/lecture-02", "/courses/be505/lectures/lecture-02?panel=transcript", "/courses/be505/lectures/lecture-02?panel=sources",
  "/sources", "/review", "/progress", "/history", "/activity", "/settings/appearance", "/settings/access", "/settings/ai", "/settings/limits", "/settings/data", "/settings/maintenance"];
for (const route of routes) {
  await page.goto(`${base}${route}`);
  await page.waitForTimeout(Number(process.env.WAIT ?? 1500));
  const name = route.replace(/[^a-z0-9]+/gi, "_").replace(/^_/, "") || "index";
  const snapshot = await page.locator("body").ariaSnapshot().catch((e) => `snapshot failed: ${e.message}`);
  writeFileSync(join(out, `${name}.yaml`), snapshot);
  await page.screenshot({ path: join(out, `${name}.png`) });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) problems.push(`${route} horizontal overflow ${overflow}px`);
}
writeFileSync(join(out, "problems.txt"), problems.join("\n"));
console.log(problems.length ? problems.join("\n") : "no problems");
await browser.close();
