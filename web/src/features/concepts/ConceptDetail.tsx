// The detail of the selected node (design specification 7.4): what it is and where it sits, then Sources, Questions and
// Evidence, read from `GET …/outline/node`. All sentences are at reading size. Sources are openable pages of the
// lecture (or the reference as the catalog words it); questions are compact entries; evidence is one line per recorded
// attempt in the five states, with prior exposure said beside the state, counts with their denominator, and no score.
// A concept without a definition says so: nothing is filled in.
import { type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ChevronRight, FileText, Play, ScrollText } from "lucide-react";
import { KindGlyph } from "@/components/glyphs";
import { StateLabel } from "@/components/labels";
import { Button, ErrorState, OUTCOME_LABEL, Skeleton, cn } from "@/components/ui";
import { ApiError, apiGet, r2Paths } from "@/lib/api";
import {
  CONDITION_LABEL, DEFINITION_GAP_SENTENCE, GRAPH_NODE_KIND_LABEL, PRIOR_EXPOSURE_LABEL, TIE_KIND, countLabel, edgeRelationLabel, evidenceSummarySentence, nb, timeSpanLabel, unlistedLabel, whereLabel,
} from "@/lib/labels";
import { useCourse, useLecture } from "@/lib/queries";
import { rangesForPage, whereLine } from "@/lib/r2";
import type { AnchorTieKind, ConceptGraphNode, EvidenceObservation, GraphNodeKind, GraphScopeKind, OutlineNodeView } from "@/lib/types";
import type { TreePlace } from "./ConceptTree";
import type { ParsedScope } from "./map-model";

export type DetailTabId = "sources" | "questions" | "evidence";
export const DETAIL_TABS: ReadonlyArray<{ id: DetailTabId; label: string }> = [{ id: "sources", label: "Sources" }, { id: "questions", label: "Questions" }, { id: "evidence", label: "Evidence" }];
export const isDetailTab = (value: string | null | undefined): value is DetailTabId => value === "sources" || value === "questions" || value === "evidence";

/** Sources, Questions and Evidence of one catalog object. The same cache entry serves the panel and the counts on its tabs. */
export function useNodeDetail(courseId: string, nodeId: string | null): UseQueryResult<OutlineNodeView, Error> {
  return useQuery<OutlineNodeView, Error>({
    queryKey: ["outline-node", courseId, nodeId], enabled: !!courseId && !!nodeId, retry: false, staleTime: 5_000,
    queryFn: ({ signal }) => apiGet<OutlineNodeView>(r2Paths.outlineNode(courseId, nodeId ?? ""), signal),
  });
}

type Source = OutlineNodeView["sources"][number];

/** The counts on the three tabs: source rows, questions, and recorded attempts. null where the detail does not say. */
export function detailCounts(detail: OutlineNodeView | null | undefined): Record<DetailTabId, number | null> {
  if (!detail) return { sources: null, questions: null, evidence: null };
  const summary = detail.evidence?.summary;
  return { sources: detail.sources_total, questions: detail.questions_total, evidence: summary ? summary.attempts ?? summary.observations ?? detail.evidence.observations?.length ?? null : null };
}

/** "Concept in Plasmid structure": the kind and where the node sits. */
export function detailKicker(detail: Pick<OutlineNodeView, "node" | "parents">): { kind: string; place: string | null } {
  const kind = GRAPH_NODE_KIND_LABEL[detail.node.kind as GraphNodeKind] ?? unlistedLabel(detail.node.kind);
  const parents = detail.parents.map((parent) => parent.label).filter(Boolean);
  if (detail.node.kind === "topic") return { kind, place: null };
  if (detail.node.kind === "criterion") return { kind, place: parents.length ? `of ${parents.join(", ")}` : null };
  if (detail.node.kind === "question") {
    const collection = (detail.node as { collection?: string | null }).collection;
    return { kind, place: collection ? `in the collection ${collection}` : null };
  }
  return { kind, place: parents.length ? `in ${parents.join(", ")}` : "filed under no topic in the catalog" };
}

const IN_SCOPE: Record<GraphScopeKind, string> = { course: "in the course", lecture: "in this lecture", slide: "on this slide" };
/** One sentence of counts, from the node as the scoped graph holds it. A count that does not apply is left out, never written 0. */
export function detailSummary(node: Pick<ConceptGraphNode, "kind" | "counts"> | null | undefined, scopeKind: GraphScopeKind): string | null {
  if (!node) return null;
  const skills = node.counts?.skills ?? null;
  const questions = node.counts?.questions ?? null;
  if (node.kind === "question") return skills !== null ? `It assesses ${countLabel(skills, "skill")} ${IN_SCOPE[scopeKind]}.` : null;
  const parts = [skills !== null ? countLabel(skills, "skill") : null, questions !== null ? countLabel(questions, "question") : null].filter((part): part is string => part !== null);
  return parts.length ? `${parts.join(" and ")} ${IN_SCOPE[scopeKind]}.` : null;
}

/**
 * The tie of a source row in the words of 9.6, said of what the row names (one page, several pages, transcript lines,
 * or a reference in words). A suggested link is never worded as the course's own anchor.
 */
export function sourceTieSentence(source: Pick<Source, "tie" | "kind" | "pages">): string {
  const what = source.kind === "transcript_lines" ? "these lines" : source.kind === "text" ? "this reference" : (source.pages?.length ?? 0) > 1 ? "these pages" : "this page";
  const its = what.startsWith("these") ? "Their" : "Its";
  switch (source.tie) {
    case "exact":
      return `${TIE_KIND.exact.label}. A reviewed anchor of the course record names ${what}.`;
    case "stated":
      return `${TIE_KIND.stated.label}. The course record names ${what}. ${its} basis is not reviewed.`;
    case "agent_inferred":
      return `${TIE_KIND.agent_inferred.label}. A suggestion names ${what}; it is not the course's own anchor.`;
    default:
      return source.tie ? `${unlistedLabel(String(source.tie))}.` : "The catalog names it without saying how.";
  }
}

/** Slide scope: where the node's support is, and that a suggested link is all that ties it to the slide when that is so. */
export function supportPlaceSentence(where: string, tie: AnchorTieKind | null | undefined): string {
  return `Its support is ${where}${tie === "agent_inferred" ? ", by a suggested link only" : ""}.`;
}

/** The page "Open page N" opens: a page of the scope's own lecture and, in a slide scope, the page on which the node's support is recorded. */
export function primaryPage(detail: Pick<OutlineNodeView, "sources"> | null | undefined, scope: ParsedScope, node?: Pick<ConceptGraphNode, "support_pages"> | null): { lectureId: string; page: number } | null {
  const rows = (detail?.sources ?? []).filter((source) => (source.kind ?? "pages") === "pages" && !!source.href && !!source.lecture_id && (source.pages?.length ?? 0) > 0);
  const row = rows.find((source) => source.lecture_id === scope.lectureId) ?? (scope.kind === "course" ? rows[0] : undefined) ?? rows[0];
  if (!row) return null;
  const lectureId = row.lecture_id!;
  const supported = lectureId === scope.lectureId ? node?.support_pages ?? [] : [];
  const page = scope.page !== null && supported.includes(scope.page) ? scope.page : supported.find((candidate) => row.pages!.includes(candidate)) ?? row.pages![0]!;
  return { lectureId, page };
}

const observationDate = (value: string | null): string => {
  if (!value) return "Date not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : nb(date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }));
};
const outcomeWords = (outcome: string | null): string => (outcome ? OUTCOME_LABEL[outcome]?.label ?? unlistedLabel(outcome) : "Outcome not recorded");

/** The heading of the Questions tab: "2 questions test this concept", "1 question tests this skill". */
export function questionsHeading(kind: string, total: number): string {
  if (kind === "question") return "This question";
  if (kind === "criterion") return "The question this criterion belongs to";
  const what = kind === "topic" || kind === "concept" || kind === "skill" ? `this ${kind}` : "this";
  return `${countLabel(total, "question")} ${total === 1 ? "tests" : "test"} ${what}`;
}

export interface ConceptDetailProps {
  courseId: string;
  nodeId: string | null;
  tab: DetailTabId;
  scope: ParsedScope;
  /** The selected node as the scoped graph holds it: its counts in this scope and where its support is. */
  graphNode?: ConceptGraphNode | null;
  /** Slide scope: the strongest tie by which the slide supports the node. */
  tie?: AnchorTieKind | null;
  place?: TreePlace | null;
  /** The address links out of the panel return to (the concept map as it is now). */
  returnTo: string;
  onClear?: () => void;
  /** Without the rounded region and with a 640 px measure (one focused pane). */
  framed: boolean;
}

function Scroll({ framed, children }: { framed: boolean; children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-[var(--ll-panel-pad,16px)] [scrollbar-width:thin]">
      <div className={cn("flex w-full flex-col", !framed && "mx-auto max-w-[640px]")}>{children}</div>
    </div>
  );
}
const HEAD = "text-head font-semibold";
const READ = "ll-measure text-read text-muted";

function SourceRow({ source, lectureTitle, state }: { source: Source; lectureTitle: (lectureId: string | null | undefined) => string | null; state: unknown }) {
  const kind = source.kind ?? "pages";
  const Icon = kind === "transcript_lines" ? ScrollText : FileText;
  const title = [lectureTitle(source.lecture_id), source.label ?? (kind === "text" ? "A reference in words" : source.source_id ?? "A source the record does not identify")].filter(Boolean).join(", ");
  const body = (
    <>
      <Icon aria-hidden className="mt-1 size-[18px] flex-none text-muted" />
      <span className="min-w-0 flex-1">
        <span className="block break-words text-read font-semibold">{title}</span>
        {kind === "text" && source.locator_text ? <span className="block break-words text-read text-ink">“{source.locator_text}”</span> : null}
        <span className="block text-read text-muted">{sourceTieSentence(source)}</span>
      </span>
      {source.href ? <ChevronRight aria-hidden className="mt-1 size-[18px] flex-none text-muted" /> : null}
    </>
  );
  return (
    <li className="border-t border-hairline first:border-t-0" data-testid="source-row">
      {source.href
        ? <Link to={source.href} state={state} className="-mx-2 flex items-start gap-3 rounded-row px-2 py-3 text-ink no-underline transition-colors duration-[var(--ll-motion-small)] hover:bg-pad">{body}</Link>
        : <div className="flex items-start gap-3 py-3">{body}</div>}
    </li>
  );
}

function Observation({ observation, questionTitle, skillLabel, ownSkill }: { observation: EvidenceObservation; questionTitle: string; skillLabel: string | null; ownSkill: boolean }) {
  return (
    <li className="grid gap-0.5 border-t border-hairline py-3 first:border-t-0" data-testid="observation">
      <p className="break-words text-read font-semibold">{observationDate(observation.recorded_at)}, {questionTitle}</p>
      <StateLabel evidence={{ state: observation.state, assistance: observation.assistance, prior_exposure: observation.prior_exposure }} priorExposure={false}
        beside={[PRIOR_EXPOSURE_LABEL[observation.prior_exposure] ?? unlistedLabel(String(observation.prior_exposure))]} />
      <p className={READ}>{outcomeWords(observation.outcome)}.{skillLabel && !ownSkill ? ` Skill: ${skillLabel}` : ""}</p>
    </li>
  );
}

export function ConceptDetail({ courseId, nodeId, tab, scope, graphNode, tie = null, place, returnTo, onClear, framed }: ConceptDetailProps) {
  const detail = useNodeDetail(courseId, nodeId);
  const data = detail.data ?? null;
  const primary = primaryPage(data, scope, graphNode);
  // The lecture of the page that "Open page" opens: its ranges give the Play button.
  const lecture = useLecture(courseId, primary?.lectureId);
  const course = useCourse(courseId);
  const openHref = primary ? `/courses/${courseId}/lectures/${encodeURIComponent(primary.lectureId)}?page=${primary.page}` : null;
  const back = { returnTo, returnLabel: "Back to the concept map" };

  if (!nodeId) {
    return (
      <div className={cn("grid content-start gap-1 p-[var(--ll-panel-pad,16px)]", !framed && "mx-auto w-full max-w-[640px]")} data-testid="outline-detail">
        <h2 className="text-title font-semibold">Nothing is selected</h2>
        <p className={READ}>Select a topic in the outline or on the map. Its sources, its questions and the evidence recorded for it open here.</p>
      </div>
    );
  }
  if (detail.isLoading) {
    return (
      <div role="status" className="grid content-start gap-3 p-[var(--ll-panel-pad,16px)]" data-testid="outline-detail">
        <span className="sr-only">Reading this item…</span>
        <Skeleton height={14} width="40%" /><Skeleton height={26} width="70%" /><Skeleton height={16} width="90%" /><Skeleton height={16} width="60%" />
      </div>
    );
  }
  if (detail.isError || !data) {
    const unknown = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <div className="p-[var(--ll-panel-pad,16px)]" data-testid="outline-detail">
        {unknown
          ? <div className="grid justify-items-start gap-2"><h2 className="text-title font-semibold">This item is not in the catalog</h2><p className={READ}>The course catalog holds nothing under this identifier. It may have been renamed or removed.</p>
              {onClear && <Button size="sm" onClick={onClear}>Clear the selection</Button>}</div>
          : <ErrorState error={detail.error} retry={() => void detail.refetch()} title="This item could not be read" stillWorks="The outline and the map keep working." />}
      </div>
    );
  }

  const kicker = detailKicker(data);
  const kind = data.node.kind;
  const summary = detailSummary(graphNode && graphNode.id === nodeId ? graphNode : null, scope.kind);
  const where = scope.kind === "slide" && graphNode?.where
    ? (place ? whereLine({ position: place.position, groupPages: place.groupPages, page: place.page }, { where: graphNode.where, support_pages: graphNode.support_pages }) : null) ?? whereLabel(graphNode.where, null)
    : null;
  const range = primary && lecture.data ? rangesForPage(lecture.data, primary.page).selectedDefault : null;
  const lectureTitle = (lectureId: string | null | undefined): string | null => (lectureId ? course.data?.lectures.find((entry) => entry.lecture_id === lectureId)?.title ?? lectureId : null);
  const questionTitle = new Map(data.questions.map((question) => [question.question_id, question.title ?? question.question_id]));
  const skillLabel = new Map((data.evidence.skills ?? []).map((skill) => [skill.skill_id, skill.label]));
  const evidence = data.evidence;
  const observations = evidence.observations ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="outline-detail">
      <header className={cn("grid flex-none gap-1 border-b border-hairline p-[var(--ll-panel-pad,16px)] pb-4", !framed && "mx-auto w-full max-w-[640px]")}>
        <p className="flex flex-wrap items-center gap-x-1.5 text-ui text-muted">
          <KindGlyph kind={(kind in GRAPH_NODE_KIND_LABEL ? kind : "concept") as GraphNodeKind} />
          <span className="font-semibold">{kicker.kind}</span>{kicker.place ? <span className="min-w-0 break-words">{kicker.place}</span> : null}
        </p>
        <h2 className="break-words text-title font-semibold tracking-[-0.01em]">{data.node.label}</h2>
        {(summary || where) && <p className={READ} data-testid="detail-summary">{summary}{where ? `${summary ? " " : ""}${supportPlaceSentence(where, tie)}` : ""}</p>}
        {primary && openHref && (
          <div className="mt-2 flex flex-wrap gap-2">
            <Link to={openHref} state={back} className="ll-btn ll-btn-sm max-[1179px]:flex-1"><FileText aria-hidden />{nb(`Open page ${primary.page}`)}</Link>
            {range && <Link to={`${openHref}&range=${encodeURIComponent(range.range_id)}&play=1`} state={{ ...back, range: range.range_id, play: true }} className="ll-btn ll-btn-sm max-[1179px]:flex-1"><Play aria-hidden />{nb(`Play ${timeSpanLabel(range.start_ms, range.end_ms)}`)}</Link>}
          </div>
        )}
      </header>

      {tab === "sources" && (
        <Scroll framed={framed}>
          <h3 className={HEAD}>Where this is taught</h3>
          {data.sources.length === 0
            ? <p className={cn(READ, "mt-1")}>The course catalog names no source location for this {kicker.kind.toLowerCase()}. That is a gap in the record, not something this app fills in.</p>
            : <ul className="mt-1 flex flex-col">{data.sources.map((source, index) => <SourceRow key={index} source={source} lectureTitle={lectureTitle} state={back} />)}</ul>}
          {data.sources_total > data.sources.length && <p className={cn(READ, "mt-2")}>Showing {data.sources.length} of {data.sources_total}.</p>}
          {data.definition && (
            <section className="mt-8">
              <h3 className={HEAD}>{data.definition.state === "coverage_gap" ? "Not in the record" : "Definition"}</h3>
              <p className={cn("ll-measure mt-1 text-read", data.definition.state === "coverage_gap" ? "text-muted" : "text-ink")} data-testid="definition" data-state={data.definition.state}>
                {data.definition.state === "coverage_gap" ? `${DEFINITION_GAP_SENTENCE} Nothing is filled in here.` : data.definition.text}
              </p>
            </section>
          )}
        </Scroll>
      )}

      {tab === "questions" && (
        <Scroll framed={framed}>
          <h3 className={HEAD}>
            {questionsHeading(kind, data.questions_total)}
          </h3>
          {data.questions.length === 0
            ? <p className={cn(READ, "mt-1")}>No catalogued question assesses this {kicker.kind.toLowerCase()}.</p>
            : (
              <>
                {kind !== "question" && kind !== "criterion" && <p className={cn(READ, "mt-1")}>Each one reaches it through a criterion. Answering opens the question; nothing here is credited automatically.</p>}
                <ul className="mt-1 flex flex-col">
                  {data.questions.map((question) => (
                    <li key={question.question_id} className="grid gap-1 border-t border-hairline py-4 first:border-t-0" data-testid="question-row">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <span className="break-words text-ui font-semibold text-muted">{question.title ?? question.question_id}</span>
                        {question.evidence && <StateLabel evidence={question.evidence} />}
                      </div>
                      <p className={cn("ll-measure break-words text-read", question.prompt_in_index === false && "text-muted")}>
                        {question.prompt_in_index === false ? "The wording of this question is kept in its original source. Open the source to read it." : question.prompt}
                      </p>
                      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-ui text-muted">
                        {question.tie_to_node === "assessment" && question.criterion_ids?.length ? <span>Through {countLabel(question.criterion_ids.length, "criterion", "criteria")} of this question.</span> : null}
                        <Link className="ll-link" to={`/courses/${courseId}/questions/${encodeURIComponent(question.question_id)}`} state={back}>Open the question</Link>
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          {data.questions_total > data.questions.length && <p className={cn(READ, "mt-2")}>Showing {data.questions.length} of {data.questions_total}. <Link className="ll-link" to={`/courses/${courseId}/questions`} state={back}>Open the question bank</Link></p>}
          {data.links.length > 0 && (
            <section className="mt-8">
              <h3 className={HEAD}>Relations to other questions</h3>
              <ul className="mt-1 flex flex-col">
                {data.links.map((link, index) => (
                  <li key={index} className="border-t border-hairline py-2 text-read first:border-t-0">
                    <span className="text-muted">{link.direction === "from_this" ? `This question ${edgeRelationLabel(link.relation)}` : `${edgeRelationLabel(link.relation)[0]!.toUpperCase()}${edgeRelationLabel(link.relation).slice(1)} this question:`} </span>
                    <Link className="ll-link" to={`/courses/${courseId}/questions/${encodeURIComponent(link.other)}`} state={back}>{link.other_label}</Link>
                    <span className="text-muted">. {link.automatic_credit ? "The catalog grants credit for it." : "No automatic credit."}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </Scroll>
      )}

      {tab === "evidence" && (
        <Scroll framed={framed}>
          {evidence.state ? (
            <>
              <StateLabel evidence={{ state: evidence.state, assistance: evidence.assistance ?? null, prior_exposure: evidence.prior_exposure ?? "unknown", attempts: evidence.attempts ?? 0 }} className="text-read font-semibold [&_.ll-beside]:font-normal" />
              {/* Counts with their denominator. With nothing recorded there is no denominator: a row of zeros is not written (9.8). */}
              {evidence.summary && (evidence.summary.observations ?? observations.length) > 0 && <p className={cn(READ, "mt-1")} data-testid="evidence-summary">{evidenceSummarySentence(evidence.summary)}</p>}
              {evidence.note && <p className={cn(READ, "mt-1")}>{evidence.note}</p>}
              {observations.length > 0
                ? <ul className="mt-2 flex flex-col">{observations.map((observation) => (
                    <Observation key={observation.attempt_id + (observation.skill_id ?? "")} observation={observation} questionTitle={(observation.question_id && questionTitle.get(observation.question_id)) || observation.question_id || "a question the record does not name"}
                      skillLabel={observation.skill_id ? skillLabel.get(observation.skill_id) ?? null : null} ownSkill={observation.skill_id === nodeId} />
                  ))}</ul>
                : <p className={cn(READ, "mt-2")}>No attempt is recorded for this {kicker.kind.toLowerCase()}. That says nothing about what you can do.</p>}
              <p className={cn(READ, "mt-3")}>Each line describes one recorded attempt and how it was made. Nothing is averaged into a score.</p>
            </>
          ) : (
            <>
              {/* An older Brain: no evidence state came. Counts of recorded episodes by condition, per skill, and nothing more. */}
              {evidence.note && <p className={READ}>{evidence.note}</p>}
              {evidence.skills.length === 0 ? <p className={READ}>No skill of the catalog is bound to this {kicker.kind.toLowerCase()}.</p> : (
                <ul className="flex flex-col">
                  {evidence.skills.map((skill) => (
                    <li key={skill.skill_id} className="border-t border-hairline py-3 first:border-t-0">
                      <p className="break-words text-read font-semibold">{skill.label}</p>
                      <p className={READ}>{countLabel(skill.episodes, "recorded attempt")}{skill.episodes ? `: ${Object.entries(skill.observations_by_condition).filter(([, count]) => count > 0).map(([condition, count]) => `${count} ${CONDITION_LABEL[condition] ?? unlistedLabel(condition)}`).join(", ")}` : ""}.</p>
                    </li>
                  ))}
                </ul>
              )}
              <p className={cn(READ, "mt-3")}>Counts are recorded attempts by the condition they were made under. No score is computed.</p>
            </>
          )}
        </Scroll>
      )}
    </div>
  );
}
