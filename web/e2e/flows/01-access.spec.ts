// UI01–UI05, UI28: connecting, pairing, choosing where to study, search, sources and appearance.
import { COURSE, expectAccessible, expectNoHorizontalOverflow, isNarrow, pair, shot } from "../helpers";
import { expect, test } from "../fixtures";

test.describe("workspace access", () => {
  test("UI01 connect shows scope, separate access checks and the fixture label before anything is sent", async ({ page }, testInfo) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/connect$/); // an unpaired device lands on Connect, not on a blank study page
    await expect(page.getByRole("heading", { name: "Connect your course workspace" })).toBeVisible();
    await expect(page.getByTestId("fixture-banner")).toContainText("synthetic course data and a labeled test tutor; not live evidence");

    // All five configured courses are listed with their own binding state.
    for (const id of ["be505", "be562", "be572", "cs542", "ds551"]) await expect(page.getByText(new RegExp(`^${id} · \\d+ lecture units`))).toBeVisible();

    // Reading sources, sending requests, the tutor and course saves are four separate facts.
    const checks = page.getByRole("region", { name: "Access checks (each is separate)" }).or(page.locator("section", { has: page.getByRole("heading", { name: "Access checks (each is separate)" }) }));
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
    await pair(page);
    await page.goto("/study");
    await expect(page.getByRole("heading", { name: "Study", level: 1 })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2 }) })).toHaveCount(5);
    await expect(page.getByText("reading or replaying a lecture is never treated as an assessment")).toBeVisible();
    // The course selector stays compact however long a course name is, so the header keeps to one row on wide screens.
    const selector = (await page.getByLabel("Active course").boundingBox())!;
    expect(selector.width).toBeLessThanOrEqual(258);
    if (!isNarrow(page)) {
      const appearance = (await page.getByRole("radiogroup", { name: "Appearance" }).boundingBox())!;
      expect(Math.abs(appearance.y + appearance.height / 2 - (selector.y + selector.height / 2)), "header controls share one row").toBeLessThan(12);
    }
    // A course with no attempts says "Not assessed", never zero or failed.
    await expect(page.getByRole("listitem").filter({ hasText: "ds551" }).getByText("Not assessed")).toBeVisible();

    await page.getByRole("link", { name: "FIXTURE BE 505 - Molecular Systems (synthetic)" }).click();
    await expect(page).toHaveURL(/\/courses\/be505$/);
    await expect(page.getByText("3 lecture units in the inventory")).toBeVisible();
    // A lecture with no linked session says so instead of guessing a pairing by date.
    await expect(page.getByText("No dated session is linked to this lecture by the course records (not guessed).")).toBeVisible();
    await expect(page.getByRole("region", { name: "Dated sessions without a recorded lecture link" })).toContainText("no pairing is assumed");

    await page.getByRole("link", { name: "Fixture Lecture 02 - Expression control" }).click();
    await expect(page.getByTestId("slide-position")).toHaveText("Slide 1 of 3");
    await page.getByRole("button", { name: "Next slide" }).click();
    await expect(page.getByTestId("slide-position")).toHaveText("Slide 2 of 3");
    await expect(page).toHaveURL(/page=2/);

    await page.goto("/study");
    const resume = page.getByRole("link", { name: /Continue on this device: lecture 02, slide 2/ });
    await expect(resume).toBeVisible();
    await resume.click();
    await expect(page.getByTestId("slide-position")).toHaveText("Slide 2 of 3");
    // Returning never starts playback on its own.
    await expect(page.getByTestId("lecture-media")).toHaveJSProperty("paused", true);
  });

  test("UI04 search also reaches a unit's further files by page and transcripts of sessions linked to no lecture", async ({ page }) => {
    await pair(page);
    await page.goto("/courses/be562");
    // Opened by address, not by clicking through: the header and the search scope still follow the page.
    await expect(page.getByLabel("Active course")).toHaveValue("be562");
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Search" });
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
    await expect(page.getByTestId("slide-position")).toHaveText("Slide 2 of 4");
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Search query")).toBeFocused();
    await expect(dialog).toContainText("Answer keys are never searched.");

    await dialog.getByLabel("Search query").fill("repressor operator");
    await expect(dialog.getByRole("status")).toContainText(/Showing \d+ of \d+ match/);
    const results = dialog.getByRole("list", { name: "Search results" }).getByRole("link");
    await expect(results.first()).toBeVisible();
    await results.filter({ hasText: "Repressors and operators" }).first().click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/lectures\/lecture-02/);
    await expect(page.getByTestId("slide-position")).toHaveText("Slide 2 of 3");
    await page.getByRole("link", { name: "← Return to where you were" }).click();
    await expect(page.getByTestId("slide-position")).toHaveText("Slide 2 of 4");

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
    await expect(page.getByRole("heading", { name: "Sources", level: 1 })).toBeVisible();
    await expect(page.getByText(/It is a logistics index kept by the course updater/)).toBeVisible();
    const lectures = page.getByRole("region", { name: /^Lecture units/ });
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
    if (narrow) await page.getByRole("tab", { name: "Tutor" }).click();
    await page.locator("#tutor-composer").fill("draft that must survive a theme change");
    await expect(page.getByText("Draft saved on this device")).toBeVisible();
    if (narrow) await page.getByRole("tab", { name: "Slide" }).click();
    await expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", "2");

    const pixels = () => page.getByTestId("slide-canvas").evaluate((canvas: HTMLCanvasElement) => {
      const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 0;
      for (let i = 0; i < data.length; i += 97) hash = (hash * 31 + data[i]!) >>> 0;
      return `${canvas.width}x${canvas.height}:${hash}`;
    });
    const before = await pixels();
    const surface = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    const choose = async (name: "Light" | "Dark" | "System") => {
      if (narrow) {
        await page.goto("/settings/appearance");
        await page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name }).click();
        await page.goBack();
        await expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", "2");
      } else {
        await page.getByRole("banner").getByRole("radio", { name }).click();
      }
    };

    await choose("Dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const dark = await surface();
    expect(await pixels(), "slide pixels are identical in dark theme").toBe(before);
    await shot(page, testInfo, "lecture-dark");
    await choose("Light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await surface()).not.toBe(dark);
    expect(await pixels(), "slide pixels are identical in light theme").toBe(before);
    await expect(page.getByTestId("slide-position")).toHaveText("Slide 2 of 3");

    // The choice is applied before first paint on reload (no flash): the attribute is set by the boot script.
    await choose("Dark");
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
    if (narrow) await page.getByRole("tab", { name: "Tutor" }).click();
    await expect(page.locator("#tutor-composer")).toHaveValue("draft that must survive a theme change");
    await page.locator("#tutor-composer").fill("");
  });
});
