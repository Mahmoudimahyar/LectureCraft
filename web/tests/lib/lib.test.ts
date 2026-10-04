// LL006 (browser side) / LL017 (browser side): durable drafts, honest storage failure, device signatures,
// signed bundles, verified results and idempotent submission.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseStrictJson, validate, validatePayload } from "@/contracts/validate";
import { buildRequestBundle, isoNow } from "@/lib/bundle";
import * as db from "@/lib/db";
import { forgetDeviceForTests, formatFingerprint, fromBase64, getOrCreateDevice, setBrain, setPairing, sha256Hex, signManifest, toBase64, verifyManifest } from "@/lib/device";
import { askPayload, flushOutbox, NotPairedError, stableIds, submit, submissionPayload } from "@/lib/requests";
import { verifyResult, ResultVerificationError, type ResultEnvelope } from "@/lib/transport";
import { applyTheme, getThemePref, resolveTheme } from "@/lib/theme";
import { canonicalJsonBytes } from "@/contracts/validate";

const repo = resolve(__dirname, "../../..");
const SHA = "a".repeat(64);
const source = { source_id: "src-lecture-01-slides", version_id: "v1-aaaaaaaaaaaa", sha256: SHA, locator: { kind: "page", page: 2, printed_label: null } };

async function freshStorage() {
  await db.resetDbForTests();
  forgetDeviceForTests();
  await new Promise<void>((done) => {
    const request = indexedDB.deleteDatabase("lecture-learning");
    request.onsuccess = request.onerror = request.onblocked = () => done();
  });
}

beforeEach(freshStorage);
afterEach(() => vi.restoreAllMocks());

describe("drafts", () => {
  const draft = (text: string): db.Draft => ({ draftId: "draft-1", courseId: "be505", mode: "explain", context: { lectureId: "lecture-01", page: 2, label: "Slide 2" }, text, updatedAt: isoNow() });

  it("are saved on the device and stay pinned to their original context", async () => {
    expect(await db.saveDraft(draft("first words"))).toEqual({ durability: "saved_on_device" });
    await db.saveDraft(draft("first words, continued"));
    await db.resetDbForTests(); // simulate a reload: nothing but IndexedDB remains
    const restored = await db.getDraft("draft-1");
    expect(restored?.text).toBe("first words, continued");
    expect(restored?.context).toEqual({ lectureId: "lecture-01", page: 2, label: "Slide 2" });
    expect(db.storageProblem()).toBeNull();
  });

  it("report a local save failure instead of claiming an offline save", async () => {
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    const result = await db.saveDraft(draft("typed while storage is unavailable"));
    expect(result.durability).toBe("memory_only");
    expect(result.reason).toContain("quota");
    expect(db.storageProblem()).toContain("quota");
    expect((await db.getDraft("draft-1"))?.text).toBe("typed while storage is unavailable"); // still usable in this session
  });

  it("device sequence numbers never repeat", async () => {
    const values = await Promise.all([db.kvIncrement("seq"), db.kvIncrement("seq"), db.kvIncrement("seq")]);
    expect(new Set(values).size).toBe(3);
    expect(Math.max(...values)).toBe(3);
  });
});

describe("device signatures", () => {
  it("sign exact manifest bytes and reject any change, other key or malformed record", async () => {
    const device = await getOrCreateDevice();
    expect(device.privateKey.extractable).toBe(false);
    expect(device.keyId).toBe(`dev-${device.fingerprint.slice(0, 24)}`);
    const manifest = new TextEncoder().encode('{"contract":"ll.bundle/1"}');
    const record = await signManifest(device, manifest);
    expect(validate("signature", record)).toEqual([]);
    expect(await verifyManifest(device.spkiB64, manifest, record)).toBe(true);
    expect(await verifyManifest(device.spkiB64, new TextEncoder().encode('{"contract":"ll.bundle/1"} '), record)).toBe(false);
    forgetDeviceForTests();
    await freshStorage();
    const other = await getOrCreateDevice();
    expect(await verifyManifest(other.spkiB64, manifest, record)).toBe(false);
    expect(await verifyManifest(device.spkiB64, manifest, { ...record, signature: { ...record.signature, value: "A".repeat(86) } })).toBe(false);
  });

  it("verify a signature produced by the Python Brain (cross-language fixture)", async () => {
    const fixture = JSON.parse(readFileSync(resolve(repo, "fixtures/crypto/python-p256-signature.json"), "utf8"));
    const manifest = fromBase64(fixture.manifest_b64);
    expect(await verifyManifest(fixture.public_key_spki_b64, manifest, fixture.signature_record)).toBe(true);
    manifest[0] = manifest[0]! ^ 1;
    expect(await verifyManifest(fixture.public_key_spki_b64, manifest, fixture.signature_record)).toBe(false);
    expect(await sha256Hex(fromBase64(fixture.public_key_spki_b64))).toBe(fixture.fingerprint);
  });

  it("keep the same identity across reloads and format fingerprints for comparison", async () => {
    const first = await getOrCreateDevice();
    forgetDeviceForTests();
    const again = await getOrCreateDevice();
    expect(again.deviceId).toBe(first.deviceId);
    expect(again.fingerprint).toBe(first.fingerprint);
    expect(formatFingerprint("abcdef0123456789")).toBe("abcd ef01 2345 6789");
  });
});

describe("request bundles", () => {
  it("are complete, hash-listed, signed and valid under the shared contracts", async () => {
    const device = await getOrCreateDevice();
    const payload = askPayload("be505", "req-1", "What does the origin do?", [source]);
    const bundle = await buildRequestBundle({ device, sequence: 7, courseId: "be505", term: "2026-fall", threadKey: "tutor-be505", bindingRevision: SHA, action: "ask", depth: "quick", payload, requestId: "req-1", logicalInputId: "input-1" });
    const manifest = parseStrictJson(bundle.manifest) as any;
    expect(validate("bundle", manifest)).toEqual([]);
    expect(manifest.record_path).toBe("request.json");
    expect(manifest.files.map((f: any) => f.path)).toEqual(["payload.json", "request.json", "task.md"]);
    for (const file of bundle.files) {
      const listed = manifest.files.find((f: any) => f.path === file.path);
      expect(listed.sha256).toBe(await sha256Hex(file.bytes));
      expect(listed.bytes).toBe(file.bytes.byteLength);
    }
    const request = parseStrictJson(bundle.files.find((f) => f.path === "request.json")!.bytes) as any;
    expect(validatePayload(request, payload)).toEqual([]);
    expect(request.sequence).toBe(7);
    expect(request.payload.sha256).toBe(await sha256Hex(bundle.files.find((f) => f.path === "payload.json")!.bytes));
    expect(await verifyManifest(device.spkiB64, bundle.manifest, bundle.signature)).toBe(true);
  });

  it("refuse a payload that does not match the action or exceeds the input limit", async () => {
    const device = await getOrCreateDevice();
    const base = { device, sequence: 1, courseId: "be505", term: "2026-fall", threadKey: "tutor-be505", bindingRevision: SHA, depth: "quick" as const, requestId: "req-2", logicalInputId: "input-2" };
    const answer = submissionPayload({ courseId: "be505", requestId: "req-2", logicalInputId: "input-2", text: "My answer", interaction: "explain_back",
      question: { question_id: null, family_id: null, family_revision: null, prompt: "Explain.", sources: [], attachments: [] },
      conditions: { assistance_before_answer: "none_reported", reference_access: "none_reported", prior_exposure: "unknown" } });
    await expect(buildRequestBundle({ ...base, action: "ask", payload: answer })).rejects.toThrow(/not valid/);
    await expect(buildRequestBundle({ ...base, action: "explain", payload: answer })).resolves.toBeTruthy();
    await expect(buildRequestBundle({ ...base, action: "ask", payload: askPayload("be505", "req-2", "x".repeat(200_001), []) })).rejects.toThrow(/200,000/);
  });

  it("give the same input the same identity and a changed input a new one", async () => {
    const a = await stableIds("explain", "draft-1", "same text");
    expect(await stableIds("explain", "draft-1", "same text")).toEqual(a);
    expect((await stableIds("explain", "draft-1", "edited text")).requestId).not.toBe(a.requestId);
    expect(a.requestId).toMatch(/^req-[a-f0-9]{24}$/);
  });

  it("never share an identity between two devices or two sittings that typed the same words", async () => {
    const first = await stableIds("ask:quick", "tutor:be505:lecture-01", "Give me a hint");
    forgetDeviceForTests();
    await db.resetDbForTests();
    await new Promise<void>((done) => {
      const request = indexedDB.deleteDatabase("lecture-learning");
      request.onsuccess = request.onerror = request.onblocked = () => done();
    });
    const otherDevice = await stableIds("ask:quick", "tutor:be505:lecture-01", "Give me a hint");
    expect(otherDevice.requestId).not.toBe(first.requestId); // a second device must not collide with (or be refused as) the first
    window.sessionStorage.removeItem("ll.session");
    const laterSitting = await stableIds("ask:quick", "tutor:be505:lecture-01", "Give me a hint");
    expect(laterSitting.requestId).not.toBe(otherDevice.requestId); // asking again another day is a new request
    expect(await stableIds("ask:quick", "tutor:be505:lecture-01", "Give me a hint")).toEqual(laterSitting); // a double click is not
  });
});

describe("submission and outbox", () => {
  const args = (requestId: string, text: string) => ({ courseId: "be505", bindingRevision: SHA, action: "ask", depth: "quick" as const, requestId, logicalInputId: `input-${requestId}`,
    payload: askPayload("be505", requestId, text, [source]), label: "Slide 2", context: { lectureId: "lecture-01", page: 2, label: "Slide 2" }, text });


  it("uses the binding revision stored at pairing when the workspace view has not loaded yet, and refuses plainly when neither is known", async () => {
    await setPairing({ state: "paired", bindingRevision: SHA, courses: ["be505"] });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const early = { ...args("req-early-1", "Sent before the workspace view arrived"), bindingRevision: "" };
    const outcome = await submit(early);
    expect(outcome.delivery).toBe("uploaded");
    await setPairing({ state: "paired", courses: ["be505"] });
    await expect(submit({ ...args("req-early-2", "No binding known anywhere"), bindingRevision: "" })).rejects.toThrow(/has not loaded yet.*nothing was sent/i);
    expect(await db.getLocalRequest("req-early-2")).toBeUndefined(); // no half-built request is left behind
  });
  it("refuse to send from an unpaired device while keeping the draft", async () => {
    await db.saveDraft({ draftId: "d", courseId: "be505", mode: "quick", context: { label: "Slide 2" }, text: "kept", updatedAt: isoNow() });
    await expect(submit(args("req-a", "Q"))).rejects.toBeInstanceOf(NotPairedError);
    expect((await db.getDraft("d"))?.text).toBe("kept");
  });

  it("upload payload first and the manifest last, then treat a repeat as the same request", async () => {
    await setPairing({ state: "paired" });
    const puts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") puts.push(String(url).split("/").pop()!);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }));
    const first = await submit(args("req-b", "Q"));
    expect(first).toMatchObject({ requestId: "req-b", delivery: "uploaded" });
    expect(puts).toEqual(["payload.json", "request.json", "task.md", "ready.sig.json", "ready.json"]);
    expect(await db.listOutbox()).toEqual([]);
    const again = await submit(args("req-b", "Q")); // double click / resend of the same input
    expect(again).toMatchObject({ requestId: "req-b", duplicate: true });
    expect(puts).toHaveLength(5);
  });

  it("retain the signed bundle when delivery is unavailable and send the same bytes later", async () => {
    await setPairing({ state: "paired" });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("network down");
    }));
    const held = await submit(args("req-c", "typed offline"));
    expect(held.delivery).toBe("retained_locally");
    const [item] = await db.listOutbox();
    expect(item!.requestId).toBe("req-c");
    const manifestBefore = toBase64(item!.manifest);
    const puts: Array<{ name: string; body: Uint8Array }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      puts.push({ name: String(url).split("/").pop()!, body: new Uint8Array(init!.body as ArrayBuffer) });
      return new Response("{}", { status: 200 });
    }));
    expect(await flushOutbox()).toEqual({ sent: ["req-c"], stillHeld: [] });
    expect(puts.at(-1)!.name).toBe("ready.json");
    expect(toBase64(puts.at(-1)!.body)).toBe(manifestBefore); // not rebuilt, not re-signed
    expect((await db.getLocalRequest("req-c"))?.upload).toBe("uploaded");
  });

  it("flush is single-flight: an automatic and a manual flush at the same moment deliver each bundle once", async () => {
    await setPairing({ state: "paired" });
    await getOrCreateDevice();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    await submit(args("req-sf", "Retained while offline"));
    const puts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      puts.push(String(url).split("/").pop()!);
      await new Promise((r) => setTimeout(r, 5));
      return new Response("{}", { status: 200 });
    }));
    const [a, b] = await Promise.all([flushOutbox(), flushOutbox()]);
    expect(a).toEqual({ sent: ["req-sf"], stillHeld: [] });
    expect(b).toEqual(a); // the second caller joined the first run
    expect(puts.filter((n) => n === "ready.json")).toHaveLength(1);
    expect(await flushOutbox()).toEqual({ sent: [], stillHeld: [] }); // and a later flush starts fresh
  });

  it("say plainly when neither delivery nor local storage holds the input", async () => {
    await setPairing({ state: "paired" });
    await getOrCreateDevice();
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    await db.resetDbForTests();
    await setPairing({ state: "paired" });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("network down");
    }));
    const outcome = await submit(args("req-d", "important text"));
    expect(outcome.delivery).toBe("not_retained");
    expect(outcome.reason).toMatch(/copy your text/);
  });
});

describe("result verification", () => {
  async function envelope(mutate?: (files: Record<string, Uint8Array>, manifest: any) => void): Promise<{ env: ResultEnvelope; brainSpki: string }> {
    const brain = await getOrCreateDevice(); // stands in for the Brain key in this unit test
    const publication = { contract: "ll.publication/1", receipt_id: "pub-1", request_id: "req-1", scope: { course_id: "be505", term: "2026-fall" }, writer_id: "none", kind: "none", status: "not_requested",
      canonical_record: null, view_status: "not_applicable", captured_submission: null, observed_at: "2026-10-04T10:00:00Z", reason: "Not assessed in this exchange." };
    const message = { contract: "ll.message/1", message_id: "msg-t", request_id: "req-1", scope: { course_id: "be505", term: "2026-fall" }, thread_key: "tutor-be505", reply_to_turn: null, role: "tutor",
      text: "An answer.", sources: [], attachments: [], created_at: "2026-10-04T10:00:00Z", assessment_disposition: "not_assessed" };
    const files: Record<string, Uint8Array> = { "message.json": canonicalJsonBytes(message), "publication.json": canonicalJsonBytes(publication) };
    const manifest: any = { contract: "ll.bundle/1", bundle_id: "result-1", kind: "result", scope: { course_id: "be505", term: "2026-fall" }, created_at: "2026-10-04T10:00:00Z", signer_key_id: brain.keyId,
      record_path: "publication.json", predecessor_manifest: SHA, files: await Promise.all(Object.entries(files).map(async ([path, bytes]) => ({ path, sha256: await sha256Hex(bytes), bytes: bytes.byteLength, media_type: "application/json" }))) };
    mutate?.(files, manifest);
    const manifestBytes = canonicalJsonBytes(manifest);
    return { brainSpki: brain.spkiB64, env: { request_id: "req-1", job: { state: "SUCCEEDED", reason: null, generation: 1, cancel_requested: false },
      result: { generation: 1, manifest_b64: toBase64(manifestBytes), signature: await signManifest(brain, manifestBytes), files_b64: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, toBase64(v)])), is_current_generation: true } } };
  }
  const brainOf = (spki: string) => ({ key_id: "brain-x", public_key_spki_b64: spki, fingerprint: "f" });

  it("accepts a complete result signed by the paired Brain", async () => {
    const { env, brainSpki } = await envelope();
    const verified = await verifyResult(env, brainOf(brainSpki), "be505");
    expect(verified?.publication.status).toBe("not_requested");
    expect(verified?.message?.assessment_disposition).toBe("not_assessed");
  });

  it("refuses results from another key, tampered files or the wrong course, and waits for missing files", async () => {
    const { env, brainSpki } = await envelope();
    forgetDeviceForTests();
    await freshStorage();
    const stranger = await getOrCreateDevice();
    await expect(verifyResult(env, brainOf(stranger.spkiB64), "be505")).rejects.toBeInstanceOf(ResultVerificationError);
    await expect(verifyResult(env, brainOf(brainSpki), "cs542")).rejects.toBeInstanceOf(ResultVerificationError);
    const tampered = structuredClone(env);
    tampered.result!.files_b64["message.json"] = toBase64(new TextEncoder().encode('{"text":"forged"}'));
    await expect(verifyResult(tampered, brainOf(brainSpki), "be505")).rejects.toThrow(/does not match its manifest digest/);
    const partial = structuredClone(env);
    delete partial.result!.files_b64["message.json"];
    expect(await verifyResult(partial, brainOf(brainSpki), "be505")).toBeNull(); // manifest arrived before its payload: keep waiting
    await setBrain(brainOf(brainSpki));
  });
});

describe("theme", () => {
  it("applies an explicit choice and keeps working for the session when storage is blocked", () => {
    expect(applyTheme("dark")).toEqual({ persisted: true });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(getThemePref()).toBe("dark");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(applyTheme("light")).toEqual({ persisted: false });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(resolveTheme("light")).toBe("light");
  });
});
