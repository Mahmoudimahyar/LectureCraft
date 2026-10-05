// SC09 Progress and learning gaps (UI20), SC10 Concept detail (UI19), SC11 Study history (UI21).
// Everything shown is linked to actual attempt records: observed performance, assistance and time
// basis. There is no mastery percentage, no forgetting estimate and no exam probability; zero records
// reads "Not assessed". Structure views are projections of the course's own catalogs.
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useApp } from "@/app/state";
import { Button, Callout, EmptyState, ErrorState, formatWhen, LoadingState, OUTCOME_LABEL, PageHeader, StatusChip, Tab, TabList, TabPanel, Tabs } from "@/components/ui";
import { ASSISTANCE_LABEL, CONDITION_LABEL, NODE_TYPE_LABEL, REFERENCE_LABEL, RELATION_LABEL, SKILL_STATUS, TIME_BASIS_LABEL } from "@/lib/labels";
import { useConcepts, useHistory, useProgress } from "@/lib/queries";
import type { ConceptEdge, ConceptNode, SkillRow } from "@/lib/types";
import { ReturnLink } from "@/features/search/SearchOverlay";
import { useSubmitActions } from "@/features/tutor/actions";

const STATUS = SKILL_STATUS as Record<SkillRow["status"], { label: string; tone: "success" | "caution" | "unassessed" | "danger" | "neutral" }>;

function EvidenceLine({ row }: { row: SkillRow }) {
  if (!row.latest) return <p className="text-sm text-muted">No attempt has observed this skill.</p>;
  const e = row.latest;
  return (
    <p className="text-sm text-muted">
      Latest: {OUTCOME_LABEL[e.outcome]?.label ?? e.outcome} · <strong className="font-medium text-ink">{CONDITION_LABEL[e.condition] ?? e.condition}</strong> · {ASSISTANCE_LABEL[e.assistance] ?? e.assistance} · {REFERENCE_LABEL[e.reference_access] ?? e.reference_access} · recorded {formatWhen(e.recorded_at)} ({TIME_BASIS_LABEL[e.time_basis] ?? e.time_basis})
      {e.revised ? " · corrected assessment in effect" : ""}{e.conflict ? " · correction chain needs reconciliation" : ""}
    </p>
  );
}

export function ProgressPage() {
  const app = useApp();
  const courseId = app.courseId;
  const progress = useProgress(courseId);
  const actions = useSubmitActions();
  const [status, setStatus] = useState<string>("all");
  const [conditions, setConditions] = useState<string>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const rows = useMemo(() => (progress.data?.skills ?? []).filter((row) => {
    if (status !== "all" && row.status !== status) return false;
    if (conditions !== "all") return row.history.some((e) => e.condition === conditions);
    return true;
  }), [progress.data, status, conditions]);

  if (!courseId) return <EmptyState title="No course selected">Choose a course in the header.</EmptyState>;
  if (progress.isLoading) return <LoadingState label="Reading recorded evidence…" />;
  if (progress.isError || !progress.data) return <ErrorState error={progress.error} retry={() => void progress.refetch()} />;
  const data = progress.data;
  const s = data.summary;

  return (
    <div className="ll-page">
      <PageHeader title="Progress" subtitle="What your recorded responses showed — not a score."
        actions={<><Link className="ll-btn" to={`/courses/${courseId}/outline`}>Concept outline</Link><Link className="ll-btn" to="/history">Study history</Link></>} />
      {data.owner_view_status === "stale" && <Callout tone="caution" className="mb-3" title="The course's own summary view is out of date">Its original attempt records are intact and are what you see here; only the generated summary lags. <Link className="text-accent underline" to="/settings/maintenance">Maintenance</Link></Callout>}
      <ul className="mb-4 flex flex-wrap gap-2" aria-label="Evidence summary">
        <li><StatusChip tone="neutral">{data.recorded_attempts} recorded attempt{data.recorded_attempts === 1 ? "" : "s"}</StatusChip></li>
        <li><StatusChip tone="neutral">{data.assessment_revisions} assessment correction{data.assessment_revisions === 1 ? "" : "s"} (not new attempts)</StatusChip></li>
        <li><StatusChip tone="caution">{s.current_gap ?? 0} gap{(s.current_gap ?? 0) === 1 ? "" : "s"} in latest responses</StatusChip></li>
        <li><StatusChip tone="unassessed">{(s.not_assessed ?? 0) + (s.not_observed_only ?? 0)} of {s.skills} skills not assessed</StatusChip></li>
      </ul>
      <section aria-labelledby="facets-h" className="ll-card mb-4 p-4" data-testid="facet-summary">
        <h2 id="facets-h" className="text-lg font-semibold">Recorded evidence by kind of performance</h2>
        <p className="ll-measure mb-2 text-sm text-muted">Unit: distinct skills of this course's catalog ({s.skills}). "Unaided" means an observed, demonstrated response recorded with no assistance, no reference and no known prior exposure.
          Rules: conditions {data.rules.evidence_conditions}, facet mapping v{data.rules.facet_mapping}.</p>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Evidence by kind of performance (scrolls sideways on a narrow screen)">
          <table className="w-full min-w-[44rem] border-collapse text-left">
            <thead><tr className="border-b border-line/40 text-sm text-muted">
              <th scope="col" className="py-1 pr-3 font-medium">Kind of performance</th><th scope="col" className="px-2 font-medium">Skills</th><th scope="col" className="px-2 font-medium">With an unaided demonstration</th>
              <th scope="col" className="px-2 font-medium">Observed otherwise</th><th scope="col" className="px-2 font-medium">Uncertain</th><th scope="col" className="px-2 font-medium">Not assessed</th>
              <th scope="col" className="pl-2 font-medium">Recorded observations</th></tr></thead>
            <tbody>
              {data.facets.rows.map((row) => (
                <tr key={row.facet} className="border-b border-line/20 align-top" data-facet={row.facet}>
                  <th scope="row" className="py-1.5 pr-3 font-medium">{row.label}{row.note && <span className="block text-sm font-normal text-muted">{row.note}</span>}</th>
                  <td className="px-2 tabular-nums">{row.target_skills}</td>
                  <td className="px-2 tabular-nums">{row.target_skills ? `${row.qualifying_unaided_skills} of ${row.target_skills}` : "—"}</td>
                  <td className="px-2 tabular-nums">{row.target_skills ? row.observed_other_skills : "—"}</td>
                  <td className="px-2 tabular-nums">{row.target_skills ? row.uncertain_skills : "—"}</td>
                  <td className="px-2 tabular-nums">{row.target_skills ? row.unassessed_skills : "—"}</td>
                  <td className="pl-2 text-sm">{Object.entries(row.observations_by_condition).filter(([, n]) => n > 0).map(([c, n]) => `${n} ${CONDITION_LABEL[c] ?? c}`).join(", ") || "none"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="ll-measure mt-2 text-sm text-muted" data-testid="criterion-evidence">{data.criterion_evidence.criteria_in_catalog} criteria are listed in the catalog; {data.criterion_evidence.attempts_with_criterion_observations} recorded attempts carry observations per criterion. {data.criterion_evidence.note}</p>
      </section>
      {data.recorded_attempts === 0 && <Callout tone="unassessed" className="mb-3" title="Not assessed">No attempt is recorded for this course. That is not a score of zero — nothing has been measured yet.</Callout>}

      <div className="mb-3 flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-2">Show
          <select className="ll-input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">all skills</option>
            {Object.entries(STATUS).map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">Conditions
          <select className="ll-input w-auto" value={conditions} onChange={(e) => setConditions(e.target.value)}>
            <option value="all">any</option><option value="unaided">has unaided evidence (no help, no reference, not seen before)</option><option value="assisted">has assisted evidence</option>
            <option value="prior_exposure">has evidence after prior exposure</option><option value="conditions_unknown">has evidence with conditions not recorded</option>
          </select>
        </label>
      </div>
      {notice && <p role="status" className="mb-2 text-sm text-muted">{notice}</p>}

      {rows.length === 0 ? <EmptyState title="No skill matches these filters">The course catalog has {data.skills.length} skill(s).</EmptyState> : (
        <ul className="flex flex-col gap-2" data-testid="skill-list">
          {rows.map((row) => {
            const st = STATUS[row.status];
            const expanded = open === row.skill_id;
            return (
              <li key={row.skill_id} className="ll-card p-3" data-status={row.status}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold">{row.label}</h2>
                    <p className="text-sm text-muted">{row.ability ?? "skill"} · {row.episodes} evidence episode{row.episodes === 1 ? "" : "s"}{row.unaided_demonstrated ? ` · ${row.unaided_demonstrated} unaided demonstration${row.unaided_demonstrated === 1 ? "" : "s"}` : ""}</p>
                  </div>
                  <StatusChip tone={st.tone}>{st.label}</StatusChip>
                </div>
                <EvidenceLine row={row} />
                {row.gap && <p className="mt-1 text-sm">Observed in that response: {(row.gap.observed.missing_or_incorrect as string[]).join("; ") || (row.gap.observed.analysis as string)} <span className="text-muted">— the cause is not established.</span></p>}
                {row.counterevidence.length > 0 && <p className="text-sm text-muted">Other evidence: {row.counterevidence.map((c) => `${OUTCOME_LABEL[c.outcome]?.label ?? c.outcome} (${formatWhen(c.recorded_at)})`).join("; ")}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : row.skill_id)}>{expanded ? "Hide" : "Show"} evidence and priority</Button>
                  <Link className="ll-btn ll-btn-sm" to={`/courses/${courseId}/concepts/${encodeURIComponent(row.skill_id)}`}>Related questions and concepts</Link>
                </div>
                {expanded && (
                  <div className="mt-3 flex flex-col gap-3 border-t border-line/40 pt-3 text-sm">
                    <section aria-label="Attempts">
                      <p className="ll-label mb-1">Attempts observing this skill</p>
                      {row.history.length === 0 ? <p className="text-muted">None.</p> : (
                        <ul className="flex flex-col gap-1">
                          {row.history.map((e) => (
                            <li key={e.attempt_id} className="rounded border border-line/40 p-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <StatusChip tone={OUTCOME_LABEL[e.outcome]?.tone ?? "neutral"}>{OUTCOME_LABEL[e.outcome]?.label ?? e.outcome}</StatusChip>
                                <StatusChip tone={e.condition === "unaided" ? "success" : "neutral"}>{CONDITION_LABEL[e.condition] ?? e.condition}</StatusChip>
                                <span className="text-muted">{formatWhen(e.recorded_at)} · {ASSISTANCE_LABEL[e.assistance]} · {REFERENCE_LABEL[e.reference_access]} · prior exposure: {e.prior_exposure.replace(/_/g, " ")} · confidence {e.confidence}</span>
                              </div>
                              <p className="mt-1">{e.question_prompt}</p>
                              <p className="text-muted">{e.analysis}</p>
                              <Link className="text-accent underline" to={`/history/${encodeURIComponent(e.attempt_id)}`}>Open the original attempt</Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                    <section aria-label="Study priority">
                      <p className="ll-label mb-1">Study priority (a planning choice, separate from evidence)</p>
                      <p>Priority: {row.study.priority ?? "not set"} · decision: {(row.study.study_decision ?? "undecided").replace(/_/g, " ")} · basis: {(row.study.need_basis ?? "not recorded").replace(/_/g, " ")}</p>
                      {row.study.priority_reason && <p className="text-muted">Reason on record: {row.study.priority_reason}</p>}
                      <div className="mt-1 flex flex-wrap gap-2">
                        {(["practise soon", "defer"] as const).map((choice) => (
                          <Button key={choice} size="sm" variant="quiet" onClick={async () => {
                            try {
                              await actions.control(courseId, "save_note", { text: `Study preference: ${choice} — ${row.label} (${row.skill_id})`, sources: [], attachments: [] }, { label: "Study preference", text: `${choice}: ${row.label}` });
                              setNotice(`Saved as your note: ${choice}. The course catalog, your record and any calendar are unchanged.`);
                            } catch (e) {
                              setNotice((e as Error).message);
                            }
                          }}>Note: {choice}</Button>
                        ))}
                      </div>
                    </section>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ul className="mt-4 list-disc pl-5 text-sm text-muted">{data.notes.map((n) => <li key={n}>{n}</li>)}<li>A due review or time passing is not evidence of forgetting.</li></ul>
    </div>
  );
}

export function ConceptDetail() {
  const { courseId = "", typedId = "" } = useParams();
  const concepts = useConcepts(courseId);
  if (concepts.isLoading) return <LoadingState label="Loading structure…" />;
  if (concepts.isError || !concepts.data) return <><ReturnLink /><ErrorState error={concepts.error} /></>;
  const view = concepts.data;
  const node: ConceptNode | undefined = view.nodes[typedId];
  if (!node) {
    return <><ReturnLink /><EmptyState title="This item is not in the course's catalogs">It may not be mapped yet. That is a gap in the system's mapping, not a statement about what you know.</EmptyState></>;
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
    return <Link className="text-accent underline" to={href}>{target.label}</Link>;
  };
  const evidence = node.evidence_by_outcome ?? {};
  return (
    <div className="ll-page ll-page-reading">
      <ReturnLink />
      <PageHeader title={node.label} subtitle={<><StatusChip tone="accent">{NODE_TYPE_LABEL[node.type] ?? node.type}</StatusChip> <span className="ml-2 break-all font-mono text-sm">{node.id}</span></>} />
      {node.mapping === "system_mapping_incomplete" && <Callout tone="unassessed" className="mb-3" title="System mapping incomplete">This skill is not linked to a concept in the course catalog. That is a coverage gap in the catalog — it says nothing about you.</Callout>}
      {node.type === "skill" && (
        <section className="ll-card mb-4 p-3" aria-labelledby="ev-h">
          <h2 id="ev-h" className="mb-1 font-semibold">Recorded evidence for this skill</h2>
          {Object.keys(evidence).length === 0 ? <p className="text-muted">Not assessed: no attempt has observed this skill.</p> : (
            <ul className="flex flex-wrap gap-2">{Object.entries(evidence).map(([outcome, count]) => <li key={outcome}><StatusChip tone={OUTCOME_LABEL[outcome]?.tone ?? "neutral"}>{count} × {OUTCOME_LABEL[outcome]?.label ?? outcome}</StatusChip></li>)}</ul>
          )}
          <p className="mt-2 text-sm text-muted">Counts of observations across attempts (a regrade replaces, it does not add). <Link className="text-accent underline" to="/progress">See the attempts in Progress</Link>.</p>
        </section>
      )}
      {[...group(incoming, "from"), ...group(outgoing, "to")].length === 0 ? <p className="text-muted">No relationship to other items is recorded.</p> : (
        <div className="flex flex-col gap-3">
          {[...group(incoming, "from"), ...group(outgoing, "to")].map(({ relation, list, side }) => (
            <section key={relation + side} className="ll-card p-3" aria-label={RELATION_LABEL[relation] ?? relation}>
              <h2 className="ll-label mb-1">{side === "from" ? "Reached from" : "Leads to"} · {RELATION_LABEL[relation] ?? relation.replace(/_/g, " ")}</h2>
              <ul className="flex flex-col gap-1 text-sm">
                {list.map((edge, i) => (
                  <li key={i}>
                    {linkFor(side === "from" ? edge.from : edge.to)} <span className="text-muted">({NODE_TYPE_LABEL[view.nodes[side === "from" ? edge.from : edge.to]?.type ?? ""] ?? "item"})</span>
                    {edge.rationale && <span className="block text-muted">{edge.rationale}</span>}
                    {edge.other_courses?.length ? <span className="block text-muted">Also linked in: {edge.other_courses.join(", ")} — no credit transfers between courses.</span> : null}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-sm text-muted">Source: {list[0]!.provenance}.{list[0]!.scope === "question_to_question" ? " This is a relation between questions; it is not a concept prerequisite and gives no automatic credit." : ""}</p>
            </section>
          ))}
        </div>
      )}
      <p className="mt-4 text-sm text-muted">{view.note}</p>
    </div>
  );
}

export function HistoryPage() {
  const app = useApp();
  const { sessionId } = useParams();
  const courseId = app.courseId;
  const history = useHistory(courseId);
  const [filter, setFilter] = useState("");
  const [onlyRevised, setOnlyRevised] = useState(false);
  if (!courseId) return <EmptyState title="No course selected">Choose a course in the header.</EmptyState>;
  if (history.isLoading) return <LoadingState label="Reading history…" />;
  if (history.isError || !history.data) return <ErrorState error={history.error} retry={() => void history.refetch()} />;
  const data = history.data;
  const attempts = data.attempts.filter((a) => (!filter || `${a.question.prompt} ${a.attempt_id} ${a.effective.observations.map((o) => o.skill_id).join(" ")}`.toLowerCase().includes(filter.toLowerCase())) && (!onlyRevised || a.revisions.length > 0));
  return (
    <div className="ll-page">
      <ReturnLink />
      <PageHeader title="Study history" subtitle={data.note} />
      <Tabs defaultValue="attempts">
        <TabList label="History views"><Tab value="attempts">Attempts ({data.attempts.length})</Tab><Tab value="conversations">Conversations ({data.conversations.length})</Tab></TabList>
        <TabPanel value="attempts" className="pt-3">
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <input type="search" className="ll-input max-w-xs" placeholder="Filter by question, skill or id…" aria-label="Filter attempts" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <label className="flex items-center gap-2"><input type="checkbox" className="size-4" checked={onlyRevised} onChange={(e) => setOnlyRevised(e.target.checked)} /> Only attempts with corrections</label>
          </div>
          {attempts.length === 0 ? <EmptyState title={data.attempts.length ? "No attempt matches" : "Not assessed"}>{data.attempts.length ? "Clear the filter to see all attempts." : "No attempt is recorded for this course yet."}</EmptyState> : (
            <ul className="flex flex-col gap-3">
              {attempts.map((a) => (
                <li key={a.attempt_id} id={a.attempt_id} className={`ll-card p-3 ${sessionId === a.attempt_id ? "outline outline-2 outline-accent" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono">{a.attempt_id}</span>
                    <StatusChip tone="neutral">{a.mode}</StatusChip>
                    <span className="text-muted">recorded {formatWhen(a.recorded_at)} · {a.occurred_at ? `happened ${formatWhen(a.occurred_at)}` : "time of the response not recorded"} ({TIME_BASIS_LABEL[a.time_basis] ?? a.time_basis})</span>
                  </div>
                  <p className="mt-2"><span className="ll-label">Question shown</span><br />{a.question.prompt}</p>
                  <p className="mt-2"><span className="ll-label">Your response {a.response.availability === "full_capture" ? "(full capture)" : a.response.availability === "capture_unavailable" ? "(excerpt; the full capture is no longer available)" : "(excerpt only — the full text was not retained)"}</span><br />
                    <span className="whitespace-pre-wrap">{a.response.full_text ?? a.response.excerpt}</span></p>
                  <div className="mt-2 flex flex-col gap-1 text-sm">
                    <span className="ll-label">{a.revisions.length ? "Assessment in effect (after correction)" : "Assessment"}</span>
                    {a.effective.observations.map((o) => (
                      <div key={o.skill_id} className="rounded border border-line/40 p-2">
                        <StatusChip tone={OUTCOME_LABEL[o.outcome]?.tone ?? "neutral"}>{OUTCOME_LABEL[o.outcome]?.label ?? o.outcome}</StatusChip> <span className="text-muted">{o.skill_id} · {ASSISTANCE_LABEL[o.assistance as string] ?? String(o.assistance)}</span>
                        <p className="text-muted">{o.analysis}</p>
                      </div>
                    ))}
                    {a.effective.conflict && <Callout tone="caution" title="Conflicting corrections">Two corrections branch from the same assessment. They need reconciliation; neither was chosen automatically.</Callout>}
                  </div>
                  {a.revisions.length > 0 && (
                    <details className="mt-2 text-sm">
                      <summary className="cursor-pointer font-medium">{a.revisions.length} correction{a.revisions.length === 1 ? "" : "s"} — the original assessment is kept</summary>
                      <ul className="mt-1 list-disc pl-5">
                        <li>Original: {a.original_observations.map((o) => `${o.skill_id}: ${OUTCOME_LABEL[o.outcome]?.label ?? o.outcome}`).join("; ")}</li>
                        {a.revisions.map((r) => <li key={r.event_id}>{formatWhen(r.recorded_at)} — {r.reason} <span className="text-muted">(a regrade of the same response, not a new answer)</span></li>)}
                      </ul>
                    </details>
                  )}
                  {a.question.question_id && <div className="mt-2"><Link className="ll-btn ll-btn-sm" to={`/courses/${courseId}/questions/${encodeURIComponent(a.question.question_id)}`}>Try again (new answer)</Link></div>}
                </li>
              ))}
            </ul>
          )}
        </TabPanel>
        <TabPanel value="conversations" className="pt-3">
          {data.conversations.length === 0 ? <EmptyState title="No captured conversation yet">Questions and explanations you send from this app are kept here exactly as submitted, with the tutor's delivered replies.</EmptyState> : (
            <ul className="flex flex-col gap-3">
              {data.conversations.map((c) => (
                <li key={c.run_id} className="ll-card p-3">
                  <h2 className="mb-2 font-mono text-sm">{c.run_id}</h2>
                  <ol className="flex flex-col gap-2 text-sm">
                    {c.entries.map((e, i) => (
                      <li key={i} className={`rounded p-2 ${e.kind === "tutor" ? "border-l-2 border-accent bg-raised" : "border border-line/40"}`}>
                        <span className="ll-label">{e.kind === "tutor" ? "Tutor reply (as delivered)" : e.kind === "submission" ? `Your ${e.interaction?.replace(/_/g, " ")}` : "Your question"} · {formatWhen(e.at)}</span>
                        {e.prompt && <p className="text-muted">Asked: {e.prompt}</p>}
                        <p className="whitespace-pre-wrap">{e.text}</p>
                        {e.kind === "learner_question" && <span className="text-muted">Not assessed</span>}
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ul>
          )}
        </TabPanel>
      </Tabs>
    </div>
  );
}
