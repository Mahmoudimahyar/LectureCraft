// Where an entry's support is inside a build group (UI contract R2-C: something first shown on a later build is never
// presented as shown on an earlier one). The graphs and outline rows below are what the fixture Brain answers for the
// three builds of the sample lecture's group (lecture-05, PDF pages 4, 5 and 6): one concept is supported on every
// build, the other only on the third (a suggested link states that criterion for page 6 alone). The Brain is a LABELED
// DOUBLE here (a stubbed fetch). Checked on each of the three pages: the slide scope's graph (what the map draws and
// which nodes the slide's source line reaches), the slide scope's outline rows, and the Concepts tab of the lecture.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, configure, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { ConceptsTab } from "@/features/concepts/ConceptsTab";
import { rowLines, wherePhrase, type TreePlace } from "@/features/concepts/ConceptTree";
import { buildMapModel, sourceTies } from "@/features/concepts/map-model";
import { sampleLectureView, sampleSourceMap } from "@/lib/fixtures/r2-sample";
import { NBSP } from "@/lib/labels";
import type { ConceptGraphEdge, ConceptGraphNode, ConceptGraphView, LectureView, OutlineRow, OutlineView, TieWhere } from "@/lib/types";

const plain = (text: string | null | undefined): string => (text ?? "").split(NBSP).join(" ");
// The tab reads the scope and then three levels of the outline: on a busy machine that can pass the library's one second.
configure({ asyncUtilTimeout: 5000 });
const GROUP = [4, 5, 6];
const SLIDE = "ls-fixture-p4-6";
const TOPIC = "t-reporter-assays";
const EVERY = { concept: "c-reporter-gene", skill: "s-reporter-explain" }; // supported on every build
const THIRD = { concept: "c-binding-site", skill: "s-binding-site-explain" }; // supported on the third build only
const PAGES = [4, 5, 6] as const;

/** Where the entry that is supported on page 6 only sits, seen from each page. */
const thirdWhere = (page: number): TieWhere => (page === 6 ? "on_this_page" : "elsewhere_in_sequence");

const node = (id: string, kind: ConceptGraphNode["kind"], label: string, where: TieWhere | null, pages: number[]): ConceptGraphNode =>
  ({ id, kind, label, counts: { skills: kind === "skill" ? null : 1, questions: 1 }, in_scope: true, where, support_pages: pages, evidence: { state: "unknown", assistance: null, prior_exposure: "unknown", attempts: 0 } });
let serial = 0;
const edge = (family: ConceptGraphEdge["family"], relation: string, from: string, to: string, extra: Partial<ConceptGraphEdge> = {}): ConceptGraphEdge =>
  ({ id: `e-${(serial += 1)}`, from, to, family, relation, provenance: family === "source" ? "course anchor (reviewed page)" : "question index", automatic_credit: false, tie: null, support_pages: null, ...extra });
const suggested = { tie: "agent_inferred" as const, provenance: "suggested link (agent-inferred)" };

/** `GET …/concept-graph?scope=slide:lecture-05:<page>` of the fixture, without a focus. */
function slideGraph(page: number): ConceptGraphView {
  return {
    course_id: "be505", graph_version: "concept-graph/1",
    scope: { kind: "slide", lecture_id: "lecture-05", page, logical_slide_id: SLIDE, label: `PDF page ${page} of 14 · build ${page - 3} of 3`, pages: GROUP, note: null },
    nodes: [
      node(TOPIC, "topic", "Reporter assays", null, []),
      node(EVERY.concept, "concept", "Reporter gene", "group_level", GROUP), node(THIRD.concept, "concept", "Ribosome binding site", thirdWhere(page), [6]),
      node(EVERY.skill, "skill", "Explain a reporter", "group_level", GROUP), node(THIRD.skill, "skill", "Explain a binding site", thirdWhere(page), [6]),
    ],
    edges: [
      edge("structure", "topic_includes_concept", TOPIC, EVERY.concept), edge("structure", "topic_includes_concept", TOPIC, THIRD.concept),
      edge("structure", "concept_assessed_as_skill", EVERY.concept, EVERY.skill), edge("structure", "concept_assessed_as_skill", THIRD.concept, THIRD.skill),
      // A source edge starts at the logical slide (the group), whatever page is on screen: its own pages say where the support is.
      edge("source", "slide_supports_by_assessment", SLIDE, EVERY.concept, { ...suggested, support_pages: [5, 6] }), edge("source", "slide_supports_by_assessment", SLIDE, EVERY.concept, { tie: "exact", support_pages: GROUP }),
      edge("source", "slide_supports_by_assessment", SLIDE, EVERY.skill, { ...suggested, support_pages: [5, 6] }), edge("source", "slide_supports_by_assessment", SLIDE, EVERY.skill, { tie: "exact", support_pages: GROUP }),
      edge("source", "slide_supports_by_assessment", SLIDE, THIRD.concept, { ...suggested, support_pages: [6] }), edge("source", "slide_supports_by_assessment", SLIDE, THIRD.skill, { ...suggested, support_pages: [6] }),
    ],
    focus: null, truncated: false, dropped: 0, totals: { topic: 1, concept: 2, skill: 2, question: 2, criterion: 3 },
    revisions: { question_index_sha256: "a".repeat(64), map_revision: sampleLectureView.revisions?.map_revision ?? null, evidence_revision: "b".repeat(16), scope_revision: `scope-${page}` },
  };
}

const row = (path: string, kind: OutlineRow["kind"], label: string, where: TieWhere | null, pages: number[], extra: Partial<OutlineRow> = {}): OutlineRow => {
  const ids = path.split(">");
  return { instance_id: path, node_id: ids[ids.length - 1]!, kind, label, relation: ids.length === 1 ? "root" : "child", depth: ids.length - 1, repeated_on_path: false, has_children: kind !== "skill", skills: 1, questions: 1,
    where, support_pages: pages, ...extra };
};
/** `GET …/outline?scope=slide:lecture-05:<page>&parent=` of the fixture, topic to skill. */
function outlineRows(page: number, parent: string): OutlineRow[] {
  if (!parent) return [row(TOPIC, "topic", "Reporter assays", null, [], { skills: 2, questions: 2 })];
  if (parent === TOPIC) return [row(`${TOPIC}>${EVERY.concept}`, "concept", "Reporter gene", "group_level", GROUP), row(`${TOPIC}>${THIRD.concept}`, "concept", "Ribosome binding site", thirdWhere(page), [6])];
  if (parent === `${TOPIC}>${EVERY.concept}`) return [row(`${parent}>${EVERY.skill}`, "skill", "Explain a reporter", "group_level", GROUP)];
  if (parent === `${TOPIC}>${THIRD.concept}`) return [row(`${parent}>${THIRD.skill}`, "skill", "Explain a binding site", thirdWhere(page), [6])];
  return [];
}
const outline = (page: number, parent: string): OutlineView => {
  const rows = outlineRows(page, parent);
  return { course_id: "be505", scope: { kind: "slide", basis: "catalog", note: "", questions_in_scope: 2, lecture_id: "lecture-05", page, logical_slide_id: SLIDE, pages: GROUP, suggested_questions: ["BE505-L05-Q02"] },
    canonical_counts: { topic: 1, concept: 2, skill: 2, question_family: 0, question: 2, criterion: 3, question_relationship: 0 }, rows, total_children: rows.length, truncated: false, note: "" };
};

const place = (page: number): TreePlace => ({ page, position: { ordinal: page - 3, of: 3, kind: "build" }, groupPages: GROUP });

describe("the slide scope's graph on each build of the group", () => {
  it.each(PAGES)("page %i: says where each entry's support is, naming the build when it is elsewhere", (page) => {
    const model = buildMapModel(slideGraph(page));
    const said = (id: string): string => {
      const entry = model.nodes.find((candidate) => candidate.id === id)!;
      return plain(wherePhrase({ where: entry.where, support_pages: entry.supportPages }, place(page)));
    };
    expect(said(EVERY.concept)).toBe("group-level: all 3 builds");
    expect(said(EVERY.skill)).toBe("group-level: all 3 builds");
    const expected = page === 6 ? "on this build" : "elsewhere in this sequence: build 3";
    expect(said(THIRD.concept)).toBe(expected);
    expect(said(THIRD.skill)).toBe(expected);
  });

  it.each([4, 5])("page %i (an earlier build): draws no source line from this slide to what the third build first shows", (page) => {
    const model = buildMapModel(slideGraph(page));
    const lines = model.edges.filter((entry) => entry.family === "source");
    expect(lines.map((entry) => entry.target).sort()).toEqual([EVERY.concept, EVERY.skill].sort());
    // The entry stays in the drawing, with its place and with what its support rests on.
    const third = model.nodes.find((entry) => entry.id === THIRD.concept)!;
    expect(third.where).toBe("elsewhere_in_sequence");
    expect(third.tie).toBe("agent_inferred");
  });

  it("page 6 (the third build): draws the source line, as a suggested link", () => {
    const model = buildMapModel(slideGraph(6));
    const lines = model.edges.filter((entry) => entry.family === "source");
    expect(lines.map((entry) => entry.target).sort()).toEqual([EVERY.concept, EVERY.skill, THIRD.concept, THIRD.skill].sort());
    expect(lines.find((entry) => entry.target === THIRD.concept)).toMatchObject({ tie: "agent_inferred", arrow: "target" });
  });

  it("a source line speaks only for the ties of the page on screen: on build 1 the suggested link of builds 2 and 3 is not on the line", () => {
    const line = (page: number) => buildMapModel(slideGraph(page)).edges.find((entry) => entry.family === "source" && entry.target === EVERY.concept)!;
    expect(line(4).tie).toBe("exact");
    expect(line(4).provenance).toBe("course anchor (reviewed page)");
    expect(line(5).tie).toBe("exact");
    expect(line(5).provenance).toContain("suggested link (agent-inferred)");
    expect(line(5).provenance).toContain("course anchor (reviewed page)");
  });

  it("keeps the line of a tie that states no pages (an older Brain): nothing is known against it", () => {
    const graph = slideGraph(5);
    const unstated: ConceptGraphView = { ...graph, edges: graph.edges.map((entry) => (entry.family === "source" && entry.to === THIRD.concept ? { ...entry, support_pages: null } : entry)) };
    expect(buildMapModel(unstated).edges.some((entry) => entry.family === "source" && entry.target === THIRD.concept)).toBe(true);
  });

  it("still tells the tree which entries rest on a suggested link only, whatever build is on screen", () => {
    for (const page of PAGES) {
      const ties = sourceTies(slideGraph(page));
      expect(ties.get(THIRD.concept)).toBe("agent_inferred");
      expect(ties.get(EVERY.concept)).toBe("exact");
    }
  });
});

describe("the slide scope's outline rows on each build of the group", () => {
  it.each(PAGES)("page %i: a row never says its support is on a build that does not show it", (page) => {
    const rows = [...outlineRows(page, TOPIC), ...outlineRows(page, `${TOPIC}>${THIRD.concept}`)];
    const where = (id: string): string => plain(rowLines(rows.find((entry) => entry.node_id === id)!, { scopeKind: "slide", place: place(page) }).where);
    expect(where(EVERY.concept)).toBe("group-level: all 3 builds");
    expect(where(THIRD.concept)).toBe(page === 6 ? "on this build" : "elsewhere in this sequence: build 3");
    expect(where(THIRD.skill)).toBe(page === 6 ? "on this build" : "elsewhere in this sequence: build 3");
  });
});

// ---- the Concepts tab of the lecture, on the same three pages ------------------------------------------------------------------
/** The sample lecture with pages 4, 5 and 6 as one build group, like the fixture's lecture-05. */
const lecture: LectureView = {
  ...sampleLectureView, course_id: "be505", lecture_id: "lecture-05",
  source_map: { ...sampleSourceMap, logical_slides: [
    ...sampleSourceMap.logical_slides.filter((slide) => !slide.pages.some((page) => page >= 3 && page <= 7)),
    { id: SLIDE, kind: "build_group", pages: GROUP, title: "A sample build", role: "instructional", grouping: { basis: "inferred", state: "generated", confidence: "high", signals: [] } },
  ] },
  slides: sampleLectureView.slides.map((slide) => (GROUP.includes(slide.page)
    ? { ...slide, identity: { ...slide.identity!, logical_slide_id: SLIDE, position: { ordinal: slide.page - 3, of: 3, kind: "build" as const }, label: `PDF page ${slide.page} of 12 · build ${slide.page - 3} of 3` } }
    : slide)),
};

describe("the Concepts tab on each build of the group", () => {
  let current = 4;
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const scope = url.searchParams.get("scope") ?? "";
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      if (url.pathname.endsWith("/concept-graph")) return json(scope.startsWith("slide:") ? slideGraph(current) : { ...slideGraph(current), scope: { ...slideGraph(current).scope, kind: "lecture", page: null, logical_slide_id: null, label: null, pages: [] }, edges: [] });
      if (url.pathname.endsWith("/outline")) return json(outline(current, url.searchParams.get("parent") ?? ""));
      return new Response("{}", { status: 404 });
    }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each(PAGES)("page %i: lists each entry once with the build its support is on", async (page) => {
    current = page;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}><MemoryRouter>
        <ConceptsTab courseId="be505" lecture={lecture} page={page} slide={lecture.slides.find((slide) => slide.page === page)} onGoToPage={() => undefined} nextContentPage={null} returnTo={`/courses/be505/lectures/lecture-05?page=${page}`} />
      </MemoryRouter></QueryClientProvider>,
    );
    const third = await screen.findByRole("treeitem", { name: /Ribosome binding site/ });
    const expected = page === 6 ? "on this build" : "elsewhere in this sequence: build 3";
    const described = (element: HTMLElement): string => plain(document.getElementById(element.getAttribute("aria-describedby") ?? "")?.textContent);
    expect(described(third)).toContain(expected);
    expect(described(third)).toContain("Suggested link");
    const skill = await screen.findByRole("treeitem", { name: /Explain a binding site/ });
    expect(described(skill)).toContain(expected);
    // What every build shows is group-level, on all three pages.
    expect(described(screen.getByRole("treeitem", { name: /Reporter gene/ }))).toContain("group-level: all 3 builds");
    // Never the earlier misstatement: the union of a suggested link's pages worded as this entry's place.
    const tree = plain(screen.getByTestId("concepts-tree").textContent);
    expect(tree).not.toMatch(/builds 2 and 3|on this build and on build/);
    if (page !== 6) expect(tree).not.toMatch(/Ribosome binding site\s*(\S+\s+){0,6}on this build/);
    expect(screen.getAllByRole("treeitem", { name: /Ribosome binding site/ })).toHaveLength(1);
  });
});
