// Application shell (design specification 4.2): the header (mark and name, the "Sample data" label of a profile that is
// not the learner's own courses, the path with its pickers, the tools of the screen, the ONE search button, the
// appearance control), the rail with its six destinations, and under 900 px the section bar on Study only. Workspace
// routes (a lecture, the concept map) fill the window; every other page scrolls inside the main area.
// The only standing line the shell shows is "this page is older than the app now being served"; alerts appear for
// errors that block work (the Brain is unreachable, local save failed).
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { DropdownMenu, RadioGroup } from "radix-ui";
import { Activity, ArrowLeft, BookOpen, ChartNoAxesColumn, ChevronDown, ChevronRight, Ellipsis, GraduationCap, Library, ListChecks, Monitor, Moon, Network, Search, Settings, Sun } from "lucide-react";
import { BuildIdentity, OlderPageLine } from "@/components/BuildIdentity";
import { Callout, chooseInSegmented, chooseWithArrows, cn, IconButton, StatusChip } from "@/components/ui";
import { conceptMapEntry, parseCourseRoute } from "@/lib/course-route";
import { R2_ACTION } from "@/lib/labels";
import { useActivity, useCourse } from "@/lib/queries";
import { findAgain, focusIsLost, rememberFocus, settleRouteFocus, type FocusMemo } from "@/lib/route-focus";
import type { ThemePref } from "@/lib/theme";
import { courseName, useApp } from "./state";
import { SearchOverlay } from "@/features/search/SearchOverlay";

type Icon = typeof BookOpen;
interface Destination { to: string; label: string; icon: Icon }
/** "Library" is the course-wide sources page: the lecture panel has a Sources tab with a narrower meaning. */
const SECTIONS: Destination[] = [
  { to: "/study", label: "Study", icon: BookOpen },
  { to: "/review", label: "Review", icon: ListChecks },
  { to: "/progress", label: "Progress", icon: ChartNoAxesColumn },
  { to: "/sources", label: "Library", icon: Library },
];
const UTILITIES: Destination[] = [
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/settings", label: "Settings", icon: Settings },
];
const THEMES: Array<{ value: ThemePref; label: string; icon: Icon }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

const OPEN_STATES = new Set(["READY", "CLAIMED", "RUNNING", "STAGED", "COMMIT_PENDING", "WAITING_SYNC", "WAITING_USER", "WAITING_REVIEW", "AUTH_REQUIRED", "QUOTA_WAIT", "UNCERTAIN_COMPLETION", "FAILED_RETRYABLE"]);
/** Top-level pages whose content follows the active course: the header offers the course as a picker there. */
const COURSE_SCOPED = /^[/](review|progress|sources|history|activity)(?:[/]|$)/;
const COURSE_PAGE: Record<string, string> = { questions: "Question bank", sources: "Source", concepts: "Concept", outline: "Concept map" };

/** Under 900 px, and whenever the learner has enlarged text: no rail, no appearance control in the header; one menu holds them. */
function useCompactShell(): boolean {
  const read = () => typeof window !== "undefined" && ((typeof window.matchMedia === "function" && !window.matchMedia("(min-width: 900px)").matches) || document.documentElement.getAttribute("data-text-scale") === "large");
  const [compact, setCompact] = useState(read);
  useEffect(() => {
    const update = () => setCompact(read());
    update();
    const query = typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 900px)") : null;
    query?.addEventListener("change", update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-text-scale"] });
    return () => {
      query?.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);
  return compact;
}

/** For this long after the address changed to another page, focus that lands outside the page is brought to its heading (a closing overlay hands focus back to its button a moment later). */
const ROUTE_FOCUS_WINDOW_MS = 1500;
/** For this long a control that a re-render removed is looked for again (a drawing that is fetched anew takes a moment). */
const REFOCUS_WINDOW_MS = 3000;

/**
 * Keyboard focus follows the page (lib/route-focus.ts). Returns the refs of the main area and of the header's path.
 *  - The address changed to another page: focus goes to that page's heading (the main area until it has one), so the
 *    next Tab starts in the page and not at the top of the window. Not on the first load, and never against the
 *    learner: any key or pointer press ends it, and focus the page itself placed is left alone, as is focus on the
 *    page's own name in the path (the lecture picker that was just used).
 *  - A re-render replaced the focused control (a node of the concept map that was just selected): focus goes to the
 *    control that took its place. A control nothing identifies, or one that is gone for good, is left alone.
 */
function useRouteFocus(pathname: string): { mainRef: RefObject<HTMLElement | null>; pathRef: RefObject<HTMLElement | null> } {
  const mainRef = useRef<HTMLElement>(null);
  const pathRef = useRef<HTMLElement>(null);
  const memo = useRef<FocusMemo | null>(null);
  const previous = useRef(pathname);

  useEffect(() => {
    const from = previous.current;
    previous.current = pathname;
    const main = mainRef.current;
    // "/" only redirects (to Study or to pairing): arriving from it is the first load, which starts at the top as any page does.
    if (from === pathname || from === "/" || !main) return;
    memo.current = null;
    let over = false;
    let busy = false;
    const step = () => {
      if (over || busy) return;
      busy = true;
      try {
        settleRouteFocus(main, document, pathRef.current);
      } finally {
        busy = false;
      }
    };
    const end = () => {
      over = true;
      window.removeEventListener("keydown", end, true);
      window.removeEventListener("pointerdown", end, true);
      document.removeEventListener("focusin", step, true);
      timers.forEach((timer) => window.clearTimeout(timer));
      window.cancelAnimationFrame(frame);
    };
    const frame = window.requestAnimationFrame(step);
    const timers = [120, 400, 900].map((ms) => window.setTimeout(step, ms));
    timers.push(window.setTimeout(() => { step(); end(); }, ROUTE_FOCUS_WINDOW_MS));
    window.addEventListener("keydown", end, true);
    window.addEventListener("pointerdown", end, true);
    document.addEventListener("focusin", step, true);
    return end;
  }, [pathname]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main || typeof MutationObserver === "undefined") return;
    let lostAt = 0;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      memo.current = target instanceof Element && target !== main && main.contains(target) ? rememberFocus(target) : null;
      lostAt = 0;
    };
    // A press while nothing holds focus is the learner going somewhere else: nothing is brought back after it.
    const onPress = (event: Event) => {
      if (event.type === "pointerdown" || focusIsLost()) memo.current = null;
    };
    const check = () => {
      const held = memo.current;
      if (!held || held.element.isConnected || !focusIsLost()) return;
      const now = performance.now();
      if (!lostAt) lostAt = now;
      if (now - lostAt > REFOCUS_WINDOW_MS) {
        memo.current = null;
        return;
      }
      findAgain(main, held)?.focus({ preventScroll: true });
    };
    const observer = new MutationObserver(check);
    observer.observe(main, { childList: true, subtree: true });
    document.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("keydown", onPress, true);
    window.addEventListener("pointerdown", onPress, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("keydown", onPress, true);
      window.removeEventListener("pointerdown", onPress, true);
    };
  }, []);

  return { mainRef, pathRef };
}

const inStudy = (pathname: string): boolean => pathname.startsWith("/study") || pathname.startsWith("/courses");

/** Study is also where a course and a lecture live. */
const isCurrent = (to: string, pathname: string): boolean => (to === "/study" ? inStudy(pathname) : pathname === to || pathname.startsWith(`${to}/`));

function RailItem({ to, label, icon: IconGlyph, badge, current }: Destination & { badge?: number; current: boolean }) {
  return (
    <Link to={to} aria-current={current ? "page" : undefined}
      className={cn("relative grid h-[60px] w-[calc(var(--ll-rail-w)-16px)] flex-none content-center justify-items-center gap-1 rounded-region text-micro text-ink transition-colors duration-[var(--ll-motion-small)] hover:bg-pad",
        current && "bg-tint font-semibold text-accent-text hover:bg-tint-strong before:absolute before:-left-2 before:bottom-2.5 before:top-2.5 before:w-[3px] before:rounded-r-[3px] before:bg-accent-text before:content-['']")}>
      <IconGlyph aria-hidden className="size-6" strokeWidth={1.6} />
      <span className="max-w-full px-0.5 text-center">{label}</span>
      {badge ? <span className="ll-num absolute right-1.5 top-1 min-w-5 rounded-full bg-accent px-1 text-center text-micro font-semibold text-on-accent" aria-label={`${badge} open`}>{badge}</span> : null}
    </Link>
  );
}

function BarItem({ to, label, icon: IconGlyph, current }: Destination & { current: boolean }) {
  return (
    <Link to={to} aria-current={current ? "page" : undefined}
      className={cn("relative grid h-14 min-w-0 flex-1 content-center justify-items-center gap-0.5 px-1.5 text-micro text-ink",
        current && "font-semibold text-accent-text before:absolute before:inset-x-2 before:top-0 before:h-[3px] before:rounded-b-[3px] before:bg-accent-text before:content-['']")}>
      <IconGlyph aria-hidden className="size-[22px]" strokeWidth={1.6} />
      <span className="max-w-full text-center">{label}</span>
    </Link>
  );
}

const MENU = "ll-pop z-50 max-h-[min(70dvh,32rem)] min-w-[14rem] max-w-[min(92vw,26rem)] overflow-y-auto p-1";
const MENU_LABEL = "px-3 pb-1 pt-2 text-ui text-muted";
/** The page you are on, in the path. Two lines at most fit the header; under 900 px it is set at reading size. */
const PATH_HERE = "inline-flex min-w-0 items-center gap-1.5 rounded-row px-2 py-0.5 text-head font-semibold max-[899px]:px-1 max-[899px]:text-read max-[899px]:leading-5";

/** A picker in the header path: the current item as a button, the others as a list of radio items. */
function PathPicker({ name, label, value, options, onChoose, chevron = true }: { name: string; label: string; value: string | undefined;
  options: Array<{ value: string; label: string; disabled?: boolean }>; onChoose: (value: string) => void; chevron?: boolean }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className={cn(PATH_HERE, "border-0 bg-transparent text-left text-ink transition-colors duration-[var(--ll-motion-small)] hover:bg-pad")} aria-label={`${name}: ${label}`}>
        <span className="line-clamp-2 min-w-0">{label}</span>
        {chevron && <ChevronDown aria-hidden className="size-4 flex-none text-muted" />}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="center" sideOffset={6} className={MENU}>
          <DropdownMenu.RadioGroup value={value} onValueChange={onChoose} aria-label={name}>
            {options.map((option) => (
              <DropdownMenu.RadioItem key={option.value} value={option.value} disabled={option.disabled} className="ll-menu-item">{option.label}</DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function Shell() {
  const app = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const compact = useCompactShell();
  const activity = useActivity(true);
  const open = (activity.data?.jobs ?? []).filter((j) => j.request_id && OPEN_STATES.has(j.state)).length;
  const focusMode = new URLSearchParams(location.search).get("focus") === "1";

  const { pathname } = location;
  const route = parseCourseRoute(pathname);
  const routeCourse = route?.courseId;
  const lectureId = route?.lectureId ?? undefined;
  const conceptMap = route?.conceptMap ?? false;
  // A lecture and the concept map fill the window; every other page scrolls inside the main area.
  const workspace = route?.workspace ?? false;
  const { mainRef, pathRef } = useRouteFocus(pathname);
  const onStudy = pathname.startsWith("/study");

  // The page you are on decides the active course: opened by link, address bar, reload or Back alike. Search scope,
  // Review, Progress and Library then all refer to the course on screen.
  const { workspace: workspaceView, courseId: activeCourse, setCourseId } = app;
  useEffect(() => {
    if (routeCourse && routeCourse !== activeCourse && workspaceView?.courses.some((c) => c.course_id === routeCourse)) setCourseId(routeCourse);
  }, [routeCourse, activeCourse, workspaceView, setCourseId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if ((event.key === "k" && (event.ctrlKey || event.metaKey)) || (event.key === "/" && !typing)) {
        event.preventDefault();
        app.setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app]);

  const course = useCourse(lectureId ? routeCourse : undefined);
  const lectures = course.data?.lectures ?? [];
  const lectureTitle = lectures.find((l) => l.lecture_id === lectureId)?.title ?? (lectureId ? "Lecture" : "");
  const courses = workspaceView?.courses ?? [];
  const courseOptions = courses.map((c) => ({ value: c.course_id, label: `${c.display_name}${c.binding !== "bound" ? " (binding problem)" : ""}`, disabled: c.binding !== "bound" }));
  const here = routeCourse ? courseName(workspaceView, routeCourse) : "";
  const searchLabel = workspaceView ? `Search ${courseName(workspaceView, app.courseId)}` : "Search";
  // Under 900 px every page below a course (a lecture, the concept map, the question bank, a question, a source, a
  // concept) has the back arrow to the course where the product name stands on a wide window (4.2): the title then has
  // room for its two lines and the Concept map tool fits beside the menu.
  const back = routeCourse && route?.section ? `/courses/${routeCourse}` : null;
  // "Concept map" is in the header of every page of a course (UI contract R2, Concepts): the lecture's scope from a lecture, the course's elsewhere.
  const mapEntry = conceptMapEntry(pathname, location.search);

  // ---- the path: where you are ---------------------------------------------------------------------------------------------
  const courseLink = routeCourse ? <Link to={`/courses/${routeCourse}`} className="whitespace-nowrap rounded-row px-2 py-1 text-ui text-muted transition-colors duration-[var(--ll-motion-small)] hover:bg-pad hover:text-ink max-[1179px]:hidden">{here}</Link> : null;
  const divider = <ChevronRight aria-hidden className="size-4 flex-none text-muted max-[1179px]:hidden" />;
  let path: ReactNode = null;
  if (lectureId && routeCourse) {
    path = (
      <>
        {courseLink}{divider}
        {lectures.length > 1
          ? <PathPicker name="Lecture" label={lectureTitle} value={lectureId} chevron={!compact} options={lectures.map((l) => ({ value: l.lecture_id, label: l.title }))}
              onChoose={(id) => id !== lectureId && navigate(`/courses/${routeCourse}/lectures/${id}`)} />
          : <span className={PATH_HERE} aria-current="page"><span className="line-clamp-2 min-w-0">{lectureTitle}</span></span>}
      </>
    );
  } else if (routeCourse && route?.section) {
    path = <>{courseLink}{divider}<span className={PATH_HERE} aria-current="page"><span className="line-clamp-2 min-w-0">{conceptMap ? R2_ACTION.concept_map : COURSE_PAGE[route.section] ?? here}</span></span></>;
  } else if (routeCourse) {
    path = courses.length > 1 ? <PathPicker name="Course" label={here} value={routeCourse} chevron={!compact} options={courseOptions} onChoose={(id) => id !== routeCourse && navigate(`/courses/${id}`)} />
      : <span className={PATH_HERE} aria-current="page">{here}</span>;
  } else if (COURSE_SCOPED.test(pathname) && courses.length > 0 && !compact) {
    path = <PathPicker name="Active course" label={courseName(workspaceView, app.courseId)} value={app.courseId} options={courseOptions} onChoose={(id) => app.setCourseId(id)} />;
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-bg text-ink" data-shell={workspace ? "workspace" : "page"} onKeyDownCapture={chooseInSegmented}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-row focus:bg-raised focus:p-2">Skip to content</a>
      {!focusMode && (
        <header className={cn("z-30 grid min-h-[var(--ll-hdr-h)] flex-none items-center border-b border-hairline bg-surface",
          "grid-cols-[auto_minmax(0,1fr)_auto]", compact ? "gap-1 pl-2 pr-1" : "gap-6 pl-6 pr-3")}>
          <div className="flex min-w-0 items-center gap-1">
            {compact && back
              ? <Link to={back} aria-label={`Back to ${here}`} title={`Back to ${here}`} className="ll-ib"><ArrowLeft aria-hidden /></Link>
              : (
                <Link to="/study" className="flex flex-none items-center gap-3 whitespace-nowrap text-head font-semibold">
                  <GraduationCap aria-hidden className="size-7 text-accent-text" />
                  <span>Lecture Learning</span>
                </Link>
              )}
            {workspaceView?.fixture_label && !(compact && back) && <span className="ml-3 whitespace-nowrap text-meta text-muted" title={workspaceView.fixture_label} data-testid="fixture-banner">Sample data</span>}
          </div>
          <nav ref={pathRef} aria-label="Where you are" className={cn("flex min-w-0 items-center gap-1", compact ? "justify-start" : "justify-center")}>{path}</nav>
          <div className={cn("flex items-center justify-self-end", compact ? "gap-0" : "gap-2")}>
            {mapEntry && !compact && (
              <Link to={mapEntry.href} state={mapEntry.state} className="ll-tbtn" data-testid="header-concept-map"><Network aria-hidden /><span>{R2_ACTION.concept_map}</span></Link>
            )}
            {mapEntry && compact && back && (
              <Link to={mapEntry.href} state={mapEntry.state} className="ll-ib" aria-label={R2_ACTION.concept_map} title={R2_ACTION.concept_map} data-testid="header-concept-map"><Network aria-hidden /></Link>
            )}
            {!compact && <IconButton label={searchLabel} onClick={() => app.setSearchOpen(true)} aria-keyshortcuts="Control+K /"><Search aria-hidden /></IconButton>}
            {!compact && (
              <RadioGroup.Root value={app.theme} onValueChange={(value) => app.setTheme(value as ThemePref)} aria-label="Appearance" orientation="horizontal" className="flex gap-1" onKeyDownCapture={chooseWithArrows}>
                {THEMES.map(({ value, label, icon: IconGlyph }) => (
                  <RadioGroup.Item key={value} value={value} aria-label={label} title={label}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-control border-0 bg-transparent px-3 text-ui text-ink transition-colors duration-[var(--ll-motion-small)] hover:bg-pad data-[state=checked]:bg-tint data-[state=checked]:font-semibold data-[state=checked]:text-accent-text data-[state=checked]:shadow-[inset_0_0_0_1px_var(--ll-accent-text)] max-[1439px]:w-9 max-[1439px]:px-0">
                    <IconGlyph aria-hidden className="size-[18px]" />
                    <span className="max-[1439px]:hidden">{label}</span>
                  </RadioGroup.Item>
                ))}
              </RadioGroup.Root>
            )}
            {compact && (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger className="ll-ib" aria-label="Menu: search, appearance, sections" title="Menu"><Ellipsis aria-hidden /></DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content align="end" sideOffset={6} className={MENU}>
                    {/* Search opens once the menu has closed and focus is back on its button: the query field then takes focus, and closing the dialog returns it to the Menu button and not to nothing. */}
                    <DropdownMenu.Item className="ll-menu-item" onSelect={() => window.setTimeout(() => app.setSearchOpen(true), 80)}><Search aria-hidden className="size-[18px]" />{searchLabel}</DropdownMenu.Item>
                    {mapEntry && <DropdownMenu.Item asChild className="ll-menu-item"><Link to={mapEntry.href} state={mapEntry.state}><Network aria-hidden className="size-[18px]" />{R2_ACTION.concept_map}</Link></DropdownMenu.Item>}
                    <DropdownMenu.Separator className="my-1 h-px bg-hairline" />
                    <DropdownMenu.Label className={MENU_LABEL}>Appearance</DropdownMenu.Label>
                    <DropdownMenu.RadioGroup value={app.theme} onValueChange={(value) => app.setTheme(value as ThemePref)} aria-label="Appearance">
                      {THEMES.map(({ value, label, icon: IconGlyph }) => (
                        <DropdownMenu.RadioItem key={value} value={value} className="ll-menu-item" onSelect={(event) => event.preventDefault()}><IconGlyph aria-hidden className="size-[18px]" />{label}</DropdownMenu.RadioItem>
                      ))}
                    </DropdownMenu.RadioGroup>
                    {courses.length > 1 && !routeCourse && (
                      <>
                        <DropdownMenu.Separator className="my-1 h-px bg-hairline" />
                        <DropdownMenu.Label className={MENU_LABEL}>Active course</DropdownMenu.Label>
                        <DropdownMenu.RadioGroup value={app.courseId} onValueChange={(id) => app.setCourseId(id)} aria-label="Active course">
                          {courseOptions.map((option) => <DropdownMenu.RadioItem key={option.value} value={option.value} disabled={option.disabled} className="ll-menu-item">{option.label}</DropdownMenu.RadioItem>)}
                        </DropdownMenu.RadioGroup>
                      </>
                    )}
                    <DropdownMenu.Separator className="my-1 h-px bg-hairline" />
                    <DropdownMenu.Label className={MENU_LABEL}>Sections</DropdownMenu.Label>
                    {[...SECTIONS, ...UTILITIES].map(({ to, label, icon: IconGlyph }) => (
                      <DropdownMenu.Item key={to} asChild className="ll-menu-item">
                        <Link to={to} aria-current={isCurrent(to, pathname) ? "page" : undefined}><IconGlyph aria-hidden className="size-[18px]" />{label}{to === "/activity" && open ? <span className="ll-num ml-auto text-muted">{open} open</span> : null}</Link>
                      </DropdownMenu.Item>
                    ))}
                    <DropdownMenu.Separator className="my-1 h-px bg-hairline" />
                    <BuildIdentity variant="shell" layout="line" className="px-3 py-1.5" />
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            )}
          </div>
        </header>
      )}
      {!focusMode && <OlderPageLine className="flex-none border-b border-hairline" />}
      {!focusMode && (app.workspaceError || app.storageIssue) && (
        <div className="flex flex-none flex-col gap-2 px-4 pt-3" data-testid="connection-banner">
          {app.workspaceError && <Callout tone="danger" role="alert" title="The Brain on this PC is not reachable">{app.workspaceError.message} Pages already open stay readable; drafts stay on this device.</Callout>}
          {app.storageIssue && <Callout tone="caution" role="alert" title="Local save failed">This browser cannot store drafts right now ({app.storageIssue}). What you type is kept only while this page stays open — copy anything important.</Callout>}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {!focusMode && !compact && (
          <nav aria-label="Main" className="flex w-[var(--ll-rail-w)] flex-none flex-col items-center gap-1 overflow-y-auto border-r border-hairline bg-surface pb-3 pt-2 [scrollbar-width:none]">
            {SECTIONS.map((item) => <RailItem key={item.to} {...item} current={isCurrent(item.to, pathname)} />)}
            <span className="min-h-2 flex-1" aria-hidden />
            <RailItem {...UTILITIES[0]!} badge={open} current={isCurrent("/activity", pathname)} />
            <RailItem {...UTILITIES[1]!} current={isCurrent("/settings", pathname)} />
            <BuildIdentity variant="shell" className="mt-1 px-1" />
          </nav>
        )}
        <main id="main" ref={mainRef} tabIndex={-1} className={cn("min-h-0 min-w-0 flex-1 outline-none", workspace ? "overflow-hidden" : "overflow-y-auto p-4 min-[900px]:p-6")}>
          <Outlet />
        </main>
      </div>
      {!focusMode && compact && onStudy && (
        <nav aria-label="Main (compact)" className="flex flex-none justify-between border-t border-hairline bg-surface px-0.5 pb-[env(safe-area-inset-bottom)]">
          {SECTIONS.map((item) => <BarItem key={item.to} {...item} current={isCurrent(item.to, pathname)} />)}
          <BarItem {...UTILITIES[1]!} current={false} />
        </nav>
      )}
      <div aria-live="polite" role="status" className="sr-only" data-testid="announcer">{app.announcement}</div>
      <SearchOverlay />
    </div>
  );
}

/** Kept for the tutor panel until its composer says the same in a sentence beside Send (design specification 5.8, 10). */
export function NativeChip() {
  const { workspace } = useApp();
  const native = workspace?.capabilities.native;
  if (!native) return null;
  if (native.status === "verified") return <StatusChip tone="success">Native tutor connected</StatusChip>;
  if (native.status === "pilot") return <StatusChip tone="caution" title={native.detail}>{native.label}</StatusChip>;
  if (native.status === "fixture_double") return <StatusChip tone="unassessed" title={native.detail}>Fixture tutor (test double)</StatusChip>;
  return <StatusChip tone="caution" title={native.detail}>Native connection not verified</StatusChip>;
}
