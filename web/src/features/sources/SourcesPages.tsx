// Sources (UI05) and SC05 Source detail. The inventory lists every unit and file with its own state;
// preparation stages are shown separately from registration, and neither says anything about learning.
// This app never registers a source itself: new material stays with the existing course updater.
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/app/state";
import { Button, Callout, Dialog, EmptyState, ErrorState, Field, LoadingState, PageHeader, StatusChip } from "@/components/ui";
import { apiGet, apiPost, contentUrl } from "@/lib/api";
import { dispositionLabel, kindLabel, SESSION_STATE, SOURCE_STATE } from "@/lib/labels";
import { useCourse } from "@/lib/queries";
import type { InventoryItem } from "@/lib/types";
import { ReturnLink } from "@/features/search/SearchOverlay";
import { SlideCanvas } from "@/features/lecture/SlideCanvas";
import { useSubmitActions } from "@/features/tutor/actions";

function bytes(n: number | null): string {
  if (n === null || n === undefined) return "size unknown";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function ItemRow({ courseId, item }: { courseId: string; item: InventoryItem }) {
  const state = SOURCE_STATE[item.state] ?? { label: item.state, tone: "neutral" as const, detail: "" };
  const restricted = item.disclosure === "restricted_solution";
  return (
    <li className="ll-card flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
      <div className="min-w-0">
        <p className="font-medium">{item.filename ?? item.source_id}</p>
        <p className="text-muted">{kindLabel(item.kind)} · {bytes(item.bytes)} · {item.registration === "registered" ? "registered by the course updater" : "not registered"}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {restricted && <StatusChip tone="caution">Answer material — opens only by deliberate reveal</StatusChip>}
        <StatusChip tone={state.tone} title={state.detail}>{state.label}</StatusChip>
        <Link className="ll-btn ll-btn-sm" to={`/courses/${courseId}/sources/${encodeURIComponent(item.source_id)}`}>Details</Link>
      </div>
    </li>
  );
}

export function SourcesPage() {
  const app = useApp();
  const courseId = app.courseId;
  const course = useCourse(courseId);
  const queryClient = useQueryClient();
  const actions = useSubmitActions();
  const [hintOpen, setHintOpen] = useState(false);
  const [ids, setIds] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (!courseId) return <EmptyState title="No course selected">Choose a course in the header.</EmptyState>;
  if (course.isLoading) return <LoadingState label="Reading the source inventory…" />;
  if (course.isError || !course.data) return <ErrorState error={course.error} retry={() => void course.refetch()} />;
  const data = course.data;
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
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Sources" subtitle={`${data.display_name} — inventory, versions and preparation`} actions={<>
        <Button onClick={prepare} busy={busy === "prepare"}>Prepare a batch now</Button>
        <Button onClick={() => setHintOpen(true)}>Tell the Brain about new material</Button>
      </>} />
      {notice && <Callout tone="accent" role="status" className="mb-3" title="Preparation">{notice}</Callout>}
      {data.index.status === "ok" ? (
        <p className="mb-3 text-sm text-muted">Course source index revision {data.index.revision} (as of {data.index.as_of}). It is a logistics index kept by the course updater; files it has not registered are still listed here from the folder itself.</p>
      ) : <Callout tone="caution" className="mb-3" title="The published source index is temporarily not trusted">{data.index.reason}</Callout>}
      {data.enumeration_truncated && <Callout tone="caution" className="mb-3" title="Listing truncated">This course has more files than one listing shows. The total is not complete on this page.</Callout>}

      <section aria-labelledby="lectures-h" className="mb-6">
        <h2 id="lectures-h" className="mb-2 text-lg font-semibold">Lecture units ({data.lectures.length})</h2>
        <ul className="flex flex-col gap-2">
          {data.lectures.map((lecture) => {
            const prep = dispositionLabel(lecture.disposition);
            return (
              <li key={lecture.lecture_id} className="ll-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{lecture.displayable ? <Link className="hover:underline" to={`/courses/${courseId}/lectures/${lecture.lecture_id}`}>{lecture.title}</Link> : lecture.title}</h3>
                  <StatusChip tone={prep.tone}>{prep.label}</StatusChip>
                </div>
                {prep.detail && <p className="text-sm text-muted">{prep.detail}</p>}
                <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                  <dt className="text-muted">Slides</dt>
                  <dd>{lecture.deck ? `${lecture.deck.filename} — ${SOURCE_STATE[lecture.deck.state]?.label ?? lecture.deck.state}${lecture.deck.rendition === "needs_rendition" ? " · needs a PDF rendition to display" : ""}` : "No slide file in this unit"}</dd>
                  <dt className="text-muted">Slide links</dt>
                  <dd>{lecture.pages ? `${lecture.pages_confirmed} reviewed · ${lecture.pages_suggested} suggested by transcript wording (no recording times) · ${lecture.pages_unresolved ?? 0} unresolved of ${lecture.pages} slides` : "not prepared"}</dd>
                  {lecture.other_materials_count > 0 && <><dt className="text-muted">Other files</dt><dd>{lecture.other_materials_count} more in this unit — listed under Sources when the lecture is open</dd></>}
                  <dt className="text-muted">Sessions</dt>
                  <dd>{lecture.sessions.length ? lecture.sessions.map((s) => `${s.date}: ${SESSION_STATE[s.state]?.label ?? s.state}`).join(" · ") : "none linked by the course records"}</dd>
                </dl>
              </li>
            );
          })}
        </ul>
      </section>

      {data.unlinked_sessions.length > 0 && (
        <section aria-labelledby="sessions-h" className="mb-6">
          <h2 id="sessions-h" className="mb-2 text-lg font-semibold">Sessions with no recorded lecture link ({data.unlinked_sessions.length})</h2>
          <ul className="flex flex-col gap-2">
            {data.unlinked_sessions.map((s) => (
              <li key={s.session_id} className="ll-card p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{s.date}</span><StatusChip tone={SESSION_STATE[s.state]?.tone ?? "neutral"}>{SESSION_STATE[s.state]?.label ?? s.state}</StatusChip></div>
                {s.items.length > 0 && <ul className="mt-2 flex flex-col gap-1">{s.items.map((i) => <ItemRow key={i.source_id} courseId={courseId} item={i} />)}</ul>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="other-h">
        <h2 id="other-h" className="mb-2 text-lg font-semibold">Other course sources ({data.other_sources.length})</h2>
        {data.other_sources.length === 0 ? <p className="text-muted">No other files were found under this course's materials.</p> : (
          <ul className="flex flex-col gap-1">{data.other_sources.map((item) => <ItemRow key={item.source_id} courseId={courseId} item={item} />)}</ul>
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
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">Destination course: <strong className="text-ink">{data.display_name}</strong>. Files you put in the course folder are detected on the next inventory read even without a hint.</p>
          <Field label="Google Drive file ID(s)" htmlFor="hint-ids" hint="IDs only (letters, digits, - and _), separated by spaces. Links and paths are not accepted.">
            <input id="hint-ids" className="ll-input" value={ids} onChange={(e) => setIds(e.target.value)} aria-invalid={ids.length > 0 && !idsValid} />
          </Field>
          <Field label="What is it?" htmlFor="hint-reason"><input id="hint-reason" className="ll-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Lecture 8 slides uploaded today" /></Field>
        </div>
      </Dialog>
    </div>
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
  if (detail.isLoading) return <LoadingState label="Resolving source…" />;
  if (detail.isError || !detail.data) return <><ReturnLink /><ErrorState error={detail.error} /></>;
  const item = detail.data;
  const state = SOURCE_STATE[item.state] ?? { label: item.state, tone: "neutral" as const, detail: "" };
  const restricted = item.disclosure === "restricted_solution";
  const openable = ["registered_readable", "present_unindexed"].includes(item.state);
  const base = `sources/${courseId}/${encodeURIComponent(sourceId)}/content`;
  const url = contentUrl(restricted ? `${base}?reveal=${revealToken}` : base);
  const isPdf = item.media_type === "application/pdf";
  const isMedia = !!item.media_type && (item.media_type.startsWith("audio/") || item.media_type.startsWith("video/"));

  return (
    <div className="mx-auto max-w-4xl">
      <ReturnLink />
      <PageHeader title={item.filename ?? item.source_id} subtitle={`${kindLabel(item.kind)} · ${item.kind_basis === "owner_index" ? "kind from the course index" : "kind inferred from its folder"}`} />
      <dl className="ll-card mb-4 grid gap-x-4 gap-y-1 p-3 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted">State</dt><dd><StatusChip tone={state.tone}>{state.label}</StatusChip> <span className="text-muted">{state.detail}</span></dd>
        <dt className="text-muted">Source id</dt><dd className="break-all font-mono">{item.source_id}</dd>
        {item.identity === "provisional" && (
          <><dt className="text-muted">Identity</dt><dd data-testid="identity-note"><StatusChip tone="caution">Provisional</StatusChip> <span className="text-muted">{item.identity_note}</span></dd></>
        )}
        <dt className="text-muted">Version</dt><dd className="break-all font-mono">{item.version_id ?? "not identified (file has not been hashed)"}</dd>
        <dt className="text-muted">Size / type</dt><dd>{bytes(item.bytes)} · {item.media_type ?? "unknown type"}</dd>
        {item.historical_versions.length > 0 && (
          <><dt className="text-muted">Earlier versions</dt><dd>{item.historical_versions.map((v) => v.version_id).join(", ")} — historical bytes are not available; only the current file can be opened.</dd></>
        )}
      </dl>
      {error && <Callout tone="danger" role="alert" title="Could not open" className="mb-3">{error}</Callout>}
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
        <>
          <div className="mb-2 flex items-center gap-2">
            <Button size="sm" disabled={page <= 1} onClick={() => setParams({ page: String(page - 1) }, { replace: true })}>Previous page</Button>
            <span className="text-sm" aria-live="polite">PDF page {page}{pages ? ` of ${pages}` : ""}</span>
            <Button size="sm" disabled={!!pages && page >= pages} onClick={() => setParams({ page: String(page + 1) }, { replace: true })}>Next page</Button>
          </div>
          <SlideCanvas url={url} page={page} label={`${item.filename}, PDF page ${page} — original source`} onPageCount={setPages} />
        </>
      ) : isMedia ? (
        item.media_type!.startsWith("video/") ? <video controls preload="metadata" src={url} className="w-full" /> : <audio controls preload="metadata" src={url} className="w-full" />
      ) : item.media_type?.startsWith("text/") ? (
        <TextSource url={url} line={Number(params.get("line")) || null} />
      ) : (
        <Callout tone="unassessed" title="This file type is not displayed in the app">It stays in the course folder unchanged. {item.rendition === "needs_rendition" ? "A labelled PDF rendition can be produced when an approved converter is installed." : ""}</Callout>
      )}
    </div>
  );
}

function TextSource({ url, line: wanted }: { url: string; line: number | null }) {
  const text = useQuery<string, Error>({ queryKey: ["text-source", url], queryFn: async () => (await fetch(url)).text(), retry: false });
  if (text.isLoading) return <LoadingState />;
  if (text.isError) return <ErrorState error={text.error} />;
  return (
    <ol className="ll-card max-h-[70dvh] overflow-auto p-3 text-sm" aria-label="Text source, numbered lines">
      {(text.data ?? "").split(/\r?\n/).map((line, i) => (
        <li key={i} className={`flex gap-3 ${wanted === i + 1 ? "rounded bg-raised font-medium outline outline-2 outline-focus" : ""}`} aria-current={wanted === i + 1 ? "location" : undefined}
          ref={wanted === i + 1 ? (el) => el?.scrollIntoView({ block: "center" }) : undefined}>
          <span className="w-10 shrink-0 text-right tabular-nums text-muted">{i + 1}</span><span className="whitespace-pre-wrap">{line}</span>
        </li>
      ))}
    </ol>
  );
}
