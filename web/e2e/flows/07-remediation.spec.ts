// Remediation amendment R1: the acceptance checks that the earlier suite did not have. They measure what the learner
// sees — geometry, computed type sizes, counts of controls, real totals against the catalog — on the synthetic course,
// whose catalog holds the shapes of a real one (a question with no slide anchor, a question sheet that sorts before the
// deck, an original that cannot be displayed, a lecture with no collection).
//
// Amendment R2 (docs/project/ui-state-and-interaction-contract.md, "What R2 supersedes in R1") rebuilt the interface these
// checks were first written against. Each R1 check that is still in force is kept here on the rebuilt interface; an R1
// check that R2 replaced is either rewritten to the R2 rule in place (its title names both ids) or removed, with a
// comment naming the R2 check that took its place. The R2-V and R2-B checks themselves are in 08-r2-visual-identity.spec.ts.
import type { Locator, Page } from "@playwright/test";
import { COURSE, expectNoHorizontalOverflow, pair } from "../helpers";
import { expect, test } from "../fixtures";

const L1 = `/courses/${COURSE}/lectures/lecture-01`;
const DESKTOPS: Array<[number, number]> = [[1440, 900], [1920, 1080], [2560, 1440]];

const STATUS_LABEL: Record<string, string> = { not_assessed: "Not assessed", not_observed_only: "Not observed yet", current_gap: "Gap seen in latest response", uncertain: "Latest assessment uncertain",
  demonstrated_unaided: "Demonstrated unaided", demonstrated_assisted: "Demonstrated with assistance", demonstrated_after_exposure: "Demonstrated on a question seen before",
  demonstrated_conditions_unknown: "Demonstrated; conditions not recorded" };
/** The five evidence states of R2-C9, as the interface words them (an assisted state is followed by the kind of assistance). */
const EVIDENCE_STATE: Record<string, string> = { unknown: "Unknown", not_applicable: "Not applicable", not_separately_observed: "Not separately observed", assisted: "Assisted", independent: "Independent" };

const rendered = (page: Page, n: number) => expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", String(n));
/** Figures, titles and the parts of the identity line are joined by non-breaking spaces; compare them as ordinary text. */
const plain = async (locator: Locator): Promise<string> => (await locator.innerText()).replace(/\s+/g, " ").trim();
const identity = (page: Page): Promise<string> => plain(page.getByTestId("slide-position"));
/** A filter of the question bank: a combobox that opens a list of options (not a native select). */
async function choose(page: Page, name: string, option: string | RegExp): Promise<void> {
  await page.getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("option", { name: option }).click();
}
/** Open a list of the Questions tab by its heading button, unless it is open already. */
async function openList(heading: Locator): Promise<void> {
  if ((await heading.getAttribute("aria-expanded")) !== "true") await heading.click();
  await expect(heading).toHaveAttribute("aria-expanded", "true");
}

/** Share of visible text (by characters) below a size, and the smallest size, from computed styles — not from the root font. */
const typeCensus = (page: Page) => page.evaluate(() => {
  const sizes: Record<string, number> = {};
  let chars = 0;
  for (const el of document.querySelectorAll<HTMLElement>("main *")) {
    if (el.closest(".ll-pdf-textlayer") || el.closest("option") || el.closest("kbd")) continue;
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => (n.textContent ?? "").trim()).join("");
    if (!own || el.getClientRects().length === 0) continue;
    const size = Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10;
    sizes[size] = (sizes[size] ?? 0) + own.length;
    chars += own.length;
  }
  const share = (test: (s: number) => boolean) => Object.entries(sizes).filter(([s]) => test(Number(s))).reduce((n, [, c]) => n + c, 0) / Math.max(1, chars);
  return { smallest: Math.min(...Object.keys(sizes).map(Number)), below14: share((s) => s < 14), atLeast16: share((s) => s >= 16), body: parseFloat(getComputedStyle(document.body).fontSize) };
});

test.describe("R1 remediation checks", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "flows-desktop-light", "each check sets its own viewport; one project runs them");
    await pair(page);
  });

  for (const [width, height] of DESKTOPS) {
    // R1-U3's count, height and reachability rules stay in force and apply to the transport bar as R2-V2 defines it.
    test(`R1-U2 R1-U3 at ${width}x${height} the slide and one transport are in view without scrolling the page`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`${L1}?page=2`);
      await rendered(page, 2);
      await expect(page.getByTestId("transport")).toBeVisible();
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => {
        const rect = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
        const frame = document.querySelector<HTMLElement>('[data-testid="slide-frame"]')!;
        const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="slide-canvas"]')!;
        const surface = rect('[data-testid="slide-surface"]');
        const bar = rect('[data-testid="transport"]');
        return {
          pageScroll: document.documentElement.scrollHeight - window.innerHeight, slide: { top: surface.top, bottom: surface.bottom, w: surface.width, h: surface.height },
          player: { top: bar.top, bottom: bar.bottom, h: bar.height },
          frameScroll: [frame.scrollWidth - frame.clientWidth, frame.scrollHeight - frame.clientHeight], fit: frame.dataset.fit, sourceAspect: canvas.width / canvas.height,
          media: document.querySelectorAll("audio,video").length, nativeControls: Array.from(document.querySelectorAll<HTMLMediaElement>("audio,video")).filter((x) => x.controls).length,
          controllers: document.querySelectorAll("media-controller").length,
          // counted over the whole page, not inside the bar: a second control anywhere is the failure
          play: document.querySelectorAll('[data-testid="play-toggle"], [data-testid="dock-play"], media-play-button').length,
          timelines: document.querySelectorAll('[data-testid="clip-scrubber"], media-time-range').length,
          readouts: document.querySelectorAll('[data-testid="time-readout"], media-time-display').length, innerHeight: window.innerHeight,
        };
      });
      expect(m.pageScroll, "the page itself does not scroll").toBeLessThanOrEqual(1);
      expect(m.slide.top).toBeGreaterThanOrEqual(0);
      expect(m.slide.bottom).toBeLessThanOrEqual(m.innerHeight);
      expect(m.player.top).toBeGreaterThanOrEqual(0);
      expect(m.player.bottom, "the transport is inside the window").toBeLessThanOrEqual(m.innerHeight + 1);
      expect(m.fit).toBe("contain");
      expect(m.frameScroll, "the slide does not scroll inside its own frame at 100% fit").toEqual([0, 0]);
      expect(Math.abs(m.slide.w / m.slide.h - m.sourceAspect), "the slide is not distorted").toBeLessThan(0.01);
      expect(m.slide.h / m.innerHeight, "the slide uses the stage: more than half the window's height").toBeGreaterThanOrEqual(0.55);
      expect(m.player.h, "compact transport").toBeLessThanOrEqual(128);
      expect([m.media, m.nativeControls, m.controllers, m.play, m.timelines, m.readouts], "one media element, no native controls, one controller, one play control, one timeline, one time readout").toEqual([1, 0, 1, 1, 1, 1]);
    });
  }

  // R1-U4 ("with no timed link the transport says so in one line with one action") is replaced by the six no-range states
  // of R2-T9: one sentence for every cause is no longer the rule. The case R1-U4 was written on is kept here under the R2
  // rule: the line names its own state, offers at most one action, and nothing about an interval is invented.
  test("R1-U4 as R2-T9 a slide without a range shows its own no-range state with one action and no invented interval", async ({ page, request }) => {
    // BE 562 lecture 01 mirrors most real sessions: a recording and an untimed transcript, so no slide has a range.
    // (Another test links one of its slides by hand, so the slide is chosen from the Brain's answer at run time.)
    const lecture = await (await request.get("/api/courses/be562/lectures/lecture-01")).json();
    const untimed = (lecture.slides as Array<{ page: number; ranges: unknown[]; no_range: { state: string } | null }>).filter((s) => s.ranges.length === 0 && s.no_range).pop();
    expect(untimed, "the lecture has a slide without a range").toBeTruthy();
    expect(untimed!.no_range!.state).toBe("audio_unprocessed"); // a recording exists and nothing was transcribed
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/courses/be562/lectures/lecture-01?page=${untimed!.page}`);
    await rendered(page, untimed!.page);
    const bar = page.getByTestId("transport");
    await expect(bar).toHaveAttribute("data-mode", "idle");
    const line = bar.getByTestId("no-range-line");
    await expect(line).toHaveCount(1);
    await expect(line).toHaveAttribute("data-state", "audio_unprocessed");
    await expect(line).toContainText("Audio not processed yet");
    await expect(bar.getByTestId("range-line")).toHaveCount(0); // no interval is shown …
    await expect(bar.getByTestId("range-times")).toHaveCount(0);
    await expect(bar.getByTestId("range-stepper")).toHaveCount(0);
    await expect(bar.getByTestId("play-toggle")).toHaveAccessibleName("Play the whole recording"); // … and none is offered to play
    await expect(bar.getByTestId("no-range-action")).toHaveCount(1); // the single action
    await expect(bar.getByTestId("no-range-action")).toHaveText("Open whole recording");
    expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(128);
    await bar.getByTestId("no-range-action").click();
    await expect(bar).toHaveAttribute("data-mode", "opened");
    await expect(bar.getByTestId("clip-scrubber")).toHaveAccessibleName("Position in the whole recording");
    expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(128);
  });

  // Was "R1-U1 R1-U5 R1-U6 … Study uses the window, leads with where to continue, and keeps text readable". Of it:
  //   - removed: R1-U1's "at least 80% of the width beside navigation" and "at least four course cards side by side".
  //     R2-V6 withdraws them (no share of the window and no width cap is a success criterion; the test plan says such
  //     a test is removed, not loosened);
  //   - removed: R1-U6's "Continue studying" block with its link and the course cards. R2-V5 replaces them (Resume,
  //     then courses and lectures);
  //   - kept, on the rebuilt Study: R1-U1's readable measure of a paragraph and R1-U5's type floor, with their bounds;
  //   - rewritten to R2-V7: "at least half of the text at 16 px or more" was this test's own reading of R1-U5's "body
  //     text is at least 16 px". R2-V7 names what body (reading) text is and sets facts and controls in the declared
  //     control size (15 px at 1920), so the bound is held on the reading text itself.
  // R2-V5, R2-V6 and R2-V7 themselves are measured on Study in 08-r2-visual-identity.spec.ts.
  for (const [width, height] of [[1920, 1080], [2560, 1440]] as Array<[number, number]>) {
    test(`R1-U1 R1-U5 at ${width}x${height} on Study a paragraph keeps a readable measure and text keeps the type floor`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`${L1}?page=3`);
      await rendered(page, 3);
      await page.goto("/study");
      const resume = page.getByTestId("continue-studying");
      await expect(resume.getByTestId("resume-where")).toContainText("You stopped on PDF page 3 of 4"); // the place this device left
      await expect(page.getByTestId("lecture-row").first()).toBeVisible();
      for (const sentence of [resume.getByTestId("resume-where"), page.getByTestId("sample-data-sentence"), page.getByTestId("study-closing-line")]) {
        const measure = await sentence.evaluate((el) => el.getBoundingClientRect().width / parseFloat(getComputedStyle(el).fontSize));
        expect(measure, "paragraphs keep a readable measure instead of spanning the monitor").toBeLessThanOrEqual(46); // about 72 characters
      }
      const census = await typeCensus(page);
      expect(census.body).toBeGreaterThanOrEqual(16);
      expect(census.smallest).toBeGreaterThanOrEqual(12);
      expect(census.below14, "share of text below 14px").toBeLessThanOrEqual(0.05);
      // reading text (R2-V7): the sentences of the page, the name of a course and the titles of its lectures
      const reading = await page.locator('[data-testid="resume-where"], [data-testid="sample-data-sentence"], [data-testid="course-name"], [data-testid="lecture-row"] [id$="-t"]')
        .evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
      expect(reading.length, "sentences, the course name and the lecture titles were measured").toBeGreaterThanOrEqual(4);
      expect(Math.min(...reading), "reading text is at least 16px").toBeGreaterThanOrEqual(16);
      await expectNoHorizontalOverflow(page);
    });
  }

  test("R1-U5 on a lecture page no text is below 12px and little is below 14px", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${L1}?page=2&panel=transcript`);
    await rendered(page, 2);
    await expect(page.getByTestId("transcript-lines")).toBeVisible();
    const census = await typeCensus(page);
    expect(census.body).toBeGreaterThanOrEqual(16);
    expect(census.smallest).toBeGreaterThanOrEqual(12);
    expect(census.below14).toBeLessThanOrEqual(0.05);
    const line = await page.getByTestId("transcript-lines").getByText("Today we look at a synthetic plasmid").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(line, "transcript text is body text").toBeGreaterThanOrEqual(16);
  });

  // R1-Q2 listed "the basis of each entry"; R2-Q3 and R2-Q5 extend it to one basis label per row and make "no slide named"
  // no longer an end state, R2-Q6 puts the count of each list in its heading, and R2-V3 moved the lists from the tab
  // "This slide" into the Questions tab. The check is kept under those rules.
  test("R1-Q2 as R2-Q3 R2-Q5 R2-Q6 a lecture shows This slide, Related concepts and All lecture questions, each row with its basis", async ({ page, request }) => {
    const lecture = await (await request.get(`/api/courses/${COURSE}/lectures/lecture-01`)).json();
    const total = (lecture.questions.all as unknown[]).length;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${L1}?page=2`);
    await rendered(page, 2);
    await page.getByRole("tab", { name: /^Questions/ }).click();
    const tab = page.getByTestId("questions-tab");

    const onSlide = tab.getByTestId("this-slide-list");
    await expect(onSlide.getByTestId("question-row")).toHaveCount(2);
    await expect(tab.getByRole("button", { name: "This slide 2", exact: true })).toHaveAttribute("aria-expanded", "true"); // the count in the heading is the rows listed
    const origin = onSlide.locator('[data-question-id="BE505-L01-Q01"]');
    await expect(origin).toContainText("What the origin does");
    await expect(origin.getByTestId("question-basis")).toHaveAttribute("data-tie", "stated");
    await expect(origin.getByTestId("question-basis")).toContainText("Stated. The course record names this page. Its page basis is not reviewed.");

    const relatedHeading = tab.getByRole("button", { name: /^Related concepts \d+$/ });
    await openList(relatedHeading);
    const related = tab.getByTestId("related-list");
    const relatedRows = await related.getByTestId("question-row").count();
    await expect(relatedHeading).toHaveAccessibleName(`Related concepts ${relatedRows}`);
    const several = related.locator('[data-question-id="BE505-L01-Q04"]'); // shares a concept; not placed on the slide
    await expect(several).toContainText("One molecule, several jobs");
    await expect(several.getByTestId("question-basis").first()).toHaveAttribute("data-tie", "concept_related");

    const allHeading = tab.getByRole("button", { name: /^All lecture questions \d+$/ });
    await expect(allHeading).toHaveAccessibleName(`All lecture questions ${total}`); // the catalogued total of the lecture
    await openList(allHeading);
    const all = tab.getByTestId("lecture-questions");
    await expect(all.getByRole("list", { name: "All lecture questions" }).getByTestId("question-row")).toHaveCount(total);
    const unanchored = all.locator('[data-question-id="BE505-L01-Q04"]');
    await expect(unanchored).toBeVisible(); // a question with no slide anchor is still a lecture question
    await expect(unanchored.getByTestId("question-no-link")).toHaveAttribute("data-state", /.+/); // … and it carries a state, not only "no slide named"
    await expect(unanchored.getByTestId("question-no-link")).toContainText(/^No suggested link\./);
    await expect(tab).not.toContainText("No slide is named in the course record");
    await all.locator('[data-question-id="BE505-L01-Q02"]').getByRole("link", { name: "p. 3", exact: true }).click();
    await expect.poll(() => identity(page)).toBe("PDF page 3 of 4");

    // a page no question names says so and points at the lecture's list
    await page.goto(`${L1}?page=1&panel=questions`);
    await rendered(page, 1);
    await expect(page.getByTestId("lecture-questions-hint")).toHaveText(`No question is tied to this page. This lecture has ${total} questions; they are listed under All lecture questions.`);
  });

  test("R1-Q2 R1-Q3 R1-Q5 listed slides stay a list, the sheet is a related source, and a lecture without a collection shows the gap", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/courses/${COURSE}/lectures/lecture-04?page=2&panel=questions`);
    await rendered(page, 2);
    await expect.poll(() => identity(page)).toBe("PDF page 2 of 3"); // the 3-page deck, not the 1-page question sheet that sorts first
    const tab = page.getByTestId("questions-tab");
    const all = tab.getByTestId("lecture-questions");
    await expect(tab.getByRole("button", { name: "All lecture questions 3", exact: true })).toHaveAttribute("aria-expanded", "true"); // open on arrival: no question is tied to this page
    const basis = (id: string) => plain(all.locator(`[data-question-id="${id}"]`).getByTestId("question-basis"));
    expect(await basis("BE505-L04-Q01")).toBe("Exact. A reviewed anchor of the course record names p. 1, p. 3 and transcript lines 4–9."); // a page list is not widened into a range
    expect(await basis("BE505-L04-Q02")).toBe("Exact. A reviewed anchor of the course record names transcript lines 3–5."); // lines are not pages
    expect(await basis("BE505-L04-CLASS-Q01")).toBe("Stated. The course record names p. 1 of 04 - Fixture in-class questions.pdf. Its page basis is not reviewed."); // a page of its own file, not of the deck
    const through = all.getByTestId("lecture-questions-related");
    await expect(through.getByRole("heading", { name: "Related through another question 1" })).toBeVisible();
    await expect(through.locator('[data-question-id="BE505-PS03-Q01"]')).toContainText("diagnostic prerequisite of BE505-L04-Q01");
    await expect(tab.getByTestId("lecture-questions-hint")).toContainText("No question is tied to this page"); // page 2 is not in "p. 1, p. 3"
    await expect(tab.getByTestId("this-slide-list")).toHaveCount(0);

    // the file on screen is the deck; the question sheet is another file of the unit
    await page.getByRole("tab", { name: "Sources", exact: true }).click();
    await expect(page.getByTestId("deck-facts")).toContainText("Fixture Lecture 04 - Induction lab.pdf");
    const others = page.getByRole("region", { name: "Other files in this lecture unit" });
    await expect(others.getByRole("heading", { name: "Other files of this lecture unit 1" })).toBeVisible();
    await expect(others).toContainText("04 - Fixture in-class questions.pdf");

    await page.goto(`/courses/${COURSE}/lectures/lecture-03?panel=questions`);
    const gapHeading = page.getByTestId("questions-tab").getByRole("button", { name: "All lecture questions 0", exact: true });
    await openList(gapHeading);
    await expect(page.getByTestId("lecture-questions")).toContainText("No question collection for this lecture");
    await expect(page.getByTestId("lecture-questions")).toContainText("Nothing was generated to fill the gap");
  });

  test("R1-Q1 R1-Q1b the question bank lists the whole catalog with true totals, incremental loading, search and filters", async ({ page, request }) => {
    const first = await (await request.get(`/api/courses/${COURSE}/questions?limit=500`)).json();
    const total = first.total as number;
    expect(first.items.length, "the API pages nothing away").toBe(total);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/courses/${COURSE}/questions`);
    await expect(page.getByTestId("bank-total")).toContainText(`${total} questions in the course catalog`);
    await expect(page.getByTestId("bank-count")).toContainText(`Showing ${Math.min(25, total)} of ${total}`);
    await expect(page.getByTestId("question-row")).toHaveCount(Math.min(25, total));
    for (const c of first.collections as Array<{ collection: string; count: number }>) {
      await expect(page.getByRole("button", { name: new RegExp(`^${c.collection}\\s*${c.count}`) })).toBeVisible();
    }
    await choose(page, "Lecture", /Lecture 04/);
    await expect(page.getByTestId("bank-count")).toContainText(`Showing 3 of 3 matching (${total} in the catalog)`);
    await choose(page, "Lecture", /Lecture 03/);
    await expect(page.getByText("No question collection for this lecture")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByLabel("Search questions").fill("BE505-L01-Q04");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByTestId("question-row")).toHaveCount(1);
    await expect(page.getByTestId("question-row")).toContainText("One molecule, several jobs");
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByRole("combobox", { name: "Slide reference", exact: true }).click();
    await page.getByRole("option").filter({ hasText: /no (slide|page)/i }).first().click();
    await expect(page.getByTestId("bank-filter-anchor")).toHaveAttribute("data-value", "no_slide");
    await expect(page.getByTestId("question-row").first()).toBeVisible();
    await expect(page.getByTestId("bank-count")).toContainText(`(${total} in the catalog)`);
    expect(await page.getByTestId("question-row").count()).toBeLessThan(total);

    // Review offers the same catalog with its true total and no silent cut-off
    await page.goto("/review");
    const review = await (await request.get(`/api/courses/${COURSE}/review`)).json();
    await expect(page.getByTestId("available-count")).toContainText(`of ${review.available_total}`);
  });

  test("R1-Q4 a question whose original cannot be displayed keeps its original and offers a checked copy as a labelled rendition", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/courses/${COURSE}/questions/BE505-PS03-Q01`);
    const sources = page.getByTestId("question-sources");
    await expect(sources.getByRole("link", { name: /Open original \(Fixture PS03\.docx\)/ })).toBeVisible();
    await expect(sources.getByTestId("question-membership")).toContainText("Collection PS03: not tied to a lecture unit");
    await expect(sources.getByTestId("display-rendition")).toHaveCount(0); // not a rendition before it was compared
    await sources.getByRole("button", { name: "Check it against the original" }).click();
    await expect(sources.getByTestId("display-rendition")).toContainText("Display rendition");
    await expect(sources.getByTestId("display-rendition")).toContainText("The original file remains the authoritative source");
    await expect(sources.getByRole("link", { name: /Open original/ })).toBeVisible(); // still offered
    await expect(page.getByText(/written by the tutor; they are not the instructor's point scheme/)).toBeVisible();
    await sources.getByRole("link", { name: /Read the copy, page 1/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Fixture PS03 blank\.pdf/ })).toBeVisible();
  });

  // R1-G1 to R1-G4 stay in force. R2-C1 and R2-C3 moved the outline into the concept explorer (reached from Progress by
  // "Concept map", from every course header and from the lecture's Concepts tab), R2-C2 replaced the scope select by the
  // switch Course · Lecture · This slide, and R2-C9 replaced the per-skill status words by the five evidence states.
  test("R1-G1..G4 the concept outline opens grouped, expands on demand down to criteria, and offers sources, questions and evidence", async ({ page, request }) => {
    const top = await (await request.get(`/api/courses/${COURSE}/outline`)).json();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/progress");
    await page.getByRole("main").getByRole("link", { name: "Concept map" }).click();
    await expect(page.getByTestId("concept-explorer")).toBeVisible();
    const counts = page.getByTestId("outline-scope-count");
    await expect(counts).toHaveText(`Course: ${top.canonical_counts.concept} concepts, ${top.canonical_counts.skill} skills, ${top.canonical_counts.question} questions`);
    const tree = page.getByTestId("outline-tree");
    await expect(tree.getByRole("treeitem")).toHaveCount(top.rows.length); // topics only until a branch is opened
    await tree.getByRole("button", { name: "Expand Plasmid structure" }).click();
    await tree.getByRole("button", { name: "Expand Origin of replication" }).click();
    await tree.getByRole("button", { name: /^Expand Explain what the origin of replication does/ }).click();
    await tree.getByRole("button", { name: "Expand Replication is not transcription" }).click();
    await expect(tree.locator('[data-kind="criterion"]')).toHaveCount(3);
    // one criterion of the three assesses the skill it is listed under; the other two say they assess another skill
    await expect(tree.locator('[data-kind="criterion"]').filter({ hasText: "Assesses another skill of this question" })).toHaveCount(2);

    await tree.locator('[data-kind="concept"]').filter({ hasText: "Origin of replication" }).locator("[data-tree-action]").first().click();
    const detail = page.getByTestId("concept-detail-zone");
    await expect(detail.getByRole("heading", { name: "Origin of replication" })).toBeVisible();
    await expect(detail.getByRole("tab", { name: /^Sources/ })).toBeVisible();
    await detail.getByRole("tab", { name: /^Questions/ }).click();
    await expect(detail.getByTestId("question-row")).toHaveCount(2);
    await detail.getByRole("tab", { name: /^Evidence/ }).click();
    const node = await (await request.get(`/api/courses/${COURSE}/outline/node?id=be505.concept.origin-of-replication`)).json();
    await expect(detail.getByTestId("observation").first()).toBeVisible();
    await expect(detail).toContainText(EVIDENCE_STATE[node.evidence.state as string]!); // other tests add attempts: the label follows the records
    await expect(detail).not.toContainText("Shown in latest response");
    await expect(detail).toContainText("Skill: Explain what the origin of replication does"); // each observation names its unit, a skill

    await page.goto(`/courses/${COURSE}/outline?scope=${encodeURIComponent("lecture:lecture-04")}`); // the old address still resolves
    await expect(page).toHaveURL(/\/concepts\?/);
    await expect(page.getByRole("radio", { name: "Lecture", exact: true })).toBeChecked();
    await expect.poll(() => plain(counts)).toMatch(/^Fixture Lecture 04 - Induction lab: .*\b3 questions$/);
    await page.goto(`/courses/${COURSE}/outline?scope=${encodeURIComponent("slide:lecture-04:2")}`);
    await expect(page.getByRole("radio", { name: "This slide", exact: true })).toBeChecked();
    await expect(page.getByTestId("concept-scope-empty")).toContainText("Nothing in the course record and no suggested link names this slide");
    // A missing anchor stays visible (R1-G4). R1 said it as a count on the outline ("1 question of this lecture name no
    // slide"); under R2-Q3 "no slide named" stands alone nowhere, and the question carries its anchor state instead: it is
    // read on the question the outline leads to.
    await page.goto(`/courses/${COURSE}/concepts?scope=${encodeURIComponent("lecture:lecture-01")}`);
    await tree.getByRole("button", { name: "Expand Replication versus transcription" }).click();
    await tree.getByRole("button", { name: /^Expand Distinguish plasmid replication from gene transcription/ }).click();
    await tree.locator('[data-kind="question"]').filter({ hasText: "One molecule, several jobs" }).locator("[data-tree-action]").first().click();
    await expect(detail.getByRole("heading", { name: "One molecule, several jobs" })).toBeVisible();
    await detail.getByRole("tab", { name: /^Questions/ }).click();
    await detail.getByRole("link", { name: "Open the question" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "One molecule, several jobs" })).toBeVisible();
    await expect(page.getByTestId("question-links")).toContainText(/No suggested link\./);
    await expect(page.getByTestId("question-links")).not.toContainText(/p\. \d/); // and no page is given for it
  });

  test("R1-F1..F4 progress states the recorded condition and a facet table with unit, rule versions and remainder", async ({ page, request }) => {
    const progress = await (await request.get(`/api/courses/${COURSE}/progress`)).json();
    const skills = progress.skills as Array<{ skill_id: string; status: string }>;
    const row = skills.find((s) => s.skill_id === "be505.skill.ori.explain")!;
    const explanation = (progress.facets.rows as Array<{ facet: string; target_skills: number; qualifying_unaided_skills: number }>).find((f) => f.facet === "conceptual_explanation")!;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/progress");
    await expect(page.getByText("Shown in latest response")).toHaveCount(0);
    const ori = page.locator('[data-testid="skill-list"] > li').filter({ hasText: "Explain what the origin of replication does" });
    await expect(ori.getByText(STATUS_LABEL[row.status]!, { exact: false }).first()).toBeVisible(); // a demonstration always names its recorded condition
    const facets = page.getByTestId("facet-summary");
    await expect(facets).toContainText(`Unit: distinct skills of this course's catalog (${skills.length})`);
    await expect(facets.getByTestId("rule-versions")).toContainText("version 1 of the rules for evidence conditions and version 1 of the mapping of skills to kinds of performance");
    await expect(facets.locator('[data-facet="conceptual_explanation"]')).toContainText(`${explanation.qualifying_unaided_skills} of ${explanation.target_skills}`);
    await expect(facets.locator('[data-facet="coding_execution"]')).toContainText("No skill in this catalog is marked as coding or execution");
    await expect(facets.locator('[data-facet="unclassified"]')).toBeVisible();
    await expect(page.getByTestId("criterion-evidence")).toContainText("0 recorded attempts carry observations per criterion");
    await expect(facets).not.toContainText("%");
    await ori.getByRole("button", { name: "Show evidence and priority" }).click();
    await expect(ori.getByText("Independent · prior exposure", { exact: true }).first()).toBeVisible(); // prior exposure is stated as prior exposure, not as assistance (R2-C9)
    await expect(ori).toContainText("prior exposure: seen exact");
  });

  test("R1-U2 the lecture outline keeps the current slide in view inside its own list", async ({ page }) => {
    await page.setViewportSize({ width: 1700, height: 430 }); // a short window: the outline's list must scroll, the page must not
    await page.goto(`${L1}?page=4`);
    await rendered(page, 4);
    const outline = page.getByTestId("lecture-outline");
    const row = (n: number) => outline.getByRole("button", { name: new RegExp(`^Page ${n}:`) });
    await expect(row(4)).toHaveAttribute("aria-current", /true|page/);
    /** The row is inside the visible part of the nearest ancestor that scrolls. */
    const inside = (locator: Locator) => locator.evaluate((node) => {
      let box: HTMLElement | null = node.parentElement;
      while (box && !(box.scrollHeight > box.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
      const list = (box ?? node.closest('[data-testid="lecture-outline"]')!).getBoundingClientRect();
      const item = node.getBoundingClientRect();
      return { scrolls: box !== null, visible: item.top >= list.top - 1 && item.bottom <= list.bottom + 1 };
    });
    await expect.poll(async () => (await inside(row(4))).visible, { message: "the current slide's row is inside the visible part of the outline" }).toBe(true);
    expect((await inside(row(4))).scrolls, "in this short window the outline's own list scrolls").toBe(true);
    for (let step = 0; step < 3; step += 1) await page.getByRole("button", { name: "Previous page" }).click();
    await expect(row(1)).toHaveAttribute("aria-current", /true|page/);
    await expect.poll(async () => (await inside(row(1))).visible).toBe(true);
    expect(await page.evaluate(() => [window.scrollY, document.documentElement.scrollHeight - window.innerHeight]), "the page itself did not scroll").toEqual([0, 0]);
  });

  // R1-U7 stays in force; R2-V9 extends it (selected range, panel width, pane change, reduced motion) and is measured in
  // 08-r2-visual-identity.spec.ts. Here: theme, outline and tab changes, on the five tabs of R2-V3.
  test("R1-U7 a draft, the media position and the slide's colours survive theme, outline and panel changes", async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 1000 });
    await page.goto(`${L1}?page=2&panel=tutor`);
    await rendered(page, 2);
    const canvas = page.getByTestId("slide-canvas");
    const pixels = () => canvas.evaluate((c: HTMLCanvasElement) => [0.2, 0.5, 0.71].map((f) => Array.from(c.getContext("2d")!.getImageData(Math.round(c.width * f), Math.round(c.height * 0.45), 1, 1).data.slice(0, 3)).join(",")).join("|"));
    const before = await pixels();
    // The outline starts open only where it costs the slide nothing (not at this size with a 4:3 deck): open it, so that
    // collapsing it is the change under test, as it was in R1.
    const frame = page.getByTestId("workspace-frame");
    if ((await frame.getAttribute("data-outline")) === "closed") await page.getByTestId("outline-toggle").click();
    await expect(frame).toHaveAttribute("data-outline", "open");
    await rendered(page, 2);
    await page.locator("#tutor-composer").fill("A draft that must survive.");
    await page.getByTestId("play-toggle").click();
    const media = page.getByTestId("lecture-media");
    await expect.poll(() => media.evaluate((m: HTMLMediaElement) => m.currentTime)).toBeGreaterThan(15.2);
    await page.getByTestId("play-toggle").click();
    await expect.poll(() => media.evaluate((m: HTMLMediaElement) => m.paused)).toBe(true);
    const position = await media.evaluate((m: HTMLMediaElement) => m.currentTime);

    await page.getByRole("radio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByTestId("lecture-outline")).toBeVisible();
    await page.getByTestId("outline-toggle").click();
    await expect(frame).toHaveAttribute("data-outline", "closed");
    await expect(page.getByTestId("lecture-outline")).toBeHidden();
    for (const name of [/^Questions/, /^Concepts/, /^Transcript/, /^Sources/, /^Tutor/]) await page.getByRole("tablist", { name: "Context panel" }).getByRole("tab", { name }).click();
    await rendered(page, 2);
    await expect(page.locator("#tutor-composer")).toHaveValue("A draft that must survive.");
    expect(await media.evaluate((m: HTMLMediaElement) => m.currentTime), "the recording was not reloaded or rewound").toBeCloseTo(position, 1);
    expect(await pixels(), "the original slide is not tinted by the theme").toBe(before);
    await expect(page.getByTestId("outline-toggle")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("outline-toggle")).toHaveAccessibleName("Show the outline");
  });

  // The reflow rows of R1-U2/R1-U3 stay; R2-V4 names the panes (one focused pane from an explicit pane control, the
  // transport reachable from every pane) and is measured in full in 08-r2-visual-identity.spec.ts.
  for (const [width, height, scale] of [[390, 844, null], [768, 1024, null], [1280, 800, "150"]] as Array<[number, number, string | null]>) {
    test(`R1 reflow at ${width}x${height}${scale ? " with enlarged text" : ""}: one pane at a time, controls reachable, nothing scrolls sideways`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      if (scale) await page.addInitScript((value) => window.localStorage.setItem("ll.textScale", value), scale);
      await page.goto(`${L1}?page=2`);
      await rendered(page, 2);
      await expectNoHorizontalOverflow(page);
      await expect(page.getByTestId("workspace-frame")).toHaveAttribute("data-arrangement", "panes");
      const panes = page.getByRole("tablist", { name: "Workspace pane" });
      await expect(panes).toBeVisible();
      await expect(page.getByTestId("lecture-outline")).toBeHidden();
      const play = page.getByTestId("play-toggle");
      await play.scrollIntoViewIfNeeded();
      await expect(play).toBeInViewport();
      await panes.getByRole("tab", { name: /^Questions/ }).click();
      await expect(page.getByTestId("questions-tab")).toBeVisible();
      await expect(page.getByTestId("slide-canvas")).toBeHidden(); // one pane at a time
      await expect(page.getByTestId("dock-play")).toBeInViewport(); // the recording stays reachable from the pane
      await expectNoHorizontalOverflow(page);
      await page.goto("/study");
      await expect(page.getByTestId("continue-studying")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.goto(`/courses/${COURSE}/questions`);
      await expect(page.getByTestId("bank-total")).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }
});
