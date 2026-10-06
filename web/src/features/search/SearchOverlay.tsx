// SC17 Search (UI04): current course by default, "All my courses" only when chosen. Opening a hit
// keeps the study context: drafts are pinned to their own source, and "Return" restores the origin.
import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { useQueries } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { courseName, useApp } from "@/app/state";
import { Callout, Dialog, Segmented, StatusChip } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { hitHref, searchIndexes, TYPE_LABEL } from "@/lib/search";
import type { SearchIndex } from "@/lib/types";

export function SearchOverlay() {
  const app = useApp();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"course" | "all">("course");
  const courseIds = useMemo(() => {
    const bound = (app.workspace?.courses ?? []).filter((c) => c.binding === "bound").map((c) => c.course_id);
    return scope === "all" ? bound : bound.filter((c) => c === app.courseId);
  }, [app.workspace, app.courseId, scope]);
  const indexes = useQueries({
    queries: courseIds.map((courseId) => ({ queryKey: ["search-index", courseId], queryFn: () => apiGet<SearchIndex>(`courses/${courseId}/search-index`), enabled: app.searchOpen, staleTime: 30_000, retry: false })),
  });
  const loaded = indexes.map((q) => q.data).filter((d): d is SearchIndex => !!d);
  const failed = indexes.filter((q) => q.isError).length;
  const results = useMemo(() => searchIndexes(loaded, query), [loaded, query]);
  const unindexed = loaded.flatMap((index) => index.unindexed.map((u) => ({ ...u, course: index.display_name })));
  const close = () => app.setSearchOpen(false);

  return (
    <Dialog open={app.searchOpen} onOpenChange={app.setSearchOpen} title="Search" description="Searches slide text, transcripts, questions, concepts and source names. Answer keys are never searched." wide>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[14rem] flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input autoFocus type="search" className="ll-input pl-9" placeholder="Term or question…" aria-label="Search query" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <Segmented label="Search scope" value={scope} onChange={setScope} options={[{ value: "course", label: courseName(app.workspace, app.courseId) }, { value: "all", label: "All my courses" }]} />
        </div>
        {failed > 0 && <Callout tone="caution" title="Some indexes could not be read">{failed} course index(es) are unavailable right now; results may be incomplete.</Callout>}
        {query.trim().length < 2 ? (
          <p className="text-muted">Type at least two characters. Scope: <strong>{scope === "course" ? courseName(app.workspace, app.courseId) : "all bound courses"}</strong>.</p>
        ) : results.hits.length === 0 ? (
          <Callout tone="unassessed" title="No matches in the indexed material">
            <p>Nothing indexed contains every word you typed. Try fewer words{scope === "course" ? " or search all your courses" : ""}.</p>
            {unindexed.length > 0 && (
              <div className="mt-2">
                <p className="font-medium text-ink">Not searchable yet ({unindexed.length}) — this is a preparation gap, not an empty source:</p>
                <ul className="list-disc pl-5">
                  {unindexed.slice(0, 6).map((u) => <li key={u.course + u.what}>{u.what}: {u.reason}</li>)}
                </ul>
              </div>
            )}
          </Callout>
        ) : (
          <>
            <p className="text-sm text-muted" role="status">
              Showing {results.hits.length} of {results.total} match{results.total === 1 ? "" : "es"}{results.truncated ? " (bounded — refine the query to narrow it)" : ""}.
            </p>
            <ul className="flex flex-col gap-1" aria-label="Search results">
              {results.hits.map((hit, i) => (
                <li key={`${hit.courseId}-${hit.entry.type}-${i}`}>
                  <Link to={hitHref(hit)} state={{ returnTo: location.pathname + location.search, returnLabel: "Return to where you were" }} onClick={close}
                    className="ll-card flex flex-col gap-1 p-3 hover:bg-pad">
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusChip tone="accent">{TYPE_LABEL[hit.entry.type]}</StatusChip>
                      <span className="font-medium">{hit.entry.title}</span>
                      {scope === "all" && <span className="text-sm text-muted">· {hit.courseName}</span>}
                    </span>
                    <span className="text-sm text-muted">{hit.snippet}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Dialog>
  );
}

/** "Return to slide" link shown on pages reached from search or a related-material jump. */
export function ReturnLink() {
  const location = useLocation();
  const state = location.state as { returnTo?: string; returnLabel?: string } | null;
  if (!state?.returnTo) return null;
  return <Link to={state.returnTo} className="ll-btn ll-btn-sm mb-3">← {state.returnLabel ?? "Return"}</Link>;
}
