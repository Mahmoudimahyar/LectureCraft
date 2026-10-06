// The concept map (design specification 7.3): an alternative view of the tree, never the only path. @xyflow/react draws
// the nodes and pans the pane; @dagrejs/dagre (in ./map-model) is the one layout engine. It opens at topic level, draws
// the neighbourhood of the selected node from `GET …/concept-graph?focus=&depth=`, never zooms under 100 %, gives each
// edge family its own stroke, draws the page of a slide scope as the origin of its source lines, and below 560 px
// becomes one centred column of named groups. Nodes are not draggable. No text of the map is under 14 px.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ReactFlow, ReactFlowProvider, ViewportPortal, applyNodeChanges, type Node, type NodeChange, type NodeProps, type Viewport } from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { LocateFixed, Minus, Plus } from "lucide-react";
import { ErrorGlyph, KindGlyph } from "@/components/glyphs";
import { StateLabel } from "@/components/labels";
import { Button, IconButton, Skeleton, cn } from "@/components/ui";
import { EDGE_LEGEND, GRAPH_NODE_KIND_LABEL, countLabel, type EdgeLegendKind } from "@/lib/labels";
import { useConceptGraph } from "@/lib/queries";
import { conceptGraphErrorCode } from "@/lib/r2";
import type { ConceptGraphScopeParam, ConceptGraphView, GraphEdgeFamily, GraphNodeKind, GraphScopeKind } from "@/lib/types";
import { wherePhrase, type TreePlace } from "./ConceptTree";
import {
  MAP_ZOOM, ONE_COLUMN_BELOW, RANK_LABEL, buildMapModel, centreOn, clampViewport, columnGroups, isInView, layoutMap, mapNodeWidth, moreSides, topicNodeWidth, zoomAbout,
  type MapEdgeModel, type MapLayout, type MapModel, type MapNodeModel, type MapPane,
} from "./map-model";

/** The scope's own graph (no focus): its topics, concepts and skills, and its totals. One cache entry for the map, the outline head and the counts. */
export const SCOPE_GRAPH_LIMIT = 400;
export const useScopeGraph = (courseId: string, scope: string, enabled = true) => useConceptGraph(courseId, { scope: scope as ConceptGraphScopeParam, limit: SCOPE_GRAPH_LIMIT, enabled });
/**
 * The neighbourhood of the selected node in a scope: a topic with its concepts (depth 1), anything else with what
 * surrounds it (depth 2). The kind is read from the scope's own graph, so the request waits for it. One cache entry
 * for the map, the detail header and the tree's reveal.
 */
export function useFocusGraph(courseId: string, scope: string, selected: string | null) {
  const base = useScopeGraph(courseId, scope);
  const kind = base.data?.nodes.find((node) => node.id === selected)?.kind ?? null;
  return useConceptGraph(courseId, { scope: scope as ConceptGraphScopeParam, focus: selected, depth: kind === "topic" ? 1 : 2, enabled: !!selected && !base.isLoading });
}

// ---- what a node can ask of the map --------------------------------------------------------------------------------------
interface MapActions {
  select: (node: MapNodeModel) => void;
  openFold: (id: string) => void;
  openCriteria: (questionId: string) => void;
  toggleUnfiled: () => void;
  hover: (id: string | null) => void;
  focused: (id: string) => void;
  place: TreePlace | null;
}
const ActionsContext = createContext<MapActions | null>(null);
const useActions = (): MapActions => {
  const value = useContext(ActionsContext);
  if (!value) throw new Error("a map node was drawn outside the concept map");
  return value;
};

// ---- strokes: one per kind of line, told apart without colour -------------------------------------------------------------
const LINE: Record<EdgeLegendKind, { width: number; hot: number; dash?: string; round?: boolean; double?: boolean }> = {
  hierarchy: { width: 1.5, hot: 2 },
  prerequisite_or_overlap: { width: 4.5, hot: 5, double: true },
  assessment: { width: 1.5, hot: 2, dash: "6 4" },
  source: { width: 2.6, hot: 3, dash: "0.1 5.5", round: true },
};
const FAMILY_LINE: Record<GraphEdgeFamily, EdgeLegendKind> = { structure: "hierarchy", assessment: "assessment", source: "source" };

function Line({ d, kind, hot = false }: { d: string; kind: EdgeLegendKind; hot?: boolean }) {
  const style = LINE[kind];
  return (
    <>
      <path d={d} fill="none" className={hot ? "stroke-accent-text" : "stroke-line"} strokeWidth={hot ? style.hot : style.width} strokeDasharray={style.dash} strokeLinecap={style.round ? "round" : undefined} />
      {/* The owner's relation between two questions or concepts: a double line, so it is never read as containment. */}
      {style.double && <path d={d} fill="none" className="stroke-bg" strokeWidth={1.5} />}
    </>
  );
}
function Sample({ kind }: { kind: EdgeLegendKind }) {
  const arrow = kind === "assessment" || kind === "source";
  return (
    <svg aria-hidden width="30" height="10" viewBox="0 0 30 10" className="flex-none overflow-visible">
      <Line d={arrow ? "M1 5H21" : "M1 5H29"} kind={kind} />
      {arrow && <path d="M29 5l-8 -4v8z" className="fill-line" />}
    </svg>
  );
}

// ---- nodes ---------------------------------------------------------------------------------------------------------------
const CARD = "rounded-control bg-raised text-ui shadow-[0_0_0_1px_var(--ll-hairline)]";
const PRESS = "w-full rounded-control border-0 bg-transparent px-3 py-2.5 text-left text-ink transition-colors duration-[var(--ll-motion-small)] hover:bg-[color-mix(in_srgb,var(--ll-text)_6%,transparent)]";
const GRID = "grid grid-cols-[12px_minmax(0,1fr)] items-start gap-x-2 gap-y-0.5";

function Card({ node }: { node: MapNodeModel }) {
  const actions = useActions();
  const watch = { onMouseEnter: () => actions.hover(node.id), onMouseLeave: () => actions.hover(null), onFocus: () => { actions.hover(node.id); actions.focused(node.id); }, onBlur: () => actions.hover(null) };

  if (node.type === "marker") {
    return (
      <div className={cn(GRID, "rounded-control px-3 py-2.5 text-ui shadow-[inset_0_0_0_1px_var(--ll-border)]")} data-map-node={node.id} data-type="marker">
        <KindGlyph kind="source_page" className="mt-1" />
        <span className="font-semibold">{node.label}</span>
        {node.second && <span className="col-start-2 text-muted">{node.second}</span>}
      </div>
    );
  }
  if (node.type === "fold") {
    return (
      <button type="button" {...watch} onClick={() => actions.openFold(node.id)} data-map-node={node.id} data-type="fold"
        className={cn(CARD, "flex w-full items-center gap-2 border-0 px-3 py-2.5 text-left font-semibold text-accent-text transition-colors duration-[var(--ll-motion-small)] hover:bg-tint")}>
        <Plus aria-hidden className="size-3.5 flex-none" /><span className="min-w-0">{node.label}</span>
      </button>
    );
  }
  const kind = (node.kind ?? "concept") as GraphNodeKind;
  const where = wherePhrase({ where: node.where, support_pages: node.supportPages }, actions.place);
  if (node.type === "topic-card" || node.type === "unfiled") {
    return (
      <div className={CARD} data-map-node={node.id} data-type={node.type}>
        <button type="button" {...watch} className={cn(PRESS, GRID)} onClick={() => (node.type === "unfiled" ? actions.toggleUnfiled() : actions.select(node))}>
          <KindGlyph kind="topic" className="mt-1" />
          <span className="break-words font-semibold">{node.type === "unfiled" ? null : <><span className="sr-only">Topic:</span>{" "}</>}{node.label}</span>
          {node.second && <span className="col-start-2 text-muted">{node.second}</span>}
          {node.action && <span className="col-start-2 mt-0.5 inline-flex items-center gap-1 font-semibold text-accent-text"><Plus aria-hidden className="size-3.5 flex-none" />{node.action.label}</span>}
        </button>
      </div>
    );
  }
  const outside = !node.inScope;
  return (
    <div data-map-node={node.id} data-type="node" data-kind={kind} data-selected={node.selected || undefined}
      className={cn("rounded-control text-ui", outside ? "outline-dashed outline-[1.5px] -outline-offset-[1.5px] outline-line" : node.selected ? "bg-tint shadow-[0_0_0_2px_var(--ll-accent-text)]" : "bg-raised shadow-[0_0_0_1px_var(--ll-hairline)]")}>
      <button type="button" {...watch} aria-current={node.selected ? "true" : undefined} className={cn(PRESS, GRID)} onClick={() => actions.select(node)}>
        <KindGlyph kind={kind} selected={node.selected} className="mt-1" />
        <span className={cn("break-words", node.selected && "font-semibold text-accent-text", outside && "text-muted")}><span className="sr-only">{GRAPH_NODE_KIND_LABEL[kind] ?? kind}:</span>{" "}{node.label}</span>
        {node.second && <span className={cn("col-start-2", node.selected ? "text-ink" : "text-muted")}>{node.second}</span>}
        {where && <span className={cn("col-start-2", node.selected ? "text-ink" : "text-muted")}>{where}</span>}
        {node.evidence && <StateLabel evidence={node.evidence} quiet={!node.selected} className="col-start-2 flex" />}
      </button>
      {node.action?.kind === "criteria" && (
        <button type="button" onClick={() => actions.openCriteria(node.id)}
          className="flex w-full items-center gap-1 rounded-b-control border-0 border-t border-hairline bg-transparent px-3 py-1.5 pl-8 text-left text-ui font-semibold text-accent-text hover:bg-tint">
          <Plus aria-hidden className="size-3.5 flex-none" />{node.action.label}
        </button>
      )}
    </div>
  );
}

type FlowNode = Node<{ model: MapNodeModel }, "card">;
function FlowCard({ data }: NodeProps<FlowNode>) {
  // React Flow lets the pointer through a node that is neither draggable nor selectable; these nodes are pressed.
  return <div className="pointer-events-auto"><Card node={data.model} /></div>;
}
const NODE_TYPES = { card: FlowCard };

// ---- the pannable drawing (three columns) -----------------------------------------------------------------------------------
function Lines({ model, layout, hot }: { model: MapModel; layout: MapLayout; hot: ReadonlySet<string> }) {
  return (
    <>
      <svg aria-hidden width={Math.max(1, layout.width)} height={Math.max(1, layout.height)} className="pointer-events-none absolute left-0 top-0 overflow-visible">
        {model.edges.map((edge) => {
          const geometry = layout.edges.get(edge.id);
          if (!geometry) return null;
          const lit = hot.has(edge.source) || hot.has(edge.target);
          return (
            <g key={edge.id} data-edge={edge.id} data-family={edge.family} data-line={edge.legend}>
              <Line d={geometry.path} kind={edge.legend} hot={lit} />
              {geometry.arrow && <path d="M0 0l-8 -4.5v9z" transform={`translate(${geometry.arrow.x} ${geometry.arrow.y}) rotate(${geometry.arrow.angle})`} className={lit ? "fill-accent-text" : "fill-line"} />}
              <path d={geometry.path} fill="none" stroke="transparent" strokeWidth={12} style={{ pointerEvents: "stroke" }}><title>{edgeTitle(edge)}</title></path>
            </g>
          );
        })}
      </svg>
      {model.edges.map((edge) => {
        const at = layout.edges.get(edge.id)?.label;
        return at && edge.label ? <span key={edge.id} className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-thumb bg-bg px-1.5 text-ui text-muted" style={{ left: at.x, top: at.y }}>{edge.label}</span> : null;
      })}
      {layout.rankLabels.map((label) => <span key={label.rank} className="pointer-events-none absolute whitespace-nowrap text-ui text-muted" style={{ left: label.x, top: label.y }}>{RANK_LABEL[label.rank]}</span>)}
    </>
  );
}
const edgeTitle = (edge: MapEdgeModel): string => `${EDGE_LEGEND[edge.legend].label}${edge.label ? `: ${edge.label}` : ""}. From ${edge.provenance}.`;

interface FlowHandle {
  zoom: number;
  zoomTo: (zoom: number) => void;
  centre: () => void;
}
function Flow({ model, pane, onReady }: { model: MapModel; pane: MapPane; onReady: (handle: FlowHandle | null) => void }) {
  const actions = useActions();
  const width = model.view === "topics" ? topicNodeWidth(pane.width) : mapNodeWidth(pane.width);
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 8, zoom: 1 });
  const [hovered, setHovered] = useState<string | null>(null);

  // The node list follows the model; a node that stays keeps what React Flow measured of it.
  useEffect(() => {
    setNodes((current) => {
      const known = new Map(current.map((node) => [node.id, node]));
      return model.nodes.map((entry) => ({ ...(known.get(entry.id) ?? { position: { x: 0, y: 0 } }), id: entry.id, type: "card" as const, data: { model: entry }, style: { width }, draggable: false, selectable: false, focusable: false, connectable: false }));
    });
  }, [model, width]);
  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => setNodes((current) => applyNodeChanges(changes, current)), []);

  // Layout once every node of the model has a measured height at this width.
  const heights = nodes.map((node) => `${node.id}:${node.measured?.height ?? ""}`).join("|");
  const layout = useMemo(() => {
    const measured = new Map(nodes.map((node) => [node.id, node.measured?.height]));
    if (model.nodes.length === 0 || model.nodes.some((entry) => !measured.get(entry.id))) return null;
    return layoutMap(model, (id) => measured.get(id) ?? 0, { nodeWidth: width });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, width, heights]);
  const placed = useMemo(() => nodes.map((node) => {
    const box = layout?.boxes.get(node.id);
    return box && (box.x !== node.position.x || box.y !== node.position.y) ? { ...node, position: { x: box.x, y: box.y } } : node;
  }), [nodes, layout]);

  // A selection centres the pane on the selected node at 100 %; an opened fold or a resized pane keeps the zoom.
  const selectedId = model.nodes.find((entry) => entry.selected)?.id ?? null;
  const drawing = layout ? { width: layout.width, height: layout.height } : null;
  const settled = useRef<{ key: string; selected: string | null } | null>(null);
  const layoutKey = layout ? `${model.view}|${model.nodes.map((entry) => entry.id).join(",")}|${layout.width}x${layout.height}|${pane.width}x${pane.height}` : "";
  useLayoutEffect(() => {
    if (!layout || !drawing) return;
    const previous = settled.current;
    if (previous?.key === layoutKey) return;
    const target = selectedId ? layout.boxes.get(selectedId) : undefined;
    const fresh = !previous || previous.selected !== selectedId;
    setViewport((current) => (fresh && target ? centreOn(target, drawing, pane) : clampViewport(fresh ? { x: 0, y: 0, zoom: 1 } : current, drawing, pane)));
    settled.current = { key: layoutKey, selected: selectedId };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  const onViewportChange = useCallback((next: Viewport) => setViewport(drawing ? clampViewport(next, drawing, pane) : next), [drawing?.width, drawing?.height, pane.width, pane.height]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!layout || !drawing) {
      onReady(null);
      return;
    }
    onReady({
      zoom: viewport.zoom,
      zoomTo: (zoom) => setViewport((current) => zoomAbout(current, zoom, drawing, pane)),
      centre: () => {
        const target = selectedId ? layout.boxes.get(selectedId) : undefined;
        setViewport((current) => (target ? centreOn(target, drawing, pane, current.zoom) : clampViewport({ ...current, x: 0, y: 0 }, drawing, pane)));
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, viewport.zoom, selectedId]);
  useEffect(() => () => onReady(null), [onReady]);

  // A node reached by keyboard is brought into the pane.
  const local = useMemo<MapActions>(() => ({
    ...actions,
    hover: setHovered,
    focused: (id) => {
      const box = layout?.boxes.get(id);
      if (box && drawing) setViewport((current) => (isInView(box, current, pane) ? current : centreOn(box, drawing, pane, current.zoom)));
    },
  }), [actions, layout, drawing?.width, drawing?.height, pane.width, pane.height]); // eslint-disable-line react-hooks/exhaustive-deps

  const hot = useMemo(() => new Set([selectedId, hovered].filter((id): id is string => !!id)), [selectedId, hovered]);
  const more = drawing ? moreSides(viewport, drawing, pane) : { left: false, right: false, top: false, bottom: false };
  const sideways = `linear-gradient(to right, ${more.left ? "transparent, #000 40px" : "#000, #000"}, ${more.right ? "#000 calc(100% - 40px), transparent" : "#000"})`;
  const upright = `linear-gradient(to bottom, ${more.top ? "transparent, #000 40px" : "#000, #000"}, ${more.bottom ? "#000 calc(100% - 40px), transparent" : "#000"})`;
  const fades = more.left || more.right || more.top || more.bottom;

  return (
    <ActionsContext.Provider value={local}>
      <ReactFlow<FlowNode> aria-label="Concept map. Every entry is also in the outline." nodes={placed} edges={[]} nodeTypes={NODE_TYPES} onNodesChange={onNodesChange} viewport={viewport} onViewportChange={onViewportChange}
        minZoom={MAP_ZOOM.min} maxZoom={MAP_ZOOM.max} panOnDrag panOnScroll zoomOnScroll={false} zoomOnDoubleClick={false} zoomOnPinch nodesDraggable={false} nodesConnectable={false} nodesFocusable={false}
        edgesFocusable={false} elementsSelectable={false} disableKeyboardA11y deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null} panActivationKeyCode={null} zoomActivationKeyCode={null}
        proOptions={{ hideAttribution: true }} className={cn(!layout && "opacity-0")}
        style={fades ? { maskImage: `${sideways}, ${upright}`, WebkitMaskImage: `${sideways}, ${upright}`, maskComposite: "intersect", WebkitMaskComposite: "source-in" } : undefined}>
        {layout && <ViewportPortal><Lines model={model} layout={layout} hot={hot} /></ViewportPortal>}
      </ReactFlow>
    </ActionsContext.Provider>
  );
}

// ---- one centred column (a phone) --------------------------------------------------------------------------------------------
function Column({ model }: { model: MapModel }) {
  const groups = columnGroups(model);
  const labelOf = new Map(model.nodes.map((node) => [node.id, node.label]));
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-3 [scrollbar-width:thin]" data-testid="concept-map-column">
      <div className="mx-auto flex w-full max-w-[360px] flex-col">
        {groups.map((group, index) => (
          <section key={group.key} aria-label={group.label || undefined} className="flex flex-col gap-2">
            {index > 0 && (
              <svg aria-hidden width="30" height="20" viewBox="0 0 30 20" className="ml-3 flex-none overflow-visible">
                {group.family ? <Line d="M15 2V18" kind={FAMILY_LINE[group.family]} /> : null}
              </svg>
            )}
            {group.label && (
              <p className="flex items-center gap-2 text-ui font-semibold text-muted">{group.family ? <Sample kind={FAMILY_LINE[group.family]} /> : null}{group.label}</p>
            )}
            {group.nodes.map((node) => (
              <div key={node.id} className="grid gap-1">
                <Card node={node} />
                {model.edges.filter((edge) => edge.label && edge.source === node.id && edge.family !== "source").map((edge) => (
                  <p key={edge.id} className="flex items-start gap-2 pl-3 text-ui text-muted"><span className="mt-[5px]"><Sample kind={edge.legend} /></span><span className="min-w-0">{edge.label} {labelOf.get(edge.target) ?? ""}</span></p>
                ))}
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

// ---- the map ---------------------------------------------------------------------------------------------------------------
export interface ConceptMapProps {
  courseId: string;
  scope: string;
  scopeKind: GraphScopeKind;
  /** The selected node; null draws the opening view. */
  selected: string | null;
  /** Select a node of the scope (null clears the selection). */
  onSelect: (nodeId: string | null) => void;
  /** A node drawn although it lies outside the scope was pressed: the scope has to widen to show it. */
  onSelectOutside?: (nodeId: string) => void;
  /** The name of the scope in the caption: the course, the lecture, "This slide". */
  scopeName: string;
  /** The identity line of the page of a slide scope, in the contract's words (the graph's own label is used without it). */
  slideLabel?: string | null;
  place?: TreePlace | null;
  /** Shown in place of the drawing when the scope holds nothing (a structural page, a page nothing names). */
  empty?: ReactNode;
  /** The stale notice, as the first element. */
  notice?: ReactNode;
}

function useSize<T extends HTMLElement>(): [(node: T | null) => void, MapPane] {
  const [size, setSize] = useState<MapPane>({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    const read = () => setSize((current) => (current.width === node.clientWidth && current.height === node.clientHeight ? current : { width: node.clientWidth, height: node.clientHeight }));
    read();
    if (typeof ResizeObserver !== "undefined") {
      observer.current = new ResizeObserver(read);
      observer.current.observe(node);
    }
  }, []);
  return [ref, size];
}

const SCOPE_NOUN: Record<GraphScopeKind, string> = { course: "course", lecture: "lecture", slide: "slide" };
const DRAWN: Record<MapModel["view"], string> = { topics: "", overview: "Drawn: the concepts and skills this slide supports.", focus: "Drawn: what surrounds the selected row." };

export function ConceptMap({ courseId, scope, scopeKind, selected, onSelect, onSelectOutside, scopeName, slideLabel, place = null, empty, notice }: ConceptMapProps) {
  const base = useScopeGraph(courseId, scope);
  const focused = useFocusGraph(courseId, scope, selected);
  const query = selected ? focused : base;
  const graph: ConceptGraphView | undefined = query.data;

  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [openedQuestion, setOpenedQuestion] = useState<string | null | undefined>(undefined);
  const [showUnfiled, setShowUnfiled] = useState(false);
  useEffect(() => {
    setOpened(new Set());
    setOpenedQuestion(undefined);
  }, [courseId, scope, selected]);

  const model = useMemo(() => {
    if (!graph) return null;
    const built = buildMapModel(graph, { opened, openedQuestion, showUnfiled });
    // The slide is named in the contract's words when the lecture view is in hand.
    return slideLabel ? { ...built, nodes: built.nodes.map((node) => (node.type === "marker" ? { ...node, second: slideLabel } : node)) } : built;
  }, [graph, opened, openedQuestion, showUnfiled, slideLabel]);

  const [paneRef, pane] = useSize<HTMLDivElement>();
  const oneColumn = pane.width > 0 && pane.width < ONE_COLUMN_BELOW;
  const [flow, setFlow] = useState<FlowHandle | null>(null);

  const actions = useMemo<MapActions>(() => ({
    select: (node) => {
      if (node.type === "marker" || node.type === "fold") return;
      if (!node.inScope && onSelectOutside) onSelectOutside(node.id);
      else onSelect(node.id);
    },
    openFold: (id) => setOpened((current) => new Set(current).add(id)),
    openCriteria: (questionId) => setOpenedQuestion(questionId),
    toggleUnfiled: () => setShowUnfiled((shown) => !shown),
    hover: () => undefined,
    focused: () => undefined,
    place,
  }), [onSelect, onSelectOutside, place]);

  const totals = base.data?.totals ?? graph?.totals;
  const topicCount = model?.view === "topics" ? model.nodes.filter((node) => node.type === "topic-card").length : 0;
  const errorCode = query.isError ? conceptGraphErrorCode(query.error) : null;
  const zoom = flow?.zoom ?? 1;

  return (
    <section aria-label="Concept map" className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="concept-map" data-view={model?.view ?? "none"}>
      {notice}
      {model && model.nodes.length > 0 && (
        model.view === "topics"
          ? <p className="ll-measure flex-none pb-3 text-read text-muted" data-testid="map-caption">{countLabel(topicCount, "topic")} in this {SCOPE_NOUN[scopeKind]}. Open a topic to draw its concepts. Nothing below a topic is drawn until you ask.</p>
          : totals && (
            <p className="flex-none pb-2 text-ui text-muted" data-testid="map-caption">
              <b className="text-ink">{scopeName}</b> holds {countLabel(totals.concept, "concept")}, {countLabel(totals.skill, "skill")} and {countLabel(totals.question, "question")}. {DRAWN[model.view]}
            </p>
          )
      )}
      <div ref={paneRef} className="relative flex min-h-0 flex-1 flex-col">
        {query.isLoading || (selected && base.isLoading) ? (
          <div role="status" className="flex flex-wrap justify-center gap-10 pt-8">
            <span className="sr-only">Drawing the map…</span>
            {[0, 1, 2].map((index) => <Skeleton key={index} width={172} height={64} className="rounded-control" />)}
          </div>
        ) : query.isError ? (
          <div role="alert" className="grid max-w-[68ch] justify-items-start gap-1 pt-4">
            <p className="ll-err"><ErrorGlyph /><span>{errorCode === "unknown_focus" ? "This item is not in the catalog" : "The map could not be drawn"}</span></p>
            <p className="text-ui text-muted">{query.error?.message} The outline keeps working.</p>
            {errorCode === "unknown_focus" ? <Button size="sm" className="mt-2" onClick={() => onSelect(null)}>Clear the selection</Button> : <Button size="sm" className="mt-2" onClick={() => void query.refetch()}>Try again</Button>}
          </div>
        ) : !model || model.nodes.length === 0 ? (
          <div className="pt-2">{empty ?? <p className="ll-measure text-read text-muted">Nothing is drawn for this scope.</p>}</div>
        ) : oneColumn ? (
          <ActionsContext.Provider value={actions}><Column model={model} /></ActionsContext.Provider>
        ) : pane.width > 0 ? (
          <div className="absolute inset-0"><ActionsContext.Provider value={actions}><ReactFlowProvider><Flow model={model} pane={pane} onReady={setFlow} /></ReactFlowProvider></ActionsContext.Provider></div>
        ) : null}
      </div>
      {model && model.total > model.shown && (
        <p className="flex-none pt-2 text-ui text-muted" data-testid="map-truncated">Showing {model.shown} of {countLabel(model.total, "node")} of this scope. Open a topic to see its part.</p>
      )}
      {model && model.nodes.length > 0 && (
      <div className="mt-2 flex min-h-11 flex-none flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline py-1 text-ui text-muted" data-testid="map-key">
        <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-0.5" aria-label="Key to the lines">
          {(model?.legend ?? []).map((kind) => <span key={kind} className="inline-flex items-center gap-2 whitespace-nowrap" title={EDGE_LEGEND[kind].meaning} data-legend={kind}><Sample kind={kind} />{EDGE_LEGEND[kind].label}</span>)}
          {model?.outOfScope && <span className="inline-flex items-center gap-2 whitespace-nowrap"><i aria-hidden className="h-3 w-[22px] rounded-[3px] outline-dashed outline-[1.5px] -outline-offset-[1.5px] outline-line" />Outside this scope</span>}
        </p>
        {!oneColumn && model && model.nodes.length > 0 && (
          <div role="group" aria-label="Zoom" className="flex flex-none items-center gap-0.5">
            <IconButton size="sm" label={zoom <= MAP_ZOOM.min ? "Zoom out. The map does not go below 100 %" : "Zoom out"} disabled={!flow || zoom <= MAP_ZOOM.min} onClick={() => flow?.zoomTo(zoom - MAP_ZOOM.step)}><Minus aria-hidden /></IconButton>
            <span className="ll-num min-w-[3.25rem] text-center" data-testid="map-zoom">{Math.round(zoom * 100)} %</span>
            <IconButton size="sm" label="Zoom in" disabled={!flow || zoom >= MAP_ZOOM.max} onClick={() => flow?.zoomTo(zoom + MAP_ZOOM.step)}><Plus aria-hidden /></IconButton>
            <IconButton size="sm" label={selected ? "Centre the selected node" : "Back to the start of the map"} disabled={!flow} onClick={() => flow?.centre()}><LocateFixed aria-hidden /></IconButton>
          </div>
        )}
      </div>
      )}
    </section>
  );
}
