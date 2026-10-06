// The concept map's model and its one layout (design specification 7.1, 7.3). Pure: no React, no fetch, no storage.
//
//   scope        the address of a scope (`course`, `lecture:<id>`, `slide:<lecture>:<page>`) and of the map itself
//   model        what is drawn for one concept graph of the read API: the topic level when nothing is selected, a
//                slide's own overview, or the neighbourhood of the selected node. Nothing is added to the graph: a node
//                is drawn once, an edge keeps its family, and what does not fit a rank is folded into one action.
//   layout       @dagrejs/dagre, top to bottom, is the ONE layout engine. Ranks follow the data: structure runs down
//                (Topic, Concept, Skill), assessment runs up into it (Criterion, Question), and a last rank holds
//                questions tied to a drawn question by a relation of the owner's catalog.
import dagre from "@dagrejs/dagre";
import { TIE_KIND, countLabel, edgeLegendKind, edgeLegendKinds, edgeRelationLabel, nodeCountsLabel, type EdgeLegendKind } from "@/lib/labels";
import { graphLayoutInput, type LayoutEdge, type LayoutNode } from "@/lib/r2";
import type { AnchorTieKind, ConceptGraphNode, ConceptGraphScopeParam, ConceptGraphView, EvidenceObject, GraphEdgeFamily, GraphNodeKind, GraphScopeKind, TieWhere } from "@/lib/types";

// ---- scope ---------------------------------------------------------------------------------------------------------------
export interface ParsedScope {
  kind: GraphScopeKind;
  lectureId: string | null;
  page: number | null;
}
/** `course`, `lecture:<id>` or `slide:<lecture>:<page>`; anything else is the course. */
export function parseScope(scope: string | null | undefined): ParsedScope {
  const [kind, lectureId, page] = (scope ?? "").split(":");
  if (kind === "lecture" && lectureId) return { kind: "lecture", lectureId, page: null };
  if (kind === "slide" && lectureId && Number.isInteger(Number(page)) && Number(page) >= 1) return { kind: "slide", lectureId, page: Number(page) };
  return { kind: "course", lectureId: null, page: null };
}
/** The `scope` parameter of the kind asked for, or the next wider one the known lecture and page allow. */
export function scopeParam(kind: GraphScopeKind, lectureId: string | null | undefined, page: number | null | undefined): ConceptGraphScopeParam {
  if (kind === "slide" && lectureId && page) return `slide:${lectureId}:${page}`;
  if (kind !== "course" && lectureId) return `lecture:${lectureId}`;
  return "course";
}
/** The address of the concept map of a scope, with the selected node when one is given. */
export function conceptMapHref(courseId: string, scope: string, node?: string | null): string {
  const query = new URLSearchParams();
  if (scope && scope !== "course") query.set("scope", scope);
  if (node) query.set("node", node);
  const text = query.toString();
  return `/courses/${courseId}/concepts${text ? `?${text}` : ""}`;
}

// ---- sizes ---------------------------------------------------------------------------------------------------------------
/** Each rank shows this many nodes; the rest fold into one. */
export const RANK_FOLD = 3;
/** Below this pane width the map is one centred column. */
export const ONE_COLUMN_BELOW = 560;
export const MAP_GAPS = { node: 40, rank: 48, card: 16, rankLabel: 24 } as const;
const clamp = (low: number, value: number, high: number): number => Math.min(Math.max(value, low), high);
/** Node width from the pane: three columns with 40 px between them fill it; never under 160 (the drawing is then panned), never over 220. */
export const mapNodeWidth = (paneWidth: number): number => clamp(160, Math.floor((paneWidth - 4 - 2 * MAP_GAPS.node) / RANK_FOLD), 220);
/** A topic card at topic level: three columns with 16 px gaps, 280 px at most. */
export const topicNodeWidth = (paneWidth: number): number => clamp(160, Math.floor((paneWidth - 4 - 2 * MAP_GAPS.card) / RANK_FOLD), 280);

// ---- model ---------------------------------------------------------------------------------------------------------------
export const MAP_RANKS = ["topic", "concept", "skill", "criterion", "question", "related"] as const;
export type MapRank = (typeof MAP_RANKS)[number];
export const RANK_LABEL: Record<MapRank, string> = { topic: "Topic", concept: "Concept", skill: "Skill", criterion: "Criterion", question: "Question", related: "Related question" };
/** The plural of a rank, for a folded group ("4 more skills") and for the groups of the one-column drawing. */
export const RANK_PLURAL: Record<MapRank, [string, string]> = {
  topic: ["topic", "topics"], concept: ["concept", "concepts"], skill: ["skill", "skills"], criterion: ["criterion", "criteria"], question: ["question", "questions"],
  related: ["related question", "related questions"],
};
/** The card that stands for what the catalog files under no topic, and the origin of the source lines of a slide scope. */
export const UNFILED_ID = "ll:no-topic";
export const UNFILED_LABEL = "No topic in the catalog";
export const SLIDE_MARKER_LABEL = "This slide";
const OUTSIDE_SCOPE: Record<GraphScopeKind, string> = { course: "Outside this scope", lecture: "Outside this lecture", slide: "Outside this slide" };
/** What a node without a question says, by scope: only the course scope speaks for the whole catalog. */
export const NO_QUESTION: Record<GraphScopeKind, string> = { course: "No question in the catalog", lecture: "No question in this lecture", slide: "No question tied to this slide" };

export type MapNodeType = "node" | "topic-card" | "fold" | "marker" | "unfiled";
export interface MapNodeModel {
  id: string;
  type: MapNodeType;
  rank: MapRank;
  /** The kind glyph; null for a fold. */
  kind: GraphNodeKind | "source_page" | null;
  label: string;
  /** Counts for a topic or concept, a gap statement, the scope's label for the slide; null when there is nothing to say. */
  second: string | null;
  /** Slide scope: where the node's support is. */
  where: TieWhere | null;
  supportPages: number[];
  /** Skill, question, criterion: the evidence as the Brain sent it. null for a topic or a concept. */
  evidence: EvidenceObject | null;
  inScope: boolean;
  selected: boolean;
  /** `criteria`: draws the criteria of this question. `open`: selects the node (a topic card draws its concepts). `unfiled`: draws what has no topic. */
  action?: { kind: "criteria" | "open" | "unfiled"; label: string };
  /** A fold: the rank it folds and how many nodes. */
  folded?: { rank: MapRank; count: number };
  data: ConceptGraphNode | null;
}
export interface MapEdgeModel {
  id: string;
  /** As recorded: `source` → `target`. A source line starts at the slide. */
  source: string;
  target: string;
  family: GraphEdgeFamily;
  /** The line of the key this edge belongs to; containment and the owner's relations are two different lines. */
  legend: EdgeLegendKind;
  relation: string;
  /** Words on the line: the owner's relation, or "Suggested link" for a source line that is one. null for containment, assessment and a course anchor. */
  label: string | null;
  /** Where the arrowhead sits. Containment never has one. */
  arrow: "target" | null;
  provenance: string;
  tie: AnchorTieKind | null;
}
export interface MapModel {
  /** `topics`: the opening view. `overview`: a slide's concepts and skills with the slide. `focus`: what surrounds the selected node. */
  view: "topics" | "overview" | "focus";
  nodes: MapNodeModel[];
  edges: MapEdgeModel[];
  /** The ranks in use, top to bottom. */
  ranks: MapRank[];
  legend: EdgeLegendKind[];
  /** A node outside the scope is drawn. */
  outOfScope: boolean;
  focus: string | null;
  /** Nodes the Brain sent, and how many the scope's request would hold without its limit. */
  shown: number;
  total: number;
  scopeKind: GraphScopeKind;
}
export interface MapOptions {
  /** Folds the learner opened (their ids). */
  opened?: ReadonlySet<string>;
  /** The question whose criteria are drawn. Default: a selected question, or the question of a selected criterion. */
  openedQuestion?: string | null;
  /** Topic level: also draw the concepts the catalog files under no topic. */
  showUnfiled?: boolean;
}

const foldId = (rank: MapRank): string => `ll:fold:${rank}`;
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const HIERARCHY = new Set(["topic_includes_concept", "topic_includes_skill", "concept_assessed_as_skill"]);

/** How many concepts each topic holds, read from the outline's own lines; null when the graph was cut by its limit (nothing is then claimed). */
export function topicConceptCounts(graph: ConceptGraphView | null | undefined): Map<string, number> | null {
  if (!graph || graph.truncated || graph.dropped > 0) return null;
  const counts = new Map<string, number>();
  for (const edge of graph.edges ?? []) if (edge.relation === "topic_includes_concept") counts.set(edge.from, (counts.get(edge.from) ?? 0) + 1);
  return counts;
}

function plainNode(node: LayoutNode, rank: MapRank, scopeKind: GraphScopeKind, focus: string | null): MapNodeModel {
  const data = node.data!;
  const grouping = data.kind === "topic" || data.kind === "concept";
  const counts = grouping ? nodeCountsLabel(data.counts) : "";
  const gap = data.kind === "skill" && data.counts?.questions === 0 ? NO_QUESTION[scopeKind] : null;
  return {
    id: node.id, type: "node", rank, kind: data.kind, label: node.label,
    second: !node.inScope ? OUTSIDE_SCOPE[scopeKind] : counts || gap,
    where: data.where ?? null, supportPages: [...(data.support_pages ?? [])], evidence: grouping ? null : data.evidence ?? null, inScope: node.inScope, selected: node.id === focus, data,
  };
}

function topicLevel(graph: ConceptGraphView, nodes: LayoutNode[], edges: LayoutEdge[], options: MapOptions): MapNodeModel[] {
  const concepts = topicConceptCounts(graph);
  const cards: MapNodeModel[] = nodes.filter((node) => node.kind === "topic").map((node) => {
    const held = concepts?.get(node.id);
    const counts = nodeCountsLabel(node.data?.counts);
    return {
      id: node.id, type: "topic-card", rank: "topic", kind: "topic", label: node.label,
      second: [held !== undefined ? countLabel(held, "concept") : concepts ? countLabel(0, "concept") : null, counts].filter((part): part is string => !!part).join(", ") || null,
      where: null, supportPages: [], evidence: null, inScope: node.inScope, selected: false,
      action: { kind: "open", label: concepts ? `Show ${countLabel(held ?? 0, "concept")}` : "Show its concepts" }, data: node.data,
    };
  });
  // What the catalog files under no topic: a concept no topic includes, and a skill that has neither a concept nor a topic.
  const filed = new Set(edges.filter((edge) => HIERARCHY.has(edge.relation)).map((edge) => edge.target));
  const loose = nodes.filter((node) => (node.kind === "concept" || node.kind === "skill") && !filed.has(node.id));
  if (loose.length > 0) {
    const looseConcepts = loose.filter((node) => node.kind === "concept").length;
    const looseSkills = loose.length - looseConcepts;
    cards.push({
      id: UNFILED_ID, type: "unfiled", rank: "topic", kind: "topic", label: UNFILED_LABEL,
      second: [looseConcepts ? countLabel(looseConcepts, "concept") : null, looseSkills ? countLabel(looseSkills, "skill") : null].filter((part): part is string => part !== null).join(", "),
      where: null, supportPages: [], evidence: null, inScope: true, selected: false, action: { kind: "unfiled", label: options.showUnfiled ? "Hide them" : "Show them" }, data: null,
    });
    if (options.showUnfiled) for (const node of loose) cards.push(plainNode(node, "topic", graph.scope.kind, null));
  }
  return cards;
}

/**
 * What the map draws for one concept graph. Without a focus: the scope's topics (course and lecture scopes), or the
 * slide's own concepts and skills with the slide (slide scope). With a focus: the selected node and what surrounds it.
 */
export function buildMapModel(graph: ConceptGraphView, options: MapOptions = {}): MapModel {
  const input = graphLayoutInput(graph);
  const scopeKind = graph.scope?.kind ?? "course";
  const focus = graph.focus && input.nodes.some((node) => node.id === graph.focus) ? graph.focus : null;
  const shown = graph.nodes?.length ?? 0;
  const base = { focus, shown, total: shown + (graph.dropped ?? 0), scopeKind };

  if (!focus && scopeKind !== "slide") {
    const nodes = topicLevel(graph, input.nodes, input.edges, options);
    return { ...base, view: "topics", nodes, edges: [], ranks: nodes.length ? ["topic"] : [], legend: [], outOfScope: false };
  }

  const real = new Map(input.nodes.filter((node) => node.data).map((node) => [node.id, node]));
  // 1. What surrounds the focus. A topic is where a walk ends: the other concepts of the selected node's topic are not its surroundings.
  let kept: Set<string>;
  if (focus) {
    const adjacent = new Map<string, string[]>();
    for (const edge of input.edges) {
      if (!real.has(edge.source) || !real.has(edge.target)) continue;
      adjacent.set(edge.source, [...(adjacent.get(edge.source) ?? []), edge.target]);
      adjacent.set(edge.target, [...(adjacent.get(edge.target) ?? []), edge.source]);
    }
    kept = new Set([focus]);
    const queue = [focus];
    while (queue.length) {
      const id = queue.shift()!;
      if (id !== focus && real.get(id)?.kind === "topic") continue;
      for (const next of adjacent.get(id) ?? []) if (!kept.has(next)) {
        kept.add(next);
        queue.push(next);
      }
    }
  } else kept = new Set(real.keys());

  // 2. The joins of the assessment family, read once.
  const questionOf = new Map<string, string>();
  const assessedBy = new Map<string, string[]>();
  const skillsOfConcept = new Map<string, Set<string>>();
  for (const edge of input.edges) {
    if (edge.relation === "question_has_criterion") questionOf.set(edge.target, edge.source);
    else if (edge.family === "assessment") assessedBy.set(edge.source, [...(assessedBy.get(edge.source) ?? []), edge.target]);
    else if (edge.relation === "concept_assessed_as_skill") skillsOfConcept.set(edge.source, new Set([...(skillsOfConcept.get(edge.source) ?? []), edge.target]));
  }
  const focusKind = focus ? real.get(focus)?.kind : null;
  const openedQuestion = options.openedQuestion !== undefined ? options.openedQuestion : focusKind === "question" ? focus : focusKind === "criterion" && focus ? questionOf.get(focus) ?? null : null;
  const assessing = new Set<string>();
  for (const [criterion, targets] of assessedBy) {
    const question = questionOf.get(criterion);
    if (question && kept.has(question) && targets.some((target) => kept.has(target))) assessing.add(question);
  }
  const tiedToQuestion = new Set<string>();
  for (const edge of input.edges) if (edge.family === "structure" && real.get(edge.source)?.kind === "question" && real.get(edge.target)?.kind === "question") {
    tiedToQuestion.add(edge.source);
    tiedToQuestion.add(edge.target);
  }

  // 3. Ranks. A question is "related" when a relation of the catalog ties it to a drawn question and it assesses nothing that is drawn.
  const rankOf = (node: LayoutNode): MapRank | null => {
    if (node.kind === "source_page") return "concept";
    if (node.kind === "criterion") return questionOf.get(node.id) === openedQuestion ? "criterion" : null;
    if (node.kind === "question") return node.id === focus || assessing.has(node.id) || !tiedToQuestion.has(node.id) ? "question" : "related";
    return node.kind;
  };
  const near = new Set<string>();
  if (focus) for (const edge of input.edges) {
    if (edge.source === focus) near.add(edge.target);
    if (edge.target === focus) near.add(edge.source);
  }
  const priority = (id: string): number => (id === focus ? 0 : near.has(id) ? 1 : 2);
  const members = new Map<MapRank, LayoutNode[]>();
  const hiddenCriteria = new Map<string, number>();
  for (const node of input.nodes) {
    if (!node.data || !kept.has(node.id)) continue;
    const rank = rankOf(node);
    if (rank === null) {
      const question = questionOf.get(node.id);
      if (question) hiddenCriteria.set(question, (hiddenCriteria.get(question) ?? 0) + 1);
      continue;
    }
    members.set(rank, [...(members.get(rank) ?? []), node]);
  }

  // 4. Fold what does not fit a rank.
  const placed = new Map<string, string>(); // node id → the id it is drawn as (itself, or the fold of its rank)
  const nodes: MapNodeModel[] = [];
  const marker = input.nodes.find((node) => node.kind === "source_page") ?? null;
  for (const rank of MAP_RANKS) {
    const list = [...(members.get(rank) ?? [])].sort((a, b) => priority(a.id) - priority(b.id) || byText(a.label.toLowerCase(), b.label.toLowerCase()) || byText(a.id, b.id));
    const row: MapNodeModel[] = [];
    if (rank === "concept" && marker) {
      row.push({ id: marker.id, type: "marker", rank, kind: "source_page", label: SLIDE_MARKER_LABEL, second: marker.label, where: null, supportPages: [...(input.sourcePage?.pages ?? [])], evidence: null,
        inScope: true, selected: false, data: null });
      placed.set(marker.id, marker.id);
    }
    const fold = list.length > RANK_FOLD && !options.opened?.has(foldId(rank));
    const visible = fold ? list.slice(0, RANK_FOLD - 1) : list;
    for (const node of visible) {
      const model = plainNode(node, rank, scopeKind, focus);
      const hidden = node.kind === "question" ? hiddenCriteria.get(node.id) ?? 0 : 0;
      if (hidden > 0) model.action = { kind: "criteria", label: `Show ${countLabel(hidden, "criterion", "criteria")}` };
      row.push(model);
      placed.set(node.id, node.id);
    }
    if (fold) {
      const rest = list.slice(RANK_FOLD - 1);
      row.push({ id: foldId(rank), type: "fold", rank, kind: null, label: `${countLabel(rest.length, "more", "more")} ${RANK_PLURAL[rank][rest.length === 1 ? 0 : 1]}`, second: null, where: null, supportPages: [],
        evidence: null, inScope: true, selected: false, folded: { rank, count: rest.length }, data: null });
      for (const node of rest) placed.set(node.id, foldId(rank));
    }
    nodes.push(...row);
  }

  // 5. Lines. A line to a folded node goes to the fold; the criteria of a question that is not opened are one line from the question.
  const edges = new Map<string, MapEdgeModel>();
  const add = (edge: LayoutEdge, source: string | undefined, target: string | undefined): void => {
    if (!source || !target || source === target) return;
    const legend = edgeLegendKind(edge);
    const folded = source !== edge.source || target !== edge.target;
    const key = folded ? `${legend}|${source}|${target}` : edge.id;
    if (edges.has(key)) return;
    const relation = legend === "prerequisite_or_overlap";
    edges.set(key, {
      id: folded ? `ll:${key}` : edge.id, source, target, family: edge.family, legend, relation: edge.relation,
      label: relation ? edgeRelationLabel(edge.relation) : edge.family === "source" && edge.tie === "agent_inferred" ? TIE_KIND.agent_inferred.label : null,
      arrow: edge.family === "assessment" || edge.family === "source" || (relation && /prerequisite/.test(edge.relation)) ? "target" : null,
      provenance: edge.data.provenance, tie: edge.tie,
    });
  };
  for (const edge of input.edges) {
    if (edge.family === "assessment") {
      if (edge.relation === "question_has_criterion") {
        add(edge, placed.get(edge.source), placed.get(edge.target)); // drawn only when the criterion is
        continue;
      }
      // A criterion that assesses a skill is not also tied to that skill's own concept: the skill's line already says it.
      const viaSkill = real.get(edge.target)?.kind === "concept" && (assessedBy.get(edge.source) ?? []).some((other) => placed.has(other) && skillsOfConcept.get(edge.target)?.has(other));
      if (viaSkill) continue;
      const question = questionOf.get(edge.source);
      add(edge, placed.get(edge.source) ?? (question ? placed.get(question) : undefined), placed.get(edge.target));
      continue;
    }
    if (edge.family === "source" && real.get(edge.target)?.kind === "criterion" && !placed.has(edge.target)) continue; // a folded criterion: its question carries the line
    add(edge, placed.get(edge.source), placed.get(edge.target));
  }

  const drawn = [...edges.values()];
  const ranks = MAP_RANKS.filter((rank) => nodes.some((node) => node.rank === rank));
  return { ...base, view: focus ? "focus" : "overview", nodes, edges: drawn, ranks, legend: edgeLegendKinds(drawn), outOfScope: nodes.some((node) => !node.inScope) };
}

/**
 * The catalog ids from a root of the outline down to the focused node, read from the focused graph's own lines: a
 * topic, then a concept, then a skill, then a question, then a criterion, as far as the node goes. The tree opens these
 * branches to show the row of a node that was selected on the map. [] when the graph has no focus.
 */
export function revealPath(graph: ConceptGraphView | null | undefined): string[] {
  const focus = graph?.focus;
  if (!graph || !focus) return [];
  const kind = new Map(graph.nodes.map((node) => [node.id, node.kind]));
  const label = new Map(graph.nodes.map((node) => [node.id, node.label.toLowerCase()]));
  if (!kind.has(focus)) return [];
  const first = (ids: string[]): string | null => [...ids].sort((a, b) => byText(label.get(a) ?? "", label.get(b) ?? "") || byText(a, b))[0] ?? null;
  const from = (relation: string, to: string): string[] => graph.edges.filter((edge) => edge.relation === relation && edge.to === to && kind.has(edge.from)).map((edge) => edge.from);
  const to = (relation: string, source: string): string[] => graph.edges.filter((edge) => edge.relation === relation && edge.from === source && kind.has(edge.to)).map((edge) => edge.to);
  const up = (id: string, seen: ReadonlySet<string>): string[] => {
    if (seen.has(id)) return [id];
    const visited = new Set([...seen, id]);
    const node = kind.get(id);
    let parent: string | null = null;
    if (node === "concept") parent = first(from("topic_includes_concept", id));
    else if (node === "skill") parent = first(from("concept_assessed_as_skill", id)) ?? first(from("topic_includes_skill", id));
    else if (node === "criterion") parent = first(from("question_has_criterion", id));
    else if (node === "question") {
      const criteria = to("question_has_criterion", id);
      parent = first(criteria.flatMap((criterion) => to("criterion_assesses_skill", criterion))) ?? first(criteria.flatMap((criterion) => to("criterion_assesses_concept", criterion)));
    }
    return parent ? [...up(parent, visited), id] : [id];
  };
  return up(focus, new Set());
}

// ---- layout --------------------------------------------------------------------------------------------------------------
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface EdgeGeometry {
  path: string;
  /** The tip of the arrowhead and the direction it points, in degrees (0 is to the right, 90 down). */
  arrow: { x: number; y: number; angle: number } | null;
  /** The centre of the plate that carries the line's words. */
  label: { x: number; y: number } | null;
}
export interface MapLayout {
  boxes: Map<string, Box>;
  rankLabels: Array<{ rank: MapRank; x: number; y: number }>;
  edges: Map<string, EdgeGeometry>;
  width: number;
  height: number;
}
const ROOT = "ll:layout-root";
const ARROW = 7;
/** Room under a line of nodes for a link between two of them that carries words. */
const DIP_ROOM = 52;
const round = (value: number): number => Math.round(value * 10) / 10;

/**
 * Positions from dagre (`rankdir: "TB"`). Each rank is one line (an opened fold makes its line longer and the pane is
 * panned); an edge between two lines is given its exact length, so every node sits on the line of its kind. Links
 * inside one line are drawn after the layout. At topic level the cards are a grid of three columns: chains of
 * layout-only links that are never drawn.
 * `heightOf` is the measured height of a node at `nodeWidth`.
 */
export function layoutMap(model: MapModel, heightOf: (id: string) => number, options: { nodeWidth: number }): MapLayout {
  const grid = model.view === "topics";
  const columns = RANK_FOLD;
  const nodeSep = grid ? MAP_GAPS.card : MAP_GAPS.node;
  const rankSep = grid ? MAP_GAPS.card : MAP_GAPS.rank;
  const empty: MapLayout = { boxes: new Map(), rankLabels: [], edges: new Map(), width: 0, height: 0 };
  if (model.nodes.length === 0) return empty;

  // Lines: the nodes of a rank on one line; at topic level three cards to a line.
  const line = new Map<string, number>();
  const lines: string[][] = [];
  const firstLineOf = new Map<MapRank, number>();
  for (const rank of MAP_RANKS) {
    const members = model.nodes.filter((node) => node.rank === rank);
    for (let start = 0; start < members.length; start += grid ? columns : Math.max(1, members.length)) {
      if (start === 0) firstLineOf.set(rank, lines.length);
      const chunk = members.slice(start, grid ? start + columns : undefined).map((node) => node.id);
      for (const id of chunk) line.set(id, lines.length);
      lines.push(chunk);
    }
  }

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "TB", nodesep: nodeSep, ranksep: rankSep, edgesep: 8, marginx: 0, marginy: 0, rankalign: "top" });
  g.setDefaultEdgeLabel(() => ({}));
  const hasParent = new Set<string>();
  const between: Array<{ edge: MapEdgeModel; upper: string; lower: string }> = [];
  const inside: MapEdgeModel[] = [];
  // A link inside one line that carries words dips under the nodes: that line is given room below it.
  const dips = new Set<number>();
  for (const edge of model.edges) {
    const a = line.get(edge.source);
    const b = line.get(edge.target);
    if (a !== undefined && a === b && edge.label) dips.add(a);
  }
  const heights = new Map(model.nodes.map((node) => [node.id, Math.max(1, Math.ceil(heightOf(node.id)))]));
  g.setNode(ROOT, { width: 0, height: 0 });
  for (const node of model.nodes) g.setNode(node.id, { width: options.nodeWidth, height: heights.get(node.id)! + (dips.has(line.get(node.id)!) ? DIP_ROOM : 0) });
  for (const edge of model.edges) {
    const a = line.get(edge.source);
    const b = line.get(edge.target);
    if (a === undefined || b === undefined) continue;
    if (a === b) {
      inside.push(edge);
      continue;
    }
    const [upper, lower] = a < b ? [edge.source, edge.target] : [edge.target, edge.source];
    g.setEdge(upper, lower, { minlen: Math.abs(a - b), weight: 1 }, edge.id);
    hasParent.add(lower);
    between.push({ edge, upper, lower });
  }
  // Layout-only links, never drawn: every node hangs from the line above it, so its line is exactly the line of its kind.
  if (grid) lines.forEach((ids, index) => ids.forEach((id, column) => {
    const above = lines[index - 1]?.[column];
    if (above) {
      g.setEdge(above, id, { minlen: 1, weight: 1 }, `ll:chain:${id}`);
      hasParent.add(id);
    }
  }));
  for (const node of model.nodes) {
    if (hasParent.has(node.id)) continue;
    const at = line.get(node.id)!;
    if (at === 0) g.setEdge(ROOT, node.id, { minlen: 1, weight: 1 }, `ll:root:${node.id}`);
    else g.setEdge(lines[at - 1]![0]!, node.id, { minlen: 1, weight: 1 }, `ll:hang:${node.id}`);
  }
  // Order inside a line: reading order at topic level; elsewhere dagre orders to cross as few lines as it can, with the slide at the left of its line.
  const constraints: Array<{ left: string; right: string }> = [];
  for (const ids of lines) {
    if (grid) ids.slice(1).forEach((id, index) => constraints.push({ left: ids[index]!, right: id }));
    else {
      const marker = ids.find((id) => model.nodes.find((node) => node.id === id)?.type === "marker");
      if (marker) for (const id of ids) if (id !== marker) constraints.push({ left: marker, right: id });
    }
  }
  dagre.layout(g, { constraints });

  const raw = new Map<string, Box>();
  for (const node of model.nodes) {
    const placed = g.node(node.id) as { x: number; y: number; width: number; height: number };
    raw.set(node.id, { x: placed.x - placed.width / 2, y: placed.y - placed.height / 2, width: placed.width, height: heights.get(node.id)! });
  }
  const left = Math.min(...[...raw.values()].map((box) => box.x));
  const top = Math.min(...[...raw.values()].map((box) => box.y));
  const dy = (grid ? 0 : MAP_GAPS.rankLabel) - top;
  const boxes = new Map([...raw].map(([id, box]) => [id, { x: round(box.x - left), y: round(box.y + dy), width: box.width, height: box.height }]));
  const width = Math.max(...[...boxes.values()].map((box) => box.x + box.width));
  const height = Math.max(...model.nodes.map((node) => boxes.get(node.id)!.y + boxes.get(node.id)!.height + (dips.has(line.get(node.id)!) ? DIP_ROOM : 0)));
  const rankLabels = grid ? [] : model.ranks.map((rank) => ({ rank, x: 0, y: boxes.get(lines[firstLineOf.get(rank)!]![0]!)!.y - MAP_GAPS.rankLabel }));

  // Each line has its own point on both nodes, spread along the edge, so no two share a trunk.
  type End = { id: string; side: "top" | "bottom"; toward: number; edge: string };
  const ends: End[] = [];
  const routes = new Map<string, Array<{ x: number; y: number }>>();
  for (const { edge, upper, lower } of between) {
    const inner = ((g.edge({ v: upper, w: lower, name: edge.id }) as { points?: Array<{ x: number; y: number }> }).points ?? []).slice(1, -1)
      .map((point) => ({ x: round(point.x - left), y: round(point.y + dy) }));
    const a = boxes.get(upper)!;
    const b = boxes.get(lower)!;
    // Only the points that carry the line past the lines in between: an edge between neighbouring lines is one curve.
    const via = Math.abs(line.get(upper)! - line.get(lower)!) > 1 ? inner.filter((point) => point.y > a.y + a.height + 4 && point.y < b.y - 4) : [];
    routes.set(edge.id, via);
    ends.push({ id: upper, side: "bottom", toward: via[0]?.x ?? b.x + b.width / 2, edge: edge.id }, { id: lower, side: "top", toward: via[via.length - 1]?.x ?? a.x + a.width / 2, edge: edge.id });
  }
  const anchor = new Map<string, number>();
  const groups = new Map<string, End[]>();
  for (const end of ends) groups.set(`${end.id}|${end.side}`, [...(groups.get(`${end.id}|${end.side}`) ?? []), end]);
  for (const list of groups.values()) {
    list.sort((p, q) => p.toward - q.toward || byText(p.edge, q.edge));
    const box = boxes.get(list[0]!.id)!;
    const step = list.length > 1 ? Math.min(28, (box.width * 0.5) / (list.length - 1)) : 0;
    list.forEach((end, index) => anchor.set(`${end.edge}|${end.id}`, round(box.x + box.width / 2 + (index - (list.length - 1) / 2) * step)));
  }

  const edges = new Map<string, EdgeGeometry>();
  for (const { edge, upper, lower } of between) {
    const a = boxes.get(upper)!;
    const b = boxes.get(lower)!;
    const start = { x: anchor.get(`${edge.id}|${upper}`)!, y: a.y + a.height + 2 };
    const end = { x: anchor.get(`${edge.id}|${lower}`)!, y: b.y - 2 };
    let arrow: EdgeGeometry["arrow"] = null;
    if (edge.arrow === "target") {
      if (edge.target === lower) {
        arrow = { x: end.x, y: end.y, angle: 90 };
        end.y -= ARROW;
      } else {
        arrow = { x: start.x, y: start.y, angle: -90 };
        start.y += ARROW;
      }
    }
    const points = [start, ...(routes.get(edge.id) ?? []), end];
    let path = `M${start.x} ${start.y}`;
    for (let index = 1; index < points.length; index += 1) {
      const p = points[index - 1]!;
      const q = points[index]!;
      const bend = round((q.y - p.y) * 0.5);
      path += `C${p.x} ${round(p.y + bend)} ${q.x} ${round(q.y - bend)} ${q.x} ${q.y}`;
    }
    const middle = points.length > 2 ? points[Math.floor(points.length / 2)]! : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    edges.set(edge.id, { path, arrow, label: edge.label ? { x: round(middle.x), y: round(middle.y) } : null });
  }
  for (const edge of inside) {
    const s = boxes.get(edge.source)!;
    const t = boxes.get(edge.target)!;
    const [l, r] = s.x <= t.x ? [s, t] : [t, s];
    const targetIsRight = t === r;
    const blocked = lines[line.get(edge.source)!]!.some((id) => {
      const box = boxes.get(id)!;
      return box !== l && box !== r && box.x > l.x && box.x < r.x;
    });
    if (!blocked && !edge.label) {
      const y = round(l.y + Math.min(l.height, r.height) / 2);
      let x1 = l.x + l.width + 3;
      let x2 = r.x - 3;
      let arrow: EdgeGeometry["arrow"] = null;
      if (edge.arrow === "target") {
        if (targetIsRight) {
          arrow = { x: x2, y, angle: 0 };
          x2 -= ARROW;
        } else {
          arrow = { x: x1, y, angle: 180 };
          x1 += ARROW;
        }
      }
      edges.set(edge.id, { path: `M${x1} ${y}H${x2}`, arrow, label: edge.label ? { x: round((x1 + x2) / 2), y } : null });
    } else {
      // It carries words, or the two are not neighbours: the line dips under the nodes, and its words sit under its lowest point.
      const bottom = Math.max(l.y + l.height, r.y + r.height);
      const from = { x: round(l.x + l.width / 2), y: l.y + l.height + 2 };
      const to = { x: round(r.x + r.width / 2), y: r.y + r.height + 2 };
      let arrow: EdgeGeometry["arrow"] = null;
      if (edge.arrow === "target") {
        const tip = targetIsRight ? to : from;
        arrow = { x: tip.x, y: tip.y, angle: -90 };
        tip.y += ARROW;
      }
      const dip = bottom + 28;
      edges.set(edge.id, { path: `M${from.x} ${from.y}C${from.x} ${dip} ${to.x} ${dip} ${to.x} ${to.y}`, arrow, label: edge.label ? { x: round((from.x + to.x) / 2), y: round(bottom + 36) } : null });
    }
  }
  return { boxes, rankLabels, edges, width: round(width), height: round(height) };
}

// ---- the pane: zoom never under 1, what does not fit is panned ------------------------------------------------------------
export interface MapPane {
  width: number;
  height: number;
}
export interface MapViewport {
  x: number;
  y: number;
  zoom: number;
}
/** The map is never drawn smaller than it is: 100 % to 150 %. */
export const MAP_ZOOM = { min: 1, max: 1.5, step: 0.25 } as const;
const PANE_PAD = 8;
/**
 * The nearest allowed place of a drawing in its pane. A drawing that fits is centred sideways and sits at the top;
 * one that does not can be moved until its edge is 8 px inside the pane, and no further. Whole pixels, so text stays sharp.
 */
export function clampViewport(view: MapViewport, drawing: { width: number; height: number }, pane: MapPane): MapViewport {
  const zoom = clamp(MAP_ZOOM.min, Number.isFinite(view.zoom) ? view.zoom : 1, MAP_ZOOM.max);
  const width = drawing.width * zoom;
  const height = drawing.height * zoom;
  const x = width <= pane.width - 2 * PANE_PAD ? (pane.width - width) / 2 : clamp(pane.width - width - PANE_PAD, view.x, PANE_PAD);
  const y = height <= pane.height - 2 * PANE_PAD ? PANE_PAD : clamp(pane.height - height - PANE_PAD, view.y, PANE_PAD);
  return { x: Math.round(x), y: Math.round(y), zoom };
}
/** The pane centred on a node, as far as the drawing's edges allow. Nothing is ever fitted by shrinking. */
export function centreOn(box: Box, drawing: { width: number; height: number }, pane: MapPane, zoom: number = MAP_ZOOM.min): MapViewport {
  return clampViewport({ x: pane.width / 2 - (box.x + box.width / 2) * zoom, y: pane.height / 2 - (box.y + box.height / 2) * zoom, zoom }, drawing, pane);
}
/** Another zoom about the middle of the pane. */
export function zoomAbout(view: MapViewport, zoom: number, drawing: { width: number; height: number }, pane: MapPane): MapViewport {
  const next = clamp(MAP_ZOOM.min, zoom, MAP_ZOOM.max);
  const cx = pane.width / 2;
  const cy = pane.height / 2;
  return clampViewport({ x: cx - ((cx - view.x) * next) / view.zoom, y: cy - ((cy - view.y) * next) / view.zoom, zoom: next }, drawing, pane);
}
/** The sides on which the drawing runs past the pane (the pane fades there). */
export function moreSides(view: MapViewport, drawing: { width: number; height: number }, pane: MapPane): { left: boolean; right: boolean; top: boolean; bottom: boolean } {
  return { left: view.x < -1, right: view.x + drawing.width * view.zoom > pane.width + 1, top: view.y < -1, bottom: view.y + drawing.height * view.zoom > pane.height + 1 };
}
/** True when a node lies wholly inside the pane. */
export function isInView(box: Box, view: MapViewport, pane: MapPane): boolean {
  const left = view.x + box.x * view.zoom;
  const top = view.y + box.y * view.zoom;
  return left >= 0 && top >= 0 && left + box.width * view.zoom <= pane.width && top + box.height * view.zoom <= pane.height;
}

// ---- one column (a phone) --------------------------------------------------------------------------------------------------
export interface ColumnGroup {
  key: string;
  /** What the group is: the rank's name, "Selected concept" for the selection, "Supported on" for the slide, the owner's relation for a related question. */
  label: string;
  /** The family of the lines that join this group to what is drawn above it; its stroke is shown beside the label and between the groups. */
  family: GraphEdgeFamily | null;
  nodes: MapNodeModel[];
}
/** The same model as one centred column: groups of neighbours in rank order, each named, the slide after the concepts it supports. */
export function columnGroups(model: MapModel): ColumnGroup[] {
  if (model.view === "topics") return [{ key: "topics", label: "", family: null, nodes: model.nodes }];
  const groups: ColumnGroup[] = [];
  const seen = new Set<string>();
  const familyTo = (ids: string[]): GraphEdgeFamily | null => {
    const mine = new Set(ids);
    const hit = model.edges.find((edge) => (mine.has(edge.source) && seen.has(edge.target)) || (mine.has(edge.target) && seen.has(edge.source)));
    return hit?.family ?? null;
  };
  const push = (key: string, label: string, nodes: MapNodeModel[]): void => {
    if (nodes.length === 0) return;
    groups.push({ key, label, family: familyTo(nodes.map((node) => node.id)), nodes });
    for (const node of nodes) seen.add(node.id);
  };
  for (const rank of model.ranks) {
    const members = model.nodes.filter((node) => node.rank === rank);
    const selected = members.filter((node) => node.selected);
    const marker = members.filter((node) => node.type === "marker");
    const rest = members.filter((node) => !node.selected && node.type !== "marker");
    push(`${rank}:selected`, selected[0] ? `Selected ${RANK_PLURAL[selected[0].rank === "related" ? "question" : selected[0].rank][0]}` : "", selected);
    if (rank === "related") {
      const words = [...new Set(model.edges.filter((edge) => edge.legend === "prerequisite_or_overlap" && edge.label).map((edge) => edge.label!))];
      push(rank, words.length === 1 ? `${RANK_LABEL.related}, “${words[0]}”` : RANK_LABEL.related, rest);
    } else push(rank, rest.length === 1 ? RANK_LABEL[rank] : sentence(RANK_PLURAL[rank][1]), rest);
    push(`${rank}:slide`, "Supported on", marker);
  }
  return groups;
}
const sentence = (text: string): string => (text ? text[0]!.toUpperCase() + text.slice(1) : text);
