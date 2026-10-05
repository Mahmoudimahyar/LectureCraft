// Read-only browser check against a Brain started on REAL course roots (`--profile local`).
// It opens every lecture unit the Brain lists, without pairing a device and without submitting,
// typing or saving anything, and records only ids, states, counts and timings — never course text.
// Screenshots (which do show course material) go to the private output folder only.
//
//   node e2e/real-readonly-check.mjs <baseURL> <private-out-dir> [--shots]
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [base, out, ...flags] = process.argv.slice(2);
const shots = flags.includes("--shots");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const problems = [];
const writes = [];
page.on("console", (m) => m.type() === "error" && problems.push({ where: page.url().replace(base, ""), kind: "console", text: m.text().slice(0, 300) }));
page.on("pageerror", (e) => problems.push({ where: page.url().replace(base, ""), kind: "pageerror", text: e.message.slice(0, 300) }));
page.on("response", (r) => r.status() >= 400 && problems.push({ where: page.url().replace(base, ""), kind: `http ${r.status()}`, text: r.url().replace(base, "").slice(0, 200) }));
// Guard: this check must never cause a state-changing request. Anything but GET/HEAD is recorded as a failure.
page.on("request", (r) => !["GET", "HEAD"].includes(r.method()) && writes.push(`${r.method()} ${r.url().replace(base, "")}`));

const api = async (path) => (await context.request.get(`${base}/api/${path}`)).json();
const workspace = await api("workspace");
const report = { base, profile: workspace.profile, writes_are_staged: workspace.writes_are_staged, native: workspace.capabilities.native.status, courses: [], lectures: [] };

await page.goto(`${base}/study`);
await page.getByRole("heading", { name: "Study", level: 1 }).waitFor();
report.study_cards = await page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2 }) }).count();

for (const course of workspace.courses) {
  const entry = { course_id: course.course_id, binding: course.binding, lecture_units: course.lecture_units ?? 0 };
  report.courses.push(entry);
  if (course.binding !== "bound") continue;
  const view = await api(`courses/${course.course_id}`);
  for (const lecture of view.lectures) {
    const row = { course_id: course.course_id, lecture_id: lecture.lecture_id, displayable: lecture.displayable, disposition: lecture.disposition };
    report.lectures.push(row);
    const started = Date.now();
    await page.goto(`${base}/courses/${course.course_id}/lectures/${lecture.lecture_id}`);
    await page.getByTestId("lecture-workspace").waitFor({ timeout: 30_000 }).catch(() => (row.workspace = "did not open"));
    if (row.workspace) continue;
    const canvas = page.getByTestId("slide-canvas");
    if (lecture.displayable) {
      const ok = await canvas.waitFor({ timeout: 5_000 }).then(() => page.waitForFunction(() => document.querySelector('[data-testid="slide-canvas"]')?.getAttribute("data-rendered") === "1", null, { timeout: 45_000 })).then(() => true).catch(() => false);
      row.slide = ok ? "rendered" : "NOT rendered";
      row.first_slide_ms = Date.now() - started;
      row.position = await page.getByTestId("slide-position").textContent().catch(() => null);
    } else {
      row.slide = (await page.getByText("These slides cannot be displayed here").count()) ? "explained as unavailable" : "no explanation shown";
    }
    row.player = (await page.getByTestId("clip-player").count()) ? "player" : (await page.getByText(/link no recorded session to these slides/).count()) ? "no recording (explained)" : "none";
    row.overflow_px = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.getByRole("tab", { name: "Transcript", exact: true }).click();
    const lines = page.getByTestId("transcript-lines").getByRole("listitem");
    const none = page.getByText("No transcript is linked to this lecture");
    await lines.first().or(none).waitFor({ timeout: 20_000 }).catch(() => undefined);
    row.transcript_lines = await lines.count();
    if (!row.transcript_lines) row.transcript = (await none.count()) ? "none (explained)" : "missing without explanation";
    await page.getByRole("tab", { name: "Sources", exact: true }).click();
    row.other_files_expected = lecture.other_materials_count ?? null;
    const others = page.getByRole("region", { name: "Other files in this lecture unit" }).getByRole("listitem");
    if (row.other_files_expected) await others.first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    row.other_files_listed = await others.count();
    if (shots) await page.screenshot({ path: join(out, `${course.course_id}-${lecture.lecture_id}.png`) });
  }
  // One recording per course: metadata must load and a short Range-backed play must advance (no autoplay, then paused again).
  const withPlayer = report.lectures.find((l) => l.course_id === course.course_id && l.player === "player");
  if (withPlayer) {
    await page.goto(`${base}/courses/${course.course_id}/lectures/${withPlayer.lecture_id}`);
    const media = page.getByTestId("lecture-media");
    await media.waitFor({ state: "attached" });
    entry.media_paused_on_open = await media.evaluate((m) => m.paused);
    await page.getByTestId("play-toggle").click();
    const advanced = await page.waitForFunction(() => document.querySelector('[data-testid="lecture-media"]')?.currentTime > 0.5, null, { timeout: 30_000 }).then(() => true).catch(() => false);
    entry.media_plays = advanced;
    entry.media_duration_s = await media.evaluate((m) => (Number.isFinite(m.duration) ? Math.round(m.duration) : null));
    await media.evaluate((m) => m.pause());
  }
  // A few question and concept pages where the course keeps such catalogs (ids only are recorded).
  const review = await api(`courses/${course.course_id}/review`);
  entry.questions_checked = 0;
  for (const q of review.available_questions.slice(0, 3)) {
    await page.goto(`${base}/courses/${course.course_id}/questions/${encodeURIComponent(q.question_id)}`);
    await page.getByTestId("question-prompt").waitFor({ timeout: 30_000 }).then(() => (entry.questions_checked += 1)).catch(() => problems.push({ where: `question ${q.question_id}`, kind: "render", text: "question page did not render" }));
  }
  const concepts = await api(`courses/${course.course_id}/concepts`);
  entry.concept_nodes = Object.keys(concepts.nodes).length;
  entry.concepts_checked = 0;
  for (const node of Object.values(concepts.nodes).filter((n) => n.type === "concept" || n.type === "skill").slice(0, 2)) {
    await page.goto(`${base}/courses/${course.course_id}/concepts/${encodeURIComponent(node.id)}`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 30_000 }).then(() => (entry.concepts_checked += 1)).catch(() => problems.push({ where: `concept ${node.id}`, kind: "render", text: "concept page did not render" }));
    await page.waitForTimeout(300);
  }
  // Search: the index must be served for every course, and the overlay must answer a query without error.
  const indexResponse = await context.request.get(`${base}/api/courses/${course.course_id}/search-index`);
  entry.search_index_status = indexResponse.status();
  if (indexResponse.ok()) {
    const index = await indexResponse.json();
    entry.search_entries = index.entries.length;
    entry.search_unindexed = index.unindexed.length;
  } else {
    problems.push({ where: `search-index ${course.course_id}`, kind: `http ${indexResponse.status()}`, text: "search index not served" });
  }
  await page.goto(`${base}/study`);
  await page.getByLabel("Active course").selectOption(course.course_id);
  await page.getByRole("button", { name: /^Search / }).click();
  const search = page.getByRole("dialog", { name: "Search" });
  await search.getByLabel("Search query").fill("lecture");
  entry.search_answered = await search.getByRole("status").or(search.getByText("No matches in the indexed material")).first().waitFor({ timeout: 30_000 }).then(() => true).catch(() => false);
  if (!entry.search_answered) problems.push({ where: `search ${course.course_id}`, kind: "render", text: "search overlay did not answer" });
  await page.keyboard.press("Escape");
  for (const path of ["/sources", "/progress", "/history", "/review"]) {
    await page.goto(`${base}/study`);
    await page.getByLabel("Active course").selectOption(course.course_id);
    await page.goto(`${base}${path}`);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(400);
  }
}
report.problems = problems;
report.state_changing_requests = writes;
report.summary = {
  lecture_units: report.lectures.length,
  rendered: report.lectures.filter((l) => l.slide === "rendered").length,
  not_rendered: report.lectures.filter((l) => l.slide === "NOT rendered").map((l) => `${l.course_id}/${l.lecture_id}`),
  unavailable_explained: report.lectures.filter((l) => l.slide === "explained as unavailable").length,
  unexplained: report.lectures.filter((l) => l.slide === "no explanation shown" || l.workspace || l.transcript === "missing without explanation").map((l) => `${l.course_id}/${l.lecture_id}`),
  with_transcript: report.lectures.filter((l) => l.transcript_lines > 0).length,
  overflow: report.lectures.filter((l) => l.overflow_px > 1).map((l) => `${l.course_id}/${l.lecture_id}`),
  other_files_missing: report.lectures.filter((l) => l.other_files_expected !== null && l.other_files_listed !== l.other_files_expected).map((l) => `${l.course_id}/${l.lecture_id}`),
  slowest_first_slide_ms: Math.max(0, ...report.lectures.map((l) => l.first_slide_ms ?? 0)),
  problems: problems.length,
  state_changing_requests: writes.length,
};
writeFileSync(join(out, "real-readonly-check.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.summary, null, 2));
await browser.close();
process.exit(problems.length || writes.length || report.summary.not_rendered.length || report.summary.unexplained.length || report.summary.other_files_missing.length ? 1 : 0);
