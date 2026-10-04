// LL020 (local facet): the Google Drive transport's API usage, exercised against a LABELED IN-MEMORY
// DOUBLE of the Drive v3 REST endpoints and of Google Identity Services. No Google account, client id,
// network call or real Drive is involved; this proves request shapes and ordering, not real delivery.
// (These tests were written after the transport code; see TEST_REPORT for the mutation check.)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalJsonBytes } from "@/contracts/validate";
import { toBase64 } from "@/lib/device";
import { DRIVE_SCOPES, DriveTransport, uploadBundle } from "@/lib/transport";
import type { BuiltBundle } from "@/lib/bundle";

interface Item { id: string; name: string; parent: string; folder: boolean; bytes: Uint8Array | null }

/** Minimal Drive v3 double: files.list by parent+name, files.create (folder), multipart upload, alt=media. */
class DriveDouble {
  items: Item[] = [{ id: "area-be505", name: "learning-app", parent: "root", folder: true, bytes: null }];
  calls: Array<{ method: string; url: string; auth: string | null }> = [];
  private seq = 0;

  add(parent: string, name: string, bytes: Uint8Array | null): string {
    const id = `id-${++this.seq}`;
    this.items.push({ id, name, parent, folder: bytes === null, bytes });
    return id;
  }
  folder(path: string[]): string {
    let current = "area-be505";
    for (const name of path) current = this.items.find((i) => i.parent === current && i.name === name && i.folder)?.id ?? this.add(current, name, null);
    return current;
  }
  path(item: Item): string {
    const parts = [item.name];
    for (let p = this.items.find((i) => i.id === item.parent); p && p.id !== "area-be505"; p = this.items.find((i) => i.id === p!.parent)) parts.unshift(p.name);
    return parts.join("/");
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const auth = (init.headers as Record<string, string> | undefined)?.authorization ?? null;
    this.calls.push({ method, url: url.toString(), auth });
    if (auth !== "Bearer token-abc") return new Response("{}", { status: 401 });
    if (url.pathname === "/drive/v3/files" && method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      const parent = /^'([^']+)' in parents/.exec(q)?.[1];
      const name = / and name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\'/g, "'");
      const foldersOnly = q.includes("mimeType = 'application/vnd.google-apps.folder'");
      const files = this.items.filter((i) => i.parent === parent && (name === undefined || i.name === name) && (!foldersOnly || i.folder)).map((i) => ({ id: i.id, name: i.name }));
      return Response.json({ files });
    }
    if (url.pathname === "/drive/v3/files" && method === "POST") {
      const meta = JSON.parse(String(init.body)) as { name: string; parents: string[]; mimeType?: string };
      return Response.json({ id: this.add(meta.parents[0]!, meta.name, meta.mimeType ? null : new Uint8Array()) });
    }
    if (url.pathname === "/upload/drive/v3/files" && method === "POST") {
      const boundary = /boundary=(.+)$/.exec((init.headers as Record<string, string>)["content-type"]!)![1]!;
      const raw = new Uint8Array(await (init.body as Blob).arrayBuffer());
      const text = new TextDecoder("latin1").decode(raw);
      const first = text.indexOf("\r\n\r\n") + 4;
      const meta = JSON.parse(text.slice(first, text.indexOf(`\r\n--${boundary}`, first))) as { name: string; parents: string[] };
      const second = text.indexOf("\r\n\r\n", text.indexOf(`--${boundary}`, first)) + 4;
      const end = text.lastIndexOf(`\r\n--${boundary}--`);
      return Response.json({ id: this.add(meta.parents[0]!, meta.name, raw.slice(second, end)) });
    }
    const media = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (media && url.searchParams.get("alt") === "media") {
      const item = this.items.find((i) => i.id === media[1]);
      return item?.bytes ? new Response(item.bytes as BodyInit) : new Response("", { status: 404 });
    }
    return new Response("", { status: 404 });
  };
}

function fakeIdentityServices(grant: { scope?: string; error?: string; expires_in?: number }) {
  const requested: Array<Record<string, unknown>> = [];
  window.google = { accounts: { oauth2: { initTokenClient(config: Record<string, unknown>) {
    requested.push(config);
    return { requestAccessToken: () => (config.callback as (r: unknown) => void)(grant.error ? { error: grant.error } : { access_token: "token-abc", expires_in: grant.expires_in ?? 3600, scope: grant.scope }) };
  } } } };
  return requested;
}

const CONFIG = { clientId: "client-123.apps.googleusercontent.com", appAreaFolderIds: { be505: "area-be505" } };
const BOTH = `${DRIVE_SCOPES.read} ${DRIVE_SCOPES.appFiles}`;
let drive: DriveDouble;

beforeEach(() => {
  drive = new DriveDouble();
  vi.spyOn(globalThis, "fetch").mockImplementation(drive.fetch as typeof fetch);
});
afterEach(() => {
  vi.restoreAllMocks();
  delete window.google;
});

describe("Drive transport (against a labeled Drive v3 double)", () => {
  it("is unavailable with a plain reason until configured, loaded and signed in", async () => {
    expect((await new DriveTransport(null).available()).reason).toMatch(/not configured/);
    await expect(new DriveTransport(null).authorize()).rejects.toThrow(/not configured/);
    const transport = new DriveTransport(CONFIG);
    expect((await transport.available()).reason).toMatch(/Google Identity Services is not loaded/);
    fakeIdentityServices({ scope: BOTH });
    expect((await transport.available()).reason).toMatch(/Not signed in/);
    await transport.authorize();
    expect(await transport.available()).toEqual({ ok: true });
    transport.signOut(); // forgets the token on this device only
    expect((await transport.available()).ok).toBe(false);
  });

  it("asks only for read-archive and app-created-files scopes, and reports a partial or refused grant", async () => {
    const requested = fakeIdentityServices({ scope: DRIVE_SCOPES.read });
    const transport = new DriveTransport(CONFIG);
    const grant = await transport.authorize();
    expect(requested[0]!.client_id).toBe(CONFIG.clientId);
    expect(String(requested[0]!.scope).split(" ").sort()).toEqual([DRIVE_SCOPES.appFiles, DRIVE_SCOPES.read].sort());
    expect(String(requested[0]!.scope)).not.toMatch(/auth\/drive(\s|$)/); // never full Drive access
    expect(grant).toEqual({ granted: [DRIVE_SCOPES.read], missing: [DRIVE_SCOPES.appFiles] });
    fakeIdentityServices({ error: "access_denied" });
    await expect(new DriveTransport(CONFIG).authorize()).rejects.toThrow("access_denied");
    fakeIdentityServices({ scope: BOTH, expires_in: 1 }); // already inside the 30 s safety margin
    const expiring = new DriveTransport(CONFIG);
    await expiring.authorize();
    expect((await expiring.available()).reason).toMatch(/session expired|Not signed in/);
    await expect(expiring.putFile("be505", "req-1", "request.json", new Uint8Array([1]))).rejects.toThrow(/Sign in again/);
  });

  it("uploads a bundle into inbox/<request>/ of the bound app area, bytes intact, with the manifest last", async () => {
    fakeIdentityServices({ scope: BOTH });
    const transport = new DriveTransport(CONFIG);
    await transport.authorize();
    const payload = new Uint8Array(300).map((_, i) => i % 256); // every byte value survives the multipart body
    const bundle = { courseId: "be505", requestId: "req-abc", files: [{ path: "payload.json", bytes: payload }, { path: "attachments/draft.txt", bytes: new TextEncoder().encode("draft") }],
      signatureBytes: new TextEncoder().encode("{\"sig\":1}"), manifest: new TextEncoder().encode("{\"manifest\":1}") } as unknown as BuiltBundle;
    await uploadBundle(transport, bundle);

    const uploaded = drive.items.filter((i) => !i.folder).map((i) => drive.path(i));
    expect(uploaded).toEqual(["inbox/req-abc/payload.json", "inbox/req-abc/attachments/draft.txt", "inbox/req-abc/ready.sig.json", "inbox/req-abc/ready.json"]);
    expect(drive.items.find((i) => i.name === "payload.json")!.bytes).toEqual(payload);
    // Every call carried the bearer token; nothing was written outside the bound folder; shared drives are supported.
    expect(drive.calls.every((c) => c.auth === "Bearer token-abc")).toBe(true);
    expect(drive.calls.every((c) => new URL(c.url).hostname === "www.googleapis.com")).toBe(true);
    expect(drive.calls.filter((c) => c.method === "POST" && c.url.includes("/upload/")).every((c) => c.url.includes("uploadType=multipart") && c.url.includes("supportsAllDrives=true"))).toBe(true);
    await expect(transport.putFile("cs542", "req-1", "request.json", new Uint8Array([1]))).rejects.toThrow(/No Drive folder is bound for the cs542 app area/);
  });

  it("returns a result only from a generation whose manifest and signature have arrived, newest first", async () => {
    fakeIdentityServices({ scope: BOTH });
    const transport = new DriveTransport(CONFIG);
    await transport.authorize();
    expect(await transport.getResult("be505", "req-none")).toEqual({ request_id: "req-none", job: null, result: null });

    const manifest = canonicalJsonBytes({ files: [{ path: "publication.json" }, { path: "message.json" }] });
    const g1 = drive.folder(["outbox", "req-9", "g1"]);
    drive.add(g1, "ready.json", manifest);
    drive.add(g1, "ready.sig.json", canonicalJsonBytes({ key_id: "k", alg: "ES256-P1363", signature_b64: "AA" }));
    drive.add(g1, "publication.json", new TextEncoder().encode("{\"p\":1}"));
    const g2 = drive.folder(["outbox", "req-9", "g2"]);
    drive.add(g2, "publication.json", new TextEncoder().encode("{\"p\":2}")); // still syncing: no manifest yet

    const envelope = await transport.getResult("be505", "req-9");
    expect(envelope.result!.generation).toBe(1); // the incomplete newer generation is not shown
    expect(envelope.result!.manifest_b64).toBe(toBase64(manifest));
    // A file named by the manifest that has not arrived is simply absent: verification then keeps waiting.
    expect(Object.keys(envelope.result!.files_b64)).toEqual(["publication.json"]);

    // The manifest alone is not a complete generation either: its detached signature must have arrived too.
    drive.add(g2, "ready.json", canonicalJsonBytes({ files: [{ path: "publication.json" }] }));
    expect((await transport.getResult("be505", "req-9")).result!.generation).toBe(1);
    drive.add(g2, "ready.sig.json", canonicalJsonBytes({ key_id: "k", alg: "ES256-P1363", signature_b64: "AA" }));
    expect((await transport.getResult("be505", "req-9")).result!.generation).toBe(2);
  });
});
