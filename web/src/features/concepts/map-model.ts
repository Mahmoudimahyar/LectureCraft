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
import { countLabel, edgeLegendKind, edgeLegendKinds, edgeRelationLabel, nodeCountsLabel, type EdgeLegendKind } from "@/lib/labels";
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
/** The least room kept between the drawing and the edge of its pane. */
const PANE_PAD = 8;
const clamp = (low: number, value: number, high: number): number => Math.min(Math.max(value, low), high);
/**
 * Node width from the pane and from what is drawn. The nodes of the widest rank (three at most: more are folded) fill
 * the pane with 40 px between them, 320 px at most: over that the room goes to more content (a second level under a
 * topic), not to wider nodes. A drawing whose widest rank holds two nodes therefore gets wider nodes than one with
 * three, and a name is not wrapped into a tower while half the pane is empty. Never under 160: a pane too narrow for
 * three columns of 160 is panned. (At the default panel sizes a 1440 px window has a 590 px pane: 273 px nodes for
 * two to a rank, 168 for three; three columns of 200 px or more need a pane of 684 px.)
 */
export const MAP_NODE_WIDTH = { min: 160, max: 320, alone: 360 } as const;
export const mapNodeWidth = (paneWidth: number, widestRank: number = RANK_FOLD): number => {
  const columns = clamp(1, Math.floor(widestRank), RANK_FOLD);
  return clamp(MAP_NODE_WIDTH.min, Math.floor((paneWidth - 4 - (columns - 1) * MAP_GAPS.node) / columns), MAP_NODE_WIDTH.max);
};
/** A rank that holds one node gives it more room for its name: up to 360 px, and never wider than the pane less its margins. */
export const soloNodeWidth = (paneWidth: number): number => clamp(MAP_NODE_WIDTH.min, Math.floor(paneWidth - 2 * PANE_PAD), MAP_NODE_WIDTH.alone);
/**
 * The topic cards at topic level: as many columns as the pane holds at 174 px or more a card, three at least and five
 * at most (three up to a 1680 px window, four at 1920, five at 2560, at the default panel sizes), 16 px apart, a card
 * 280 px at most. With fewer cards than the pane has columns, the cards share the pane: no column is kept for nothing
 * (never fewer than three columns, so one or two cards do not grow into banners).
 */
export function topicGrid(paneWidth: number, cards: number = Number.POSITIVE_INFINITY): { columns: number; width: number } {
  const columns = Math.max(RANK_FOLD, Math.min(clamp(RANK_FOLD, Math.floor((paneWidth + 12) / 190), 5), cards));
  return { columns, width: clamp(160, Math.floor((paneWidth - 4 - (columns - 1) * MAP_GAPS.card) / columns), 280) };
}
export const topicNodeWidth = (paneWidth: number): number => topicGrid(paneWidth).width;
/** The width of every node of a drawing in a pane of this width: the card of the topic grid, the node of a full rank, or the wider node that stands alone in its rank. */
export function nodeWidths(model: Pick<MapModel, "view" | "nodes">, paneWidth: number): Map<string, number> {
  if (model.view === "topics") {
    const { width } = topicGrid(paneWidth, model.nodes.length);
    return new Map(model.nodes.map((node) => [node.id, width]));
  }
  const inRank = new Map<MapRank, number>();
  for (const node of model.nodes) inRank.set(node.rank, (inRank.get(node.rank) ?? 0) + 1);
  const width = mapNodeWidth(paneWidth, Math.max(1, ...inRank.values()));
  const alone = soloNodeWidth(paneWidth);
  return new Map(model.nodes.map((node) => [node.id, inRank.get(node.rank) === 1 ? alone : width]));
}

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
  /** Slide scope: the strongest tie of the slide's support of this node, when a source line reaches it. The node says "suggested link" when that is all there is. */
  tie: AnchorTieKind | null;
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
  /** Words on the line: the owner's relation between two questions or concepts. null for containment, assessment and a source line (the supported node says what its tie is). */
  label: string | null;
  /** Where the arrowhead sits. Containment never has one. */
  arrow: "target" | null;
  /** Where the line comes from; a source line that stands for several ties names each once. */
  provenance: string;
  /** A source line: the strongest of the ties it stands for. */
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
  /**
   * Draw the scope's own graph (one without a focus) as an overview — its topics with their concepts — instead of the
   * topic cards: the opening view of a lecture of a few topics, so that "Concept map" opens on something drawn. A slide
   * scope is always drawn so (with its skills and the slide).
   */
  overview?: boolean;
  /** How far below a topic is drawn, in an overview and around a selected topic: 1 its concepts (the default), 2 their skills too. Questions and criteria are drawn only around a concept, a skill or a question. */
  depth?: 1 | 2;
  /** An overview: the node marked as the selected one (a topic of the scope). */
  selected?: string | null;
}
/** A lecture or a slide of this many topics or fewer is drawn whole: its topics with their concepts, as an overview. */
export const OVERVIEW_TOPICS = 3;
const scopeTopics = (graph: ConceptGraphView): LayoutNode[] => graphLayoutInput(graph).nodes.filter((node) => node.kind === "topic" && node.inScope);
/**
 * True for the own graph (no focus, not cut by its limit) of a lecture or a slide scope that has between one and three
 * topics: the map draws such a scope whole while nothing or one of its topics is selected.
 */
export function drawnWhole(graph: ConceptGraphView | null | undefined): boolean {
  if (!graph || graph.focus || graph.truncated || (graph.dropped ?? 0) > 0 || (graph.scope?.kind ?? "course") === "course") return false;
  const topics = scopeTopics(graph).length;
  return topics >= 1 && topics <= OVERVIEW_TOPICS;
}
/**
 * The node a scope opens on, so that the map draws something and the detail panel holds something from the start:
 * the first topic of a lecture (in the order the map draws them; the Brain lists topics first, so a cut graph still
 * holds it), and the first topic of a slide that is drawn whole. null for the course scope (it opens on its topic
 * cards), for a slide of more than three topics (its own overview is drawn, nothing selected), for a scope without a
 * topic, and for a graph that is not a scope's own.
 */
export function openingNode(graph: ConceptGraphView | null | undefined): string | null {
  const kind = graph?.scope?.kind ?? "course";
  if (!graph || graph.focus || kind === "course" || (kind === "slide" && !drawnWhole(graph))) return null;
  return scopeTopics(graph)[0]?.id ?? null;
}
/** The first topic of a scope's own graph, in the order the map draws them; null when it holds none. Entering the course scope from a lecture opens on that lecture's first topic. */
export function firstTopic(graph: ConceptGraphView | null | undefined): string | null {
  return graphLayoutInput(graph).nodes.find((node) => node.kind === "topic" && node.inScope)?.id ?? null;
}

const foldId = (rank: MapRank): string => `ll:fold:${rank}`;
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const HIERARCHY = new Set(["topic_includes_concept", "topic_includes_skill", "concept_assessed_as_skill"]);

/** A reviewed anchor says more than a stated one, and a stated one more than a suggestion. A tie this build does not know is the weakest. */
const TIE_STRENGTH: Record<string, number> = { exact: 3, stated: 2, agent_inferred: 1 };
const stronger = (a: AnchorTieKind | null, b: AnchorTieKind | null): AnchorTieKind | null => ((TIE_STRENGTH[b ?? ""] ?? 0) > (TIE_STRENGTH[a ?? ""] ?? 0) ? b : a);
/**
 * Slide scope: the strongest tie by which the slide supports each node, read from the graph's source lines
 * (`edges[].tie`). A node no source line reaches is absent: nothing is said of it. The tree and the map say "suggested
 * link" of a node whose only tie is a suggestion, so a suggestion is never listed as the course's own anchor.
 */
export function sourceTies(graph: Pick<ConceptGraphView, "edges"> | null | undefined): Map<string, AnchorTieKind> {
  const ties = new Map<string, AnchorTieKind>();
  for (const edge of graph?.edges ?? []) {
    if (edge.family !== "source" || !edge.tie) continue;
    const best = stronger(ties.get(edge.to) ?? null, edge.tie);
    if (best) ties.set(edge.to, best);
  }
  return ties;
}

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
    where: data.where ?? null, supportPages: [...(data.support_pages ?? [])], evidence: grouping ? null : data.evidence ?? null, tie: null, inScope: node.inScope, selected: node.id === focus, data,
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
      where: null, supportPages: [], evidence: null, tie: null, inScope: node.inScope, selected: false,
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
      where: null, supportPages: [], evidence: null, tie: null, inScope: true, selected: false, action: { kind: "unfiled", label: options.showUnfiled ? "Hide them" : "Show them" }, data: null,
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
  const scopePage = scopeKind === "slide" ? graph.scope?.page ?? null : null;
  const focusKind = focus ? input.nodes.find((node) => node.id === focus)?.kind ?? null : null;
  // A topic asked two relations deep arrives with the questions and criteria of its concepts, which are not drawn
  // around a topic. The Brain lists the concepts and skills before them, so when any of them arrived no concept or
  // skill was left out: the cut then says nothing about what is drawn, and no "showing n of m" is claimed.
  const beyondSkills = focusKind === "topic" && (graph.nodes ?? []).some((node) => node.kind === "question" || node.kind === "criterion");
  const base = { focus, shown, total: shown + (beyondSkills ? 0 : graph.dropped ?? 0), scopeKind };
  const overview = !focus && (scopeKind === "slide" || options.overview === true);

  if (!focus && !overview) {
    const nodes = topicLevel(graph, input.nodes, input.edges, options);
    return { ...base, view: "topics", nodes, edges: [], ranks: nodes.length ? ["topic"] : [], legend: [], outOfScope: false };
  }

  // Below a topic: its concepts, and their skills when two levels are asked for. A slide's own overview always holds
  // its skills (a slide supports a handful). Around anything else everything the graph holds is drawn.
  const topicDown = focus ? focusKind === "topic" : scopeKind !== "slide";
  const depth = options.depth ?? 1;
  const drawnKind = (kind: LayoutNode["kind"]): boolean => !topicDown || kind === "topic" || kind === "concept" || (kind === "skill" && depth >= 2);
  const marked = focus ?? (overview ? options.selected ?? null : null);
  const real = new Map(input.nodes.filter((node) => node.data && drawnKind(node.kind)).map((node) => [node.id, node]));
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
  const openedQuestion =options.openedQuestion !== undefined ? options.openedQuestion : focusKind === "question" ? focus : focusKind === "criterion" && focus ? questionOf.get(focus) ?? null : null;
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
  // The skills that are drawn stand under the concepts that are drawn: first one skill of each drawn concept, in the
  // order of the concepts, then their second skills, and last the skills whose concept is in the fold.
  const conceptsOf = new Map<string, string[]>();
  for (const [concept, skills] of skillsOfConcept) for (const skill of skills) conceptsOf.set(skill, [...(conceptsOf.get(skill) ?? []), concept]);
  const byName = (a: LayoutNode, b: LayoutNode): number => byText(a.label.toLowerCase(), b.label.toLowerCase()) || byText(a.id, b.id);
  const turnOf = new Map<string, [number, number]>();
  const giveTurns = (skills: LayoutNode[]): void => {
    const conceptPlace = new Map(nodes.filter((node) => node.rank === "concept" && node.type === "node").map((node, index) => [node.id, index]));
    const taken = new Map<string, number>();
    for (const skill of [...skills].sort(byName)) {
      const concept = (conceptsOf.get(skill.id) ?? []).filter((id) => conceptPlace.has(id)).sort((a, b) => conceptPlace.get(a)! - conceptPlace.get(b)!)[0];
      if (concept === undefined) continue;
      turnOf.set(skill.id, [taken.get(concept) ?? 0, conceptPlace.get(concept)!]);
      taken.set(concept, (taken.get(concept) ?? 0) + 1);
    }
  };
  const turn = (id: string): [number, number] => turnOf.get(id) ?? [Number.MAX_SAFE_INTEGER, 0];
  for (const rank of MAP_RANKS) {
    if (rank === "skill") giveTurns(members.get(rank) ?? []);
    const list = [...(members.get(rank) ?? [])].sort((a, b) => priority(a.id) - priority(b.id) || (rank === "skill" ? turn(a.id)[0] - turn(b.id)[0] || turn(a.id)[1] - turn(b.id)[1] : 0) || byName(a, b));
    const row: MapNodeModel[] = [];
    if (rank === "concept" && marker) {
      row.push({ id: marker.id, type: "marker", rank, kind: "source_page", label: SLIDE_MARKER_LABEL, second: marker.label, where: null, supportPages: [...(input.sourcePage?.pages ?? [])], evidence: null,
        tie: null, inScope: true, selected: false, data: null });
      placed.set(marker.id, marker.id);
    }
    const fold = list.length > RANK_FOLD && !options.opened?.has(foldId(rank));
    const visible = fold ? list.slice(0, RANK_FOLD - 1) : list;
    for (const node of visible) {
      const model = plainNode(node, rank, scopeKind, marked);
      const hidden = node.kind === "question" ? hiddenCriteria.get(node.id) ?? 0 : 0;
      if (hidden > 0) model.action = { kind: "criteria", label: `Show ${countLabel(hidden, "criterion", "criteria")}` };
      row.push(model);
      placed.set(node.id, node.id);
    }
    if (fold) {
      const rest = list.slice(RANK_FOLD - 1);
      row.push({ id: foldId(rank), type: "fold", rank, kind: null, label: `${countLabel(rest.length, "more", "more")} ${RANK_PLURAL[rank][rest.length === 1 ? 0 : 1]}`, second: null, where: null, supportPages: [],
        evidence: null, tie: null, inScope: true, selected: false, folded: { rank, count: rest.length }, data: null });
      for (const node of rest) placed.set(node.id, foldId(rank));
    }
    nodes.push(...row);
  }

  // 5. Lines. A line to a folded node goes to the fold; the criteria of a question that is not opened are one line from the question.
  const edges = new Map<string, MapEdgeModel>();
  const add = (edge: LayoutEdge, source: string | undefined, target: string | undefined): void => {
    if (!source || !target || source === target) return;
    const legend = edgeLegendKind(edge);
    // One line between the slide and a node it supports, however many ties say so (a course anchor and a suggested link are two edges of the graph).
    const joined = edge.family === "source" || source !== edge.source || target !== edge.target;
    const key = joined ? `${legend}|${source}|${target}` : edge.id;
    const known = edges.get(key);
    if (known) {
      if (edge.family !== "source") return;
      known.tie = stronger(known.tie, edge.tie);
      if (edge.data.provenance && !known.provenance.split("; ").includes(edge.data.provenance)) known.provenance = [...known.provenance.split("; ").filter(Boolean), edge.data.provenance].sort(byText).join("; ");
      return;
    }
    const relation = legend === "prerequisite_or_overlap";
    edges.set(key, {
      id: joined ? `ll:${key}` : edge.id, source, target, family: edge.family, legend, relation: edge.relation,
      label: relation ? edgeRelationLabel(edge.relation) : null,
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
    // A source edge starts at the logical slide, which in a build group is every build of it. The drawn line starts at
    // the page on screen: it is drawn only for a tie that names this page, so what a later build first shows is never
    // joined to an earlier one (the node stays, and says "elsewhere in this sequence: build 3"). A tie that states no
    // pages is drawn as before: nothing is known against it.
    if (edge.family === "source" && scopePage !== null && edge.supportPages?.length && !edge.supportPages.includes(scopePage)) continue;
    add(edge, placed.get(edge.source), placed.get(edge.target));
  }

  const drawn = [...edges.values()];
  // What the slide's support of a node rests on is said on the node, whichever build carries it (a fold stands for
  // several nodes and says nothing): the strongest tie of the graph's own source lines, as the tree reads it.
  const tieOf = sourceTies(graph);
  for (const node of nodes) if (node.type === "node") node.tie = tieOf.get(node.id) ?? null;
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
 * layout-only links that are never drawn; `columns` says how many cards a line holds (three unless the pane holds more).
 * `heightOf` is the measured height of a node at its width: `nodeWidth`, or what `widthOf` gives a node (a rank of one
 * node may be wider than the nodes of a full rank). `fitWidth` is the width the nodes were sized to fill (the pane less
 * 4 px): a drawing that comes out a little wider is brought back to it by its gaps.
 */
export function layoutMap(model: MapModel, heightOf: (id: string) => number, options: { nodeWidth: number; widthOf?: (id: string) => number; columns?: number; fitWidth?: number }): MapLayout {
  const grid = model.view === "topics";
  const columns = Math.max(1, options.columns ?? RANK_FOLD);
  const widthOf = (id: string): number => options.widthOf?.(id) ?? options.nodeWidth;
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
  const between: Array<{ edge: MapEdgeModel; upper: string; lower: string; laidOut: boolean }> = [];
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
  for (const node of model.nodes) g.setNode(node.id, { width: widthOf(node.id), height: heights.get(node.id)! + (dips.has(line.get(node.id)!) ? DIP_ROOM : 0) });
  // Lines are given to the layout in the order of the model's nodes (the outline's order), so where no crossing decides,
  // a line of nodes reads in the order the outline lists them.
  const place = new Map(model.nodes.map((node, index) => [node.id, index]));
  const first = (edge: MapEdgeModel): number => Math.min(place.get(edge.source) ?? 0, place.get(edge.target) ?? 0);
  const second = (edge: MapEdgeModel): number => Math.max(place.get(edge.source) ?? 0, place.get(edge.target) ?? 0);
  for (const edge of [...model.edges].sort((p, q) => first(p) - first(q) || second(p) - second(q) || byText(p.id, q.id))) {
    const a = line.get(edge.source);
    const b = line.get(edge.target);
    if (a === undefined || b === undefined) continue;
    if (a === b) {
      inside.push(edge);
      continue;
    }
    const [upper, lower] = a < b ? [edge.source, edge.target] : [edge.target, edge.source];
    // The slide's line to a node on the next line is drawn after the layout, like a link inside one line: given to the
    // layout it would pull a skill out from under its concept. A longer one is laid out, so it is led round the nodes between.
    const drawnAfter = edge.family === "source" && Math.abs(a - b) === 1;
    if (!drawnAfter) {
      g.setEdge(upper, lower, { minlen: Math.abs(a - b), weight: 1 }, edge.id);
      hasParent.add(lower);
    }
    between.push({ edge, upper, lower, laidOut: !drawnAfter });
  }
  // Layout-only links, never drawn: every node hangs from the line above it, so its line is exactly the line of its kind.
  if (grid) lines.forEach((ids, index) => ids.forEach((id, column) => {
    const above = lines[index - 1]?.[column];
    if (above) {
      g.setEdge(above, id, { minlen: 1, weight: 1 }, `ll:chain:${id}`);
      hasParent.add(id);
    }
  }));
  // A node nothing above it leads to (the slide, a question no drawn skill is assessed by) hangs from the root by a link
  // as long as its line is deep, so it never pulls a real node aside: a topic stays straight above its one concept.
  for (const node of model.nodes) {
    if (hasParent.has(node.id)) continue;
    g.setEdge(ROOT, node.id, { minlen: line.get(node.id)! + 1, weight: 1 }, `ll:root:${node.id}`);
  }
  // Order inside a line: reading order at topic level; elsewhere dagre orders to cross as few lines as it can, with the slide at the left of its line.
  // The slide stands at the left of its line and the folded rest of a line at its end. The first line that holds more
  // than one node reads in the outline's order (the model's); dagre orders the lines below it to cross as few lines as
  // it can, so a concept's skills still stand under it.
  const typeOf = new Map(model.nodes.map((node) => [node.id, node.type]));
  const constraints: Array<{ left: string; right: string }> = [];
  let ordered = false;
  for (const ids of lines) {
    if (grid) {
      ids.slice(1).forEach((id, index) => constraints.push({ left: ids[index]!, right: id }));
      continue;
    }
    const marker = ids.find((id) => typeOf.get(id) === "marker");
    const fold = ids.find((id) => typeOf.get(id) === "fold");
    const rest = ids.filter((id) => id !== marker && id !== fold);
    if (!ordered && rest.length > 1) {
      ordered = true;
      const row = [...(marker ? [marker] : []), ...rest, ...(fold ? [fold] : [])];
      row.slice(1).forEach((id, index) => constraints.push({ left: row[index]!, right: id }));
    } else {
      if (marker) for (const id of ids) if (id !== marker) constraints.push({ left: marker, right: id });
      if (fold) for (const id of rest) constraints.push({ left: id, right: fold });
    }
  }
  dagre.layout(g, { constraints });

  const raw = new Map<string, Box>();
  for (const node of model.nodes) {
    const placed = g.node(node.id) as { x: number; y: number; width: number; height: number };
    raw.set(node.id, { x: placed.x - placed.width / 2, y: placed.y - placed.height / 2, width: placed.width, height: heights.get(node.id)! });
  }
  // A wider node that stands alone on its line is centred over (or under) the node it belongs to. When that node is at
  // an end of a full line, the wider one would reach past the line and make the drawing wider than its pane: it is
  // moved back inside the extent of the full lines, as far as it reaches past it and no further.
  if (!grid) {
    const full = lines.filter((ids) => ids.length > 1).flat().map((id) => raw.get(id)!);
    if (full.length > 0) {
      const from = Math.min(...full.map((box) => box.x));
      const to = Math.max(...full.map((box) => box.x + box.width));
      for (const ids of lines) {
        const box = ids.length === 1 ? raw.get(ids[0]!)! : null;
        if (box && box.width <= to - from) box.x = clamp(from, box.x, to - box.width);
      }
    }
  }
  const left = Math.min(...[...raw.values()].map((box) => box.x));
  const top = Math.min(...[...raw.values()].map((box) => box.y));
  // The nodes are sized to fill the pane, but a line that is led past a rank takes a few pixels between two nodes
  // there, and the drawing then comes out that much wider than the pane: a drawing made to fit would be cut at one side
  // and faded. Such a small excess (5 % at most) is taken out of the gaps between the nodes, never out of the nodes.
  let squeeze = 1;
  if (!grid && options.fitWidth && Math.max(...[...raw.values()].map((box) => box.x + box.width)) - left > options.fitWidth) {
    const needed = Math.min(...[...raw.values()].filter((box) => box.x > left).map((box) => (options.fitWidth! - box.width) / (box.x - left)));
    if (needed >= 0.95 && needed < 1) squeeze = needed;
  }
  const across = (x: number): number => left + (x - left) * squeeze;
  if (squeeze !== 1) for (const box of raw.values()) box.x = across(box.x);
  const dy = (grid ? 0 : MAP_GAPS.rankLabel) - top;
  const boxes = new Map([...raw].map(([id, box]) => [id, { x: round(box.x - left), y: round(box.y + dy), width: box.width, height: box.height }]));
  const width = Math.max(...[...boxes.values()].map((box) => box.x + box.width));
  const height = Math.max(...model.nodes.map((node) => boxes.get(node.id)!.y + boxes.get(node.id)!.height + (dips.has(line.get(node.id)!) ? DIP_ROOM : 0)));
  const rankLabels = grid ? [] : model.ranks.map((rank) => ({ rank, x: 0, y: boxes.get(lines[firstLineOf.get(rank)!]![0]!)!.y - MAP_GAPS.rankLabel }));

  // The foot of each line of nodes: just under its tallest node. A line that leaves a shorter node runs straight down to
  // the foot before it turns, so it never crosses a taller neighbour.
  const footOf = lines.map((ids) => Math.max(...ids.map((id) => boxes.get(id)!.y + boxes.get(id)!.height)) + 2);

  // Each line has its own point on both nodes, spread along the edge, so no two share a trunk.
  type End = { id: string; side: "top" | "bottom"; toward: number; edge: string };
  const ends: End[] = [];
  const routes = new Map<string, Array<{ x: number; y: number }>>();
  for (const { edge, upper, lower, laidOut } of between) {
    const inner = (laidOut ? (g.edge({ v: upper, w: lower, name: edge.id }) as { points?: Array<{ x: number; y: number }> }).points ?? [] : []).slice(1, -1)
      .map((point) => ({ x: round(across(point.x) - left), y: round(point.y + dy) }));
    const a = boxes.get(upper)!;
    const b = boxes.get(lower)!;
    // Only the points that carry the line past the lines in between: an edge between neighbouring lines is one curve.
    const via = Math.abs(line.get(upper)! - line.get(lower)!) > 1 ? inner.filter((point) => point.y > footOf[line.get(upper)!]! + 4 && point.y < b.y - 4) : [];
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
    let path = `M${start.x} ${start.y}`;
    const foot = footOf[line.get(upper)!]!;
    const turn = foot > start.y + 1 ? { x: start.x, y: foot } : start;
    if (turn !== start) path += `V${foot}`;
    const points = [turn, ...(routes.get(edge.id) ?? []), end];
    for (let index = 1; index < points.length; index += 1) {
      const p = points[index - 1]!;
      const q = points[index]!;
      const bend = round((q.y - p.y) * 0.5);
      path += `C${p.x} ${round(p.y + bend)} ${q.x} ${round(q.y - bend)} ${q.x} ${q.y}`;
    }
    const middle = points.length > 2 ? points[Math.floor(points.length / 2)]! : { x: (turn.x + end.x) / 2, y: (turn.y + end.y) / 2 };
    edges.set(edge.id, { path, arrow, label: edge.label ? { x: round(middle.x), y: round(middle.y) } : null });
  }
  for (const edge of inside) {
    const s = boxes.get(edge.source)!;
    const t = boxes.get(edge.target)!;
    const [l, r] = s.x <= t.x ? [s, t] : [t, s];
    const targetIsRight = t === r;
    // The two nodes and what lies between them on their line.
    const span = lines[line.get(edge.source)!]!.map((id) => boxes.get(id)!).filter((box) => box.x >= l.x && box.x <= r.x);
    const blocked = span.length > 2;
    if (blocked && !edge.label) {
      // Not neighbours, and no words to carry (the slide and a concept it supports further along the line): the line
      // arcs over the tops of the nodes, which are level, and arrives off the middle of the node, where the line from
      // the rank above comes in.
      const inset = Math.min(28, l.width / 4);
      const from = { x: round(l.x + l.width - inset), y: l.y - 2 };
      const to = { x: round(r.x + inset), y: r.y - 2 };
      let arrow: EdgeGeometry["arrow"] = null;
      if (edge.arrow === "target") {
        const tip = targetIsRight ? to : from;
        arrow = { x: tip.x, y: tip.y, angle: 90 };
        tip.y -= ARROW;
      }
      const rise = Math.max(0, Math.min(from.y, to.y) - 28);
      edges.set(edge.id, { path: `M${from.x} ${from.y}C${from.x} ${rise} ${to.x} ${rise} ${to.x} ${to.y}`, arrow, label: null });
    } else if (!edge.label) {
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
      // It carries words: the line dips under the nodes (under the tallest of the two and of what lies between them),
      // and its words sit under its lowest point.
      const foot = Math.max(...span.map((box) => box.y + box.height)) + 2;
      const from = { x: round(l.x + l.width / 2), y: l.y + l.height + 2 };
      const to = { x: round(r.x + r.width / 2), y: r.y + r.height + 2 };
      let arrow: EdgeGeometry["arrow"] = null;
      if (edge.arrow === "target") {
        const tip = targetIsRight ? to : from;
        arrow = { x: tip.x, y: tip.y, angle: -90 };
        tip.y += ARROW;
      }
      const dip = foot + 26;
      const down = from.y < foot - 1 ? `V${foot}` : "";
      const up = to.y < foot - 1 ? `V${to.y}` : "";
      const path = `M${from.x} ${from.y}${down}C${from.x} ${dip} ${to.x} ${dip} ${to.x} ${up ? foot : to.y}${up}`;
      edges.set(edge.id, { path, arrow, label: { x: round((from.x + to.x) / 2), y: round(foot + 34) } });
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
/** What is placed in the pane. `pinTop`: a drawing that is read from its top (the topic cards under their sentence) stays there instead of being centred upright. */
export interface MapDrawing {
  width: number;
  height: number;
  pinTop?: boolean;
}
/**
 * The nearest allowed place of a drawing in its pane. A drawing that fits is centred, sideways and upright (the
 * topic cards stay at the top); one that does not can be moved until its edge is 8 px inside the pane, and no further.
 * Whole pixels, so text stays sharp.
 * "Fits" is the pane's own width: three columns are sized to fill the pane less 4 px, and such a drawing must stay still.
 */
export function clampViewport(view: MapViewport, drawing: MapDrawing, pane: MapPane): MapViewport {
  const zoom = clamp(MAP_ZOOM.min, Number.isFinite(view.zoom) ? view.zoom : 1, MAP_ZOOM.max);
  const width = drawing.width * zoom;
  const height = drawing.height * zoom;
  const x = width <= pane.width ? (pane.width - width) / 2 : clamp(pane.width - width - PANE_PAD, view.x, PANE_PAD);
  const y = height <= pane.height - PANE_PAD ? (drawing.pinTop ? PANE_PAD : Math.max(PANE_PAD, (pane.height - height) / 2)) : clamp(pane.height - height - PANE_PAD, view.y, PANE_PAD);
  return { x: Math.round(x), y: Math.round(y), zoom };
}
/** The pane centred on a node, as far as the drawing's edges allow. Nothing is ever fitted by shrinking. */
export function centreOn(box: Box, drawing: MapDrawing, pane: MapPane, zoom: number = MAP_ZOOM.min): MapViewport {
  return clampViewport({ x: pane.width / 2 - (box.x + box.width / 2) * zoom, y: pane.height / 2 - (box.y + box.height / 2) * zoom, zoom }, drawing, pane);
}
/**
 * Where a drawing opens. One that is wider than its pane starts at its left edge, where the names of the ranks are,
 * and is moved only as far as the selected node needs to lie wholly in the pane; a selected node that does not fit
 * the pane at all is centred. Nothing is ever fitted by shrinking.
 */
export function openingViewport(target: Box | null | undefined, drawing: MapDrawing, pane: MapPane): MapViewport {
  const start = clampViewport({ x: PANE_PAD, y: PANE_PAD, zoom: MAP_ZOOM.min }, drawing, pane);
  if (!target || isInView(target, start, pane)) return start;
  if (target.width > pane.width - 2 * PANE_PAD || target.height > pane.height - 2 * PANE_PAD) return centreOn(target, drawing, pane);
  const x = clamp(PANE_PAD - target.x, start.x, pane.width - PANE_PAD - (target.x + target.width));
  const y = clamp(PANE_PAD - target.y, start.y, pane.height - PANE_PAD - (target.y + target.height));
  return clampViewport({ x, y, zoom: MAP_ZOOM.min }, drawing, pane);
}
/** Another zoom about the middle of the pane. */
export function zoomAbout(view: MapViewport, zoom: number, drawing: MapDrawing, pane: MapPane): MapViewport {
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
  /** The stroke of those lines as the key names it. "Part of" and "prerequisite or overlap" are both of the structure family: only the stroke tells them apart. */
  line: EdgeLegendKind | null;
  nodes: MapNodeModel[];
}
/** The same model as one centred column: groups of neighbours in rank order, each named, the slide after the concepts it supports. */
export function columnGroups(model: MapModel): ColumnGroup[] {
  if (model.view === "topics") return [{ key: "topics", label: "", family: null, line: null, nodes: model.nodes }];
  const groups: ColumnGroup[] = [];
  const seen = new Set<string>();
  const joinTo = (ids: string[]): MapModel["edges"][number] | null => {
    const mine = new Set(ids);
    return model.edges.find((edge) => (mine.has(edge.source) && seen.has(edge.target)) || (mine.has(edge.target) && seen.has(edge.source))) ?? null;
  };
  const push = (key: string, label: string, nodes: MapNodeModel[]): void => {
    if (nodes.length === 0) return;
    const join = joinTo(nodes.map((node) => node.id));
    groups.push({ key, label, family: join?.family ?? null, line: join?.legend ?? null, nodes });
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
