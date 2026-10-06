// The Concepts tab of the lecture workspace (design specification 5.10), FIRST VERSION: what the course catalog ties to
// this slide, read through the existing scoped outline (`GET …/outline?scope=slide:<lecture>:<page>`), with the ordinary
// ways into the concept map: this slide, this lecture, the course. Every row opens the map at that scope. The next
// version replaces the list with the tree, topic to skill, and its where-phrases.
//
// On a structural page no concept list is kept: the role is said and the lecture's concepts are offered. Never an empty
// branch, never a warning.
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { KindGlyph } from "@/components/glyphs";
import { Button } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { GRAPH_NODE_KIND_LABEL, R2_ACTION, ROLE_LABEL, countLabel } from "@/lib/labels";
import { identityOf, isStructuralPage } from "@/lib/r2";
import type { OutlineRow, OutlineView } from "@/lib/types";
import type { ConceptsTabProps } from "@/features/lecture/contracts";

export const conceptMapHref = (courseId: string, scope: string): string => `/courses/${courseId}/concepts${scope === "course" ? "" : `?scope=${encodeURIComponent(scope)}`}`;

function rowFacts(row: OutlineRow): string {
  return [typeof row.skills === "number" && row.skills > 0 ? countLabel(row.skills, "skill") : "", typeof row.questions === "number" && row.questions > 0 ? countLabel(row.questions, "question") : ""].filter(Boolean).join(", ");
}

export function ConceptsTab({ courseId, lecture, page, slide, onGoToPage, nextContentPage, returnTo }: ConceptsTabProps) {
  const structural = isStructuralPage(lecture, page);
  const slideScope = `slide:${lecture.lecture_id}:${page}`;
  const lectureScope = `lecture:${lecture.lecture_id}`;
  const identity = identityOf(lecture, page);
  const back = { returnTo, returnLabel: `Back to page ${page}` };
  // The same key and address as the concept outline uses, so the two share what was read.
  const outline = useQuery<OutlineView, Error>({
    queryKey: ["outline", courseId, slideScope, null], enabled: !!courseId && !structural, retry: false, staleTime: 30_000,
    queryFn: ({ signal }) => apiGet<OutlineView>(`courses/${courseId}/outline?scope=${encodeURIComponent(slideScope)}`, signal),
  });

  if (structural) {
    return (
      <div className="flex flex-col items-start gap-2" data-testid="concepts-tab">
        <h3 className="text-head font-semibold">{slide?.role ? ROLE_LABEL[slide.role.value] ?? slide.role.value : "Structural page"}</h3>
        <p className="ll-measure text-ui text-muted">No concept list is kept for a title, section, administrative or blank page.</p>
        <div className="flex flex-wrap gap-2">
          {nextContentPage !== null && <Button size="sm" onClick={() => onGoToPage(nextContentPage)}>{R2_ACTION.next_content}</Button>}
          <Link className="ll-btn ll-btn-sm" to={conceptMapHref(courseId, lectureScope)} state={back}>Concepts of this lecture</Link>
        </div>
      </div>
    );
  }

  const rows = outline.data?.rows ?? [];
  const concepts = slide?.concepts ?? [];
  return (
    <div className="flex flex-col gap-3" data-testid="concepts-tab">
      <div>
        <h3 className="text-head font-semibold">On this slide{outline.data ? `: ${countLabel(rows.length, rows.every((row) => row.kind === "topic") ? "topic" : "entry", rows.every((row) => row.kind === "topic") ? "topics" : "entries")}, ${countLabel(outline.data.scope.questions_in_scope, "question")}` : ""}</h3>
        <p className="ll-measure mt-1 text-ui text-muted">
          {identity.groupPages.length > 1 ? `Pages ${identity.groupPages[0]}–${identity.groupPages[identity.groupPages.length - 1]} are one slide. Each entry is listed once.` : "Each entry is listed once."}{" "}
          <Link className="ll-link" to={conceptMapHref(courseId, slideScope)} state={back}>Open the concept map</Link>
        </p>
        <p className="mt-1 text-ui text-muted">Also: <Link className="ll-link" to={conceptMapHref(courseId, lectureScope)} state={back}>this lecture</Link>, <Link className="ll-link" to={conceptMapHref(courseId, "course")} state={back}>the course</Link></p>
      </div>
      {outline.isLoading && <p role="status" className="text-ui text-muted">Reading the course catalog…</p>}
      {outline.isError && <p className="ll-err"><span>The concepts of this slide could not be read. {outline.error?.message}</span></p>}
      {outline.data && rows.length === 0 && concepts.length === 0 && <p className="ll-measure text-ui text-muted">{outline.data.scope.note || "The course catalog ties no concept to this slide."}</p>}
      {rows.length > 0 && (
        <ul className="flex flex-col gap-0.5" aria-label="Concepts of this slide">
          {rows.map((row) => (
            <li key={row.instance_id}>
              <Link to={conceptMapHref(courseId, slideScope)} state={back} className="grid grid-cols-[12px_minmax(0,1fr)] items-start gap-x-2 rounded-row px-2 py-1.5 transition-colors duration-[var(--ll-motion-small)] hover:bg-pad">
                <KindGlyph kind={row.kind} className="mt-1.5" />
                <span className="min-w-0">
                  <span className="block break-words text-read">{row.label}</span>
                  <span className="block text-ui text-muted">{[GRAPH_NODE_KIND_LABEL[row.kind] ?? row.kind, rowFacts(row)].filter(Boolean).join(" · ")}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {rows.length === 0 && concepts.length > 0 && (
        <ul className="flex flex-col gap-0.5" aria-label="Concepts of this slide">
          {concepts.map((concept) => (
            <li key={concept.concept_id}>
              <Link to={`/courses/${courseId}/concepts/${encodeURIComponent(concept.concept_id)}`} state={back} className="grid grid-cols-[12px_minmax(0,1fr)] items-start gap-x-2 rounded-row px-2 py-1.5 hover:bg-pad">
                <KindGlyph kind="concept" className="mt-1.5" />
                <span className="min-w-0 break-words text-read">{concept.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="ll-measure text-ui text-muted">A state describes single recorded attempts and how they were made. It is not a score.</p>
    </div>
  );
}
