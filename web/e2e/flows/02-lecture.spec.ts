// UI06–UI10, UI18: the source-first lecture workspace — slide, recording range, transcript,
// linked material, link correction and notes. Uses the synthetic BE 505 and BE 562 courses.
//
// Rewritten for the rebuilt workspace (UI contract amendment R2, "What R2 supersedes in R1"): one transport
// bar with a range line and a range list instead of the clip card with its selects (R2-V2, R2-T7 – R2-T11),
// five tabs instead of four (R2-V3: the facts of "This slide" moved to Questions and Sources), and the
// identity line "PDF page N of M" instead of "Slide N of M" (R2-S6). Each test keeps the requirement it pinned.
import type { Locator, Page } from "@playwright/test";
import { COURSE, expectAccessible, expectNoHorizontalOverflow, isNarrow, pair, settle, shot } from "../helpers";
import { expect, test } from "../fixtures";

const L1 = `/courses/${COURSE}/lectures/lecture-01`;
const L2 = `/courses/${COURSE}/lectures/lecture-02`;

type Pane = "Slide" | "Tutor" | "Questions" | "Concepts" | "Transcript" | "Sources";
/** Show a pane: a tab of the context panel on wide screens, the one focused pane on narrow ones (a tab may carry a count). */
async function pane(page: Page, name: Pane): Promise<void> {
  if (name === "Slide" && !isNarrow(page)) return; // the slide is always visible on wide layouts
  await page.getByRole("tab", { name: new RegExp(`^${name}( \\d+)?$`) }).click();
}

const media = (page: Page) => page.getByTestId("lecture-media");
const currentTime = (page: Page) => media(page).evaluate((m: HTMLMediaElement) => m.currentTime);
const isPaused = (page: Page) => media(page).evaluate((m: HTMLMediaElement) => m.paused);
const canvas = (page: Page) => page.getByTestId("slide-canvas");
const position = (page: Page) => page.getByTestId("slide-position");
/** The one transport bar (R2-V2). It stands under the slide; on a narrow screen that is the Slide pane. */
const transport = (page: Page) => page.getByTestId("transport");
/** What the workspace just did, said once on the stage (the same words also go to the screen-reader announcer). */
const notice = (page: Page) => page.getByTestId("stage-notice");
const pagerMoreButton = (page: Page) => page.getByRole("button", { name: /^More: finish the session/ });

/** An item of the menu "More" of the bar. */
async function transportMore(page: Page, item: string, role: "menuitem" | "menuitemradio" | "menuitemcheckbox" = "menuitem"): Promise<void> {
  await page.getByTestId("transport-more-button").click();
  await page.getByTestId("transport-more").getByRole(role, { name: item, exact: true }).click();
}

/** A control that stands in its band where the band has room and is an item of that band's More menu where it has not. */
async function openOwnOrMore(own: Locator, more: Locator): Promise<void> {
  if (await own.isVisible()) await own.click();
  else await more.click();
}

/** Page size: "Fit page", "Fit width", "100 %", "150 %", "200 %" (one menu, never a row of zoom buttons). */
async function pageSize(page: Page, label: RegExp): Promise<void> {
  await openOwnOrMore(page.getByTestId("fit-menu"), pagerMoreButton(page));
  await page.getByRole("menuitemradio", { name: label }).click();
}

/** The size in force is stated: on the menu's own button where the band has room, by the checked item of More where it has not. */
async function expectPageSize(page: Page, label: RegExp): Promise<void> {
  const own = page.getByTestId("fit-menu");
  if (await own.isVisible()) {
    await expect(own).toHaveText(label);
    return;
  }
  await pagerMoreButton(page).click();
  await expect(page.getByRole("menuitemradio", { name: label })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
}

async function playbackSpeed(page: Page, label: string): Promise<void> {
  await openOwnOrMore(page.getByTestId("speed-button"), page.getByTestId("transport-more-button"));
  await page.getByRole("menuitemradio", { name: label, exact: true }).click();
}

/** "Whole recording" is a toggle on the range line; on a bar too narrow for it, a checkbox item of More. */
async function wholeRecording(page: Page): Promise<void> {
  if (isNarrow(page)) await transportMore(page, "Whole recording", "menuitemcheckbox");
  else await page.getByTestId("whole-toggle").click();
}

test.describe("lecture workspace", () => {
  test.beforeEach(async ({ page }) => {
    await pair(page);
  });

  test("UI06 the slide is the original, navigable by button and keyboard, zoomable, with a labeled text alternative", async ({ page }, testInfo) => {
    await page.goto(L1);
    await expect(canvas(page)).toHaveAttribute("data-rendered", "1");
    // R2-S6: the identity is the physical page; "Slide N" is never derived from the page index.
    await expect(page.getByRole("img", { name: /^PDF\spage\s1\sof\s4: Anatomy of an expression plasmid — original source, colours unchanged$/ })).toBeVisible();

    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(position(page)).toHaveText("PDF page 2 of 4");
    await expect(canvas(page)).toHaveAttribute("data-rendered", "2");
    await page.locator("body").press("ArrowRight");
    await expect(position(page)).toHaveText("PDF page 3 of 4");
    await page.locator("body").press("ArrowLeft");
    await expect(position(page)).toHaveText("PDF page 2 of 4");
    await page.goBack(); // each page change is a real history entry
    await expect(position(page)).toHaveText("PDF page 3 of 4");
    await page.goBack();
    await expect(position(page)).toHaveText("PDF page 2 of 4");

    // Enlarging is contained in the slide's place: the page itself never scrolls sideways.
    const width = () => canvas(page).evaluate((c: HTMLCanvasElement) => c.getBoundingClientRect().width);
    const frame = page.getByTestId("slide-frame");
    await expect(frame).toHaveAttribute("data-fit", "contain"); // the whole page, by default
    const fit = await width();
    await pageSize(page, /^200\s%$/);
    await expect(frame).toHaveAttribute("data-fit", "200");
    await expectPageSize(page, /^200\s%$/); // the size in force is said in words, as "125% of fit" was
    await expect.poll(width).toBeGreaterThan(fit * 1.2);
    await expectNoHorizontalOverflow(page);
    await pageSize(page, /^Fit page$/);
    await expect(frame).toHaveAttribute("data-fit", "contain");
    await expectPageSize(page, /^Fit page$/);
    await expect.poll(async () => Math.abs((await width()) - fit)).toBeLessThanOrEqual(1);

    // The readable text is a separate, labeled derivative — never a replacement for the original. It opens under
    // Sources (R2-V3), where the file and the version of the deck are stated too.
    await pagerMoreButton(page).click();
    await page.getByRole("menuitem", { name: "Show readable text" }).click();
    const readable = page.getByLabel("Readable text rendition");
    await expect(readable).toContainText("Derived text rendition, not the original");
    await expect(readable).toContainText("Origin of replication");
    await expect(page.getByTestId("deck-facts")).toContainText(/Fixture Lecture 01 - Plasmid anatomy\.pdf · version v1-[0-9a-f]{12}/);
    await pane(page, "Slide");
    await expect(canvas(page)).toHaveAttribute("data-rendered", "2"); // the original is still the slide

    if (!isNarrow(page)) {
      const outline = page.getByRole("complementary", { name: "Lecture outline" });
      const toggle = page.getByTestId("outline-toggle");
      if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click(); // the outline starts closed below 1680px wide
      const rows = outline.getByRole("navigation", { name: "Pages" }).getByRole("button");
      await expect(rows).toHaveCount(4);
      await outline.getByRole("button", { name: "Find" }).click();
      await outline.getByLabel("Find a page by its number or title").fill("marker");
      await expect(rows).toHaveCount(1); // filtered by title and page text
      await outline.getByRole("button", { name: "Page 4: Selectable marker" }).click();
      await expect(position(page)).toHaveText("PDF page 4 of 4");
      await expect(page.getByRole("button", { name: "Next page", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "Show the slide full screen" }).click();
      await expect(page.getByRole("banner")).toBeHidden();
      await expect(canvas(page)).toBeVisible();
      await page.getByRole("button", { name: "Leave full screen" }).click();
      await expect(page.getByRole("banner")).toBeVisible();
    }
    await expectAccessible(page, testInfo, "lecture");
    await shot(page, testInfo, "lecture-slide");
  });

  test("UI06 a lecture with slides but no linked recording stays studyable and says exactly what is missing", async ({ page }) => {
    await page.goto(`/courses/${COURSE}/lectures/lecture-03`);
    await expect(canvas(page)).toHaveAttribute("data-rendered", "1");
    // R2-T9: of the six no-range lines this is "Recording unavailable"; the reason is stated and no action is offered.
    const bar = transport(page);
    await expect(bar).toHaveAttribute("data-mode", "unavailable");
    await expect(bar.getByTestId("no-range-line")).toHaveAttribute("data-state", "recording_unavailable");
    await expect(bar).toContainText("Recording unavailable");
    await expect(bar).toContainText("No recording is available for this lecture.");
    await expect(bar.getByRole("button")).toHaveCount(0);
    await pane(page, "Sources");
    await expect(page.getByRole("region", { name: "Sources of this lecture" })).toContainText("No recording is linked to this lecture.");
    await pane(page, "Transcript");
    await expect(page.getByText("No transcript is linked to this lecture")).toBeVisible();
    await expect(page.getByText("There is no transcript file in a session linked to these slides.")).toBeVisible();
  });

  test("UI07 the recording plays only this slide's segment, never autoplays, and stops at the segment end", async ({ page }) => {
    await page.goto(`${L1}?page=3`);
    const bar = transport(page);
    await expect(bar).toHaveAttribute("data-mode", "range");
    await expect(bar.getByTestId("range-times")).toContainText("0:30 – 0:45");
    await expect(bar.getByTestId("range-line")).toContainText("Marked by you");
    expect(await isPaused(page), "no autoplay").toBe(true);

    // Jump near the end of the range and play: it must stop at 0:45 instead of running into the next slide.
    await page.getByTestId("clip-scrubber").fill("44000");
    await playbackSpeed(page, "2×");
    await page.getByTestId("play-toggle").click();
    await expect(page.getByTestId("play-toggle")).toHaveAccessibleName("Pause");
    await expect(page.getByTestId("play-toggle")).toHaveAccessibleName(/^Play the range 0:30\sto\s0:45$/, { timeout: 8_000 });
    const stopped = await currentTime(page);
    expect(stopped).toBeGreaterThanOrEqual(44.9);
    expect(stopped).toBeLessThanOrEqual(45.3);
    await expect(page.getByTestId("announcer")).toHaveText("Stopped at the end of this range.");
    await expect(bar.getByTestId("stopped-line")).toContainText("Stopped at the end");

    // Seeking is clamped to the range; the whole recording is a deliberate choice.
    await page.getByRole("button", { name: "Back 10 seconds" }).click();
    await expect.poll(() => currentTime(page)).toBeCloseTo(35, 0);
    await page.getByRole("button", { name: "Back 10 seconds" }).click(); // 0:25 lies before the range: back to its start
    await expect.poll(() => currentTime(page)).toBeCloseTo(30, 0);
    await expect(bar.getByTestId("stopped-line")).toHaveCount(0); // the position moved: the bar no longer says it stands at the end
    await expect(bar.getByTestId("range-times")).toContainText("0:30 – 0:45");
    await wholeRecording(page);
    await expect(bar).toHaveAttribute("data-mode", "whole");
    await expect(page.getByRole("slider", { name: "Position in the whole recording" })).toBeVisible();
    await expect(page.getByTestId("time-readout")).toHaveText("0:30 / 1:00"); // the same position, now over the whole length

    // Changing page pauses and selects the new page's own range — without starting it.
    await page.getByTestId("play-toggle").click();
    await expect(page.getByTestId("play-toggle")).toHaveAccessibleName("Pause");
    await page.getByRole("button", { name: "Previous page", exact: true }).click();
    await expect(position(page)).toHaveText("PDF page 2 of 4");
    await expect(bar.getByTestId("range-times")).toContainText("0:15 – 0:30");
    expect(await isPaused(page)).toBe(true);

    // A slide the lecturer returned to offers each visit as its own range (R2-T8): two rows, nothing drawn between them.
    await expect(bar.getByTestId("range-stepper")).toContainText("1 of 2");
    await page.getByTestId("range-list-toggle").click();
    const rows = page.getByTestId("range-list").getByTestId("range-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("0:15 – 0:30");
    await expect(rows.nth(1)).toContainText("0:55 – 1:00");
    await expect(rows.nth(1)).toContainText("Marked by you");
    // R2-T11 (supersedes "choosing an occurrence only selects it"): pressing a row moves the one player to its
    // start and plays to its end, then stops.
    await rows.nth(1).getByRole("radio").click();
    await expect(bar.getByTestId("range-stepper")).toContainText("2 of 2");
    await expect(page.getByTestId("play-toggle")).toHaveAccessibleName("Pause");
    await expect(page.getByTestId("play-toggle")).toHaveAccessibleName(/^Play the range 0:55\sto\s1:00$/, { timeout: 8_000 });
    const end = await currentTime(page);
    expect(end).toBeGreaterThanOrEqual(59.9);
    expect(end).toBeLessThanOrEqual(60.3);
    expect(await isPaused(page)).toBe(true);
    // The stepper of the line only moves: a paused player stays paused at the start of the other visit.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Previous range" }).click();
    await expect(bar.getByTestId("range-times")).toContainText("0:15 – 0:30");
    await expect.poll(() => currentTime(page)).toBeCloseTo(15, 0);
    expect(await isPaused(page)).toBe(true);
  });

  test("UI07 a suggested (unreviewed) link is labeled as a suggestion, not presented as fact", async ({ page }) => {
    await page.goto(`${L2}?page=3`);
    const bar = transport(page);
    // R2-T10: a suggestion is shown without the learner confirming it, and is never worded as confirmed.
    await expect(bar.getByTestId("range-times")).toContainText("0:28 – 0:45");
    await expect(bar.getByTestId("range-line")).toContainText("Suggestion");
    await expect(bar).not.toContainText("Marked by you");
    await expect(bar).not.toContainText("Reviewed");
    // The alignment chip above the slide is gone (R2-V2): every row of the range list says what it is, with its method.
    await page.getByTestId("range-list-toggle").click();
    const row = page.getByTestId("range-list").getByTestId("range-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Suggestion (transcript-cue-match)");
    await row.getByRole("button", { name: /^Qualities of the range/ }).click();
    const qualities = page.getByTestId("range-qualities");
    await expect(qualities).toContainText("Nobody has checked it.");
    await expect(qualities).toContainText("Suggested for this page; not confirmed.");
    await expect(qualities).toContainText("nobody has reviewed them");
    await expect(qualities).not.toContainText("Human");
  });

  test("UI08 transcript: version shown, search, jump to the recording, and quote exact lines into a question", async ({ page }) => {
    await page.goto(`${L1}?page=3`);
    // File and version facts stand under Sources (R2-V3).
    await pane(page, "Sources");
    await expect(page.getByTestId("source-transcript")).toHaveText(/^24\slines\. .*Fixture Lec 1 Sep 3\.txt\s·\sversion v1-[0-9a-f]{12}$/);
    await pane(page, "Transcript");
    const lines = page.getByTestId("transcript-lines");
    await expect(lines.getByRole("listitem")).toHaveCount(24);

    await page.getByLabel("Search this transcript").fill("promoter");
    await expect(page.getByRole("status").filter({ hasText: /matching line/ })).toHaveText("4 matching lines");
    await expect(lines.getByRole("listitem")).toHaveCount(4);
    await page.getByLabel("Search this transcript").fill("");
    await expect(lines.getByRole("listitem")).toHaveCount(24);

    // Timestamps come from reviewed links; a press seeks the recording without starting it.
    await lines.getByRole("listitem").nth(12).getByRole("button", { name: /Go to 0:30 in the recording \(reviewed timing\)/ }).click();
    await expect.poll(() => currentTime(page)).toBeCloseTo(30, 0);
    expect(await isPaused(page)).toBe(true);

    await lines.getByRole("button", { name: "Select line 13", exact: true }).click();
    await lines.getByRole("button", { name: "Select line 14", exact: true }).click({ modifiers: ["Shift"] });
    const selected = page.getByRole("group", { name: "Selected transcript lines" });
    await expect(selected).toContainText("Lines 13–14 selected");
    await selected.getByRole("button", { name: "Ask about this" }).click();
    // The quote travels as an exact line reference attached to the next message.
    const composer = page.getByRole("group", { name: "Ask the tutor" });
    await expect(composer.getByRole("list", { name: "Attached to your next message" })).toContainText("Transcript lines 13–14");
    await expect(page.getByTestId("announcer")).toContainText("Quoted transcript lines attached");
    await composer.getByRole("button", { name: "Remove Transcript lines 13–14" }).click();
    await expect(composer).not.toContainText("Transcript lines");
  });

  test("UI09 linked material says why it is linked and how precisely; restricted solutions stay closed until revealed", async ({ page }) => {
    await page.goto(`${L1}?page=2`);
    await pane(page, "Sources");
    const related = page.getByRole("region", { name: "Connected material" });
    // A chapter-level relation is not dressed up as an exact page.
    await expect(related.getByRole("listitem")).toContainText("chapter-level reference — no exact page has been reviewed");
    await expect(related.getByRole("listitem")).toContainText("Suggestion, not reviewed");
    await expect(related.getByRole("listitem")).toContainText("Why linked: explains this slide's idea");
    // R2-V3: the questions of the page left "This slide" for the Questions tab, in its list "This slide".
    await pane(page, "Questions");
    await expect(page.getByTestId("this-slide-list").getByTestId("question-row")).toHaveCount(2);
    await expect(page.getByTestId("this-slide-list").getByRole("link", { name: /^(Answer|Answer again|Open the source question): L01, question \d · / })).toHaveCount(2);

    await page.goto(`${L1}?page=3`);
    await pane(page, "Sources");
    const exact = page.getByRole("region", { name: "Connected material" }).getByRole("listitem");
    await expect(exact).toContainText("Reviewed");
    await expect(exact).not.toContainText("Suggestion");
    await expect(exact).toContainText(/location: .*34/);
    await exact.getByRole("link", { name: "Open" }).click();
    await expect(page).toHaveURL(/\/sources\/.+\?page=2/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Fixture Textbook.pdf");
    await expect(canvas(page)).toHaveAttribute("data-rendered", "2");
    await page.getByRole("link", { name: "← Return to slide" }).click();
    await pane(page, "Slide");
    await expect(position(page)).toHaveText("PDF page 3 of 4");

    // Answer material is never shown just because it exists.
    await page.goto(`/courses/${COURSE}/sources/src-ps-01-solutions`);
    await expect(page.getByText(/answer material/i).first()).toBeVisible();
    await expect(canvas(page)).toHaveCount(0);
    await page.getByRole("button", { name: /Reveal/ }).click();
    await expect(canvas(page)).toHaveAttribute("data-rendered", "1");
  });

  test("UI09 a lecture unit holding several files lists every other file and opens each original", async ({ page }) => {
    await page.goto("/courses/be562/lectures/lecture-02");
    await expect(canvas(page)).toHaveAttribute("data-rendered", "1");
    // The unit's main slides are shown. R2-V3: the other files are no longer announced by a chip beside the slide;
    // they are listed under Sources, one visible tab away, with their count in the heading.
    await pane(page, "Sources");
    const others = page.getByRole("region", { name: "Other files in this lecture unit" });
    await expect(others.getByRole("heading")).toHaveText("Other files of this lecture unit 2");
    await expect(others.getByRole("listitem")).toHaveCount(2);
    await expect(others).toContainText("Slide-to-recording links exist for the unit's main slides only. Other PDF files are searchable by page and open as originals.");
    const reading = others.getByRole("listitem").filter({ hasText: "Fixture 562 Reading A.pdf" });
    await expect(reading).toContainText("not registered by the course updater");
    await expect(others.getByRole("listitem").filter({ hasText: "Fixture 562 unit notes.txt" }).getByRole("link", { name: "Open" })).toBeVisible();
    await reading.getByRole("link", { name: "Open" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Fixture 562 Reading A.pdf");
    // Its identity was derived by the app, and the page says so instead of presenting it as a course source id.
    await expect(page.getByTestId("identity-note")).toContainText("Provisional");
    await expect(page.getByTestId("identity-note")).toContainText("not in the course index");
    await expect(canvas(page)).toHaveAttribute("data-rendered", "1"); // the original, as its own document
    await page.getByRole("link", { name: "← Return to slide" }).click();
    await expect(page).toHaveURL(/courses\/be562\/lectures\/lecture-02/);
    await pane(page, "Slide");
    await expect(position(page)).toHaveText("PDF page 1 of 1");
    // A unit with a single file shows no such list.
    await page.goto(`${L1}?page=1`);
    await expect(canvas(page)).toHaveAttribute("data-rendered", "1");
    await pane(page, "Sources");
    await expect(page.getByRole("region", { name: "Sources of this lecture" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Other files in this lecture unit" })).toHaveCount(0);
  });

  test("UI10 correcting a link validates the range, keeps history as revisions and reports the real save state", async ({ page, request }, testInfo) => {
    const desktop = testInfo.project.name.includes("desktop");
    const [start, end, label] = desktop ? ["1", "11", "0:01 – 0:11"] : ["2", "12", "0:02 – 0:12"];
    await page.goto(`${L2}?page=1`);
    const bar = transport(page);
    await expect(bar.getByTestId("range-times")).toBeVisible();
    await transportMore(page, "Correct this range");
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
    await expect(notice(page).getByText("Correction sent. The current reviewed view stays in place until the new revision is accepted.")).toBeVisible();

    await pane(page, "Sources");
    const card = page.getByRole("region", { name: "Your recent link corrections" }).getByTestId("request-card").first();
    await expect(card).toContainText(`revision ${revisionBefore + 1}`);
    await expect(card.getByTestId("publication-line")).toContainText(/source annotation: (saved|already saved)/, { timeout: 20_000 });
    await settle(request);
    await page.reload();
    await pane(page, "Slide");
    await expect(bar.getByTestId("range-line")).toContainText("Marked by you");
    await expect(bar.getByTestId("range-times")).toContainText(label);
    await transportMore(page, "Correct this range");
    await expect(dialog).toContainText(`revision ${revisionBefore + 1} · Reviewed`);
    await expect(dialog).toContainText("manual review");
    await expect(dialog.getByRole("button", { name: "Undo review" })).toBeVisible(); // undo is itself a new revision
    await page.keyboard.press("Escape");
  });

  test("UI09 on an untimed transcript the lines matched to a slide are labelled as an unreviewed suggestion, not as a time", async ({ page }) => {
    // BE 562 lecture 01: an untimed transcript whose lines 1-2 were matched to slide 2 by text similarity only.
    await page.goto("/courses/be562/lectures/lecture-01?page=2");
    await expect(canvas(page)).toHaveAttribute("data-rendered", "2");
    await pane(page, "Transcript");
    // Untimed: line references only. No line carries a time, every line can still be quoted by its number.
    const lines = page.getByTestId("transcript-lines");
    await expect(page.getByTestId("transcript-closing")).toHaveText("Times have not been worked out for this transcript.");
    await expect(lines.getByRole("button", { name: /^Go to / })).toHaveCount(0);
    await expect(lines.getByRole("button", { name: /^Select line \d+$/ })).toHaveCount(2);
    const note = page.getByTestId("slide-lines-note");
    await expect(note).toContainText("Lines 1–2 are a suggested match for this slide");
    await expect(note).toContainText("not reviewed");
    await expect(note).toContainText("not a time in the recording");
    // Slide 1 has no match: nothing is claimed for it.
    await page.goto("/courses/be562/lectures/lecture-01?page=1");
    await expect(canvas(page)).toHaveAttribute("data-rendered", "1");
    await pane(page, "Transcript");
    await expect(page.getByTestId("slide-lines-note")).toContainText("No transcript lines are linked to this slide");
    // A reviewed link is called reviewed (BE 505 lecture 01, slide 3).
    await page.goto("/courses/be505/lectures/lecture-01?page=3");
    await expect(canvas(page)).toHaveAttribute("data-rendered", "3");
    await pane(page, "Transcript");
    await expect(page.getByTestId("slide-lines-note")).toContainText("Lines 13–18 are linked to this slide (reviewed)");
  });

  test("UI10 a slide with no suggested link (an untimed transcript) can be linked to the recording by the learner", async ({ page, request }, testInfo) => {
    // BE 562 lecture 01 mirrors most real sessions: a recording and an untimed transcript, so nothing is suggested.
    const slide = testInfo.project.name.includes("desktop") ? 1 : 2;
    await page.goto(`/courses/be562/lectures/lecture-01?page=${slide}`);
    await expect(canvas(page)).toHaveAttribute("data-rendered", String(slide));
    const bar = transport(page);
    // R2-T9 supersedes the one R1 line "No timed match for this slide": the bar names which of six causes holds,
    // with one action. No time is guessed, and nothing can be played until the learner asks for the recording.
    const none = bar.getByTestId("no-range-line");
    await expect(none).toHaveAttribute("data-state", "audio_unprocessed");
    await expect(none).toContainText("Audio not processed yet");
    if (isNarrow(page)) { // the sentence after the name is given up on a narrow bar and opens in full from the line
      await none.getByRole("button", { name: /^Read in full: Audio not processed yet/ }).click();
      await expect(page.getByTestId("range-line-full")).toContainText("The recording has not been processed yet.");
      await page.keyboard.press("Escape");
    } else await expect(none).toContainText("The recording has not been processed yet.");
    await expect(bar).toHaveAttribute("data-mode", "idle");
    await expect(bar.getByTestId("range-times")).toHaveCount(0);
    await expect(page.getByTestId("clip-scrubber")).toHaveCount(0);
    await bar.getByTestId("no-range-action").click(); // "Open whole recording": the whole recording, by the learner's choice
    await expect(bar).toHaveAttribute("data-mode", "opened");
    await expect(page.getByTestId("time-readout")).toHaveText("0:00 / 0:06");
    expect(await isPaused(page), "opening the recording starts nothing").toBe(true);
    await page.getByTestId("clip-scrubber").fill("1000"); // listen to where the slide is discussed…
    await transportMore(page, "Mark a range for this slide");

    const dialog = page.getByRole("dialog", { name: "Link this slide to the recording" });
    await expect(dialog).toContainText("saved as your own reviewed link");
    await expect(dialog).toContainText(/deck version v1-[0-9a-f]{12}/);
    await expect(dialog.getByLabel("Start (seconds)")).toHaveValue("1"); // …and the start is taken from that position
    await dialog.getByLabel("End (seconds)").fill("99");
    await expect(dialog.getByRole("alert")).toContainText("the end is outside it");
    await expect(dialog.getByRole("button", { name: "Save link" })).toBeDisabled();
    await dialog.getByLabel("End (seconds)").fill("4");
    await dialog.getByRole("button", { name: "Save link" }).click();
    await expect(dialog).toBeHidden();
    await expect(notice(page).getByText("Link sent. It appears on this page once the Brain has recorded it.")).toBeVisible();
    await pane(page, "Sources");
    const card = page.getByRole("region", { name: "Your recent link corrections" }).getByTestId("request-card").first();
    await expect(card.getByTestId("publication-line")).toContainText("source annotation: saved", { timeout: 20_000 });
    await settle(request);

    // R2-E3 (the place is kept on the way back; fix round, "The position survives leaving the lecture"): the device
    // keeps where the player stood on the page last on screen (here: the whole recording, opened by hand) and puts
    // that back when the same page is opened again, a reload included. So the plain reload of the R1 test would show
    // the learner's own earlier choice. Turning the page first makes the fresh load below show what the page offers
    // by itself, from the Brain's record: the range just saved, selected.
    const other = slide === 1 ? "Next page" : "Previous page";
    await pane(page, "Slide");
    await page.getByRole("button", { name: other, exact: true }).click();
    await expect(position(page)).toHaveText(`PDF page ${slide === 1 ? 2 : 1} of 2`);
    await page.goto(`/courses/be562/lectures/lecture-01?page=${slide}`);
    await pane(page, "Slide");
    await expect(bar).toHaveAttribute("data-mode", "range");
    await expect(bar.getByTestId("range-times")).toContainText("0:01 – 0:04");
    await expect(bar.getByTestId("range-line")).toContainText("Marked by you");
    await transportMore(page, "Correct this range");
    const edit = page.getByRole("dialog", { name: "Edit match" });
    await expect(edit).toContainText("revision 1 · Reviewed");
    await expect(edit).toContainText("manual review");
    await page.keyboard.press("Escape");
    await expect(edit).toBeHidden();
    // What the range is, on request (R2-V2: the qualities of a row, never merged into one figure).
    await page.getByTestId("range-list-toggle").click();
    const list = page.getByTestId("range-list");
    const row = list.getByTestId("range-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("0:01 – 0:04");
    await expect(row).toContainText("Marked by you");
    await row.getByRole("button", { name: /^Qualities of the range/ }).click();
    await expect(page.getByTestId("range-qualities")).toContainText("Human entered");
    await expect(page.getByTestId("range-qualities")).toContainText("You entered this range. It applies to this page.");
    await expect(list.getByRole("button", { name: "Mark a range yourself" })).toBeVisible(); // a slide the lecturer returns to can have several
    await page.keyboard.press("Escape");
    // The other slide of this deck is untouched: nothing was inferred for it.
    if (testInfo.project.name.includes("desktop")) {
      await page.getByRole("button", { name: other, exact: true }).click();
      await expect(bar.getByTestId("no-range-line")).toContainText("Audio not processed yet");
      await expect(bar.getByTestId("range-times")).toHaveCount(0);
    }
  });

  test("UI18 a note is the learner's own record on an exact slide version, and never assessed or sent to the tutor", async ({ page, request, unique }) => {
    const text = unique("Check how the operator position affects leakiness");
    await page.goto(`${L2}?page=2`);
    await expect(canvas(page)).toHaveAttribute("data-rendered", "2");
    // "Note" stands in the band where it has room and is an item of More where it has not.
    const inBand = page.getByRole("button", { name: "Note", exact: true });
    if (await inBand.isVisible()) await inBand.click();
    else {
      await pagerMoreButton(page).click();
      await page.getByRole("menuitem", { name: "Note", exact: true }).click();
    }
    const dialog = page.getByRole("dialog", { name: "Save a note on this page" });
    await expect(dialog).toContainText("It is not sent to the tutor and it is not learning evidence.");
    await expect(dialog).toContainText(/Linked to: PDF\spage\s2\sof\s3\s·\sFixture Lecture 02 - Expression control\.pdf\s·\sversion v1-/);
    await expect(dialog.getByRole("button", { name: "Save note" })).toBeDisabled();
    await dialog.getByLabel("Note").fill(text);
    for (const [label, value] of [["Left percent", "55"], ["Top percent", "35"], ["Width percent", "30"], ["Height percent", "25"]] as const) await dialog.getByLabel(label).fill(value);
    await dialog.getByRole("button", { name: "Save note" }).click();
    await expect(dialog).toBeHidden();
    await expect(notice(page).getByText("Note sent to the Brain. It appears under this page in Sources once it is received.")).toBeVisible();
    await settle(request);

    await page.reload();
    await pane(page, "Sources");
    await expect(page.getByRole("region", { name: "Your notes on this page" })).toContainText(text);
    // The note did not become an attempt, and no tutor turn was dispatched for it.
    const activity = await (await request.get("/api/activity")).json();
    const job = (activity.jobs as Array<{ action: string; phases: { native: string; publication: string }; updated_at: number }>).filter((j) => j.action === "save_note").sort((a, b) => b.updated_at - a.updated_at)[0]!;
    expect(job.phases.native).toBe("Not needed");
    expect(job.phases.publication).not.toMatch(/^attempt/);
  });
});
