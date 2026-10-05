// Remediation amendment R1: the acceptance checks that the earlier suite did not have. They measure what the learner
// sees — geometry, computed type sizes, counts of controls, real totals against the catalog — on the synthetic course,
// whose catalog holds the shapes of a real one (a question with no slide anchor, a question sheet that sorts before the
// deck, an original that cannot be displayed, a lecture with no collection).
import type { Page } from "@playwright/test";
import { COURSE, expectNoHorizontalOverflow, pair } from "../helpers";
import { expect, test } from "../fixtures";

const L1 = `/courses/${COURSE}/lectures/lecture-01`;
const DESKTOPS: Array<[number, number]> = [[1440, 900], [1920, 1080], [2560, 1440]];

const STATUS_LABEL: Record<string, string> = { not_assessed: "Not assessed", not_observed_only: "Not observed yet", current_gap: "Gap seen in latest response", uncertain: "Latest assessment uncertain",
  demonstrated_unaided: "Demonstrated unaided", demonstrated_assisted: "Demonstrated with assistance", demonstrated_after_exposure: "Demonstrated on a question seen before",
  demonstrated_conditions_unknown: "Demonstrated; conditions not recorded" };

const rendered = (page: Page, n: number) => expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", String(n));

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
    test(`R1-U2 R1-U3 at ${width}x${height} the slide and one transport are in view without scrolling the page`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`${L1}?page=2`);
      await rendered(page, 2);
      await expect(page.getByTestId("clip-player")).toBeVisible();
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => {
        const rect = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
        const frame = document.querySelector<HTMLElement>('[data-testid="slide-frame"]')!;
        const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="slide-canvas"]')!;
        const player = document.querySelector('[data-testid="clip-player"]')!;
        const surface = rect('[data-testid="slide-surface"]');
        return {
          pageScroll: document.documentElement.scrollHeight - window.innerHeight, slide: { top: surface.top, bottom: surface.bottom, w: surface.width, h: surface.height },
          player: { top: rect('[data-testid="clip-player"]').top, bottom: rect('[data-testid="clip-player"]').bottom, h: rect('[data-testid="clip-player"]').height },
          frameScroll: [frame.scrollWidth - frame.clientWidth, frame.scrollHeight - frame.clientHeight], fit: frame.dataset.fit, sourceAspect: canvas.width / canvas.height,
          media: document.querySelectorAll("audio,video").length, nativeControls: Array.from(document.querySelectorAll<HTMLMediaElement>("audio,video")).filter((x) => x.controls).length,
          controllers: document.querySelectorAll("media-controller").length, play: player.querySelectorAll('[data-testid="play-toggle"], media-play-button').length,
          timelines: player.querySelectorAll('input[type="range"][data-testid="clip-scrubber"], media-time-range').length, readouts: player.querySelectorAll("media-time-display").length, innerHeight: window.innerHeight,
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

  test("R1-U4 a slide without a timed link says so in one line and shows no invented interval", async ({ page, request }) => {
    // BE 562 lecture 01 mirrors most real sessions: a recording and an untimed transcript, so no slide has a timed link.
    // (Another test links one of its slides by hand, so the slide is chosen from the Brain's answer at run time.)
    const lecture = await (await request.get("/api/courses/be562/lectures/lecture-01")).json();
    const untimed = (lecture.slides as Array<{ page: number; occurrences: unknown[] }>).filter((s) => s.occurrences.length === 0).pop();
    expect(untimed, "the lecture has a slide without a timed link").toBeTruthy();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/courses/be562/lectures/lecture-01?page=${untimed!.page}`);
    await rendered(page, untimed!.page);
    const player = page.getByTestId("clip-player");
    await expect(player.getByText("No timed match for this slide")).toBeVisible();
    await expect(player.getByLabel("Which part of the recording to play")).toHaveValue("whole");
    await expect(player.getByRole("button", { name: "Link this slide to the recording" })).toBeVisible(); // the single action
    await expect(page.getByTestId("transport-details")).toHaveCount(0); // the explanation is optional detail, not a banner
    expect((await player.boundingBox())!.height).toBeLessThanOrEqual(128);
    await player.getByRole("button", { name: "Details" }).click();
    await expect(page.getByTestId("transport-details")).toContainText("no start time is guessed");
  });

  for (const [width, height] of [[1920, 1080], [2560, 1440]] as Array<[number, number]>) {
    test(`R1-U1 R1-U5 R1-U6 at ${width}x${height} Study uses the window, leads with where to continue, and keeps text readable`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`${L1}?page=3`);
      await rendered(page, 3);
      await page.goto("/study");
      const resume = page.getByTestId("continue-studying");
      await expect(resume.getByRole("heading", { name: "Continue studying" })).toBeVisible();
      await expect(resume).toContainText("slide 3");
      await expect(resume.getByRole("link", { name: /Open the slide/ })).toHaveAttribute("href", /lecture-01\?page=3/);
      const share = await page.evaluate(() => document.querySelector(".ll-page")!.getBoundingClientRect().width / document.querySelector("main")!.getBoundingClientRect().width);
      expect(share, "the content region uses the window beside the navigation").toBeGreaterThanOrEqual(0.8);
      const cards = await page.locator(".ll-card-grid > li").evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, w: r.width })));
      const firstRow = cards.filter((c) => Math.round(c.y) === Math.round(cards[0]!.y)).length;
      expect(firstRow, "course cards use the width: at least four side by side").toBeGreaterThanOrEqual(4);
      const measure = await resume.locator("p").first().evaluate((el) => el.getBoundingClientRect().width / parseFloat(getComputedStyle(el).fontSize));
      expect(measure, "paragraphs keep a readable measure instead of spanning the monitor").toBeLessThanOrEqual(46); // about 72 characters
      const census = await typeCensus(page);
      expect(census.body).toBeGreaterThanOrEqual(16);
      expect(census.smallest).toBeGreaterThanOrEqual(12);
      expect(census.below14, "share of text below 14px").toBeLessThanOrEqual(0.05);
      expect(census.atLeast16, "share of text at 16px or more").toBeGreaterThanOrEqual(0.5);
      await expectNoHorizontalOverflow(page);
    });
  }

  test("R1-U5 on a lecture page no text is below 12px and little is below 14px", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${L1}?page=2&panel=transcript`);
    await rendered(page, 2);
    const census = await typeCensus(page);
    expect(census.smallest).toBeGreaterThanOrEqual(12);
    expect(census.below14).toBeLessThanOrEqual(0.05);
    const line = await page.locator('[data-testid="transcript-lines"] li span').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(line, "transcript text is body text").toBeGreaterThanOrEqual(16);
  });

  test("R1-Q2 a lecture shows This slide, Related concepts and All lecture questions, each with its reason", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${L1}?page=2`);
    await rendered(page, 2);
    await page.getByRole("tab", { name: "This slide", exact: true }).click();
    const onSlide = page.getByRole("region", { name: "Questions on this slide" });
    await expect(onSlide.getByText("What the origin does")).toBeVisible();
    await expect(onSlide.getByTestId("question-why").first()).toContainText(/names slide 2.*not yet confirmed as page numbers/);
    await expect(page.getByRole("region", { name: "Related concepts" })).toContainText("One molecule, several jobs"); // shares a concept; not placed on the slide

    await page.getByRole("tab", { name: "Questions", exact: true }).click();
    const all = page.getByTestId("lecture-questions");
    await expect(all.getByRole("heading", { name: "All lecture questions (4)" })).toBeVisible();
    await expect(all.getByTestId("lecture-questions-count")).toContainText("Showing 4 of 4");
    const unanchored = all.locator('[data-question-id="BE505-L01-Q04"]');
    await expect(unanchored).toBeVisible(); // a question with no slide anchor is still a lecture question
    await expect(unanchored.getByTestId("question-anchor")).toHaveText("No slide is named in the course record for this question.");
    await all.locator('[data-question-id="BE505-L01-Q02"]').getByRole("button", { name: "3", exact: true }).click();
    await expect(page.getByTestId("slide-position")).toHaveText("Slide 3 of 4");

    // a slide no question names: the chip says so and leads to the lecture's questions
    await page.goto(`${L1}?page=1`);
    await rendered(page, 1);
    await expect(page.getByTestId("slide-links-chip")).toContainText(/lecture question/);
  });

  test("R1-Q2 R1-Q3 R1-Q5 listed slides stay a list, the sheet is a related source, and a lecture without a collection shows the gap", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/courses/${COURSE}/lectures/lecture-04?page=2&panel=questions`);
    await rendered(page, 2);
    await expect(page.getByTestId("slide-position")).toHaveText("Slide 2 of 3"); // the 3-slide deck, not the 1-page question sheet that sorts first
    await expect(page.getByText(/Fixture Lecture 04 - Induction lab\.pdf/)).toBeVisible();
    await expect(page.getByRole("button", { name: "1 other file in this lecture unit" })).toBeVisible();
    const all = page.getByTestId("lecture-questions");
    await expect(all.getByRole("heading", { name: "All lecture questions (3)" })).toBeVisible();
    await expect(all.locator('[data-question-id="BE505-L04-Q01"]').getByTestId("question-anchor")).toHaveText("Course record: slides 1, 3 · transcript lines 4–9");
    await expect(all.locator('[data-question-id="BE505-L04-Q02"]').getByTestId("question-anchor")).toHaveText("Course record: transcript lines 3–5");
    await expect(all.locator('[data-question-id="BE505-L04-CLASS-Q01"]').getByTestId("question-anchor")).toHaveText("Course record: page 1 of its source file (not a slide of the deck)");
    await expect(all.getByRole("heading", { name: "Related through another question (1)" })).toBeVisible();
    await expect(all.locator('[data-question-id="BE505-PS03-Q01"]')).toContainText("diagnostic prerequisite of BE505-L04-Q01");
    await page.getByRole("tab", { name: "This slide", exact: true }).click();
    await expect(page.getByTestId("lecture-questions-hint")).toContainText("No question names this slide"); // slide 2 is not in "Slides 1, 3"

    await page.goto(`/courses/${COURSE}/lectures/lecture-03?panel=questions`);
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
    await page.getByLabel("Lecture").selectOption("lecture-04");
    await expect(page.getByTestId("bank-count")).toContainText(`Showing 3 of 3 matching (${total} in the catalog)`);
    await page.getByLabel("Lecture").selectOption("lecture-03");
    await expect(page.getByText("No question collection for this lecture")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByLabel("Search questions").fill("BE505-L01-Q04");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByTestId("question-row")).toHaveCount(1);
    await expect(page.getByTestId("question-row")).toContainText("One molecule, several jobs");
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByLabel("Slide reference").selectOption("no_slide");
    await expect(page.getByTestId("question-row").first()).toBeVisible();
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

  test("R1-G1..G4 the concept outline opens grouped, expands on demand down to criteria, and offers sources, questions and evidence", async ({ page, request }) => {
    const top = await (await request.get(`/api/courses/${COURSE}/outline`)).json();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/progress");
    await page.getByRole("link", { name: "Concept outline" }).click();
    await expect(page.getByTestId("outline-counts")).toContainText(`${top.canonical_counts.concept} concepts`);
    await expect(page.getByTestId("outline-counts")).toContainText(`${top.canonical_counts.criterion} criteria`);
    const tree = page.getByTestId("outline-tree");
    await expect(tree.getByRole("treeitem")).toHaveCount(top.rows.length); // topics only until a branch is opened
    await tree.getByRole("button", { name: "Expand Plasmid structure" }).click();
    await tree.getByRole("button", { name: "Expand Origin of replication" }).click();
    await tree.getByRole("button", { name: /^Expand Explain what the origin of replication does/ }).click();
    await tree.getByRole("button", { name: "Expand Replication is not transcription" }).click();
    await expect(tree.locator('[data-kind="criterion"]')).toHaveCount(3);
    await expect(tree.locator('[data-kind="criterion"]').filter({ hasText: "assesses the skill above" })).toHaveCount(1);

    await tree.getByRole("button", { name: /^Concept\s*Origin of replication/ }).click();
    const detail = page.getByTestId("outline-detail");
    await expect(detail.getByRole("heading", { name: "Origin of replication" })).toBeVisible();
    await expect(detail.getByRole("tab", { name: /^Sources/ })).toBeVisible();
    await detail.getByRole("tab", { name: /^Questions/ }).click();
    await expect(detail.getByTestId("question-row")).toHaveCount(2);
    await detail.getByRole("tab", { name: "Evidence" }).click();
    const node = await (await request.get(`/api/courses/${COURSE}/outline/node?id=be505.concept.origin-of-replication`)).json();
    await expect(detail).toContainText(STATUS_LABEL[node.evidence.skills[0].status as string]!); // other tests add attempts: the label follows the records
    await expect(detail).not.toContainText("Shown in latest response");
    await expect(detail).toContainText("unit: skill");

    await page.getByLabel("Scope").selectOption("lecture:lecture-04");
    await expect(page.getByTestId("outline-scope-count")).toHaveText("3 questions in this scope");
    await page.goto(`/courses/${COURSE}/outline?scope=${encodeURIComponent("slide:lecture-04:2")}`);
    await expect(page.getByTestId("concept-outline")).toContainText("No question in the course record names this slide");
    await page.goto(`/courses/${COURSE}/outline?scope=${encodeURIComponent("lecture:lecture-01")}`);
    await expect(page.getByTestId("concept-outline")).toContainText("1 question of this lecture name no slide");
  });

  test("R1-F1..F4 progress states the recorded condition and a facet table with unit, rule versions and remainder", async ({ page, request }) => {
    const progress = await (await request.get(`/api/courses/${COURSE}/progress`)).json();
    const row = (progress.skills as Array<{ skill_id: string; status: string }>).find((s) => s.skill_id === "be505.skill.ori.explain")!;
    const explanation = (progress.facets.rows as Array<{ facet: string; target_skills: number; qualifying_unaided_skills: number }>).find((f) => f.facet === "conceptual_explanation")!;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/progress");
    await expect(page.getByText("Shown in latest response")).toHaveCount(0);
    const ori = page.locator('[data-testid="skill-list"] > li').filter({ hasText: "Explain what the origin of replication does" });
    await expect(ori.getByText(STATUS_LABEL[row.status]!, { exact: true })).toBeVisible(); // a demonstration always names its recorded condition
    const facets = page.getByTestId("facet-summary");
    await expect(facets).toContainText("Unit: distinct skills of this course's catalog (5)");
    await expect(facets).toContainText("conditions evidence-conditions/1, facet mapping v1");
    await expect(facets.locator('[data-facet="conceptual_explanation"]')).toContainText(`${explanation.qualifying_unaided_skills} of ${explanation.target_skills}`);
    await expect(facets.locator('[data-facet="coding_execution"]')).toContainText("No skill in this catalog is marked as coding or execution");
    await expect(facets.locator('[data-facet="unclassified"]')).toBeVisible();
    await expect(page.getByTestId("criterion-evidence")).toContainText("0 recorded attempts carry observations per criterion");
    await expect(facets).not.toContainText("%");
    await ori.getByRole("button", { name: "Show evidence and priority" }).click();
    await expect(ori.getByText("after prior exposure", { exact: true }).first()).toBeVisible();
    await expect(ori).toContainText("prior exposure: seen exact");
  });

  test("R1-U7 a draft, the media position and the slide's colours survive theme, outline and panel changes", async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 1000 });
    await page.goto(`${L1}?page=2`);
    await rendered(page, 2);
    const canvas = page.getByTestId("slide-canvas");
    const pixels = () => canvas.evaluate((c: HTMLCanvasElement) => [0.2, 0.5, 0.71].map((f) => Array.from(c.getContext("2d")!.getImageData(Math.round(c.width * f), Math.round(c.height * 0.45), 1, 1).data.slice(0, 3)).join(",")).join("|"));
    const before = await pixels();
    await page.locator("#tutor-composer").fill("A draft that must survive.");
    await page.getByTestId("play-toggle").click();
    const media = page.getByTestId("lecture-media");
    await expect.poll(() => media.evaluate((m: HTMLMediaElement) => m.currentTime)).toBeGreaterThan(15.2);
    await page.getByTestId("play-toggle").click();
    const position = await media.evaluate((m: HTMLMediaElement) => m.currentTime);

    await page.getByRole("radio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "Collapse lecture outline" }).click();
    await page.getByRole("tab", { name: "Questions", exact: true }).click();
    await page.getByRole("tab", { name: "Transcript", exact: true }).click();
    await page.getByRole("tab", { name: "Tutor", exact: true }).click();
    await rendered(page, 2);
    await expect(page.locator("#tutor-composer")).toHaveValue("A draft that must survive.");
    expect(await media.evaluate((m: HTMLMediaElement) => m.currentTime), "the recording was not reloaded or rewound").toBeCloseTo(position, 1);
    expect(await pixels(), "the original slide is not tinted by the theme").toBe(before);
    await expect(page.getByRole("button", { name: "Open lecture outline" })).toHaveAttribute("aria-expanded", "false");
  });

  for (const [width, height, scale] of [[390, 844, null], [768, 1024, null], [1280, 800, "150"]] as Array<[number, number, string | null]>) {
    test(`R1 reflow at ${width}x${height}${scale ? " with enlarged text" : ""}: one pane at a time, controls reachable, nothing scrolls sideways`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      if (scale) await page.addInitScript((value) => window.localStorage.setItem("ll.textScale", value), scale);
      await page.goto(`${L1}?page=2`);
      await rendered(page, 2);
      await expectNoHorizontalOverflow(page);
      await expect(page.getByRole("tablist", { name: "Workspace pane" })).toBeVisible();
      await expect(page.getByTestId("lecture-outline")).toBeHidden();
      const play = page.getByTestId("play-toggle");
      await play.scrollIntoViewIfNeeded();
      await expect(play).toBeInViewport();
      await page.getByRole("tab", { name: "Questions", exact: true }).click();
      await expect(page.getByTestId("lecture-questions")).toBeVisible();
      await expect(page.getByTestId("slide-canvas")).toBeHidden(); // one pane at a time
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
