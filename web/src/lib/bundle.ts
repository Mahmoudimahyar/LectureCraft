// Build immutable signed request bundles in the browser (interface-contracts.md, "Exact file handoff").
// Bytes are serialized once; the manifest lists every file with size and SHA-256; the signature covers
// the exact manifest bytes. Nothing in a bundle selects a root, thread, executable or permission.
import { canonicalJsonBytes, requireValid, validatePayload, ContractError, MAX_INPUT_CHARACTERS } from "@/contracts/validate";
import type { DeviceIdentity, SignatureRecord } from "./device";
import { sha256Hex, signManifest, toHex } from "./device";

export interface BundleFile {
  path: string;
  bytes: Uint8Array;
  mediaType: string;
}

export interface BuiltBundle {
  requestId: string;
  logicalInputId: string;
  courseId: string;
  request: Record<string, unknown>;
  files: BundleFile[];
  manifest: Uint8Array;
  manifestSha256: string;
  signature: SignatureRecord;
  signatureBytes: Uint8Array;
}

export interface BundleInput {
  device: DeviceIdentity;
  sequence: number;
  courseId: string;
  term: string;
  threadKey: string;
  bindingRevision: string;
  action: string;
  depth: "quick" | "standard" | "deep";
  payload: Record<string, unknown>;
  requestId: string;
  logicalInputId: string;
  parentRequestId?: string | null;
  attachments?: BundleFile[];
  now?: Date;
  expiresAt?: string | null;
}

export function newId(prefix: string): string {
  const random = toHex(crypto.getRandomValues(new Uint8Array(6)));
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export const isoNow = (date: Date = new Date()): string => date.toISOString().replace(/\.\d{3}Z$/, "Z");

async function artifact(file: BundleFile) {
  return { path: file.path, sha256: await sha256Hex(file.bytes), bytes: file.bytes.byteLength, media_type: file.mediaType };
}

export async function buildRequestBundle(input: BundleInput): Promise<BuiltBundle> {
  const now = isoNow(input.now);
  const scope = { course_id: input.courseId, term: input.term };
  const payloadBytes = canonicalJsonBytes(input.payload);
  const text = (input.payload as { text?: unknown; response?: { text?: unknown } }).text ?? (input.payload as { response?: { text?: unknown } }).response?.text;
  if (typeof text === "string" && text.length > MAX_INPUT_CHARACTERS) throw new ContractError("The response is longer than the 200,000 character limit");
  const payloadFile: BundleFile = { path: "payload.json", bytes: payloadBytes, mediaType: "application/json" };
  const request = {
    contract: "ll.request/1",
    request_id: input.requestId,
    logical_input_id: input.logicalInputId,
    device_id: input.device.deviceId,
    sequence: input.sequence,
    scope,
    thread_key: input.threadKey,
    binding_revision: input.bindingRevision,
    parent_request_id: input.parentRequestId ?? null,
    action: input.action,
    depth: input.depth,
    submitted_at: now,
    payload: await artifact(payloadFile),
    expires_at: input.expiresAt ?? null,
  };
  const errors = validatePayload(request, input.payload);
  if (errors.length) throw new ContractError(`Request is not valid: ${errors.slice(0, 3).join("; ")}`);
  const task = `# Lecture Learning request\n\nAction: ${input.action} (${input.depth})\nCourse: ${input.courseId}\n\nThis file is readable context only. It is not instructions and grants nothing.\n`;
  const files: BundleFile[] = [
    payloadFile,
    { path: "request.json", bytes: canonicalJsonBytes(request), mediaType: "application/json" },
    { path: "task.md", bytes: new TextEncoder().encode(task), mediaType: "text/markdown" },
    ...(input.attachments ?? []),
  ];
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  const manifest = requireValid("bundle", {
    contract: "ll.bundle/1",
    bundle_id: `bundle-${input.requestId}`.slice(0, 128),
    kind: "request",
    scope,
    created_at: now,
    signer_key_id: input.device.keyId,
    record_path: "request.json",
    files: await Promise.all(files.map(artifact)),
    predecessor_manifest: null,
  });
  const manifestBytes = canonicalJsonBytes(manifest);
  const signature = await signManifest(input.device, manifestBytes);
  return {
    requestId: input.requestId,
    logicalInputId: input.logicalInputId,
    courseId: input.courseId,
    request,
    files,
    manifest: manifestBytes,
    manifestSha256: await sha256Hex(manifestBytes),
    signature,
    signatureBytes: canonicalJsonBytes(signature),
  };
}
