// The Concepts tab of the lecture workspace (design specification 5.10): what the course catalog and the suggested
// links tie to the slide on screen — the scope "This slide" of the same read model the concept map draws — with the
// lecture and the course one step away. The tree is the concept explorer's own tree, compactly: topic to skill, each
// row listed once with where its support is and, for a skill, its evidence state; a row opens that node in the map.
//
// On a structural page no concept list is kept: the role is said and the lecture's concepts are offered. Never an empty
// branch, never a warning.
import { useCallback, useMemo } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { KindGlyph } from "@/components/glyphs";
import { Button, Section, Sections, StaleNotice } from "@/components/ui";
import { R2_ACTION, ROLE_LABEL, conceptScopeHeading, countLabel, groupRowLabel, staleViewLine } from "@/lib/labels";
import { identityOf, isStale, isStructuralPage } from "@/lib/r2";
import type { ConceptsTabProps } from "@/features/lecture/contracts";
import type { OutlineRow } from "@/lib/types";
import { useScopeGraph } from "./ConceptMap";
import { ConceptTree, type TreePlace } from "./ConceptTree";
import { conceptMapHref as mapHref, topicConceptCounts } from "./map-model";

/** The address of the concept map of a scope (`course`, `lecture:<id>`, `slide:<lecture>:<page>`). */
export const conceptMapHref = (courseId: string, scope: string): string => mapHref(courseId, scope);

const OPEN_TO_SKILL: ReadonlyArray<OutlineRow["kind"]> = ["topic", "concept"];
const OPEN_TO_CONCEPT: ReadonlyArray<OutlineRow["kind"]> = ["topic"];
const CLOSING = "A state describes single recorded attempts and how they were made. It is not a score.";

export function ConceptsTab({ courseId, lecture, page, slide, onGoToPage, nextContentPage, returnTo }: ConceptsTabProps) {
  const queryClient = useQueryClient();
  const structural = isStructuralPage(lecture, page);
  const slideScope = `slide:${lecture.lecture_id}:${page}`;
  const lectureScope = `lecture:${lecture.lecture_id}`;
  const identity = useMemo(() => identityOf(lecture, page), [lecture, page]);
  const place = useMemo<TreePlace>(() => ({ page, position: identity.position, groupPages: identity.groupPages }), [page, identity]);
  const back = useMemo(() => ({ returnTo, returnLabel: `Back to page ${page}` }), [returnTo, page]);
  const graph = useScopeGraph(courseId, slideScope, !structural);
  const whole = useScopeGraph(courseId, lectureScope, !structural);
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["concept-graph", courseId] });
    void queryClient.invalidateQueries({ queryKey: ["outline", courseId] });
  }, [queryClient, courseId]);

  if (structural) {
    return (
      <div className="flex flex-col items-start gap-2" data-testid="concepts-tab">
        <h3 className="text-head font-semibold">{slide?.role ? ROLE_LABEL[slide.role.value] ?? slide.role.value : "Structural page"}</h3>
        <p className="ll-measure text-ui text-muted" data-testid="structural-note">No concept list is kept for a title, section, administrative or blank page.</p>
        <div className="flex flex-wrap gap-2">
          {nextContentPage !== null && <Button size="sm" onClick={() => onGoToPage(nextContentPage)}>{R2_ACTION.next_content}</Button>}
          <Link className="ll-btn ll-btn-sm" to={conceptMapHref(courseId, lectureScope)} state={back}>Concepts of this lecture</Link>
        </div>
      </div>
    );
  }

  const totals = graph.data?.totals ?? null;
  const holds = !!totals && totals.topic + totals.concept + totals.skill + totals.question > 0;
  const group = identity.groupPages.length > 1 && identity.logicalSlideKind ? groupRowLabel(identity.logicalSlideKind, identity.groupPages, identity.grouping?.state ?? null) : null;
  const stale = staleViewLine(isStale(graph.data?.revisions, lecture.revisions, { shared: true }));
  const legacy = slide?.concepts ?? [];
  const links = (
    <p className="mt-1 text-ui text-muted">
      <Link className="ll-link" to={conceptMapHref(courseId, slideScope)} state={back}>Open the concept map</Link>
      <span> · also for </span><Link className="ll-link" to={conceptMapHref(courseId, lectureScope)} state={back}>this lecture</Link>
      <span> and </span><Link className="ll-link" to={conceptMapHref(courseId, "course")} state={back}>the course</Link>
    </p>
  );

  return (
    <div className="flex flex-col gap-3" data-testid="concepts-tab">
      {stale && <StaleNotice onRefresh={refresh}>{stale}</StaleNotice>}
      <div>
        <h3 className="text-head font-semibold" data-testid="concepts-heading">{graph.data && totals && holds ? conceptScopeHeading(graph.data.scope, totals) : "On this slide"}</h3>
        {holds && <p className="ll-measure mt-1 text-ui text-muted">{group ? `One slide in ${group}. ` : ""}Each entry is listed once and says where its support is.</p>}
        {graph.data && !holds && <p className="ll-measure mt-1 text-ui text-muted">{graph.data.scope.note ?? "Nothing in the course record and no suggested link names this slide."}</p>}
        {links}
      </div>
      {graph.isLoading && <p role="status" className="text-ui text-muted">Reading the course catalog…</p>}
      {graph.isError && (
        <>
          <p className="ll-measure text-ui text-muted">The concepts of this slide could not be read. {graph.error?.message}</p>
          {/* An older Brain: the concepts the lecture view itself names for the slide, as links. */}
          {legacy.length > 0 && (
            <ul className="flex flex-col gap-0.5" aria-label="Concepts of this slide">
              {legacy.map((concept) => (
                <li key={concept.concept_id}>
                  <Link to={mapHref(courseId, slideScope, concept.concept_id)} state={back} className="grid grid-cols-[12px_minmax(0,1fr)] items-start gap-x-2 rounded-row px-2 py-1.5 text-ink no-underline hover:bg-pad">
                    <KindGlyph kind="concept" className="mt-1.5" />
                    <span className="min-w-0 break-words text-read">{concept.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {holds && (
        <ConceptTree courseId={courseId} scope={slideScope} scopeKind="slide" hrefFor={(row) => mapHref(courseId, slideScope, row.node_id)} linkState={back} place={place} conceptCounts={topicConceptCounts(graph.data)}
          deepest="skill" openKinds={OPEN_TO_SKILL} label="Concepts of this slide" testId="concepts-tree" />
      )}
      <Sections defaultValue={graph.data && !holds ? ["lecture"] : []} className="border-t border-hairline">
        <Section value="lecture" title={(
          <>Whole lecture{whole.data ? <span className="ll-sec-n text-ui"> · {countLabel(whole.data.totals.concept, "concept")}, {countLabel(whole.data.totals.skill, "skill")}, {countLabel(whole.data.totals.question, "question")}</span> : null}</>
        )}>
          <p className="ll-measure mb-2 text-ui text-muted">Open a concept to list its skills. A row opens that entry in the concept map.</p>
          <ConceptTree courseId={courseId} scope={lectureScope} scopeKind="lecture" hrefFor={(row) => mapHref(courseId, lectureScope, row.node_id)} linkState={back} conceptCounts={topicConceptCounts(whole.data)}
            deepest="skill" openKinds={OPEN_TO_CONCEPT} label="Concepts of this lecture" testId="concepts-tree-lecture"
            empty={<p className="ll-measure text-ui text-muted">{whole.data?.scope.note ?? "The course catalog ties no concept to this lecture."}</p>} />
        </Section>
      </Sections>
      <p className="ll-measure text-ui text-muted">{CLOSING}</p>
    </div>
  );
}
