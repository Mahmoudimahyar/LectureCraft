// The three-zone frame shared by the lecture workspace and the concept explorer (design specification 4.3, 4.4).
//
// From 1180 px: outline · stage · context panel as ONE react-resizable-panels Group (no hand-built splitter). Below
// 1180 px, with enlarged text, and in focus mode: ONE focused zone at a time, chosen from the pane switch.
//
// What never remounts. The three zones are rendered ONCE, through portals, into three DOM nodes this component creates
// and keeps. An arrangement only decides where those nodes sit: inside the panels of the Group, or inside the panes.
// Crossing 1180 px, changing pane, tab, theme or outline state and resizing a panel therefore never unmounts the slide,
// the media element or the composer, never clears a draft and never stops playback (R2-V9). A node is moved with
// Element.moveBefore where the browser has it (state-preserving) and is parked, never detached, between two slots.
// `mediaHost` is one more node that no arrangement ever moves: the place for the bare media element once the transport
// is split from its bar.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Group, Panel, Separator, useGroupRef, usePanelRef, type Layout, type LayoutChangedMeta, type PanelSize } from "react-resizable-panels";
import { clsx } from "clsx";

// ---- pure layout rules (web/tests/lib/frame.test.ts) ---------------------------------------------------------------------
/** The three-zone frame starts here; below it one focused pane. A px media query on purpose: a rem query would ignore the text-size setting. */
export const FRAME_MIN_WIDTH = 1180;
/** Each of the two separators is a 12 px track. The library's percentages are shares of the panels alone (the Group less both tracks). */
export const SEPARATOR_PX = 12;
/** The frame's right padding. */
export const FRAME_GUTTER_PX = 12;
/** The stage's `minSize`, as a share of the panels. 41 % of the panels is at least 40 % of the Group for every Group of 984 px or more, and the smallest frame is 1092 px (R2-V3). */
export const STAGE_MIN_PERCENT = 41;

export type FrameKind = "lecture" | "concepts";
export type FrameZone = "outline" | "stage" | "context";
export type FrameArrangement = "frame" | "panes" | "focus";
export type FrameLayout = Record<FrameZone, number>;

export interface FrameSpec {
  groupId: string;
  storageKey: string;
  /** Pixel bounds of the outline, and the window width from which it starts open when nothing is stored. */
  outline: { min: number; max: number; openFrom: number };
  context: { min: number; max: number };
}
export const FRAME_SPECS: Record<FrameKind, FrameSpec> = {
  lecture: { groupId: "ll-frame-lecture", storageKey: "ll.frame.lecture", outline: { min: 184, max: 320, openFrom: 1680 }, context: { min: 396, max: 820 } },
  concepts: { groupId: "ll-frame-concepts", storageKey: "ll.frame.concepts", outline: { min: 280, max: 480, openFrom: 1440 }, context: { min: 396, max: 820 } },
};

const clamp = (low: number, value: number, high: number): number => Math.min(Math.max(value, low), high);

/** Rail of the shell: none under 900 px, 76 px, 84 px from 1920 (4.2). */
export const railWidth = (windowWidth: number): number => (windowWidth < 900 ? 0 : windowWidth < 1920 ? 76 : 84);
/** The width the Group gets in a window: the window less the rail and the right gutter. */
export const frameGroupWidth = (windowWidth: number): number => Math.max(0, windowWidth - railWidth(windowWidth) - FRAME_GUTTER_PX);

export function outlineDefaultPx(kind: FrameKind, windowWidth: number): number {
  if (kind === "concepts") return windowWidth >= 2400 ? 440 : clamp(280, Math.round(0.22 * windowWidth), 400);
  return clamp(184, Math.round(0.1 * windowWidth + 48), 288);
}
export const contextDefaultPx = (windowWidth: number): number => clamp(396, Math.round(0.362 * windowWidth - 112), 720);
/**
 * The narrowest the context panel can be made in a window. The lecture's five tabs are set in the `ui` size, which steps
 * up at 1920 and 2400 px (3.2): with one count they need a row of 378, 395 and 414 px, and the panel's sides take 18 px
 * below 1920 and 26 px from there. The specification's 396 px holds them only at the smallest size, so the bound steps
 * with the type and the tab row never has to scroll (R2-V3). The concept explorer's three tabs fit 396 px at every size.
 */
export const contextMinPx = (kind: FrameKind, windowWidth: number): number => (kind !== "lecture" || windowWidth < 1920 ? FRAME_SPECS[kind].context.min : windowWidth < 2400 ? 422 : 442);

export function frameArrangement({ width, largeText = false, focus = false }: { width: number; largeText?: boolean; focus?: boolean }): FrameArrangement {
  if (focus) return "focus";
  return width >= FRAME_MIN_WIDTH && !largeText ? "frame" : "panes";
}

const panelArea = (groupWidth: number): number => Math.max(1, groupWidth - 2 * SEPARATOR_PX);

/**
 * The layout of a window nobody has arranged yet: panel id → percent of the panels, summing to 100. The outline is
 * collapsed (0) below the workspace's opening width and open from it, whatever the deck's shape. Widths come from the
 * window; the shares from the Group's measured width when one is given.
 */
export function firstRunLayout(kind: FrameKind, windowWidth: number, groupWidth: number = frameGroupWidth(windowWidth)): FrameLayout {
  const area = panelArea(groupWidth);
  const share = (px: number): number => (px / area) * 100;
  const outline = windowWidth >= FRAME_SPECS[kind].outline.openFrom ? share(outlineDefaultPx(kind, windowWidth)) : 0;
  const context = share(contextDefaultPx(windowWidth));
  return { outline, stage: 100 - outline - context, context };
}

/** A layout in whole pixels for a Group of the given width (the stage takes what is left, so the three and both separators sum to the Group). */
export function layoutPixels(layout: FrameLayout, groupWidth: number): FrameLayout {
  const area = panelArea(groupWidth);
  const outline = Math.round((layout.outline * area) / 100);
  const context = Math.round((layout.context * area) / 100);
  return { outline, stage: area - outline - context, context };
}

/**
 * The bounds the Group enforces together, in pixels, for a Group of the given width: the stage never under its share,
 * the context panel never wider than 820 px or than what leaves the stage that share, an open outline squeezed first.
 */
export function frameBounds(kind: FrameKind, groupWidth: number): { stageMinPx: number; outline: { minPx: number; maxPx: number }; context: { minPx: number; maxPx: number } } {
  const spec = FRAME_SPECS[kind];
  const area = panelArea(groupWidth);
  const stageMinPx = Math.ceil((area * STAGE_MIN_PERCENT) / 100);
  return {
    stageMinPx,
    outline: { minPx: spec.outline.min, maxPx: Math.min(spec.outline.max, Math.max(0, area - stageMinPx - spec.context.min)) },
    context: { minPx: spec.context.min, maxPx: Math.min(spec.context.max, Math.max(0, area - stageMinPx)) },
  };
}

/** A layout this frame stored earlier, or null for anything else (nothing stored, another shape, shares that do not sum to 100). */
export function parseStoredLayout(text: string | null | undefined): FrameLayout | null {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.length !== 3 || keys[0] !== "context" || keys[1] !== "outline" || keys[2] !== "stage") return null;
    const { outline, stage, context } = record;
    if (![outline, stage, context].every((share) => typeof share === "number" && Number.isFinite(share) && share >= 0 && share <= 100)) return null;
    if (Math.abs((outline as number) + (stage as number) + (context as number) - 100) > 0.5) return null;
    return { outline: outline as number, stage: stage as number, context: context as number };
  } catch {
    return null;
  }
}

/** What a separator announces beside its percentage. */
export function separatorValueText(zone: "outline" | "context", pixels: number): string {
  const px = Math.round(pixels);
  if (zone === "outline") return px <= 0 ? "Outline closed" : `Outline ${px} pixels wide`;
  return `Context panel ${px} pixels wide`;
}

/** Width of the one block the slide and the transport bar form: min(stage width, (stage height − bar height − 8 px) × page aspect) (5.4). An unknown page shape counts as 4:3. */
export function stageBlockWidth({ stageWidth, stageHeight, barHeight, aspect }: { stageWidth: number; stageHeight: number; barHeight: number; aspect: number | null | undefined }): number {
  const shape = aspect && Number.isFinite(aspect) && aspect > 0 ? aspect : 4 / 3;
  return Math.max(0, Math.floor(Math.min(stageWidth, (stageHeight - barHeight - 8) * shape)));
}

// ---- storage (per device; may be unavailable) ----------------------------------------------------------------------------
function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* a per-device convenience only */
  }
}

// ---- what the zones can ask of the frame ---------------------------------------------------------------------------------
export interface WorkspaceFrameState {
  arrangement: FrameArrangement;
  /** The outline panel is open (three-zone frame only; false in the other arrangements, where the outline is a pane). */
  outlineOpen: boolean;
  /** Collapse or reopen the outline panel. One action; the freed width goes to the stage and the choice is remembered. */
  toggleOutline: () => void;
  /** The focused pane (meaningful in the one-pane arrangement). */
  pane: string;
  showPane: (pane: string) => void;
  /** A node no arrangement ever moves or re-creates: the home of the bare media element. null until the frame has mounted. */
  mediaHost: HTMLElement | null;
  /** The measured width of the Group (the frame less its right gutter); null outside the three-zone frame. */
  groupWidth: number | null;
  /**
   * A layout made for what the stage shows (the lecture's slide, features/lecture `slideFirstWidths`): the widths in
   * pixels of the outline (0: closed) and of the context panel. Applied only while the learner has arranged nothing,
   * that is while no layout is stored for this frame and no separator or outline toggle was used in this window; kept
   * inside the frame's bounds and never stored, so the layout keeps following the window and the deck.
   */
  proposeWidths: (widths: { outline: number; context: number }) => void;
}
const FrameContext = createContext<WorkspaceFrameState | null>(null);
const OUTSIDE: WorkspaceFrameState = { arrangement: "frame", outlineOpen: false, toggleOutline: () => undefined, pane: "", showPane: () => undefined, mediaHost: null, groupWidth: null, proposeWidths: () => undefined };
/** The frame a zone is rendered in. Outside a frame (a story, a unit test) it answers a still three-zone frame. */
export const useWorkspaceFrame = (): WorkspaceFrameState => useContext(FrameContext) ?? OUTSIDE;

/** The band every zone carries at its top (outline head, pager, tabs), and the pane switch: one height, one line. */
export const BAND_CLASS = "flex h-[var(--ll-band-h,48px)] flex-none items-center border-b border-hairline bg-surface";

// ---- stable zone nodes -----------------------------------------------------------------------------------------------------
const scrollMemory = new WeakMap<HTMLElement, Map<Element, { top: number; left: number }>>();

function createHost(zone: FrameZone): HTMLDivElement {
  const node = document.createElement("div");
  node.dataset.llZone = zone;
  node.className = "flex min-h-0 min-w-0 flex-1 flex-col";
  // Remember where each scroller inside the zone stands, so a pane that was hidden or a node that was moved gets it back.
  const memory = new Map<Element, { top: number; left: number }>();
  scrollMemory.set(node, memory);
  node.addEventListener("scroll", (event) => {
    const target = event.target;
    if (target instanceof Element) memory.set(target, { top: target.scrollTop, left: target.scrollLeft });
  }, { capture: true, passive: true });
  return node;
}

/** Put back the scroll positions a zone held before it was hidden or moved (a browser may drop them with the layout box). */
function restoreScroll(host: HTMLElement): void {
  const memory = scrollMemory.get(host);
  if (!memory) return;
  for (const [element, at] of memory) {
    if (!element.isConnected) memory.delete(element);
    else if (element.scrollTop !== at.top || element.scrollLeft !== at.left) element.scrollTo({ top: at.top, left: at.left, behavior: "instant" as ScrollBehavior });
  }
}

/** Put back the scroll positions inside the zone that holds `node` (for content that hides and shows parts of itself, such as tabs). */
export function restoreZoneScroll(node: Element | null | undefined): void {
  const host = node?.closest<HTMLElement>("[data-ll-zone]");
  if (host) restoreScroll(host);
}

type Movable = HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void };
/** Place a zone node in a slot without ever leaving the document: moveBefore keeps playback, focus and scroll where the browser has it. */
function place(parent: HTMLElement, node: HTMLElement): void {
  if (node.parentElement === parent) return;
  const target = parent as Movable;
  if (node.isConnected && parent.isConnected && typeof target.moveBefore === "function") {
    try {
      target.moveBefore(node, null);
      return;
    } catch {
      /* fall through to an ordinary move */
    }
  }
  parent.appendChild(node);
}

interface SlotProps extends HTMLAttributes<HTMLDivElement> {
  host: HTMLDivElement;
  park: RefObject<HTMLDivElement | null>;
  /** Hidden and inert (a pane that is not the focused one, a collapsed outline). The zone stays mounted. */
  off?: boolean;
}
/** Where a zone node sits in the current arrangement. On the way out the node is parked, so it is never detached. */
function Slot({ host, park, off = false, className, ...rest }: SlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const slot = ref.current;
    if (!slot) return;
    place(slot, host);
    restoreScroll(host);
    return () => {
      const parking = park.current;
      if (parking && parking.isConnected && host.parentElement === slot) place(parking, host);
    };
  }, [host, park]);
  useLayoutEffect(() => {
    if (!off) restoreScroll(host);
  }, [off, host]);
  return <div ref={ref} hidden={off} inert={off} className={clsx("min-h-0 min-w-0", !off && "flex", className)} {...rest} />;
}

// ---- pane switch -----------------------------------------------------------------------------------------------------------
export interface FramePane {
  id: string;
  label: string;
  /** A count shown as a muted figure after the label; omitted when undefined or 0. */
  count?: number;
  /** The zone this pane shows. */
  zone: FrameZone;
}

export interface TextTab {
  id: string;
  label: string;
  /** A muted figure after the label; omitted when undefined or 0. */
  count?: number;
  /** The id of the element this tab shows. */
  controls: string;
}
/**
 * A row of text tabs (the tab idiom of 5.7) that is not bound to a panel implementation: the pane switch and the tabs of
 * the context panel are both this. Arrow keys, Home and End move and select. A row wider than its place scrolls sideways
 * inside itself, keeps the chosen tab in view and fades the side that has more over 40 px.
 */
export function TextTabs({ tabs, value, onChange, label, idPrefix, className, tabClassName }: { tabs: readonly TextTab[]; value: string; onChange: (id: string) => void; label: string; idPrefix: string;
  className?: string; tabClassName?: string }) {
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const [more, setMore] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const next = { left: list.scrollLeft > 2, right: list.scrollLeft + list.clientWidth < list.scrollWidth - 2 };
    setMore((current) => (current.left === next.left && current.right === next.right ? current : next));
  }, []);
  useLayoutEffect(() => {
    const list = listRef.current;
    const tab = tabRefs.current.get(value);
    if (list && tab && list.scrollWidth > list.clientWidth) list.scrollLeft = Math.max(0, tab.offsetLeft - (list.clientWidth - tab.offsetWidth) / 2);
    measure();
  }, [value, tabs.length, measure]);
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [measure]);
  const move = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (target === null) return;
    event.preventDefault();
    event.stopPropagation(); // the arrow keys page the slide elsewhere; here they move between tabs
    const next = tabs[(target + tabs.length) % tabs.length]!;
    onChange(next.id);
    tabRefs.current.get(next.id)?.focus();
  };
  const fade = more.left && more.right ? "linear-gradient(to right, transparent, #000 40px, #000 calc(100% - 40px), transparent)"
    : more.right ? "linear-gradient(to right, #000 calc(100% - 40px), transparent)" : more.left ? "linear-gradient(to left, #000 calc(100% - 40px), transparent)" : undefined;
  return (
    <div ref={listRef} role="tablist" aria-label={label} onScroll={measure} className={clsx("ll-tabs min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none]", className)}
      style={fade ? { maskImage: fade, WebkitMaskImage: fade } : undefined}>
      {tabs.map((tab, index) => (
        <button key={tab.id} ref={(node) => { if (node) tabRefs.current.set(tab.id, node); else tabRefs.current.delete(tab.id); }} type="button" role="tab" id={`${idPrefix}${tab.id}`}
          aria-selected={value === tab.id} aria-controls={tab.controls} tabIndex={value === tab.id ? 0 : -1} onClick={() => onChange(tab.id)} onKeyDown={(event) => move(event, index)}
          className={clsx("ll-tab", tabClassName)}>
          <span>{tab.label}</span>
          {tab.count ? <span className="ll-tab-n">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

function PaneSwitch({ panes, value, onChange, label }: { panes: FramePane[]; value: string; onChange: (id: string) => void; label: string }) {
  return (
    <div className={clsx(BAND_CLASS, "items-stretch")} data-testid="pane-switch">
      <TextTabs tabs={panes.map((pane) => ({ id: pane.id, label: pane.label, count: pane.count, controls: `ll-pane-${pane.zone}` }))} value={value} onChange={onChange} label={label} idPrefix="ll-pane-tab-"
        className="px-2" tabClassName="px-3" />
    </div>
  );
}

// ---- the frame -------------------------------------------------------------------------------------------------------------
export interface WorkspaceFrameProps {
  kind: FrameKind;
  /** Each zone carries its own band at its top (BAND_CLASS), so the three bands form one line. */
  outline: ReactNode;
  stage: ReactNode;
  context: ReactNode;
  /** Accessible names of the three zones. */
  labels: Record<FrameZone, string>;
  /** The panes of the one-pane arrangement, in order. */
  panes: FramePane[];
  /** The focused pane. In the three-zone frame it only matters to the caller (which tab is shown). */
  pane: string;
  onPaneChange: (pane: string) => void;
  /** Name of the pane switch. */
  paneSwitchLabel?: string;
  /** Docked at the foot of every pane but the stage's, so the one transport stays reachable (R2-V4). */
  dock?: ReactNode;
  /** Slide and bar only: the stage fills the workspace; the other zones stay mounted and hidden. */
  focus?: boolean;
  /** Rendered once in the node no arrangement moves (the bare media element). */
  media?: ReactNode;
  testId?: string;
}

function useArrangement(focus: boolean): FrameArrangement {
  const read = useCallback((): FrameArrangement => {
    if (typeof window === "undefined") return frameArrangement({ width: FRAME_MIN_WIDTH, focus });
    const wide = typeof window.matchMedia === "function" ? window.matchMedia(`(min-width: ${FRAME_MIN_WIDTH}px)`).matches : window.innerWidth >= FRAME_MIN_WIDTH;
    return frameArrangement({ width: wide ? FRAME_MIN_WIDTH : FRAME_MIN_WIDTH - 1, largeText: document.documentElement.getAttribute("data-text-scale") === "large", focus });
  }, [focus]);
  const [arrangement, setArrangement] = useState(read);
  useEffect(() => {
    const update = () => setArrangement(read());
    update();
    const query = typeof window.matchMedia === "function" ? window.matchMedia(`(min-width: ${FRAME_MIN_WIDTH}px)`) : null;
    query?.addEventListener("change", update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-text-scale"] });
    return () => {
      query?.removeEventListener("change", update);
      observer.disconnect();
    };
  }, [read]);
  return arrangement;
}

const SEPARATOR_CLASS = [
  "relative z-10 w-3 flex-none",
  // its top continues the band, so the outline head, the pager and the tabs read as one line
  "before:absolute before:inset-x-0 before:top-0 before:h-[var(--ll-band-h,48px)] before:border-b before:border-hairline before:bg-surface before:content-['']",
  // the grip: 4 x 40, quiet at rest, accent text while hovered, dragged or focused
  "after:absolute after:left-1 after:top-[calc(50%_+_var(--ll-band-h,48px)_/_2_-_20px)] after:h-10 after:w-1 after:rounded-full after:bg-line after:transition-[background-color,opacity] after:duration-[var(--ll-motion-small)] after:content-['']",
  "data-[separator=hover]:after:bg-accent-text data-[separator=hover]:after:opacity-100 data-[separator=active]:after:bg-accent-text data-[separator=active]:after:opacity-100",
  "focus-visible:after:bg-accent-text focus-visible:after:opacity-100 focus-visible:-outline-offset-2",
].join(" ");

export function WorkspaceFrame({ kind, outline, stage, context, labels, panes, pane, onPaneChange, paneSwitchLabel = "Panes", dock, focus = false, media, testId }: WorkspaceFrameProps) {
  const spec = FRAME_SPECS[kind];
  const arrangement = useArrangement(focus);
  const [hosts] = useState(() => ({ outline: createHost("outline"), stage: createHost("stage"), context: createHost("context") }));
  const park = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const [mediaHost, setMediaHost] = useState<HTMLDivElement | null>(null);

  // ---- three-zone frame: sizes, persistence, the outline toggle ------------------------------------------------------------
  const outlineRef = usePanelRef();
  const groupRef = useGroupRef();
  /** The learner arranged the frame in this window (a separator, the outline toggle). A stored layout says the same of an earlier one. */
  const arranged = useRef(false);
  /** The last widths the stage proposed: applied again once the Group exists (the stage may propose before the Group has mounted). */
  const proposed = useRef<{ outline: number; context: number } | null>(null);
  const [groupWidth, setGroupWidth] = useState<number | null>(null);
  const [sizes, setSizes] = useState<{ outline: number; context: number } | null>(null);
  const lastOpenPx = useRef<number | null>(null);
  const toggled = useRef(false);
  const windowWidth = typeof window === "undefined" ? FRAME_MIN_WIDTH : window.innerWidth;

  // The Group is rendered once the frame's own width is known, so the first-run shares are exact.
  useLayoutEffect(() => {
    if (arrangement !== "frame") {
      setGroupWidth(null);
      setSizes(null);
      return;
    }
    const measured = wrapper.current ? wrapper.current.clientWidth - FRAME_GUTTER_PX : 0;
    setGroupWidth(measured > 0 ? measured : frameGroupWidth(window.innerWidth));
  }, [arrangement]);

  const initialLayout = useMemo<FrameLayout | null>(() => {
    if (arrangement !== "frame" || groupWidth === null) return null;
    return parseStoredLayout(readStored(spec.storageKey)) ?? firstRunLayout(kind, window.innerWidth, groupWidth);
    // Read once per mount of the Group: later changes are the learner's and live in the Group itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrangement, groupWidth === null, kind]);

  // A first-run layout with the outline at 0 must mount it collapsed (the specification's spike, 4.3).
  useLayoutEffect(() => {
    if (!initialLayout || initialLayout.outline > 0) return;
    const panel = outlineRef.current;
    try {
      if (panel && !panel.isCollapsed()) panel.collapse();
    } catch {
      /* the panel registers on its own effect; a layout of 0 is already the collapsed state */
    }
  }, [initialLayout, outlineRef]);

  const onLayoutChanged = useCallback((layout: Layout, meta: LayoutChangedMeta) => {
    // Stored only when the learner changed it (a separator, or the outline toggle, which the library reports as an
    // imperative change): a layout nobody touched keeps following the window's width.
    if (meta.isUserInteraction || toggled.current) {
      arranged.current = true;
      const kept = parseStoredLayout(JSON.stringify(meta.requestedLayout ?? layout)) ?? parseStoredLayout(JSON.stringify(layout));
      if (kept) writeStored(spec.storageKey, JSON.stringify(kept));
    }
    toggled.current = false;
  }, [spec.storageKey]);

  // What the separators announce follows every step of a resize at once: the Group reports the new shares in the same
  // turn as the key or the drag, while a panel's own onResize arrives a frame later (it is measured) and then states
  // the exact pixels. A reader that asks right after an arrow key hears the new width, not the one before it.
  const onLayoutChange = useCallback((layout: Layout) => {
    const width = wrapper.current ? wrapper.current.clientWidth - FRAME_GUTTER_PX : 0;
    if (width <= 0) return;
    const px = layoutPixels({ outline: layout.outline ?? 0, stage: layout.stage ?? 0, context: layout.context ?? 0 }, width);
    setSizes((current) => (current && current.outline === px.outline && current.context === px.context ? current : { outline: px.outline, context: px.context }));
  }, []);

  const onOutlineResize = useCallback((size: PanelSize) => {
    if (size.inPixels > 0) lastOpenPx.current = size.inPixels;
    setSizes((current) => ({ outline: size.inPixels, context: current?.context ?? 0 }));
  }, []);
  const onContextResize = useCallback((size: PanelSize) => setSizes((current) => ({ outline: current?.outline ?? 0, context: size.inPixels })), []);

  const outlineOpen = arrangement === "frame" && (sizes ? sizes.outline > 0 : (initialLayout?.outline ?? 0) > 0);
  const toggleOutline = useCallback(() => {
    const panel = outlineRef.current;
    if (!panel) return;
    toggled.current = true;
    if (panel.isCollapsed()) panel.resize(lastOpenPx.current ?? outlineDefaultPx(kind, window.innerWidth));
    else panel.collapse();
    window.setTimeout(() => { toggled.current = false; }, 0);
  }, [kind, outlineRef]);

  // ---- one focused pane ----------------------------------------------------------------------------------------------------
  const current = panes.find((entry) => entry.id === pane) ?? panes.find((entry) => entry.zone === "stage") ?? panes[0];
  const shownZone: FrameZone = arrangement === "focus" ? "stage" : current?.zone ?? "stage";

  const proposeWidths = useCallback((widths: { outline: number; context: number }) => {
    proposed.current = widths;
    const group = groupRef.current;
    if (!group || arrangement !== "frame" || groupWidth === null) return;
    if (arranged.current || parseStoredLayout(readStored(spec.storageKey))) return; // the learner's own arrangement stands
    const area = panelArea(groupWidth);
    const bounds = frameBounds(kind, groupWidth);
    const context = clamp(Math.max(bounds.context.minPx, contextMinPx(kind, windowWidth)), Math.round(widths.context), bounds.context.maxPx);
    const room = Math.max(0, area - bounds.stageMinPx - context); // an open outline never takes the stage under its share
    const outline = widths.outline > 0 && room >= bounds.outline.minPx ? clamp(bounds.outline.minPx, Math.round(widths.outline), Math.min(bounds.outline.maxPx, room)) : 0;
    const next: FrameLayout = { outline: (outline / area) * 100, stage: ((area - outline - context) / area) * 100, context: (context / area) * 100 };
    const now = layoutPixels({ outline: 0, stage: 0, context: 0, ...group.getLayout() }, groupWidth);
    if (Math.abs(now.outline - outline) <= 1 && Math.abs(now.context - context) <= 1) return;
    group.setLayout(next);
  }, [arrangement, groupRef, groupWidth, kind, spec.storageKey, windowWidth]);
  // A proposal made before the Group was there (the zones are rendered before it) is applied when it is.
  useLayoutEffect(() => {
    if (initialLayout && proposed.current) proposeWidths(proposed.current);
  }, [initialLayout, proposeWidths]);

  const state = useMemo<WorkspaceFrameState>(() => ({ arrangement, outlineOpen, toggleOutline, pane: current?.id ?? pane, showPane: onPaneChange, mediaHost, groupWidth, proposeWidths }),
    [arrangement, outlineOpen, toggleOutline, current?.id, pane, onPaneChange, mediaHost, groupWidth, proposeWidths]);

  return (
    <FrameContext.Provider value={state}>
      <div ref={wrapper} className="flex h-full min-h-0 min-w-0 flex-col bg-bg" data-arrangement={arrangement} data-outline={outlineOpen ? "open" : "closed"} data-testid={testId}>
        {/* Never moved, never re-created. It only holds the media element: the bar named "Recording" carries every control,
            so nothing in here is a Tab stop or a region of its own (Media Chrome makes its controller focusable and
            names it "video player"). Inert does not touch playback. */}
        <div ref={setMediaHost} className="sr-only" inert data-ll-media-host="">{media}</div>
        <div ref={park} hidden inert data-ll-park="" />
        {createPortal(outline, hosts.outline)}
        {createPortal(stage, hosts.stage)}
        {createPortal(context, hosts.context)}

        {arrangement === "frame" ? (
          initialLayout && (
            <div className="ll-frame flex min-h-0 flex-1 pr-3">
              <Group id={spec.groupId} groupRef={groupRef} orientation="horizontal" defaultLayout={initialLayout} onLayoutChange={onLayoutChange} onLayoutChanged={onLayoutChanged} className="min-h-0 flex-1">
                <Panel id="outline" panelRef={outlineRef} collapsible collapsedSize={0} minSize={spec.outline.min} maxSize={spec.outline.max} defaultSize={outlineDefaultPx(kind, windowWidth)}
                  groupResizeBehavior="preserve-pixel-size" onResize={onOutlineResize} className="flex min-h-0 min-w-0" style={{ overflow: "hidden" }}>
                  <Slot host={hosts.outline} park={park} off={!outlineOpen} role="complementary" aria-label={labels.outline}
                    className="flex-1 border-r border-hairline bg-surface" />
                </Panel>
                <Separator id="outline-edge" aria-label="Resize the outline" aria-valuetext={separatorValueText("outline", sizes?.outline ?? 0)}
                  className={clsx(SEPARATOR_CLASS, "after:opacity-0")} />
                <Panel id="stage" minSize={`${STAGE_MIN_PERCENT}%`} className="flex min-h-0 min-w-0" style={{ overflow: "hidden" }}>
                  <Slot host={hosts.stage} park={park} role="region" aria-label={labels.stage} className="flex-1" />
                </Panel>
                <Separator id="panel-edge" aria-label="Resize the context panel" aria-valuetext={separatorValueText("context", sizes?.context ?? 0)}
                  className={clsx(SEPARATOR_CLASS, "after:opacity-55")} />
                <Panel id="context" minSize={contextMinPx(kind, windowWidth)} maxSize={spec.context.max} defaultSize={contextDefaultPx(windowWidth)} groupResizeBehavior="preserve-pixel-size"
                  onResize={onContextResize} className="flex min-h-0 min-w-0" style={{ overflow: "hidden" }}>
                  <Slot host={hosts.context} park={park} role="complementary" aria-label={labels.context} className="flex-1" />
                </Panel>
              </Group>
            </div>
          )
        ) : (
          <>
            {arrangement === "panes" && <PaneSwitch panes={panes} value={current?.id ?? pane} onChange={onPaneChange} label={paneSwitchLabel} />}
            <div className="flex min-h-0 flex-1 flex-col">
              {(["outline", "stage", "context"] as const).map((zone) => (
                <Slot key={zone} host={hosts[zone]} park={park} off={shownZone !== zone} id={`ll-pane-${zone}`} role={arrangement === "panes" ? "tabpanel" : "region"}
                  aria-label={arrangement === "panes" ? undefined : labels[zone]} aria-labelledby={arrangement === "panes" && current ? `ll-pane-tab-${current.id}` : undefined}
                  className={clsx("flex-1", zone !== "stage" && "bg-surface")} />
              ))}
            </div>
            {arrangement === "panes" && dock && shownZone !== "stage" ? <div className="flex-none" data-testid="docked-transport">{dock}</div> : null}
          </>
        )}
      </div>
    </FrameContext.Provider>
  );
}
