// UI06–UI10, UI18: the source-first lecture workspace — slide, recording segment, transcript,
// linked material, link correction and notes. Uses the synthetic BE 505 course.
import type { Page } from "@playwright/test";
import { COURSE, expectAccessible, expectNoHorizontalOverflow, isNarrow, pair, settle, shot } from "../helpers";
import { expect, test } from "../fixtures";

const L1 = `/courses/${COURSE}/lectures/lecture-01`;
const L2 = `/courses/${COURSE}/lectures/lecture-02`;

/** Show a pane: a context-panel tab on wide screens, a single-pane tab on narrow ones. */
async function pane(page: Page, name: "Slide" | "Tutor" | "Transcript" | "Sources"): Promise<void> {
  if (name === "Slide" && !isNarrow(page)) return; // the slide is always visible on wide layouts
  await page.getByRole("tab", { name, exact: true }).click();
}

const media = (page: Page) => page.getByTestId("lecture-media");
const currentTime = (page: Page) => media(page).evaluate((m: HTMLMediaElement) => m.currentTime);

test.describe("lecture workspace", () => {
  test.beforeEach(async ({ page }) => {
    await pair(page);
  });

  test("UI06 the slide is the original, navigable by button and keyboard, zoomable, with a labeled text alternative", async ({ page }, testInfo) => {
    await page.goto(L1);
    await expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", "1");
    await expect(page.getByRole("img", { name: /Slide 1 of 4: Anatomy of an expression plasmid — original source, colours unchanged/ })).toBeVisible();
    await expect(page.getByText(/deck version v1-[0-9a-f]{12}/)).toBeVisible();

    await page.getByRole("button", { name: "Next slide" }).click();
    await expect(page.getByTestId("slide-position")).toHaveText("Slide 2 of 4");
    await expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", "2");
    await page.locator("body").press("ArrowRight");
    await expect(page.getByTestId("slide-position")).toHaveText("Slide 3 of 4");
    await page.locator("body").press("ArrowLeft");
    await expect(page.getByTestId("slide-position")).toHaveText("Slide 2 of 4");
    await page.goBack(); // each slide change is a real history entry
    await expect(page.getByTestId("slide-position")).toHaveText("Slide 3 of 4");
    await page.goBack();
    await expect(page.getByTestId("slide-position")).toHaveText("Slide 2 of 4");

    // Zoom is contained in the slide frame: the page itself never scrolls sideways.
    const width = () => page.getByTestId("slide-canvas").evaluate((c: HTMLCanvasElement) => c.getBoundingClientRect().width);
    const fit = await width();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(page.getByText("125% of fit width")).toBeVisible();
    await expect.poll(width).toBeGreaterThan(fit * 1.2);
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "Fit width" }).click();
    await expect(page.getByText("100% of fit width")).toBeVisible();

    // The readable text is a separate, labeled derivative — never a replacement for the original.
    await page.getByRole("button", { name: "Show readable text" }).click();
    const readable = page.getByLabel("Readable text rendition");
    await expect(readable).toContainText("Derived text rendition — not the original");
    await expect(readable).toContainText("Origin of replication");

    if (!isNarrow(page)) {
      const navigator = page.getByRole("complementary", { name: "Slide navigator" });
      await navigator.getByLabel("Find a slide").fill("marker");
      await expect(navigator.getByRole("listitem")).not.toHaveCount(4); // filtered by title and slide text
      await navigator.getByRole("button", { name: "Slide 4: Selectable marker" }).click();
      await expect(page.getByTestId("slide-position")).toHaveText("Slide 4 of 4");
      await expect(page.getByRole("button", { name: "Next slide" })).toBeDisabled();
      await page.getByRole("button", { name: "Focus on the slide" }).click();
      await expect(page.getByRole("banner")).toBeHidden();
      await expect(page.getByTestId("slide-canvas")).toBeVisible();
      await page.getByRole("button", { name: "Exit focus" }).click();
      await expect(page.getByRole("banner")).toBeVisible();
    }
    await expectAccessible(page, testInfo, "lecture");
    await shot(page, testInfo, "lecture-slide");
  });

  test("UI06 a lecture with slides but no linked recording stays studyable and says exactly what is missing", async ({ page }) => {
    await page.goto(`/courses/${COURSE}/lectures/lecture-03`);
    await expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", "1");
    await expect(page.getByText(/link no recorded session to these slides/)).toBeVisible();
    await pane(page, "Transcript");
    await expect(page.getByText("No transcript is linked to this lecture")).toBeVisible();
  });

  test("UI07 the recording plays only this slide's segment, never autoplays, and stops at the segment end", async ({ page }) => {
    await page.goto(`${L1}?page=3`);
    await expect(page.getByTestId("clip-label")).toContainText("0:30 – 0:45");
    await expect(page.getByTestId("clip-player")).toContainText("Shown during · Reviewed link");
    expect(await media(page).evaluate((m: HTMLMediaElement) => m.paused), "no autoplay").toBe(true);

    // Jump near the end of the segment and play: it must stop at 0:45 instead of running into the next slide.
    await page.getByTestId("clip-scrubber").fill("44000");
    await page.getByLabel("Playback speed").selectOption("2");
    await page.getByTestId("play-toggle").click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Play this slide's segment" })).toBeVisible({ timeout: 8_000 });
    const stopped = await currentTime(page);
    expect(stopped).toBeGreaterThanOrEqual(44.9);
    expect(stopped).toBeLessThanOrEqual(45.3);
    await expect(page.getByTestId("announcer")).toHaveText("End of this slide's segment. Playback stopped.");

    // Seeking is clamped to the segment; the whole recording is a deliberate choice.
    await page.getByRole("button", { name: "Back 10 seconds" }).click();
    await page.getByRole("button", { name: "Back 10 seconds" }).click();
    expect(await currentTime(page)).toBeCloseTo(30, 0);
    await page.getByLabel("Which part of the recording to play").selectOption("whole");
    await expect(page.getByTestId("clip-label")).toContainText("0:00 – 1:00");

    // Changing slide pauses and selects the new slide's own segment — without starting it.
    await page.getByTestId("play-toggle").click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await page.getByRole("button", { name: "Previous slide" }).click();
    await expect(page.getByTestId("slide-position")).toHaveText("Slide 2 of 4");
    await expect(page.getByTestId("clip-label")).toContainText("0:15 – 0:30");
    expect(await media(page).evaluate((m: HTMLMediaElement) => m.paused)).toBe(true);

    // A slide the lecturer returned to offers each occurrence separately.
    const part = page.getByLabel("Which part of the recording to play");
    await expect(part.getByRole("option")).toHaveCount(3);
    await part.selectOption({ label: "Occurrence 2: 0:55–1:00 (reviewed)" });
    await expect(page.getByTestId("clip-label")).toContainText("0:55 – 1:00");
  });

  test("UI07 a suggested (unreviewed) link is labeled as a suggestion, not presented as fact", async ({ page }) => {
    await page.goto(`${L2}?page=3`);
    const player = page.getByTestId("clip-player");
    const reviewed = await player.getByText("Reviewed link").isVisible().catch(() => false);
    if (!reviewed) {
      await expect(player).toContainText("Suggested link (not reviewed)");
      await expect(page.getByLabel("Which part of the recording to play").getByRole("option").first()).toContainText("(suggested)");
    }
    await expect(page.getByText(/Some links on this lecture are suggestions|Alignment:/)).toBeVisible();
  });

  test("UI08 transcript: version shown, search, jump to the recording, and quote exact lines into a question", async ({ page }) => {
    await page.goto(`${L1}?page=3`);
    await pane(page, "Transcript");
    const lines = page.getByTestId("transcript-lines");
    await expect(page.getByText(/Fixture Lec 1 Sep 3\.txt · 24 lines · version v1-[0-9a-f]{12}/)).toBeVisible();
    await expect(lines.getByRole("listitem")).toHaveCount(24);

    await page.getByLabel("Search this transcript").fill("promoter");
    await expect(page.getByRole("status").filter({ hasText: /matching line/ })).toBeVisible();
    expect(await lines.getByRole("listitem").count()).toBeLessThan(24);
    await page.getByLabel("Search this transcript").fill("");

    // Timestamps come from reviewed links; a click seeks the recording without starting it.
    await lines.getByRole("listitem").nth(12).getByRole("button", { name: /Go to 0:30 in the recording \(reviewed timing\)/ }).click();
    expect(await currentTime(page)).toBeCloseTo(30, 0);
    expect(await media(page).evaluate((m: HTMLMediaElement) => m.paused)).toBe(true);

    await lines.getByRole("button", { name: "Select line 13", exact: true }).click();
    await lines.getByRole("button", { name: "Select line 14", exact: true }).click({ modifiers: ["Shift"] });
    const selected = page.getByRole("group", { name: "Selected transcript lines" });
    await expect(selected).toContainText("Lines 13–14 selected");
    await selected.getByRole("button", { name: "Ask about this" }).click();
    // The quote travels as an exact line reference attached to the next message.
    await expect(page.getByLabel("Context sent with your message")).toContainText("Transcript lines 13–14");
    await expect(page.getByTestId("announcer")).toContainText("Quoted transcript lines attached");
    await page.getByRole("button", { name: "Remove Transcript lines 13–14" }).click();
    await expect(page.getByLabel("Context sent with your message")).not.toContainText("Transcript lines");
  });

  test("UI09 linked material says why it is linked and how precisely; restricted solutions stay closed until revealed", async ({ page }) => {
    await page.goto(`${L1}?page=2`);
    await pane(page, "Sources");
    const related = page.getByRole("region", { name: "Connected material" });
    // A chapter-level relation is not dressed up as an exact page.
    await expect(related.getByRole("listitem")).toContainText("chapter-level reference — no exact page has been reviewed");
    await expect(related.getByRole("listitem")).toContainText("Suggested link (not reviewed)");
    await expect(page.getByRole("region", { name: "Questions on this slide" }).getByRole("link")).toHaveCount(2);

    await page.goto(`${L1}?page=3`);
    await pane(page, "Sources");
    const exact = page.getByRole("region", { name: "Connected material" }).getByRole("listitem");
    await expect(exact).toContainText("Reviewed link");
    await expect(exact).toContainText(/location: .*34/);
    await exact.getByRole("link", { name: "Open" }).click();
    await expect(page).toHaveURL(/\/sources\/.+\?page=2/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Fixture Textbook.pdf");
    await expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", "2");
    await page.getByRole("link", { name: "← Return to slide" }).click();
    await expect(page.getByTestId("slide-position")).toHaveText("Slide 3 of 4");

    // Answer material is never shown just because it exists.
    await page.goto(`/courses/${COURSE}/sources/src-ps-01-solutions`);
    await expect(page.getByText(/answer material/i).first()).toBeVisible();
    await expect(page.getByTestId("slide-canvas")).toHaveCount(0);
    await page.getByRole("button", { name: /Reveal/ }).click();
    await expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", "1");
  });

  test("UI10 correcting a link validates the range, keeps history as revisions and reports the real save state", async ({ page, request }, testInfo) => {
    const desktop = testInfo.project.name.includes("desktop");
    const [start, end, label] = desktop ? ["1", "11", "0:01 – 0:11"] : ["2", "12", "0:02 – 0:12"];
    await page.goto(`${L2}?page=1`);
    await page.getByRole("button", { name: "Edit match" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit match" });
    await expect(dialog).toContainText("the previous one is kept");
    const revisionBefore = Number((await dialog.getByText(/revision \d+/).first().textContent())!.match(/revision (\d+)/)![1]);

    // Typed times, no dragging; impossible ranges are refused before anything is sent.
    await dialog.getByLabel("Start (seconds)").fill("20");
    await dialog.getByLabel("End (seconds)").fill("10");
    await expect(dialog.getByRole("alert")).toHaveText("The end must be after the start.");
    await expect(dialog.getByRole("button", { name: "Confirm corrected match" })).toBeDisabled();
    await dialog.getByLabel("End (seconds)").fill("999");
    await expect(dialog.getByRole("alert")).toContainText("the end is outside it");

    await dialog.getByLabel("Start (seconds)").fill(start);
    await dialog.getByLabel("End (seconds)").fill(end);
    await dialog.getByRole("button", { name: "Preview this range" }).click();
    await dialog.getByRole("button", { name: "Confirm corrected match" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Correction sent. The current reviewed view stays in place until the new revision is accepted.")).toBeVisible();

    const card = page.getByRole("region", { name: "Your recent link corrections" }).getByTestId("request-card").first();
    await expect(card).toContainText(`revision ${revisionBefore + 1}`);
    await expect(card.getByTestId("publication-line")).toContainText(/source annotation: (saved|already saved)/, { timeout: 20_000 });
    await settle(request);
    await page.reload();
    await expect(page.getByTestId("clip-player")).toContainText("Shown during · Reviewed link");
    await expect(page.getByTestId("clip-label")).toContainText(label);
    await page.getByRole("button", { name: "Edit match" }).click();
    await expect(dialog).toContainText(`revision ${revisionBefore + 1} · Reviewed link`);
    await expect(dialog).toContainText("manual review");
    await expect(dialog.getByRole("button", { name: "Undo review" })).toBeVisible(); // undo is itself a new revision
    await page.keyboard.press("Escape");
  });

  test("UI18 a note is the learner's own record on an exact slide version, and never assessed or sent to the tutor", async ({ page, request, unique }) => {
    const text = unique("Check how the operator position affects leakiness");
    await page.goto(`${L2}?page=2`);
    await page.getByRole("button", { name: "Save note" }).click();
    const dialog = page.getByRole("dialog", { name: "Save a note on this slide" });
    await expect(dialog).toContainText("It is not sent to the tutor and it is not learning evidence.");
    await expect(dialog).toContainText(/Linked to: slide 2 · Fixture Lecture 02 - Expression control\.pdf · version v1-/);
    await expect(dialog.getByRole("button", { name: "Save note" })).toBeDisabled();
    await dialog.getByLabel("Note").fill(text);
    for (const [label, value] of [["Left percent", "55"], ["Top percent", "35"], ["Width percent", "30"], ["Height percent", "25"]] as const) await dialog.getByLabel(label).fill(value);
    await dialog.getByRole("button", { name: "Save note" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Note sent to the Brain. It appears under this slide once it is received.")).toBeVisible();
    await settle(request);

    await page.reload();
    await pane(page, "Sources");
    await expect(page.getByRole("region", { name: "Your notes on this slide" })).toContainText(text);
    // The note did not become an attempt, and no tutor turn was dispatched for it.
    const activity = await (await request.get("/api/activity")).json();
    const job = (activity.jobs as Array<{ action: string; phases: { native: string; publication: string }; updated_at: number }>).filter((j) => j.action === "save_note").sort((a, b) => b.updated_at - a.updated_at)[0]!;
    expect(job.phases.native).toBe("Not needed");
    expect(job.phases.publication).not.toMatch(/^attempt/);
  });
});
