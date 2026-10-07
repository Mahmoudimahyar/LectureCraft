// Amendment R2, questions and concepts: the ON-SCREEN rows of R2-Q1 … R2-Q10 (docs/features/review/test-plan.md for
// R2-Q1 and R2-Q10, docs/features/evidence-alignment/test-plan.md for R2-Q2 … R2-Q9) and of R2-C1 … R2-C11
// (docs/features/progress/test-plan.md), on the labelled synthetic showcase unit (be505, lecture 05) and the fixture
// catalog. One test per check id; the title starts with the id.
//
// - Wording follows the UI contract (docs/project/ui-state-and-interaction-contract.md, section R2), which wins over a
//   test plan where the two differ; each such place says so beside its assertion.
// - R2-C1 starts on Study and uses only visible, labelled controls. The other tests open a page of the lecture or a scope
//   of the concept map by its address (`page`, `panel`, `scope`, `node`: the documented routes) where the way there is
//   not what the row pins; what the row pins (a link, a tab, a key, a button) is always done on the screen.
// - Requests of the test's own are GETs that read what the Brain reports at run time (the totals a row compares with),
//   except: R2-Q5 rewrites the suggestions file of the test instance as a producer pass would (and puts the bytes back),
//   and a failed test is cleaned up through the API so that the next test does not inherit its state.
// - The desktop project runs at 1440×900 (an R2 test viewport), the phone project at 390×844; both run on ONE Brain, so
//   whatever a test changes it puts back, and nothing pins a state that an attempt recorded here would change.
// - Below 1180 px one pane is in front at a time and the map is one column without drawn lines; where a row is about the
//   drawing (zoom, line styles) the narrow branch pins what that presentation shows instead, and says so.
// - The outline and the map fill in a moment after their heading (rows of an opened row, the layout of the map): what is
//   compared is read when it stands (`openWholeOutline`, `mapSettled`), never loosened.
// - "Not in the fixture: …" names what a row asks for and the synthetic courses cannot show; nothing is asserted weaker
//   in its place.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "../fixtures";
import { expectAccessible, expectNoHorizontalOverflow, isNarrow, pair, settle } from "../helpers";

const COURSE = "be505";
const COURSE_NAME = "FIXTURE BE 505 - Molecular Systems (synthetic)";
const LECTURE = "lecture-05";
const TITLE = "Fixture Lecture 05 - R2 showcase";
const PAGES = 14;
/** Pages of the showcase deck that keep no list of their own (title, administrative). */
const STRUCTURAL: Record<number, string> = { 1: "Structural (title or section)", 11: "Administrative" };

const Q01 = "BE505-L05-Q01"; // reviewed page anchor on pp. 4–6 (one slide in three builds) and transcript lines 9–17
const Q02 = "BE505-L05-Q02"; // suggested, unchecked, partial: builds 2 and 3 support 2 of 3 criteria
const Q03 = "BE505-L05-Q03"; // suggested, checked: the two steps pp. 7–8 support 1 of 1 criteria
const Q04 = "BE505-L05-Q04"; // suggested, checked and narrowed by the second pass to p. 10: 1 of 2 criteria
const CLASS = "BE505-L05-CLASS-Q01"; // every candidate rejected by the checking pass; wording kept in its source
const PRACTICE = "BE505-L05-PRACTICE-Q01"; // stated anchor on p. 12
const NAME: Record<string, string> = {
  [Q01]: "L05, question 1 · Order of the reporter construct",
  [Q02]: "L05, question 2 · Why the construct is built this way",
  [Q03]: "L05, question 3 · Steps of a plate reading",
  [Q04]: "L05, question 4 · From reading to amount",
  [CLASS]: "L05-class, question 1 · In-class question 1",
  [PRACTICE]: "L05-practice, question 1 · What is subtracted first",
};
/**
 * The assessor's guidance of the showcase questions as the synthetic fixture writes it (criterion wordings, then expected
 * answers; brain/src/lecture_brain/fixtures/content.py). None of it may be on screen before an attempt (R2-Q10).
 */
const GUIDANCE: readonly string[] = [
  "Names promoter fragment, coding sequence, binding site and terminator in that order and ties the terminator to the end of transcription.",
  "Links the downstream position of the coding sequence to being transcribed from the tested fragment.",
  "Links the ribosome binding site to translation of the message.",
  "Names brightness after blank subtraction as the quantity compared between fragments.",
  "Gives excitation, collection of emission and subtraction of the empty-well value, in order.",
  "Subtracts the blank, divides by the slope and reaches 40 nanomoles.",
  "Describes the slope as reading per unit amount, obtained from the standards.",
  "Says the blank reading goes first because that signal does not come from the reporter.",
  "Sketch labels fragment, coding sequence and terminator and shows which way the construct is read.",
  "Promoter fragment, then the fluorescent coding sequence, then the ribosome binding site and the terminator; the terminator ends transcription.",
  "Downstream so the tested fragment drives its transcription; the binding site so the message is translated; compare blank-corrected brightness.",
  "Excite with blue light, collect the green emission through the filter, subtract the empty-well reading.",
  "(500 - 20) / 12 = 40 nanomoles; the slope is the reading gained per nanomole, fitted from the standards.",
  "The blank, 40 units: it is background that the reporter did not produce.",
  "A line with three labelled boxes in the order fragment, coding sequence, terminator, and an arrow pointing from the fragment.",
];
const PRACTICE_CRITERION = "Says the blank reading goes first because that signal does not come from the reporter.";

// ---- small helpers of this file ---------------------------------------------------------------------------------------------
const clean = (text: string | null | undefined): string => (text ?? "").replace(/[   ]/g, " ").replace(/\s+/g, " ").trim();
const textOf = async (locator: Locator): Promise<string> => clean(await locator.innerText());
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A name whose spaces may be non-breaking in the page. */
const named = (text: string): RegExp => new RegExp(`^${escapeRegExp(text).replace(/ /g, "\\s+")}$`);
const startsWith = (text: string): RegExp => new RegExp(`^${escapeRegExp(text).replace(/ /g, "\\s+")}`);
const param = (page: Page, key: string): string | null => new URL(page.url()).searchParams.get(key);

async function api<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`/api/${path}`);
  expect(response.ok(), `GET /api/${path}`).toBeTruthy();
  return (await response.json()) as T;
}
interface Tie { question_id: string; tie: string; support_pages: number[]; suggestion_id: string | null; learner_decision: string | null }
interface LectureView {
  questions: { counts: { all: number; course_anchor: number; agent_inferred: number; without_link: number }; all: Array<{ question_id: string }> };
  slides: Array<{ page: number; question_ties: Tie[] }>;
  revisions: { inferred_anchors_sha256: string };
}
const lectureView = (page: Page, lecture: string = LECTURE): Promise<LectureView> => api<LectureView>(page, `courses/${COURSE}/lectures/${lecture}`);

type Pane = "Slide" | "Outline" | "Tutor" | "Questions" | "Concepts" | "Transcript" | "Sources";
/** A tab of the context panel (wide) or of the pane switch (narrow); only one of the two tab lists exists at a time. */
async function openTab(page: Page, name: Pane): Promise<void> {
  const tab = page.getByRole("tab", { name: new RegExp(`^${name}( \\d+)?$`) });
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}
/** On a narrow window the slide, its identity line and the stage bar are the Slide pane. */
async function showSlide(page: Page): Promise<void> {
  if (isNarrow(page)) await openTab(page, "Slide");
}
/** The identity line reads `words` and that page of the file is the one drawn. */
async function expectIdentity(page: Page, physical: number, words: string): Promise<void> {
  await showSlide(page);
  await expect.poll(() => textOf(page.getByTestId("slide-position"))).toBe(words);
  await expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", String(physical));
}
/**
 * A page of a lecture with one destination of the workspace in front, by its address. When that lecture is already open
 * the address changes in place, as a link inside the app does (the file, the recording and the app are not fetched
 * again: this machine runs several browser suites at once and runs out of loopback sockets otherwise).
 */
async function openLecture(page: Page, physical: number, panel: "questions" | "concepts" | "sources" | "transcript" | "slide", lecture: string = LECTURE): Promise<void> {
  const path = `/courses/${COURSE}/lectures/${lecture}`;
  const address = `${path}?page=${physical}&panel=${panel}`;
  if (new URL(page.url()).pathname === path && (await page.getByTestId("lecture-workspace").count()) > 0) {
    await page.evaluate((to) => {
      window.history.pushState(window.history.state, "", to);
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    }, address);
  } else await page.goto(address);
  await expect(page.getByTestId("lecture-workspace")).toBeVisible();
  // The page of the address is the page of the workspace (the identity line is in the page also when its pane is not in front).
  await expect.poll(() => page.getByTestId("slide-position").evaluate((line) => (line.textContent ?? "").replace(/\s+/g, " ").trim())).toMatch(new RegExp(`^PDF page ${physical} of `));
  if (!isNarrow(page)) await expect(page.getByTestId("slide-canvas")).toHaveAttribute("data-rendered", String(physical));
}
async function openQuestions(page: Page, physical: number, lecture: string = LECTURE): Promise<Locator> {
  await openLecture(page, physical, "questions", lecture);
  const tab = page.getByTestId("questions-tab");
  await expect(tab).toBeVisible();
  return tab;
}

type Section = "This slide" | "Related concepts" | "All lecture questions";
const sectionButton = (page: Page, name: Section): Locator => page.getByTestId("questions-tab").getByRole("button", { name: new RegExp(`^${name}\\s*\\d+$`) });
const sectionCount = async (page: Page, name: Section): Promise<number> => Number(/(\d+)$/.exec(await textOf(sectionButton(page, name)))?.[1] ?? NaN);
async function openSection(page: Page, name: Section): Promise<void> {
  const button = sectionButton(page, name);
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
}
const ROW = '[data-testid="question-row"]';
const row = (list: Locator, questionId: string): Locator => list.locator(`${ROW}[data-question-id="${questionId}"]`);
const thisSlideRows = (page: Page): Locator => page.getByTestId("this-slide-list").locator(`:scope > ${ROW}`);
const relatedRows = (page: Page): Locator => page.getByTestId("related-list").locator(ROW);
const lectureList = (page: Page): Locator => page.getByTestId("lecture-questions").getByRole("list", { name: "All lecture questions" });
const lectureRows = (page: Page): Locator => lectureList(page).locator(`:scope > ${ROW}`);
const basis = (within: Locator, tie: "exact" | "stated" | "agent_inferred" | "section" | "concept_related"): Locator => within.locator(`[data-testid="question-basis"][data-tie="${tie}"]`);
/** Everything the Questions tab holds, with its three sections open. */
async function questionsTabText(page: Page): Promise<string> {
  for (const name of ["This slide", "Related concepts", "All lecture questions"] as const) {
    if (await sectionButton(page, name).count()) await openSection(page, name);
  }
  return textOf(page.getByTestId("questions-tab"));
}

async function openSearch(page: Page): Promise<Locator> {
  if (isNarrow(page)) {
    await page.getByRole("button", { name: /^Menu: / }).click();
    await page.getByRole("menuitem", { name: /^Search/ }).click();
  } else await page.getByRole("banner").getByRole("button", { name: /^Search/ }).click();
  const dialog = page.getByRole("dialog", { name: "Search" });
  await expect(dialog).toBeVisible();
  return dialog;
}
/** Type a query; the answer of that query is on screen when the count line or the "no match" line has settled. */
async function search(dialog: Locator, query: string): Promise<Locator> {
  await dialog.getByLabel("Search query").fill(query);
  await expect(dialog.getByRole("status").filter({ hasText: /Showing \d+ of \d+ match/ }).or(dialog.getByRole("heading", { name: "No matches in the indexed material" }))).toBeVisible();
  return dialog.getByRole("list", { name: "Search results" });
}

// ---- the concept map --------------------------------------------------------------------------------------------------------
type ConceptPane = "Outline" | "Map" | "Sources" | "Questions" | "Evidence";
const conceptPane = (page: Page, name: ConceptPane): Locator => page.getByRole("tab", { name: new RegExp(`^${name}\\s*\\d*$`) });
async function openConceptPane(page: Page, name: ConceptPane): Promise<void> {
  const tab = conceptPane(page, name);
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}
/** The outline of the explorer: a pane on a narrow window, the left zone (opened if it is closed) on a wide one. */
async function showOutline(page: Page): Promise<Locator> {
  if (isNarrow(page)) await openConceptPane(page, "Outline");
  else {
    const toggle = page.getByTestId("outline-toggle");
    if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  }
  const tree = page.getByRole("tree", { name: "Concept outline" });
  await expect(tree).toBeVisible();
  return tree;
}
async function showMap(page: Page): Promise<Locator> {
  if (isNarrow(page)) await openConceptPane(page, "Map");
  const map = page.getByTestId("concept-map");
  await expect(map).toBeVisible();
  await mapSettled(map);
  return map;
}
/** The map is drawn: its nodes are placed (nothing moves between two looks) and none is still being measured. */
async function mapSettled(map: Locator): Promise<void> {
  const look = (): Promise<string> => map.evaluate((root) => {
    const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-map-node]"));
    if (nodes.length === 0) return "";
    return nodes.map((node) => { const box = node.getBoundingClientRect(); return `${node.dataset.mapNode}:${getComputedStyle(node).visibility}:${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)},${Math.round(box.height)}`; }).join("|")
      + `|edges:${root.querySelectorAll("[data-edge]").length}|unplaced:${root.querySelectorAll(".opacity-0").length}`;
  });
  let last = "?";
  await expect.poll(async () => {
    const now = await look();
    const settled = now !== "" && now === last && !now.includes(":hidden:") && now.endsWith("|unplaced:0");
    last = now;
    return settled;
  }, { intervals: [200], timeout: 15_000, message: "the concept map did not settle" }).toBe(true);
}
/** The detail of the selected item under one of its three tabs (panes on a narrow window). */
async function showDetail(page: Page, name: "Sources" | "Questions" | "Evidence"): Promise<Locator> {
  await openConceptPane(page, name);
  const detail = page.getByTestId("outline-detail");
  await expect(detail).toBeVisible();
  return detail;
}
async function openConcepts(page: Page, query: string = ""): Promise<void> {
  await page.goto(`/courses/${COURSE}/concepts${query}`);
  await expect(page.getByTestId("concept-explorer")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Concept map" })).toBeVisible();
}
/** What an empty scope says, in the pane in front (a narrow window keeps one such statement per pane). */
const emptyScope = (page: Page): Locator => page.locator('[data-testid="concept-scope-empty"]:visible');
const treeItem = (tree: Locator, nodeId: string): Locator => tree.locator(`[role="treeitem"][data-node="${nodeId}"]`);
const treeAction = (item: Locator): Locator => item.locator(":scope > [data-row] [data-tree-action]");
/** Open every closed topic, concept and skill row (questions stay closed: their criteria are not counted in a heading). */
async function expandOutline(tree: Locator): Promise<void> {
  const closed = tree.locator('[role="treeitem"][aria-expanded="false"]:is([data-kind="topic"], [data-kind="concept"], [data-kind="skill"])');
  // A tree that has just changed scope may still be the earlier one for a moment: "nothing closed" counts only when it
  // is seen twice in a row.
  for (let guard = 0, quiet = 0; guard < 160; guard += 1) {
    if ((await closed.count()) === 0) {
      quiet += 1;
      if (quiet >= 2 && (await tree.locator('[role="treeitem"]').count()) > 0) return;
      await tree.page().waitForTimeout(250);
      continue;
    }
    quiet = 0;
    await closed.first().locator(':scope > [data-row] > button[aria-label^="Expand "]').click();
  }
  throw new Error("the outline did not finish expanding");
}
interface OutlineRows { byKind: Record<string, string[]>; instances: string[]; siblingsRepeat: string[] }
/** The rows of a tree as they stand: distinct node ids by kind, every row's instance path, and any id repeated among siblings. */
const outlineRows = (tree: Locator): Promise<OutlineRows> => tree.evaluate((root) => {
  const byKind: Record<string, Set<string>> = {};
  const instances: string[] = [];
  const siblingsRepeat: string[] = [];
  for (const item of Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]'))) {
    const kind = item.dataset.kind ?? "?";
    const node = item.dataset.node ?? "?";
    (byKind[kind] ??= new Set()).add(node);
    instances.push(item.dataset.instance ?? `${item.parentElement?.closest<HTMLElement>('[role="treeitem"]')?.dataset.node ?? ""}>${node}`);
  }
  for (const group of [root, ...Array.from(root.querySelectorAll('[role="group"]'))]) {
    const ids = Array.from(group.children).filter((child) => child.getAttribute("role") === "treeitem").map((child) => (child as HTMLElement).dataset.node ?? "?");
    for (const id of ids) if (ids.indexOf(id) !== ids.lastIndexOf(id) && !siblingsRepeat.includes(id)) siblingsRepeat.push(id);
  }
  return { byKind: Object.fromEntries(Object.entries(byKind).map(([kind, ids]) => [kind, [...ids].sort()])), instances, siblingsRepeat };
});
/**
 * The outline with every topic, concept and skill row open. The rows of a row arrive a moment after it opens, so the
 * tree is opened until what it lists is what its heading counts; a tree that never gets there fails here.
 */
async function openWholeOutline(page: Page): Promise<Locator> {
  const tree = await showOutline(page);
  await expect(async () => {
    await expandOutline(tree);
    const rows = await outlineRows(tree);
    const heading = await textOf(page.getByTestId("outline-scope-count"));
    expect({ concepts: rows.byKind.concept?.length ?? 0, skills: rows.byKind.skill?.length ?? 0, questions: rows.byKind.question?.length ?? 0 }, `distinct rows under "${heading}"`).toEqual(countsIn(heading));
  }).toPass({ timeout: 30_000 });
  return tree;
}
interface Counts { concepts: number; skills: number; questions: number }
const countsIn = (text: string): Counts => {
  const match = /(\d+) concepts?,? (?:and )?(\d+) skills?,? (?:and )?(\d+) questions?/.exec(text);
  if (!match) throw new Error(`no counts in "${text}"`);
  return { concepts: Number(match[1]), skills: Number(match[2]), questions: Number(match[3]) };
};
/** The heading of the outline states its scope and counts, and the counts equal the distinct rows beneath it. */
async function expectHeadingEqualsRows(page: Page, heading: string): Promise<Counts> {
  const tree = await showOutline(page);
  await expect.poll(() => textOf(page.getByTestId("outline-scope-count"))).toBe(heading);
  const counts = countsIn(heading);
  // The rows follow the heading within a moment of a scope change: opened and counted until they stand.
  await expect(async () => {
    await expandOutline(tree);
    const rows = await outlineRows(tree);
    expect({ concepts: rows.byKind.concept?.length ?? 0, skills: rows.byKind.skill?.length ?? 0, questions: rows.byKind.question?.length ?? 0 }, `distinct rows under "${heading}"`).toEqual(counts);
    expect(rows.siblingsRepeat, "an entry listed twice under one parent").toEqual([]);
    expect(new Set(rows.instances).size, "every row is one place of the tree").toBe(rows.instances.length);
  }).toPass({ timeout: 30_000 });
  return counts;
}
const mapNodeIds = (map: Locator, type?: string): Promise<string[]> =>
  map.locator(type ? `[data-map-node][data-type="${type}"]` : "[data-map-node]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-map-node") ?? ""));
/** Smallest rendered text height in the map (font size × the scale it is drawn at), and labels under 12 px. */
const mapLabels = (map: Locator): Promise<{ labels: number; smallest: number; under: string[] }> => map.evaluate((root) => {
  const under: string[] = [];
  let labels = 0;
  let smallest = Number.POSITIVE_INFINITY;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const words = (node.textContent ?? "").trim();
    const el = node.parentElement;
    if (!words || !el || el.closest("title, .sr-only")) continue;
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || box.width === 0 || box.height === 0) continue;
    const scale = el instanceof HTMLElement && el.offsetHeight > 0 ? box.height / el.offsetHeight : 1;
    const px = Number.parseFloat(style.fontSize) * scale;
    labels += 1;
    smallest = Math.min(smallest, px);
    if (px < 11.99) under.push(`${px.toFixed(2)} px "${words.slice(0, 40)}"`);
  }
  return { labels, smallest, under };
});
/** Pairs of drawn node boxes that overlap by more than a pixel. */
const mapOverlaps = (map: Locator): Promise<string[]> => map.evaluate((root) => {
  const boxes = Array.from(root.querySelectorAll<HTMLElement>("[data-map-node]")).map((node) => ({ id: node.dataset.mapNode ?? "", box: node.getBoundingClientRect() }));
  const pairs: string[] = [];
  for (let a = 0; a < boxes.length; a += 1) for (let b = a + 1; b < boxes.length; b += 1) {
    const x = Math.min(boxes[a]!.box.right, boxes[b]!.box.right) - Math.max(boxes[a]!.box.left, boxes[b]!.box.left);
    const y = Math.min(boxes[a]!.box.bottom, boxes[b]!.box.bottom) - Math.max(boxes[a]!.box.top, boxes[b]!.box.top);
    if (x > 1 && y > 1) pairs.push(`${boxes[a]!.id} × ${boxes[b]!.id}`);
  }
  return pairs;
});
interface DrawnEdge { family: string; line: string; title: string; dash: string; double: boolean; arrow: boolean }
const drawnEdges = (map: Locator): Promise<DrawnEdge[]> => map.locator("[data-edge]").evaluateAll((edges) => edges.map((edge) => {
  const paths = Array.from(edge.querySelectorAll("path"));
  const stroke = paths.find((path) => path.getAttribute("fill") === "none" && path.getAttribute("stroke") !== "transparent");
  return {
    family: edge.getAttribute("data-family") ?? "", line: edge.getAttribute("data-line") ?? "", title: (edge.querySelector("title")?.textContent ?? "").trim(),
    dash: stroke ? getComputedStyle(stroke).strokeDasharray : "?",
    double: paths.filter((path) => path.getAttribute("fill") === "none" && path.getAttribute("stroke") !== "transparent").length > 1,
    arrow: paths.some((path) => path.hasAttribute("transform")),
  };
}));

// ---- practice --------------------------------------------------------------------------------------------------------------
/** Answer a question on its practice page and wait for the fixture tutor's feedback card of that answer. */
async function answer(page: Page, questionId: string, words: string, how: { solutionSeen?: boolean } = {}): Promise<Locator> {
  await page.goto(`/courses/${COURSE}/questions/${questionId}`);
  await expect(page.locator("#practice-answer")).toBeVisible();
  if (how.solutionSeen && !(await page.getByText("Solution seen — recorded").isVisible())) {
    page.once("dialog", (dialog) => void dialog.accept()); // "Mark that you looked at a solution for this question? …"
    await page.getByRole("button", { name: "I looked at a solution" }).click();
    await expect(page.getByText("Solution seen — recorded")).toBeVisible();
  }
  await page.locator("#practice-answer").fill(words);
  await page.getByTestId("submit-answer").click();
  const card = page.getByTestId("request-card").filter({ hasText: words });
  await expect(card.getByTestId("feedback")).toBeVisible({ timeout: 30_000 });
  await settle(page.request);
  return card;
}

// ---- state a test changed and must put back ------------------------------------------------------------------------------------
const anchorsFile = (testInfo: TestInfo): string => {
  const repo = resolve(testInfo.config.rootDir, "..", "..");
  const area = process.env.LL_E2E_AREA ? resolve(repo, process.env.LL_E2E_AREA) : join(repo, ".local", "e2e");
  return join(area, "state", "inferred-anchors", `${COURSE}.json`);
};
let anchorsOriginal: string | null = null;
async function expectRematched(page: Page, done: string): Promise<void> {
  await showSlide(page);
  const notice = page.getByTestId("stage-notice");
  await expect(notice).toContainText(`${done} The recording was matched to the pages again with your correction.`, { timeout: 20_000 });
  await notice.getByRole("button", { name: "Dismiss this message" }).click();
  await expect(notice).toBeHidden();
}
async function recordGrouping(page: Page, choice: RegExp): Promise<void> {
  await showSlide(page);
  await page.getByRole("button", { name: /^More: finish the session/ }).click();
  await page.getByRole("menuitem", { name: "Correct the grouping of this page" }).click();
  const dialog = page.getByRole("dialog", { name: "Correct the grouping of this page" });
  await expect(dialog.getByTestId("grouping-dialog")).toBeVisible();
  await dialog.getByRole("radio", { name: choice }).check();
  await dialog.getByRole("button", { name: "Record the correction" }).click();
  await expect(dialog).toBeHidden();
  await expectRematched(page, /Take back your correction/.test(choice.source) ? "Your correction was taken back. The grouping is again what held before it." : "The grouping was recorded as your correction. The file itself is unchanged.");
}
interface OverrideRecord { revision: number; author?: string | { kind?: string } | null; status?: string; reverted_by?: number | null; op?: { type?: string } | null }
/** After a FAILED test only: put back the suggestions file, clear decisions on suggested links and take back grouping corrections of the showcase lecture. */
async function restoreAfterFailure(page: Page, testInfo: TestInfo): Promise<void> {
  if (anchorsOriginal !== null) writeFileSync(anchorsFile(testInfo), anchorsOriginal);
  const view = (await (await page.request.get(`/api/courses/${COURSE}/lectures/${LECTURE}`)).json()) as LectureView;
  const decided = new Set(view.slides.flatMap((slide) => slide.question_ties).filter((tie) => tie.suggestion_id && tie.learner_decision).map((tie) => tie.suggestion_id!));
  // (A rejected suggestion is no tie any more, so its id is not in the view: the one R2-Q5 rejects is named here.)
  for (const id of ["ia-529234887a51ecfc", ...decided]) await page.request.post(`/api/courses/${COURSE}/suggestions/${id}/decision`, { data: { decision: "cleared" } }).catch(() => undefined);
  const base = `/api/courses/${COURSE}/lectures/${LECTURE}`;
  const map = (await (await page.request.get(`${base}/source-map`)).json()) as { overrides?: OverrideRecord[] };
  const inForce = (map.overrides ?? [])
    .filter((record) => (typeof record.author === "string" ? record.author : record.author?.kind) === "learner" && record.status === "applied" && record.reverted_by == null && record.op?.type !== "revert")
    .map((record) => record.revision);
  if (inForce.length > 0) {
    await page.request.post(`${base}/source-map/overrides`, { data: { op: "revert", value: inForce, reason: "Left in force by a failed browser test" } });
    await page.request.post(`${base}/timing/build`);
  }
}

test.describe("R2 on screen: questions tied to slides, and the concept map", () => {
  test.beforeEach(async ({ page }) => {
    if (!isNarrow(page)) await page.setViewportSize({ width: 1440, height: 900 });
    await pair(page);
  });
  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    await restoreAfterFailure(page, testInfo).catch(() => undefined);
  });

  // ==== questions =============================================================================================================

  test("R2-Q1 a question with no slide, one of a lecture with no recording and one without wording are each in the bank, in their lecture's list and in search; the totals on screen are the Brain's", async ({ page }) => {
    test.setTimeout(120_000);
    // Not in the fixture: a question in a collection of a lecture WITHOUT a deck (each of the five fixture lectures has one).
    const NO_SLIDE = { id: "BE505-L01-Q04", lecture: "lecture-01", words: "One molecule, several jobs" };
    const NO_AUDIO = { id: "BE505-L04-Q02", lecture: "lecture-04", words: "Reading a lag" };
    const NO_WORDING = { id: "BE505-L04-CLASS-Q01", lecture: "lecture-04", words: "In-class question 1" };
    const bankTotal = (await api<{ total: number }>(page, `courses/${COURSE}/questions`)).total;

    // The premise of "no audio", read off the screen: lecture 04 has no recording.
    await page.goto("/study");
    const courseTab = page.getByTestId("course-tabs").locator(`[data-course="${COURSE}"]`);
    await courseTab.click();
    await expect(courseTab).toHaveAttribute("aria-selected", "true");
    const pane = page.locator(`[data-testid="course-pane"][data-course="${COURSE}"]`);
    await expect.poll(() => textOf(pane.locator('[data-testid="lecture-row"][data-lecture="lecture-04"]'))).toContain("no recording");
    await expect.poll(() => textOf(pane.getByTestId("course-counts"))).toContain(`${bankTotal} questions in the catalog`);

    // The bank: the total, the rows and the count line are one number, the Brain's.
    await pane.getByRole("link", { name: "Question bank" }).click();
    const bank = page.getByTestId("question-bank");
    await expect.poll(() => textOf(bank.getByTestId("bank-total"))).toBe(`${bankTotal} questions in the course catalog`);
    await expect.poll(() => textOf(bank.getByTestId("bank-count"))).toBe(`Showing ${bankTotal} of ${bankTotal}`);
    await expect(bank.locator(ROW)).toHaveCount(bankTotal);
    for (const question of [NO_SLIDE, NO_AUDIO, NO_WORDING]) await expect(row(bank, question.id)).toHaveCount(1);
    // The question without wording says where its wording is and still offers its original.
    const unworded = row(bank, NO_WORDING.id);
    await expect.poll(() => textOf(unworded.getByTestId("question-prompt"))).toBe("The wording of this question is kept in its original source. Open the source to read it.");
    await unworded.getByRole("link", { name: startsWith("Open the source question: L04-class, question 1") }).click();
    await expect(page.getByRole("heading", { level: 1, name: "In-class question 1" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Open original/ })).toHaveAttribute("href", `/courses/${COURSE}/sources/src-lecture-04-in-class-questions?page=1`);

    // Each one in the All lecture questions list of its lecture; that list's heading, its rows and the Brain's total agree.
    for (const lecture of ["lecture-01", "lecture-04"]) {
      const all = (await lectureView(page, lecture)).questions.counts.all;
      await openQuestions(page, 2, lecture);
      await openSection(page, "All lecture questions");
      expect(await sectionCount(page, "All lecture questions"), `${lecture}: heading`).toBe(all);
      await expect(lectureRows(page)).toHaveCount(all);
      for (const question of [NO_SLIDE, NO_AUDIO, NO_WORDING].filter((q) => q.lecture === lecture)) await expect(row(lectureList(page), question.id)).toHaveCount(1);
    }
    // The question with no slide has a line of its own, never a bare "no slide named".
    await openQuestions(page, 2, "lecture-01");
    await openSection(page, "All lecture questions");
    await expect.poll(() => textOf(row(lectureList(page), NO_SLIDE.id).getByTestId("question-no-link"))).toBe("No suggested link. None is recorded for this question.");

    // Each one by search, with the words a learner knows it by.
    await page.goto("/study");
    for (const question of [NO_SLIDE, NO_AUDIO, NO_WORDING]) {
      const dialog = await openSearch(page);
      const results = await search(dialog, question.words);
      await expect(results.locator(`a[href="/courses/${COURSE}/questions/${question.id}"]`)).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
  });

  test("R2-Q2 the question with a reviewed page anchor in a build group is under This slide on exactly its pages, labelled Exact; its transcript lines open as lines, never as a page", async ({ page }) => {
    test.setTimeout(180_000);
    // Not in the fixture: a reviewed anchor on ONE build of a group (the fixture's names all three, so it reads
    // "Group-level"); "on this build" and "elsewhere in this sequence" are pinned on the suggested link in R2-Q6.
    // Not in the app: a criterion or concept reference on a question card that opens the Concepts tab at that node
    // (test-plan clause; the cards name criteria in words only). Reported, not asserted.
    const anchored = (await lectureView(page)).slides.filter((slide) => slide.question_ties.some((tie) => tie.question_id === Q01 && tie.tie === "exact")).map((slide) => slide.page);
    expect(anchored, "the pages the course record anchors the question on").toEqual([4, 5, 6]);

    for (let physical = 1; physical <= PAGES; physical += 1) {
      await openQuestions(page, physical);
      if (STRUCTURAL[physical]) {
        await expect(page.getByTestId("this-slide-list")).toHaveCount(0);
        continue;
      }
      await expect(sectionButton(page, "This slide")).toBeVisible();
      const mine = row(page.getByTestId("this-slide-list"), Q01);
      if (!anchored.includes(physical)) {
        await expect(mine, `page ${physical}`).toHaveCount(0);
        continue;
      }
      await expect.poll(() => textOf(basis(mine, "exact")), `page ${physical}`).toBe("Exact. A reviewed anchor of the course record names this page. Group-level: all 3 builds.");
      const others = anchored.filter((other) => other !== physical);
      const sources = mine.getByTestId("question-sources");
      await expect.poll(() => textOf(sources.locator('[aria-current="page"]'))).toBe(`p. ${physical} on screen`);
      for (const other of others) await expect(sources.getByRole("link", { name: named(`p. ${other} build ${other - 3} of 3`) })).toBeVisible();
      // Its pages are these three and nothing else; the lines are named as lines.
      expect((await textOf(sources)).match(/p\. \d+/g)).toEqual(["p. 4", "p. 5", "p. 6"]);
      await expect(sources.getByRole("link", { name: named("transcript lines 9–17") })).toBeVisible();
    }

    // A build link turns to that build; Back returns to the list.
    await openQuestions(page, 4);
    await row(page.getByTestId("this-slide-list"), Q01).getByRole("link", { name: named("p. 6 build 3 of 3") }).click();
    await expectIdentity(page, 6, "PDF page 6 of 14 · build 3 of 3");
    await page.goBack();
    await expect.poll(() => param(page, "page")).toBe("4");
    await expect(page.getByTestId("questions-tab")).toBeVisible();

    // The transcript lines open in the Transcript tab at line 9; the page on screen stays the page it was.
    await row(page.getByTestId("this-slide-list"), Q01).getByRole("link", { name: named("transcript lines 9–17") }).click();
    await expect(page.getByRole("tab", { name: /^Transcript$/ })).toHaveAttribute("aria-selected", "true");
    const lines = page.getByTestId("transcript-lines");
    await expect(lines.locator('li[data-line="9"]')).toHaveAttribute("aria-current", "true");
    for (const line of [9, 13, 17]) await expect(lines.locator(`li[data-line="${line}"]`)).toHaveCount(1);
    expect(param(page, "page")).toBe("4");
    expect(param(page, "line")).toBe("9");
    await expectIdentity(page, 4, "PDF page 4 of 14 · build 1 of 3");

    // In the lecture's whole list the same anchor is said for the lecture: its pages and, apart, its lines.
    await openQuestions(page, 2);
    await openSection(page, "All lecture questions");
    await expect.poll(() => textOf(basis(row(lectureList(page), Q01), "exact"))).toBe("Exact. A reviewed anchor of the course record names pp. 4–6 and transcript lines 9–17.");
  });

  test("R2-Q3 a suggested link is on the card, in All lecture questions and under This slide with its page, criteria, rationale and check; an all-rejected question and one with no candidate each say so with the reason", async ({ page }) => {
    const WHY = "Why: Synthetic fixture: the page writes the line and names its slope and blank.";
    // Under This slide on the suggested page.
    await openQuestions(page, 10);
    const onSlide = row(page.getByTestId("this-slide-list"), Q04);
    await expect.poll(() => textOf(onSlide.getByTestId("question-sources"))).toBe("Sources p. 10 on screen");
    const suggested = basis(onSlide, "agent_inferred");
    const words = await textOf(suggested);
    expect(words).toContain("Suggested link, checked by a second pass.");
    expect(words).toContain("Supports 1 of 2 criteria, each in part: criterion 2 (Calibration line).");
    expect(words).toContain("This page supports 1 of 2.");
    expect(words).toContain("The second pass kept fewer pages or criteria than first proposed.");
    await expect.poll(() => textOf(suggested.getByTestId("question-rationale"))).toBe(WHY);
    await expect(suggested.getByRole("button", { name: startsWith("Accept the suggested link of L05, question 4") })).toBeVisible();
    await expect(suggested.getByRole("button", { name: startsWith("Reject the suggested link of L05, question 4") })).toBeVisible();

    // In All lecture questions, from another page: the same link, its page as a link that turns to it.
    await openQuestions(page, 2);
    await openSection(page, "All lecture questions");
    const inList = basis(row(lectureList(page), Q04), "agent_inferred");
    const listed = await textOf(inList);
    expect(listed).toContain("Suggested link, checked by a second pass. p. 10 supports 1 of 2 criteria, each in part: criterion 2 (Calibration line).");
    expect(listed).toContain(WHY);
    // The question whose candidates were all rejected, and the unchecked one, in the same list.
    const rejected = row(lectureList(page), CLASS).getByTestId("question-no-link");
    await expect(rejected).toHaveAttribute("data-state", "inspected_no_support");
    await expect.poll(() => textOf(rejected)).toBe("Inspected, no supporting page found. Synthetic fixture: no page of the deck shows the sketch this question asks for; it is answered on the in-class sheet.");
    expect(await textOf(basis(row(lectureList(page), Q02), "agent_inferred"))).toContain("Suggested link, not yet checked.");
    // Every row of the list says what ties it or why nothing does; "no slide named" stands alone nowhere.
    for (const item of await lectureRows(page).all()) expect(await item.locator('[data-testid="question-basis"], [data-testid="question-no-link"]').count(), await textOf(item.getByTestId("question-name"))).toBeGreaterThan(0);
    expect(await questionsTabText(page)).not.toMatch(/no slide (is )?named/i);
    await inList.getByRole("link", { name: named("p. 10") }).click();
    await expectIdentity(page, 10, "PDF page 10 of 14");

    // On the question's own card.
    await page.goto(`/courses/${COURSE}/questions/${Q04}`);
    const links = page.getByTestId("question-links");
    const card = await textOf(links);
    expect(card).toContain("Suggested link, checked by a second pass.");
    expect(card).toContain("Supports 1 of 2 criteria, each in part: criterion 2 (Calibration line).");
    expect(card).toContain(WHY);
    await expect(links.getByRole("link", { name: named("p. 10") })).toHaveAttribute("href", `/courses/${COURSE}/lectures/${LECTURE}?page=10&panel=questions`);
    await page.goto(`/courses/${COURSE}/questions/${CLASS}`);
    expect(await textOf(page.getByTestId("question-links"))).toContain("Inspected, no supporting page found. Synthetic fixture: no page of the deck shows the sketch this question asks for; it is answered on the in-class sheet.");

    // A question with no candidate at all: "No suggested link" with the recorded reason.
    await page.goto(`/courses/${COURSE}/questions/BE505-L01-Q04`);
    expect(await textOf(page.getByTestId("question-links"))).toContain("No suggested link. None is recorded for this question.");
    await openQuestions(page, 2, "lecture-01");
    await openSection(page, "All lecture questions");
    const none = row(lectureList(page), "BE505-L01-Q04").getByTestId("question-no-link");
    await expect(none).toHaveAttribute("data-state", "no_suggestion");
    await expect.poll(() => textOf(none)).toBe("No suggested link. None is recorded for this question.");
    expect(await questionsTabText(page)).not.toMatch(/no slide (is )?named/i);
    // Not on screen: the suggested link on the question's row in the question BANK (the bank lists lecture questions
    // without their ties; the bank answer of the Brain carries none). Reported, not asserted.
  });

  test("R2-Q4 a partial link reads as partial and names its criteria; nothing says a slide teaches or answers the whole question; a candidate the checking pass dropped is no link; a problem-set question gets no page from its number", async ({ page }) => {
    test.setTimeout(120_000);
    // Partial, unchecked: the criteria it supports, each in part.
    await openQuestions(page, 5);
    const partial = await textOf(basis(row(page.getByTestId("this-slide-list"), Q02), "agent_inferred"));
    expect(partial).toContain("Suggested link, not yet checked.");
    expect(partial).toContain("Supports 2 of 3 criteria, each in part: criterion 1 (Reporter gene) and criterion 2 (Ribosome binding site).");
    // A link that supports ALL catalogued criteria still reads as support of criteria, and agent checking is never "confirmed".
    await openQuestions(page, 7);
    const full = await textOf(basis(row(page.getByTestId("this-slide-list"), Q03), "agent_inferred"));
    expect(full).toContain("Suggested link, checked by a second pass. Supports 1 of 1 criteria: criterion 1 (Blank subtraction).");
    expect(full).not.toMatch(/confirmed/i);
    // No card on any content page says that a slide teaches or answers the whole question.
    const WHOLE = /\bteach(es|ing)?\b|\banswers? (the|this|its) (whole |entire )?question\b|\b(whole|entire|complete) (question|answer)\b|\bcovers? the question\b/i;
    for (const physical of [4, 5, 6, 7, 8, 10, 12]) {
      await openQuestions(page, physical);
      expect(await questionsTabText(page), `page ${physical}`).not.toMatch(WHOLE);
    }
    // The candidate the checking pass dropped (the worked numbers on p. 12) is not a link: p. 12 lists the question only
    // as concept-related, and the question's link names p. 10 alone.
    await openQuestions(page, 12);
    await expect(row(page.getByTestId("this-slide-list"), Q04)).toHaveCount(0);
    await expect(thisSlideRows(page)).toHaveCount(1);
    await openSection(page, "Related concepts");
    await expect.poll(() => textOf(basis(row(page.getByTestId("related-list"), Q04), "concept_related"))).toBe("Concept-related. Through 'Calibration line'. Not a claim about this slide.");
    await openSection(page, "All lecture questions");
    const narrowed = basis(row(lectureList(page), Q04), "agent_inferred");
    expect((await textOf(narrowed)).match(/pp?\. [\d–]+/g)).toEqual(["p. 10"]);
    // A question whose candidates were ALL rejected shows no page link at all.
    const allRejected = row(lectureList(page), CLASS);
    await expect(allRejected.getByTestId("question-no-link")).toBeVisible();
    await expect(allRejected.locator('[data-testid="question-basis"]')).toHaveCount(0);
    await expect(allRejected.locator('a[href*="page="]')).toHaveCount(0);

    // The problem-set question (number 2): its page is a page of its own file, never page 2 of a lecture deck.
    await page.goto(`/courses/${COURSE}/questions`);
    const problem = row(page.getByTestId("question-bank"), "BE505-PS01-Q02");
    expect(await textOf(problem)).toContain("Stated. The course record names p. 2 of its source file, not a slide of the deck. Its page basis is not reviewed.");
    await expect(problem.locator('a[href*="/lectures/"]')).toHaveCount(0);
    // On page 2 of a lecture it is no question of that slide and no question of that lecture. Where it is listed at all,
    // it is as concept-related ("not a claim about this slide") and without a page.
    for (const lecture of ["lecture-01", LECTURE]) {
      await openQuestions(page, 2, lecture);
      await questionsTabText(page);
      await expect(row(page.getByTestId("this-slide-list"), "BE505-PS01-Q02"), `${lecture}, page 2: This slide`).toHaveCount(0);
      await expect(row(lectureList(page), "BE505-PS01-Q02"), `${lecture}, page 2: All lecture questions`).toHaveCount(0);
      for (const elsewhere of await row(page.getByTestId("questions-tab"), "BE505-PS01-Q02").all()) {
        expect(await textOf(elsewhere.locator('[data-testid="question-basis"]'))).toMatch(/^Concept-related\. Through '.+'\. Not a claim about this slide\.$/);
        await expect(elsewhere.locator('a[href*="page="]')).toHaveCount(0);
      }
    }
  });

  test("R2-Q5 Exact, Stated, Suggested link and Concept-related rows each carry their own label and keep it; Accept, Reject and Take back survive a reload, and an accepted link survives regenerated suggestions", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const file = anchorsFile(testInfo);
    expect(existsSync(file), `the suggestions file of this test instance: ${file}`).toBe(true);
    const ACCEPT = startsWith("Accept the suggested link of L05, question 4");
    const REJECT = startsWith("Reject the suggested link of L05, question 4");
    const TAKE_BACK = startsWith("Take back your decision on the suggested link of L05, question 4");
    const CHECKED = "Suggested link, checked by a second pass.";

    /** The four kinds of row on the lecture, each under its own label. */
    const expectLabels = async (): Promise<void> => {
      await openQuestions(page, 4);
      expect(await textOf(basis(row(page.getByTestId("this-slide-list"), Q01), "exact"))).toMatch(/^Exact\. /);
      expect(await textOf(basis(row(page.getByTestId("this-slide-list"), Q02), "agent_inferred"))).toMatch(/^Suggested link, not yet checked\. /);
      await openSection(page, "Related concepts");
      expect(await textOf(basis(row(page.getByTestId("related-list"), CLASS), "concept_related"))).toBe("Concept-related. Through 'Reporter gene'. Not a claim about this slide.");
      await openQuestions(page, 12);
      expect(await textOf(basis(row(page.getByTestId("this-slide-list"), PRACTICE), "stated"))).toBe("Stated. The course record names this page. Its page basis is not reviewed.");
    };
    await expectLabels();

    // Accept: the link reads as confirmed by the learner (never as Exact or Stated), also after a reload.
    await openQuestions(page, 10);
    const mine = (): Locator => basis(row(page.getByTestId("this-slide-list"), Q04), "agent_inferred");
    expect(await textOf(mine())).toContain(CHECKED);
    await mine().getByRole("button", { name: ACCEPT }).click();
    await expect.poll(() => textOf(mine())).toContain("Suggested link, confirmed by you.");
    await expect(mine().getByRole("button", { name: TAKE_BACK })).toBeVisible();
    await page.reload();
    await expect.poll(() => textOf(mine())).toContain("Suggested link, confirmed by you. Supports 1 of 2 criteria, each in part: criterion 2 (Calibration line).");
    await expect(mine().getByRole("button", { name: ACCEPT })).toHaveCount(0);

    // The suggestions are produced again (the same items, a new production time): the Brain reads the new file, and the
    // learner's decision and every label stand.
    const before = (await lectureView(page)).revisions.inferred_anchors_sha256;
    anchorsOriginal = readFileSync(file, "utf8");
    try {
      const produced = JSON.parse(anchorsOriginal) as { produced_at: string };
      produced.produced_at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
      writeFileSync(file, JSON.stringify(produced, null, 1));
      await expect.poll(async () => (await lectureView(page)).revisions.inferred_anchors_sha256, { timeout: 20_000 }).not.toBe(before);
      await page.reload();
      await expect.poll(() => textOf(mine())).toContain("Suggested link, confirmed by you.");
      await expect(mine().getByRole("button", { name: TAKE_BACK })).toBeVisible();
      await expectLabels();
    } finally {
      writeFileSync(file, anchorsOriginal);
      await expect.poll(async () => (await lectureView(page)).revisions.inferred_anchors_sha256, { timeout: 20_000 }).toBe(before);
      anchorsOriginal = null;
    }

    // Take back: the suggestion is a suggestion again.
    await openQuestions(page, 10);
    await mine().getByRole("button", { name: TAKE_BACK }).click();
    await expect.poll(() => textOf(mine())).toContain(CHECKED);
    await expect.poll(() => textOf(mine().getByTestId("question-decision"))).toBe("Accept Reject Your decision is kept on this device and survives new suggestions.");

    // Reject: no longer a link of this slide; it is said once, with Take back beside it.
    await mine().getByRole("button", { name: REJECT }).click();
    const stub = page.getByTestId("this-slide-list").getByTestId("rejected-stub");
    await expect.poll(() => textOf(stub)).toContain("You rejected the suggested link p. 10.");
    await expect.poll(() => textOf(page.getByTestId("questions-announce"))).toBe(`You rejected the suggested link p. 10 of ${NAME[Q04]}. Take back is beside it.`);
    await expect(thisSlideRows(page)).toHaveCount(0);
    expect(await sectionCount(page, "This slide")).toBe(0);
    // After a reload it is still no link: not under This slide, and in the lecture's list a line says why.
    await page.reload();
    await expect(page.getByTestId("questions-tab")).toBeVisible();
    await expect.poll(() => sectionCount(page, "This slide")).toBe(0);
    await expect(row(page.getByTestId("this-slide-list"), Q04)).toHaveCount(0);
    await openSection(page, "All lecture questions");
    const inList = row(lectureList(page), Q04);
    await expect(basis(inList, "agent_inferred")).toHaveCount(0);
    const noLink = inList.getByTestId("question-no-link");
    await expect.poll(() => textOf(noLink)).toContain("No suggested link. You rejected the one that was suggested.");
    // It stays in the record: "Show it" names what was rejected, not as a link of the question, with Take back.
    await noLink.getByRole("button", { name: startsWith("Show it: the link you rejected for L05, question 4") }).click();
    const shown = noLink.getByTestId("rejected-suggestion");
    await expect.poll(() => textOf(shown)).toContain("The link you rejected named p. 10. It is not shown as a link.");
    await shown.getByRole("button", { name: TAKE_BACK }).click();
    await expect.poll(() => sectionCount(page, "This slide")).toBe(1);
    await expect.poll(() => textOf(mine())).toContain(CHECKED);
    await expect(mine().getByRole("button", { name: ACCEPT })).toBeVisible();
    await page.reload();
    await expect.poll(() => textOf(mine())).toContain(CHECKED);
    await expect(mine().getByRole("button", { name: REJECT })).toBeVisible();
  });

  test("R2-Q6 the number in each of the three headings equals the rows beneath it, All lecture questions equals the Brain's total, and every row of a build group says where its support is", async ({ page }) => {
    test.setTimeout(120_000);
    const counts = (await lectureView(page)).questions.counts;
    const expectCounts = async (physical: number): Promise<void> => {
      await questionsTabText(page);
      expect(await sectionCount(page, "This slide"), `page ${physical}: This slide`).toBe(await thisSlideRows(page).count());
      expect(await sectionCount(page, "Related concepts"), `page ${physical}: Related concepts`).toBe(await relatedRows(page).count());
      expect(await sectionCount(page, "All lecture questions"), `page ${physical}: All lecture questions`).toBe(await lectureRows(page).count());
      expect(await sectionCount(page, "All lecture questions"), `page ${physical}: the Brain's total`).toBe(counts.all);
      await expect.poll(() => textOf(page.getByTestId("lecture-questions-division")))
        .toBe(`${counts.all} questions: ${counts.course_anchor} anchored by the course, ${counts.agent_inferred} with a suggested link, ${counts.without_link} without a link.`);
    };
    const WHERE = /^(On this build|Elsewhere in this sequence|Group-level)\b/;
    const tieOf = (questionId: string): Promise<string> => textOf(row(page.getByTestId("this-slide-list"), questionId).getByTestId("question-tie"));
    const suggestedOf = (questionId: string): Promise<string> => textOf(basis(row(page.getByTestId("this-slide-list"), questionId), "agent_inferred"));

    // A content page with one suggested link.
    await openQuestions(page, 10);
    await expectCounts(10);
    expect(await thisSlideRows(page).count()).toBe(1);

    // The three builds of one slide: the same two questions on each, each row with its place in the sequence.
    const expected: Record<number, { tie: string; here: string | null }> = {
      4: { tie: "Elsewhere in this sequence: builds 2 and 3.", here: null },
      5: { tie: "On this build and on build 3.", here: "This page supports 1 of 3: criterion 1 (Reporter gene)." },
      6: { tie: "On this build and on build 2.", here: "This page supports 2 of 3." },
    };
    for (const physical of [4, 5, 6]) {
      await openQuestions(page, physical);
      await expectCounts(physical);
      await expect(thisSlideRows(page)).toHaveCount(2);
      expect(await tieOf(Q01), `page ${physical}`).toBe("Group-level: all 3 builds.");
      expect(await tieOf(Q02), `page ${physical}`).toBe(expected[physical]!.tie);
      for (const tie of await page.getByTestId("this-slide-list").getByTestId("question-tie").all()) expect(await textOf(tie)).toMatch(WHERE);
      const suggested = await suggestedOf(Q02);
      expect(suggested).toContain("Supports 2 of 3 criteria, each in part: criterion 1 (Reporter gene) and criterion 2 (Ribosome binding site).");
      // What THIS page supports is said only on a page that supports something; on build 1 the support is elsewhere.
      if (expected[physical]!.here) expect(suggested, `page ${physical}`).toContain(expected[physical]!.here!);
      else expect(suggested, `page ${physical}`).not.toMatch(/This page supports/);
    }
    // A slide in two steps: its one link is group-level.
    await openQuestions(page, 7);
    await expectCounts(7);
    expect(await tieOf(Q03)).toBe("Group-level: all 2 steps.");

    // A content page that nothing names: zero under This slide and a line that says so; the questions the course's study
    // map places in this PART of the lecture are listed apart, with their own count, and are not counted as This slide.
    await openQuestions(page, 3);
    await expectCounts(3);
    expect(await sectionCount(page, "This slide")).toBe(0);
    await expect.poll(() => textOf(page.getByTestId("lecture-questions-hint"))).toBe(`No question is tied to this page. This lecture has ${counts.all} questions; they are listed under All lecture questions.`);
    const part = page.getByTestId("section-ties");
    await expect.poll(() => textOf(part.getByRole("heading", { level: 4 }))).toBe("In this part of the lecture, by the course's study map: pp. 3–6 (The reporter gene and its construct) 2");
    await expect(part.locator(ROW)).toHaveCount(2);
    for (const questionId of [Q01, Q02]) await expect(basis(row(part, questionId), "section")).toHaveCount(1);
    expect(await textOf(basis(row(part, Q01), "section"))).toBe("Stated for a part of the lecture. The course's study map places it in pp. 3–6 and names no single page.");
  });

  test("R2-Q7 with a draft typed, a source-page link of the question opens that page of that file version; Back returns to the card with the draft intact", async ({ page }) => {
    // Not in the fixture: a link made for ANOTHER version of the deck (every fixture link is for the deck in use).
    const DRAFT = "Excite with blue light, then collect, then subtract — my own draft";
    await page.goto(`/courses/${COURSE}/questions/${Q03}`);
    await page.locator("#practice-answer").fill(DRAFT);
    await expect(page.getByText("Draft saved on this device")).toBeVisible();
    const link = page.getByTestId("question-links").getByRole("link", { name: named("p. 8") });

    // The link opens page 8 of the lecture's deck; one Back returns to the question, the draft as it was.
    await link.click();
    await expect(page.getByTestId("lecture-workspace")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/courses/${COURSE}/lectures/${LECTURE}\\?`));
    expect(param(page, "page")).toBe("8");
    if (!isNarrow(page)) await expectIdentity(page, 8, "PDF page 8 of 14 · step 2 of 2");
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "Steps of a plate reading" })).toBeVisible();
    await expect(page.locator("#practice-answer")).toHaveValue(DRAFT);

    // The same link again: the identity line of the page and the version of the file it belongs to are on screen.
    // (On a narrow window the link lands on the Questions pane of that page; the page itself is the Slide pane.)
    await link.click();
    await expect(page.getByTestId("lecture-workspace")).toBeVisible();
    await expectIdentity(page, 8, "PDF page 8 of 14 · step 2 of 2");
    await openTab(page, "Sources");
    const deck = await textOf(page.getByTestId("source-deck"));
    const version = /Fixture Lecture 05 - R2 showcase\.pdf · version (v1-[0-9a-f]{12})\b/.exec(deck)?.[1];
    expect(version, `the file and its version in "${deck}"`).toBeTruthy();
    expect(JSON.stringify(await lectureView(page)), "the version shown is the one the Brain reports for this lecture").toContain(version!);
    // The draft is still there when the question is opened again.
    await page.goto(`/courses/${COURSE}/questions/${Q03}`);
    await expect(page.locator("#practice-answer")).toHaveValue(DRAFT);
    await page.locator("#practice-answer").fill("");
  });

  test("R2-Q8 on a structural page the Questions tab keeps no This-slide list and no empty-state warning, and All lecture questions is there with its count", async ({ page }) => {
    const all = (await lectureView(page)).questions.counts.all;
    for (const [physical, role] of Object.entries(STRUCTURAL)) {
      const tab = await openQuestions(page, Number(physical));
      const note = tab.getByTestId("structural-note");
      await expect(note.getByRole("heading", { level: 3, name: role })).toBeVisible();
      expect(await textOf(note)).toContain("Lists for a single slide are not kept for a title, section, administrative or blank page. The lecture's questions stay available below.");
      // No This-slide list, no "nothing is tied to this page" line, no warning of any kind.
      await expect(tab.getByRole("button", { name: /^This slide/ })).toHaveCount(0);
      await expect(tab.getByRole("button", { name: /^Related concepts/ })).toHaveCount(0);
      await expect(tab.getByTestId("this-slide-list")).toHaveCount(0);
      await expect(tab.getByTestId("lecture-questions-hint")).toHaveCount(0);
      await expect(tab.locator('[role="alert"], [role="status"], [role="note"]')).toHaveCount(0);
      expect(await textOf(tab)).not.toMatch(/no questions?\b|nothing is tied|not tied/i);
      // The lecture's questions: open on arrival, the count is the Brain's and equals the rows.
      await expect(sectionButton(page, "All lecture questions")).toHaveAttribute("aria-expanded", "true");
      expect(await sectionCount(page, "All lecture questions")).toBe(all);
      await expect(lectureRows(page)).toHaveCount(all);
    }
    // "Next content" leaves the structural page for the next page that has a list of its own.
    await openQuestions(page, 1);
    await page.getByTestId("questions-tab").getByRole("button", { name: "Next content" }).click();
    await expect.poll(() => param(page, "page")).toBe("2");
    await expect(sectionButton(page, "This slide")).toBeVisible();
  });

  test("R2-Q9 (fixture stand-in; the private run on the real courses is not part of this suite) the three kinds of question, opened from the bank, list exactly the pages the course record holds", async ({ page }) => {
    // R2-Q9 itself is a private read-only run on the real profile, recorded as identifiers, page numbers and outcomes.
    // What this suite can pin is the same three kinds on the synthetic catalog, each opened by ordinary navigation.
    const view = await lectureView(page);
    const pagesOf = (questionId: string, tie: string): number[] => view.slides.filter((slide) => slide.question_ties.some((t) => t.question_id === questionId && t.tie === tie)).map((slide) => slide.page);
    const openFromBank = async (questionId: string, action: RegExp): Promise<Locator> => {
      await page.goto("/study");
      const tab = page.getByTestId("course-tabs").locator(`[data-course="${COURSE}"]`);
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await page.locator(`[data-testid="course-pane"][data-course="${COURSE}"]`).getByRole("link", { name: "Question bank" }).click();
      await row(page.getByTestId("question-bank"), questionId).getByRole("link", { name: action }).click();
      const links = page.getByTestId("question-links");
      await expect(links).toBeVisible();
      return links;
    };
    const pageLinks = async (links: Locator): Promise<number[]> =>
      (await links.locator('a[href*="/lectures/"][href*="page="]').evaluateAll((anchors) => anchors.map((a) => Number(new URL((a as HTMLAnchorElement).href).searchParams.get("page"))))).sort((a, b) => a - b);

    // The question with a reviewed map: exactly its physical pages, and its line map as lines.
    let links = await openFromBank(Q01, startsWith("Answer: L05, question 1"));
    expect(await pageLinks(links)).toEqual(pagesOf(Q01, "exact"));
    expect(await textOf(links)).toContain("Exact. p. 4, p. 5, p. 6, transcript lines 9–17. A reviewed anchor of the course record names these pages.");
    await expect(links.getByRole("link", { name: named("transcript lines 9–17") })).toHaveAttribute("href", `/courses/${COURSE}/lectures/${LECTURE}?panel=transcript&line=9`);

    // The coarse question: only the candidate the checking pass kept.
    links = await openFromBank(Q04, startsWith("Answer: L05, question 4"));
    expect(await pageLinks(links)).toEqual(pagesOf(Q04, "agent_inferred"));
    expect(await pageLinks(links)).toEqual([10]);

    // The problem-set question: the wording stays with its source, and nothing is added to it.
    links = await openFromBank("BE505-PS01-Q02", startsWith("Open the source question: PS01, question 2"));
    const prompt = page.locator('section[aria-labelledby="prompt-h"]');
    const words = await textOf(prompt);
    expect(words).toContain("The course's question index does not store the wording of this question; the original page is the authority, including its figures and givens.");
    expect(words).toContain("Stated. p. 2. A page of another file, not of the lecture's slides.");
    expect(words).not.toMatch(/Supports \d+ of \d+ criteria|Suggested link/);
    await expect(prompt.getByRole("link", { name: named("Open original, page 2") })).toHaveAttribute("href", `/courses/${COURSE}/sources/src-ps-01-brief?page=2`);
    expect(await pageLinks(links)).toEqual([]);
  });

  test("R2-Q10 no criterion wording and no answer guidance is on a question card, in a suggested link, in search or in a concept view before an attempt; a criterion is worded only in the feedback of an attempt", async ({ page, unique }) => {
    test.setTimeout(180_000);
    // The plan speaks of one marker string planted in the fixture guidance; the fixture's guidance is the criterion
    // wordings and expected answers listed in GUIDANCE, and every one of them is looked for.
    const expectNoGuidance = (text: string, where: string): void => {
      for (const words of GUIDANCE) expect(text.includes(words), `${where} shows guidance: "${words}"`).toBe(false);
    };
    // Question cards and suggested-link rationales, in every list of the lecture.
    for (const physical of [4, 7, 10, 12]) {
      await openQuestions(page, physical);
      const text = await questionsTabText(page);
      expect(text).toContain("Why: Synthetic fixture:");
      expectNoGuidance(text, `Questions tab, page ${physical}`);
    }
    await page.goto(`/courses/${COURSE}/questions?lecture=${LECTURE}`);
    await expect(page.getByTestId("question-bank").locator(ROW)).toHaveCount(6);
    expectNoGuidance(await textOf(page.getByTestId("question-bank")), "question bank");
    // The card of a question nobody has attempted: it says when criteria are shown, and shows none.
    await page.goto(`/courses/${COURSE}/questions/${Q03}`);
    const main = page.getByRole("main");
    await expect(page.locator("#practice-answer")).toBeVisible();
    await expect(page.getByTestId("question-links")).toBeVisible();
    expect(await textOf(main)).toContain("Criteria and answer guidance are used for assessment and shown with feedback, not before your attempt.");
    expect(await textOf(main)).toContain("Not assessed: no attempt is recorded for this question.");
    expectNoGuidance(await textOf(main), "question card before an attempt");
    // Search: words that occur only in the guidance find nothing of it, and a common word shows none of it.
    const dialog = await openSearch(page);
    for (const query of ["empty-well value", "reading gained per nanomole", "blank"]) {
      await search(dialog, query);
      expectNoGuidance(await textOf(dialog), `search for "${query}"`);
    }
    await page.keyboard.press("Escape");
    // Concept views: the Concepts tab, the outline down to the criteria, and the detail of a criterion.
    await openLecture(page, 7, "concepts");
    await page.getByTestId("concepts-tab").getByRole("button", { name: /^Whole lecture/ }).click();
    await expect(page.getByTestId("concepts-tree-lecture")).toBeVisible();
    expectNoGuidance(await textOf(page.getByTestId("concepts-tab")), "Concepts tab");
    await openConcepts(page, `?scope=lecture:${LECTURE}&node=${Q03}.C01`);
    const tree = await openWholeOutline(page);
    for (let guard = 0; guard < 40 && (await tree.locator('[role="treeitem"][data-kind="question"][aria-expanded="false"]').count()) > 0; guard += 1) {
      await tree.locator('[role="treeitem"][data-kind="question"][aria-expanded="false"]').first().locator(':scope > [data-row] > button[aria-label^="Expand "]').click();
    }
    await expect(treeItem(tree, `${Q03}.C01`).first()).toBeVisible();
    // The nine criteria of the lecture's six questions are rows by now (each under every skill that reaches its question).
    await expect.poll(async () => (await outlineRows(tree)).byKind.criterion?.length ?? 0).toBe(9);
    expect(await textOf(treeItem(tree, `${Q03}.C01`).first().locator(":scope > [data-row]"))).toContain(`Criterion 1 of ${Q03} (interpret)`);
    expectNoGuidance(await textOf(tree), "concept outline");
    for (const tab of ["Sources", "Questions", "Evidence"] as const) expectNoGuidance(await textOf(await showDetail(page, tab)), `criterion detail, ${tab}`);
    if (!isNarrow(page)) expectNoGuidance(await textOf(page.getByTestId("concept-map")), "concept map");

    // After an attempt: the feedback of that attempt words the criterion it was compared with, and only there.
    const card = await answer(page, PRACTICE, unique("The blank reading goes first because that signal does not come from the reporter."));
    expect(await textOf(card.getByTestId("feedback"))).toContain(`Criterion: ${PRACTICE_CRITERION}`);
    await openQuestions(page, 12);
    expectNoGuidance(await questionsTabText(page), "Questions tab after the attempt");
    await openConcepts(page, `?node=${PRACTICE}.C01&panel=evidence`);
    expectNoGuidance(await textOf(await showDetail(page, "Evidence")), "criterion evidence after the attempt");
  });

  // ==== concepts ==============================================================================================================

  test("R2-C1 from Study, by visible labelled controls only: the course header leads to the concept map, and a lecture leads to its Concepts tab and from there to the map", async ({ page }) => {
    await page.goto("/study");
    const courseTab = page.getByTestId("course-tabs").locator(`[data-course="${COURSE}"]`);
    await courseTab.click();
    await expect(courseTab).toHaveAttribute("aria-selected", "true");
    const pane = page.locator(`[data-testid="course-pane"][data-course="${COURSE}"]`);
    await expect(pane.getByTestId("course-name")).toHaveText(COURSE_NAME);

    // Course header → Concept map: the map of the course, at course scope.
    await pane.getByRole("link", { name: "Concept map", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Concept map" })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Scope of the concept map" }).getByRole("radio", { name: "Course" })).toHaveAttribute("aria-checked", "true");
    await showOutline(page);
    await expect.poll(() => textOf(page.getByTestId("outline-scope-count"))).toMatch(/^Course: \d+ concepts, \d+ skills, \d+ questions$/);
    await showMap(page);
    await expect(page.locator('[data-map-node][data-type="topic-card"]').first()).toBeVisible();

    // Lecture → Concepts tab (the pane control on a narrow window).
    await page.goBack();
    await pane.locator(`[data-testid="lecture-row"][data-lecture="${LECTURE}"]`).getByRole("link", { name: TITLE }).click();
    await expect(page.getByTestId("lecture-workspace")).toBeVisible();
    await expect(page.getByRole("tablist", { name: isNarrow(page) ? "Workspace pane" : "Context panel" })).toBeVisible();
    await openTab(page, "Concepts");
    const tab = page.getByTestId("concepts-tab");
    await expect(tab).toBeVisible();
    // A lecture opens on its title page: the tab says so and offers the lecture's concepts.
    await expect(tab.getByRole("heading", { level: 3, name: "Structural (title or section)" })).toBeVisible();
    await tab.getByRole("button", { name: "Next content" }).click();
    await expect(tab.getByTestId("concepts-heading")).toBeVisible();
    await tab.getByRole("link", { name: "Open the concept map" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Concept map" })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Scope of the concept map" }).getByRole("radio", { name: "This slide" })).toHaveAttribute("aria-checked", "true");
    // And back to the page the map was opened from.
    await page.getByRole("link", { name: startsWith("Back to page ") }).click();
    await expect(page.getByTestId("lecture-workspace")).toBeVisible();

    // The header of a lecture carries "Concept map" as well: the map of that lecture.
    await page.getByTestId("header-concept-map").click();
    await expect(page.getByRole("heading", { level: 1, name: "Concept map" })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Scope of the concept map" }).getByRole("radio", { name: "Lecture" })).toHaveAttribute("aria-checked", "true");
    await showOutline(page);
    await expect.poll(() => textOf(page.getByTestId("outline-scope-count"))).toMatch(new RegExp(`^${escapeRegExp(TITLE)}: \\d+ concepts, \\d+ skills, \\d+ questions$`));
  });

  test("R2-C2 Course, Lecture and This slide change the heading and the rows, the heading's counts equal the rows, a build lists each entry once with where its support is, and an empty scope says why", async ({ page }) => {
    test.setTimeout(180_000);
    const scope = page.getByRole("radiogroup", { name: "Scope of the concept map" });
    const choose = async (name: "Course" | "Lecture" | "This slide"): Promise<void> => {
      await scope.getByRole("radio", { name }).click();
      await expect(scope.getByRole("radio", { name })).toHaveAttribute("aria-checked", "true");
    };
    const rowText = async (tree: Locator, nodeId: string): Promise<string> => textOf(treeItem(tree, nodeId).first().locator(":scope > [data-row]"));

    // From build 1 of the three-build slide, through its Concepts tab.
    await openLecture(page, 4, "concepts");
    await page.getByTestId("concepts-tab").getByRole("link", { name: "Open the concept map" }).click();
    await expect(page.getByTestId("concept-explorer")).toHaveAttribute("data-scope", `slide:${LECTURE}:4`);
    const onSlide = await expectHeadingEqualsRows(page, "On this slide: 2 concepts, 2 skills, 2 questions");
    let tree = await showOutline(page);
    // Each entry once, with where its support is; what build 3 first shows is not presented as shown on build 1.
    expect(await rowText(tree, "be505.concept.reporter-gene")).toBe("Concept: Reporter gene 1 skill, 2 questions · group-level: all 3 builds");
    const later = await rowText(tree, "be505.concept.ribosome-binding-site");
    expect(later).toContain("elsewhere in this sequence: build 3");
    expect(later).not.toMatch(/on this build/i);
    for (const item of await tree.locator('[role="treeitem"]:is([data-kind="concept"], [data-kind="skill"])').all()) {
      expect(await textOf(item.locator(":scope > [data-row]"))).toMatch(/on this build|elsewhere in this sequence: build \d|group-level: all 3 builds/);
    }

    // Lecture.
    await choose("Lecture");
    const lecture = await expectHeadingEqualsRows(page, `${TITLE}: 4 concepts, 5 skills, 6 questions`);
    tree = await showOutline(page);
    await expect(treeItem(tree, "be505.concept.calibration-line")).toHaveCount(1);
    expect(await rowText(tree, "be505.concept.reporter-gene")).not.toMatch(/build/);
    // Course.
    await choose("Course");
    const course = await expectHeadingEqualsRows(page, "Course: 9 concepts, 10 skills, 17 questions");
    tree = await showOutline(page);
    await expect(treeItem(tree, "be505.topic.plasmids")).toHaveCount(1);
    expect(course.questions).toBe((await api<{ total: number }>(page, `courses/${COURSE}/questions`)).total);
    expect(lecture.questions).toBe((await lectureView(page)).questions.counts.all);
    expect(onSlide.concepts < lecture.concepts && lecture.concepts < course.concepts, "the three scopes hold different sets").toBe(true);
    // Back to the slide.
    await choose("This slide");
    await expectHeadingEqualsRows(page, "On this slide: 2 concepts, 2 skills, 2 questions");

    // Build 3 of the same slide: the same counts, and what it adds reads as on this build.
    await openConcepts(page, `?scope=slide:${LECTURE}:6`);
    await expectHeadingEqualsRows(page, "On this slide: 2 concepts, 2 skills, 2 questions");
    expect(await rowText(await showOutline(page), "be505.concept.ribosome-binding-site")).toContain("on this build");
    // Another slide: another set.
    await openConcepts(page, `?scope=slide:${LECTURE}:10`);
    await expectHeadingEqualsRows(page, "On this slide: 1 concept, 1 skill, 1 question");
    tree = await showOutline(page);
    expect(await rowText(tree, "be505.concept.calibration-line")).toContain("on this page");
    await expect(treeItem(tree, "be505.concept.reporter-gene")).toHaveCount(0);

    // A scope that holds nothing says why and offers the lecture.
    await openConcepts(page, `?scope=slide:${LECTURE}:13`);
    const empty = emptyScope(page);
    await expect.poll(() => textOf(empty)).toContain("Nothing in the course record and no suggested link names this slide. The lecture scope lists this lecture's concepts and questions.");
    await empty.getByRole("button", { name: "Show this lecture" }).click();
    await expect(scope.getByRole("radio", { name: "Lecture" })).toHaveAttribute("aria-checked", "true");
    await expectHeadingEqualsRows(page, `${TITLE}: 4 concepts, 5 skills, 6 questions`);
  });

  test("R2-C3 the map opens at topic level with a bounded number of nodes, expands on demand, keeps the selection with the outline, draws every label at 12 px or more and overlaps no two nodes", async ({ page }) => {
    test.setTimeout(120_000);
    await openConcepts(page);
    const tree = await showOutline(page);
    await expect(tree.locator('[role="treeitem"][data-kind="topic"]').first()).toBeVisible();
    const topics = (await outlineRows(tree)).byKind.topic ?? [];
    expect(topics.length).toBeGreaterThan(0);

    // Topic level: one card per topic and nothing below a topic.
    const map = await showMap(page);
    await expect(map).toHaveAttribute("data-view", "topics");
    expect((await mapNodeIds(map)).sort()).toEqual([...topics].sort());
    expect(await mapNodeIds(map, "topic-card")).toHaveLength(topics.length);
    await expect.poll(() => textOf(page.getByTestId("map-caption"))).toBe(`${topics.length} topics in this course. Open a topic to draw its concepts. Nothing below a topic is drawn until you ask.`);
    if (isNarrow(page)) {
      // One column at its natural size: there is no zoom to shrink it with, and nothing reaches past the window's edge.
      await expect(page.getByTestId("map-zoom")).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
    } else {
      // The default view is drawn at 100 % and cannot be shrunk to fit more.
      await expect.poll(() => textOf(page.getByTestId("map-zoom"))).toBe("100 %");
      await expect(page.getByRole("button", { name: "Zoom out. The map does not go below 100 %" })).toBeDisabled();
    }
    const expectLegible = async (when: string): Promise<void> => {
      const labels = await mapLabels(map);
      expect(labels.labels, `${when}: labels drawn`).toBeGreaterThan(0);
      expect(labels.under, `${when}: labels under 12 px as rendered`).toEqual([]);
      expect(labels.smallest, `${when}: smallest label`).toBeGreaterThanOrEqual(12);
    };
    await expectLegible("topic level");
    expect(await mapOverlaps(map), "topic level: overlapping node boxes").toEqual([]);

    // Expanding one topic draws that topic and its concepts, and only them.
    const topic = "be505.topic.reporter-assays";
    const concepts = ["be505.concept.blank-subtraction", "be505.concept.calibration-line", "be505.concept.reporter-gene", "be505.concept.ribosome-binding-site"];
    await map.locator(`[data-map-node="${topic}"]`).getByRole("button", { name: /Show 4\s+concepts/ }).click();
    await expect(map).toHaveAttribute("data-view", "focus");
    await expect(map.locator(`[data-map-node="${topic}"]`)).toHaveAttribute("data-selected", "true");
    await mapSettled(map);
    let drawn = await mapNodeIds(map);
    expect(drawn.filter((id) => id !== topic && !id.startsWith("ll:fold:") && !concepts.includes(id)), "nodes that are not the topic or one of its concepts").toEqual([]);
    expect(drawn.length).toBeLessThanOrEqual(1 + concepts.length);
    await expectLegible("one topic expanded");
    // What did not fit in the rank is one more step away, not shrunk into view.
    const fold = map.locator('[data-map-node][data-type="fold"]');
    if (await fold.count()) {
      await fold.first().click();
      await expect(fold).toHaveCount(0);
      await mapSettled(map);
      await expectLegible("the rank unfolded");
    }
    drawn = await mapNodeIds(map);
    expect(drawn.filter((id) => concepts.includes(id)).sort()).toEqual(concepts);
    expect(new Set(drawn).size, "no node drawn twice").toBe(drawn.length);

    // A node selected in the map is the selected row of the outline, and stays selected going to the outline and back.
    const chosen = "be505.concept.reporter-gene";
    await map.locator(`[data-map-node="${chosen}"]`).getByRole("button").first().click();
    await expect(map.locator(`[data-map-node="${chosen}"]`)).toHaveAttribute("data-selected", "true");
    await mapSettled(map);
    await expectLegible("a concept selected");
    expect(param(page, "node")).toBe(chosen);
    if (isNarrow(page)) {
      await openConceptPane(page, "Outline");
      await expect(treeItem(page.getByRole("tree", { name: "Concept outline" }), chosen)).toHaveAttribute("aria-selected", "true");
      await openConceptPane(page, "Map");
    } else {
      await expect(treeItem(tree, chosen)).toHaveAttribute("aria-selected", "true");
      await page.getByTestId("outline-toggle").click();
      await expect(page.getByTestId("outline-toggle")).toHaveAttribute("aria-pressed", "false");
      await expect(map.locator(`[data-map-node="${chosen}"]`)).toHaveAttribute("data-selected", "true");
      await page.getByTestId("outline-toggle").click();
      await expect(treeItem(page.getByRole("tree", { name: "Concept outline" }), chosen)).toHaveAttribute("aria-selected", "true");
    }
    await expect(map.locator(`[data-map-node="${chosen}"]`)).toHaveAttribute("data-selected", "true");
    await expect(map.locator('[data-map-node][data-selected="true"]')).toHaveCount(1);

    // The default view of the other two scopes: legible, nothing overlapping, nothing drawn twice.
    for (const query of [`?scope=lecture:${LECTURE}`, `?scope=slide:${LECTURE}:5`]) {
      await openConcepts(page, query);
      const view = await showMap(page);
      await expect(view.locator("[data-map-node]").first()).toBeVisible();
      const labels = await mapLabels(view);
      expect(labels.under, `${query}: labels under 12 px`).toEqual([]);
      expect(await mapOverlaps(view), `${query}: overlapping node boxes`).toEqual([]);
      const ids = await mapNodeIds(view);
      expect(new Set(ids).size, `${query}: no node drawn twice`).toBe(ids.length);
    }
  });

  test("R2-C4 with the keyboard alone the tree is reached, moved through, expanded and selected from; arrow keys there never turn the slide; every node of the map is a row of the outline; both presentations pass the accessibility scan", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const focused = (): Promise<{ node: string | null; expanded: string | null; inTree: string | null }> => page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return { node: el?.getAttribute("data-node") ?? null, expanded: el?.getAttribute("aria-expanded") ?? null, inTree: el?.closest('[role="tree"]')?.getAttribute("aria-label") ?? null };
    });
    const tabInto = async (treeName: string): Promise<void> => {
      for (let guard = 0; guard < 90; guard += 1) {
        await page.keyboard.press("Tab");
        if ((await focused()).inTree === treeName) return;
      }
      throw new Error(`Tab never reached the tree "${treeName}"`);
    };
    const press = async (key: string, node: string, expanded?: string | null): Promise<void> => {
      // The row a key goes to is on screen before the key is pressed (the rows of a newly opened row follow it at once).
      await expect(page.locator(`[role="tree"] [role="treeitem"][data-node="${node}"]`).first()).toBeVisible();
      await page.keyboard.press(key);
      await expect.poll(async () => (await focused()).node, `after ${key}`).toBe(node);
      if (expanded !== undefined) await expect.poll(async () => (await focused()).expanded, `after ${key}`).toBe(expanded);
    };

    // The Concepts tab of a slide: arrow keys move in the tree and the slide stays where it is.
    await openLecture(page, 5, "concepts");
    await expect(page.getByRole("tree", { name: "Concepts of this slide" })).toBeVisible();
    await tabInto("Concepts of this slide");
    expect((await focused()).node).toBe("be505.topic.reporter-assays");
    await press("ArrowDown", "be505.concept.reporter-gene", "true");
    await press("ArrowDown", "be505.skill.reporter.explain");
    await press("ArrowLeft", "be505.concept.reporter-gene", "true");
    await press("ArrowLeft", "be505.concept.reporter-gene", "false");
    await press("ArrowRight", "be505.concept.reporter-gene", "true");
    await press("ArrowUp", "be505.topic.reporter-assays");
    await press("End", "be505.skill.binding-site.explain");
    await press("Home", "be505.topic.reporter-assays");
    expect(param(page, "page"), "arrow keys in the tree do not turn the slide").toBe("5");
    if (!isNarrow(page)) await expectIdentity(page, 5, "PDF page 5 of 14 · build 2 of 3");
    // Enter on a concept opens the map of this slide with that concept selected.
    await press("ArrowDown", "be505.concept.reporter-gene");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("concept-explorer")).toHaveAttribute("data-scope", `slide:${LECTURE}:5`);
    expect(param(page, "node")).toBe("be505.concept.reporter-gene");

    // The outline of the course, by keys alone: reach it, expand, move, select.
    await openConcepts(page);
    const tree = await showOutline(page);
    await tabInto("Concept outline");
    expect((await focused()).node).toBe("be505.topic.expression-control");
    await press("ArrowDown", "be505.topic.plasmids");
    await press("ArrowDown", "be505.topic.reporter-assays", "false");
    await press("ArrowRight", "be505.topic.reporter-assays", "true");
    await press("ArrowRight", "be505.concept.blank-subtraction", "false");
    await press("ArrowRight", "be505.concept.blank-subtraction", "true");
    await press("ArrowDown", "be505.skill.blank.interpret");
    await page.keyboard.press("Enter");
    await expect(treeItem(tree, "be505.skill.blank.interpret")).toHaveAttribute("aria-selected", "true");
    expect(param(page, "node")).toBe("be505.skill.blank.interpret");
    expect((await focused()).node, "focus stays on the row that was selected").toBe("be505.skill.blank.interpret");
    await expect(tree.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(1);
    // The same selection in the other presentation and in the detail.
    const SKILL = "Interpret a plate reading once the blank has been subtracted.";
    if (!isNarrow(page)) {
      await expect(page.locator('[data-map-node="be505.skill.blank.interpret"]')).toHaveAttribute("data-selected", "true");
      await expect(page.getByTestId("outline-detail").getByRole("heading", { level: 2, name: SKILL })).toBeVisible();
    }
    // Every row can be opened by keys: walk the whole tree, opening each closed row on the way.
    await page.keyboard.press("Home");
    for (let guard = 0; guard < 400; guard += 1) {
      if ((await focused()).expanded === "false") {
        await page.keyboard.press("ArrowRight");
        // The rows of the opened row are drawn a moment after it opens; ArrowDown goes into them once they are there.
        await expect.poll(() => page.evaluate(() => {
          const el = document.activeElement;
          return el?.getAttribute("aria-expanded") === "true" && el.querySelector(':scope > [role="group"] > [role="treeitem"]') !== null;
        }), "the opened row shows its rows").toBe(true);
      }
      const moved = await page.evaluate(() => {
        const before = document.activeElement;
        (window as unknown as { llWalkFrom?: Element | null }).llWalkFrom = before;
        return before !== null;
      });
      expect(moved).toBe(true);
      await page.keyboard.press("ArrowDown");
      if (await page.evaluate(() => document.activeElement === (window as unknown as { llWalkFrom?: Element | null }).llWalkFrom)) break; // the last row
    }
    await expect(tree.locator('[role="treeitem"][aria-expanded="false"]')).toHaveCount(0);
    const rows = await outlineRows(tree);
    const inOutline = new Set(Object.values(rows.byKind).flat());
    expect(rows.byKind.concept).toHaveLength(9);
    expect(rows.byKind.skill).toHaveLength(10);
    expect(rows.byKind.question).toHaveLength(17);
    expect(param(page, "node"), "moving through the tree selects nothing by itself").toBe("be505.skill.blank.interpret");

    // Every node the map draws for this selection is a row of the outline, with the same label.
    const map = await showMap(page);
    await expect(map.locator('[data-map-node="be505.skill.blank.interpret"]')).toHaveAttribute("data-selected", "true");
    const drawn = await mapNodeIds(map, "node");
    expect(drawn.length).toBeGreaterThan(1);
    expect(drawn.filter((id) => !inOutline.has(id)), "nodes of the map that the outline does not hold").toEqual([]);
    await expectAccessible(page, testInfo, "concept map");
    const detail = await showDetail(page, "Sources");
    await expect(detail.getByRole("heading", { level: 2, name: SKILL })).toBeVisible();
    await showOutline(page);
    await expectAccessible(page, testInfo, "concept outline");
  });

  test("R2-C5 in each scope the outline and the map state the same counts, and a node selected in one is selected, with the same detail, in the other", async ({ page }) => {
    test.setTimeout(120_000);
    const outlineCounts = async (): Promise<Counts> => {
      await showOutline(page);
      return countsIn(await textOf(page.getByTestId("outline-scope-count")));
    };
    const mapCounts = async (): Promise<Counts> => {
      await showMap(page);
      return countsIn(await textOf(page.getByTestId("map-caption")));
    };
    // Slide and lecture: the caption of the map and the heading of the outline hold the same three numbers.
    const expectSameCounts = (counts: Counts): Promise<void> => expect(async () => {
      expect(await outlineCounts()).toEqual(counts);
      expect(await mapCounts()).toEqual(counts);
    }).toPass({ timeout: 20_000 });
    await openConcepts(page, `?scope=slide:${LECTURE}:5`);
    await expectSameCounts({ concepts: 2, skills: 2, questions: 2 });
    await openConcepts(page, `?scope=lecture:${LECTURE}`);
    await expectSameCounts({ concepts: 4, skills: 5, questions: 6 });
    // Course, topic level: each topic card states what its row of the outline states.
    await openConcepts(page);
    const tree = await showOutline(page);
    let topicRows: Record<string, string> = {};
    await expect(async () => {
      const topics = await tree.locator('[role="treeitem"][data-kind="topic"]').all();
      expect(topics).toHaveLength(3);
      const read: Record<string, string> = {};
      for (const item of topics) {
        const words = await textOf(item.locator(":scope > [data-row]"));
        expect(words).toMatch(/^Topic: .+ \d+ concepts?, \d+ skills?, \d+ questions?$/);
        read[(await item.getAttribute("data-node"))!] = words;
      }
      topicRows = read;
    }).toPass({ timeout: 15_000 });
    const map = await showMap(page);
    for (const [id, words] of Object.entries(topicRows)) await expect.poll(() => textOf(map.locator(`[data-map-node="${id}"]`)), id).toContain(words);
    // With a selection the map's caption states the course's counts, the outline's own.
    await openConcepts(page, "?node=be505.topic.reporter-assays");
    await expectSameCounts({ concepts: 9, skills: 10, questions: 17 });

    // Selected in the outline → selected in the map, one detail.
    await openConcepts(page, `?scope=lecture:${LECTURE}`);
    let outline = await showOutline(page);
    await treeAction(treeItem(outline, "be505.concept.blank-subtraction")).click();
    await expect(treeItem(outline, "be505.concept.blank-subtraction")).toHaveAttribute("aria-selected", "true");
    let view = await showMap(page);
    await expect(view.locator('[data-map-node="be505.concept.blank-subtraction"]')).toHaveAttribute("data-selected", "true");
    await expect(view.locator('[data-map-node][data-selected="true"]')).toHaveCount(1);
    await expect((await showDetail(page, "Sources")).getByRole("heading", { level: 2, name: "Blank subtraction" })).toBeVisible();
    const fromOutline = await textOf(page.getByTestId("outline-detail"));
    // Selected in the map → selected in the outline, the detail follows.
    view = await showMap(page);
    await view.locator('[data-map-node="be505.skill.blank.interpret"]').getByRole("button").first().click();
    await expect(view.locator('[data-map-node="be505.skill.blank.interpret"]')).toHaveAttribute("data-selected", "true");
    outline = await showOutline(page);
    await expect(treeItem(outline, "be505.skill.blank.interpret")).toHaveAttribute("aria-selected", "true");
    await expect(outline.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(1);
    await expect((await showDetail(page, "Sources")).getByRole("heading", { level: 2, name: "Interpret a plate reading once the blank has been subtracted." })).toBeVisible();
    // And back by the map: the detail of the first node is the detail it had when chosen in the outline.
    view = await showMap(page);
    await view.locator('[data-map-node="be505.concept.blank-subtraction"]').getByRole("button").first().click();
    await expect(view.locator('[data-map-node="be505.concept.blank-subtraction"]')).toHaveAttribute("data-selected", "true");
    await showDetail(page, "Sources");
    await expect.poll(() => textOf(page.getByTestId("outline-detail"))).toBe(fromOutline);
  });

  test("R2-C6 three line styles with a key; every drawn relation names its family and where it comes from; containment between two questions is not drawn as a prerequisite", async ({ page }) => {
    const TITLE_OF: Record<string, RegExp> = {
      hierarchy: /^Part of\. From .+\.$/, assessment: /^Assesses\. From .+\.$/, source: /^Supported on this slide: .+\. From .+\.$/, prerequisite_or_overlap: /^Prerequisite or overlap: .+\. From .+\.$/,
    };
    const FAMILY_OF: Record<string, string> = { hierarchy: "structure", prerequisite_or_overlap: "structure", assessment: "assessment", source: "source" };
    const KEY: Record<string, string> = { hierarchy: "Part of", assessment: "Assesses", source: "Supported on this slide", prerequisite_or_overlap: "Prerequisite or overlap" };

    // A concept of a slide: its place in the outline, the questions that assess it, and the slide that supports it.
    await openConcepts(page, `?scope=slide:${LECTURE}:5&node=be505.concept.reporter-gene`);
    const map = await showMap(page);
    if (isNarrow(page)) {
      // Below 1180 px the map is one column: no line runs between boxes. Each group is headed by the stroke of what joins
      // it to the groups above, a relation between two questions is a line of words with its stroke, and the key names
      // each stroke. The strokes are the key's own.
      type Stroke = { dash: string; double: boolean };
      const strokeOf = (holder: Locator): Promise<Stroke | null> => holder.evaluate((el) => {
        const paths = Array.from(el.querySelectorAll('svg path[fill="none"]'));
        return paths.length ? { dash: getComputedStyle(paths[0]!).strokeDasharray, double: paths.length > 1 } : null;
      });
      const keyOf = async (view: Locator): Promise<Record<string, Stroke>> => {
        const key: Record<string, Stroke> = {};
        for (const entry of await view.page().getByTestId("map-key").getByRole("group", { name: "Key to the lines" }).locator("[data-legend]").all()) {
          const line = (await entry.getAttribute("data-legend"))!;
          expect(await textOf(entry)).toBe(KEY[line]);
          key[line] = (await strokeOf(entry))!;
        }
        return key;
      };
      const groupStroke = (view: Locator, label: string): Promise<Stroke | null> => strokeOf(view.getByTestId("concept-map-column").locator(`section[aria-label="${label}"] > p`).first());
      await expect(map.locator("[data-edge]")).toHaveCount(0);
      const key = await keyOf(map);
      expect(Object.keys(key).sort()).toEqual(["assessment", "hierarchy", "prerequisite_or_overlap", "source"]);
      expect(new Set(Object.values(key).map((stroke) => `${stroke.dash}${stroke.double ? " double" : ""}`)).size, "distinct strokes in the key").toBe(4);
      expect(key.hierarchy).toEqual({ dash: "none", double: false });
      expect(await groupStroke(map, "Topic")).toBeNull();
      expect(await groupStroke(map, "Selected concept")).toEqual(key.hierarchy);
      expect(await groupStroke(map, "Supported on")).toEqual(key.source);
      expect(await groupStroke(map, "Skill")).toEqual(key.hierarchy);
      expect(await groupStroke(map, "Questions")).toEqual(key.assessment);
      expect(await textOf(map.getByTestId("concept-map-column").locator('section[aria-label="Supported on"]'))).toBe("Supported on This slide PDF page 5 of 14 · build 2 of 3");
      const between = map.getByTestId("concept-map-column").locator("p").filter({ hasText: "is a diagnostic step for Why the construct is built this way" });
      await expect(between).toHaveCount(1);
      expect(await strokeOf(between)).toEqual(key.prerequisite_or_overlap);

      // Relations between questions under the course's own labels. The group of related questions is joined by the stroke
      // of "Prerequisite or overlap", never by that of "Part of"; containment is said as containment, not as a prerequisite.
      await openConcepts(page, "?node=BE505-L01-Q03");
      const view = await showMap(page);
      await expect(view.locator('[data-map-node="BE505-L01-Q03"]')).toHaveAttribute("data-selected", "true");
      const related = await keyOf(view);
      expect(Object.keys(related).sort()).toEqual(["assessment", "hierarchy", "prerequisite_or_overlap"]);
      for (const label of ["Questions", "Related question"]) {
        expect(await groupStroke(view, label), `the group "${label}"`).toEqual(related.prerequisite_or_overlap);
        expect(await groupStroke(view, label), `the group "${label}" is not joined as "Part of"`).not.toEqual(related.hierarchy);
      }
      for (const words of ["is fully contained in Replication is not transcription", "is a diagnostic step for Replication is not transcription", "partly overlaps with How induction works"]) {
        const line = view.getByTestId("concept-map-column").locator("p").filter({ hasText: words });
        await expect(line, words).toHaveCount(1);
        expect(await strokeOf(line), words).toEqual(related.prerequisite_or_overlap);
      }
      expect(await textOf(view.getByTestId("concept-map-column").locator("p").filter({ hasText: "is fully contained in" }))).not.toMatch(/prerequisite|diagnostic|part of/i);
      return;
    }
    await expect(map.locator("[data-edge]").first()).toBeAttached();
    const edges = await drawnEdges(map);
    for (const edge of edges) {
      expect(FAMILY_OF[edge.line], `line "${edge.line}"`).toBe(edge.family);
      expect(edge.title, `${edge.line}: its family and its origin`).toMatch(TITLE_OF[edge.line]!);
    }
    expect([...new Set(edges.map((edge) => edge.family))].sort()).toEqual(["assessment", "source", "structure"]);
    // Three styles that differ without colour: solid, dashed, dotted; a prerequisite or overlap is a double line.
    const style = (line: string): string => { const edge = edges.find((e) => e.line === line)!; return `${edge.dash}${edge.double ? " double" : ""}`; };
    expect(style("hierarchy")).toBe("none");
    expect(style("assessment")).not.toBe("none");
    expect(style("source")).not.toBe("none");
    expect(new Set(["hierarchy", "assessment", "source", "prerequisite_or_overlap"].map(style)).size, "distinct line styles").toBe(4);
    // The key names each style that is drawn, with a sample of that style.
    const key = page.getByTestId("map-key").getByRole("group", { name: "Key to the lines" });
    const drawnLines = [...new Set(edges.map((edge) => edge.line))].sort();
    expect((await key.locator("[data-legend]").evaluateAll((items) => items.map((item) => item.getAttribute("data-legend") ?? ""))).sort()).toEqual(drawnLines);
    for (const line of drawnLines) {
      const entry = key.locator(`[data-legend="${line}"]`);
      expect(await textOf(entry)).toBe(KEY[line]);
      const sample = await entry.locator("path").first().evaluate((path) => getComputedStyle(path).strokeDasharray);
      expect(sample, `key sample of ${line}`).toBe(edges.find((edge) => edge.line === line)!.dash);
    }

    // Relations between questions carry the course's own label. A prerequisite is drawn with a direction; containment
    // ("is fully contained in") and overlap are drawn without one: containment is never drawn as a prerequisite.
    await openConcepts(page, "?node=BE505-L01-Q03");
    const view = await showMap(page);
    await expect(view.locator('[data-map-node="BE505-L01-Q03"]')).toHaveAttribute("data-selected", "true");
    const relations = (await drawnEdges(view)).filter((edge) => edge.line === "prerequisite_or_overlap");
    const labelled = (words: string): DrawnEdge[] => relations.filter((edge) => edge.title === `Prerequisite or overlap: ${words}. From question index.`);
    expect(labelled("is fully contained in")).toHaveLength(1);
    expect(labelled("partly overlaps with")).toHaveLength(1);
    expect(labelled("is a diagnostic step for")).toHaveLength(1);
    expect(labelled("is fully contained in")[0]!.arrow, "containment drawn with the arrow of a prerequisite").toBe(false);
    expect(labelled("partly overlaps with")[0]!.arrow).toBe(false);
    expect(labelled("is a diagnostic step for")[0]!.arrow).toBe(true);
    for (const edge of await drawnEdges(view)) if (/contained/.test(edge.title)) expect(edge.title).not.toMatch(/prerequisite of|diagnostic|Part of/);
  });

  test("R2-C7 a selected concept shows Sources, Questions and Evidence that follow the catalog; a source row opens its page of the lecture; an empty tab says why; a concept without a definition says so", async ({ page }) => {
    await openConcepts(page, `?scope=lecture:${LECTURE}`);
    const tree = await showOutline(page);
    await treeAction(treeItem(tree, "be505.concept.reporter-gene")).click();
    await expect(treeItem(tree, "be505.concept.reporter-gene")).toHaveAttribute("aria-selected", "true");

    // Sources: where the course record teaches it, each with its basis; the tab's number is its rows.
    let detail = await showDetail(page, "Sources");
    await expect(detail.getByRole("heading", { level: 2, name: "Reporter gene" })).toBeVisible();
    await expect.poll(() => textOf(detail.getByTestId("detail-summary"))).toBe("1 skill and 3 questions in this lecture.");
    const sources = detail.getByTestId("source-row");
    await expect(sources).toHaveCount(3);
    expect(await textOf(conceptPane(page, "Sources"))).toMatch(/^Sources\s*3$/);
    expect(await textOf(sources.nth(0))).toBe(`${TITLE}, PDF pages 4–6 Exact. A reviewed anchor of the course record names these pages.`);
    expect(await textOf(sources.nth(1))).toBe(`${TITLE}, PDF pages 3–6 Stated. The course record names these pages. Their basis is not reviewed.`);
    expect(await textOf(sources.nth(2))).toBe(`${TITLE}, Transcript lines 9–17 Exact. A reviewed anchor of the course record names these lines.`);
    // The catalog holds no definition: said as a gap of the record, nothing filled in.
    const definition = detail.getByTestId("definition");
    await expect(definition).toHaveAttribute("data-state", "coverage_gap");
    await expect.poll(() => textOf(definition)).toBe("The catalog holds no definition for this concept. Nothing is filled in here.");

    // Questions: the three questions that reach the concept through a criterion.
    detail = await showDetail(page, "Questions");
    await expect.poll(() => textOf(detail.getByTestId("questions-heading"))).toBe("3 questions test this concept in the course");
    await expect.poll(() => textOf(detail.getByTestId("questions-scope"))).toBe("All 3 are in this lecture.");
    expect(await textOf(conceptPane(page, "Questions"))).toMatch(/^Questions\s*3$/);
    const questions = detail.getByTestId("question-row");
    await expect(questions).toHaveCount(3);
    expect((await questions.getByRole("link", { name: "Open the question" }).evaluateAll((links) => links.map((link) => link.getAttribute("href")))).sort())
      .toEqual([CLASS, Q01, Q02].map((id) => `/courses/${COURSE}/questions/${id}`).sort());
    for (const item of await questions.all()) expect(await textOf(item)).toContain("Through 1 criterion of this question.");

    // A source row opens the page it names, in the lecture.
    detail = await showDetail(page, "Sources");
    await detail.getByTestId("source-row").nth(0).getByRole("link").click();
    await expect(page.getByTestId("lecture-workspace")).toBeVisible();
    expect(param(page, "page")).toBe("4");
    await expectIdentity(page, 4, "PDF page 4 of 14 · build 1 of 3");
    await page.goBack();
    await expect(page.getByTestId("concept-explorer")).toBeVisible();

    // Evidence of a concept nobody has attempted: the tab is empty and says why, without a judgement.
    await openConcepts(page, `?scope=lecture:${LECTURE}&node=be505.concept.ribosome-binding-site`);
    detail = await showDetail(page, "Evidence");
    await expect(detail.getByRole("heading", { level: 2, name: "Ribosome binding site" })).toBeVisible();
    expect(await textOf(detail)).toContain("Unknown · no recorded attempt No attempt is recorded for this concept. That says nothing about what you can do.");
    await expect(detail.getByTestId("observation")).toHaveCount(0);
    await expect(detail.getByTestId("evidence-summary")).toHaveCount(0);
    // Not in the fixture: a node whose Sources or Questions tab is empty (every fixture node has both).
  });

  test("R2-C8 on the three-build slide each concept and question is listed once in This slide and in Lecture scope, the counts are the same on every build, and an attempt is listed once", async ({ page, unique }) => {
    test.setTimeout(180_000);
    const all = (await lectureView(page)).questions.counts.all;
    // The Concepts tab and the Questions tab of each build: the same heading, each entry once.
    for (const physical of [4, 5, 6]) {
      await openLecture(page, physical, "concepts");
      const tab = page.getByTestId("concepts-tab");
      await expect.poll(() => textOf(tab.getByTestId("concepts-heading")), `page ${physical}`).toBe("On this slide: 2 concepts, 2 skills, 2 questions");
      expect(await textOf(tab)).toContain("One slide in 3 builds, pp. 4–6. Each entry is listed once and says where its support is.");
      const slideTree = tab.getByRole("tree", { name: "Concepts of this slide" });
      await expect(async () => {
        const rows = await outlineRows(slideTree);
        expect(rows.byKind.concept, `page ${physical}`).toEqual(["be505.concept.reporter-gene", "be505.concept.ribosome-binding-site"]);
        expect(rows.byKind.skill, `page ${physical}`).toEqual(["be505.skill.binding-site.explain", "be505.skill.reporter.explain"]);
        expect(rows.siblingsRepeat).toEqual([]);
        expect(new Set(rows.instances).size).toBe(rows.instances.length);
      }).toPass({ timeout: 15_000 });
      await openTab(page, "Questions");
      await expect(thisSlideRows(page)).toHaveCount(2);
      for (const questionId of [Q01, Q02]) await expect(row(page.getByTestId("this-slide-list"), questionId)).toHaveCount(1);
      expect(await sectionCount(page, "This slide")).toBe(2);
    }
    // Lecture scope: the three pages of one slide do not multiply anything; the question count is the catalogued total.
    await openConcepts(page, `?scope=lecture:${LECTURE}`);
    const lecture = await expectHeadingEqualsRows(page, `${TITLE}: 4 concepts, 5 skills, 6 questions`);
    expect(lecture.questions).toBe(all);
    await openQuestions(page, 5);
    await openSection(page, "All lecture questions");
    for (const questionId of [Q01, Q02]) await expect(row(lectureList(page), questionId)).toHaveCount(1);

    // One attempt on the question that all three builds carry: the history lists it once, and the evidence of its concept
    // lists one line per recorded attempt whichever build the map was opened from.
    const words = unique("It names the promoter fragment, the coding sequence, the binding site and the terminator in that order, and ties the terminator to the end of transcription.");
    await answer(page, Q01, words);
    await page.goto("/history");
    await expect(page.getByRole("tabpanel", { name: /^Attempts/ }).getByRole("listitem").filter({ hasText: words })).toHaveCount(1);
    const perBuild: number[] = [];
    for (const physical of [4, 5, 6]) {
      await openConcepts(page, `?scope=slide:${LECTURE}:${physical}&node=be505.concept.reporter-gene`);
      const detail = await showDetail(page, "Evidence");
      const observations = detail.getByTestId("observation").filter({ hasText: "Order of the reporter construct" });
      await expect(observations.first()).toBeVisible();
      const stated = Number(/^Of (\d+) recorded observations?:/.exec(await textOf(detail.getByTestId("evidence-summary")))?.[1] ?? NaN);
      expect(await detail.getByTestId("observation").count(), `page ${physical}: one line per recorded observation`).toBe(stated);
      perBuild.push(await observations.count());
    }
    expect(new Set(perBuild).size, `lines of this question's attempts per build: ${perBuild.join(", ")}`).toBe(1);
    // As many attempts of this question in the history as lines of it in the evidence: none is listed once per build.
    await page.goto("/history");
    await expect(page.getByRole("tabpanel", { name: /^Attempts/ }).getByRole("listitem").filter({ hasText: "List the parts of the reporter construct in the order they are added" })).toHaveCount(perBuild[0]!);
  });

  test("R2-C9 the evidence panel words Independent, Assisted with its kind, Not separately observed and Unknown apart; prior exposure stands beside the state and is not assistance; unknown is neither zero nor a failure", async ({ page, unique }) => {
    test.setTimeout(180_000);
    // Not in the fixture: a node in the state "Not applicable" (no fixture course has one), so four of the five states
    // of the contract are on screen here.
    const observations = async (nodeId: string): Promise<Array<{ state: string | null; words: string }>> => {
      await openConcepts(page, `?node=${nodeId}`);
      const detail = await showDetail(page, "Evidence");
      await expect(detail.getByRole("heading", { level: 2 })).toBeVisible();
      await expect(detail.getByTestId("observation").first()).toBeVisible();
      await expect(detail.getByTestId("evidence-summary")).toBeVisible();
      const out: Array<{ state: string | null; words: string }> = [];
      for (const item of await detail.getByTestId("observation").all()) out.push({ state: await item.locator("[data-state]").first().getAttribute("data-state"), words: await textOf(item.locator("[data-state]").first()) });
      return out;
    };
    const has = (list: Array<{ state: string | null; words: string }>, state: string, words: string): boolean => list.some((item) => item.state === state && item.words === words);

    // Seeded attempts of the fixture: unaided; unaided on a question seen before; after a hint.
    const origin = await observations("be505.skill.ori.explain");
    expect(has(origin, "independent", "Independent · no prior exposure"), JSON.stringify(origin)).toBe(true);
    // Seen before, no help: prior exposure stands beside "Independent"; it is not worded or marked as assisted.
    expect(has(origin, "independent", "Independent · prior exposure"), JSON.stringify(origin)).toBe(true);
    expect(has(origin, "assisted", "Assisted: after a hint · no prior exposure"), JSON.stringify(origin)).toBe(true);
    // An attempt that did not address this skill.
    const promoter = await observations("be505.skill.promoter.explain");
    expect(has(promoter, "not_separately_observed", "Not separately observed · no prior exposure"), JSON.stringify(promoter)).toBe(true);
    // An attempt whose conditions were not recorded: unknown, counted as unknown, not as a zero of anything else.
    const selection = await observations("be505.skill.selection.interpret");
    expect(has(selection, "unknown", "Unknown · prior exposure not recorded"), JSON.stringify(selection)).toBe(true);
    expect(await textOf(page.getByTestId("outline-detail").getByTestId("evidence-summary"))).toMatch(/^Of \d+ recorded observations?: \d+ independent, \d+ assisted, \d+ not separately observed, [1-9]\d* unknown\.$/);

    // A supplied-solution attempt, made here: assisted, with its kind.
    await answer(page, PRACTICE, unique("The blank reading goes first because that signal does not come from the reporter."), { solutionSeen: true });
    const blank = await observations("be505.skill.blank.interpret");
    expect(blank.some((item) => item.state === "assisted" && /^Assisted: solution shown\b/.test(item.words)), JSON.stringify(blank)).toBe(true);

    // The different states read differently.
    const labels = new Set([...origin, ...promoter, ...selection, ...blank].map((item) => item.words.split(" · ")[0]));
    for (const label of ["Independent", "Assisted: after a hint", "Assisted: solution shown", "Not separately observed", "Unknown"]) expect([...labels], `label "${label}"`).toContain(label);

    // Nothing recorded at all: unknown, in words, with no zero, no percentage and no judgement.
    await openConcepts(page, "?node=be505.skill.binding-site.explain");
    const detail = await showDetail(page, "Evidence");
    const chip = detail.locator('[data-state="unknown"]').first();
    await expect.poll(() => textOf(chip)).toBe("Unknown · no recorded attempt");
    const words = await textOf(detail);
    expect(words).toContain("No attempt is recorded for this skill. That says nothing about what you can do.");
    // (The header of the detail offers "Play 0:28 – 0:59": a time of the recording, left out of the search for a zero.)
    expect(words.replace(/\d+:\d{2}/g, "")).not.toMatch(/\b0\b|%|\bfail|\bweak|\bgap\b|\bnot shown\b|\bincorrect\b/i);
    await expect(detail.getByTestId("evidence-summary")).toHaveCount(0);
    await expect(detail.getByTestId("observation")).toHaveCount(0);
    expect(await textOf(detail)).toContain("Each line describes one recorded attempt and how it was made. Nothing is averaged into a score.");
  });

  test("R2-C10 the concept, progress and history screens carry no mastery label, no probability and no bare percentage; a concept without a record is not worded or coloured as weak; a structural page says so and offers the lecture", async ({ page }) => {
    test.setTimeout(120_000);
    const DENIAL = "No mastery percentage, forgetting curve or exam probability is computed";
    const expectNoScoreWords = async (where: string): Promise<void> => {
      const main = page.getByRole("main");
      const words = (await textOf(main)).split(DENIAL).join(" ");
      expect(words, `${where}: mastery or probability wording`).not.toMatch(/master(y|ed)|probab|likelihood|\bodds\b|forgetting curve/i);
      // A percentage belongs beside its numerator, denominator and conditions; these screens show none at all, apart
      // from the zoom of the map, which measures the drawing and not the learner.
      const percentages = await main.evaluate((root) => {
        const hits: string[] = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const el = node.parentElement;
          if (!el || !/%|\bper ?cent\b/i.test(node.textContent ?? "") || el.closest('[data-testid="map-key"]')) continue;
          if (getComputedStyle(el).display !== "none") hits.push((node.textContent ?? "").trim().slice(0, 80));
        }
        return hits;
      });
      // Left out: the sentence that denies a mastery percentage, and the labelled fixture tutor's own analysis of an
      // answer, which these screens quote as recorded ("Observed in that response: Fixture heuristic: … (44%).") and
      // which is the test double speaking, not a figure of the app.
      expect(percentages.filter((hit) => !hit.includes("No mastery percentage") && !/^Fixture heuristic\b/.test(hit)), `${where}: percentages`).toEqual([]);
    };
    // The concept screens: course outline with every row open, and a node with recorded evidence.
    await openConcepts(page);
    await openWholeOutline(page);
    await expectNoScoreWords("concept outline");
    await openConcepts(page, "?node=be505.skill.ori.explain&panel=evidence");
    await showDetail(page, "Evidence");
    await expectNoScoreWords("concept evidence");
    // The gap screen (Progress) and the history.
    await page.goto("/progress");
    await expect(page.getByRole("heading", { level: 1, name: "Progress" })).toBeVisible();
    expect(await textOf(page.getByRole("main"))).toContain(DENIAL);
    await expectNoScoreWords("Progress");
    await page.goto("/history");
    await expect(page.getByRole("heading", { level: 1, name: "Study history" })).toBeVisible();
    await expect(page.getByRole("tabpanel", { name: /^Attempts/ }).getByRole("listitem").first()).toBeVisible();
    await expectNoScoreWords("Study history");

    // A concept without any record: "Unknown", in the neutral colour of secondary text, with a neutral glyph.
    await openConcepts(page, `?scope=lecture:${LECTURE}`);
    const outline = await openWholeOutline(page);
    const unrecorded = treeItem(outline, "be505.skill.binding-site.explain").first().locator(':scope > [data-row] [data-state="unknown"]');
    await expect.poll(() => textOf(unrecorded)).toBe("Unknown · no recorded attempt");
    expect(await textOf(treeItem(outline, "be505.concept.ribosome-binding-site").first())).not.toMatch(/\bweak|\bgap\b|\bbehind\b|\bat risk\b|\bfail|needs? (work|attention)/i);
    const colours = await unrecorded.evaluate((chip) => {
      const chroma = (colour: string): number => { const parts = (colour.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number); return Math.max(...parts) - Math.min(...parts); };
      const glyph = chip.querySelector("svg");
      const neutral = document.querySelector('[data-testid="outline-scope-count"]');
      return { text: getComputedStyle(chip).color, neutral: neutral ? getComputedStyle(neutral).color : "", glyphChroma: glyph ? chroma(getComputedStyle(glyph).color) : -1, textChroma: chroma(getComputedStyle(chip).color) };
    });
    expect(colours.text, "the colour of the words is the colour of secondary text").toBe(colours.neutral);
    expect(colours.glyphChroma, "the glyph is drawn").toBeGreaterThanOrEqual(0);
    expect(colours.glyphChroma, "the glyph has no signal colour (red, amber, green)").toBeLessThan(64);

    // A structural page: the This-slide scope says the page is structural and offers the lecture; nothing warns.
    await openLecture(page, 1, "concepts");
    const tab = page.getByTestId("concepts-tab");
    await expect(tab.getByRole("heading", { level: 3, name: "Structural (title or section)" })).toBeVisible();
    await expect.poll(() => textOf(tab.getByTestId("structural-note"))).toBe("No concept list is kept for a title, section, administrative or blank page.");
    await expect(tab.getByRole("link", { name: "Concepts of this lecture" })).toHaveAttribute("href", `/courses/${COURSE}/concepts?scope=${encodeURIComponent(`lecture:${LECTURE}`)}`);
    await expect(tab.locator('[role="alert"], [role="status"]')).toHaveCount(0);
    expect(await textOf(tab)).not.toMatch(/unassessed|not (yet )?assessed|no attempt|no concepts? (is|are|was|were) (assessed|recorded|linked)|nothing/i);
    await openConcepts(page, `?scope=slide:${LECTURE}:1`);
    const empty = emptyScope(page);
    await expect.poll(() => textOf(empty)).toContain("PDF page 1 of 14 is a structural page (title or section). Concepts are listed for the lecture.");
    await expect(empty.getByRole("button", { name: "Next content" })).toBeVisible();
    expect(await textOf(page.getByRole("main"))).not.toMatch(/unassessed|not (yet )?assessed|no attempt/i);
    await empty.getByRole("button", { name: "Show this lecture" }).click();
    await expect(page.getByRole("radiogroup", { name: "Scope of the concept map" }).getByRole("radio", { name: "Lecture" })).toHaveAttribute("aria-checked", "true");
    await showOutline(page);
    await expect.poll(() => textOf(page.getByTestId("outline-scope-count"))).toBe(`${TITLE}: 4 concepts, 5 skills, 6 questions`);
  });

  test("R2-C11 after a slide is regrouped and a suggested link accepted, the Concepts tab shows the new state, an older concept map says it is older and refreshes to it, and another lecture's map is untouched", async ({ page, context }) => {
    test.setTimeout(240_000);
    const ACCEPT = startsWith("Accept the suggested link of L05, question 3");
    const TAKE_BACK = startsWith("Take back your decision on the suggested link of L05, question 3");
    const CONCEPT = "be505.concept.blank-subtraction";
    const otherLecture = async (): Promise<string> => {
      await openConcepts(page, "?scope=lecture:lecture-01");
      const tree = await openWholeOutline(page);
      await expect(page.getByRole("status").filter({ hasText: /was made before/ })).toHaveCount(0);
      return `${await textOf(page.getByTestId("outline-scope-count"))} | ${await textOf(tree)}`;
    };
    const untouched = await otherLecture();

    // The Concepts tab of step 1 of a two-step slide, and the concept map of that slide opened from it.
    await openLecture(page, 7, "concepts");
    const tab = page.getByTestId("concepts-tab");
    await expect.poll(() => textOf(tab.getByTestId("concepts-heading"))).toBe("On this slide: 1 concept, 1 skill, 1 question");
    expect(await textOf(tab)).toContain("One slide in 2 steps, pp. 7–8.");
    expect(await textOf(treeItem(tab.getByRole("tree", { name: "Concepts of this slide" }), CONCEPT).locator(":scope > [data-row]"))).toBe("Concept: Blank subtraction 1 skill, 1 question · group-level: all 2 steps Suggested link");
    await tab.getByRole("link", { name: "Open the concept map" }).click();
    await expect(page.getByTestId("concept-explorer")).toHaveAttribute("data-scope", `slide:${LECTURE}:7`);
    let outline = await showOutline(page);
    expect(await textOf(treeItem(outline, CONCEPT).locator(":scope > [data-row]"))).toContain("group-level: all 2 steps");

    // In a second window of the same browser: accept the suggested link of the slide, then ungroup the two steps.
    const other = await context.newPage();
    try {
      if (!isNarrow(page)) await other.setViewportSize({ width: 1440, height: 900 });
      await other.goto(`/courses/${COURSE}/lectures/${LECTURE}?page=7&panel=questions`);
      const link = (): Locator => basis(row(other.getByTestId("this-slide-list"), Q03), "agent_inferred");
      await link().getByRole("button", { name: ACCEPT }).click();
      await expect.poll(() => textOf(link())).toContain("Suggested link, confirmed by you.");
      await recordGrouping(other, /Each of these pages is its own slide/);
      await expect.poll(() => textOf(other.getByTestId("slide-position"))).toBe("PDF page 7 of 14");
      // There, the Concepts tab shows the new state by itself (or after Refresh, if it says it is older).
      await openTab(other, "Concepts");
      const otherTab = other.getByTestId("concepts-tab");
      const refresh = otherTab.getByRole("button", { name: "Refresh" });
      if (await refresh.count()) await refresh.click();
      await expect.poll(() => textOf(treeItem(otherTab.getByRole("tree", { name: "Concepts of this slide" }), CONCEPT).locator(":scope > [data-row]"))).toBe("Concept: Blank subtraction 1 skill, 1 question · on this page Suggested link");
      expect(await textOf(otherTab)).not.toContain("One slide in 2 steps");

      // The concept map opened before the change: the next thing asked of it shows that it is older, in one line, with Refresh.
      await treeAction(treeItem(outline, CONCEPT)).click();
      const notice = page.getByRole("status").filter({ hasText: /^This view was made before / });
      await expect(notice).toHaveCount(1);
      expect(await textOf(notice)).toMatch(/^This view was made before .*the slide groups or roles changed.*\. ?Refresh$/);
      await notice.getByRole("button", { name: "Refresh" }).click();
      await expect(notice).toHaveCount(0);
      // The refreshed map holds the new state: the page is a slide of its own, and its support is on this page.
      outline = await showOutline(page);
      await expect.poll(() => textOf(treeItem(outline, CONCEPT).locator(":scope > [data-row]"))).toContain("on this page");
      expect(await textOf(treeItem(outline, CONCEPT).locator(":scope > [data-row]"))).not.toMatch(/steps/);
      if (!isNarrow(page)) await expect.poll(() => textOf(page.getByTestId("concept-scope-identity"))).toBe("PDF page 7 of 14");
      // The correction and the accepted link are still there afterwards.
      await openQuestions(page, 7);
      expect(await textOf(basis(row(page.getByTestId("this-slide-list"), Q03), "agent_inferred"))).toContain("Suggested link, confirmed by you.");
      await openTab(page, "Sources");
      expect(await textOf(page.getByTestId("page-facts"))).not.toMatch(/Step 1 of 2/);
      // The concept map of another lecture says nothing and holds what it held.
      expect(await otherLecture()).toBe(untouched);
    } finally {
      // Put both back through the interface: the grouping as the file gives it, the link as a suggestion.
      await other.goto(`/courses/${COURSE}/lectures/${LECTURE}?page=7&panel=questions`);
      await expect(other.getByTestId("questions-tab")).toBeVisible();
      if ((await textOf(other.getByTestId("questions-tab"))).includes("confirmed by you")) {
        await other.getByTestId("this-slide-list").getByRole("button", { name: TAKE_BACK }).click();
        await expect(other.getByTestId("this-slide-list").getByRole("button", { name: ACCEPT })).toBeVisible();
      }
      await showSlide(other);
      if ((await textOf(other.getByTestId("slide-position"))) === "PDF page 7 of 14") await recordGrouping(other, /Take back your correction/);
      await expect.poll(() => textOf(other.getByTestId("slide-position"))).toBe("PDF page 7 of 14 · step 1 of 2");
      await other.close();
    }
    await openLecture(page, 7, "concepts");
    await expect.poll(() => textOf(treeItem(page.getByTestId("concepts-tab").getByRole("tree", { name: "Concepts of this slide" }), CONCEPT).locator(":scope > [data-row]"))).toBe("Concept: Blank subtraction 1 skill, 1 question · group-level: all 2 steps Suggested link");
  });
});
