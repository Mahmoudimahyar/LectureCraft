// Drives the course-tutor pilot through the real browser app: browser -> Brain coordinator -> pilot worker -> browser.
// It sends at most the turns listed in the plan (never more than three here), never retries, never re-sends, and stops
// at the first turn that does not end with a verified answer. Texts typed here are SYNTHETIC test input, not the learner's.
//
//   node e2e/pilot-run.mjs <baseURL> <private-out-dir> <plan.json>
//
// plan.json: { course, lecture, page, ask, clarify, question_id, synthetic_answer }
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [base, out, planPath] = process.argv.slice(2);
const plan = JSON.parse(readFileSync(planPath, "utf8"));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
const sent = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 300)));
page.on("request", (r) => !["GET", "HEAD"].includes(r.method()) && sent.push(`${r.method()} ${r.url().replace(base, "")}`));
const api = async (path) => (await context.request.get(`${base}/api/${path}`)).json();
const report = { base, plan: { ...plan, note: "all typed text is synthetic test input" }, started_at: new Date().toISOString(), turns: [], checks: {} };
const save = () => writeFileSync(join(out, "pilot-run.json"), JSON.stringify(report, null, 2));
const finish = async (code) => {
  report.finished_at = new Date().toISOString();
  report.console_errors = consoleErrors;
  report.state_changing_requests = sent;
  report.budget_after = (await api("settings")).capabilities.native.pilot_budget ?? null;
  save();
  console.log(JSON.stringify({ exit: code, turns: report.turns.map((t) => ({ kind: t.kind, state: t.job_state, turn_id: t.native?.native_turn_id ?? null })), checks: report.checks, budget_after: report.budget_after }, null, 2));
  await browser.close();
  process.exit(code);
};
const decode = (b64) => JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
const evidenceCounts = async () => {
  const [history, progress, review] = await Promise.all([api(`courses/${plan.course}/history`), api(`courses/${plan.course}/progress`), api(`courses/${plan.course}/review`)]);
  return { attempts: history.attempts.length, revisions: history.assessment_revisions ?? null, progress_digest: JSON.stringify(progress).length, review_items: (review.items ?? []).length, review_due: (review.due ?? []).length };
};
const waitForJob = async (known) => {
  // The request this page just sent, followed until it stops moving. Nothing here triggers a send.
  const moving = new Set(["ADMITTED", "READY", "CLAIMED", "RUNNING", "STAGED", "COMMIT_PENDING"]);
  for (let i = 0; i < 120; i++) {
    const activity = await api("activity");
    const job = activity.jobs.find((j) => !known.has(j.request_id));
    if (job && !moving.has(job.state)) return job;
    await page.waitForTimeout(2000);
  }
  return null;
};
const collect = async (kind, job) => {
  const turn = { kind, request_id: job?.request_id ?? null, job_state: job?.state ?? "NOT_OBSERVED", waiting_reason: job?.reason ?? job?.waiting_reason ?? null, phases: job?.phases ?? null };
  if (job) {
    const bundle = await api(`results/${plan.course}/${job.request_id}`);
    if (bundle.result) {
      const files = Object.fromEntries(Object.entries(bundle.result.files_b64).map(([name, b64]) => [name, decode(b64)]));
      const find = (contract) => Object.values(files).find((f) => f.contract === contract) ?? null;
      const message = find("ll.message/1");
      turn.native = find("ll.native-result/1");
      turn.message = message && { message_id: message.message_id, role: message.role, assessment_disposition: message.assessment_disposition, text: message.text, sources: message.sources };
      turn.context = find("ll.context/1");
      turn.publication = find("ll.publication/1") ?? Object.values(files).find((f) => f.status && f.captured_submission !== undefined) ?? null;
      turn.result_files = Object.keys(files);
      turn.signature_key = bundle.result.signature?.key_id ?? null;
    }
  }
  report.turns.push(turn);
  save();
  return turn;
};

// ---- 0. this must be the pilot, with budget left; otherwise nothing is typed or sent ----------------------------------
const workspace = await api("workspace");
const settings = await api("settings");
report.profile = workspace.profile;
report.native = workspace.capabilities.native;
report.budget_before = settings.capabilities.native.pilot_budget ?? null;
report.writes_are_staged = workspace.writes_are_staged;
if (workspace.capabilities.native.status !== "pilot" || !report.budget_before || report.budget_before.remaining_turns < 3 || workspace.writes_are_staged !== true) {
  report.blocked = "not the pilot profile, course writes not staged, or fewer than three pilot turns left";
  await finish(2);
}
const before = await evidenceCounts();
const knownJobs = new Set((await api("activity")).jobs.map((j) => j.request_id));

// ---- 1. pair this browser at the Brain (operator approval on the same PC) -----------------------------------------------
await page.goto(`${base}/connect`);
await page.getByRole("heading", { name: "Connect your course workspace" }).waitFor();
await page.getByRole("button", { name: "Request pairing" }).click();
await page.getByRole("button", { name: /fingerprints match — approve/ }).click();
await page.getByText(/^Paired with Brain/).waitFor({ timeout: 30_000 });

// ---- 2. quick, source-grounded question on one slide ------------------------------------------------------------------------
await page.goto(`${base}/courses/${plan.course}/lectures/${plan.lecture}?page=${plan.page}`);
await page.waitForFunction((n) => document.querySelector('[data-testid="slide-canvas"]')?.getAttribute("data-rendered") === String(n), plan.page, { timeout: 60_000 });
const tutor = page.getByTestId("tutor-panel");
report.checks.label_shown_in_tutor_panel = (await tutor.getByText("Experimental Codex worker tutor").count()) > 0;
report.checks.fixture_wording_absent = !/Fixture tutor/.test((await page.locator("body").textContent()) ?? "");
report.checks.context_chip = await tutor.getByTestId("context-chip").textContent();
const ask = async (kind, text) => {
  await tutor.getByRole("radio", { name: "Quick answer" }).check();
  await tutor.locator("#tutor-composer").fill(text);
  await tutor.getByTestId("send").click();
  const card = tutor.getByTestId("request-card").filter({ hasText: text });
  await card.waitFor({ timeout: 30_000 });
  const job = await waitForJob(knownJobs);
  if (job) knownJobs.add(job.request_id);
  const turn = await collect(kind, job);
  turn.typed = text;
  if (job?.state === "SUCCEEDED") await card.getByRole("list", { name: "Request status" }).getByText(/Answer available \(verified\)/).waitFor({ timeout: 40_000 }).catch(() => undefined);
  turn.card_status = await card.getByRole("list", { name: "Request status" }).textContent().catch(() => null);
  turn.card_reply = await card.getByTestId("tutor-reply").textContent({ timeout: 20_000 }).catch(() => null);
  turn.card_sources = await card.getByTestId("tutor-reply").getByRole("list", { name: "Sources used" }).textContent({ timeout: 3_000 }).catch(() => null);
  turn.card_note = await card.getByRole("note").first().textContent({ timeout: 3_000 }).catch(() => null);
  turn.card_shows_feedback = (await card.getByTestId("feedback").count()) > 0;
  turn.card_learner_text = await card.getByTestId("learner-text").textContent({ timeout: 3_000 }).catch(() => null);
  await page.screenshot({ path: join(out, `pilot-${kind}.png`) });
  save();
  return turn;
};
const first = await ask("quick-question", plan.ask);
if (first.job_state !== "SUCCEEDED") await finish(1); // no verified answer: stop, send nothing more
const afterFirst = await evidenceCounts();
report.checks.quick_answer_created_no_attempt_or_gap = JSON.stringify(afterFirst) === JSON.stringify(before);

// ---- 3. a clarification on the same pilot thread ---------------------------------------------------------------------------------
const second = await ask("clarification", plan.clarify);
if (second.job_state !== "SUCCEEDED") await finish(1);
report.checks.same_thread_for_both = !!first.native && !!second.native && first.native.native_thread_id === second.native.native_thread_id && first.native.native_turn_id !== second.native.native_turn_id;
report.checks.separate_tutor_messages = !!first.message && !!second.message && first.message.message_id !== second.message.message_id;
report.checks.still_no_attempt_or_gap = JSON.stringify(await evidenceCounts()) === JSON.stringify(before);

// ---- 4. one SYNTHETIC explain-back on a rubric question; isolation is checked before and after ---------------------------------------
if (plan.question_id && plan.synthetic_answer) {
  report.checks.isolation_before_assessment = { writes_are_staged: (await api("workspace")).writes_are_staged, writer: (await api("settings")).capabilities.writer };
  if (report.checks.isolation_before_assessment.writes_are_staged !== true || report.checks.isolation_before_assessment.writer.status !== "staged_only") await finish(1);
  await page.goto(`${base}/courses/${plan.course}/questions/${encodeURIComponent(plan.question_id)}`);
  await page.getByTestId("question-prompt").waitFor({ timeout: 30_000 });
  await page.locator("#practice-answer").fill(plan.synthetic_answer);
  await page.getByTestId("submit-answer").click();
  const job = await waitForJob(knownJobs);
  if (job) knownJobs.add(job.request_id);
  const third = await collect("synthetic-explain-back", job);
  third.typed = plan.synthetic_answer;
  third.page_text_after = ((await page.getByRole("region", { name: "Your work on this question" }).textContent({ timeout: 20_000 }).catch(() => "")) ?? "").slice(0, 4000);
  await page.screenshot({ path: join(out, "pilot-synthetic-explain-back.png"), fullPage: true });
  report.checks.assessment_recorded_nothing = JSON.stringify(await evidenceCounts()) === JSON.stringify(before);
}
await finish(0);
