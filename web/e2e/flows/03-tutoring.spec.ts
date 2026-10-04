// UI11–UI17: time-aware help. Quick answer and Understand are never assessed; Explain back, practice
// and diagnostic answers freeze the learner's full response before the tutor sees it. The tutor here
// is the labeled fixture double, so these tests prove the mechanics and the honesty of the states,
// not the quality of any real tutor.
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { COURSE, isNarrow, pair, settle } from "../helpers";
import { expect, test } from "../fixtures";

const L2 = `/courses/${COURSE}/lectures/lecture-02`;

async function openTutor(page: Page, url: string, renderedPage: string): Promise<Locator> {
  await page.goto(url);
  await expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", renderedPage);
  if (isNarrow(page)) await page.getByRole("tab", { name: "Tutor", exact: true }).click();
  return page.getByTestId("tutor-panel");
}

const attempts = async (request: APIRequestContext): Promise<number> => (await (await request.get(`/api/courses/${COURSE}/history`)).json()).attempts.length;

test.describe("tutoring", () => {
  test("UI11 a quick answer is short, cited and explicitly not assessed; nothing is sent while typing", async ({ page, request, unique }) => {
    await pair(page);
    const before = await attempts(request);
    const jobsBefore = (await (await request.get("/api/activity")).json()).counts.jobs;
    const tutor = await openTutor(page, `${L2}?page=2`, "2");
    await expect(tutor.getByText("Fixture tutor (test double)")).toBeVisible();
    await expect(tutor.getByRole("radio", { name: "Quick answer" })).toBeChecked();
    await expect(tutor.getByTestId("context-chip")).toHaveText("Slide 2");

    const question = unique("What does the repressor do at the operator?");
    await tutor.locator("#tutor-composer").fill(question);
    await expect(tutor.getByText("Draft saved on this device")).toBeVisible();
    expect((await (await request.get("/api/activity")).json()).counts.jobs, "typing sends nothing").toBe(jobsBefore);

    await tutor.getByTestId("send").dblclick(); // a double click must not create two requests
    const card = tutor.getByTestId("request-card").filter({ hasText: question });
    await expect(card).toHaveCount(1);
    await expect(tutor.locator("#tutor-composer")).toHaveValue("");
    const status = card.getByRole("list", { name: "Request status" });
    await expect(status).toContainText("Your input: captured");
    await expect(status).toContainText("Received by Brain");
    await expect(status).toContainText("Answer available (verified)", { timeout: 20_000 });
    await expect(status).toContainText("Completed");

    const reply = card.getByTestId("tutor-reply");
    await expect(reply).toContainText("Short version");
    await expect(reply).toContainText("FIXTURE"); // the test double labels its own output
    await expect(reply.getByRole("list", { name: "Sources used" }).getByRole("link", { name: "Slide/page 2" })).toBeVisible();
    await expect(card.getByRole("note")).toContainText("Not assessed this exchange");
    await expect(card.getByRole("note")).toContainText("Your earlier evidence is unchanged.");
    await expect(card.getByTestId("feedback")).toHaveCount(0);

    await settle(request);
    expect(await attempts(request), "asking for help creates no attempt").toBe(before);
    const jobs = (await (await request.get("/api/activity")).json()).jobs as Array<{ action: string; depth: string; phases: { publication: string } }>;
    expect(jobs.filter((j) => j.action === "ask" && j.depth === "quick")[0]!.phases.publication).toBe("Not assessed in this exchange");
  });

  test("UI11 an unpaired device can read and draft, and is told plainly that sending is off", async ({ page }) => {
    await page.goto(`${L2}?page=1`);
    await expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", "1");
    if (isNarrow(page)) await page.getByRole("tab", { name: "Tutor", exact: true }).click();
    const tutor = page.getByTestId("tutor-panel");
    await expect(tutor.getByText("This device is not paired yet, so sending is off.")).toBeVisible();
    await tutor.locator("#tutor-composer").fill("a draft written before pairing");
    await tutor.getByTestId("send").click();
    await expect(tutor.getByRole("alert")).toContainText("Not sent");
    await expect(tutor.getByRole("link", { name: "Pair this device" })).toBeVisible();
    await expect(tutor.locator("#tutor-composer")).toHaveValue("a draft written before pairing"); // the text is not lost
  });

  test("UI12 Understand gives a fuller explanation; going deeper and trying to explain are the learner's choice", async ({ page, unique }) => {
    await pair(page);
    const tutor = await openTutor(page, `${L2}?page=1`, "1");
    await tutor.getByRole("radio", { name: "Understand" }).click();
    const question = unique("Why induce late rather than early?");
    await tutor.locator("#tutor-composer").fill(question);
    await tutor.locator("#tutor-composer").press("Control+Enter");
    const card = tutor.getByTestId("request-card").filter({ hasText: question }).first();
    await expect(card.getByTestId("tutor-reply")).toContainText("Explanation for", { timeout: 20_000 });
    await expect(card).toContainText("Question · understand");
    await expect(card.getByRole("note")).toContainText("Not assessed this exchange");

    await card.getByRole("button", { name: "Go deeper" }).click();
    await expect(tutor.locator("#tutor-composer")).toHaveValue(`Go deeper on: ${question}`);
    await expect(tutor.locator("#tutor-composer")).toBeFocused();
    await tutor.getByTestId("send").click();
    const deeper = tutor.getByTestId("request-card").filter({ hasText: `Go deeper on: ${question}` });
    await expect(deeper.getByTestId("tutor-reply")).toContainText("Longer explanation", { timeout: 20_000 });
    await expect(deeper).toContainText("Question · go deeper");

    // "Try explaining" only switches the mode; no quiz is forced and nothing is submitted.
    await card.getByRole("button", { name: "Try explaining" }).click();
    await expect(tutor.getByRole("radio", { name: "Explain back" })).toBeChecked();
    await expect(tutor.getByRole("button", { name: "Check my explanation" })).toBeDisabled();

    // The draft keeps the slide it was written for when the learner moves on.
    await tutor.locator("#tutor-composer").fill("half-written explanation");
    if (isNarrow(page)) await page.getByRole("tab", { name: "Slide", exact: true }).click();
    await page.getByRole("button", { name: "Next slide" }).click();
    if (isNarrow(page)) await page.getByRole("tab", { name: "Tutor", exact: true }).click();
    await expect(tutor.getByRole("status").filter({ hasText: "This draft belongs to slide 1" })).toBeVisible();
    await expect(tutor.getByTestId("context-chip")).toHaveText("Slide 1");
    await tutor.getByRole("button", { name: "Move the draft to slide 2" }).click();
    await expect(tutor.getByTestId("context-chip")).toHaveText("Slide 2");
    await tutor.locator("#tutor-composer").fill("");
  });

  test("UI13 a typed teach-back is frozen, assessed against the course rubric and saved through the course writer", async ({ page, request, unique }) => {
    await pair(page);
    const before = await attempts(request);
    const tutor = await openTutor(page, `${L2}?page=1`, "1");
    await tutor.getByRole("radio", { name: "Explain back" }).click();
    await tutor.getByLabel("What to explain").selectOption({ label: "How induction works" });
    await expect(tutor.getByText("Explain how adding an inducer switches on an inducible promoter.")).toBeVisible();
    await expect(tutor.getByText("Your response is frozen and retained before the tutor sees it.")).toBeVisible();
    // Criteria are not shown before the attempt.
    await expect(tutor).not.toContainText("releases the repressor from the operator so transcription can start");

    await tutor.getByText("Conditions (self-reported)").click();
    await tutor.getByLabel("Have you seen this question before?").selectOption("unseen_reported");
    const answer = unique("Inducer binding releases the repressor from the operator, so transcription can start. States matter here.");
    await tutor.locator("#tutor-composer").fill(answer);
    await tutor.getByRole("button", { name: "Check my explanation" }).click();

    const card = tutor.getByTestId("request-card").filter({ hasText: answer });
    await expect(card.getByTestId("learner-text")).toHaveText(answer); // the exact response, not a summary
    const feedback = card.getByTestId("feedback");
    await expect(feedback).toBeVisible({ timeout: 20_000 });
    await expect(feedback).toContainText("Demonstrated");
    await expect(feedback).toContainText("confidence: low");
    await expect(feedback).toContainText("Criterion: States that inducer binding releases the repressor from the operator so transcription can start.");
    await expect(feedback).toContainText(/Recorded conditions: .* \(self-reported; unknown is not treated as unaided\)/);
    const save = feedback.getByRole("list", { name: "Save status" });
    await expect(save).toContainText("Full response retained");
    await expect(save).toContainText("Assessment: recorded");
    await expect(save).toContainText("Saved to course");
    await expect(save).toContainText(/Course summary view: (current|stale \(your attempt is saved; only the summary lags\))/);

    await settle(request);
    expect(await attempts(request), "exactly one new attempt").toBe(before + 1);
    const history = await (await request.get(`/api/courses/${COURSE}/history`)).json();
    const saved = (history.attempts as Array<{ response: { full_text: string | null; availability: string }; mode: string }>).find((a) => a.response.full_text === answer);
    expect(saved, "the full response is retrievable from the course's own record").toBeTruthy();
    expect(saved!.response.availability).toBe("full_capture");
  });

  test("UI13 an explanation without a reviewed rubric is retained in full and stays 'assessment pending' — never graded by guess", async ({ page, request, unique }) => {
    await pair(page);
    const before = await attempts(request);
    const tutor = await openTutor(page, `${L2}?page=3`, "3");
    await tutor.getByRole("radio", { name: "Explain back" }).click();
    await expect(tutor.getByLabel("What to explain")).toHaveValue("");
    const answer = unique("Copy number and promoter strength have to be balanced against host load.");
    await tutor.locator("#tutor-composer").fill(answer);
    await tutor.getByRole("button", { name: "Check my explanation" }).click();
    const card = tutor.getByTestId("request-card").filter({ hasText: answer });
    const feedback = card.getByTestId("feedback");
    await expect(feedback).toContainText("Assessment pending", { timeout: 20_000 });
    await expect(feedback.getByRole("list", { name: "Save status" })).toContainText("Full response retained");
    await expect(feedback.getByRole("list", { name: "Save status" })).not.toContainText("Saved to course");
    await expect(feedback).not.toContainText("Demonstrated");
    await settle(request);
    expect(await attempts(request), "no attempt is invented without criteria").toBe(before);
  });

  test("UI14 explain aloud: local-only recording, visible state, learner-corrected transcript, typed fallback when the microphone is refused", async ({ page, unique }) => {
    await pair(page);
    const tutor = await openTutor(page, `${L2}?page=1`, "1");
    await tutor.getByRole("radio", { name: "Explain back" }).click();
    await tutor.getByRole("button", { name: "Explain aloud" }).click();
    const dialog = page.getByRole("dialog", { name: "Explain aloud" });
    await expect(dialog).toContainText("only on this device");
    await expect(dialog).toContainText("No automatic transcription is installed and no online speech service is used");
    await expect(dialog.getByTestId("recording-state")).toHaveText("Not recording");
    await expect(dialog.getByRole("button", { name: "Use this transcript" })).toBeDisabled();

    await dialog.getByRole("button", { name: "Record", exact: true }).click();
    await expect(dialog.getByTestId("recording-state")).toContainText("● Recording");
    await dialog.getByRole("button", { name: "Pause" }).click();
    await expect(dialog.getByTestId("recording-state")).toContainText("Paused at");
    await dialog.getByRole("button", { name: "Resume" }).click();
    await page.waitForTimeout(600);
    await dialog.getByRole("button", { name: "Stop" }).click();
    await expect(dialog.getByTestId("recording-state")).toContainText("Recorded");
    await expect(dialog.getByLabel("Your recording (kept on this device only)")).toBeVisible();

    const spoken = unique("The inducer binds the repressor, which releases the operator [?] so transcription can start.");
    await dialog.getByLabel("Transcript of what you said").fill(spoken);
    await dialog.getByRole("button", { name: "Use this transcript" }).click();
    await expect(dialog).toBeHidden();
    await expect(tutor.locator("#tutor-composer")).toHaveValue(spoken);
    await expect(tutor.getByText("From your corrected voice transcript")).toBeVisible();
    // No audio leaves the device: the only upload so far would be a request bundle, and none was sent.
    await tutor.locator("#tutor-composer").fill("");

    // Microphone refused: nothing is recorded and typing remains available.
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied by test", "NotAllowedError"));
    });
    await tutor.getByRole("button", { name: "Explain aloud" }).click();
    await dialog.getByRole("button", { name: "Record", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Microphone access was not granted");
    await expect(dialog.getByRole("alert")).toContainText("Nothing was recorded.");
    await expect(dialog.getByLabel("Transcript of what you said")).toBeEditable();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });

  test("UI15 practice records the help that was used; a skip records nothing", async ({ page, request, unique }) => {
    await pair(page);
    const before = await attempts(request);
    await page.goto(`/courses/${COURSE}/questions/BE505-L01-Q02`);
    await expect(page.getByTestId("question-prompt")).not.toBeEmpty();
    await expect(page.getByText("Criteria and answer guidance are used for assessment and shown with feedback, not before your attempt.")).toBeVisible();
    await expect(page.getByText("This is practice, not a secured exam")).toBeVisible();

    await page.locator("#practice-answer").fill("something I will abandon");
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    await expect(page.getByText("Skipped. Nothing was recorded — a skip is not a failed attempt.")).toBeVisible();
    await settle(request);
    expect(await attempts(request)).toBe(before);

    await page.getByRole("button", { name: "Request a hint" }).click();
    await expect(page.getByText("Hint used — recorded")).toBeVisible();
    const answer = unique("RNA polymerase binds the promoter and transcription of the downstream gene produces RNA.");
    await page.locator("#practice-answer").fill(answer);
    await page.getByTestId("submit-answer").click();

    const card = page.getByRole("region", { name: "Your work on this question" }).getByTestId("request-card").filter({ hasText: answer });
    const feedback = card.getByTestId("feedback");
    await expect(feedback).toContainText("Demonstrated", { timeout: 20_000 });
    await expect(feedback).toContainText("Recorded conditions: after a hint");
    await expect(feedback.getByRole("list", { name: "Save status" })).toContainText("Saved to course");
    await settle(request);
    expect(await attempts(request)).toBe(before + 1);
    // An assisted success is stored as assisted — it is not presented as independent mastery.
    const progress = await (await request.get(`/api/courses/${COURSE}/progress`)).json();
    const skill = (progress.skills as Array<{ skill_id: string; latest: { assistance: string; outcome: string } | null }>).find((s) => s.skill_id === "be505.skill.promoter.explain")!;
    expect(skill.latest!.outcome).toBe("demonstrated");
    expect(skill.latest!.assistance).toBe("hint");
  });

  test("UI16 a weak answer offers an optional, bounded diagnostic with hypotheses — and the way back to the slide", async ({ page, request, unique }) => {
    await pair(page);
    const tutor = await openTutor(page, `${L2}?page=1`, "1");
    await tutor.getByRole("radio", { name: "Explain back" }).click();
    await tutor.getByLabel("What to explain").selectOption({ label: "How induction works" });
    const weak = unique("It makes the cell grow faster because more plasmid copies appear over time.");
    await tutor.locator("#tutor-composer").fill(weak);
    await tutor.getByRole("button", { name: "Check my explanation" }).click();
    const card = tutor.getByTestId("request-card").filter({ hasText: weak });
    await expect(card.getByTestId("feedback")).toContainText("Not shown in this response", { timeout: 20_000 });

    // The diagnostic never opens by itself.
    await expect(card.getByTestId("diagnostic")).toHaveCount(0);
    await card.getByRole("button", { name: "Understand this gap" }).click();
    const diagnostic = card.getByTestId("diagnostic");
    await expect(diagnostic).toContainText("Possible causes (hypotheses, not conclusions)");
    await expect(diagnostic).toContainText("Other explanations:");
    await expect(diagnostic).toContainText("Skipping leaves this pending — it is not counted as a failure.");

    const before = await attempts(request);
    await diagnostic.getByRole("button", { name: "Answer this check" }).click();
    await expect(tutor.getByText("Diagnostic check", { exact: true })).toBeVisible();
    const check = unique("The plasmid would still replicate; only transcription of the gene would stop.");
    await tutor.locator("#tutor-composer").fill(check);
    await tutor.getByRole("button", { name: "Submit answer" }).click();
    const checkCard = tutor.getByTestId("request-card").filter({ hasText: check });
    await expect(checkCard.getByTestId("tutor-reply")).toContainText("Possible causes are listed as hypotheses, not conclusions.", { timeout: 20_000 });
    await expect(checkCard).toContainText("Diagnostic answer");
    await settle(request);
    expect(await attempts(request), "an unrubriced diagnostic answer is retained but not turned into an attempt").toBe(before);

    // Back to the lecture: the composer returns to normal and the slide is where it was.
    await expect(tutor.getByRole("radiogroup", { name: "Interaction" })).toBeVisible();
    if (isNarrow(page)) await page.getByRole("tab", { name: "Slide", exact: true }).click();
    await expect(page.getByTestId("slide-position")).toHaveText("Slide 1 of 3");
  });

  test("UI17 disputing feedback regrades the same response without overwriting it; a better answer is a separate new attempt", async ({ page, request, unique }) => {
    await pair(page);
    await page.goto(`/courses/${COURSE}/questions/BE505-L01-Q01`);
    const first = unique("The origin is where replication starts on the plasmid.");
    await page.locator("#practice-answer").fill(first);
    await page.getByTestId("submit-answer").click();
    const work = page.getByRole("region", { name: "Your work on this question" });
    const card = work.getByTestId("request-card").filter({ hasText: first });
    await expect(card.getByTestId("feedback").getByRole("list", { name: "Save status" })).toContainText("Saved to course", { timeout: 20_000 });
    await settle(request);
    const before = await (await request.get(`/api/courses/${COURSE}/history`)).json();
    const original = (before.attempts as Array<{ attempt_id: string; response: { full_text: string | null }; revisions: unknown[]; original_observations: Array<{ outcome: string }> }>).find((a) => a.response.full_text === first)!;
    expect(original.revisions).toHaveLength(0);

    await card.getByRole("button", { name: "Report an issue" }).click();
    const dialog = page.getByRole("dialog", { name: "Report an issue with this feedback" });
    await expect(dialog).toContainText("The original response and its time are always kept.");
    await expect(dialog.getByRole("radio", { name: /The assessment is wrong/ })).toBeChecked();
    await expect(dialog.getByRole("button", { name: "Submit for review" })).toBeDisabled(); // disagreeing alone changes nothing
    await dialog.getByLabel("What should be reconsidered?").fill("I did state that replication starts at the origin; the criterion's second half was not asked clearly.");
    await dialog.getByRole("button", { name: "Submit for review" }).click();
    await expect(dialog).toBeHidden();
    await expect(card.getByRole("status")).toContainText("Nothing changes until the regrade is verified");
    await settle(request);

    // The regrade really ran (a tutor turn), and because it reached the same outcome nothing was rewritten:
    // disagreeing is not a way to change a record. (A regrade that does change the outcome writes one linked
    // revision; that path is covered by brain/tests/test_coordinator.py.)
    const after = await (await request.get(`/api/courses/${COURSE}/history`)).json();
    const revised = (after.attempts as typeof before.attempts).find((a: { attempt_id: string }) => a.attempt_id === original.attempt_id)!;
    expect(after.attempts.length, "a dispute is not a new attempt").toBe(before.attempts.length);
    expect(revised.revisions, "an unchanged regrade writes no revision").toHaveLength(0);
    expect(revised.response.full_text, "the original response is untouched").toBe(first);
    expect(revised.original_observations).toEqual(original.original_observations);
    const jobs = (await (await request.get("/api/activity")).json()).jobs as Array<{ action: string; state: string; updated_at: number; phases: { native: string } }>;
    const dispute = jobs.filter((j) => j.action === "correct_assessment").sort((a, b) => b.updated_at - a.updated_at)[0]!;
    expect(dispute.state).toBe("SUCCEEDED");
    expect(dispute.phases.native).toBe("Completed");

    // "I understand it better now" is a new answer, never an overwrite.
    await card.getByRole("button", { name: "Report an issue" }).click();
    await dialog.getByRole("radio", { name: /I understand it better now/ }).click();
    await dialog.getByRole("button", { name: "Write a new answer" }).click();
    await expect(page.getByRole("heading", { name: "New answer" })).toBeVisible();
    await expect(page.getByText("it will be a separate attempt and never overwrites your earlier one")).toBeVisible();
    const second = unique("Plasmid replication starts at the origin, and it does not control expression of the gene.");
    await page.locator("#practice-answer").fill(second);
    await page.getByTestId("submit-answer").click();
    await expect(work.getByTestId("request-card").filter({ hasText: second }).getByTestId("feedback")).toContainText("Demonstrated", { timeout: 20_000 });
    await settle(request);
    const final = await (await request.get(`/api/courses/${COURSE}/history`)).json();
    expect(final.attempts.length).toBe(before.attempts.length + 1);
    expect((final.attempts as typeof before.attempts).find((a: { attempt_id: string }) => a.attempt_id === original.attempt_id)!.response.full_text).toBe(first);
  });
});
