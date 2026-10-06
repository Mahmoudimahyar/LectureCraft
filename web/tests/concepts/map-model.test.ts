// The concept map's pure model (design specification 7.1, 7.3): the address of a scope, what is drawn for a selection
// (topic level, a slide's overview, a focused neighbourhood), folding, the three edge families, and the one layout
// (dagre) with its ranks. Synthetic sample graphs only.
import { describe, expect, it } from "vitest";
import {
  MAP_RANKS, OVERVIEW_TOPICS, RANK_FOLD, buildMapModel, conceptMapHref, drawnWhole, firstTopic, layoutMap, mapNodeWidth, nodeWidths, openingNode, parseScope, scopeParam, soloNodeWidth, sourceTies, topicConceptCounts, topicGrid,
  topicNodeWidth, type MapModel, type MapNodeModel,
} from "@/features/concepts/map-model";
import { sampleConceptGraphCourse, sampleConceptGraphLecture, sampleConceptGraphSlide } from "@/lib/fixtures/r2-sample";
import { NBSP } from "@/lib/labels";
import type { ConceptGraphEdge, ConceptGraphNode, ConceptGraphView } from "@/lib/types";

const plain = (text: string | null | undefined): string => (text ?? "").split(NBSP).join(" ");
const byId = (model: MapModel, id: string): MapNodeModel => {
  const found = model.nodes.find((node) => node.id === id);
  if (!found) throw new Error(`no node ${id} in the model: ${model.nodes.map((node) => node.id).join(", ")}`);
  return found;
};
const ids = (model: MapModel, rank: string): string[] => model.nodes.filter((node) => node.rank === rank).map((node) => node.id);

// ---- a synthetic graph builder ------------------------------------------------------------------------------------------
const node = (id: string, kind: ConceptGraphNode["kind"], label: string, extra: Partial<ConceptGraphNode> = {}): ConceptGraphNode =>
  ({ id, kind, label, counts: { skills: null, questions: null }, in_scope: true, where: null, support_pages: [], evidence: null, ...extra });
let serial = 0;
const edge = (family: ConceptGraphEdge["family"], relation: string, from: string, to: string, extra: Partial<ConceptGraphEdge> = {}): ConceptGraphEdge =>
  ({ id: `e-${(serial += 1)}`, from, to, family, relation, provenance: "question index", automatic_credit: false, tie: null, support_pages: null, ...extra });
const graph = (nodes: ConceptGraphNode[], edges: ConceptGraphEdge[], focus: string | null, extra: Partial<ConceptGraphView> = {}): ConceptGraphView => ({
  course_id: "sample-course", graph_version: "concept-graph/1", scope: { kind: "course", lecture_id: null, page: null, logical_slide_id: null, label: null, pages: [], note: null },
  nodes, edges, focus, truncated: false, dropped: 0, totals: { topic: 1, concept: 1, skill: 1, question: 1, criterion: 1 },
  revisions: { question_index_sha256: "a", map_revision: null, evidence_revision: "b", scope_revision: "c" }, ...extra,
});

describe("the address of a scope", () => {
  it("reads course, lecture and slide scopes and takes anything else for the course", () => {
    expect(parseScope(null)).toEqual({ kind: "course", lectureId: null, page: null });
    expect(parseScope("lecture:lecture-03")).toEqual({ kind: "lecture", lectureId: "lecture-03", page: null });
    expect(parseScope("slide:lecture-03:23")).toEqual({ kind: "slide", lectureId: "lecture-03", page: 23 });
    expect(parseScope("slide:lecture-03:0")).toEqual({ kind: "course", lectureId: null, page: null });
    expect(parseScope("nonsense")).toEqual({ kind: "course", lectureId: null, page: null });
  });

  it("writes the narrowest scope the known lecture and page allow", () => {
    expect(scopeParam("slide", "lecture-03", 23)).toBe("slide:lecture-03:23");
    expect(scopeParam("slide", "lecture-03", null)).toBe("lecture:lecture-03");
    expect(scopeParam("lecture", null, null)).toBe("course");
    expect(scopeParam("course", "lecture-03", 23)).toBe("course");
  });

  it("builds the address of the concept map, with the selected node when one is given", () => {
    expect(conceptMapHref("be505", "course")).toBe("/courses/be505/concepts");
    expect(conceptMapHref("be505", "slide:lecture-05:5")).toBe("/courses/be505/concepts?scope=slide%3Alecture-05%3A5");
    expect(conceptMapHref("be505", "lecture:lecture-05", "be505.concept.promoter")).toBe("/courses/be505/concepts?scope=lecture%3Alecture-05&node=be505.concept.promoter");
    expect(conceptMapHref("be505", "course", "c-1")).toBe("/courses/be505/concepts?node=c-1");
  });
});

describe("node width from the pane and from what is drawn", () => {
  // The panes of the default panel sizes, as measured: 590 px in a 1440 px window, 690 at 1680, 805 at 1920, 1268 at 2560.
  it("fills the pane with the nodes of the widest rank, three at most, and stops at 320 px", () => {
    expect(mapNodeWidth(590)).toBe(168);
    expect(mapNodeWidth(690)).toBe(202);
    expect(mapNodeWidth(805)).toBe(240);
    expect(mapNodeWidth(1268)).toBe(320);
    // two to a rank: wider nodes, not half an empty pane
    expect(mapNodeWidth(590, 2)).toBe(273);
    expect(mapNodeWidth(805, 2)).toBe(320);
    // an opened fold does not narrow the nodes: the drawing is then panned
    expect(mapNodeWidth(805, 7)).toBe(240);
  });
  it("never goes under 160 px, so a narrow pane is panned instead", () => {
    expect(mapNodeWidth(400)).toBe(160);
    expect(mapNodeWidth(0)).toBe(160);
  });
  it("lets a node that stands alone in its rank take up to 360 px, and never more than the pane", () => {
    expect(soloNodeWidth(590)).toBe(360);
    expect(soloNodeWidth(1268)).toBe(360);
    expect(soloNodeWidth(300)).toBe(284);
  });
  it("gives every node of a drawing its width: the lone node of a rank wider than the nodes of a full rank", () => {
    const concepts = ["c-1", "c-2"].map((id) => node(id, "concept", id));
    const two = buildMapModel(graph([node("t-1", "topic", "Topic"), ...concepts], concepts.map((concept) => edge("structure", "topic_includes_concept", "t-1", concept.id)), "t-1"));
    expect([...nodeWidths(two, 590)]).toEqual([["t-1", 360], ["c-1", 273], ["c-2", 273]]);
    const chain = buildMapModel(graph([node("t-1", "topic", "Topic"), node("c-1", "concept", "Concept"), node("s-1", "skill", "Skill")],
      [edge("structure", "topic_includes_concept", "t-1", "c-1"), edge("structure", "concept_assessed_as_skill", "c-1", "s-1")], "c-1"));
    expect(new Set(nodeWidths(chain, 805).values())).toEqual(new Set([360]));
    const cards = buildMapModel(graph([node("t-1", "topic", "One"), node("t-2", "topic", "Two")], [], null));
    expect([...nodeWidths(cards, 805).values()]).toEqual([256, 256]);
  });
  it("lays the topic cards out in three columns up to a 1680 px window, four at 1920 and five at 2560", () => {
    expect(topicGrid(590)).toEqual({ columns: 3, width: 184 });
    expect(topicGrid(690)).toEqual({ columns: 3, width: 218 });
    expect(topicGrid(805)).toEqual({ columns: 4, width: 188 });
    expect(topicGrid(1268)).toEqual({ columns: 5, width: 240 });
    expect(topicNodeWidth(602)).toBe(188);
    expect(topicNodeWidth(300)).toBe(160);
  });
  it("keeps no column for nothing: fewer cards than columns share the pane, a card 280 px at most, never fewer than three columns", () => {
    expect(topicGrid(805, 3)).toEqual({ columns: 3, width: 256 });
    expect(topicGrid(1268, 4)).toEqual({ columns: 4, width: 280 });
    expect(topicGrid(1268, 1)).toEqual({ columns: 3, width: 280 });
    expect(topicGrid(805, 20)).toEqual({ columns: 4, width: 188 });
  });
});

describe("topic level: nothing is selected", () => {
  const model = buildMapModel(sampleConceptGraphCourse);

  it("draws the scope's topics and nothing below them", () => {
    expect(model.view).toBe("topics");
    expect(model.nodes.map((entry) => entry.label)).toEqual(["Sample topic A", "Sample topic B"]);
    expect(model.nodes.every((entry) => entry.type === "topic-card")).toBe(true);
    expect(model.edges).toEqual([]);
    expect(model.legend).toEqual([]);
  });

  it("states each topic's counts and names the action that opens it", () => {
    const first = model.nodes[0]!;
    expect(plain(first.second)).toMatch(/^2 concepts/);
    expect(plain(first.action?.label)).toBe("Show 2 concepts");
    expect(plain(model.nodes[1]!.action?.label)).toBe("Show 1 concept");
  });

  it("counts a topic's concepts from the outline's own lines, and claims nothing when the graph was cut", () => {
    expect(topicConceptCounts(sampleConceptGraphCourse)?.get("t-sample-a")).toBe(2);
    expect(topicConceptCounts({ ...sampleConceptGraphCourse, truncated: true, dropped: 5 })).toBeNull();
    const cut = buildMapModel({ ...sampleConceptGraphCourse, truncated: true, dropped: 5 });
    expect(plain(cut.nodes[0]!.second)).not.toMatch(/concept/);
    expect(cut.nodes[0]!.action?.label).toBe("Show its concepts");
    expect(cut.shown).toBe(sampleConceptGraphCourse.nodes.length);
    expect(cut.total).toBe(sampleConceptGraphCourse.nodes.length + 5);
  });

  it("offers what the catalog files under no topic as a last card", () => {
    const loose = graph([node("t-1", "topic", "Topic one"), node("c-1", "concept", "Filed concept"), node("c-9", "concept", "Loose concept"), node("s-9", "skill", "Loose skill")],
      [edge("structure", "topic_includes_concept", "t-1", "c-1"), edge("structure", "concept_assessed_as_skill", "c-9", "s-9")], null);
    const closed = buildMapModel(loose);
    const card = closed.nodes[closed.nodes.length - 1]!;
    expect(card.type).toBe("unfiled");
    expect(card.label).toBe("No topic in the catalog");
    expect(plain(card.second)).toBe("1 concept");
    expect(closed.nodes.some((entry) => entry.id === "c-9")).toBe(false);
    const open = buildMapModel(loose, { showUnfiled: true });
    expect(open.nodes.map((entry) => entry.id)).toContain("c-9");
    expect(open.nodes.map((entry) => entry.id)).not.toContain("s-9"); // a skill of that concept is reached through it
  });
});

describe("a focused neighbourhood", () => {
  const model = buildMapModel(sampleConceptGraphLecture);

  it("ranks by what the data is: topic, concept, skill, then the questions that assess them, then related questions", () => {
    expect(model.view).toBe("focus");
    expect(model.ranks).toEqual(["topic", "concept", "skill", "question", "related"]);
    expect(ids(model, "concept")).toEqual(["c-sample-1"]);
    expect(ids(model, "related")).toEqual(["P90-Q01"]);
    expect(byId(model, "c-sample-1").selected).toBe(true);
  });

  it("keeps the criteria of a question folded on the question until it is opened", () => {
    expect(ids(model, "criterion")).toEqual([]);
    const question = model.nodes.find((entry) => entry.rank === "question")!;
    expect(plain(question.action?.label)).toBe("Show 1 criterion");
    expect(question.action?.kind).toBe("criteria");
    // the question still reaches what it assesses: one dashed line to the skill, none doubled to the skill's own concept
    const summary = model.edges.filter((entry) => entry.family === "assessment");
    expect(summary.map((entry) => `${entry.source}>${entry.target}`)).toEqual([`${question.id}>s-sample-1`]);
    expect(summary[0]!.arrow).toBe("target");
  });

  it("draws the criteria of the opened question between the question and what they assess", () => {
    const question = model.nodes.find((entry) => entry.rank === "question")!;
    const opened = buildMapModel(sampleConceptGraphLecture, { openedQuestion: question.id });
    expect(opened.ranks).toEqual(["topic", "concept", "skill", "criterion", "question", "related"]);
    const criterion = ids(opened, "criterion")[0]!;
    expect(opened.edges.filter((entry) => entry.family === "assessment").map((entry) => `${entry.source}>${entry.target}`).sort()).toEqual([`${criterion}>s-sample-1`, `${question.id}>${criterion}`].sort());
    expect(byId(opened, question.id).action).toBeUndefined();
  });

  it("opens the selected question, and the question of a selected criterion", () => {
    const question = sampleConceptGraphLecture.nodes.find((entry) => entry.kind === "question" && entry.in_scope)!;
    const criterion = sampleConceptGraphLecture.nodes.find((entry) => entry.kind === "criterion")!;
    expect(ids(buildMapModel({ ...sampleConceptGraphLecture, focus: question.id }), "criterion")).toEqual([criterion.id]);
    expect(ids(buildMapModel({ ...sampleConceptGraphLecture, focus: criterion.id }), "criterion")).toEqual([criterion.id]);
  });

  it("tells the course's own relation between two questions from containment: words on the line, an arrowhead only on a prerequisite", () => {
    const containment = model.edges.filter((entry) => entry.legend === "hierarchy");
    expect(containment.length).toBeGreaterThan(0);
    expect(containment.every((entry) => entry.arrow === null && entry.label === null)).toBe(true);
    const relation = model.edges.find((entry) => entry.legend === "prerequisite_or_overlap")!;
    expect(relation.label).toBe("partly overlaps with");
    expect(relation.arrow).toBeNull();
    const prerequisite = buildMapModel(graph([node("q-1", "question", "One"), node("q-2", "question", "Two")], [edge("structure", "diagnostic_prerequisite", "q-1", "q-2")], "q-1"));
    expect(prerequisite.edges[0]).toMatchObject({ label: "is a diagnostic step for", arrow: "target", source: "q-1", target: "q-2" });
  });

  it("names in the key only the kinds of line it draws", () => {
    expect(model.legend).toEqual(["assessment", "hierarchy", "prerequisite_or_overlap"]);
  });

  it("marks a node outside the scope and says so in words", () => {
    const outside = byId(model, "P90-Q01");
    expect(outside.inScope).toBe(false);
    expect(outside.second).toBe("Outside this lecture");
    expect(model.outOfScope).toBe(true);
  });

  it("does not draw the other concepts of the topic when one concept is selected", () => {
    const siblings = graph(
      [node("c-1", "concept", "Selected"), node("t-1", "topic", "Topic"), node("c-2", "concept", "Sibling"), node("s-1", "skill", "Skill of the selected"), node("s-2", "skill", "Skill of the sibling")],
      [edge("structure", "topic_includes_concept", "t-1", "c-1"), edge("structure", "topic_includes_concept", "t-1", "c-2"), edge("structure", "concept_assessed_as_skill", "c-1", "s-1"),
        edge("structure", "concept_assessed_as_skill", "c-2", "s-2")], "c-1");
    expect(buildMapModel(siblings).nodes.map((entry) => entry.id).sort()).toEqual(["c-1", "s-1", "t-1"]);
    // a selected topic does draw its concepts, and their skills when two levels are asked for (a window from 1920 px)
    expect(buildMapModel({ ...siblings, focus: "t-1" }).nodes.map((entry) => entry.id).sort()).toEqual(["c-1", "c-2", "t-1"]);
    expect(buildMapModel({ ...siblings, focus: "t-1" }, { depth: 2 }).nodes.map((entry) => entry.id).sort()).toEqual(["c-1", "c-2", "s-1", "s-2", "t-1"]);
  });

  it("draws no question or criterion around a selected topic, and claims no cut when the Brain's limit only cut those", () => {
    // A topic asked two relations deep comes with the questions and criteria of its concepts; the Brain lists concepts and skills first.
    const deep = graph(
      [node("t-1", "topic", "Topic"), node("c-1", "concept", "Concept"), node("s-1", "skill", "Skill"), node("q-1", "question", "Question"), node("k-1", "criterion", "Criterion")],
      [edge("structure", "topic_includes_concept", "t-1", "c-1"), edge("structure", "concept_assessed_as_skill", "c-1", "s-1"), edge("assessment", "question_has_criterion", "q-1", "k-1"),
        edge("assessment", "criterion_assesses_skill", "k-1", "s-1")], "t-1", { truncated: true, dropped: 40 });
    const model = buildMapModel(deep, { depth: 2 });
    expect(model.ranks).toEqual(["topic", "concept", "skill"]);
    expect(model.edges.every((entry) => entry.legend === "hierarchy")).toBe(true);
    expect(model.total).toBe(model.shown); // what was cut lies beyond what is drawn
    // Without any question in the answer the cut may have taken a skill: it is said.
    const cut = buildMapModel({ ...deep, nodes: deep.nodes.filter((entry) => entry.kind !== "question" && entry.kind !== "criterion"), edges: deep.edges.filter((entry) => entry.family === "structure") }, { depth: 2 });
    expect(cut.total).toBe(cut.shown + 40);
    // Around a concept everything stays, as before.
    expect(buildMapModel({ ...deep, focus: "c-1" }).ranks).toEqual(["topic", "concept", "skill", "question"]);
  });

  it("shows evidence for a skill, a question and a criterion, and counts for a topic or a concept", () => {
    expect(byId(model, "s-sample-1").evidence?.state).toBe("independent");
    expect(byId(model, "c-sample-1").evidence).toBeNull();
    expect(plain(byId(model, "c-sample-1").second)).toMatch(/skill/);
  });
});

describe("folding (7.3: three nodes to a rank)", () => {
  const skills = Array.from({ length: 6 }, (_, index) => node(`s-${index + 1}`, "skill", `Skill ${index + 1}`));
  const wide = graph([node("c-1", "concept", "Concept"), ...skills], skills.map((skill) => edge("structure", "concept_assessed_as_skill", "c-1", skill.id)), "c-1");

  it("shows the first of a long rank and folds the rest into one action", () => {
    const model = buildMapModel(wide);
    const rank = model.nodes.filter((entry) => entry.rank === "skill");
    expect(rank).toHaveLength(RANK_FOLD);
    const fold = rank[rank.length - 1]!;
    expect(fold.type).toBe("fold");
    expect(plain(fold.label)).toBe("4 more skills");
    // the folded skills keep ONE line to the concept
    expect(model.edges.filter((entry) => entry.target === fold.id)).toHaveLength(1);
  });

  it("opens the group in place", () => {
    const model = buildMapModel(wide);
    const fold = model.nodes.find((entry) => entry.type === "fold")!;
    const opened = buildMapModel(wide, { opened: new Set([fold.id]) });
    expect(opened.nodes.filter((entry) => entry.rank === "skill").map((entry) => entry.type)).toEqual(Array(6).fill("node"));
    expect(opened.edges).toHaveLength(6);
  });

  it("keeps a selected node out of the fold", () => {
    const model = buildMapModel({ ...wide, focus: "s-6" });
    expect(model.nodes.find((entry) => entry.id === "s-6")?.selected).toBe(true);
  });
});

describe("the slide scope", () => {
  const model = buildMapModel(sampleConceptGraphSlide);

  it("draws this slide as the origin of the source lines, in the concept rank, from the scope", () => {
    const marker = model.nodes.find((entry) => entry.type === "marker")!;
    expect(marker.rank).toBe("concept");
    expect(marker.label).toBe("This slide");
    expect(plain(marker.second)).toBe("PDF page 4 of 12 · build 2 of 3");
    const source = model.edges.filter((entry) => entry.family === "source");
    expect(source.length).toBeGreaterThan(0);
    expect(source.every((entry) => entry.source === marker.id && entry.arrow === "target")).toBe(true);
    expect(model.legend).toContain("source");
  });

  it("says on the node, not on the line, that its support is only a suggested link", () => {
    const suggested = model.edges.filter((entry) => entry.family === "source" && entry.tie === "agent_inferred");
    expect(suggested.length).toBeGreaterThan(0);
    expect(model.edges.filter((entry) => entry.family === "source").every((entry) => entry.label === null)).toBe(true);
    for (const line of suggested) expect(byId(model, line.target).tie).toBe("agent_inferred");
    expect(byId(model, "c-sample-1").tie).toBe("agent_inferred");
    expect(byId(model, "t-sample-a").tie).toBeNull(); // no source line reaches the topic: nothing is said of it
  });

  it("draws one source line to a node however many ties name it, and the strongest tie speaks", () => {
    const both: ConceptGraphView = { ...sampleConceptGraphSlide, edges: [
      ...sampleConceptGraphSlide.edges,
      edge("source", "slide_supports_by_assessment", sampleConceptGraphSlide.scope.logical_slide_id!, "c-sample-1", { tie: "exact", support_pages: [3, 4, 5], provenance: "course anchor (reviewed page)" }),
    ] };
    const merged = buildMapModel(both);
    const lines = merged.edges.filter((entry) => entry.family === "source" && entry.target === "c-sample-1");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.tie).toBe("exact");
    expect(lines[0]!.provenance).toContain("course anchor (reviewed page)");
    expect(lines[0]!.provenance).toContain("suggested link");
    expect(byId(merged, "c-sample-1").tie).toBe("exact");
    // The same answer whatever order the ties arrive in.
    const reversed = buildMapModel({ ...both, edges: [...both.edges].reverse() });
    expect(reversed.edges.filter((entry) => entry.family === "source" && entry.target === "c-sample-1").map((entry) => entry.tie)).toEqual(["exact"]);
  });

  it("reads the strongest tie of every supported node from the graph's source lines", () => {
    const ties = sourceTies({ ...sampleConceptGraphSlide, edges: [
      ...sampleConceptGraphSlide.edges,
      edge("source", "slide_supports", sampleConceptGraphSlide.scope.logical_slide_id!, "s-sample-1", { tie: "stated", support_pages: [4] }),
    ] });
    expect(ties.get("c-sample-1")).toBe("agent_inferred");
    expect(ties.get("s-sample-1")).toBe("stated");
    expect(ties.has("t-sample-a")).toBe(false);
    expect(sourceTies(sampleConceptGraphCourse).size).toBe(0);
    expect(sourceTies(null).size).toBe(0);
  });

  it("keeps where each entry's support is", () => {
    expect(byId(model, "c-sample-1").where).toBe("on_this_page");
    expect(byId(model, "c-sample-1").supportPages).toEqual([4, 5]);
  });

  it("draws the slide's own overview when nothing is selected: every concept and skill of the slide, with the slide", () => {
    const overview = buildMapModel({ ...sampleConceptGraphSlide, focus: null, nodes: sampleConceptGraphSlide.nodes.filter((entry) => entry.kind !== "question" && entry.kind !== "criterion"),
      edges: sampleConceptGraphSlide.edges.filter((entry) => !/Q0|P90/.test(`${entry.from}${entry.to}`)) });
    expect(overview.view).toBe("overview");
    expect(overview.ranks).toEqual(["topic", "concept", "skill"]);
    expect(overview.nodes.some((entry) => entry.type === "marker")).toBe(true);
    expect(overview.nodes.some((entry) => entry.selected)).toBe(false);
  });
});

describe("the one layout (dagre, top to bottom)", () => {
  const sizes = () => 64;
  const model = buildMapModel(sampleConceptGraphLecture, { openedQuestion: sampleConceptGraphLecture.nodes.find((entry) => entry.kind === "question" && entry.in_scope)!.id });
  const layout = layoutMap(model, sizes, { nodeWidth: 172 });
  const top = (rank: string): number[] => model.nodes.filter((entry) => entry.rank === rank).map((entry) => layout.boxes.get(entry.id)!.y);

  it("puts every rank on its own line, in the order of the ranks", () => {
    const lines = MAP_RANKS.filter((rank) => model.ranks.includes(rank)).map((rank) => top(rank));
    for (const line of lines) expect(new Set(line).size).toBe(1);
    const order = lines.map((line) => line[0]!);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(new Set(order).size).toBe(order.length);
  });

  it("never lays one node over another, and leaves 48 px between two ranks", () => {
    const boxes = model.nodes.map((entry) => layout.boxes.get(entry.id)!);
    for (const [index, a] of boxes.entries()) for (const b of boxes.slice(index + 1)) {
      const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
      expect(apart).toBe(true);
    }
    expect(top("concept")[0]! - (top("topic")[0]! + 64)).toBe(48);
  });

  it("names each rank at the left edge of the drawing, above its line", () => {
    expect(layout.rankLabels.map((entry) => entry.rank)).toEqual(model.ranks);
    for (const label of layout.rankLabels) {
      expect(label.x).toBe(0);
      expect(label.y).toBe(top(label.rank)[0]! - 24);
    }
  });

  it("gives every line its own path, and an arrowhead where the model asks for one", () => {
    for (const entry of model.edges) {
      const geometry = layout.edges.get(entry.id)!;
      expect(geometry.path).toMatch(/^M/);
      expect(geometry.arrow === null).toBe(entry.arrow === null);
      expect(geometry.label === null).toBe(entry.label === null);
    }
  });

  it("does not depend on the order the nodes and edges arrived in", () => {
    const shuffled: ConceptGraphView = { ...sampleConceptGraphLecture, nodes: [...sampleConceptGraphLecture.nodes].reverse(), edges: [...sampleConceptGraphLecture.edges].reverse() };
    const again = layoutMap(buildMapModel(shuffled, { openedQuestion: model.nodes.find((entry) => entry.rank === "question")!.id }), sizes, { nodeWidth: 172 });
    for (const entry of model.nodes) expect(again.boxes.get(entry.id)).toEqual(layout.boxes.get(entry.id));
  });

  it("keeps the slide left of the concepts it supports", () => {
    const slide = buildMapModel(sampleConceptGraphSlide);
    const placed = layoutMap(slide, sizes, { nodeWidth: 172 });
    const marker = slide.nodes.find((entry) => entry.type === "marker")!;
    const concept = slide.nodes.find((entry) => entry.rank === "concept" && entry.type === "node")!;
    expect(placed.boxes.get(marker.id)!.y).toBe(placed.boxes.get(concept.id)!.y);
    expect(placed.boxes.get(marker.id)!.x).toBeLessThan(placed.boxes.get(concept.id)!.x);
  });

  it("keeps a topic straight above its one concept: the slide beside the concept does not pull it aside", () => {
    const slide = buildMapModel(sampleConceptGraphSlide);
    const placed = layoutMap(slide, sizes, { nodeWidth: 172 });
    const centre = (id: string): number => placed.boxes.get(id)!.x + placed.boxes.get(id)!.width / 2;
    expect(ids(slide, "topic")).toEqual(["t-sample-a"]);
    expect(centre("t-sample-a")).toBe(centre("c-sample-1"));
    // and every node still sits on the line of its kind
    for (const rank of slide.ranks) expect(new Set(ids(slide, rank).map((id) => placed.boxes.get(id)!.y)).size).toBe(1);
  });

  describe("lines keep clear of the nodes they do not join", () => {
    // A slide with two concepts and their skills; the second concept is tall (a long name), the slide is short.
    const slideId = sampleConceptGraphSlide.scope.logical_slide_id!;
    const overview = buildMapModel(graph(
      [node("t-1", "topic", "Topic"), node("c-near", "concept", "A near concept", { where: "on_this_page", support_pages: [4] }), node("c-far", "concept", "Z far concept", { where: "on_this_page", support_pages: [4] }),
        node("s-near", "skill", "Skill of the near concept", { where: "on_this_page", support_pages: [4] })],
      [edge("structure", "topic_includes_concept", "t-1", "c-near"), edge("structure", "topic_includes_concept", "t-1", "c-far"), edge("structure", "concept_assessed_as_skill", "c-near", "s-near"),
        edge("source", "slide_supports", slideId, "c-near", { tie: "exact" }), edge("source", "slide_supports", slideId, "c-far", { tie: "exact" }), edge("source", "slide_supports", slideId, "s-near", { tie: "exact" })],
      null, { scope: { ...sampleConceptGraphSlide.scope } }));
    const heightOf = (id: string): number => (id === "c-near" ? 150 : 60);
    const placed = layoutMap(overview, heightOf, { nodeWidth: 172 });
    const box = (id: string) => placed.boxes.get(id)!;
    const line = (target: string) => overview.edges.find((entry) => entry.family === "source" && entry.target === target)!;

    it("has the three nodes of the concept line in the order slide, near, far", () => {
      expect(box(slideId).x).toBeLessThan(box("c-near").x);
      expect(box("c-near").x).toBeLessThan(box("c-far").x);
    });

    it("keeps a skill straight under its concept although the slide supports both: the slide's line is drawn, it does not pull", () => {
      expect(box("s-near").x + box("s-near").width / 2).toBe(box("c-near").x + box("c-near").width / 2);
      expect(placed.edges.get(line("s-near").id)!.arrow).toMatchObject({ y: box("s-near").y - 2, angle: 90 });
    });

    it("drops a line from a short node straight to the foot of its line before it turns, so it does not cross a taller neighbour", () => {
      const geometry = placed.edges.get(line("s-near").id)!;
      const foot = box("c-near").y + box("c-near").height + 2;
      const start = /^M([\d.]+) ([\d.]+)V([\d.]+)C/.exec(geometry.path);
      expect(start).not.toBeNull();
      expect(Number(start![2])).toBe(box(slideId).y + box(slideId).height + 2);
      expect(Number(start![3])).toBe(foot);
      // a line that leaves the tallest node of its line needs no such drop
      const containment = overview.edges.find((entry) => entry.source === "c-near" && entry.target === "s-near")!;
      expect(placed.edges.get(containment.id)!.path).toMatch(/^M[\d.]+ [\d.]+C/);
    });

    it("joins the slide and its neighbour by a straight line, and arcs over the line of nodes to one that is further away", () => {
      expect(placed.edges.get(line("c-near").id)!.path).toMatch(/^M[\d.]+ [\d.]+H[\d.]+$/);
      const far = placed.edges.get(line("c-far").id)!;
      const top = box("c-far").y;
      // the arrowhead points down into the top of the supported node, off its middle (where the topic's line arrives)
      expect(far.arrow).toMatchObject({ y: top - 2, angle: 90 });
      expect(far.arrow!.x).not.toBe(box("c-far").x + box("c-far").width / 2);
      expect(far.arrow!.x).toBeGreaterThan(box("c-far").x);
      // every point the curve is drawn from lies above the tops of the nodes: it never runs through the node in between
      const ys = [...far.path.matchAll(/[\d.]+ ([\d.]+)/g)].map((match) => Number(match[1]));
      expect(ys.length).toBeGreaterThan(2);
      expect(Math.max(...ys)).toBeLessThanOrEqual(top - 2);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    });

    it("lets a worded link between two nodes of one line dip under the tallest node between them", () => {
      const questions = [node("q-1", "question", "Question 1"), node("q-2", "question", "Question 2"), node("q-3", "question", "Question 3")];
      const model3 = buildMapModel(graph(
        [node("s-1", "skill", "Skill"), ...questions, ...questions.map((question) => node(`${question.id}.C1`, "criterion", "Criterion"))],
        [...questions.flatMap((question) => [edge("assessment", "question_has_criterion", question.id, `${question.id}.C1`), edge("assessment", "criterion_assesses_skill", `${question.id}.C1`, "s-1")]),
          edge("structure", "diagnostic_prerequisite", "q-1", "q-3")],
        "s-1"));
      const tall = layoutMap(model3, (id) => (id === "q-2" ? 200 : 60), { nodeWidth: 172 });
      const order = ["q-1", "q-2", "q-3"].sort((a, b) => tall.boxes.get(a)!.x - tall.boxes.get(b)!.x);
      const relation = model3.edges.find((entry) => entry.legend === "prerequisite_or_overlap")!;
      const geometry = tall.edges.get(relation.id)!;
      const lowest = Math.max(...["q-1", "q-2", "q-3"].map((id) => tall.boxes.get(id)!.y + tall.boxes.get(id)!.height));
      if (order[1] === "q-2") { // the tall question lies between the two that are joined
        const control = /C[\d.]+ ([\d.]+) /.exec(geometry.path)!;
        expect(Number(control[1])).toBeGreaterThan(lowest);
        expect(geometry.label!.y).toBeGreaterThan(lowest);
      } else expect(geometry.label).not.toBeNull();
      expect(tall.height).toBeGreaterThanOrEqual(geometry.label!.y);
    });
  });

  it("lays the topic level out as a grid of three columns in reading order", () => {
    const topics = Array.from({ length: 7 }, (_, index) => node(`t-${index + 1}`, "topic", `Topic ${index + 1}`));
    const grid = buildMapModel(graph(topics, [], null));
    const placed = layoutMap(grid, (id) => (id === "t-2" ? 110 : 84), { nodeWidth: 200 });
    const at = (id: string) => placed.boxes.get(id)!;
    expect([at("t-1").x, at("t-2").x, at("t-3").x]).toEqual([0, 216, 432]);
    expect(at("t-4").x).toBe(0);
    expect(at("t-7").x).toBe(0);
    expect(at("t-1").y).toBe(at("t-3").y);
    expect(at("t-4").y).toBe(at("t-1").y + 110 + 16); // a row is as tall as its tallest card
    expect(at("t-7").y).toBe(at("t-4").y + 84 + 16);
    expect(placed.rankLabels).toEqual([]);
    expect(placed.width).toBe(632);
  });

  it("puts the folded rest at the end of its line, and the first line of several nodes in the outline's order", () => {
    // Names that sort against the order they arrive in, as a catalog's do.
    const names = ["Delta", "Alpha", "Echo", "Charlie", "Bravo"];
    const concepts = names.map((name, index) => node(`c-${index + 1}`, "concept", name));
    const fan = buildMapModel(graph([node("t-1", "topic", "Topic"), ...concepts], concepts.map((concept) => edge("structure", "topic_includes_concept", "t-1", concept.id)), "t-1"));
    const placed = layoutMap(fan, sizes, { nodeWidth: 172 });
    const row = fan.nodes.filter((entry) => entry.rank === "concept").sort((a, b) => placed.boxes.get(a.id)!.x - placed.boxes.get(b.id)!.x);
    expect(row.map((entry) => entry.label)).toEqual(["Alpha", "Bravo", "3 more concepts"].map((label) => expect.stringMatching(new RegExp(`^${label.replace(/ /g, "\\s")}$`))));
    expect(row[row.length - 1]!.type).toBe("fold");
  });

  it("lays the topic cards out in as many columns as the pane holds", () => {
    const topics = Array.from({ length: 9 }, (_, index) => node(`t-${index + 1}`, "topic", `Topic ${index + 1}`));
    const grid = buildMapModel(graph(topics, [], null));
    const placed = layoutMap(grid, () => 84, { nodeWidth: 188, columns: 4 });
    const at = (id: string) => placed.boxes.get(id)!;
    expect([at("t-1").x, at("t-2").x, at("t-3").x, at("t-4").x]).toEqual([0, 204, 408, 612]);
    expect(at("t-5")).toMatchObject({ x: 0, y: at("t-1").y + 84 + 16 });
    expect(at("t-9").x).toBe(0);
    expect(placed.width).toBe(4 * 188 + 3 * 16);
  });

  it("centres a wider node that stands alone in its rank over the nodes below it", () => {
    const concepts = ["c-1", "c-2", "c-3"].map((id) => node(id, "concept", id));
    const fan = buildMapModel(graph([node("t-1", "topic", "Topic"), ...concepts], concepts.map((concept) => edge("structure", "topic_includes_concept", "t-1", concept.id)), "t-1"));
    const widths = nodeWidths(fan, 805);
    const placed = layoutMap(fan, sizes, { nodeWidth: 240, widthOf: (id) => widths.get(id)! });
    const topic = placed.boxes.get("t-1")!;
    expect(topic.width).toBe(360);
    expect(concepts.map((concept) => placed.boxes.get(concept.id)!.width)).toEqual([240, 240, 240]);
    expect(topic.x + topic.width / 2).toBe(placed.boxes.get("c-2")!.x + 120);
    expect(placed.width).toBe(3 * 240 + 2 * 40);
  });

  it("moves a wider lone node back inside the full lines when it would reach past them, so the drawing still fits its pane", () => {
    // A slide scope: the slide and one concept share the concept line; the topic stands alone above the concept, which is the right-hand one.
    const slideId = sampleConceptGraphSlide.scope.logical_slide_id!;
    const model = buildMapModel(graph(
      [node("t-1", "topic", "Topic"), node("c-1", "concept", "Concept", { where: "on_this_page", support_pages: [4] }), node("s-1", "skill", "Skill", { where: "on_this_page", support_pages: [4] })],
      [edge("structure", "topic_includes_concept", "t-1", "c-1"), edge("structure", "concept_assessed_as_skill", "c-1", "s-1"), edge("source", "slide_supports", slideId, "c-1", { tie: "exact", support_pages: [4] })],
      "c-1", { scope: { ...sampleConceptGraphSlide.scope } }));
    const widths = nodeWidths(model, 590);
    expect(widths.get("t-1")).toBe(360);
    expect(widths.get("c-1")).toBe(273);
    const placed = layoutMap(model, sizes, { nodeWidth: 273, widthOf: (id) => widths.get(id)! });
    const box = (id: string) => placed.boxes.get(id)!;
    expect(box(slideId).x).toBe(0);
    expect(box("c-1").x).toBe(313);
    // centred over the concept the topic would end at 629.5; it ends where the concept line ends
    expect(box("t-1").x + box("t-1").width).toBe(586);
    expect(box("s-1").x + box("s-1").width).toBe(586);
    expect(placed.width).toBe(586);
    // its line still reaches the concept
    expect(placed.edges.get(model.edges.find((entry) => entry.source === "t-1")!.id)!.path).toMatch(/^M/);
  });

  describe("a drawing that comes out a little wider than the width its nodes were sized to fill", () => {
    // A slide's concept with its skill and two questions; the slide supports the concept and both questions, so two of its
    // lines are led past the skill's rank and take room between the nodes there.
    const slideId = sampleConceptGraphSlide.scope.logical_slide_id!;
    const questions = ["q-1", "q-2"];
    const model = buildMapModel(graph(
      [node("t-1", "topic", "Topic"), node("c-1", "concept", "Concept"), node("s-1", "skill", "Skill"), ...questions.flatMap((id) => [node(id, "question", `Question ${id}`), node(`${id}.C1`, "criterion", "Criterion")])],
      [edge("structure", "topic_includes_concept", "t-1", "c-1"), edge("structure", "concept_assessed_as_skill", "c-1", "s-1"),
        ...questions.flatMap((id) => [edge("assessment", "question_has_criterion", id, `${id}.C1`), edge("assessment", "criterion_assesses_skill", `${id}.C1`, "s-1"), edge("source", "slide_supports", slideId, id, { tie: "exact", support_pages: [4] })]),
        edge("source", "slide_supports", slideId, "c-1", { tie: "exact", support_pages: [4] })],
      "c-1", { scope: { ...sampleConceptGraphSlide.scope } }));
    const widths = nodeWidths(model, 590);
    const options = { nodeWidth: 273, widthOf: (id: string) => widths.get(id)! };
    const loose = layoutMap(model, sizes, options);
    const fitted = layoutMap(model, sizes, { ...options, fitWidth: 586 });

    it("is brought back to that width by its gaps, never by its nodes", () => {
      expect(loose.width).toBeGreaterThan(586); // the premise: as laid out, it would be cut at one side of a 590 px pane
      expect(loose.width).toBeLessThan(586 * 1.05);
      expect(fitted.width).toBeLessThanOrEqual(586);
      for (const entry of model.nodes) expect(fitted.boxes.get(entry.id)!.width).toBe(widths.get(entry.id));
      // the nodes of a line still stand apart
      for (const rank of model.ranks) {
        const row = model.nodes.filter((entry) => entry.rank === rank).map((entry) => fitted.boxes.get(entry.id)!).sort((a, b) => a.x - b.x);
        for (let index = 1; index < row.length; index += 1) expect(row[index]!.x - (row[index - 1]!.x + row[index - 1]!.width)).toBeGreaterThanOrEqual(20);
      }
      for (const entry of model.edges) expect(fitted.edges.get(entry.id)!.path).toMatch(/^M/);
    });

    it("is left as it is when it is wider by more than that: it is panned, and nothing is crowded", () => {
      expect(layoutMap(model, sizes, { ...options, fitWidth: 400 }).width).toBe(loose.width);
    });
  });

  it("keeps an opened rank on its own line: the drawing grows sideways and is panned", () => {
    const skills = Array.from({ length: 7 }, (_, index) => node(`s-${index + 1}`, "skill", `Skill ${index + 1}`));
    const wide = graph([node("c-1", "concept", "Concept"), ...skills], skills.map((skill) => edge("structure", "concept_assessed_as_skill", "c-1", skill.id)), "c-1");
    const folded = buildMapModel(wide);
    expect(layoutMap(folded, sizes, { nodeWidth: 172 }).width).toBe(3 * 172 + 2 * 40);
    const opened = buildMapModel(wide, { opened: new Set([folded.nodes.find((entry) => entry.type === "fold")!.id]) });
    const placed = layoutMap(opened, sizes, { nodeWidth: 172 });
    expect(new Set(skills.map((skill) => placed.boxes.get(skill.id)!.y)).size).toBe(1);
    expect(placed.width).toBe(7 * 172 + 6 * 40);
  });
});

describe("the opening view: \"Concept map\" opens on something drawn", () => {
  // A lecture of one topic: four concepts, five skills (two of them of one concept). Without a focus, as the Brain answers a scope.
  const lectureScope = { kind: "lecture" as const, lecture_id: "lecture-90", page: null, logical_slide_id: null, label: null, pages: [], note: null };
  const names = ["Blank", "Calibration", "Reporter", "Site"];
  const concepts = names.map((name, index) => node(`c-${index + 1}`, "concept", name));
  const skills = [["s-1", "c-1", "Interpret a blank"], ["s-2", "c-2", "Convert a reading"], ["s-3", "c-2", "Explain the slope"], ["s-4", "c-3", "Explain a reporter"], ["s-5", "c-4", "Explain a site"]] as const;
  const lecture = graph(
    [node("t-1", "topic", "Assays"), ...concepts, ...skills.map(([id, , label]) => node(id, "skill", label))],
    [...concepts.map((concept) => edge("structure", "topic_includes_concept", "t-1", concept.id)), ...skills.map(([id, concept]) => edge("structure", "concept_assessed_as_skill", concept, id))],
    null, { scope: lectureScope });

  const more = (count: number, scope: ConceptGraphView["scope"] = lectureScope) => graph(Array.from({ length: count }, (_, index) => node(`t-${index + 1}`, "topic", `Topic ${String.fromCharCode(90 - index)}`)), [], null, { scope });

  it("draws a lecture or a slide of one to three topics whole, and no other scope", () => {
    expect(OVERVIEW_TOPICS).toBe(3);
    expect(drawnWhole(lecture)).toBe(true);
    expect(drawnWhole(more(3))).toBe(true);
    expect(drawnWhole(more(4))).toBe(false);
    expect(drawnWhole(graph([node("c-1", "concept", "No topic")], [], null, { scope: lectureScope }))).toBe(false);
    expect(drawnWhole({ ...lecture, scope: { ...lectureScope, kind: "course", lecture_id: null } })).toBe(false);
    expect(drawnWhole({ ...lecture, truncated: true, dropped: 3 })).toBe(false); // a cut graph is not the whole scope
    expect(drawnWhole({ ...lecture, focus: "t-1" })).toBe(false); // only a scope's own graph
    expect(drawnWhole({ ...sampleConceptGraphSlide, focus: null })).toBe(true);
    expect(drawnWhole(null)).toBe(false);
  });

  it("opens a lecture on its first topic, a slide of three topics or fewer too, and the course on nothing", () => {
    expect(openingNode(lecture)).toBe("t-1");
    expect(openingNode(more(3))).toBe("t-3"); // the first as the map orders them (by name), not as they arrived
    expect(openingNode(more(4))).toBe("t-4"); // a lecture of more topics: its first topic is drawn with its concepts
    expect(openingNode({ ...more(4), truncated: true, dropped: 3 })).toBe("t-4"); // topics are listed first: a cut graph still holds them
    expect(openingNode(graph([node("c-1", "concept", "No topic")], [], null, { scope: lectureScope }))).toBeNull();
    expect(openingNode({ ...lecture, scope: { ...lectureScope, kind: "course", lecture_id: null } })).toBeNull(); // the course opens on its topic cards
    expect(openingNode({ ...lecture, focus: "t-1" })).toBeNull(); // only a scope's own graph says how it opens
    expect(openingNode(sampleConceptGraphSlide)).toBeNull();
    expect(openingNode({ ...sampleConceptGraphSlide, focus: null })).toBe("t-sample-a");
    expect(openingNode(more(4, { ...sampleConceptGraphSlide.scope }))).toBeNull(); // a slide of more topics keeps its own overview, nothing selected
    expect(openingNode(null)).toBeNull();
  });

  it("names the first topic of a scope, for the course scope entered from a lecture", () => {
    expect(firstTopic(lecture)).toBe("t-1");
    expect(firstTopic(sampleConceptGraphCourse)).toBe("t-sample-a");
    expect(firstTopic(graph([node("c-1", "concept", "No topic")], [], null))).toBeNull();
    expect(firstTopic(undefined)).toBeNull();
  });

  it("keeps the topic cards for a scope that is not asked to open as an overview", () => {
    expect(buildMapModel(lecture).view).toBe("topics");
  });

  it("draws the scope's topics with their concepts, the selected topic marked, and no skill until two levels are asked for", () => {
    const model = buildMapModel(lecture, { overview: true, selected: "t-1" });
    expect(model.view).toBe("overview");
    expect(model.ranks).toEqual(["topic", "concept"]);
    expect(byId(model, "t-1").selected).toBe(true);
    expect(model.focus).toBeNull(); // nothing was asked of the Brain for it: it is the scope's own graph
    expect(ids(model, "concept")).toHaveLength(RANK_FOLD);
    expect(plain(model.nodes.find((entry) => entry.type === "fold")!.label)).toBe("2 more concepts");
    expect(model.edges.every((entry) => entry.legend === "hierarchy" && entry.arrow === null)).toBe(true);
    expect(model.legend).toEqual(["hierarchy"]);
    // nothing is marked when nothing is selected
    expect(buildMapModel(lecture, { overview: true }).nodes.some((entry) => entry.selected)).toBe(false);
  });

  it("draws the skills too at two levels, one skill under each drawn concept before a concept's second skill", () => {
    const model = buildMapModel(lecture, { overview: true, depth: 2, selected: "t-1" });
    expect(model.ranks).toEqual(["topic", "concept", "skill"]);
    expect(ids(model, "concept").slice(0, 2)).toEqual(["c-1", "c-2"]);
    // "Convert a reading" and "Explain the slope" are both skills of the second concept: the first concept's skill is drawn before the second of them
    expect(ids(model, "skill").slice(0, 2)).toEqual(["s-1", "s-2"]);
    expect(plain(model.nodes.filter((entry) => entry.type === "fold").map((entry) => entry.label).join("; "))).toBe("2 more concepts; 3 more skills");
    const placed = layoutMap(model, () => 64, { nodeWidth: 240 });
    const centre = (id: string): number => placed.boxes.get(id)!.x + placed.boxes.get(id)!.width / 2;
    expect(centre("s-1")).toBe(centre("c-1"));
    expect(centre("s-2")).toBe(centre("c-2"));
    expect(placed.width).toBe(3 * 240 + 2 * 40); // three regular columns: nothing is pushed out of the pane
  });

  it("still draws a slide's own overview with its skills, whatever depth is asked for, and marks its selected topic", () => {
    const slide: ConceptGraphView = { ...sampleConceptGraphSlide, focus: null, nodes: sampleConceptGraphSlide.nodes.filter((entry) => entry.kind !== "question" && entry.kind !== "criterion"),
      edges: sampleConceptGraphSlide.edges.filter((entry) => !/Q0|P90/.test(`${entry.from}${entry.to}`)) };
    const model = buildMapModel(slide, { overview: true, depth: 1, selected: "t-sample-a" });
    expect(model.ranks).toEqual(["topic", "concept", "skill"]);
    expect(byId(model, "t-sample-a").selected).toBe(true);
    expect(model.nodes.some((entry) => entry.type === "marker")).toBe(true);
  });
});
