// The concept map's pure model (design specification 7.1, 7.3): the address of a scope, what is drawn for a selection
// (topic level, a slide's overview, a focused neighbourhood), folding, the three edge families, and the one layout
// (dagre) with its ranks. Synthetic sample graphs only.
import { describe, expect, it } from "vitest";
import {
  MAP_RANKS, RANK_FOLD, buildMapModel, conceptMapHref, layoutMap, mapNodeWidth, parseScope, scopeParam, sourceTies, topicConceptCounts, topicNodeWidth, type MapModel, type MapNodeModel,
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

describe("node width from the pane (7.3)", () => {
  it("gives the widths the specification computes for the default panes", () => {
    expect(mapNodeWidth(672)).toBe(196);
    expect(mapNodeWidth(602)).toBe(172);
    expect(mapNodeWidth(702)).toBe(206);
    expect(mapNodeWidth(817)).toBe(220);
    expect(mapNodeWidth(1280)).toBe(220);
  });
  it("never goes under 160 px, so a narrow pane is panned instead", () => {
    expect(mapNodeWidth(400)).toBe(160);
    expect(mapNodeWidth(0)).toBe(160);
  });
  it("sizes a topic card for three columns with 16 px gaps, 280 px at most", () => {
    expect(topicNodeWidth(602)).toBe(188);
    expect(topicNodeWidth(1280)).toBe(280);
    expect(topicNodeWidth(300)).toBe(160);
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
    // a selected topic does draw its concepts
    expect(buildMapModel({ ...siblings, focus: "t-1" }).nodes.map((entry) => entry.id).sort()).toEqual(["c-1", "c-2", "s-1", "s-2", "t-1"]);
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
