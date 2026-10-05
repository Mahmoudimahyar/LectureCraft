// Source-first application shell: four destinations (Study, Review, Progress, Sources) plus the
// Activity and Settings utilities, a course-aware header with scoped search, and the Light/Dark/System
// control. On narrow screens the navigation moves to a bottom bar; the same actions stay available.
import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { Activity, BarChart3, BookOpen, FileText, GraduationCap, ListChecks, Monitor, Moon, Search, Settings, Sun } from "lucide-react";
import { Callout, cn, Segmented, StatusChip } from "@/components/ui";
import { useActivity } from "@/lib/queries";
import type { ThemePref } from "@/lib/theme";
import { courseName, useApp } from "./state";
import { SearchOverlay } from "@/features/search/SearchOverlay";

const DESTINATIONS = [
  { to: "/study", label: "Study", icon: BookOpen },
  { to: "/review", label: "Review", icon: ListChecks },
  { to: "/progress", label: "Progress", icon: BarChart3 },
  { to: "/sources", label: "Sources", icon: FileText },
] as const;

const OPEN_STATES = new Set(["READY", "CLAIMED", "RUNNING", "STAGED", "COMMIT_PENDING", "WAITING_SYNC", "WAITING_USER", "WAITING_REVIEW", "AUTH_REQUIRED", "QUOTA_WAIT", "UNCERTAIN_COMPLETION", "FAILED_RETRYABLE"]);

function NavItem({ to, label, icon: Icon, badge, compact }: { to: string; label: string; icon: typeof BookOpen; badge?: number; compact?: boolean }) {
  return (
    <NavLink to={to} className={({ isActive }) => cn("relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-[var(--ll-radius)] text-sm font-medium text-muted", compact ? "min-w-0 px-0.5" : "min-w-[72px] px-1",
      isActive && "bg-raised font-semibold text-accent")}>
      <Icon aria-hidden className="size-6" />
      <span className="max-w-full truncate">{label}</span>
      {badge ? <span className="absolute right-1 top-1 min-w-5 rounded-full bg-accent px-1 text-center text-[11px] font-bold text-on-accent" aria-label={`${badge} open`}>{badge}</span> : null}
    </NavLink>
  );
}

export function Shell() {
  const app = useApp();
  const location = useLocation();
  const activity = useActivity(true);
  const open = (activity.data?.jobs ?? []).filter((j) => j.request_id && OPEN_STATES.has(j.state)).length;
  const focusMode = new URLSearchParams(location.search).get("focus") === "1";
  // A lecture page fills the window on wide screens (slide and transport both in view); every other page scrolls normally.
  const fill = /^[/]courses[/][^/]+[/]lectures[/]/.test(location.pathname);

  // The page you are on decides the active course: opened by link, address bar, reload or Back alike. Search scope,
  // Review, Progress and Sources then all refer to the course on screen.
  const routeCourse = /^[/]courses[/]([^/]+)/.exec(location.pathname)?.[1];
  const { workspace, courseId: activeCourse, setCourseId } = app;
  useEffect(() => {
    if (routeCourse && routeCourse !== activeCourse && workspace?.courses.some((c) => c.course_id === routeCourse)) setCourseId(routeCourse);
  }, [routeCourse, activeCourse, workspace, setCourseId]);

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

  const native = app.workspace?.capabilities.native;
  const themeOptions: Array<{ value: ThemePref; label: string; icon: React.ReactNode }> = [
    { value: "light", label: "Light", icon: <Sun aria-hidden className="size-4" /> },
    { value: "dark", label: "Dark", icon: <Moon aria-hidden className="size-4" /> },
    { value: "system", label: "System", icon: <Monitor aria-hidden className="size-4" /> },
  ];

  return (
    <div className="ll-shell-fill flex flex-col bg-bg text-ink" data-fill={fill ? "true" : "false"}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2">Skip to content</a>
      {!focusMode && (
        <header className="top-0 z-30 flex flex-wrap items-center gap-3 border-b border-line/40 bg-surface px-4 py-2 md:sticky wide:flex-nowrap">
          <Link to="/study" className="flex shrink-0 items-center gap-2 text-lg font-bold">
            <GraduationCap aria-hidden className="size-7 text-accent" />
            <span>Lecture Learning</span>
          </Link>
          <label className="flex min-w-0 max-w-full items-center gap-2 text-sm md:ml-2">
            <span className="sr-only">Active course</span>
            <select className="ll-input min-h-[40px] w-auto max-w-[min(16rem,100%)] py-1" value={app.courseId ?? ""} onChange={(e) => app.setCourseId(e.target.value)} aria-label="Active course">
              {!app.workspace && <option value="">{app.workspaceError ? "Courses unavailable" : "Loading courses…"}</option>}
              {(app.workspace?.courses ?? []).map((course) => (
                <option key={course.course_id} value={course.course_id} disabled={course.binding !== "bound"}>
                  {course.display_name}{course.binding !== "bound" ? " (binding problem)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => app.setSearchOpen(true)} className="ll-btn ll-btn-sm ml-auto min-w-0 max-w-full gap-2 text-muted wide:max-w-[30rem] wide:shrink" aria-keyshortcuts="Control+K /">
            <Search aria-hidden className="size-4 shrink-0" />
            <span className="truncate">{app.workspace ? `Search ${courseName(app.workspace, app.courseId)}` : "Search"}</span>
            <kbd className="hidden shrink-0 rounded border border-line/50 px-1 text-xs sm:inline">Ctrl K</kbd>
          </button>
          <Segmented label="Appearance" value={app.theme} onChange={(value) => app.setTheme(value)} options={themeOptions} className="shrink-0 max-md:hidden" />
        </header>
      )}
      {!focusMode && app.workspace?.fixture_label && (
        <div className="border-b border-line/40 bg-raised px-4 py-1 text-center text-sm font-medium text-muted" data-testid="fixture-banner">{app.workspace.fixture_label}</div>
      )}
      {!focusMode && (app.workspaceError || app.storageIssue || (native && native.status === "not_verified")) && (
        <div data-testid="connection-banner">
          {(app.workspaceError || app.storageIssue) && (
            <div className="space-y-2 px-4 pt-3">
              {app.workspaceError && <Callout tone="danger" role="alert" title="The Brain on this PC is not reachable">{app.workspaceError.message} Pages already open stay readable; drafts stay on this device.</Callout>}
              {app.storageIssue && <Callout tone="caution" role="alert" title="Local save failed">This browser cannot store drafts right now ({app.storageIssue}). What you type is kept only while this page stays open — copy anything important.</Callout>}
            </div>
          )}
          {/* One slim status line (not a banner on every page): the tutor is not connected; reading, searching and drafting work. */}
          {native && native.status === "not_verified" && !app.workspaceError && !fill && (
            <p className="flex flex-wrap items-center justify-center gap-x-2 border-b border-line/40 bg-raised px-4 py-1 text-center text-sm" title={native.detail}>
              <strong className="font-semibold text-caution">Native connection not verified</strong>
              <span className="text-muted">Reading, searching and drafting work; questions you send are kept and wait.</span>
              <Link className="text-accent underline" to="/settings/ai">Setup details</Link>
            </p>
          )}
        </div>
      )}
      <div className="ll-shell-body flex min-h-0 flex-1">
        {!focusMode && (
          <nav aria-label="Main" className="sticky top-[57px] hidden max-h-[calc(100dvh-57px)] w-[88px] shrink-0 flex-col items-center gap-1 self-start overflow-y-auto py-3 md:flex">
            {DESTINATIONS.map((item) => <NavItem key={item.to} {...item} />)}
            <div className="mt-2 flex flex-col items-center gap-1 border-t border-line/40 pt-2">
              <NavItem to="/activity" label="Activity" icon={Activity} badge={open} />
              <NavItem to="/settings" label="Settings" icon={Settings} />
            </div>
          </nav>
        )}
        <main id="main" tabIndex={-1} className={cn("ll-main min-w-0 flex-1 outline-none", focusMode ? "p-2" : "p-4 md:pb-6")}>
          <Outlet />
        </main>
      </div>
      {!focusMode && (
        <nav aria-label="Main (compact)" className="ll-bottom-nav fixed inset-x-0 bottom-0 z-30 grid border-t border-line/40 bg-surface px-1 py-1 md:hidden">
          {DESTINATIONS.map((item) => <NavItem key={item.to} {...item} compact />)}
          <NavItem to="/activity" label="Activity" icon={Activity} badge={open} compact />
          <NavItem to="/settings" label="Settings" icon={Settings} compact />
        </nav>
      )}
      <div aria-live="polite" role="status" className="sr-only" data-testid="announcer">{app.announcement}</div>
      <SearchOverlay />
    </div>
  );
}

export function NativeChip() {
  const { workspace } = useApp();
  const native = workspace?.capabilities.native;
  if (!native) return null;
  if (native.status === "verified") return <StatusChip tone="success">Native tutor connected</StatusChip>;
  if (native.status === "pilot") return <StatusChip tone="caution" title={native.detail}>{native.label}</StatusChip>;
  if (native.status === "fixture_double") return <StatusChip tone="unassessed" title={native.detail}>Fixture tutor (test double)</StatusChip>;
  return <StatusChip tone="caution" title={native.detail}>Native connection not verified</StatusChip>;
}
