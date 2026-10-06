// The context panel (design specification 5.7): five text tabs in the band, in the fixed order
// Tutor · Questions · Concepts · Transcript · Sources, none ever moved into a menu, and one region under them that
// scrolls inside itself. The Questions tab carries the count of its first list as a muted figure (left out when it is
// zero, which is also what a structural page gives). Below 1180 px the band is the frame's pane switch instead, the
// region loses its rounded box and the content keeps a 640 px measure.
//
// Which tab is shown first is decided where the address is read (./contracts `resolveTab`, ./workspace-state): the tab
// the address names, else the one last used on this device (`ll.lecture.tab`), else Questions.
//
// Tab contents stay mounted once shown (Tutor from the start), and the panel's structure is the same in every
// arrangement, so a draft, a list position and what was typed survive a tab change, a pane change and a resize.
//
// The panel gives each tab a bounded column and does not scroll itself: a tab scrolls inside itself, so it can dock
// something at its foot (the tutor's composer). `TabScroll` is the scrolling body of a tab; content that runs past an
// edge fades there instead of being cut through a line. `TabFoot` is the docked part: written anywhere inside a
// `TabScroll`, it is drawn under the scrolling body and does not move as the body grows.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BAND_CLASS, TextTabs, restoreZoneScroll, useWorkspaceFrame } from "@/app/WorkspaceFrame";
import { cn } from "@/components/ui";
import { CONTEXT_TABS } from "@/lib/labels";
import { isContextTab, type ContextPanelProps, type ContextTabId } from "./contracts";

/** Test ids the browser suite has always found a tab's content under. The tutor's covers its thread and its docked composer. */
const TAB_TEST_ID: Partial<Record<ContextTabId, string>> = { tutor: "tutor-panel" };

export function ContextPanel({ tab, onTabChange, counts, tabs, returnTo }: ContextPanelProps) {
  const { arrangement } = useWorkspaceFrame();
  const framed = arrangement === "frame";
  const root = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState<ReadonlySet<ContextTabId>>(() => new Set<ContextTabId>(["tutor", tab]));
  useEffect(() => {
    setSeen((current) => (current.has(tab) ? current : new Set([...current, tab])));
  }, [tab]);
  // A tab that was hidden gets its scroll position back.
  useLayoutEffect(() => restoreZoneScroll(root.current), [tab]);

  return (
    <div ref={root} className="flex min-h-0 flex-1 flex-col" data-return={returnTo} data-testid="context-panel">
      {framed && (
        <div className={cn(BAND_CLASS, "items-stretch pl-[calc(var(--ll-panel-pad,16px)-10px)] pr-3")}>
          <TextTabs label="Context panel" idPrefix="ll-ctx-tab-" value={tab} onChange={(id) => isContextTab(id) && onTabChange(id)}
            tabs={CONTEXT_TABS.map((entry) => ({ id: entry.id, label: entry.label, count: counts?.[entry.id] || undefined, controls: `ll-ctx-${entry.id}` }))} />
        </div>
      )}
      <div className={cn("flex min-h-0 flex-1 flex-col", framed && "ll-region my-3 overflow-hidden")}>
        {CONTEXT_TABS.map((entry) => {
          const active = entry.id === tab;
          return (
            <div key={entry.id} id={`ll-ctx-${entry.id}`} role={framed ? "tabpanel" : undefined} aria-labelledby={framed ? `ll-ctx-tab-${entry.id}` : undefined} hidden={!active} inert={!active}
              data-tab={entry.id} data-testid={TAB_TEST_ID[entry.id]} className={cn("min-h-0 min-w-0 flex-1 flex-col overflow-hidden", active && "flex")}>
              {seen.has(entry.id) || active ? tabs[entry.id] : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- the scrolling body of a tab and its docked foot -------------------------------------------------------------------
/** The foot slot of the enclosing `TabScroll`; null until it is in the page. */
const TabScrollContext = createContext<{ foot: HTMLElement | null } | null>(null);

type Fade = "none" | "top" | "bottom" | "both";
// 32 px at the top once scrolled, 40 px at the foot while more follows (5.7).
const FADE_MASK: Record<Fade, string | undefined> = {
  none: undefined,
  top: "linear-gradient(to bottom, transparent, #000 32px)",
  bottom: "linear-gradient(to bottom, #000 calc(100% - 40px), transparent)",
  both: "linear-gradient(to bottom, transparent, #000 32px, #000 calc(100% - 40px), transparent)",
};

/**
 * The scrolling body of a tab: the panel's padding, a 640 px measure when the tab is a pane, and its own scroll, with
 * a fade where content runs past an edge. Inside another `TabScroll` it adds nothing (the outer one scrolls), so a tab
 * may be written with its own `TabScroll` and still be wrapped in one.
 */
export function TabScroll({ children, className }: { children: ReactNode; className?: string }) {
  const outer = useContext(TabScrollContext);
  const { arrangement } = useWorkspaceFrame();
  const [foot, setFoot] = useState<HTMLElement | null>(null);
  const [fade, setFade] = useState<Fade>("none");
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);

  const measure = useCallback(() => {
    const node = scroller.current;
    if (!node) return;
    const above = node.scrollTop > 1;
    const below = node.scrollHeight - node.clientHeight - node.scrollTop > 1;
    setFade(above && below ? "both" : above ? "top" : below ? "bottom" : "none");
  }, []);
  useEffect(() => {
    if (outer) return;
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (scroller.current) observer.observe(scroller.current);
    if (body.current) observer.observe(body.current);
    return () => observer.disconnect();
  }, [outer, measure]);

  if (outer) return <>{children}</>;
  const mask = FADE_MASK[fade];
  return (
    <TabScrollContext.Provider value={{ foot }}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div ref={scroller} onScroll={measure} data-tab-scroll="" data-fade={fade} style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-[var(--ll-panel-pad,16px)] [scrollbar-width:thin]">
          <div ref={body} className={cn("flex min-h-full w-full flex-col", arrangement !== "frame" && "mx-auto max-w-[640px]", className)}>{children}</div>
        </div>
        <div ref={setFoot} className="flex-none" data-tab-foot="" />
      </div>
    </TabScrollContext.Provider>
  );
}

/**
 * Docked at the foot of a tab, under its scrolling body; it does not move as the body grows. Inside a `TabScroll` it
 * is drawn in that tab's foot (after the body, so the reading and focus order is body, then foot); alone it is drawn
 * where it is written.
 */
export function TabFoot({ children, className }: { children: ReactNode; className?: string }) {
  const scroll = useContext(TabScrollContext);
  const { arrangement } = useWorkspaceFrame();
  const foot = (
    <div className="flex-none border-t border-hairline bg-surface px-[var(--ll-panel-pad,16px)] pb-[var(--ll-panel-pad,16px)] pt-3">
      <div className={cn("w-full", arrangement !== "frame" && "mx-auto max-w-[640px]", className)}>{children}</div>
    </div>
  );
  if (!scroll) return foot;
  return scroll.foot ? createPortal(foot, scroll.foot) : null;
}
