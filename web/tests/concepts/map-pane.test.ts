// The concept map's pane and its smaller rules (design specification 7.2, 7.3): the path the tree opens to show a node
// selected on the map, a zoom that never goes under 100 %, panning only as far as the drawing reaches, the one-column
// drawing of a phone, and the room a worded link inside one rank is given.
import { describe, expect, it } from "vitest";
import {
  MAP_ZOOM, buildMapModel, centreOn, clampViewport, columnGroups, isInView, layoutMap, moreSides, revealPath, zoomAbout,
} from "@/features/concepts/map-model";
import { sampleConceptGraphCourse, sampleConceptGraphLecture, sampleConceptGraphSlide } from "@/lib/fixtures/r2-sample";
import type { ConceptGraphEdge, ConceptGraphNode, ConceptGraphView } from "@/lib/types";

const node = (id: string, kind: ConceptGraphNode["kind"], label: string): ConceptGraphNode =>
  ({ id, kind, label, counts: { skills: null, questions: null }, in_scope: true, where: null, support_pages: [], evidence: null });
const edge = (id: string, family: ConceptGraphEdge["family"], relation: string, from: string, to: string): ConceptGraphEdge =>
  ({ id, from, to, family, relation, provenance: "question index", automatic_credit: false, tie: null, support_pages: null });
const graph = (nodes: ConceptGraphNode[], edges: ConceptGraphEdge[], focus: string | null): ConceptGraphView => ({
  ...sampleConceptGraphCourse, nodes, edges, focus,
});

describe("the path the tree opens for a node selected on the map", () => {
  const criterion = sampleConceptGraphLecture.nodes.find((entry) => entry.kind === "criterion")!;
  const question = sampleConceptGraphLecture.nodes.find((entry) => entry.kind === "question" && entry.in_scope)!;

  it("runs from the topic down to the node, by the outline's own lines", () => {
    expect(revealPath(sampleConceptGraphLecture)).toEqual(["t-sample-a", "c-sample-1"]);
    expect(revealPath({ ...sampleConceptGraphLecture, focus: "s-sample-1" })).toEqual(["t-sample-a", "c-sample-1", "s-sample-1"]);
    expect(revealPath({ ...sampleConceptGraphLecture, focus: question.id })).toEqual(["t-sample-a", "c-sample-1", "s-sample-1", question.id]);
    expect(revealPath({ ...sampleConceptGraphLecture, focus: criterion.id })).toEqual(["t-sample-a", "c-sample-1", "s-sample-1", question.id, criterion.id]);
    expect(revealPath({ ...sampleConceptGraphLecture, focus: "t-sample-a" })).toEqual(["t-sample-a"]);
  });

  it("is the node alone when the catalog files it under nothing, and empty without a selection", () => {
    expect(revealPath(graph([node("c-9", "concept", "Loose")], [], "c-9"))).toEqual(["c-9"]);
    expect(revealPath(sampleConceptGraphCourse)).toEqual([]);
    expect(revealPath(null)).toEqual([]);
    expect(revealPath({ ...sampleConceptGraphLecture, focus: "not-in-the-graph" })).toEqual([]);
  });

  it("does not loop on a catalog that files two things under each other", () => {
    const loop = graph([node("c-1", "concept", "One"), node("s-1", "skill", "Skill")],
      [edge("e-1", "structure", "concept_assessed_as_skill", "c-1", "s-1"), edge("e-2", "structure", "topic_includes_concept", "s-1", "c-1")], "s-1");
    expect(revealPath(loop).length).toBeLessThanOrEqual(3);
  });
});

describe("the pane: never under 100 %, and never away from the drawing", () => {
  const pane = { width: 600, height: 500 };
  const small = { width: 400, height: 300 };
  const large = { width: 1400, height: 1200 };

  it("centres a drawing that fits and keeps it at the top", () => {
    expect(clampViewport({ x: -200, y: -200, zoom: 1 }, small, pane)).toEqual({ x: 100, y: 8, zoom: 1 });
    expect(clampViewport({ x: 500, y: 500, zoom: 1 }, small, pane)).toEqual({ x: 100, y: 8, zoom: 1 });
  });

  it("lets a larger drawing be moved until its edge is 8 px inside the pane, and no further", () => {
    expect(clampViewport({ x: 300, y: 300, zoom: 1 }, large, pane)).toEqual({ x: 8, y: 8, zoom: 1 });
    expect(clampViewport({ x: -5000, y: -5000, zoom: 1 }, large, pane)).toEqual({ x: 600 - 1400 - 8, y: 500 - 1200 - 8, zoom: 1 });
    expect(clampViewport({ x: -250.4, y: -100.6, zoom: 1 }, large, pane)).toEqual({ x: -250, y: -101, zoom: 1 });
  });

  it("never zooms under 100 % or over 150 %", () => {
    expect(clampViewport({ x: 0, y: 0, zoom: 0.4 }, small, pane).zoom).toBe(MAP_ZOOM.min);
    expect(clampViewport({ x: 0, y: 0, zoom: 3 }, small, pane).zoom).toBe(MAP_ZOOM.max);
    expect(zoomAbout({ x: 100, y: 8, zoom: 1 }, 0.5, small, pane).zoom).toBe(1);
    expect(zoomAbout({ x: 100, y: 8, zoom: 1 }, 1.25, small, pane).zoom).toBe(1.25);
    expect(zoomAbout({ x: 100, y: 8, zoom: 1.5 }, 9, small, pane).zoom).toBe(1.5);
  });

  it("centres the pane on a node as far as the drawing's edges allow", () => {
    const middle = centreOn({ x: 600, y: 500, width: 200, height: 80 }, large, pane);
    expect(middle).toEqual({ x: 300 - 700, y: 250 - 540, zoom: 1 });
    const corner = centreOn({ x: 0, y: 0, width: 200, height: 80 }, large, pane);
    expect(corner).toEqual({ x: 8, y: 8, zoom: 1 });
    expect(isInView({ x: 600, y: 500, width: 200, height: 80 }, middle, pane)).toBe(true);
    expect(isInView({ x: 1200, y: 1100, width: 200, height: 80 }, middle, pane)).toBe(false);
  });

  it("says on which sides the drawing runs past the pane", () => {
    expect(moreSides({ x: 100, y: 8, zoom: 1 }, small, pane)).toEqual({ left: false, right: false, top: false, bottom: false });
    expect(moreSides({ x: 8, y: 8, zoom: 1 }, large, pane)).toEqual({ left: false, right: true, top: false, bottom: true });
    expect(moreSides({ x: -400, y: -290, zoom: 1 }, large, pane)).toEqual({ left: true, right: true, top: true, bottom: true });
  });
});

describe("one centred column (a phone)", () => {
  it("names each group, puts the selection in a group of its own and the slide after the concepts it supports", () => {
    const groups = columnGroups(buildMapModel(sampleConceptGraphSlide));
    expect(groups.map((group) => group.label)).toEqual(["Topic", "Selected concept", "Supported on", "Skill", "Questions", "Related question, “partly overlaps with”"]);
    expect(groups[1]!.nodes.map((entry) => entry.id)).toEqual(["c-sample-1"]);
    expect(groups[2]!.nodes[0]!.type).toBe("marker");
  });

  it("gives each group the family of the lines that join it to what is above", () => {
    const groups = columnGroups(buildMapModel(sampleConceptGraphSlide));
    const family = Object.fromEntries(groups.map((group) => [group.label, group.family]));
    expect(family.Topic).toBeNull();
    expect(family["Selected concept"]).toBe("structure");
    expect(family["Supported on"]).toBe("source");
    expect(family.Questions).toBe("assessment");
  });

  it("is one unnamed group at topic level", () => {
    const groups = columnGroups(buildMapModel(sampleConceptGraphCourse));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe("");
    expect(groups[0]!.nodes).toHaveLength(2);
  });
});

describe("a worded link between two nodes of one rank", () => {
  const two = graph([node("c-1", "concept", "Concept"), node("s-1", "skill", "Skill"), node("q-1", "question", "First"), node("k-1", "criterion", "Criterion 1"), node("q-2", "question", "Second"),
    node("k-2", "criterion", "Criterion 2")], [
    edge("e-1", "structure", "concept_assessed_as_skill", "c-1", "s-1"),
    edge("e-2", "assessment", "question_has_criterion", "q-1", "k-1"), edge("e-3", "assessment", "criterion_assesses_skill", "k-1", "s-1"),
    edge("e-4", "assessment", "question_has_criterion", "q-2", "k-2"), edge("e-5", "assessment", "criterion_assesses_skill", "k-2", "s-1"),
    edge("e-6", "structure", "diagnostic_prerequisite", "q-1", "q-2"),
  ], "c-1");
  const model = buildMapModel(two);
  const layout = layoutMap(model, () => 64, { nodeWidth: 172 });
  const relation = model.edges.find((entry) => entry.legend === "prerequisite_or_overlap")!;

  it("keeps both questions in the Question rank, because both assess what is drawn", () => {
    expect(model.nodes.filter((entry) => entry.rank === "question").map((entry) => entry.id).sort()).toEqual(["q-1", "q-2"]);
    expect(model.ranks).not.toContain("related");
  });

  it("dips under the two nodes with its words below the line, and the drawing is given room for them", () => {
    const geometry = layout.edges.get(relation.id)!;
    const bottom = layout.boxes.get("q-1")!.y + 64;
    expect(geometry.path).toMatch(/^M[\d.]+ [\d.]+C/);
    expect(geometry.label!.y).toBeGreaterThan(bottom + 20);
    expect(layout.height).toBeGreaterThanOrEqual(geometry.label!.y + 10);
    expect(geometry.arrow).not.toBeNull(); // a prerequisite: an arrowhead at the question that needs the other
    const target = layout.boxes.get("q-2")!;
    expect(geometry.arrow!.x).toBe(target.x + target.width / 2);
    expect(geometry.arrow!.angle).toBe(-90);
  });
});
