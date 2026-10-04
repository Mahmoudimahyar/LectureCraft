// Transports for committed bundles and verified results.
//
//  * LoopbackTransport — this PC only: files go to the Brain's loopback inbox (same shape as Drive).
//  * DriveTransport    — cross-device: Google Identity Services token client + Drive v3 REST, direct
//                        from the browser. Implemented; NOT ACTIVATED until an OAuth client id/origin
//                        is configured and the user grants access. Tokens stay in memory only.
//
// Uploading is not delivery: payload files go first, the signature next, the manifest last, and the
// request only counts as "Received by Brain" once the Brain has admitted it.
import { parseStrictJson, validate } from "@/contracts/validate";
import { ApiError, apiGet, apiPutBytes } from "./api";
import type { BuiltBundle } from "./bundle";
import { fromBase64, sha256Hex, verifyManifest, type BrainIdentity, type SignatureRecord } from "./device";
import type { MessageRecord, PublicationRecord, ResultDetail } from "./types";

export interface ResultEnvelope {
  request_id: string;
  job: { state: string; reason: string | null; generation: number; cancel_requested: boolean } | null;
  result: { generation: number; manifest_b64: string; signature: SignatureRecord; files_b64: Record<string, string>; is_current_generation: boolean } | null;
}

export interface VerifiedResult {
  generation: number;
  publication: PublicationRecord;
  message: MessageRecord | null;
  nativeResult: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  detail: ResultDetail | null;
  isCurrentGeneration: boolean;
}

export interface Transport {
  readonly name: string;
  readonly label: string;
  available(): Promise<{ ok: boolean; reason?: string }>;
  putFile(courseId: string, requestId: string, path: string, bytes: Uint8Array): Promise<void>;
  getResult(courseId: string, requestId: string): Promise<ResultEnvelope>;
}

export class LoopbackTransport implements Transport {
  readonly name = "loopback";
  readonly label = "This PC (loopback Brain)";
  async available() {
    try {
      await apiGet("health");
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    }
  }
  putFile(courseId: string, requestId: string, path: string, bytes: Uint8Array) {
    return apiPutBytes(`transport/${encodeURIComponent(courseId)}/inbox/${encodeURIComponent(requestId)}/${path.split("/").map(encodeURIComponent).join("/")}`, bytes);
  }
  getResult(courseId: string, requestId: string) {
    return apiGet<ResultEnvelope>(`results/${encodeURIComponent(courseId)}/${encodeURIComponent(requestId)}`);
  }
}

/** Commit order: payload files → detached signature → manifest (last). */
export async function uploadBundle(transport: Transport, bundle: BuiltBundle): Promise<void> {
  for (const file of bundle.files) await transport.putFile(bundle.courseId, bundle.requestId, file.path, file.bytes);
  await transport.putFile(bundle.courseId, bundle.requestId, "ready.sig.json", bundle.signatureBytes);
  await transport.putFile(bundle.courseId, bundle.requestId, "ready.json", bundle.manifest);
}

export class ResultVerificationError extends Error {}

/** Verify a result bundle against the paired Brain key and its own manifest before showing anything. */
export async function verifyResult(envelope: ResultEnvelope, brain: BrainIdentity, expectedCourse: string): Promise<VerifiedResult | null> {
  if (!envelope.result) return null;
  const manifestBytes = fromBase64(envelope.result.manifest_b64);
  if (!(await verifyManifest(brain.public_key_spki_b64, manifestBytes, envelope.result.signature))) {
    throw new ResultVerificationError("The result is not signed by the Brain this device is paired with. It was not shown.");
  }
  const manifest = parseStrictJson(manifestBytes) as { kind: string; scope: { course_id: string }; files: Array<{ path: string; sha256: string; bytes: number }>; record_path: string };
  if (validate("bundle", manifest).length || manifest.kind !== "result" || manifest.scope.course_id !== expectedCourse) {
    throw new ResultVerificationError("The result manifest is not a valid result bundle for this course.");
  }
  const records: Record<string, unknown> = {};
  for (const entry of manifest.files) {
    const b64 = envelope.result.files_b64[entry.path];
    if (b64 === undefined) return null; // complete matching bytes are not here yet: keep waiting, show nothing partial
    const bytes = fromBase64(b64);
    if (bytes.byteLength !== entry.bytes || (await sha256Hex(bytes)) !== entry.sha256) {
      throw new ResultVerificationError(`Result file ${entry.path} does not match its manifest digest.`);
    }
    records[entry.path.replace(/\.json$/, "")] = parseStrictJson(bytes);
  }
  const publication = records.publication as PublicationRecord | undefined;
  if (!publication || validate("publication", publication).length || publication.request_id !== envelope.request_id) {
    throw new ResultVerificationError("The result does not carry a valid publication receipt for this request.");
  }
  const message = (records.message as MessageRecord | undefined) ?? null;
  if (message && (validate("message", message).length || message.request_id !== envelope.request_id || message.role !== "tutor")) {
    throw new ResultVerificationError("The result message does not belong to this request.");
  }
  return {
    generation: envelope.result.generation,
    publication,
    message,
    nativeResult: (records["native-result"] as Record<string, unknown> | undefined) ?? null,
    context: (records.context as Record<string, unknown> | undefined) ?? null,
    detail: (records.detail as ResultDetail | undefined) ?? null,
    isCurrentGeneration: envelope.result.is_current_generation,
  };
}

// -------------------------------------------------------------------------------------------------
// Google Drive transport (implemented, not activated)
// -------------------------------------------------------------------------------------------------
declare global {
  interface Window {
    google?: { accounts: { oauth2: { initTokenClient(config: Record<string, unknown>): { requestAccessToken(options?: Record<string, unknown>): void } } } };
  }
}

export const DRIVE_SCOPES = {
  /** Read the existing course archive. Broad at provider level; the app's own allowlist narrows what it touches. */
  read: "https://www.googleapis.com/auth/drive.readonly",
  /** Create/modify only files this app created (request bundles). */
  appFiles: "https://www.googleapis.com/auth/drive.file",
} as const;

export interface DriveConfig {
  clientId: string;
  /** Drive folder id of each course's `.agent/learning-app` area, bound by the user. */
  appAreaFolderIds: Record<string, string>;
}

export function driveConfigFromEnv(): DriveConfig | null {
  const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim();
  if (!clientId) return null;
  let folders: Record<string, string> = {};
  try {
    folders = JSON.parse((import.meta.env.VITE_DRIVE_APP_AREAS as string | undefined) ?? "{}") as Record<string, string>;
  } catch {
    folders = {};
  }
  return { clientId, appAreaFolderIds: folders };
}

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

export class DriveTransport implements Transport {
  readonly name = "drive";
  readonly label = "Google Drive (cross-device)";
  private token: { value: string; expiresAt: number; scopes: string[] } | null = null;

  constructor(private config: DriveConfig | null) {}

  async available() {
    if (!this.config) return { ok: false, reason: "Drive access is not configured: no OAuth client id is bound for this app origin." };
    if (!window.google?.accounts?.oauth2) return { ok: false, reason: "Google Identity Services is not loaded. Connect in Settings → Access to load it deliberately." };
    if (!this.token || this.token.expiresAt < Date.now()) return { ok: false, reason: "Not signed in to Drive on this device (or the session expired). Sign in again; nothing is re-sent automatically." };
    return { ok: true };
  }

  /** Must be called from a user gesture. Partial or refused grants are reported, never silently escalated. */
  authorize(scopes: string[] = [DRIVE_SCOPES.read, DRIVE_SCOPES.appFiles]): Promise<{ granted: string[]; missing: string[] }> {
    return new Promise((resolve, reject) => {
      if (!this.config) return reject(new Error("Drive access is not configured."));
      if (!window.google?.accounts?.oauth2) return reject(new Error("Google Identity Services is not loaded."));
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: this.config.clientId,
        scope: scopes.join(" "),
        callback: (response: { access_token?: string; expires_in?: number; scope?: string; error?: string }) => {
          if (response.error || !response.access_token) return reject(new Error(response.error ?? "Drive authorization was cancelled."));
          const granted = (response.scope ?? "").split(" ").filter(Boolean);
          this.token = { value: response.access_token, expiresAt: Date.now() + (response.expires_in ?? 0) * 1000 - 30_000, scopes: granted };
          resolve({ granted, missing: scopes.filter((s) => !granted.includes(s)) });
        },
      });
      client.requestAccessToken();
    });
  }

  /** Forget the in-memory token. Does not revoke the grant at Google and does not cancel accepted work. */
  signOut(): void {
    this.token = null;
  }

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    if (!this.token || this.token.expiresAt < Date.now()) throw new ApiError(401, "Drive session expired. Sign in again to continue.");
    const response = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${this.token.value}` } });
    if (response.status === 401 || response.status === 403) throw new ApiError(response.status, "Drive refused this request (permission or expired session).");
    if (!response.ok) throw new ApiError(response.status, `Drive error ${response.status}`);
    return response;
  }

  private async childId(parent: string, name: string, folder: boolean, create: boolean): Promise<string | null> {
    const q = `'${parent}' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed = false`;
    const list = (await (await this.call(`${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType)&pageSize=10&supportsAllDrives=true`)).json()) as { files: Array<{ id: string }> };
    // Repeated same-name uploads are distinct Drive items; identity is decided later by request id + content digest, not by name.
    if (list.files.length) return list.files[0]!.id;
    if (!create) return null;
    const metadata = { name, parents: [parent], ...(folder ? { mimeType: "application/vnd.google-apps.folder" } : {}) };
    const created = (await (await this.call(`${DRIVE}/files?fields=id&supportsAllDrives=true`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(metadata) })).json()) as { id: string };
    return created.id;
  }

  private async resolveFolder(courseId: string, segments: string[], create: boolean): Promise<string | null> {
    let current = this.config?.appAreaFolderIds[courseId] ?? null;
    if (!current) throw new ApiError(400, `No Drive folder is bound for the ${courseId} app area.`);
    for (const segment of segments) {
      const next = await this.childId(current, segment, true, create);
      if (!next) return null;
      current = next;
    }
    return current;
  }

  async putFile(courseId: string, requestId: string, path: string, bytes: Uint8Array): Promise<void> {
    const parts = path.split("/");
    const name = parts.pop()!;
    const folder = await this.resolveFolder(courseId, ["inbox", requestId, ...parts], true);
    const boundary = `ll-${crypto.randomUUID()}`;
    const head = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folder] })}\r\n--${boundary}\r\ncontent-type: application/octet-stream\r\n\r\n`;
    const tail = `\r\n--${boundary}--`;
    const body = new Blob([head, bytes as BlobPart, tail]);
    await this.call(`${UPLOAD}/files?uploadType=multipart&fields=id,md5Checksum,size&supportsAllDrives=true`, { method: "POST", headers: { "content-type": `multipart/related; boundary=${boundary}` }, body });
  }

  private async fileBytes(folder: string, name: string): Promise<Uint8Array | null> {
    const id = await this.childId(folder, name, false, false);
    if (!id) return null;
    return new Uint8Array(await (await this.call(`${DRIVE}/files/${id}?alt=media&supportsAllDrives=true`)).arrayBuffer());
  }

  async getResult(courseId: string, requestId: string): Promise<ResultEnvelope> {
    const base = await this.resolveFolder(courseId, ["outbox", requestId], false);
    if (!base) return { request_id: requestId, job: null, result: null };
    const q = `'${base}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const listed = (await (await this.call(`${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&supportsAllDrives=true`)).json()) as { files: Array<{ id: string; name: string }> };
    const generations = listed.files.filter((f) => /^g\d+$/.test(f.name)).sort((a, b) => Number(b.name.slice(1)) - Number(a.name.slice(1)));
    for (const generation of generations) {
      const manifest = await this.fileBytes(generation.id, "ready.json");
      const signature = await this.fileBytes(generation.id, "ready.sig.json");
      if (!manifest || !signature) continue; // a manifest can arrive before its payload: wait for complete bytes
      const parsed = parseStrictJson(manifest) as { files: Array<{ path: string }> };
      const files: Record<string, string> = {};
      for (const entry of parsed.files) {
        const bytes = await this.fileBytes(generation.id, entry.path);
        if (bytes) files[entry.path] = btoa(String.fromCharCode(...bytes));
      }
      return {
        request_id: requestId,
        job: null,
        result: { generation: Number(generation.name.slice(1)), manifest_b64: btoa(String.fromCharCode(...manifest)), signature: parseStrictJson(signature) as unknown as SignatureRecord, files_b64: files, is_current_generation: true },
      };
    }
    return { request_id: requestId, job: null, result: null };
  }
}
