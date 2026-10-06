// The detail of a selected node (design specification 7.4, 9.8, 9.9) in jsdom: what the header says, which page "Open
// page" opens, source rows as openable links worded by their tie, a concept's definition state, and the Evidence tab:
// the five states with prior exposure beside them, counts with their denominator, no score and no percentage.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import type { ReactElement } from "react";
import { ConceptDetail, detailCounts, detailKicker, detailSummary, primaryPage, questionsHeading, sourceTieSentence } from "@/features/concepts/ConceptDetail";
import { parseScope } from "@/features/concepts/map-model";
import { sampleEvidence, sampleLectureView } from "@/lib/fixtures/r2-sample";
import { NBSP } from "@/lib/labels";
import type { OutlineNodeView } from "@/lib/types";

const plain = (text: string | null | undefined): string => (text ?? "").split(NBSP).join(" ");
const question = (id: string, title: string, extra: Partial<OutlineNodeView["questions"][number]> = {}): OutlineNodeView["questions"][number] => ({
  question_id: id, version: 1, collection: "L90", number: 1, title, origin: "generated_practice", topic: null, prompt: `Synthetic prompt of ${title}.`, prompt_in_index: true, family_id: null, family_revision: null,
  criteria_count: 2, criteria_authorship: "catalog", lecture_ids: ["lecture-90"], membership: { basis: "cited_source_in_unit", source_ids: [] }, anchors: [], anchor_state: "resolved", slide_anchor: "named", locator_text: "",
  qualifiers: [], unparsed: [], original: null, display_rendition: null, related_copy: null, concept_ids: [], tie_to_node: "assessment", criterion_ids: [`${id}.C01`], evidence: sampleEvidence.unknown, ...extra,
});

const DETAIL: OutlineNodeView = {
  node: { node_id: "c-sample-1", kind: "concept", label: "Sample concept one" },
  parents: [{ node_id: "t-sample-a", kind: "topic", label: "Sample topic A" }],
  sources: [
    { kind: "pages", source_id: "src-sample-slides", lecture_id: "lecture-90", pages: [3, 4, 5], ranges: [[3, 5]], label: "PDF pages 3–5", tie: "exact", basis: "question anchor (exact)", from: ["L90-Q01"], href: "/courses/sample-course/lectures/lecture-90?page=3" },
    { kind: "pages", source_id: "src-sample-slides", lecture_id: "lecture-90", pages: [7], ranges: [[7, 7]], label: "PDF page 7", tie: "agent_inferred", basis: "suggested link", from: ["L90-Q02"], href: "/courses/sample-course/lectures/lecture-90?page=7" },
    { kind: "transcript_lines", source_id: "src-sample-transcript", lecture_id: "lecture-90", pages: [], ranges: [[9, 17]], label: "Transcript lines 9–17", tie: "stated", basis: "skill source reference", from: ["s-sample-1"], href: "/courses/sample-course/lectures/lecture-90?line=9" },
    { kind: "text", source_id: null, lecture_id: null, pages: [], locator_text: "See the worked example in the handout", tie: "stated", basis: "skill source reference", from: ["s-sample-1"], href: null },
  ],
  sources_total: 4,
  questions: [question("L90-Q01", "Sample question 1", { evidence: sampleEvidence.assisted }), question("L90-Q02", "Sample question 2", { prompt_in_index: false, prompt: "kept in the source", evidence: sampleEvidence.independent })],
  questions_total: 2,
  evidence: {
    unit: "skill", skills: [{ skill_id: "s-sample-1", label: "Explain sample concept one", status: "demonstrated_assisted", facet: "conceptual_explanation", episodes: 3, observations_by_condition: { unaided: 1, assisted: 1, prior_exposure: 1 }, unaided_demonstrated: 0 }],
    skills_total: 1, state: "assisted", assistance: "solution_shown", prior_exposure: "seen", attempts: 3,
    observations: [
      { attempt_id: "a-3", recorded_at: "2026-09-20T15:00:00+00:00", outcome: "demonstrated", state: "assisted", assistance: "solution_shown", prior_exposure: "seen", question_id: "L90-Q01", skill_id: "s-sample-1" },
      { attempt_id: "a-2", recorded_at: "2026-09-12T15:00:00+00:00", outcome: "partial", state: "independent", assistance: null, prior_exposure: "unseen", question_id: "L90-Q02", skill_id: "s-sample-1" },
      { attempt_id: "a-1", recorded_at: null, outcome: "not_observed", state: "not_separately_observed", assistance: null, prior_exposure: "unknown", question_id: "L90-Q09", skill_id: null },
    ],
    summary: { independent: 1, assisted: 1, not_separately_observed: 1, unknown: 0, observations: 3, attempts: 3 },
  },
  links: [],
  definition: { state: "coverage_gap", text: null, reason: "The course catalog records no definition for this concept." },
};

let detail: OutlineNodeView = DETAIL;
beforeEach(() => {
  detail = DETAIL;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/outline/node")) return new Response(JSON.stringify(detail), { status: 200 });
    if (url.includes("/lectures/")) return new Response(JSON.stringify(sampleLectureView), { status: 200 });
    if (/\/courses\/[^/]+$/.test(url)) return new Response(JSON.stringify({ course_id: "sample-course", display_name: "Sample course", lectures: [{ lecture_id: "lecture-90", title: "Sample lecture 90" }] }), { status: 200 });
    return new Response(JSON.stringify({ detail: "not mocked" }), { status: 404 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

function mount(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}
const panel = (tab: "sources" | "questions" | "evidence", scope = "lecture:lecture-90") =>
  <ConceptDetail courseId="sample-course" nodeId="c-sample-1" tab={tab} scope={parseScope(scope)} returnTo="/courses/sample-course/concepts?scope=lecture%3Alecture-90&node=c-sample-1" framed
    graphNode={{ id: "c-sample-1", kind: "concept", label: "Sample concept one", counts: { skills: 1, questions: 2 }, in_scope: true, evidence: null,
      where: scope.startsWith("slide") ? "elsewhere_in_sequence" : null, support_pages: scope.startsWith("slide") ? [5] : [] }} // only a slide scope says where the support is
    place={{ page: 4, position: { ordinal: 2, of: 3, kind: "build" }, groupPages: [3, 4, 5] }} />;

describe("what the header says", () => {
  it("names the kind and where the node sits", () => {
    expect(detailKicker(DETAIL)).toEqual({ kind: "Concept", place: "in Sample topic A" });
    expect(detailKicker({ node: { node_id: "c", kind: "concept", label: "c" }, parents: [] }).place).toBe("filed under no topic in the catalog");
    expect(detailKicker({ node: { node_id: "t", kind: "topic", label: "t" }, parents: [] })).toEqual({ kind: "Topic", place: null });
    expect(detailKicker({ node: { node_id: "k", kind: "criterion", label: "k" }, parents: [{ node_id: "q", kind: "question", label: "Sample question 1" }] }).place).toBe("of Sample question 1");
  });

  it("counts in the words of the scope, and leaves out a count that does not apply", () => {
    expect(plain(detailSummary({ kind: "concept", counts: { skills: 3, questions: 2 } }, "slide"))).toBe("3 skills and 2 questions on this slide.");
    expect(plain(detailSummary({ kind: "skill", counts: { skills: null, questions: 1 } }, "course"))).toBe("1 question in the course.");
    expect(plain(detailSummary({ kind: "question", counts: { skills: 2, questions: null } }, "lecture"))).toBe("It assesses 2 skills in this lecture.");
    expect(detailSummary({ kind: "criterion", counts: { skills: null, questions: null } }, "course")).toBeNull();
    expect(detailSummary(null, "course")).toBeNull();
  });

  it("counts the tabs from the detail: source rows, questions, recorded attempts", () => {
    expect(detailCounts(DETAIL)).toEqual({ sources: 4, questions: 2, evidence: 3 });
    expect(detailCounts(null)).toEqual({ sources: null, questions: null, evidence: null });
    expect(plain(questionsHeading("concept", 2))).toBe("2 questions test this concept");
    expect(plain(questionsHeading("skill", 1))).toBe("1 question tests this skill");
    expect(questionsHeading("question", 1)).toBe("This question");
  });
});

describe("which page is opened", () => {
  it("is a page of the scope's lecture, and in the slide scope the page the support is recorded on", () => {
    expect(primaryPage(DETAIL, parseScope("lecture:lecture-90"))).toEqual({ lectureId: "lecture-90", page: 3 });
    expect(primaryPage(DETAIL, parseScope("slide:lecture-90:4"), { support_pages: [4, 5] })).toEqual({ lectureId: "lecture-90", page: 4 });
    expect(primaryPage(DETAIL, parseScope("slide:lecture-90:3"), { support_pages: [5] })).toEqual({ lectureId: "lecture-90", page: 5 });
    expect(primaryPage(DETAIL, parseScope("course"))).toEqual({ lectureId: "lecture-90", page: 3 });
  });
  it("is nothing when no source row is an openable page", () => {
    expect(primaryPage({ sources: DETAIL.sources.slice(2) }, parseScope("course"))).toBeNull();
    expect(primaryPage(null, parseScope("course"))).toBeNull();
  });
});

describe("the tie of a source row, in words", () => {
  it("is said of what the row names, and a suggestion is never worded as the course's anchor", () => {
    expect(sourceTieSentence({ tie: "exact", kind: "pages", pages: [3, 4] })).toBe("Exact. A reviewed anchor of the course record names these pages.");
    expect(sourceTieSentence({ tie: "stated", kind: "pages", pages: [7] })).toBe("Stated. The course record names this page. Its basis is not reviewed.");
    expect(sourceTieSentence({ tie: "stated", kind: "transcript_lines", pages: [] })).toBe("Stated. The course record names these lines. Their basis is not reviewed.");
    const suggested = sourceTieSentence({ tie: "agent_inferred", kind: "pages", pages: [7] });
    expect(suggested).toMatch(/^Suggested link\./);
    expect(suggested).not.toMatch(/Exact|Stated|reviewed anchor/);
  });
});

describe("the panel", () => {
  it("lists openable source pages, words each tie, and states a missing definition without filling it in", async () => {
    mount(panel("sources"));
    expect(await screen.findByRole("heading", { name: "Sample concept one" })).toBeInTheDocument();
    expect(plain(screen.getByTestId("outline-detail").textContent)).toContain("1 skill and 2 questions in this lecture.");
    const rows = screen.getAllByTestId("source-row");
    expect(rows).toHaveLength(4);
    expect(within(rows[0]!).getByRole("link")).toHaveAttribute("href", "/courses/sample-course/lectures/lecture-90?page=3");
    expect(within(rows[2]!).getByRole("link")).toHaveAttribute("href", "/courses/sample-course/lectures/lecture-90?line=9");
    expect(within(rows[3]!).queryByRole("link")).toBeNull(); // a reference in words: nothing to open, and not turned into a page
    expect(rows[3]!.textContent).toContain("See the worked example in the handout");
    expect(rows[1]!.textContent).toContain("Suggested link.");
    expect(await within(rows[0]!).findByText(/Sample lecture 90, PDF pages 3–5/)).toBeInTheDocument();
    expect(screen.getByTestId("definition")).toHaveAttribute("data-state", "coverage_gap");
    expect(screen.getByTestId("definition").textContent).toContain("The catalog holds no definition for this concept.");
    expect(screen.getByRole("link", { name: /Open\spage\s3/ })).toHaveAttribute("href", "/courses/sample-course/lectures/lecture-90?page=3");
  });

  it("says where the support is in the slide scope, and offers the range of that page to play", async () => {
    mount(panel("sources", "slide:lecture-90:4"));
    await screen.findByRole("heading", { name: "Sample concept one" });
    expect(plain(screen.getByTestId("outline-detail").textContent)).toContain("Its support is elsewhere in this sequence: build 3.");
    expect(screen.getByRole("link", { name: /Open\spage\s5/ })).toHaveAttribute("href", "/courses/sample-course/lectures/lecture-90?page=5");
    const play = await screen.findByRole("link", { name: /^Play\s/ });
    expect(play.getAttribute("href")).toMatch(/\/lectures\/lecture-90\?page=5&range=.+&play=1$/);
  });

  it("shows the catalog's own definition when it has one", async () => {
    detail = { ...DETAIL, definition: { state: "catalog", text: "A synthetic definition from the catalog.", reason: null } };
    mount(panel("sources"));
    expect(await screen.findByText("A synthetic definition from the catalog.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Definition" })).toBeInTheDocument();
  });

  it("lists the questions compactly with their own evidence, and keeps a source-owned wording in its source", async () => {
    mount(panel("questions"));
    expect(await screen.findByRole("heading", { name: /2\squestions test this concept/ })).toBeInTheDocument();
    const rows = screen.getAllByTestId("question-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("Synthetic prompt of Sample question 1.");
    expect(plain(rows[0]!.textContent)).toContain("Assisted: solution shown");
    expect(rows[1]!.textContent).toContain("The wording of this question is kept in its original source.");
    expect(rows[1]!.textContent).not.toContain("kept in the source");
    expect(within(rows[0]!).getByRole("link", { name: "Open the question" })).toHaveAttribute("href", "/courses/sample-course/questions/L90-Q01");
  });

  it("shows evidence as single attempts in five states, prior exposure beside each, counts with a denominator and no score", async () => {
    mount(panel("evidence"));
    expect(plain((await screen.findByTestId("evidence-summary")).textContent)).toBe("Of 3 recorded observations: 1 independent, 1 assisted, 1 not separately observed.");
    const lines = screen.getAllByTestId("observation").map((entry) => plain(entry.textContent));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Sample question 1");
    expect(lines[0]).toContain("Assisted: solution shown · prior exposure");
    expect(lines[0]).toContain("Demonstrated.");
    expect(lines[1]).toContain("Independent · no prior exposure");
    expect(lines[1]).toContain("Partly shown.");
    expect(lines[2]).toContain("Date not recorded, L90-Q09");
    expect(lines[2]).toContain("Not separately observed · prior exposure not recorded");
    const all = plain(screen.getByTestId("outline-detail").textContent);
    expect(all).toContain("Nothing is averaged into a score.");
    expect(all).not.toMatch(/%|mastery|mastered|proficien/i);
  });

  it("says that nothing is selected, and explains an identifier the catalog does not hold", async () => {
    const { unmount } = mount(<ConceptDetail courseId="sample-course" nodeId={null} tab="sources" scope={parseScope("course")} returnTo="/" framed />);
    expect(screen.getByRole("heading", { name: "Nothing is selected" })).toBeInTheDocument();
    unmount();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Unknown catalog object" }), { status: 404 })));
    const onClear = vi.fn();
    mount(<ConceptDetail courseId="sample-course" nodeId="gone" tab="sources" scope={parseScope("course")} returnTo="/" onClear={onClear} framed />);
    expect(await screen.findByRole("heading", { name: "This item is not in the catalog" })).toBeInTheDocument();
    screen.getByRole("button", { name: "Clear the selection" }).click();
    expect(onClear).toHaveBeenCalled();
  });
});
