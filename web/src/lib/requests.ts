// Deliberate submissions: explicit submit → frozen logical input → signed bundle → retained outbox →
// upload. No per-keystroke dispatch. A double click, a re-sync or a reconnect resolves to the same
// request identity for the same input; a genuinely new answer is a new learner event.
import { canonicalJsonBytes } from "@/contracts/validate";
import { buildRequestBundle, isoNow, newId, type BuiltBundle, type BundleFile } from "./bundle";
import { getLocalRequest, listOutbox, removeFromOutbox, retainInOutbox, saveLocalRequest, type DraftContext, type LocalRequest, type SourceRef } from "./db";
import { getOrCreateDevice, getPairing, nextSequence, sha256Hex } from "./device";
import { LoopbackTransport, uploadBundle, type Transport } from "./transport";
import type { AnnotationRecord, Artifact, QuestionRecord } from "./types";

export const TERM = "2026-fall";
export const transport: Transport = new LoopbackTransport();

export class NotPairedError extends Error {
  constructor() {
    super("This device is not paired with the Brain yet. Open Connect to pair it; your draft is kept.");
    this.name = "NotPairedError";
  }
}

export interface SubmitOutcome {
  requestId: string;
  logicalInputId: string;
  /** uploaded = bytes handed to the transport (not yet "received by Brain"); retained_locally = kept in the outbox; not_retained = nothing durable holds it. */
  delivery: "uploaded" | "retained_locally" | "not_retained";
  reason?: string;
  duplicate?: boolean;
}

export interface Conditions {
  assistance_before_answer: "none_reported" | "hint" | "formula" | "worked_solution" | "unknown";
  reference_access: "none_reported" | "notes" | "sources" | "unknown";
  prior_exposure: "unseen_reported" | "seen_question" | "seen_solution" | "unknown";
}

export function sessionId(): string {
  try {
    const existing = window.sessionStorage.getItem("ll.session");
    if (existing) return existing;
    const created = newId("session");
    window.sessionStorage.setItem("ll.session", created);
    return created;
  } catch {
    return (sessionIdFallback ??= newId("session"));
  }
}
let sessionIdFallback: string | null = null;

/**
 * Stable identity for "the same input submitted again" (double click, retry of the same draft text).
 * It is scoped to this device and this sitting: another device, or the same words typed on another
 * day, is a new request rather than a collision with (or a silent duplicate of) an earlier one.
 */
export async function stableIds(kind: string, key: string, text: string): Promise<{ requestId: string; logicalInputId: string }> {
  const device = await getOrCreateDevice();
  const digest = (await sha256Hex(new TextEncoder().encode([device.deviceId, sessionId(), kind, key, text].join("\u0000")))).slice(0, 24);
  return { requestId: `req-${digest}`, logicalInputId: `input-${digest}` };
}

interface SubmitArgs {
  courseId: string;
  bindingRevision: string;
  action: string;
  depth: "quick" | "standard" | "deep";
  requestId: string;
  logicalInputId: string;
  payload: Record<string, unknown>;
  parentRequestId?: string | null;
  attachments?: BundleFile[];
  label: string;
  context: DraftContext;
  text: string;
  answered?: LocalRequest["answered"];
}

async function deliver(bundle: BuiltBundle, record: LocalRequest): Promise<SubmitOutcome> {
  const retained = await retainInOutbox({
    requestId: bundle.requestId, courseId: bundle.courseId, createdAt: record.createdAt,
    files: bundle.files.map((f) => ({ path: f.path, bytes: f.bytes })), manifest: bundle.manifest, signature: bundle.signatureBytes, attempts: 0,
  });
  await saveLocalRequest(record);
  try {
    await uploadBundle(transport, bundle);
  } catch (error) {
    const reason = (error as Error).message;
    if (retained.durability === "saved_on_device") {
      await saveLocalRequest({ ...record, upload: "retained_locally" });
      return { requestId: bundle.requestId, logicalInputId: bundle.logicalInputId, delivery: "retained_locally", reason };
    }
    await saveLocalRequest({ ...record, upload: "upload_failed" });
    return { requestId: bundle.requestId, logicalInputId: bundle.logicalInputId, delivery: "not_retained", reason: `${reason} Local storage is also unavailable (${retained.reason ?? "unknown"}); copy your text to keep it.` };
  }
  await removeFromOutbox(bundle.requestId);
  await saveLocalRequest({ ...record, upload: "uploaded" });
  return { requestId: bundle.requestId, logicalInputId: bundle.logicalInputId, delivery: "uploaded" };
}

const BINDING = /^[a-f0-9]{64}$/;

export async function submit(args: SubmitArgs): Promise<SubmitOutcome> {
  const existing = await getLocalRequest(args.requestId);
  if (existing) {
    // Same input submitted again: reuse the original identity instead of creating a second request.
    return { requestId: existing.requestId, logicalInputId: existing.logicalInputId, delivery: existing.upload === "uploaded" ? "uploaded" : "retained_locally", duplicate: true };
  }
  const pairing = await getPairing();
  if (pairing.state !== "paired") throw new NotPairedError();
  // The workspace view may not have arrived yet (a fast submit after opening a page): fall back to the
  // binding this device was paired under. The Brain refuses a stale binding, so this cannot widen scope.
  const bindingRevision = BINDING.test(args.bindingRevision) ? args.bindingRevision : (pairing.bindingRevision ?? "");
  if (!BINDING.test(bindingRevision)) throw new Error("The workspace state from the Brain has not loaded yet, so nothing was sent. Your text is kept here — try again in a moment.");
  const device = await getOrCreateDevice();
  const bundle = await buildRequestBundle({
    device, sequence: await nextSequence(), courseId: args.courseId, term: TERM, threadKey: `tutor-${args.courseId}`, bindingRevision, action: args.action,
    depth: args.depth, payload: args.payload, requestId: args.requestId, logicalInputId: args.logicalInputId, parentRequestId: args.parentRequestId ?? null, attachments: args.attachments,
  });
  const record: LocalRequest = {
    requestId: bundle.requestId, courseId: args.courseId, action: args.action, depth: args.depth, logicalInputId: bundle.logicalInputId, parentRequestId: args.parentRequestId ?? null,
    createdAt: isoNow(), label: args.label, context: args.context, text: args.text, upload: "retained_locally", sessionId: sessionId(),
    ...(args.answered ? { answered: args.answered } : {}),
  };
  return deliver(bundle, record);
}

let flushing: Promise<{ sent: string[]; stillHeld: string[] }> | null = null;

/**
 * Try again to hand over bundles that were retained while delivery was unavailable. Never rebuilds or
 * re-signs them. Single-flight: the automatic retry and a manual "Send now" share one run, so a bundle
 * is uploaded once (and a repeated upload of identical bytes is harmless on the Brain anyway).
 */
export function flushOutbox(): Promise<{ sent: string[]; stillHeld: string[] }> {
  flushing ??= deliverRetained().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function deliverRetained(): Promise<{ sent: string[]; stillHeld: string[] }> {
  const sent: string[] = [];
  const stillHeld: string[] = [];
  for (const item of await listOutbox()) {
    try {
      for (const file of item.files) await transport.putFile(item.courseId, item.requestId, file.path, file.bytes);
      await transport.putFile(item.courseId, item.requestId, "ready.sig.json", item.signature);
      await transport.putFile(item.courseId, item.requestId, "ready.json", item.manifest);
      await removeFromOutbox(item.requestId);
      const record = await getLocalRequest(item.requestId);
      if (record) await saveLocalRequest({ ...record, upload: "uploaded" });
      sent.push(item.requestId);
    } catch {
      stillHeld.push(item.requestId);
    }
  }
  return { sent, stillHeld };
}

// ---- payload builders ---------------------------------------------------------------------------
const scopeOf = (courseId: string) => ({ course_id: courseId, term: TERM });

export function askPayload(courseId: string, requestId: string, text: string, sources: SourceRef[]) {
  return { contract: "ll.message/1", message_id: `msg-${requestId}`, request_id: requestId, scope: scopeOf(courseId), thread_key: `tutor-${courseId}`, reply_to_turn: null, role: "learner_question",
           text, sources, attachments: [], created_at: isoNow(), assessment_disposition: "not_assessed" };
}

export function submissionPayload(args: {
  courseId: string; requestId: string; logicalInputId: string; question: QuestionRecord; text: string; interaction: "explain_back" | "practice" | "review_answer" | "diagnostic_answer";
  conditions: Conditions; transcriptionRevision?: string | null; supersedes?: { record_id: string; artifact: Artifact } | null;
}) {
  const now = isoNow();
  return {
    contract: "ll.submission/1", turn_id: `turn-${args.requestId}`, logical_input_id: args.logicalInputId, scope: scopeOf(args.courseId), session_id: sessionId(), question: args.question,
    response: { kind: args.transcriptionRevision ? "voice_transcript" : "text", text: args.text, attachments: [], transcription_revision: args.transcriptionRevision ?? null },
    interaction: args.interaction, occurred_at: now, time_basis: "client_reported", captured_at: now, conditions: args.conditions, supersedes_capture: args.supersedes ?? null,
  };
}

export function controlPayload(courseId: string, requestId: string, command: Record<string, unknown>) {
  return { contract: "ll.control/1", event_id: `evt-${requestId}`, request_id: requestId, scope: scopeOf(courseId), created_at: isoNow(), command };
}

export function reviewItemPayload(args: { courseId: string; itemId: string; revision: number; question: QuestionRecord; kind: "recall" | "explanation" | "application" | "diagnostic" | "diagram";
  selection: "saved_only" | "active" | "suspended" | "retired"; schedulerConfig: Artifact | null; supersedes: { record_id: string; artifact: Artifact } | null }) {
  return { contract: "ll.review-item/1", item_id: args.itemId, scope: scopeOf(args.courseId), revision: args.revision, question: args.question, kind: args.kind === "diagnostic" ? "recall" : args.kind,
           selection: args.selection, scheduler_config: args.schedulerConfig, supersedes: args.supersedes, created_at: isoNow() };
}

/** Next revision of an existing link (correction, confirmation, rejection or undo). */
export function reviseAnnotation(current: { record: AnnotationRecord; artifact: Artifact }, changes: Partial<Pick<AnnotationRecord, "review_state" | "basis" | "reviewer_ref">> & { startMs?: number; endMs?: number }): AnnotationRecord {
  const record: AnnotationRecord = JSON.parse(JSON.stringify(current.record)) as AnnotationRecord;
  record.revision = current.record.revision + 1;
  record.supersedes = { record_id: current.record.annotation_id, artifact: current.artifact };
  record.created_at = isoNow();
  if (changes.review_state) record.review_state = changes.review_state;
  if (changes.basis) record.basis = changes.basis;
  if ("reviewer_ref" in changes) record.reviewer_ref = changes.reviewer_ref ?? null;
  if (changes.startMs !== undefined && changes.endMs !== undefined && record.to.locator.kind === "media") {
    record.to = { ...record.to, locator: { ...record.to.locator, start_ms: Math.round(changes.startMs), end_ms: Math.round(changes.endMs) } };
  }
  return record;
}

/**
 * The learner's own first link between a slide and a stretch of the recording. It is an ordinary
 * revision-1 annotation: confirmed by the learner, citing the recording file as its support, and
 * pinned to the exact slide-deck and recording versions on screen.
 */
export function newOccurrenceAnnotation(args: { courseId: string; lectureId: string; slide: SourceRef; recording: { source_id: string; version_id: string; sha256: string; artifact: Artifact };
  startMs: number; endMs: number }): AnnotationRecord {
  const page = Number(args.slide.locator.page ?? 0);
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  return {
    contract: "ll.annotation/1", annotation_id: `ann-learner-${args.lectureId}-p${String(page).padStart(3, "0")}-${suffix}`, scope: scopeOf(args.courseId), revision: 1, supersedes: null,
    relation: "displayed_during", from: args.slide,
    to: { source_id: args.recording.source_id, version_id: args.recording.version_id, sha256: args.recording.sha256,
          locator: { kind: "media", start_ms: Math.round(args.startMs), end_ms: Math.round(args.endMs), origin: "original_source_start" } },
    review_state: "confirmed", basis: "manual_review", support: [args.recording.artifact], reviewer_ref: "learner", created_at: isoNow(),
  };
}

export async function draftAttachment(text: string): Promise<{ file: BundleFile; artifact: Artifact }> {
  const bytes = new TextEncoder().encode(text);
  return { file: { path: "draft.txt", bytes, mediaType: "text/plain" }, artifact: { path: "draft.txt", sha256: await sha256Hex(bytes), bytes: bytes.byteLength, media_type: "text/plain" } };
}

export const bytesOf = canonicalJsonBytes;
