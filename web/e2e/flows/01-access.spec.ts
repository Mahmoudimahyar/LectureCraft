// UI01–UI05, UI28: connecting, pairing, choosing where to study, search, sources and appearance.
// Names and routes follow the rebuilt shell (design specification of 2026-10-05; UI contract amendment R2).
import type { Locator, Page } from "@playwright/test";
import { COURSE, courseDisplayName, expectAccessible, expectNoHorizontalOverflow, isNarrow, openPane, pair, selectCourse, shot } from "../helpers";
import { expect, test } from "../fixtures";

const BE505 = "FIXTURE BE 505 - Molecular Systems (synthetic)";
const BE562 = "FIXTURE BE 562 - Probabilistic Models (synthetic)";

const pane = (page: Page, courseId: string): Locator => page.locator(`[data-testid="course-pane"][data-course="${courseId}"]`);
const courseTab = (page: Page, courseId: string): Locator => page.getByTestId("course-tabs").locator(`[data-course="${courseId}"]`);

/**
 * Light / Dark / System where the shell has them: the header's "Appearance" group on a wide window, the same group
 * inside the header Menu under 900 px. Neither leaves the page.
 */
async function chooseTheme(page: Page, name: "Light" | "Dark" | "System"): Promise<void> {
  if (!isNarrow(page)) {
    await page.getByRole("banner").getByRole("radiogroup", { name: "Appearance" }).getByRole("radio", { name }).click();
    return;
  }
  await page.getByRole("button", { name: /^Menu: / }).click();
  const menu = page.getByRole("menu");
  await menu.getByRole("group", { name: "Appearance" }).getByRole("menuitemradio", { name }).click();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
}

/**
 * The position a FINISHED study session synchronised, as the Brain holds it: the newest head over the bound courses, or
 * null when no session was ever finished. On a device that has opened nothing this is where Resume leads (study-facts
 * `latestPlace`: the newest synchronised place, the first course winning a tie). Read from the same route the page reads.
 */
async function newestSynchronisedPlace(page: Page): Promise<{ courseId: string; lectureId: string; page: number } | null> {
  interface Head { cursor: { lecture_id: string; source: { locator?: { page?: unknown } } }; updated_at: string }
  const workspace = (await (await page.request.get("/api/workspace")).json()) as { courses: Array<{ course_id: string; binding: string }> };
  let newest: { courseId: string; lectureId: string; page: number; at: number } | null = null;
  for (const course of workspace.courses.filter((candidate) => candidate.binding === "bound")) {
    const head = ((await (await page.request.get(`/api/courses/${course.course_id}/resume`)).json()) as { current: Head | null }).current;
    if (!head) continue;
    const stamp = Date.parse(head.updated_at);
    const at = Number.isNaN(stamp) ? -Infinity : stamp;
    const number = head.cursor.source.locator?.page;
    if (!newest || at > newest.at) newest = { courseId: course.course_id, lectureId: head.cursor.lecture_id, page: typeof number === "number" && Number.isInteger(number) && number >= 1 ? number : 1, at };
  }
  return newest;
}

test.describe("workspace access", () => {
  test("UI01 connect shows scope, separate access checks and the fixture label before anything is sent", async ({ page }, testInfo) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/connect$/); // an unpaired device lands on Connect, not on a blank study page
    await expect(page.getByRole("heading", { name: "Connect your course workspace" })).toBeVisible();
    // The label of the test double is two words beside the product name; the whole label is what it is titled with
    // (the full-width band is gone: design specification 4.2).
    const label = page.getByTestId("fixture-banner");
    await expect(label).toBeVisible();
    await expect(label).toHaveText("Sample data");
    await expect(label).toHaveAttribute("title", /synthetic course data and a labeled test tutor; not live evidence/);

    // All five configured courses are listed with their own binding state. Each line holds the course's identifier and
    // the counts the Brain reports, with their words (a count of one is "1 lecture unit", which the old page wrote "units").
    const workspace = (await (await page.request.get("/api/workspace")).json()) as { courses: Array<{ course_id: string; lecture_units: number; sessions: number }> };
    expect(workspace.courses.map((c) => c.course_id).sort()).toEqual(["be505", "be562", "be572", "cs542", "ds551"]);
    const bindings = page.getByRole("region", { name: /^Course bindings/ });
    const words = (count: number, noun: string): string => `${count} ${count === 1 ? noun : `${noun}s`}`;
    for (const course of workspace.courses) {
      expect(course.lecture_units, `${course.course_id} has lecture units`).toBeGreaterThan(0);
      await expect(bindings.getByText(`${course.course_id} · ${words(course.lecture_units, "lecture unit")} · ${words(course.sessions, "session")}`, { exact: true })).toBeVisible();
    }
    await expect(bindings.getByText(/^be505 · 5 lecture units · /)).toBeVisible(); // four units and the showcase unit lecture-05
    await expect(bindings.getByRole("listitem").filter({ hasText: "Bound" })).toHaveCount(5);

    // Reading sources, sending requests, the tutor and course saves are four separate facts.
    const checks = page.getByRole("region", { name: "Access checks (each is separate)" });
    await expect(checks.getByRole("listitem")).toHaveCount(4);
    await expect(checks.getByText("Reading course sources on this PC")).toBeVisible();
    await expect(checks.getByText("Not paired. You can browse and draft; nothing can be sent until this device is paired.")).toBeVisible();
    await expect(checks.getByText(/Not a real tutor; cannot satisfy native acceptance/)).toBeVisible();
    await expect(page.getByText("No paid AI service is used.")).toBeVisible();

    // The device key fingerprint is shown for comparison; the private key never appears anywhere.
    await expect(page.getByTestId("device-fingerprint")).toHaveText(/^([0-9a-f]{4} ){15}[0-9a-f]{4}$/);
    await expectAccessible(page, testInfo, "connect");
    await expectNoHorizontalOverflow(page);
    await shot(page, testInfo, "connect");
  });

  test("UI01 pairing needs an explicit fingerprint approval and then persists across reload", async ({ page }) => {
    await page.goto("/connect");
    await page.getByRole("button", { name: "Request pairing" }).click();
    await expect(page.getByText("Waiting for approval at the Brain PC")).toBeVisible();
    await expect(page.getByText("A request arriving through Drive can never approve itself.")).toBeVisible();
    await page.getByRole("button", { name: /fingerprints match — approve/ }).click();
    await expect(page.getByText(/^Paired with Brain/)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/^Paired with Brain/)).toBeVisible();
    await page.goto("/");
    await expect(page).toHaveURL(/\/study$/);
  });

  test("UI02 signing out is scoped to this device and says what stays", async ({ page }) => {
    await pair(page);
    await page.goto("/settings/access");
    await expect(page.getByTestId("device-row").filter({ hasText: "(this device)" })).toContainText("paired");
    const signOut = page.getByRole("region", { name: "Sign out of this device" });
    await expect(signOut).toContainText("Synchronised history and your course records are not erased.");
    await expect(signOut).toContainText("Requests the Brain already accepted keep running");
    await signOut.getByRole("button", { name: "Sign out this device" }).click();
    await expect(signOut.getByRole("status")).toContainText("No provider or Drive data was erased by this.");
    await expect(page).toHaveURL(/\/connect$/);
    await expect(page.getByRole("button", { name: "Request pairing" })).toBeVisible();
    // Drive sign-in is not configured, and the app says so rather than pretending.
    await page.goto("/settings/access");
    await expect(page.getByRole("region", { name: "Google Drive (other devices)" })).toContainText("Not configured");
  });

  test("UI03 study home lists every course, and a lecture opens at the place last used on this device", async ({ page }) => {
    const narrow = isNarrow(page);
    await pair(page);
    await page.goto("/study");
    await expect(page.getByRole("heading", { name: "Study", level: 1 })).toBeVisible();
    // Every configured course is one tab of the course list (the card wall is gone: design specification 6).
    await expect(page.getByRole("tablist", { name: "Courses" }).getByRole("tab")).toHaveCount(5);
    for (const id of ["be505", "be562", "be572", "cs542", "ds551"]) await expect(courseTab(page, id)).toBeVisible();
    // R2-B3: a profile that is not the learner's own courses says so once, in words.
    await expect(page.getByTestId("sample-data-sentence")).toHaveText("These are synthetic sample courses, not your own.");
    await expect(page.getByText("These are synthetic sample courses, not your own.")).toHaveCount(1);
    // Nothing on the page is a measure of the learner: the counts say what exists and what was recorded. (This line
    // replaces "reading or replaying a lecture is never treated as an assessment" of the old page: design specification 6, item 4.)
    await expect(page.getByTestId("study-closing-line")).toHaveText("The numbers say what exists and what was recorded. They do not measure what you know.");
    // This device (a fresh browser context) has opened nothing. What then stands in the place of Resume depends on one
    // recorded fact, which the test reads from the Brain instead of assuming it: whether a FINISHED study session has
    // synchronised a position. A finished session cannot be taken back through the interface, and in the whole suite
    // on one Brain earlier tests finish sessions by design (04 UI31, 05-operations, 09 R2-T11), so this test meets the
    // first state in the desktop project (it runs before them) and the second in the phone project (after them). Each
    // state has its own exact assertions; which one applies is decided by the Brain's answer, never by the page.
    const synchronised = await newestSynchronisedPlace(page);
    test.info().annotations.push({ type: "UI03 state of Resume met", description: synchronised ? `the place of a finished session (${synchronised.courseId} ${synchronised.lectureId}, PDF page ${synchronised.page})` : "nothing opened and no finished session: the sentence of a first run" });
    if (!synchronised) {
      // No session was ever finished: the place of Resume holds one sentence, not a guessed lecture.
      await expect(page.getByTestId("continue-studying")).toContainText("Nothing has been opened on this device yet.");
      await expect(page.getByRole("region", { name: "Resume" })).toHaveCount(0);
      // R2-V5 for this state. 08 "R2-V5 Study leads with Resume or its explained absence" checks the same order, but
      // it runs after the tests that finish sessions, so in the whole suite it only ever meets the other state: here
      // is where the explained absence is seen in its place. The sentence stands where Resume would, after the title
      // and before the courses and the lectures of the chosen one.
      await expect(page.getByTestId("course-pane").getByTestId("lecture-row").first()).toBeVisible();
      const tops = await page.getByTestId("study-home").evaluate((root) => ["h1", '[data-testid="continue-studying"]', '[data-testid="course-tabs"]', '[data-testid="lecture-row"]'].map((selector) => root.querySelector(selector)?.getBoundingClientRect().top ?? null));
      expect(tops.every((top) => typeof top === "number"), "the title, the sentence, the courses and the lectures are all there").toBe(true);
      expect([...(tops as number[])].sort((a, b) => a - b), "the title, then the sentence in the place of Resume, then the courses, then the lectures").toEqual(tops);
    } else {
      // A finished session exists: Resume leads to exactly its lecture and page and words it as a finished session
      // ("You stopped on …" would claim this device had been there), and the first-run sentence is not shown with it.
      const finished = page.getByRole("region", { name: "Resume" });
      await expect(finished.getByTestId("resume-where")).toContainText(`Your last finished session stopped on PDF page ${synchronised.page} of `);
      await expect(finished.getByTestId("resume-where")).not.toContainText("You stopped on");
      await expect(finished.getByRole("link", { name: "Resume lecture" })).toHaveAttribute("href", `/courses/${synchronised.courseId}/lectures/${synchronised.lectureId}?page=${synchronised.page}`);
      await expect(page.getByText("Nothing has been opened on this device yet.")).toHaveCount(0);
    }

    // A course with no attempts says so in words: never a zero, a score or a failure.
    await courseTab(page, "ds551").click();
    await expect(pane(page, "ds551").getByTestId("course-counts")).toContainText("no recorded attempts");
    await expect(pane(page, "ds551").getByTestId("course-counts")).not.toContainText(/\b0\b|%|fail/i);
    await expect(pane(page, "ds551")).not.toContainText(/failed|0 attempts|0 recorded/i);
    // The old course card said "Not assessed" here; Study now gives counts in words (above), and the phrase stands on
    // the course's Progress page, which follows the course just chosen: not assessed is not a score of zero.
    await page.goto("/progress");
    await expect(page.getByRole("heading", { name: "Progress", level: 1 })).toBeVisible();
    await expect(page.locator("#main").getByText("Not assessed", { exact: true }).first()).toBeVisible();
    await expect(page.locator("#main").getByText("No attempt is recorded for this course. That is not a score of zero — nothing has been measured yet.")).toBeVisible();

    // The course page is the Study page with that course chosen; opened by address, the path of the header names it.
    await page.goto(`/courses/${COURSE}`);
    await expect(page).toHaveURL(/\/courses\/be505$/);
    await expect(courseTab(page, COURSE)).toHaveAttribute("aria-selected", "true");
    await expect(pane(page, COURSE).getByTestId("course-name")).toHaveText(BE505);
    await expect(pane(page, COURSE).getByTestId("course-counts")).toContainText("5 lectures,");
    await expect(pane(page, COURSE).getByTestId("lecture-row")).toHaveCount(5);
    // The course control of the header stays inside one row however long a course name is. (The native select
    // "Active course" is gone; on a course page the control is the picker "Course: <name>" of the path.)
    const header = page.getByRole("banner");
    const picker = header.getByRole("navigation", { name: "Where you are" }).getByRole("button", { name: `Course: ${BE505}` });
    await expect(picker).toBeVisible();
    const headerBox = (await header.boundingBox())!;
    const pickerBox = (await picker.boundingBox())!;
    const rowHeight = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ll-hdr-h")));
    expect(rowHeight, "the header has a set height").toBeGreaterThan(0);
    expect(headerBox.height, "the header is one row high").toBeLessThanOrEqual(rowHeight + 1);
    expect(pickerBox.y, "the course control is inside the header").toBeGreaterThanOrEqual(headerBox.y);
    expect(pickerBox.y + pickerBox.height).toBeLessThanOrEqual(headerBox.y + headerBox.height + 0.5);
    if (!narrow) {
      const appearance = (await page.getByRole("radiogroup", { name: "Appearance" }).boundingBox())!;
      expect(Math.abs(appearance.y + appearance.height / 2 - (pickerBox.y + pickerBox.height / 2)), "header controls share one row").toBeLessThan(12);
      // At least 24 px separate the path from the first tool (design specification 4.2).
      const firstTool = (await page.getByTestId("header-concept-map").boundingBox())!;
      expect(firstTool.x - (pickerBox.x + pickerBox.width), "the path keeps clear of the tools").toBeGreaterThanOrEqual(24);
    } else {
      const menu = (await header.getByRole("button", { name: /^Menu: / }).boundingBox())!;
      expect(pickerBox.x + pickerBox.width, "the course name does not run under the menu button").toBeLessThanOrEqual(menu.x + 0.5);
    }
    await expectNoHorizontalOverflow(page);

    // A lecture with no linked session says so instead of guessing a pairing by date.
    for (const id of ["lecture-03", "lecture-04"]) await expect(pane(page, COURSE).locator(`[data-testid="lecture-row"][data-lecture="${id}"]`)).toContainText("no recording");
    const unlinked = pane(page, COURSE).getByTestId("unlinked-sessions");
    await expect(unlinked).toContainText("1 dated session is not linked to a lecture by the course records.");
    await expect(unlinked).toContainText("No pairing is assumed.");

    await pane(page, COURSE).getByRole("link", { name: "Fixture Lecture 02 - Expression control" }).click();
    await expect(page).toHaveURL(/\/courses\/be505\/lectures\/lecture-02/);
    // R2-S2 (slide identity line): the position is the physical page of the file, "PDF page n of m"; "Slide n of m" of
    // the old canvas claimed a slide number nobody had established. The same rule is behind every "PDF page" below.
    await expect(page.getByTestId("slide-position")).toHaveText("PDF page 1 of 3");
    await page.getByRole("group", { name: "Page" }).getByRole("button", { name: /^Next page/ }).click();
    await expect(page.getByTestId("slide-position")).toHaveText("PDF page 2 of 3");
    await expect(page).toHaveURL(/page=2/);

    await page.goto("/study");
    const resume = page.getByRole("region", { name: "Resume" });
    await expect(resume.getByRole("heading", { name: "Fixture Lecture 02 - Expression control" })).toBeVisible();
    await expect(resume.getByTestId("resume-where")).toContainText("You stopped on PDF page 2 of 3");
    await expect(resume.getByRole("link", { name: "Open the lecture at the page you left" })).toHaveAttribute("href", /\/courses\/be505\/lectures\/lecture-02\?page=2$/);
    await expect(pane(page, COURSE).locator('[data-testid="lecture-row"][data-lecture="lecture-02"]')).toContainText("You left this at page 2");
    await resume.getByRole("link", { name: "Resume lecture" }).click();
    await expect(page).toHaveURL(/lectures\/lecture-02\?page=2/);
    await expect(page.getByTestId("slide-position")).toHaveText("PDF page 2 of 3");
    // Returning never starts playback on its own.
    await expect(page.getByTestId("lecture-media")).toHaveJSProperty("paused", true);
  });

  // Added with the rebuilt shell: the header's native select "Active course" is gone, and this pins what replaced it
  // (design specification 4.2: the course is chosen on Study or in the header path). It is also the check of the
  // shared helper selectCourse() on every kind of page.
  test("UI03 the active course is chosen on Study or in the header, and Library, Progress and search follow it", async ({ page }) => {
    const narrow = isNarrow(page);
    const BE572 = await courseDisplayName(page, "be572");
    const where = page.getByRole("navigation", { name: "Where you are" });
    const subtitle = (name: string) => page.getByText(`${name} — inventory, versions and preparation`, { exact: true });
    await pair(page);

    // Study: the course is a tab. The choice is kept on this device and is the course of every page that follows one.
    await page.goto("/study");
    await selectCourse(page, "be562");
    await expect(page).toHaveURL(/\/study$/);
    await expect(courseTab(page, "be562")).toHaveAttribute("aria-selected", "true");
    await page.goto("/sources");
    await expect(page.getByRole("heading", { name: "Library", level: 1 })).toBeVisible();
    await expect(subtitle(BE562)).toBeVisible();

    // A page that follows the active course holds the choice in the header: the picker of the path on a wide window,
    // the "Active course" group of the Menu under 900 px. Choosing there keeps the page and shows the other course.
    if (!narrow) await expect(where.getByRole("button", { name: `Active course: ${BE562}` })).toBeVisible();
    await selectCourse(page, COURSE);
    await expect(page).toHaveURL(/\/sources$/);
    await expect(subtitle(BE505)).toBeVisible();
    await expect(subtitle(BE562)).toHaveCount(0);
    if (!narrow) {
      await expect(where.getByRole("button", { name: `Active course: ${BE505}` })).toBeVisible();
    } else {
      await page.getByRole("button", { name: /^Menu: / }).click();
      const group = page.getByRole("menu").getByRole("group", { name: "Active course" });
      await expect(group.getByRole("menuitemradio")).toHaveCount(5);
      await expect(group.getByRole("menuitemradio", { name: BE505, exact: true })).toBeChecked();
      await expect(group.getByRole("menuitemradio", { name: BE562, exact: true })).not.toBeChecked();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toBeHidden();
    }
    await page.goto("/progress");
    await expect(page.getByRole("heading", { name: "Progress", level: 1 })).toBeVisible();
    await expect(page.locator("#main").getByRole("link", { name: "Concept map" })).toHaveAttribute("href", "/courses/be505/concepts");

    // A page below a course belongs to that course and has no course control: another course is chosen on Study.
    await page.goto(`/courses/${COURSE}/lectures/lecture-02`);
    await expect(page.getByTestId("slide-position")).toHaveText("PDF page 1 of 3");
    await expect(where.getByRole("button", { name: /^(Active course|Course): / })).toHaveCount(0);
    await selectCourse(page, "be572");
    await expect(page).toHaveURL(/\/study$/);
    await expect(courseTab(page, "be572")).toHaveAttribute("aria-selected", "true");
    await expect(pane(page, "be572").getByTestId("course-name")).toHaveText(BE572);
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog.getByRole("radiogroup", { name: "Search scope" }).getByRole("radio", { name: BE572 })).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    // The choice is this device's and survives a reload.
    await page.reload();
    await expect(courseTab(page, "be572")).toHaveAttribute("aria-selected", "true");
  });

  test("UI04 search also reaches a unit's further files by page and transcripts of sessions linked to no lecture", async ({ page }) => {
    await pair(page);
    await page.goto("/courses/be562");
    // Opened by address, not by clicking through: the header and the search scope still follow the page.
    await expect(page.getByRole("navigation", { name: "Where you are" }).getByRole("button", { name: `Course: ${BE562}` })).toBeVisible();
    await expect(pane(page, "be562").getByTestId("course-name")).toHaveText(BE562);
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog.getByRole("radiogroup", { name: "Search scope" }).getByRole("radio", { name: BE562 })).toBeChecked();
    await dialog.getByLabel("Search query").fill("worked example reading");
    const results = dialog.getByRole("list", { name: "Search results" }).getByRole("link");
    await results.filter({ hasText: "Fixture 562 Reading A.pdf — page 2" }).first().click();
    await expect(page).toHaveURL(/\/sources\/[^?]+\?page=2/);
    await expect(page.getByText("PDF page 2 of 2")).toBeVisible();  // the original file, at that page — not a slide of the unit's main deck

    await page.goto("/courses/be572");
    await page.keyboard.press("Control+k");
    await dialog.getByLabel("Search query").fill("transcript line two");
    await results.filter({ hasText: "Session 2026-09-05 transcript — line 2" }).first().click();
    await expect(page).toHaveURL(/\/sources\/[^?]+\?line=2/);
    const current = page.getByRole("list", { name: "Text source, numbered lines" }).locator('[aria-current="location"]');
    await expect(current).toContainText("Synthetic fixture transcript line two.");
    await expect(page).not.toHaveURL(/\/lectures\//);  // never attached to a guessed lecture
  });

  test("UI04 scoped search finds slide and transcript text, jumps there and offers the way back", async ({ page }) => {
    await pair(page);
    await page.goto(`/courses/${COURSE}/lectures/lecture-01?page=2`);
    await expect(page.getByTestId("slide-position")).toHaveText("PDF page 2 of 4"); // R2-S2: the physical page, not "Slide 2 of 4"
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Search query")).toBeFocused();
    await expect(dialog).toContainText("Answer keys are never searched.");
    // The scope is the course of the page; other courses are searched only when chosen.
    await expect(dialog.getByRole("radiogroup", { name: "Search scope" }).getByRole("radio", { name: BE505 })).toBeChecked();

    await dialog.getByLabel("Search query").fill("repressor operator");
    await expect(dialog.getByRole("status")).toContainText(/Showing \d+ of \d+ match/);
    const results = dialog.getByRole("list", { name: "Search results" }).getByRole("link");
    await expect(results.first()).toBeVisible();
    await expect(results.filter({ hasText: "transcript line" }).first()).toBeVisible(); // transcript text is found as well as slide text
    await results.filter({ hasText: "Repressors and operators" }).first().click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/lectures\/lecture-02/);
    await expect(page.getByTestId("slide-position")).toHaveText("PDF page 2 of 3");
    await page.getByRole("link", { name: "← Return to where you were" }).click();
    await expect(page).toHaveURL(/lectures\/lecture-01\?page=2/);
    await expect(page.getByTestId("slide-position")).toHaveText("PDF page 2 of 4");

    // No match is reported as a search result, and preparation gaps are named rather than hidden.
    await page.keyboard.press("Control+k");
    await dialog.getByLabel("Search query").fill("zzqx-nothing-like-this");
    await expect(dialog.getByText("No matches in the indexed material")).toBeVisible();
    // Solutions are not searchable: a term that exists only in the answer key finds nothing.
    await dialog.getByRole("radio", { name: "All my courses" }).click();
    await dialog.getByLabel("Search query").fill("SYNTHETIC-SOLUTION-MARKER");
    await expect(dialog.getByText("No matches in the indexed material")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("UI05 sources show inventory states, preparation coverage and a bounded hint without registering anything", async ({ page }, testInfo) => {
    await pair(page);
    await page.goto("/sources");
    await expect(page.getByRole("heading", { name: "Library", level: 1 })).toBeVisible(); // the Sources page is called Library since the rebuild; its route is unchanged
    await expect(page.getByText(/It is a logistics index kept by the course updater/)).toBeVisible();
    const lectures = page.getByRole("region", { name: /^Lecture units/ });
    await expect(lectures.getByRole("heading", { level: 3 })).toHaveCount(5); // the showcase unit lecture-05 makes five
    await expect(lectures.getByRole("listitem").filter({ hasText: "Fixture Lecture 03" })).toContainText("Present, not registered");
    await expect(lectures.getByRole("listitem").filter({ hasText: "Fixture Lecture 03" })).toContainText("none linked by the course records");
    const other = page.getByRole("region", { name: /^Other course sources/ });
    await expect(other.getByRole("listitem").filter({ hasText: "src-ps-02-brief" })).toContainText("Not supplied yet");
    await expect(other.getByRole("listitem").filter({ hasText: "Fixture PS01 solutions.pdf" })).toContainText("opens only by deliberate reveal");

    await page.getByRole("button", { name: "Prepare a batch now" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Prepared \d+ lecture unit/ })).toBeVisible();

    // A hint only asks the Brain to rescan; it never registers a file or accepts a folder path.
    await page.getByRole("button", { name: "Tell the Brain about new material" }).click();
    const hint = page.getByRole("dialog");
    await expect(hint).toContainText(/does not register|not register/i);
    await expect(hint).toContainText("Links and paths are not accepted.");
    await page.keyboard.press("Escape");
    await expect(hint).toBeHidden();
    await expectAccessible(page, testInfo, "sources");
    await expectNoHorizontalOverflow(page);
  });

  test("UI28 Light, Dark and System change only the app's own surfaces and keep the slide, draft and position", async ({ page }, testInfo) => {
    await pair(page);
    await page.goto(`/courses/${COURSE}/lectures/lecture-02?page=2`);
    await expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", "2");
    const narrow = isNarrow(page);
    // R2-V3 (one context panel, five tabs) with design specification 5.7 (it opens on Questions the first time on a
    // device): Tutor is chosen on a wide window too, where R1's panel opened on it. A narrow window shows one pane at a time.
    await openPane(page, "Tutor");
    await page.locator("#tutor-composer").fill("draft that must survive a theme change");
    await expect(page.getByText("Draft saved on this device")).toBeVisible();
    if (narrow) await openPane(page, "Slide");
    await expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", "2");

    const pixels = () => page.getByTestId("slide-canvas").evaluate((canvas: HTMLCanvasElement) => {
      const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 0;
      for (let i = 0; i < data.length; i += 97) hash = (hash * 31 + data[i]!) >>> 0;
      return `${canvas.width}x${canvas.height}:${hash}`;
    });
    const before = await pixels();
    const surface = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const media = page.getByTestId("lecture-media");
    await media.evaluate((node) => ((node as HTMLElement & { __kept?: boolean }).__kept = true)); // the same element must still be there afterwards

    await chooseTheme(page, "Dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const dark = await surface();
    expect(await pixels(), "slide pixels are identical in dark theme").toBe(before);
    await shot(page, testInfo, "lecture-dark");
    await chooseTheme(page, "Light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await surface()).not.toBe(dark);
    expect(await pixels(), "slide pixels are identical in light theme").toBe(before);
    await expect(page.getByTestId("slide-position")).toHaveText("PDF page 2 of 3");
    await expect(page).toHaveURL(/lectures\/lecture-02\?page=2/);
    // A theme change neither reloads the page nor re-creates the recording's media element (R2-V3).
    expect(await media.evaluate((node) => (node as HTMLElement & { __kept?: boolean }).__kept === true), "the media element was not replaced").toBe(true);
    // System follows the device: the test browser's own scheme.
    await chooseTheme(page, "System");
    await expect(page.locator("html")).toHaveAttribute("data-theme", testInfo.project.use.colorScheme === "dark" ? "dark" : "light");
    expect(await pixels(), "slide pixels are identical under System").toBe(before);
    await openPane(page, "Tutor");
    await expect(page.locator("#tutor-composer")).toHaveValue("draft that must survive a theme change");
    if (narrow) await openPane(page, "Slide");

    // The choice is applied before first paint on reload (no flash): the attribute is set by the boot script.
    await chooseTheme(page, "Dark");
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
    await openPane(page, "Tutor");
    await expect(page.locator("#tutor-composer")).toHaveValue("draft that must survive a theme change");
    await page.locator("#tutor-composer").fill("");
  });
});
