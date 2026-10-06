// Where keyboard focus goes when the page under it changes. Two cases, both ending with focus on the body unless
// somebody acts: the address moved to another page (the link that was pressed is gone), and a re-render replaced the
// control that was focused (a node of a drawing that was selected). The rules are here (web/tests/lib/route-focus.test.ts);
// the shell runs them (app/Shell.tsx, useRouteFocus).

const OVERLAY = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]';
const OUT_OF_PLAY = "[hidden],[inert]";
const FOCUSABLE = 'button,a[href],input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';

/** An attribute selector for any value (jsdom has no CSS.escape; an id or a node id may hold dots and quotes). */
const attribute = (name: string, value: string): string => `[${name}="${value.replace(/[\\"]/g, "\\$&")}"]`;

/** The page's first heading, made focusable without joining the tab order; the main area when it has none in play (a workspace, a page still loading). */
export function pageHeading(main: HTMLElement): HTMLElement {
  const heading = Array.from(main.querySelectorAll<HTMLElement>("h1")).find((candidate) => !candidate.closest(OUT_OF_PLAY));
  if (!heading) return main;
  if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
  return heading;
}

/** Nothing holds focus: the control that had it left the page. */
export function focusIsLost(doc: Document = document): boolean {
  const active = doc.activeElement;
  return !active || active === doc.body || active === doc.documentElement || !active.isConnected;
}

/** Inside a dialog, a menu or a list of options, wherever it is drawn: those manage focus themselves and give it back when they close. */
export function inOverlay(element: Element | null | undefined): boolean {
  return !!element?.closest(OVERLAY);
}

/**
 * One step after the address changed to another page. Focus ends on the page's heading (the main area until there is
 * one), so the next Tab starts in the new page and not at the top of the window.
 *   "kept"     the page, or the learner, already put focus inside it: nothing is taken away. The same holds for
 *              `path`, the page's own name in the header: a picker there that was just used to choose the page keeps focus
 *   "waiting"  an overlay still holds focus, or the page has no heading yet: ask again
 *   "moved"    focus is now on the heading
 */
export function settleRouteFocus(main: HTMLElement, doc: Document = document, path: Element | null = null): "kept" | "waiting" | "moved" {
  const active = doc.activeElement;
  if (inOverlay(active)) return "waiting";
  if (active && active !== main && (main.contains(active) || path?.contains(active))) return "kept";
  const target = pageHeading(main);
  if (active !== target) target.focus({ preventScroll: true });
  return target === main ? "waiting" : "moved";
}

/** What identifies a focused control beyond its own element, so it can be found again after a re-render replaced it. */
export interface FocusMemo {
  element: Element;
  id: string | null;
  /** The node of a drawing it belongs to (`data-id`, as @xyflow/react writes it on each node). */
  nodeId: string | null;
  /** Its place among the controls of that node. */
  index: number;
}

const controlsOf = (node: Element): HTMLElement[] => [...(node.matches(FOCUSABLE) ? [node as HTMLElement] : []), ...Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE))];

export function rememberFocus(element: Element): FocusMemo {
  const node = element.closest("[data-id]");
  return { element, id: element.id || null, nodeId: node?.getAttribute("data-id") ?? null, index: node ? Math.max(0, controlsOf(node).indexOf(element as HTMLElement)) : 0 };
}

/** The control that took the place of a remembered one: the same id, or the same control of the same node. null when nothing identifies it or it is not in play. */
export function findAgain(root: ParentNode, memo: FocusMemo): HTMLElement | null {
  let found: HTMLElement | null = null;
  if (memo.id) found = root.querySelector<HTMLElement>(attribute("id", memo.id));
  if (!found && memo.nodeId) {
    const node = root.querySelector(attribute("data-id", memo.nodeId));
    const controls = node ? controlsOf(node) : [];
    found = controls[memo.index] ?? controls[0] ?? null;
  }
  return found && !found.closest(OUT_OF_PLAY) ? found : null;
}
