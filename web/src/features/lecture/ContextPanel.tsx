// The context panel (design specification 5.7), FIRST VERSION of its frame: five text tabs in the band, in the fixed order
// Tutor · Questions · Concepts · Transcript · Sources, none ever moved into a menu, and one region under them that
// scrolls inside itself. Below 1180 px the band is the frame's pane switch instead, the region loses its rounded box and
// the content keeps a 640 px measure.
//
// Tab contents stay mounted once shown (Tutor from the start), and the panel's structure is the same in every
// arrangement, so a draft, a list position and what was typed survive a tab change, a pane change and a resize.
//
// The panel gives each tab a bounded column and does not scroll itself: a tab scrolls inside itself, so it can dock
// something at its foot (the tutor's composer). `TabScroll` is the ordinary scrolling body of a tab, `TabFoot` the
// docked part under it.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { BAND_CLASS, TextTabs, restoreZoneScroll, useWorkspaceFrame } from "@/app/WorkspaceFrame";
import { cn } from "@/components/ui";
import { CONTEXT_TABS } from "@/lib/labels";
import { isContextTab, type ContextPanelProps, type ContextTabId } from "./contracts";

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
              data-tab={entry.id} className={cn("min-h-0 min-w-0 flex-1 flex-col overflow-hidden", active && "flex")}>
              {seen.has(entry.id) || active ? tabs[entry.id] : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The scrolling body of a tab: the panel's padding, a 640 px measure when the tab is a pane, and its own scroll. */
export function TabScroll({ children, className }: { children: ReactNode; className?: string }) {
  const { arrangement } = useWorkspaceFrame();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-[var(--ll-panel-pad,16px)] [scrollbar-width:thin]">
      <div className={cn("flex min-h-full w-full flex-col", arrangement !== "frame" && "mx-auto max-w-[640px]", className)}>{children}</div>
    </div>
  );
}
/** Docked at the foot of a tab, under its scrolling body; it does not move as the body grows. */
export function TabFoot({ children, className }: { children: ReactNode; className?: string }) {
  const { arrangement } = useWorkspaceFrame();
  return (
    <div className="flex-none border-t border-hairline bg-surface px-[var(--ll-panel-pad,16px)] pb-[var(--ll-panel-pad,16px)] pt-3">
      <div className={cn("w-full", arrangement !== "frame" && "mx-auto max-w-[640px]", className)}>{children}</div>
    </div>
  );
}
