// Shared wire validation for the NEW adapter contracts — browser side.
// Mirrors brain/src/lecture_brain/contracts.py rule for rule. Validation is not authorization:
// signature, pairing scope, owner revision and payload bytes are checked separately.
import * as generated from "./generated/validators.js";
import { ACTION_PAYLOADS, SCHEMA_NAMES } from "./generated/meta";

export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractError";
  }
}

export const MAX_JSON_BYTES = 4_000_000;
export const MAX_MANIFEST_BYTES = 262_144;
export const MAX_BUNDLE_BYTES = 268_435_456;
export const MAX_BUNDLE_FILES = 64;
export const MAX_INPUT_CHARACTERS = 200_000;

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;
export type SchemaName = (typeof SCHEMA_NAMES)[number];

const RESERVED = new Set([
  "con",
  "nul",
  "prn",
  "aux",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/** Scan JSON text for duplicate object keys (JSON.parse silently keeps the last one). */
function assertNoDuplicateKeys(text: string): void {
  const stack: Array<Set<string> | null> = [];
  const n = text.length;
  let i = 0;
  let expectKey = false;
  while (i < n) {
    const ch = text[i]!;
    if (ch === '"') {
      const start = i;
      i++;
      while (i < n && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      i++;
      const top = stack[stack.length - 1];
      if (expectKey && top) {
        const key = JSON.parse(text.slice(start, i)) as string;
        if (top.has(key)) throw new ContractError(`Duplicate JSON property: ${key}`);
        top.add(key);
        expectKey = false;
      }
      continue;
    }
    if (ch === "{") {
      stack.push(new Set());
      expectKey = true;
    } else if (ch === "[") {
      stack.push(null);
      expectKey = false;
    } else if (ch === "}" || ch === "]") {
      stack.pop();
      expectKey = false;
    } else if (ch === ",") {
      expectKey = stack.length > 0 && stack[stack.length - 1] !== null;
    }
    i++;
  }
}

function* walk(value: unknown): Generator<unknown> {
  yield value;
  if (Array.isArray(value)) for (const v of value) yield* walk(v);
  else if (value && typeof value === "object") for (const v of Object.values(value)) yield* walk(v);
}

/** Strict JSON: UTF-8 without BOM, no duplicate properties, no non-finite numbers, bounded size. */
export function parseStrictJson(raw: Uint8Array | string, maxBytes: number = MAX_JSON_BYTES): Json {
  const bytes = typeof raw === "string" ? new TextEncoder().encode(raw) : raw;
  if (bytes.byteLength > maxBytes) throw new ContractError("JSON size limit exceeded");
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new ContractError("JSON must be UTF-8 without BOM");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new ContractError("JSON is not valid UTF-8");
  }
  let value: Json;
  try {
    value = JSON.parse(text) as Json;
  } catch (e) {
    throw new ContractError(`Malformed JSON: ${(e as Error).message}`);
  }
  assertNoDuplicateKeys(text);
  for (const node of walk(value)) {
    if (typeof node === "number" && !Number.isFinite(node)) throw new ContractError("Non-finite JSON number");
  }
  return value;
}

/** Deterministic serialization matching the Python dump_json (sorted keys, compact, UTF-8). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new ContractError("Non-finite value in record");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}
export const canonicalJsonBytes = (value: unknown): Uint8Array => new TextEncoder().encode(canonicalJson(value));

export function safeRelative(name: unknown): boolean {
  if (typeof name !== "string" || !name || name.length > 512 || name.startsWith("/")) return false;
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code < 32 || code === 127 || name[i] === "\\" || name[i] === ":") return false;
  }
  for (const part of name.split("/")) {
    if (part === "" || part === "." || part === ".." || part.endsWith(" ") || part.endsWith(".")) return false;
    if (RESERVED.has(part.split(".")[0]!.toLowerCase())) return false;
  }
  return true;
}

const time = (s: string) => Date.parse(s);

export function semantic(name: string, v: Rec): string[] {
  const errors: string[] = [];
  for (const node of walk(v)) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    const o = node as Rec;
    if ("path" in o && "sha256" in o && !safeRelative(o.path)) errors.push("Unsafe portable relative artifact path");
    if (o.kind === "media" && "start_ms" in o && o.end_ms <= o.start_ms) errors.push("Media interval must be nonempty and ordered");
    if (o.kind === "lines" && "start" in o && o.end < o.start) errors.push("Line range must be ordered");
    if (o.kind === "figure" && "xywh" in o) {
      const [x, y, w, h] = o.xywh as [number, number, number, number];
      if (w <= 0 || h <= 0 || x + w > 1 || y + h > 1) errors.push("Figure box outside page or empty");
    }
  }
  if (name === "request" && v.expires_at !== null && time(v.expires_at) <= time(v.submitted_at)) {
    errors.push("Request expires before submission");
  }
  if (name === "bundle") {
    const names: string[] = v.files.map((a: Rec) => a.path);
    if (!safeRelative(v.record_path)) errors.push("Unsafe portable relative artifact path");
    if (new Set(names.map((p) => p.toLowerCase())).size !== names.length) errors.push("Duplicate/case-colliding bundle paths");
    if (!names.includes(v.record_path)) errors.push("Entry record missing from manifest");
    if (names.some((p) => p === "ready.json" || p === "ready.sig.json")) errors.push("Manifest/signature cannot hash themselves");
    if (v.files.reduce((s: number, a: Rec) => s + a.bytes, 0) > MAX_BUNDLE_BYTES) errors.push("Bundle byte limit exceeded");
  }
  if (name === "submission" || name === "review-item") {
    const q = v.question;
    if ((q.family_id === null) !== (q.family_revision === null)) errors.push("Family ID/revision must be paired");
  }
  if (name === "submission") {
    const r = v.response;
    if ((v.time_basis === "unknown") !== (v.occurred_at === null)) errors.push("Unknown occurrence time must remain null");
    if (r.text === null && r.attachments.length === 0) errors.push("Actual response missing");
    if (r.kind === "attachment" && r.attachments.length === 0) errors.push("Attachment response needs content");
    if ((r.kind === "text" || r.kind === "voice_transcript") && r.text === null) errors.push("Text/transcript response missing text");
    if (r.kind === "voice_transcript" && r.transcription_revision === null) errors.push("Transcript needs revision identity");
  }
  if (name === "message" && v.role === "learner_question" && v.assessment_disposition !== "not_assessed") {
    errors.push("A submitted help question is not a graded learner attempt");
  }
  if (name === "control" && v.command.kind === "cancel" && v.command.target_request_id === v.request_id) {
    errors.push("Cancellation must target an earlier different request");
  }
  if (name === "native-result") {
    if (v.terminal !== (v.state !== "completion_unknown")) errors.push("Terminal status inconsistent");
    if (v.state === "completed" && (v.output_files.length === 0 || v.failure_code !== null)) {
      errors.push("Completed result lacks valid output or carries failure");
    }
    if (v.state === "failed" && v.failure_code === null) errors.push("Failure requires reason code");
  }
  if (name === "publication") {
    const saved = v.status === "saved" || v.status === "already_saved";
    if (saved !== (v.canonical_record !== null)) errors.push("Canonical reference inconsistent with save status");
    if (saved && v.kind === "none") errors.push("Nonassessment action cannot pretend it published evidence");
    if (saved && (v.kind === "attempt" || v.kind === "assessment_revision") && v.captured_submission === null) {
      errors.push("Full input reference required");
    }
    if (v.status === "not_requested" && v.kind !== "none") errors.push("Not-requested publication must be none");
  }
  if (name === "annotation") {
    if (v.review_state === "confirmed" && v.reviewer_ref === null) errors.push("Confirmed annotation requires accountable review");
    if ((v.relation === "displayed_during" || v.relation === "discussed_during") && v.to.locator.kind !== "media") {
      errors.push("Timing relationship requires media target");
    }
    if ((v.revision === 1) !== (v.supersedes === null)) errors.push("Annotation revision predecessor required");
  }
  if (name === "review-item") {
    if (v.selection === "active" && (v.scheduler_config === null || v.question.family_id === null)) {
      errors.push("Active assessed item needs family and scheduler");
    }
    if ((v.revision === 1) !== (v.supersedes === null)) errors.push("Review revision predecessor required");
  }
  if (name === "review-event") {
    if (
      v.apply_schedule &&
      (v.attempt === null || v.rating === null || v.rating_basis === "unresolved" || v.assistance_before_answer !== "none_reported")
    ) {
      errors.push("No automatic schedule update without supported unassisted observed rating");
    }
    if (v.rating_basis === "unresolved" && v.rating !== null) errors.push("Unresolved rating cannot choose score");
  }
  if (name === "view") {
    const paths: string[] = v.outputs.map((a: Rec) => a.path);
    if (new Set(paths).size !== paths.length) errors.push("Duplicate output");
  }
  return errors;
}

type ValidateFn = {
  (data: unknown): boolean;
  errors?: Array<{ instancePath: string; message?: string; keyword: string }> | null;
};
const validators = generated as unknown as Record<string, ValidateFn>;

/** Returns human-readable violations (empty = valid). Unknown schema throws; nothing is fetched. */
export function validate(name: string, value: unknown): string[] {
  if (!(SCHEMA_NAMES as readonly string[]).includes(name)) {
    throw new ContractError("Unknown local schema; network retrieval disabled");
  }
  for (const node of walk(value)) {
    if (typeof node === "number" && !Number.isFinite(node)) return ["Non-finite value in record"];
  }
  const fn = validators[name.replace(/-/g, "_")]!;
  if (!fn(value)) return (fn.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? e.keyword}`);
  return semantic(name, value as Rec);
}

export function requireValid<T>(name: SchemaName, value: T): T {
  const errors = validate(name, value);
  if (errors.length) throw new ContractError(`${name}: ${errors.slice(0, 5).join("; ")}`);
  return value;
}

export function payloadSchemaFor(action: string): SchemaName {
  const target = (ACTION_PAYLOADS as Record<string, string>)[action];
  if (!target) throw new ContractError(`Action has no typed payload: ${action}`);
  return target as SchemaName;
}

const SUBMISSION_ACTIVITY: Record<string, string> = {
  explain: "explain_back",
  practice: "practice",
  diagnose: "diagnostic_answer",
  review_answer: "review_answer",
};
const sameScope = (a: Rec, b: Rec) => a.course_id === b.course_id && a.term === b.term;

/** Cross-record intent checks only (interface-contracts.md, "Request action to typed payload"). */
export function validatePayload(request: Rec, payload: Rec): string[] {
  let errors = validate("request", request);
  if (errors.length) return errors;
  const target = payloadSchemaFor(request.action);
  errors = validate(target, payload);
  if (errors.length) return errors;
  if (!sameScope(payload.scope, request.scope)) errors.push("Payload course/term differs from request");
  if (target === "message") {
    if (payload.request_id !== request.request_id || payload.thread_key !== request.thread_key) {
      errors.push("Question request/thread identity mismatch");
    }
    if (payload.role !== "learner_question" || payload.assessment_disposition !== "not_assessed") {
      errors.push("Ask action requires an unassessed learner question");
    }
  }
  if (target === "submission") {
    if (payload.logical_input_id !== request.logical_input_id) errors.push("Logical learner input mismatch");
    if (payload.interaction !== SUBMISSION_ACTIVITY[request.action]) errors.push("Response activity differs from request");
  }
  if (target === "control") {
    if (payload.request_id !== request.request_id) errors.push("Control request identity mismatch");
    if (payload.command.kind !== request.action) errors.push("Control action differs from outer request");
  }
  if (target === "resume" && payload.device_id !== request.device_id) errors.push("Resume belongs to another device");
  return errors;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function artifactForBytes(data: Uint8Array, path: string, mediaType: string) {
  return { path, sha256: await sha256Hex(data), bytes: data.byteLength, media_type: mediaType };
}
