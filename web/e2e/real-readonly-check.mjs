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
    await page.getByRole("tab", { name: "This slide", exact: true }).click();
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
    // Seeking far into the original file must land where asked (Range requests on the local file; no tutor involved).
    entry.media_seek_error_s = await media.evaluate((m) => new Promise((resolve) => {
      const target = Math.max(1, Math.min(m.duration - 5, 600));
      const done = () => resolve(Math.round(Math.abs(m.currentTime - target) * 100) / 100);
      m.addEventListener("seeked", done, { once: true });
      setTimeout(() => resolve(null), 20000);
      m.currentTime = target;
    }));
    if (entry.media_seek_error_s === null || entry.media_seek_error_s > 0.5) problems.push({ where: `media ${course.course_id}`, kind: "seek", text: `seek error ${entry.media_seek_error_s}` });
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
// ---- what the pass prompt asks to be seen through the real app (ids, counts and states only) --------------------------
const extra = (report.extra = { themes: [], suggestions: [], history: [], stale_views: [], timed_occurrences_on_untimed_material: 0 });
const pixels = () => page.getByTestId("slide-canvas").evaluate((canvas) => {
  const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let hash = 0;
  for (let i = 0; i < data.length; i += 97) hash = (hash * 31 + data[i]) >>> 0;
  return `${canvas.width}x${canvas.height}:${hash}`;
});
for (const course of workspace.courses.filter((c) => c.binding === "bound")) {
  const rendered = report.lectures.filter((l) => l.course_id === course.course_id && l.slide === "rendered");
  // Both themes show the same original pixels.
  if (rendered[0]) {
    await page.goto(`${base}/courses/${course.course_id}/lectures/${rendered[0].lecture_id}?page=1`);
    await page.waitForFunction(() => document.querySelector('[data-testid="slide-canvas"]')?.getAttribute("data-rendered") === "1", null, { timeout: 45_000 });
    await page.getByRole("banner").getByRole("radio", { name: "Light" }).click();
    await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "light");
    await page.waitForTimeout(500);
    const light = await pixels();
    await page.getByRole("banner").getByRole("radio", { name: "Dark" }).click();
    await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "dark");
    await page.waitForTimeout(500);
    const dark = await pixels();
    extra.themes.push({ course_id: course.course_id, lecture_id: rendered[0].lecture_id, same_pixels: light === dark });
    if (light !== dark) problems.push({ where: `${course.course_id}/${rendered[0].lecture_id}`, kind: "theme", text: "slide pixels differ between themes" });
    await page.getByRole("banner").getByRole("radio", { name: "Light" }).click();
  }
  // Suggested matches are labelled as unreviewed and carry no time; untimed material never shows a clip time.
  let labelled = null;
  for (const l of rendered) {
    const view = await api(`courses/${course.course_id}/lectures/${l.lecture_id}`);
    const untimed = view.transcripts.every((t) => t.timing !== "annotated");
    if (untimed) extra.timed_occurrences_on_untimed_material += view.slides.reduce((n, sl) => n + sl.occurrences.length, 0);
    const slide = view.slides.find((sl) => sl.transcript_ranges.some((r) => r.review_state !== "confirmed"));
    if (slide && !labelled) {
      await page.goto(`${base}/courses/${course.course_id}/lectures/${l.lecture_id}?page=${slide.page}`);
      await page.waitForFunction((n) => document.querySelector('[data-testid="slide-canvas"]')?.getAttribute("data-rendered") === String(n), slide.page, { timeout: 45_000 });
      await page.getByRole("tab", { name: "Transcript", exact: true }).click();
      const note = (await page.getByTestId("slide-lines-note").textContent({ timeout: 20_000 }).catch(() => "")) ?? "";
      const untimedChip = await page.getByText("Untimed: line references only").count();
      labelled = { course_id: course.course_id, lecture_id: l.lecture_id, page: slide.page, says_suggested: /suggested match/.test(note), says_not_reviewed: /not reviewed/.test(note),
                   says_not_a_time: /not a time in the recording/.test(note), untimed_chip: untimedChip > 0 };
      if (!(labelled.says_suggested && labelled.says_not_reviewed && labelled.says_not_a_time && labelled.untimed_chip)) problems.push({ where: `${course.course_id}/${l.lecture_id}`, kind: "label", text: "suggested lines are not labelled as unreviewed/untimed" });
    }
  }
  if (labelled) extra.suggestions.push(labelled);
  // History and progress show the course's own record ids; a stale owner summary is labelled, never rebuilt.
  const history = await api(`courses/${course.course_id}/history`);
  const progress = await api(`courses/${course.course_id}/progress`);
  await page.goto(`${base}/courses/${course.course_id}`);
  await page.getByLabel("Active course").selectOption(course.course_id);
  await page.goto(`${base}/history`);
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 30_000 });
  const first = history.attempts[0];
  const shown = first ? await page.locator(`[id="${first.attempt_id}"]`).count() : 0;
  extra.history.push({ course_id: course.course_id, attempts_in_course_records: history.attempts.length, first_record_shown_by_its_own_id: first ? shown === 1 : null,
                       every_attempt_has_an_effective_assessment: history.attempts.every((a) => !!a.effective && !!a.effective.assessment_id) });
  if (first && shown !== 1) problems.push({ where: `history ${course.course_id}`, kind: "ids", text: "the first attempt is not shown under its own record id" });
  await page.goto(`${base}/progress`);
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 30_000 });
  const staleShown = await page.getByText("The course's own summary view is out of date").count();
  extra.stale_views.push({ course_id: course.course_id, owner_view_status: progress.owner_view_status, labelled_on_progress_page: staleShown > 0 });
  if ((progress.owner_view_status === "stale") !== (staleShown > 0)) problems.push({ where: `progress ${course.course_id}`, kind: "label", text: "stale owner view label does not match its status" });
}
if (extra.timed_occurrences_on_untimed_material) problems.push({ where: "all lectures", kind: "timing", text: "a clip time is shown for untimed material" });

// Settings state the real readiness: tutor not connected, saves not enabled, the single test request for what it was.
await page.goto(`${base}/settings/ai`);
const nativeRegion = page.getByRole("region", { name: "Native tutor connection" });
await nativeRegion.waitFor({ timeout: 30_000 });
const nativeText = (await nativeRegion.textContent()) ?? "";
extra.settings = { says_not_verified: nativeText.includes("Native connection not verified"), single_test_request_line: /Single test request/.test(nativeText) ? (/separate worker only/.test(nativeText) && /does not connect the tutor/.test(nativeText)) : null,
                   states_missing_transcription: nativeText.includes("Automatic transcription not available"), states_powerpoint: /PowerPoint decks (cannot be shown yet|can be shown as PDF renditions)/.test(nativeText),
                   fixture_wording_present: /Fixture tutor|FIXTURE PROFILE/.test((await page.locator("body").textContent()) ?? "") };
if (!extra.settings.says_not_verified || extra.settings.fixture_wording_present || extra.settings.single_test_request_line === false) problems.push({ where: "settings", kind: "status", text: JSON.stringify(extra.settings) });
const workspaceNow = await api("workspace");
extra.capabilities = { native: workspaceNow.capabilities.native.status, writer: workspaceNow.capabilities.writer.status, writes_are_staged: workspaceNow.writes_are_staged };
if (extra.capabilities.native !== "not_verified" || extra.capabilities.writer !== "staged_only") problems.push({ where: "workspace", kind: "status", text: JSON.stringify(extra.capabilities) });

// An unfinished answer stays with the slide it was written for, and survives a reload. It lives in this browser profile
// only: nothing is sent (the guard above would record any request), and the draft is removed again at the end.
const draftLecture = report.lectures.find((l) => l.slide === "rendered" && /of ([2-9]|\d{2,})/.test(l.position ?? ""));
if (draftLecture) {
  const where = `${base}/courses/${draftLecture.course_id}/lectures/${draftLecture.lecture_id}`;
  await page.goto(`${where}?page=1`);
  await page.waitForFunction(() => document.querySelector('[data-testid="slide-canvas"]')?.getAttribute("data-rendered") === "1", null, { timeout: 45_000 });
  const tutor = page.getByTestId("tutor-panel");
  const composer = page.locator("#tutor-composer");
  await composer.fill("read-only check: unfinished draft");
  await page.getByText("Draft saved on this device").waitFor({ timeout: 15_000 }).catch(() => undefined);
  await page.getByRole("button", { name: "Next slide" }).click();
  const belongs = await tutor.getByRole("status").filter({ hasText: "This draft belongs to slide 1" }).waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
  await page.reload();
  await page.waitForFunction(() => !!document.querySelector('[data-testid="slide-canvas"]')?.getAttribute("data-rendered"), null, { timeout: 45_000 });
  const kept = await composer.inputValue().catch(() => "");
  const stillBound = await tutor.getByRole("status").filter({ hasText: "This draft belongs to slide 1" }).count();
  extra.draft = { lecture: `${draftLecture.course_id}/${draftLecture.lecture_id}`, stays_with_its_slide: belongs, survives_reload: kept === "read-only check: unfinished draft", still_bound_after_reload: stillBound > 0 };
  await composer.fill("");
  if (!belongs || kept !== "read-only check: unfinished draft") problems.push({ where: extra.draft.lecture, kind: "draft", text: JSON.stringify(extra.draft) });
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
  themes_same_pixels: `${extra.themes.filter((t) => t.same_pixels).length}/${extra.themes.length}`,
  suggestion_labels_ok: `${extra.suggestions.filter((x) => x.says_suggested && x.says_not_reviewed && x.says_not_a_time).length}/${extra.suggestions.length}`,
  timed_occurrences_on_untimed_material: extra.timed_occurrences_on_untimed_material,
  history_ids_ok: `${extra.history.filter((h) => h.first_record_shown_by_its_own_id !== false).length}/${extra.history.length}`,
  stale_views_labelled: `${extra.stale_views.filter((v) => v.owner_view_status === "stale" && v.labelled_on_progress_page).length}/${extra.stale_views.filter((v) => v.owner_view_status === "stale").length}`,
  media_seek_ok: `${report.courses.filter((c) => c.media_seek_error_s !== undefined && c.media_seek_error_s !== null && c.media_seek_error_s <= 0.5).length}/${report.courses.filter((c) => c.media_plays !== undefined).length}`,
  settings: extra.settings, draft: extra.draft ?? null,
};
writeFileSync(join(out, "real-readonly-check.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.summary, null, 2));
await browser.close();
process.exit(problems.length || writes.length || report.summary.not_rendered.length || report.summary.unexplained.length || report.summary.other_files_missing.length ? 1 : 0);
