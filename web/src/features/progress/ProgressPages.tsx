// SC09 Progress and learning gaps (UI20), SC10 Concept detail (UI19), SC11 Study history (UI21).
// Everything shown is linked to actual attempt records: observed performance, assistance and time
// basis. There is no mastery percentage, no forgetting estimate and no exam probability; zero records
// reads "Not assessed". Structure views are projections of the course's own catalogs.
//
// Amendment R2: where the Brain sends the five evidence states (Unknown, Not applicable, Not separately observed,
// Assisted with its kind, Independent) they are shown with `StateLabel`, prior exposure beside the state and never as
// assistance. The progress view itself does not carry them yet, so a skill's state is read from the course's concept
// graph (`nodes[].evidence`) and an attempt's own conditions from the skill's node detail (`evidence.observations`).
// A row for which nothing was sent claims nothing: the web never works a state out of counts or of the older status.
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/app/state";
import { KindGlyph, type KindGlyphKind } from "@/components/glyphs";
import { StateLabel } from "@/components/labels";
import { Button, cn, EmptyState, ErrorState, formatWhen, LoadingState, OUTCOME_LABEL, PageHeader, Tab, TabList, TabPanel, Tabs } from "@/components/ui";
import { apiGet, r2Paths } from "@/lib/api";
import {
  ASSISTANCE_LABEL, CONDITION_LABEL, NODE_TYPE_LABEL, PRIOR_EXPOSURE_LABEL, R2_ACTION, REFERENCE_LABEL, RELATION_LABEL, SKILL_STATUS, TIME_BASIS_LABEL, evidenceSummarySentence, unlistedLabel,
} from "@/lib/labels";
import { useConceptGraph, useConcepts, useHistory, useProgress } from "@/lib/queries";
import type { ConceptEdge, ConceptGraphView, ConceptNode, Episode, EvidenceObject, EvidenceObservation, HistoryAttempt, OutlineNodeView, SkillRow } from "@/lib/types";
import { Callout, Details, Disclosure, Lead, Page, Picker, ReturnLink } from "@/features/search/SearchOverlay";
import { useSubmitActions } from "@/features/tutor/actions";

const STATUS = SKILL_STATUS as Record<SkillRow["status"], { label: string; tone: "success" | "caution" | "unassessed" | "danger" | "neutral" }>;
/** A small label line above a field of an entry ("Question shown"). Sentence case, never upper case. */
const FIELD = "text-ui font-semibold text-muted";
const outcomeWords = (outcome: string): string => OUTCOME_LABEL[outcome]?.label ?? unlistedLabel(outcome);

// ---- R2 evidence: read, never derived (tested in tests/features/other-pages.test.tsx) --------------------------------------
/** A skill row; `evidence` is read when a Brain sends it with the progress view (today it does not). */
export type SkillRowWithEvidence = SkillRow & { evidence?: EvidenceObject | null };

/** The evidence of each skill of a course's concept graph, by skill id. Topics and concepts are not skills and are left out. */
export function skillEvidenceIndex(graph: Pick<ConceptGraphView, "nodes"> | null | undefined): Map<string, EvidenceObject> {
  const index = new Map<string, EvidenceObject>();
  for (const node of graph?.nodes ?? []) if (node.kind === "skill" && node.evidence) index.set(node.id, node.evidence);
  return index;
}
/** The row's own evidence object first, then the graph's node for that skill; null when neither was sent. */
export function rowEvidence(row: SkillRowWithEvidence, index: ReadonlyMap<string, EvidenceObject>): EvidenceObject | null {
  return row.evidence ?? index.get(row.skill_id) ?? null;
}
/** The observations of a node's detail by attempt, so that an attempt line states the conditions of that attempt. */
export function observationsByAttempt(detail: Pick<OutlineNodeView, "evidence"> | null | undefined): Map<string, EvidenceObservation> {
  const index = new Map<string, EvidenceObservation>();
  for (const observation of detail?.evidence?.observations ?? []) if (!index.has(observation.attempt_id)) index.set(observation.attempt_id, observation);
  return index;
}
/** One of the five evidence states of a skill, with its attempts and prior exposure beside it. Nothing is drawn when no evidence object was sent. */
export function SkillState({ evidence, className }: { evidence: EvidenceObject | null | undefined; className?: string }) {
  if (!evidence) return null;
  return <span data-testid="skill-state" className={className}><StateLabel evidence={evidence} /></span>;
}
/** The node detail of one skill or question (the same cache entry the concept views use). */
export const useNodeDetail = (courseId: string | undefined, nodeId: string | undefined, enabled = true) =>
  useQuery<OutlineNodeView, Error>({ queryKey: ["outline-node", courseId, nodeId], enabled: !!courseId && !!nodeId && enabled, retry: false, staleTime: 5_000,
    queryFn: ({ signal }) => apiGet<OutlineNodeView>(r2Paths.outlineNode(courseId ?? "", nodeId ?? ""), signal) });

/**
 * The conditions of one attempt: the five-state label when the Brain sent an observation for it (prior exposure stands
 * beside the state, never as assistance), otherwise the recorded condition in words.
 */
function AttemptConditions({ episode, observation }: { episode: Episode; observation: EvidenceObservation | undefined }) {
  if (observation) {
    const beside = observation.prior_exposure === "seen" ? [] : [PRIOR_EXPOSURE_LABEL[observation.prior_exposure] ?? unlistedLabel(String(observation.prior_exposure))];
    return <StateLabel evidence={observation} beside={beside} />;
  }
  return <span className="text-ui">{CONDITION_LABEL[episode.condition] ?? unlistedLabel(episode.condition)} <span className="text-muted">· {ASSISTANCE_LABEL[episode.assistance] ?? unlistedLabel(episode.assistance)}</span></span>;
}
/**
 * What the record states about one attempt beside its state: references, the assessor's confidence, and prior exposure
 * in the record's own word. The state label reduces prior exposure to seen or not; the record's word (the exact question,
 * one of the same family) is kept here.
 */
export function attemptRecordLine(episode: Pick<Episode, "reference_access" | "confidence" | "prior_exposure">): string {
  return `${REFERENCE_LABEL[episode.reference_access] ?? unlistedLabel(episode.reference_access)} · confidence ${episode.confidence} · prior exposure: ${unlistedLabel(episode.prior_exposure)}`;
}

// ---- plain words where an identifier stood (tested in tests/features/other-pages-seams.test.tsx) -----------------------------
/**
 * The rule versions of the facet table as a sentence. The coverage figures keep their rule versions beside them (R1-F3);
 * what goes is the identifier ("evidence-conditions/1"), whose number is all it says. A version that cannot be read
 * from the identifier is shown as recorded; no number is made up for it.
 */
export function ruleVersionSentence(rules: { evidence_conditions: string; facet_mapping: number | string }): string {
  const version = /\/(\d+)$/.exec(String(rules.evidence_conditions))?.[1];
  const conditions = version ? `version ${version} of the rules for evidence conditions` : `the rules for evidence conditions recorded as “${rules.evidence_conditions}”`;
  return `Counted with ${conditions} and version ${rules.facet_mapping} of the mapping of skills to kinds of performance.`;
}
/** The catalog's label of each skill, by skill id. A skill without a label is left out, so that it is named by its identifier. */
export function skillLabelIndex(skills: ReadonlyArray<Pick<SkillRow, "skill_id" | "label">> | null | undefined): Map<string, string> {
  const index = new Map<string, string>();
  for (const skill of skills ?? []) if (skill.label) index.set(skill.skill_id, skill.label);
  return index;
}
/** A skill in the catalog's own words; its identifier, as recorded, only where the catalog sent no label. */
export const skillLabel = (index: ReadonlyMap<string, string>, skillId: string): string => index.get(skillId) ?? skillId;
/** The first line of an attempt in the history: when it was recorded, when it happened (never invented), and its mode as recorded. */
export function attemptWhenLine(attempt: Pick<HistoryAttempt, "mode" | "recorded_at" | "occurred_at" | "time_basis">): string {
  const happened = attempt.occurred_at ? `happened ${formatWhen(attempt.occurred_at)}` : "time of the response not recorded";
  return `Recorded ${formatWhen(attempt.recorded_at)} · ${happened} (${TIME_BASIS_LABEL[attempt.time_basis] ?? unlistedLabel(attempt.time_basis)}) · mode: ${unlistedLabel(attempt.mode)}`;
}

function EvidenceLine({ row }: { row: SkillRow }) {
  const status = STATUS[row.status]?.label ?? unlistedLabel(row.status);
  // The full stop stands outside the status words, so that the status can be found as exactly its own words.
  if (!row.latest) return <p className="ll-measure text-ui"><span className="font-semibold">{status}</span>. <span className="text-muted">No attempt has observed this skill.</span></p>;
  const e = row.latest;
  return (
    <p className="ll-measure text-ui">
      <span className="font-semibold">{status}</span>.{" "}
      <span className="text-muted">
        Latest: {outcomeWords(e.outcome)} · <strong className="font-semibold text-ink">{CONDITION_LABEL[e.condition] ?? e.condition}</strong> · {ASSISTANCE_LABEL[e.assistance] ?? e.assistance} · {REFERENCE_LABEL[e.reference_access] ?? e.reference_access} · recorded {formatWhen(e.recorded_at)} ({TIME_BASIS_LABEL[e.time_basis] ?? e.time_basis})
        {e.revised ? " · corrected assessment in effect" : ""}{e.conflict ? " · correction chain needs reconciliation" : ""}
      </span>
    </p>
  );
}

/** What opens under a skill: its attempts, each with its own conditions, and the study priority (a planning choice). */
function SkillDetail({ courseId, row, onNotice }: { courseId: string; row: SkillRow; onNotice: (text: string) => void }) {
  const actions = useSubmitActions();
  const detail = useNodeDetail(courseId, row.skill_id);
  const observations = useMemo(() => observationsByAttempt(detail.data), [detail.data]);
  const summary = detail.data?.evidence?.summary;
  return (
    <div className="mt-4 flex flex-col gap-5 border-t border-hairline pt-4 text-ui">
      <section aria-label="Attempts">
        <h4 className="font-semibold">Attempts observing this skill</h4>
        {summary && <p className="ll-measure mt-0.5 text-muted" data-testid="evidence-summary">{evidenceSummarySentence(summary)}</p>}
        {row.history.length === 0 ? <p className="mt-1 text-muted">None.</p> : (
          <ul className="mt-1 flex flex-col">
            {row.history.map((e) => (
              <li key={e.attempt_id} className="flex flex-col items-start gap-1 border-t border-hairline py-3 first:border-t-0 last:pb-0" data-attempt={e.attempt_id}>
                <p><span className="font-semibold">{outcomeWords(e.outcome)}</span> <span className="text-muted">· {formatWhen(e.recorded_at)}</span></p>
                <AttemptConditions episode={e} observation={observations.get(e.attempt_id)} />
                <p className="text-muted">{attemptRecordLine(e)}</p>
                <p className="ll-measure text-read">{e.question_prompt}</p>
                <p className="ll-measure text-muted">{e.analysis}</p>
                <Link className="ll-link" to={`/history/${encodeURIComponent(e.attempt_id)}`}>Open the original attempt</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Study priority">
        <h4 className="font-semibold">Study priority (a planning choice, separate from evidence)</h4>
        <p className="mt-1">Priority: {row.study.priority ?? "not set"} · decision: {(row.study.study_decision ?? "undecided").replace(/_/g, " ")} · basis: {(row.study.need_basis ?? "not recorded").replace(/_/g, " ")}</p>
        {row.study.priority_reason && <p className="ll-measure text-muted">Reason on record: {row.study.priority_reason}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          {(["practise soon", "defer"] as const).map((choice) => (
            <Button key={choice} size="sm" variant="quiet" onClick={async () => {
              try {
                await actions.control(courseId, "save_note", { text: `Study preference: ${choice} — ${row.label} (${row.skill_id})`, sources: [], attachments: [] }, { label: "Study preference", text: `${choice}: ${row.label}` });
                onNotice(`Saved as your note: ${choice}. The course catalog, your record and any calendar are unchanged.`);
              } catch (e) {
                onNotice((e as Error).message);
              }
            }}>Note: {choice}</Button>
          ))}
        </div>
      </section>
    </div>
  );
}

export function ProgressPage() {
  const app = useApp();
  const courseId = app.courseId;
  const progress = useProgress(courseId);
  // The five-state evidence of each skill, as the course's concept graph carries it (as many nodes as the route allows).
  const graph = useConceptGraph(courseId, { scope: "course", limit: 400 });
  const evidenceOf = useMemo(() => skillEvidenceIndex(graph.data), [graph.data]);
  const [status, setStatus] = useState<string>("all");
  const [conditions, setConditions] = useState<string>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const rows = useMemo(() => (progress.data?.skills ?? []).filter((row) => {
    if (status !== "all" && row.status !== status) return false;
    if (conditions !== "all") return row.history.some((e) => e.condition === conditions);
    return true;
  }), [progress.data, status, conditions]);

  if (!courseId) return <Page><EmptyState title="No course selected">Choose a course in the header.</EmptyState></Page>;
  if (progress.isLoading) return <Page><LoadingState label="Reading recorded evidence…" /></Page>;
  if (progress.isError || !progress.data) return <Page><ErrorState error={progress.error} retry={() => void progress.refetch()} /></Page>;
  const data = progress.data;
  const s = data.summary;
  const facts = [
    `${data.recorded_attempts} recorded attempt${data.recorded_attempts === 1 ? "" : "s"}`,
    `${data.assessment_revisions} assessment correction${data.assessment_revisions === 1 ? "" : "s"} (not new attempts)`,
    `${s.current_gap ?? 0} gap${(s.current_gap ?? 0) === 1 ? "" : "s"} in latest responses`,
    `${(s.not_assessed ?? 0) + (s.not_observed_only ?? 0)} of ${s.skills} skills not assessed`,
  ];

  return (
    <Page>
      <PageHeader title="Progress" subtitle="What your recorded responses showed — not a score."
        actions={<><Link className="ll-btn" to={`/courses/${courseId}/concepts`}>{R2_ACTION.concept_map}</Link><Link className="ll-btn" to="/history">Study history</Link></>} />
      {data.owner_view_status === "stale" && <Callout tone="caution" className="mb-4" title="The course's own summary view is out of date">Its original attempt records are intact and are what you see here; only the generated summary lags. <Link className="ll-link" to="/settings/maintenance">Maintenance</Link></Callout>}
      <ul className="ll-num mb-6 flex flex-col gap-y-1 min-[600px]:flex-row min-[600px]:flex-wrap min-[600px]:gap-x-2 min-[600px]:[&>li+li]:before:mr-2 min-[600px]:[&>li+li]:before:text-muted min-[600px]:[&>li+li]:before:content-['·']" aria-label="Evidence summary">
        {facts.map((fact) => <li key={fact}>{fact}</li>)}
      </ul>
      {data.recorded_attempts === 0 && <Callout tone="unassessed" className="mb-6" title="Not assessed">No attempt is recorded for this course. That is not a score of zero — nothing has been measured yet.</Callout>}

      <section aria-labelledby="facets-h" className="mb-8" data-testid="facet-summary">
        <h2 id="facets-h" className="text-head font-semibold">Recorded evidence by kind of performance</h2>
        <p className="ll-measure mb-3 mt-1 text-read text-muted">Unit: distinct skills of this course's catalog ({s.skills}). "Unaided" means an observed, demonstrated response recorded with no assistance, no reference and no known prior exposure.{" "}
          <span data-testid="rule-versions">{ruleVersionSentence(data.rules)}</span></p>
        <div className="ll-region overflow-x-auto px-4 py-2 min-[900px]:px-5" tabIndex={0} role="region" aria-label="Evidence by kind of performance (scrolls sideways on a narrow screen)">
          <table className="ll-num w-full min-w-[46rem] border-collapse text-left text-ui">
            <thead><tr className="border-b border-hairline align-bottom text-muted">
              <th scope="col" className="py-2 pr-3 font-normal">Kind of performance</th><th scope="col" className="px-3 py-2 font-normal">Skills</th><th scope="col" className="px-3 py-2 font-normal">With an unaided demonstration</th>
              <th scope="col" className="px-3 py-2 font-normal">Observed otherwise</th><th scope="col" className="px-3 py-2 font-normal">Uncertain</th><th scope="col" className="px-3 py-2 font-normal">Not assessed</th>
              <th scope="col" className="py-2 pl-3 font-normal">Recorded observations</th></tr></thead>
            <tbody>
              {data.facets.rows.map((row) => (
                <tr key={row.facet} className="border-b border-hairline align-top last:border-b-0" data-facet={row.facet}>
                  <th scope="row" className="py-2 pr-3 font-semibold">{row.label}{row.note && <span className="mt-0.5 block max-w-[52ch] font-normal text-muted">{row.note}</span>}</th>
                  <td className="px-3 py-2">{row.target_skills}</td>
                  <td className="px-3 py-2">{row.target_skills ? `${row.qualifying_unaided_skills} of ${row.target_skills}` : "—"}</td>
                  <td className="px-3 py-2">{row.target_skills ? row.observed_other_skills : "—"}</td>
                  <td className="px-3 py-2">{row.target_skills ? row.uncertain_skills : "—"}</td>
                  <td className="px-3 py-2">{row.target_skills ? row.unassessed_skills : "—"}</td>
                  <td className="py-2 pl-3">{Object.entries(row.observations_by_condition).filter(([, n]) => n > 0).map(([c, n]) => `${n} ${CONDITION_LABEL[c] ?? c}`).join(", ") || "none"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="ll-measure mt-3 text-read text-muted" data-testid="criterion-evidence">{data.criterion_evidence.criteria_in_catalog} criteria are listed in the catalog; {data.criterion_evidence.attempts_with_criterion_observations} recorded attempts carry observations per criterion. {data.criterion_evidence.note}</p>
      </section>

      <section aria-labelledby="skills-h">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <h2 id="skills-h" className="text-head font-semibold">Skills <span className="ll-sec-n">({rows.length === data.skills.length ? data.skills.length : `${rows.length} of ${data.skills.length}`})</span></h2>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-ui">
            <span className="flex flex-wrap items-center gap-2">Show
              <Picker label="Show" value={status} onChange={setStatus} options={[{ value: "all", label: "all skills" }, ...Object.entries(STATUS).map(([value, { label }]) => ({ value, label }))]} />
            </span>
            <span className="flex flex-wrap items-center gap-2">Conditions
              <Picker label="Conditions" value={conditions} onChange={setConditions} options={[
                { value: "all", label: "any" }, { value: "unaided", label: "has unaided evidence (no help, no reference, not seen before)" }, { value: "assisted", label: "has assisted evidence" },
                { value: "prior_exposure", label: "has evidence after prior exposure" }, { value: "conditions_unknown", label: "has evidence with conditions not recorded" },
              ]} />
            </span>
          </div>
        </div>
        {notice && <p role="status" className="mb-3 text-ui text-muted">{notice}</p>}

        {rows.length === 0 ? <EmptyState title="No skill matches these filters">The course catalog has {data.skills.length} skill(s).</EmptyState> : (
          <ul className="ll-region flex flex-col" data-testid="skill-list">
            {rows.map((row) => {
              const expanded = open === row.skill_id;
              return (
                <li key={row.skill_id} className="border-t border-hairline p-4 first:border-t-0 min-[900px]:px-5" data-status={row.status}>
                  <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1">
                    <div className="min-w-0 flex-1 basis-80">
                      <h3 className="font-semibold">{row.label}</h3>
                      <p className="text-ui text-muted">{row.ability ?? "skill"} · {row.episodes} evidence episode{row.episodes === 1 ? "" : "s"}{row.unaided_demonstrated ? ` · ${row.unaided_demonstrated} unaided demonstration${row.unaided_demonstrated === 1 ? "" : "s"}` : ""}</p>
                    </div>
                    {/* Not `flex-none`: on a narrow window with enlarged text the state is wider than the row and must wrap inside it, not push the page sideways. */}
                    <SkillState evidence={rowEvidence(row, evidenceOf)} className="min-w-0 max-w-full" />
                  </div>
                  <div className="mt-2 flex flex-col gap-1">
                    <EvidenceLine row={row} />
                    {row.gap && <p className="ll-measure text-ui">Observed in that response: {(row.gap.observed.missing_or_incorrect as string[]).join("; ") || (row.gap.observed.analysis as string)} <span className="text-muted">— the cause is not established.</span></p>}
                    {row.counterevidence.length > 0 && <p className="ll-measure text-ui text-muted">Other evidence: {row.counterevidence.map((c) => `${outcomeWords(c.outcome)} (${formatWhen(c.recorded_at)})`).join("; ")}</p>}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : row.skill_id)}>{expanded ? "Hide" : "Show"} evidence and priority</Button>
                    <Link className="ll-btn ll-btn-sm ll-btn-quiet" to={`/courses/${courseId}/concepts/${encodeURIComponent(row.skill_id)}`}>Related questions and concepts</Link>
                  </div>
                  {expanded && <SkillDetail courseId={courseId} row={row} onNotice={setNotice} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <ul className="ll-measure mt-6 list-disc pl-5 text-read text-muted">{data.notes.map((n) => <li key={n}>{n}</li>)}<li>A due review or time passing is not evidence of forgetting.</li></ul>
    </Page>
  );
}

const KIND_OF_TYPE: Partial<Record<ConceptNode["type"], KindGlyphKind>> = { topic: "topic", concept: "concept", skill: "skill", question: "question" };

export function ConceptDetail() {
  const { courseId = "", typedId = "" } = useParams();
  const concepts = useConcepts(courseId);
  const node: ConceptNode | undefined = concepts.data?.nodes[typedId];
  // The five-state evidence of a skill, with its composition, from the node detail the concept views use.
  const detail = useNodeDetail(courseId, typedId, node?.type === "skill");
  if (concepts.isLoading) return <Page reading><LoadingState label="Loading structure…" /></Page>;
  if (concepts.isError || !concepts.data) return <Page reading><ReturnLink /><ErrorState error={concepts.error} /></Page>;
  const view = concepts.data;
  if (!node) {
    return <Page reading><ReturnLink /><EmptyState title="This item is not in the course's catalogs">It may not be mapped yet. That is a gap in the system's mapping, not a statement about what you know.</EmptyState></Page>;
  }
  const outgoing = view.edges.filter((e) => e.from === typedId);
  const incoming = view.edges.filter((e) => e.to === typedId);
  const group = (edges: ConceptEdge[], side: "from" | "to") => {
    const map = new Map<string, ConceptEdge[]>();
    for (const edge of edges.slice(0, 80)) map.set(edge.relation, [...(map.get(edge.relation) ?? []), edge]);
    return Array.from(map.entries()).map(([relation, list]) => ({ relation, list, side }));
  };
  const linkFor = (id: string) => {
    const target = view.nodes[id];
    if (!target) return <span>{id}</span>;
    const href = target.type === "question" ? `/courses/${courseId}/questions/${encodeURIComponent(id)}` : `/courses/${courseId}/concepts/${encodeURIComponent(id)}`;
    return <Link className="ll-link" to={href}>{target.label}</Link>;
  };
  const evidence = node.evidence_by_outcome ?? {};
  const kind = KIND_OF_TYPE[node.type];
  const groups = [...group(incoming, "from"), ...group(outgoing, "to")];
  const r2 = detail.data?.evidence;
  return (
    <Page reading>
      <ReturnLink />
      <PageHeader title={node.label} subtitle={<span className="inline-flex flex-wrap items-center gap-x-2 text-ui">{kind && <KindGlyph kind={kind} />}<span className="text-ink">{NODE_TYPE_LABEL[node.type] ?? node.type}</span></span>} />
      {node.mapping === "system_mapping_incomplete" && <Callout tone="unassessed" className="mb-4" title="System mapping incomplete">This skill is not linked to a concept in the course catalog. That is a coverage gap in the catalog — it says nothing about you.</Callout>}
      {node.type === "skill" && (
        <section className="mb-6 flex flex-col gap-1.5" aria-labelledby="ev-h">
          <h2 id="ev-h" className="text-head font-semibold">Recorded evidence for this skill</h2>
          {r2?.state && <SkillState evidence={r2 as EvidenceObject} />}
          {r2?.summary && <p className="ll-measure text-read text-muted">{evidenceSummarySentence(r2.summary)}</p>}
          {Object.keys(evidence).length === 0 ? <p className="text-muted">Not assessed: no attempt has observed this skill.</p> : (
            <p className="ll-measure text-read">Outcomes of the recorded observations: {Object.entries(evidence).map(([outcome, count]) => `${count} × ${outcomeWords(outcome)}`).join(", ")}.</p>
          )}
          <p className="ll-measure text-read text-muted">Counts of observations across attempts (a regrade replaces, it does not add). <Link className="ll-link" to="/progress">See the attempts in Progress</Link>.</p>
        </section>
      )}
      {groups.length === 0 ? <p className="text-muted">No relationship to other items is recorded.</p> : (
        <div className="flex flex-col">
          {groups.map(({ relation, list, side }) => (
            <section key={relation + side} className="border-t border-hairline py-4" aria-label={RELATION_LABEL[relation] ?? relation}>
              <h2 className="text-head font-semibold">{side === "from" ? "Reached from" : "Leads to"} <span className="font-normal text-muted">· {RELATION_LABEL[relation] ?? relation.replace(/_/g, " ")}</span></h2>
              <ul className="mt-2 flex flex-col gap-1.5">
                {list.map((edge, i) => (
                  <li key={i}>
                    {linkFor(side === "from" ? edge.from : edge.to)} <span className="text-ui text-muted">({NODE_TYPE_LABEL[view.nodes[side === "from" ? edge.from : edge.to]?.type ?? ""] ?? "item"})</span>
                    {edge.rationale && <span className="ll-measure block text-ui text-muted">{edge.rationale}</span>}
                    {edge.other_courses?.length ? <span className="ll-measure block text-ui text-muted">Also linked in: {edge.other_courses.join(", ")} — no credit transfers between courses.</span> : null}
                  </li>
                ))}
              </ul>
              <p className="ll-measure mt-2 text-read text-muted">Source: {list[0]!.provenance}.{list[0]!.scope === "question_to_question" ? " This is a relation between questions; it is not a concept prerequisite and gives no automatic credit." : ""}</p>
            </section>
          ))}
        </div>
      )}
      <p className="ll-measure mt-4 text-read text-muted">{view.note}</p>
      <Details className="mt-3" rows={[["Catalog identifier", node.id]]} />
    </Page>
  );
}

export function HistoryPage() {
  const app = useApp();
  const { sessionId } = useParams();
  const courseId = app.courseId;
  const history = useHistory(courseId);
  const [filter, setFilter] = useState("");
  const [onlyRevised, setOnlyRevised] = useState(false);
  // Only for the catalog's labels of the skills: an assessment names its skill in words, and by identifier until they load.
  const progress = useProgress(courseId);
  const names = useMemo(() => skillLabelIndex(progress.data?.skills), [progress.data]);
  if (!courseId) return <Page reading><EmptyState title="No course selected">Choose a course in the header.</EmptyState></Page>;
  if (history.isLoading) return <Page reading><LoadingState label="Reading history…" /></Page>;
  if (history.isError || !history.data) return <Page reading><ErrorState error={history.error} retry={() => void history.refetch()} /></Page>;
  const data = history.data;
  // The filter still finds an attempt by its identifier and by a skill's identifier, which now stand under "Details".
  const attempts = data.attempts.filter((a) => (!filter || `${a.question.prompt} ${a.attempt_id} ${a.effective.observations.map((o) => `${o.skill_id} ${skillLabel(names, o.skill_id)}`).join(" ")}`.toLowerCase().includes(filter.toLowerCase())) && (!onlyRevised || a.revisions.length > 0));
  return (
    <Page reading>
      <ReturnLink />
      <PageHeader title="Study history" subtitle={<Lead>{data.note}</Lead>} />
      <Tabs defaultValue="attempts">
        <TabList label="History views" className="-ml-[10px]"><Tab value="attempts" count={data.attempts.length}>Attempts</Tab><Tab value="conversations" count={data.conversations.length}>Conversations</Tab></TabList>
        <TabPanel value="attempts" className="pt-4">
          <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3 text-ui">
            <input type="search" className="ll-input max-w-xs" placeholder="Filter by question, skill or id…" aria-label="Filter attempts" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <label className="flex items-center gap-2"><input type="checkbox" className="size-5 flex-none accent-accent" checked={onlyRevised} onChange={(e) => setOnlyRevised(e.target.checked)} /> Only attempts with corrections</label>
          </div>
          {attempts.length === 0 ? <EmptyState title={data.attempts.length ? "No attempt matches" : "Not assessed"}>{data.attempts.length ? "Clear the filter to see all attempts." : "No attempt is recorded for this course yet."}</EmptyState> : (
            <ul className="ll-region flex flex-col">
              {attempts.map((a) => {
                const here = sessionId === a.attempt_id;
                return (
                  <li key={a.attempt_id} id={a.attempt_id} aria-current={here ? "true" : undefined}
                    className={cn("relative flex flex-col gap-3 border-t border-hairline p-4 first:border-t-0 first:rounded-t-region last:rounded-b-region min-[900px]:px-5",
                      here && "bg-tint before:absolute before:bottom-4 before:left-0 before:top-4 before:w-[3px] before:rounded-r-[3px] before:bg-accent-text before:content-['']")}>
                    <p className="ll-measure text-ui text-muted">{attemptWhenLine(a)}</p>
                    <div><p className={FIELD}>Question shown</p><p className="ll-measure">{a.question.prompt}</p></div>
                    <div>
                      <p className={FIELD}>Your response {a.response.availability === "full_capture" ? "(full capture)" : a.response.availability === "capture_unavailable" ? "(excerpt; the full capture is no longer available)" : "(excerpt only — the full text was not retained)"}</p>
                      <p className="ll-measure whitespace-pre-wrap">{a.response.full_text ?? a.response.excerpt}</p>
                    </div>
                    <div className="flex flex-col gap-2 text-ui">
                      <p className={FIELD}>{a.revisions.length ? "Assessment in effect (after correction)" : "Assessment"}</p>
                      {a.effective.observations.map((o) => (
                        <div key={o.skill_id}>
                          <p><span className="font-semibold">{outcomeWords(o.outcome)}</span> <span className="break-words text-muted">· {skillLabel(names, o.skill_id)} · {ASSISTANCE_LABEL[o.assistance as string] ?? String(o.assistance)}</span></p>
                          <p className="ll-measure text-muted">{o.analysis}</p>
                        </div>
                      ))}
                      {a.effective.conflict && <Callout tone="caution" title="Conflicting corrections">Two corrections branch from the same assessment. They need reconciliation; neither was chosen automatically.</Callout>}
                    </div>
                    {a.revisions.length > 0 && (
                      <Disclosure className="text-ui" title={`${a.revisions.length} correction${a.revisions.length === 1 ? "" : "s"} — the original assessment is kept`}>
                        <ul className="ll-measure list-disc pb-1 pl-5">
                          <li>Original: {a.original_observations.map((o) => `${skillLabel(names, o.skill_id)}: ${outcomeWords(o.outcome)}`).join("; ")}</li>
                          {a.revisions.map((r) => <li key={r.event_id}>{formatWhen(r.recorded_at)} — {r.reason} <span className="text-muted">(a regrade of the same response, not a new answer)</span></li>)}
                        </ul>
                      </Disclosure>
                    )}
                    <Details rows={[["Attempt", a.attempt_id], [a.effective.observations.length === 1 ? "Skill" : "Skills", a.effective.observations.map((o) => o.skill_id).join(", ")], ["Question", a.question.question_id]]} />
                    {a.question.question_id && <div><Link className="ll-btn ll-btn-sm" to={`/courses/${courseId}/questions/${encodeURIComponent(a.question.question_id)}`}>Try again (new answer)</Link></div>}
                  </li>
                );
              })}
            </ul>
          )}
        </TabPanel>
        <TabPanel value="conversations" className="pt-4">
          {data.conversations.length === 0 ? <EmptyState title="No captured conversation yet">Questions and explanations you send from this app are kept here exactly as submitted, with the tutor's delivered replies.</EmptyState> : (
            <ul className="ll-region flex flex-col">
              {data.conversations.map((c) => (
                <li key={c.run_id} className="border-t border-hairline p-4 first:border-t-0 min-[900px]:px-5">
                  <h2 className="mb-3 text-ui text-muted">{c.entries[0]?.at ? `Conversation of ${formatWhen(c.entries[0].at)}` : "Conversation"}</h2>
                  <ol className="flex flex-col gap-3">
                    {c.entries.map((e, i) => (
                      <li key={i} className={cn("flex flex-col gap-0.5", e.kind === "tutor" && "rounded-control bg-pad p-3")}>
                        <span className={FIELD}>{e.kind === "tutor" ? "Tutor reply (as delivered)" : e.kind === "submission" ? `Your ${e.interaction?.replace(/_/g, " ")}` : "Your question"} · {formatWhen(e.at)}</span>
                        {e.prompt && <p className="ll-measure text-read text-muted">Asked: {e.prompt}</p>}
                        <p className="ll-measure whitespace-pre-wrap">{e.text}</p>
                        {e.kind === "learner_question" && <span className="text-ui text-muted">Not assessed</span>}
                      </li>
                    ))}
                  </ol>
                  <Details className="mt-3" rows={[["Run", c.run_id]]} />
                </li>
              ))}
            </ul>
          )}
        </TabPanel>
      </Tabs>
    </Page>
  );
}
