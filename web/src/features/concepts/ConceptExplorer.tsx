// The concept map as a destination of its own (design specification 7.1, 7.6), FIRST VERSION: the route
// `courses/:courseId/concepts` with the scope switch Course / Lecture / This slide and the way back to the lecture; the
// body is still the existing concept outline (features/concepts/ConceptOutline), which reads the same `scope` parameter.
// The next version puts tree, map and detail on app/WorkspaceFrame.
//
// `courses/:courseId/outline` (the earlier address) keeps working: it redirects here with its parameters.
import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router";
import { ArrowLeft } from "lucide-react";
import { Segmented } from "@/components/ui";
import { CONCEPT_SCOPE_LABEL } from "@/lib/labels";
import { ConceptOutlinePage } from "./ConceptOutline";

type ScopeKind = "course" | "lecture" | "slide";

/** `course`, `lecture:<id>` or `slide:<lecture>:<page>`; anything else is the course. */
export function parseScope(scope: string | null): { kind: ScopeKind; lectureId: string | null; page: number | null } {
  const [kind, lectureId, page] = (scope ?? "").split(":");
  if (kind === "lecture" && lectureId) return { kind: "lecture", lectureId, page: null };
  if (kind === "slide" && lectureId && Number(page) >= 1) return { kind: "slide", lectureId, page: Number(page) };
  return { kind: "course", lectureId: null, page: null };
}

export function ConceptExplorer() {
  const { courseId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const scope = parseScope(params.get("scope"));
  // The lecture and the page the learner came with stay offered while the scope is widened.
  const [origin, setOrigin] = useState<{ lectureId: string | null; page: number | null }>({ lectureId: scope.lectureId, page: scope.page });
  useEffect(() => {
    setOrigin((current) => ({ lectureId: scope.lectureId ?? current.lectureId, page: scope.page ?? (scope.lectureId && scope.lectureId !== current.lectureId ? null : current.page) }));
  }, [scope.lectureId, scope.page]);

  const state = location.state as { returnTo?: string; returnLabel?: string } | null;
  const lectureId = scope.lectureId ?? origin.lectureId;
  const page = scope.page ?? origin.page;
  const back = state?.returnTo ?? (lectureId ? `/courses/${courseId}/lectures/${lectureId}${page ? `?page=${page}` : ""}` : `/courses/${courseId}`);
  const backLabel = state?.returnLabel ?? (lectureId ? (page ? `Back to page ${page}` : "Back to the lecture") : "Back to the course");

  const setScope = (kind: ScopeKind) => {
    const value = kind === "slide" && lectureId && page ? `slide:${lectureId}:${page}` : kind !== "course" && lectureId ? `lecture:${lectureId}` : "course";
    setParams(value === "course" ? {} : { scope: value }, { replace: true, state: location.state });
  };
  const options: Array<{ value: ScopeKind; label: string }> = [
    { value: "course", label: CONCEPT_SCOPE_LABEL.course },
    ...(lectureId ? [{ value: "lecture" as const, label: CONCEPT_SCOPE_LABEL.lecture }] : []),
    ...(lectureId && page ? [{ value: "slide" as const, label: CONCEPT_SCOPE_LABEL.slide }] : []),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="concept-explorer">
      <div className="flex flex-none flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline bg-surface px-4 py-2 min-[900px]:px-6">
        <Link to={back} className="ll-tbtn -ml-3"><ArrowLeft aria-hidden /><span>{backLabel}</span></Link>
        <h1 className="text-head font-semibold">Concept map</h1>
        <span className="flex-1" />
        {options.length > 1 && <Segmented label="Scope of the concept map" value={scope.kind} onChange={setScope} options={options} />}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 min-[900px]:p-6">
        <ConceptOutlinePage />
      </div>
    </div>
  );
}

/** The earlier address of the concept outline, kept as a way in. */
export function ConceptOutlineRedirect() {
  const { courseId = "" } = useParams();
  const location = useLocation();
  return <Navigate to={{ pathname: `/courses/${courseId}/concepts`, search: location.search }} state={location.state} replace />;
}
