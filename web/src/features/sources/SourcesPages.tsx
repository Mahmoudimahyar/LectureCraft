// Library (UI05; the course-wide sources page, named apart from the lecture panel's Sources tab) and SC05 Source detail.
// The inventory lists every unit and file with its own state; preparation stages are shown separately from
// registration, and neither says anything about learning. This app never registers a source itself: new material
// stays with the existing course updater.
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/app/state";
import { Button, cn, Dialog, EmptyState, ErrorState, Field, LoadingState, PageHeader } from "@/components/ui";
import { apiGet, apiPost, contentUrl } from "@/lib/api";
import { dispositionLabel, kindLabel, nb, SESSION_STATE, SOURCE_STATE, TIMING_STAGE_LABEL, unlistedLabel } from "@/lib/labels";
import { useCourse, useCourseTiming } from "@/lib/queries";
import type { InventoryItem } from "@/lib/types";
import { Callout, Details, Fact, Facts, Page, ReturnLink, StateWords } from "@/features/search/SearchOverlay";
import { SlideCanvas } from "@/features/lecture/SlideCanvas";
import { useSubmitActions } from "@/features/tutor/actions";

/** A list of entries on one surface, parted by hairlines: never a wall of boxes. */
const ROWS = "ll-region flex flex-col";
const ROW = "border-t border-hairline p-4 first:border-t-0 min-[900px]:px-5";
const SECTION_HEAD = "mb-3 text-head font-semibold";

function bytes(n: number | null): string {
  if (n === null || n === undefined) return "size unknown";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function ItemRow({ courseId, item, nested = false }: { courseId: string; item: InventoryItem; nested?: boolean }) {
  const state = SOURCE_STATE[item.state] ?? { label: unlistedLabel(item.state), tone: "neutral" as const, detail: "" };
  const restricted = item.disclosure === "restricted_solution";
  return (
    <li className={cn("flex flex-wrap items-center justify-between gap-x-6 gap-y-2", nested ? "border-t border-hairline py-3 first:border-t-0 last:pb-0" : ROW)}>
      <div className="min-w-0 flex-1 basis-72">
        <p className="break-words font-semibold">{item.filename ?? item.source_id}</p>
        <p className="ll-num text-ui text-muted">{kindLabel(item.kind)} · {bytes(item.bytes)} · {item.registration === "registered" ? "registered by the course updater" : "not registered"}</p>
        {restricted && <p className="text-ui text-muted">Answer material — opens only by deliberate reveal</p>}
      </div>
      <div className="flex flex-none flex-wrap items-center gap-x-4 gap-y-2">
        <StateWords tone={state.tone} detail={state.detail}>{state.label}</StateWords>
        <Link className="ll-btn ll-btn-sm" to={`/courses/${courseId}/sources/${encodeURIComponent(item.source_id)}`}>Details</Link>
      </div>
    </li>
  );
}

export function SourcesPage() {
  const app = useApp();
  const courseId = app.courseId;
  const course = useCourse(courseId);
  // The stage of speech timing per lecture, as the Brain measured it; the row simply has no such line until it arrives.
  const timing = useCourseTiming(courseId, { queue: false });
  const queryClient = useQueryClient();
  const actions = useSubmitActions();
  const [hintOpen, setHintOpen] = useState(false);
  const [ids, setIds] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (!courseId) return <Page><EmptyState title="No course selected">Choose a course in the header.</EmptyState></Page>;
  if (course.isLoading) return <Page><LoadingState label="Reading the source inventory…" /></Page>;
  if (course.isError || !course.data) return <Page><ErrorState error={course.error} retry={() => void course.refetch()} /></Page>;
  const data = course.data;
  const stageOf = new Map((timing.data?.lectures ?? []).map((lecture) => [lecture.lecture_id, lecture.stage]));
  const driveIds = ids.split(/[\s,]+/).filter(Boolean);
  const idsValid = driveIds.length > 0 && driveIds.every((id) => /^[A-Za-z0-9_-]{1,256}$/.test(id));

  const prepare = async () => {
    setBusy("prepare");
    try {
      const report = await apiPost<{ processed: string[]; unchanged: number; remaining_unprepared: number }>(`prepare/${courseId}`);
      setNotice(`Prepared ${report.processed.length} lecture unit(s); ${report.unchanged} unchanged; ${report.remaining_unprepared} still waiting (bounded batch — run again to continue).`);
      await queryClient.invalidateQueries();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page>
      <PageHeader title="Library" subtitle={`${data.display_name} — inventory, versions and preparation`} actions={<>
        <Button onClick={prepare} busy={busy === "prepare"}>Prepare a batch now</Button>
        <Button onClick={() => setHintOpen(true)}>Tell the Brain about new material</Button>
      </>} />
      {notice && <Callout tone="accent" role="status" className="mb-4" title="Preparation">{notice}</Callout>}
      {data.index.status === "ok" ? (
        <p className="ll-measure mb-6 text-read text-muted">Course source index revision {data.index.revision} (as of {data.index.as_of}). It is a logistics index kept by the course updater; files it has not registered are still listed here from the folder itself.</p>
      ) : <Callout tone="caution" className="mb-6" title="The published source index is temporarily not trusted">{data.index.reason}</Callout>}
      {data.enumeration_truncated && <Callout tone="caution" className="mb-6" title="Listing truncated">This course has more files than one listing shows. The total is not complete on this page.</Callout>}

      <section aria-labelledby="lectures-h" className="mb-8">
        <h2 id="lectures-h" className={SECTION_HEAD}>Lecture units <span className="ll-sec-n">({data.lectures.length})</span></h2>
        <ul className={ROWS}>
          {data.lectures.map((lecture) => {
            const prep = dispositionLabel(lecture.disposition);
            const stage = stageOf.get(lecture.lecture_id);
            return (
              <li key={lecture.lecture_id} className={ROW}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <h3 className="min-w-0 font-semibold">{lecture.displayable ? <Link className="hover:underline" to={`/courses/${courseId}/lectures/${lecture.lecture_id}`}>{lecture.title}</Link> : lecture.title}</h3>
                  <StateWords tone={prep.tone}>{prep.label}</StateWords>
                </div>
                {prep.detail && <p className="ll-measure text-ui text-muted">{prep.detail}</p>}
                <Facts className="mt-3">
                  <Fact term="Slides">{lecture.deck ? `${lecture.deck.filename} — ${SOURCE_STATE[lecture.deck.state]?.label ?? lecture.deck.state}${lecture.deck.rendition === "needs_rendition" ? " · needs a PDF rendition to display" : ""}` : "No slide file in this unit"}</Fact>
                  <Fact term="Slide links">{lecture.pages ? `${nb(`${lecture.pages_confirmed} reviewed`)} · ${lecture.pages_suggested} suggested by transcript wording (no recording times) · ${nb(`${lecture.pages_unresolved ?? 0} unresolved of ${lecture.pages} pages`)}` : "not prepared"}</Fact>
                  {stage && <Fact term="Speech timing">{(TIMING_STAGE_LABEL as Record<string, string | undefined>)[stage] ?? unlistedLabel(String(stage))}</Fact>}
                  {lecture.other_materials_count > 0 && <Fact term="Other files">{lecture.other_materials_count} more in this unit — listed under Sources when the lecture is open</Fact>}
                  <Fact term="Sessions">{lecture.sessions.length ? lecture.sessions.map((s) => `${s.date}: ${SESSION_STATE[s.state]?.label ?? s.state}`).join(" · ") : "none linked by the course records"}</Fact>
                </Facts>
              </li>
            );
          })}
        </ul>
      </section>

      {data.unlinked_sessions.length > 0 && (
        <section aria-labelledby="sessions-h" className="mb-8">
          <h2 id="sessions-h" className={SECTION_HEAD}>Sessions with no recorded lecture link <span className="ll-sec-n">({data.unlinked_sessions.length})</span></h2>
          <ul className={ROWS}>
            {data.unlinked_sessions.map((s) => (
              <li key={s.session_id} className={ROW}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1"><span className="ll-num font-semibold">{s.date}</span><StateWords tone={SESSION_STATE[s.state]?.tone ?? "neutral"}>{SESSION_STATE[s.state]?.label ?? unlistedLabel(s.state)}</StateWords></div>
                {s.items.length > 0 && <ul className="mt-2 flex flex-col">{s.items.map((i) => <ItemRow key={i.source_id} courseId={courseId} item={i} nested />)}</ul>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="other-h">
        <h2 id="other-h" className={SECTION_HEAD}>Other course sources <span className="ll-sec-n">({data.other_sources.length})</span></h2>
        {data.other_sources.length === 0 ? <p className="text-muted">No other files were found under this course's materials.</p> : (
          <ul className={ROWS}>{data.other_sources.map((item) => <ItemRow key={item.source_id} courseId={courseId} item={item} />)}</ul>
        )}
      </section>

      <Dialog open={hintOpen} onOpenChange={setHintOpen} title="Tell the Brain about new material" description="This sends a hint only. Registering a source stays with the existing course updater; this app does not register or copy files."
        footer={<><Button onClick={() => setHintOpen(false)}>Cancel</Button>
          <Button variant="primary" busy={busy === "hint"} disabled={!idsValid || reason.trim().length < 3} onClick={async () => {
            setBusy("hint");
            try {
              await actions.control(courseId, "source_hint", { drive_file_ids: driveIds, reason: reason.trim() }, { label: "Source hint", text: reason.trim() });
              setHintOpen(false);
              setIds("");
              setReason("");
              setNotice("Hint sent. The inventory will be re-read; a duplicate export is compared by content, not registered as new.");
            } catch (e) {
              setNotice((e as Error).message);
            } finally {
              setBusy(null);
            }
          }}>Send hint</Button></>}>
        <div className="flex flex-col gap-4">
          <p className="text-ui text-muted">Destination course: <strong className="text-ink">{data.display_name}</strong>. Files you put in the course folder are detected on the next inventory read even without a hint.</p>
          <Field label="Google Drive file ID(s)" htmlFor="hint-ids" hint="IDs only (letters, digits, - and _), separated by spaces. Links and paths are not accepted.">
            <input id="hint-ids" className="ll-input" value={ids} onChange={(e) => setIds(e.target.value)} aria-invalid={ids.length > 0 && !idsValid} />
          </Field>
          <Field label="What is it?" htmlFor="hint-reason"><input id="hint-reason" className="ll-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Lecture 8 slides uploaded today" /></Field>
        </div>
      </Dialog>
    </Page>
  );
}

interface SourceDetailView extends InventoryItem {
  version_id: string | null;
  sha256: string | null;
  kind_basis: string;
  identity?: "registered" | "provisional";
  identity_note?: string | null;
  role: string | null;
  historical_versions: Array<{ version_id: string; sha256: string | null; availability: string; bytes_available: boolean }>;
}

export function SourceDetail() {
  const { courseId = "", sourceId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [revealToken, setRevealToken] = useState<string | null>(null);
  const [pages, setPages] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const detail = useQuery<SourceDetailView, Error>({ queryKey: ["source", courseId, sourceId], queryFn: () => apiGet(`sources/${courseId}/${encodeURIComponent(sourceId)}`), retry: false });
  if (detail.isLoading) return <Page><LoadingState label="Resolving source…" /></Page>;
  if (detail.isError || !detail.data) return <Page><ReturnLink /><ErrorState error={detail.error} /></Page>;
  const item = detail.data;
  const state = SOURCE_STATE[item.state] ?? { label: unlistedLabel(item.state), tone: "neutral" as const, detail: "" };
  const restricted = item.disclosure === "restricted_solution";
  const openable = ["registered_readable", "present_unindexed"].includes(item.state);
  const base = `sources/${courseId}/${encodeURIComponent(sourceId)}/content`;
  const url = contentUrl(restricted ? `${base}?reveal=${revealToken}` : base);
  const isPdf = item.media_type === "application/pdf";
  const isMedia = !!item.media_type && (item.media_type.startsWith("audio/") || item.media_type.startsWith("video/"));

  return (
    <Page>
      <ReturnLink />
      <PageHeader title={item.filename ?? item.source_id} subtitle={`${kindLabel(item.kind)} · ${item.kind_basis === "owner_index" ? "kind from the course index" : "kind inferred from its folder"}`} />
      {/* What the file is and where it stands, in words. Its identifiers (source, version, earlier versions, media type) are under "Details". */}
      <Facts className="mb-3">
        <Fact term="State"><StateWords tone={state.tone}>{state.label}</StateWords>{state.detail && <span className="text-muted"> · {state.detail}</span>}</Fact>
        {item.identity === "provisional" && <Fact term="Identity" testId="identity-note">Provisional <span className="text-muted">· {item.identity_note}</span></Fact>}
        {!item.version_id && <Fact term="Version">not identified (file has not been hashed)</Fact>}
        <Fact term="Size"><span className="ll-num">{bytes(item.bytes)}</span>{!item.media_type && <span className="text-muted"> · unknown type</span>}</Fact>
        {item.historical_versions.length > 0 && (
          <Fact term="Earlier versions"><span className="ll-num">{item.historical_versions.length}</span> on record. Historical bytes are not available; only the current file can be opened.</Fact>
        )}
      </Facts>
      <Details className="mb-6" rows={[["Source", item.source_id], ["Version", item.version_id], ["Earlier versions", item.historical_versions.map((v) => v.version_id).join(", ")], ["Media type", item.media_type]]} />
      {error && <Callout tone="danger" role="alert" title="Could not open" className="mb-4">{error}</Callout>}
      {!openable ? (
        <Callout tone="unassessed" title="There is nothing to open for this source">{state.detail} No substitute from another file or edition is shown.</Callout>
      ) : restricted && !revealToken ? (
        <Callout tone="caution" title="This is answer material" actions={<Button onClick={async () => {
          try {
            const r = await apiPost<{ token: string }>("reveal", { course_id: courseId, source_id: sourceId });
            setRevealToken(r.token);
          } catch (e) {
            setError((e as Error).message);
          }
        }}>Reveal deliberately</Button>}>
          It is not shown as an ordinary source. Revealing it is recorded, and answers you submit afterwards are marked as given with the solution seen.
        </Callout>
      ) : isPdf ? (
        <div className="max-w-[64rem]">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Button size="sm" disabled={page <= 1} onClick={() => setParams({ page: String(page - 1) }, { replace: true })}>Previous page</Button>
            <span className="ll-num text-ui" aria-live="polite">PDF page {page}{pages ? ` of ${pages}` : ""}</span>
            <Button size="sm" disabled={!!pages && page >= pages} onClick={() => setParams({ page: String(page + 1) }, { replace: true })}>Next page</Button>
          </div>
          <SlideCanvas url={url} page={page} label={`${item.filename}, PDF page ${page} — original source`} onPageCount={setPages} />
        </div>
      ) : isMedia ? (
        item.media_type!.startsWith("video/") ? <video controls preload="metadata" src={url} className="w-full rounded-row" /> : <audio controls preload="metadata" src={url} className="w-full" />
      ) : item.media_type?.startsWith("text/") ? (
        <TextSource url={url} line={Number(params.get("line")) || null} />
      ) : (
        <Callout tone="unassessed" title="This file type is not displayed in the app">It stays in the course folder unchanged. {item.rendition === "needs_rendition" ? "A labelled PDF rendition can be produced when an approved converter is installed." : ""}</Callout>
      )}
    </Page>
  );
}

function TextSource({ url, line: wanted }: { url: string; line: number | null }) {
  const text = useQuery<string, Error>({ queryKey: ["text-source", url], queryFn: async () => (await fetch(url)).text(), retry: false });
  if (text.isLoading) return <LoadingState />;
  if (text.isError) return <ErrorState error={text.error} />;
  return (
    <ol className="ll-region max-h-[70dvh] overflow-auto py-3" aria-label="Text source, numbered lines">
      {(text.data ?? "").split(/\r?\n/).map((line, i) => (
        <li key={i} aria-current={wanted === i + 1 ? "location" : undefined}
          className={cn("relative flex gap-4 px-4 py-0.5", wanted === i + 1 && "bg-tint font-semibold before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-accent-text before:content-['']")}
          ref={wanted === i + 1 ? (el) => el?.scrollIntoView({ block: "center" }) : undefined}>
          <span className="ll-num w-10 flex-none text-right text-meta leading-[var(--ll-lh-read)] text-muted">{i + 1}</span><span className="ll-measure min-w-0 whitespace-pre-wrap">{line}</span>
        </li>
      ))}
    </ol>
  );
}
