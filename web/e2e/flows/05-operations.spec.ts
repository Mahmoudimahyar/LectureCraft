// UI25–UI27, UI29, UI30, UI32: what the learner sees when things are slow, uncertain, offline or
// need a decision — and the operator-side settings, export, cleanup and repair screens.
// Failure modes are injected only through the labeled fixture tutor or the browser's own network layer.
import type { Locator, Page } from "@playwright/test";
import { COURSE, expectAccessible, expectNoHorizontalOverflow, isNarrow, pair, setFixtureMode, settle, shot } from "../helpers";
import { expect, test } from "../fixtures";

const L2 = `/courses/${COURSE}/lectures/lecture-02`;

async function ask(page: Page, text: string, slide = 3): Promise<Locator> {
  await page.goto(`${L2}?page=${slide}`);
  await expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", String(slide));
  if (isNarrow(page)) await page.getByRole("tab", { name: "Tutor", exact: true }).click();
  await page.locator("#tutor-composer").fill(text);
  await page.getByTestId("send").click();
  return page.getByTestId("request-card").filter({ hasText: text });
}

interface Job { request_id: string | null; action: string; state: string; dispatches: number; updated_at: number; phases: Record<string, string> }
const jobsOf = async (request: Parameters<typeof settle>[0]): Promise<Job[]> => (await (await request.get("/api/activity")).json()).jobs;

test.describe("operations and recovery", () => {
  test.afterEach(async ({ request }) => {
    await setFixtureMode(request, "normal");
    await request.post("/api/supervisor/resume");
  });

  test("UI25 an unknown completion is checked against receipts, never blindly re-sent", async ({ page, request, unique }) => {
    await pair(page);
    await setFixtureMode(request, "completion_unknown");
    const question = unique("Does a strong promoter always help?");
    const card = await ask(page, question);
    await expect(card.getByRole("list", { name: "Request status" })).toContainText("Completion unknown", { timeout: 20_000 });
    await expect(card.getByRole("list", { name: "Request status" })).toContainText("Your input: captured");
    await expect(card.getByTestId("tutor-reply")).toHaveCount(0); // nothing is shown as an answer yet
    const requestId = (await card.getAttribute("data-request-id"))!;

    // The request has its own page: each phase is a separate fact.
    await card.getByRole("link", { name: "Details" }).click();
    await expect(page).toHaveURL(new RegExp(`/activity/${requestId}$`));
    const phases = page.getByRole("region", { name: "Where it stands" });
    await expect(phases).toContainText("Captured on the Brain");
    await expect(phases).toContainText("Completion unknown");
    await page.goBack();

    await setFixtureMode(request, "normal");
    await card.getByRole("button", { name: "Check status" }).click();
    await expect(card.getByRole("status")).toContainText("Nothing was re-sent.");
    await expect(card.getByTestId("tutor-reply")).toContainText("Short version", { timeout: 20_000 });
    const job = (await jobsOf(request)).find((j) => j.request_id === requestId)!;
    expect(job.state).toBe("SUCCEEDED");
    expect(job.dispatches, "the original dispatch was reconciled, not repeated").toBe(1);
  });

  test("UI25 cancelling a queued request is final only when the Brain confirms, and the input is kept", async ({ page, request, unique }) => {
    await pair(page);
    await request.post("/api/supervisor/pause");
    const question = unique("Cancel me before I start");
    const card = await ask(page, question);
    await expect(card.getByRole("list", { name: "Request status" })).toContainText("Queued", { timeout: 20_000 });
    const requestId = (await card.getAttribute("data-request-id"))!;
    await card.getByRole("button", { name: "Cancel" }).click();
    await expect(card.getByRole("status")).toContainText("It is not final until the Brain confirms; your input is kept.");
    await request.post("/api/supervisor/resume");
    await expect(card.getByRole("list", { name: "Request status" })).toContainText("Cancelled", { timeout: 20_000 });
    await expect(card.getByTestId("learner-text")).toHaveText(question);
    await expect(card.getByTestId("tutor-reply")).toHaveCount(0);
    await settle(request);
    const job = (await jobsOf(request)).find((j) => j.request_id === requestId)!;
    expect(job.state).toBe("CANCELLED");
    expect(job.dispatches, "a request cancelled before it started never reaches the tutor").toBe(0);

    await page.goto("/activity");
    await page.getByLabel("Which requests to show").selectOption("all");
    const row = page.getByTestId("activity-job").filter({ has: page.locator(`a[href="/activity/${requestId}"]`) });
    await expect(row).toHaveAttribute("data-state", "CANCELLED");
    await expect(row).toContainText("Received by Brain"); // the admitted bundle with the learner's text is retained
    await expect(row).toContainText("Native turnCancelled");
  });

  test("UI26 two devices that stopped in different places produce a choice, not a silent overwrite; both drafts are kept", async ({ page, browser, request }, testInfo) => {
    // Device A and device B each load the lecture, so both hold the same earlier position.
    await pair(page);
    const dispatchesBefore = (await (await request.get("/api/activity")).json()).counts.dispatches;
    const contextB = await browser.newContext({ viewport: page.viewportSize()!, colorScheme: testInfo.project.use.colorScheme });
    const pageB = await contextB.newPage();
    await pair(pageB);
    const open = async (p: Page, slide: number, draft: string) => {
      await p.goto(`${L2}?page=${slide}`);
      await expect(p.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", String(slide));
      if (isNarrow(p)) await p.getByRole("tab", { name: "Tutor", exact: true }).click();
      await p.locator("#tutor-composer").fill(draft);
      await expect(p.getByText("Draft saved on this device")).toBeVisible();
    };
    await open(page, 1, "Draft from device A about induction timing");
    await open(pageB, 3, "Draft from device B about copy number");

    await page.getByRole("button", { name: "Finish session" }).click();
    await expect(page.getByRole("heading", { name: "Session summary" })).toBeVisible();
    await settle(request);
    await pageB.getByRole("button", { name: "Finish session" }).click(); // B never saw A's checkpoint
    await expect(pageB.getByRole("heading", { name: "Session summary" })).toBeVisible();
    await settle(request);

    await page.goto("/study");
    const card = page.getByRole("listitem").filter({ hasText: "be505" });
    await expect(card.getByText("Two study positions need your choice")).toBeVisible();
    await expect(card).toContainText("Both drafts are kept; nothing was merged or overwritten.");
    await card.getByRole("link", { name: "Compare and choose" }).click();
    await expect(page.getByRole("heading", { name: "Two study positions" })).toBeVisible();
    const heads = page.getByTestId("resume-head");
    await expect(heads).toHaveCount(2);
    await expect(heads.filter({ hasText: "Draft from device A about induction timing" })).toHaveCount(1);
    await expect(heads.filter({ hasText: "Draft from device B about copy number" })).toHaveCount(1);
    await expect(page.getByText("The draft you do not choose is kept as a separate draft; nothing is merged, overwritten or sent.")).toBeVisible();

    await heads.filter({ hasText: "Draft from device B about copy number" }).getByRole("button", { name: "Continue from this one" }).click();
    await expect(page).toHaveURL(/lectures\/lecture-02\?page=3/);
    await expect(page.getByTestId("slide-position")).toHaveText("Slide 3 of 3");
    await expect(page.getByTestId("lecture-media")).toHaveJSProperty("paused", true);
    const resume = await (await request.get(`/api/courses/${COURSE}/resume`)).json();
    expect(resume.conflict, "the conflict is resolved by an explicit choice").toBeNull();
    // Neither draft was sent to the tutor: resolving a position dispatches nothing.
    expect((await (await request.get("/api/activity")).json()).counts.dispatches).toBe(dispatchesBefore);
    await contextB.close();
  });

  test("UI27 when the Brain cannot be reached the signed request is kept on the device and sent later — once", async ({ page, request, unique, problems }) => {
    problems.allow(/Failed to load resource|ERR_FAILED|net::/);
    await pair(page);
    await page.route("**/api/transport/**", (route) => route.abort("connectionfailed"));
    const question = unique("Kept while the Brain is unreachable");
    const card = await ask(page, question);
    await expect(page.getByTestId("tutor-panel").getByRole("alert")).toContainText("Kept on this device and will be sent when the Brain is reachable.");
    const status = card.getByRole("list", { name: "Request status" });
    await expect(status).toContainText("Your input: kept on this device");
    await expect(status).toContainText("Kept on this device · not sent yet");
    await expect(status).not.toContainText("Received by Brain");
    const requestId = (await card.getAttribute("data-request-id"))!;
    expect((await jobsOf(request)).some((j) => j.request_id === requestId), "the Brain has not seen it").toBe(false);
    // Reading keeps working while sending does not.
    if (isNarrow(page)) await page.getByRole("tab", { name: "Slide", exact: true }).click();
    await expect(page.getByTestId("slide-canvas")).toBeVisible();

    // While the Brain is still unreachable the request stays held, visibly, with a manual "Send now".
    await page.goto("/activity");
    const outbox = page.getByRole("region", { name: /^Kept on this device, not sent yet \(1\)/ });
    await expect(outbox).toBeVisible();
    await page.unroute("**/api/transport/**");
    await outbox.getByRole("button", { name: "Send now" }).click();
    await expect(page.getByRole("status").filter({ hasText: "They count as received only once the Brain admits them." })).toBeVisible();
    await settle(request);
    const jobs = (await jobsOf(request)).filter((j) => j.request_id === requestId);
    expect(jobs, "delivered exactly once").toHaveLength(1);
    expect(jobs[0]!.state).toBe("SUCCEEDED");
    await expect(page.getByRole("region", { name: /^Kept on this device, not sent yet/ })).toHaveCount(0);
  });

  test("UI27 a request kept on the device is sent by itself the next time the app is open and the Brain is reachable", async ({ page, request, unique, problems }) => {
    problems.allow(/Failed to load resource|ERR_FAILED|net::/);
    await pair(page);
    await page.route("**/api/transport/**", (route) => route.abort("connectionfailed"));
    const question = unique("Sent automatically after the Brain came back");
    const card = await ask(page, question);
    await expect(card.getByRole("list", { name: "Request status" })).toContainText("Kept on this device · not sent yet");
    const requestId = (await card.getAttribute("data-request-id"))!;
    await page.unroute("**/api/transport/**");

    await page.reload(); // "the next time the app is open": no button is pressed
    await expect.poll(async () => (await jobsOf(request)).filter((j) => j.request_id === requestId).length, { timeout: 20_000 }).toBe(1);
    await settle(request);
    const jobs = (await jobsOf(request)).filter((j) => j.request_id === requestId);
    expect(jobs, "delivered exactly once").toHaveLength(1);
    expect(jobs[0]!.state).toBe("SUCCEEDED");
    if (isNarrow(page)) await page.getByRole("tab", { name: "Tutor", exact: true }).click();
    const after = page.getByTestId("request-card").filter({ hasText: question });
    await expect(after.getByRole("list", { name: "Request status" })).toContainText("Received by Brain", { timeout: 20_000 });
    await expect(after.getByTestId("tutor-reply")).toBeVisible({ timeout: 20_000 });
    await page.goto("/activity");
    await expect(page.getByRole("region", { name: /^Kept on this device, not sent yet/ })).toHaveCount(0);
  });

  test("UI27 quota and sign-in pauses are named states; nothing is substituted, other work continues, retry is deliberate", async ({ page, request, unique }) => {
    await pair(page);
    await setFixtureMode(request, "quota_wait");
    const question = unique("Asked while the tutor has no quota");
    const card = await ask(page, question, 2);
    const status = card.getByRole("list", { name: "Request status" });
    await expect(status).toContainText("Quota wait", { timeout: 20_000 });
    await expect(status).toContainText("Your input: captured");
    await expect(card.getByTestId("tutor-reply")).toHaveCount(0);
    const requestId = (await card.getAttribute("data-request-id"))!;

    // A note needs no tutor turn, so it is not stuck behind the waiting question.
    if (isNarrow(page)) await page.getByRole("tab", { name: "Slide", exact: true }).click();
    await page.getByRole("button", { name: "Save note" }).click();
    const note = unique("note written during the quota wait");
    await page.getByRole("dialog").getByLabel("Note").fill(note);
    await page.getByRole("dialog").getByRole("button", { name: "Save note" }).click();
    await expect.poll(async () => (await jobsOf(request)).filter((j) => j.action === "save_note").sort((a, b) => b.updated_at - a.updated_at)[0]?.state, { timeout: 20_000 }).toBe("SUCCEEDED");
    expect((await jobsOf(request)).find((j) => j.request_id === requestId)!.state).toBe("QUOTA_WAIT");

    await setFixtureMode(request, "auth_required");
    const second = unique("Asked while sign-in is required");
    if (isNarrow(page)) await page.getByRole("tab", { name: "Tutor", exact: true }).click();
    await page.locator("#tutor-composer").fill(second);
    await page.getByTestId("send").click();
    const authCard = page.getByTestId("request-card").filter({ hasText: second });
    await expect(authCard.getByRole("list", { name: "Request status" })).toContainText("Connection not verified", { timeout: 20_000 });
    await expect(authCard.getByTestId("tutor-reply")).toHaveCount(0);

    await setFixtureMode(request, "normal");
    await card.getByRole("button", { name: "Retry deliberately" }).click();
    await expect(card.getByRole("status")).toContainText("Queued again as a new dispatch of the same input.");
    await expect(card.getByTestId("tutor-reply")).toContainText("Short version", { timeout: 20_000 });
    await authCard.getByRole("button", { name: "Retry deliberately" }).click();
    await expect(authCard.getByTestId("tutor-reply")).toBeVisible({ timeout: 20_000 });
  });

  test("UI29 settings state what is installed, configured and verified; limits are fixed and pausing never cancels", async ({ page, request, unique }, testInfo) => {
    await pair(page);
    await page.goto("/settings/ai");
    const native = page.getByRole("region", { name: "Native tutor connection" });
    await expect(native).toContainText("Fixture tutor (labeled test double)");
    await expect(native).toContainText("nothing else is ever substituted");
    await expect(native).toContainText("Last proof");
    await expect(native).toContainText("none recorded");
    await expect(native).toContainText("This screen cannot grant permissions, install or restart anything, or copy credentials.");
    // Tools this PC lacks are stated with the fallback that still works; nothing is claimed as supported.
    const tools = native.getByLabel("Optional tools on this PC");
    await expect(tools).toContainText("Automatic transcription not available");
    await expect(tools).toContainText("you type or correct the transcript yourself");
    await expect(tools).toContainText(/PowerPoint decks (cannot be shown yet|can be shown as PDF renditions)/);
    const dispatchesBefore = (await (await request.get("/api/activity")).json()).counts.dispatches;
    await native.getByRole("button", { name: "Inspect (sends nothing)" }).click();
    await expect(page.getByTestId("probe-result")).toContainText(/Inspection: /);
    expect((await (await request.get("/api/activity")).json()).counts.dispatches, "inspecting sends nothing").toBe(dispatchesBefore);
    const threads = page.getByRole("region", { name: "Course threads" });
    await expect(threads.getByRole("listitem")).toHaveCount(5);
    await expect(threads).toContainText("'latest thread' is never used");
    await expect(page.getByTestId("fixture-mode")).toHaveValue("normal");
    await expectAccessible(page, testInfo, "settings-ai");

    await page.goto("/settings/limits");
    const limits = page.getByRole("region", { name: "Operating limits" });
    await expect(limits).toContainText("$0 — no metered route exists in this app");
    await expect(limits).toContainText("then the outcome is treated as unknown and checked — not re-sent");
    await expect(limits.getByRole("textbox")).toHaveCount(0); // a request or a web page cannot raise a limit
    const processing = page.getByRole("region", { name: "Processing" });
    await expect(processing).toContainText("Running");
    await page.getByTestId("pause-toggle").click();
    await expect(processing).toContainText("Paused");

    const question = unique("Sent while processing is paused");
    const card = await ask(page, question, 1);
    await expect(card.getByRole("list", { name: "Request status" })).toContainText("Received by Brain", { timeout: 20_000 });
    await expect(card.getByRole("list", { name: "Request status" })).toContainText("Queued");
    await page.goto("/activity");
    await expect(page.getByText("Processing is paused")).toBeVisible();
    await page.goto("/settings/limits");
    await page.getByTestId("pause-toggle").click();
    await expect(processing).toContainText("Running");
    await settle(request);
    const job = (await jobsOf(request)).filter((j) => j.action === "ask").sort((a, b) => b.updated_at - a.updated_at)[0]!;
    expect(job.state, "the paused request was kept and completed after resume").toBe("SUCCEEDED");
    await expectNoHorizontalOverflow(page);
  });

  test("UI30 export and cleanup are previewed, scoped and honest about what they do not touch", async ({ page, request }, testInfo) => {
    page.on("dialog", (dialog) => void dialog.accept());
    await pair(page);
    await page.goto("/settings/data");
    const exportSection = page.getByRole("region", { name: "Export" });
    await expect(exportSection.getByRole("button", { name: "Build export" })).toBeDisabled(); // preview first
    await exportSection.getByRole("button", { name: "Preview export" }).click();
    const preview = page.getByTestId("export-preview");
    await expect(preview).toContainText(/Would include \d+ file\(s\)/);
    await expect(preview).toContainText("Left out:");
    await exportSection.getByRole("button", { name: "Build export" }).click();
    await expect(exportSection.getByRole("status")).toContainText("with an integrity manifest");
    await expect(exportSection.getByRole("status")).toContainText(/exports/);

    await expect(page.getByRole("region", { name: "What is kept, and for how long" }).getByRole("listitem").first()).toBeVisible();

    const cleanup = page.getByRole("region", { name: "Clean up local app data" });
    await expect(cleanup.getByRole("button", { name: "Remove the previewed items" })).toBeDisabled();
    await cleanup.getByRole("button", { name: "Preview cleanup" }).click();
    const cleanupPreview = page.getByTestId("cleanup-preview");
    await expect(cleanupPreview).toContainText(/Can be removed \(\d+\)/);
    await expect(cleanupPreview).toContainText(/Protected \(\d+\)/);
    await expect(cleanupPreview).toContainText("Outside this app's reach:");
    await expect(cleanup).toContainText('There is no "delete everything" button');
    await expect(cleanup).toContainText("This app does not claim to erase copies held by a provider or on other devices.");
    const removable = cleanup.getByRole("button", { name: "Remove the previewed items" });
    if (await removable.isEnabled()) {
      await removable.click();
      await expect(cleanup.getByRole("status")).toContainText(/Removed \d+ item\(s\); \d+ protected item\(s\) untouched\./);
      // Removing rebuildable data never leaves a silent gap: the rebuild is queued and slide text comes back.
      await expect(cleanup.getByRole("status")).toContainText("Preparation was queued again");
      await settle(request);
      const index = await (await request.get(`/api/courses/${COURSE}/search-index`)).json();
      expect((index.entries as Array<{ type: string }>).some((e) => e.type === "slide"), "slide text is searchable again").toBe(true);
    }
    await expectAccessible(page, testInfo, "settings-data");
    await shot(page, testInfo, "settings-data");
  });

  test("UI32 a repair is previewed with its exact scope, approved once, and reports a receipt; unsafe repairs are refused", async ({ page, request, unique }, testInfo) => {
    await pair(page);
    // Independent of earlier tests: one saved attempt makes the course's own summary view stale.
    await page.goto(`/courses/${COURSE}/questions/BE505-L01-Q02`);
    const answer = unique("RNA polymerase binds the promoter and transcription of the downstream gene produces RNA.");
    await page.locator("#practice-answer").fill(answer);
    await page.getByTestId("submit-answer").click();
    await expect(page.getByTestId("request-card").filter({ hasText: answer }).getByTestId("feedback").getByRole("list", { name: "Save status" })).toContainText("Saved to course", { timeout: 20_000 });
    await settle(request);

    await setFixtureMode(request, "completion_unknown");
    const question = unique("Leave me uncertain for the repair screen");
    const card = await ask(page, question, 1);
    await expect(card.getByRole("list", { name: "Request status" })).toContainText("Completion unknown", { timeout: 20_000 });
    const requestId = (await card.getAttribute("data-request-id"))!;
    await setFixtureMode(request, "normal");

    await page.goto("/settings/maintenance");
    const issues = page.getByTestId("issue-list");
    const uncertain = issues.getByRole("listitem").filter({ hasText: requestId });
    await expect(uncertain).toContainText("uncertain native outcome");
    // The owner's stale summary view is listed, but this app does not rewrite another owner's file.
    const stale = issues.getByRole("listitem").filter({ hasText: "generated learning-state view is stale" }).first();
    await stale.getByRole("link").click();
    await expect(page.getByTestId("repair-preview")).toContainText("Not something this app does");
    await expect(page.getByRole("button", { name: "Approve this repair only" })).toHaveCount(0);
    await page.getByRole("link", { name: "← Maintenance" }).click();

    await uncertain.getByRole("link", { name: "Preview the repair" }).click();
    const preview = page.getByTestId("repair-preview");
    for (const term of ["Operation", "Reads", "Would write", "Stays unchanged"]) await expect(preview.getByText(term, { exact: true })).toBeVisible();
    await expectAccessible(page, testInfo, "repair-preview");
    await preview.getByRole("button", { name: "Approve this repair only" }).click();
    await expect(preview.getByRole("status")).toContainText("Nothing else was changed.");
    await expect(preview.getByRole("button", { name: "Approve this repair only" })).toHaveCount(0); // one approval, one run
    await page.waitForTimeout(1500);
    await expect(preview.getByRole("status"), "the receipt stays on screen").toContainText("Repair receipt");
    await settle(request);
    const job = (await jobsOf(request)).find((j) => j.request_id === requestId)!;
    expect(job.state).toBe("SUCCEEDED");
    expect(job.dispatches, "repair reconciled the existing turn; it did not send another").toBe(1);

    // The whole-product readiness report stays fail-closed: fixtures and local tests cannot make it pass.
    await page.goto("/settings/maintenance");
    await page.getByRole("button", { name: "Run readiness report" }).click();
    const acceptance = page.getByTestId("acceptance");
    await expect(acceptance).toContainText(/Result: (?!READY$)/);
    await expect(acceptance).not.toContainText("Result: READY");
    await shot(page, testInfo, "maintenance");
  });
});
