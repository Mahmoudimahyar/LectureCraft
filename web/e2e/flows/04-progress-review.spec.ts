// UI19–UI24, UI31: evidence-backed progress, typed concept navigation, history, deliberate review
// and the session wrap-up. Nothing here computes a mastery score, and nothing schedules itself.
import type { APIRequestContext, Page } from "@playwright/test";
import { COURSE, expectAccessible, expectNoHorizontalOverflow, isNarrow, pair, settle, shot } from "../helpers";
import { expect, test } from "../fixtures";

interface ReviewRow { item_id: string; selection: string; performed_reviews: number; scheduled_reviews: number; due_at: string | null; is_due: boolean; revision: number; question: { question_id: string | null; prompt: string } }
const reviewView = async (request: APIRequestContext): Promise<{ items: ReviewRow[]; due_count: number }> => (await request.get(`/api/courses/${COURSE}/review`)).json();

const items = (page: Page) => page.getByRole("region", { name: /^Your selected and saved items/ });
const available = (page: Page) => page.getByRole("region", { name: /^Course questions you can add/ });
/** The app's own confirmation that the signed request left this device. Only then is it safe to look at the Brain or reload. */
const sent = (page: Page, text: string) => expect(page.getByRole("status").filter({ hasText: text })).toBeVisible();

test.describe("progress, history and review", () => {
  test.beforeEach(async ({ page }) => {
    await pair(page);
  });

  test("UI19 the concept tree is typed, follows the course's own catalog and never implies credit", async ({ page }, testInfo) => {
    await page.goto("/progress");
    const skill = page.getByTestId("skill-list").getByRole("listitem").filter({ hasText: "Explain what the origin of replication does" });
    await skill.getByRole("link", { name: "Related questions and concepts" }).click();
    await expect(page).toHaveURL(/concepts\/be505\.skill\.ori\.explain$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Explain what the origin of replication does");
    await expect(page.getByRole("heading", { name: "Recorded evidence for this skill" })).toBeVisible();

    // Edges keep their type and their source; a node reached twice is the same id, not a copy.
    const up = page.getByRole("region", { name: "concept is assessed as skill" });
    await expect(up.getByRole("heading")).toContainText("Reached from");
    await up.getByRole("link", { name: "Origin of replication" }).click();
    await expect(page.getByText("Concept be505.concept.origin-of-replication")).toBeVisible();
    await expect(page.getByRole("region", { name: "topic includes concept" })).toContainText("Source: question index.");
    await expect(page.getByText("Relations keep the owner's labels; none grants automatic credit.")).toBeVisible();
    await page.getByRole("region", { name: "topic includes concept" }).getByRole("link", { name: "Plasmid structure" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Plasmid structure" })).toBeVisible();
    await page.goBack();
    await expect(page.getByText("Concept be505.concept.origin-of-replication")).toBeVisible();
    await expectAccessible(page, testInfo, "concept");
    await expectNoHorizontalOverflow(page);
  });

  test("UI20 progress shows what responses showed, keeps counter-evidence, and separates priority from evidence", async ({ page, request }, testInfo) => {
    await page.goto("/progress");
    await expect(page.getByText("What your recorded responses showed — not a score.")).toBeVisible();
    const summary = page.getByRole("list", { name: "Evidence summary" });
    await expect(summary).toContainText(/\d+ recorded attempts/);
    await expect(summary).toContainText(/\d+ assessment corrections? \(not new attempts\)/); // corrections are counted apart from attempts
    await expect(page.getByText("No mastery percentage, forgetting curve or exam probability is computed.")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("%"); // no percentage of any kind on this page

    // The gap is described as an observation whose cause is not established, with counter-evidence kept beside it.
    await page.getByRole("combobox", { name: "Show", exact: true }).selectOption({ label: "Gap seen in latest response" });
    const gap = page.getByTestId("skill-list").getByRole("listitem").filter({ hasText: "Distinguish plasmid replication from gene transcription" });
    await expect(gap).toContainText("Gap seen in latest response");
    await expect(gap).toContainText("the cause is not established");
    await expect(gap).toContainText("corrected assessment in effect");
    await gap.getByRole("button", { name: "Show evidence and priority" }).click();
    await expect(gap.getByRole("region", { name: "Attempts" }).getByRole("link", { name: "Open the original attempt" }).first()).toBeVisible();
    const priority = gap.getByRole("region", { name: "Study priority" });
    await expect(priority).toContainText("a planning choice, separate from evidence");

    const before = (await (await request.get(`/api/courses/${COURSE}/progress`)).json()).recorded_attempts;
    await priority.getByRole("button", { name: "Note: defer" }).click();
    await expect(page.getByText("Saved as your note: defer. The course catalog, your record and any calendar are unchanged.")).toBeVisible();
    await settle(request);
    expect((await (await request.get(`/api/courses/${COURSE}/progress`)).json()).recorded_attempts, "a preference is not evidence").toBe(before);
    await expectAccessible(page, testInfo, "progress");
    await shot(page, testInfo, "progress");

    // A course with no attempts is "not assessed" — never zero, never failing.
    await page.getByLabel("Active course").selectOption("ds551");
    await expect(page.getByText("No attempt is recorded for this course. That is not a score of zero — nothing has been measured yet.")).toBeVisible();
    await page.getByLabel("Active course").selectOption(COURSE);
  });

  test("UI21 history shows the exact response, regrades as revisions of the same attempt, and conversations as delivered", async ({ page, request, unique }) => {
    // Independent of earlier tests: one hint request and one answered practice question from this device.
    await page.goto(`/courses/${COURSE}/questions/BE505-L01-Q02`);
    await page.getByRole("button", { name: "Request a hint" }).click();
    await expect(page.getByText("Hint used — recorded")).toBeVisible();
    const answer = unique("RNA polymerase binds the promoter and transcription of the downstream gene produces RNA.");
    await page.locator("#practice-answer").fill(answer);
    await page.getByTestId("submit-answer").click();
    await expect(page.getByTestId("request-card").filter({ hasText: answer }).getByTestId("feedback")).toBeVisible({ timeout: 20_000 });
    await settle(request);

    await page.goto("/history");
    await expect(page.getByText("Regrades are shown as revisions of the same attempt, never as new answers.")).toBeVisible();
    const attempts = page.getByRole("tabpanel", { name: /^Attempts/ });
    // Older course records only have an excerpt, and the page says so instead of reconstructing text.
    await expect(attempts.getByText("(excerpt only — the full text was not retained)").first()).toBeVisible();
    await expect(attempts.getByText("(full capture)").first()).toBeVisible(); // responses sent from this app are kept whole
    await expect(attempts.getByRole("listitem").filter({ hasText: answer })).toContainText("(full capture)");

    await attempts.getByLabel("Only attempts with corrections").check();
    await expect(attempts.getByRole("listitem").filter({ hasText: "the original assessment is kept" }).first()).toBeVisible();
    await attempts.getByLabel("Filter attempts").fill("l01-q03-assisted"); // the course's own earlier regrade
    const revised = attempts.getByRole("listitem").filter({ hasText: "the original assessment is kept" });
    await expect(revised).toHaveCount(1);
    await expect(revised).toContainText("Assessment in effect (after correction)");
    await revised.getByText("1 correction — the original assessment is kept").click();
    await expect(revised).toContainText(/Original: .*Not shown in this response|Original: /);
    await expect(revised).toContainText("(a regrade of the same response, not a new answer)");
    await expect(revised).toContainText("time of the response not known"); // an unknown time is not invented
    await attempts.getByLabel("Filter attempts").fill("");
    await attempts.getByLabel("Only attempts with corrections").uncheck();

    await page.getByRole("tab", { name: /^Conversations/ }).click();
    const conversations = page.getByRole("tabpanel", { name: /^Conversations/ });
    await expect(conversations.getByText(/^Your question/).first()).toBeVisible();
    await expect(conversations.getByText("Not assessed").first()).toBeVisible();
    await expect(conversations.getByText(/^Tutor reply \(as delivered\)/).first()).toBeVisible();
  });

  test("UI22 saving a question does not schedule it; an own question is saved as learner-authored and cannot be scheduled without a rubric", async ({ page, request, unique }, testInfo) => {
    const title = testInfo.project.name.includes("desktop") ? "What the promoter does" : "How induction works";
    await page.goto("/review");
    await expect(page.getByText("Saving an item does not schedule it; a due date is a suggestion, not evidence of forgetting.")).toBeVisible();
    const offer = available(page).getByRole("listitem").filter({ hasText: title });
    await offer.getByRole("button", { name: "Save only" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Sent: saved only. It will not get a due date." })).toBeVisible();
    await settle(request);
    await page.reload();
    const prompt = title === "What the promoter does" ? "Explain the role of the promoter." : "Explain how adding an inducer switches on an inducible promoter.";
    const row = items(page).getByRole("listitem").filter({ hasText: prompt });
    await expect(row).toContainText("Saved only (not scheduled)");
    await expect(row).toContainText("0 reviews done");
    await expect(row).not.toContainText("next suggested");
    await expect(available(page).getByRole("listitem").filter({ hasText: title })).toHaveCount(0); // offered once, not duplicated

    await page.getByRole("button", { name: "Create my own question" }).click();
    const dialog = page.getByRole("dialog", { name: "Create my own question" });
    await expect(dialog).toContainText("Without a reviewed rubric it can be saved, but not scheduled or graded.");
    const own = unique("Why does a low-copy origin reduce metabolic burden?");
    await dialog.getByLabel("Question (include any givens the answer needs)").fill(own);
    await dialog.getByRole("button", { name: "Save only" }).click();
    await sent(page, "Sent: saved only. It will not get a due date.");
    await settle(request);
    await page.reload();
    const mine = items(page).getByRole("listitem").filter({ hasText: own });
    await expect(mine).toContainText("your own question · version 1");
    await expect(mine.getByRole("button", { name: "Add to review" })).toBeDisabled();
    const view = await reviewView(request);
    expect(view.items.filter((i) => i.question.prompt === own && i.due_at === null && i.selection === "saved_only")).toHaveLength(1);
  });

  test("UI23 editing makes a new version; suspend, resume and remove keep every past response and review", async ({ page, request, unique }) => {
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto("/review");
    const own = unique("What does a selectable marker let me observe?");
    await page.getByRole("button", { name: "Create my own question" }).click();
    await page.getByRole("dialog").getByLabel("Question (include any givens the answer needs)").fill(own);
    await page.getByRole("dialog").getByRole("button", { name: "Save only" }).click();
    await sent(page, "Sent: saved only. It will not get a due date.");
    await settle(request);
    await page.reload();
    let mine = items(page).getByRole("listitem").filter({ hasText: own });
    await mine.getByRole("button", { name: "Edit my item" }).click();
    const edit = page.getByRole("dialog", { name: "Edit my question" });
    await expect(edit).toContainText("The earlier wording and its review history are kept.");
    const reworded = `${own} Give one limit.`;
    await edit.getByLabel("Question (include any givens the answer needs)").fill(reworded);
    await edit.getByRole("button", { name: "Save new version" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Earlier responses and review history stay as they are; no review was invented." })).toBeVisible();
    await settle(request);
    await page.reload();
    mine = items(page).getByRole("listitem").filter({ hasText: reworded });
    await expect(mine).toContainText("your own question · version 2");

    // A catalog question: add to review, suspend, resume, remove — each a visible state, none deleting history.
    const attemptsBefore = (await (await request.get(`/api/courses/${COURSE}/history`)).json()).attempts.length;
    const offer = available(page).getByRole("listitem").filter({ hasText: "What the origin does" });
    if (await offer.count()) {
      await offer.getByRole("button", { name: "Add to review" }).click();
      await sent(page, "Sent: added to review.");
      await settle(request);
      await page.reload();
    }
    const row = () => items(page).getByRole("listitem").filter({ hasText: "explain what the origin of replication does on a plasmid" });
    for (const [button, label] of [["Add to review", "In review"], ["Resume", "In review"]] as const) {
      if (await row().getByRole("button", { name: button, exact: true }).count()) {
        await row().getByRole("button", { name: button, exact: true }).click();
        await sent(page, "Change sent.");
        await settle(request);
        await page.reload();
      }
      await expect(row()).toContainText(label);
    }
    await row().getByRole("button", { name: "Suspend" }).click();
    await sent(page, "Change sent.");
    await settle(request);
    await page.reload();
    await expect(row()).toContainText("Suspended");
    await row().getByRole("button", { name: "Resume" }).click();
    await sent(page, "Change sent.");
    await settle(request);
    await page.reload();
    await expect(row()).toContainText("In review");
    await row().getByRole("button", { name: "Remove from review" }).click();
    await sent(page, "Change sent.");
    await settle(request);
    await page.reload();
    await expect(row()).toContainText("Removed from review");
    expect((await (await request.get(`/api/courses/${COURSE}/history`)).json()).attempts.length, "no attempt was removed or added").toBe(attemptsBefore);
  });

  test("UI24 a review session records only what was actually answered; a skip records nothing", async ({ page, request, unique }, testInfo) => {
    const title = testInfo.project.name.includes("desktop") ? "Selection plate interpretation" : "Replication is not transcription";
    await page.goto("/review");
    await expect(available(page).getByRole("heading")).toBeVisible();
    const offer = available(page).getByRole("listitem").filter({ hasText: title });
    if (await offer.count()) {
      await offer.getByRole("button", { name: "Add to review" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Sent: added to review." })).toBeVisible();
      await settle(request);
      await page.reload();
    }
    const dueBefore = (await reviewView(request)).items.filter((i) => i.is_due);
    expect(dueBefore.length, "at least one item is available to review").toBeGreaterThan(0);
    const target = dueBefore[0]!;

    // First sitting: skip. Nothing is recorded and the item stays available.
    await page.getByLabel("Session size").selectOption("1");
    await page.getByTestId("start-review").click();
    await expect(page.getByRole("heading", { name: "Review session" })).toBeVisible();
    await expect(page.getByTestId("review-prompt")).toHaveText(target.question.prompt);
    await expect(page.getByText("Skipping records nothing.")).toBeVisible();
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    const summary = page.getByTestId("review-summary");
    await expect(summary).toContainText("Answered0");
    await expect(summary).toContainText("Skipped (nothing recorded)1");
    await settle(request);
    const afterSkip = (await reviewView(request)).items.find((i) => i.item_id === target.item_id)!;
    expect(afterSkip.performed_reviews).toBe(target.performed_reviews);
    expect(afterSkip.is_due).toBe(true);

    // Second sitting: answer from memory. The response is captured, assessed and only then scheduled.
    await page.getByRole("link", { name: "Back to review" }).click();
    await page.getByLabel("Session size").selectOption("1");
    await page.getByTestId("start-review").click();
    const answer = unique("Growth shows the plasmid marker is present, not that the gene of interest is expressed; replication continues and the promoter is needed for RNA.");
    await page.locator("#review-answer").fill(answer);
    await page.getByTestId("submit-review").click();
    const card = page.getByTestId("request-card").filter({ hasText: answer });
    await expect(card.getByTestId("feedback")).toBeVisible({ timeout: 20_000 });
    await expect(card.getByTestId("feedback")).toContainText(/Review: (scheduled with rating|.+)/);
    await expect(card.getByTestId("feedback").getByRole("list", { name: "Save status" })).toContainText("Full response retained");
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(summary).toContainText("Answered1");
    await expect(page.getByText("A pending or uncertain grade is not treated as a wrong answer.")).toBeVisible();
    await settle(request);
    const afterAnswer = (await reviewView(request)).items.find((i) => i.item_id === target.item_id)!;
    expect(afterAnswer.performed_reviews, "exactly one review was performed").toBe(target.performed_reviews + 1);
  });

  test("UI31 the session summary reports only what happened: answers requested are not assessments, and nothing is scheduled by itself", async ({ page, request, unique }) => {
    await page.goto(`/courses/${COURSE}/lectures/lecture-02?page=2`);
    await expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", "2");
    if (isNarrow(page)) await page.getByRole("tab", { name: "Tutor", exact: true }).click();
    const question = unique("Why measure the uninduced baseline?");
    await page.locator("#tutor-composer").fill(question);
    await page.getByTestId("send").click();
    await expect(page.getByTestId("request-card").filter({ hasText: question }).getByTestId("tutor-reply")).toBeVisible({ timeout: 20_000 });
    const reviewBefore = (await reviewView(request)).items.length;

    await page.getByRole("button", { name: "Finish session" }).click();
    await expect(page).toHaveURL(/\/study\/sessions\/session-[^/]+\/summary/);
    await expect(page.getByRole("heading", { name: "Session summary" })).toBeVisible();
    const counts = page.getByTestId("wrapup-counts");
    await expect(counts).toContainText("Answers requested1");
    await expect(counts).toContainText("Responses you submitted0");
    await expect(counts).toContainText("Assessed and saved0");
    await expect(page.getByRole("note").filter({ hasText: "Understanding was not assessed in this session" })).toContainText("no result — and no failure — was recorded");
    await expect(page.getByTestId("wrapup-row").filter({ hasText: question })).toContainText("Answer received — not assessed in this exchange");

    // The stopping point is the Brain's verified checkpoint, not a guess.
    const where = page.getByRole("region", { name: "Where you stopped" });
    await expect(where).toContainText(/Slide 2 of lecture-02 .*synchronised/, { timeout: 20_000 });
    await expect(page.getByTestId("pending-none")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Time spent and slides viewed are observations only; they are never treated as evidence of knowledge.")).toBeVisible();

    await page.getByRole("link", { name: "Done" }).click();
    await expect(page).toHaveURL(/\/study$/);
    await settle(request);
    expect((await reviewView(request)).items.length, "leaving with Done schedules nothing").toBe(reviewBefore);
    // Study home now offers the synchronised position (not a model-written recap), still paused.
    const resume = page.getByRole("link", { name: /^Continue: lecture 02, slide 2/ });
    await expect(resume).toContainText("paused");
    await resume.click();
    await expect(page.getByTestId("slide-position")).toHaveText("Slide 2 of 3");
    await expect(page.getByTestId("lecture-media")).toHaveJSProperty("paused", true);
  });
});
