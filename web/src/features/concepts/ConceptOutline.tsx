// Concept outline (UI19, R1-G1…G4): one typed read model shown for a Course, a Lecture or a Slide. It opens at topic
// level and loads a branch only when it is expanded, so 350 concepts and 449 criteria are never drawn at once. One
// catalog object can sit on several branches; it is the same object each time. Relations between questions are listed
// as links with the owner's label, never drawn as branches, and none grants credit. Selecting a node offers its
// Sources, Questions and Evidence.
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Callout, cn, ErrorState, LoadingState, PageHeader, StatusChip, Tab, TabList, TabPanel, Tabs } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { CONDITION_LABEL, FACET_LABEL, RELATION_LABEL, SKILL_STATUS } from "@/lib/labels";
import { useCourse } from "@/lib/queries";
import type { OutlineNodeView, OutlineRow, OutlineView } from "@/lib/types";
import { QuestionListItem } from "@/features/question/QuestionList";

const KIND_LABEL: Record<string, string> = { topic: "Topic", concept: "Concept", skill: "Skill", question: "Question", criterion: "Criterion" };

function useOutline(courseId: string, scope: string, parent: string | null, enabled = true) {
  return useQuery<OutlineView, Error>({
    queryKey: ["outline", courseId, scope, parent], enabled: !!courseId && enabled, retry: false, staleTime: 30_000,
    queryFn: ({ signal }) => apiGet<OutlineView>(`courses/${courseId}/outline?scope=${encodeURIComponent(scope)}${parent ? `&parent=${encodeURIComponent(parent)}` : ""}`, signal),
  });
}

function rowMeta(row: OutlineRow): string {
  if (row.kind === "topic" || row.kind === "concept") return [row.skills ? `${row.skills} skill${row.skills === 1 ? "" : "s"}` : "", row.questions ? `${row.questions} question${row.questions === 1 ? "" : "s"}` : "no question"].filter(Boolean).join(" · ");
  if (row.kind === "skill") return `${FACET_LABEL[row.facet ?? ""] ?? row.facet ?? ""} · ${SKILL_STATUS[row.status ?? "not_assessed"]?.label ?? row.status}`;
  if (row.kind === "question") return `${row.collection ?? ""}${row.slide_anchor === "none" ? " · names no slide" : ""}`;
  return row.on_parent_skill ? "assesses the skill above" : "assesses another skill of this question";
}

function Branch({ courseId, scope, row, selected, onSelect }: { courseId: string; scope: string; row: OutlineRow; selected: string | null; onSelect: (row: OutlineRow) => void }) {
  const [open, setOpen] = useState(false);
  const children = useOutline(courseId, scope, row.instance_id, open && row.has_children);
  return (
    <li role="treeitem" aria-expanded={row.has_children ? open : undefined} aria-selected={selected === row.instance_id} data-kind={row.kind} data-node={row.node_id}>
      <div className={cn("flex items-start gap-1 rounded-[var(--ll-radius)] px-1 py-1", selected === row.instance_id && "bg-raised outline outline-2 outline-accent")}>
        {row.has_children ? (
          <button type="button" className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded hover:bg-raised" aria-label={`${open ? "Collapse" : "Expand"} ${row.label}`} onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronDown aria-hidden className="size-4" /> : <ChevronRight aria-hidden className="size-4" />}
          </button>
        ) : <span className="size-7 shrink-0" aria-hidden />}
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelect(row)}>
          <span className="block"><span className="mr-2 text-sm text-muted">{KIND_LABEL[row.kind] ?? row.kind}</span>{row.label}</span>
          <span className="block text-sm text-muted">{rowMeta(row)}{row.repeated_on_path ? " · already on this branch (not expanded again)" : ""}</span>
        </button>
      </div>
      {open && row.has_children && (
        <ul role="group" className="ml-5 border-l border-line/40 pl-2">
          {children.isLoading && <li className="px-2 py-1 text-sm text-muted">Loading…</li>}
          {children.isError && <li className="px-2 py-1 text-sm text-danger">This branch could not be loaded.</li>}
          {children.data?.rows.map((child) => <Branch key={child.instance_id} courseId={courseId} scope={scope} row={child} selected={selected} onSelect={onSelect} />)}
          {children.data?.truncated && <li className="px-2 py-1 text-sm text-muted">Showing {children.data.rows.length} of {children.data.total_children}. Narrow the scope to see the rest.</li>}
        </ul>
      )}
    </li>
  );
}

function NodeDetail({ courseId, nodeId }: { courseId: string; nodeId: string }) {
  const [tab, setTab] = useState("sources");
  const detail = useQuery<OutlineNodeView, Error>({ queryKey: ["outline-node", courseId, nodeId], retry: false, queryFn: ({ signal }) => apiGet<OutlineNodeView>(`courses/${courseId}/outline/node?id=${encodeURIComponent(nodeId)}`, signal) });
  if (detail.isLoading) return <LoadingState label="Reading this node…" />;
  if (detail.isError || !detail.data) return <ErrorState error={detail.error} />;
  const d = detail.data;
  return (
    <section aria-label="Selected node" className="ll-card flex min-h-0 flex-col gap-2 p-4" data-testid="outline-detail">
      <p className="ll-label">{KIND_LABEL[d.node.kind] ?? d.node.kind}</p>
      <h2 className="text-xl font-semibold">{d.node.label}</h2>
      <p className="break-all text-sm text-muted">{d.node.node_id}{d.parents.length ? ` · under ${d.parents.map((p) => p.label).join(", ")}` : ""}</p>
      <Tabs value={tab} onValueChange={setTab}>
        <TabList label="About this node">
          <Tab value="sources">Sources ({d.sources_total})</Tab>
          <Tab value="questions">Questions ({d.questions_total})</Tab>
          <Tab value="evidence">Evidence</Tab>
        </TabList>
        <TabPanel value="sources" className="pt-3">
          {d.sources.length === 0 ? <p className="text-muted">The course catalog names no source location for this node. That is a gap in the record, not something this app fills in.</p> : (
            <ul className="flex flex-col gap-1">
              {d.sources.map((s, i) => (
                <li key={i} className="rounded border border-line/40 p-2">
                  <span className="font-medium">{s.source_id ?? "source not identified"}</span>{" "}
                  <span className="text-sm text-muted">{s.kind === "transcript_lines" ? `transcript lines ${(s.ranges ?? []).map(([a, b]) => (a === b ? a : `${a}–${b}`)).join(", ")}`
                    : s.ranges ? `pages ${s.ranges.map(([a, b]) => (a === b ? a : `${a}–${b}`)).join(", ")}` : s.locator_text} · {s.basis} · from {s.from}</span>
                  {s.lecture_id && s.kind === "pages" && s.ranges?.[0] && <Link className="ml-2 text-sm text-accent underline" to={`/courses/${courseId}/lectures/${s.lecture_id}?page=${s.ranges[0][0]}`}>Open slide {s.ranges[0][0]}</Link>}
                </li>
              ))}
            </ul>
          )}
        </TabPanel>
        <TabPanel value="questions" className="pt-3">
          {d.questions.length === 0 ? <p className="text-muted">No catalogued question assesses this node.</p> : <ul className="flex flex-col gap-2">{d.questions.map((q) => <QuestionListItem key={q.question_id} courseId={courseId} row={q} />)}</ul>}
          {d.questions_total > d.questions.length && <p className="mt-2 text-sm text-muted">Showing {d.questions.length} of {d.questions_total}. <Link className="text-accent underline" to={`/courses/${courseId}/questions`}>Open the question bank</Link></p>}
          {d.links.length > 0 && (
            <div className="mt-3">
              <p className="ll-label mb-1">Relations to other questions</p>
              <ul className="flex flex-col gap-1">
                {d.links.map((l, i) => <li key={i} className="text-sm"><StatusChip tone="neutral">{RELATION_LABEL[l.relation] ?? l.relation.replace(/_/g, " ")}</StatusChip> {l.direction === "from_this" ? "→" : "←"} <Link className="text-accent underline" to={`/courses/${courseId}/questions/${encodeURIComponent(l.other)}`}>{l.other_label}</Link> <span className="text-muted">({l.other}; no automatic credit)</span></li>)}
              </ul>
            </div>
          )}
        </TabPanel>
        <TabPanel value="evidence" className="pt-3">
          {d.evidence.note && <Callout tone="unassessed" className="mb-2">{d.evidence.note}</Callout>}
          {d.evidence.skills.length === 0 ? <p className="text-muted">No skill of the catalog is bound to this node.</p> : (
            <ul className="flex flex-col gap-1">
              {d.evidence.skills.map((s) => (
                <li key={s.skill_id} className="rounded border border-line/40 p-2">
                  <p className="font-medium">{s.label}</p>
                  <p className="text-sm text-muted">{SKILL_STATUS[s.status]?.label ?? s.status} · {FACET_LABEL[s.facet] ?? s.facet} · {s.episodes} recorded episode{s.episodes === 1 ? "" : "s"}
                    {s.episodes ? ` · ${Object.entries(s.observations_by_condition).filter(([, n]) => n > 0).map(([c, n]) => `${n} ${CONDITION_LABEL[c] ?? c}`).join(", ")}` : ""}</p>
                </li>
              ))}
            </ul>
          )}
          {d.evidence.skills_total > d.evidence.skills.length && <p className="mt-1 text-sm text-muted">Showing {d.evidence.skills.length} of {d.evidence.skills_total} skills.</p>}
          <p className="ll-measure mt-2 text-sm text-muted">Evidence is recorded per skill (unit: skill). Counts are recorded observations by condition; no score is computed.</p>
        </TabPanel>
      </Tabs>
    </section>
  );
}

export function ConceptOutlinePage() {
  const { courseId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const scope = params.get("scope") ?? "course";
  const course = useCourse(courseId);
  const top = useOutline(courseId, scope, null);
  const [selected, setSelected] = useState<OutlineRow | null>(null);
  const setScope = (value: string) => {
    setSelected(null);
    setParams(value === "course" ? {} : { scope: value }, { replace: true });
  };
  if (top.isLoading) return <LoadingState label="Reading the course catalogs…" />;
  if (top.isError || !top.data) return <ErrorState error={top.error} retry={() => void top.refetch()} />;
  const data = top.data;
  const counts = data.canonical_counts;
  const lectureScope = scope.startsWith("lecture:") ? scope.slice(8) : scope.startsWith("slide:") ? scope.split(":")[1]! : "";
  return (
    <div className="ll-page" data-testid="concept-outline">
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted">
        <Link to="/progress" className="hover:underline">Progress</Link> › <span aria-current="page">Concept outline</span>
      </nav>
      <PageHeader title="Concept outline" subtitle={<span data-testid="outline-counts">{course.data?.display_name ?? courseId.toUpperCase()} · {counts.topic} topics · {counts.concept} concepts · {counts.skill} skills · {counts.question} questions · {counts.criterion} criteria</span>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">Scope
          <select className="ll-input w-auto" aria-label="Scope" value={scope.startsWith("slide:") ? `lecture:${lectureScope}` : scope} onChange={(e) => setScope(e.target.value)}>
            <option value="course">Whole course</option>
            {(course.data?.lectures ?? []).map((l) => <option key={l.lecture_id} value={`lecture:${l.lecture_id}`}>{l.title} ({l.questions.count} questions)</option>)}
          </select>
        </label>
        {scope.startsWith("slide:") && <StatusChip tone="neutral">Slide {scope.split(":")[2]} only <button type="button" className="ml-1 underline" onClick={() => setScope(`lecture:${lectureScope}`)}>show the whole lecture</button></StatusChip>}
        <span className="text-sm text-muted" data-testid="outline-scope-count">{data.scope.questions_in_scope} question{data.scope.questions_in_scope === 1 ? "" : "s"} in this scope</span>
      </div>
      <p className="ll-measure mb-3 text-sm text-muted">{data.scope.note}{data.scope.questions_without_slide_anchor?.length ? ` ${data.scope.questions_without_slide_anchor.length} question${data.scope.questions_without_slide_anchor.length === 1 ? "" : "s"} of this lecture name no slide in the course record.` : ""}</p>
      {data.scope.gap && <Callout tone="unassessed" className="mb-3" title="No question collection for this lecture">{data.scope.gap}</Callout>}
      {data.scope.related_questions?.length ? <p className="mb-3 text-sm text-muted">Related, not placed on this slide by the course record: {data.scope.related_questions.join(", ")}.</p> : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,36rem)]">
        <section aria-label="Outline">
          {data.rows.length === 0 ? <Callout tone="unassessed" title="Nothing in this scope">{data.scope.note}</Callout> : (
            <ul role="tree" aria-label="Concept outline" className="ll-card p-2" data-testid="outline-tree">
              {data.rows.map((row) => <Branch key={row.instance_id} courseId={courseId} scope={scope} row={row} selected={selected?.instance_id ?? null} onSelect={setSelected} />)}
            </ul>
          )}
          <p className="ll-measure mt-2 text-sm text-muted">{data.note}</p>
        </section>
        {selected ? <NodeDetail courseId={courseId} nodeId={selected.node_id} /> : <p className="ll-card self-start p-4 text-muted">Select a topic, concept, skill, question or criterion to see its sources, questions and recorded evidence.</p>}
      </div>
    </div>
  );
}
