// LL004: browser validators agree with the Python reference on every supplied case.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ContractError,
  parseStrictJson,
  payloadSchemaFor,
  safeRelative,
  validate,
  validatePayload,
  canonicalJsonBytes,
} from "@/contracts/validate";
import { SCHEMA_SET_SHA256 } from "@/contracts/generated/meta";

const repo = resolve(__dirname, "../../..");
const bytes = (rel: string) => new Uint8Array(readFileSync(resolve(repo, rel)));
const fixture = (name: string) => parseStrictJson(bytes(`fixtures/contracts/${name}`)) as Record<string, any>;
const enc = (s: string) => new TextEncoder().encode(s);

describe("contract cases", () => {
  const cases = JSON.parse(readFileSync(resolve(repo, "fixtures/contracts/cases.json"), "utf8")).cases as Array<{
    id: string; schema: string; fixture: string; expected_valid: boolean;
  }>;
  it("has all 84 supplied cases", () => expect(cases).toHaveLength(84));
  it.each(cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const errors = validate(c.schema, parseStrictJson(bytes(c.fixture)));
    expect(errors.length === 0, errors.join("; ")).toBe(c.expected_valid);
  });
});

describe("strict parsing", () => {
  it("rejects duplicate keys, non-finite numbers, BOM, invalid UTF-8 and oversize input", () => {
    expect(() => parseStrictJson(enc('{"x":1,"x":2}'))).toThrow(ContractError);
    expect(() => parseStrictJson(enc('{"a":{"y":1,"y":1}}'))).toThrow(ContractError);
    expect(() => parseStrictJson(enc('{"x":NaN}'))).toThrow(ContractError);
    expect(() => parseStrictJson(enc('{"x":1e999}'))).toThrow(ContractError);
    expect(() => parseStrictJson(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]))).toThrow(ContractError);
    expect(() => parseStrictJson(new Uint8Array([0xff, 0xfe]))).toThrow(ContractError);
    expect(() => parseStrictJson(enc('{"x":"aaaaaaaaaaaaaaaaaaaa"}'), 10)).toThrow(ContractError);
  });
  it("does not confuse a key-like string value or escaped quote with a duplicate key", () => {
    expect(parseStrictJson(enc('{"a":"\\"a\\":1","b":["a","a"],"c":{"a":1}}'))).toEqual({ a: '"a":1', b: ["a", "a"], c: { a: 1 } });
  });
});

describe("semantic and cross-record rules", () => {
  it("never resolves unknown schemas", () => {
    expect(() => validate("remote-unknown", {})).toThrow(ContractError);
    expect(() => validate("common", {})).toThrow(ContractError);
  });
  it("rejects unsupported versions and approval flags", () => {
    const req = fixture("request.valid.json");
    expect(validate("request", req)).toEqual([]);
    expect(validate("request", { ...req, contract: "ll.request/2" }).length).toBeGreaterThan(0);
    expect(validate("request", { ...req, approved: true }).length).toBeGreaterThan(0);
  });
  it("enforces portable path limits", () => {
    const req = fixture("request.valid.json");
    for (const bad of ["CON", "x /a.json", "a/../b.json", "/abs.json", "a\b.json", "C:/x.json", "a/./b", "nul.txt", "trailingdot./x"]) {
      const r = structuredClone(req);
      r.payload.path = bad;
      expect(validate("request", r).length, bad).toBeGreaterThan(0);
    }
    expect(safeRelative("payload/message.json")).toBe(true);
    expect(safeRelative("a".repeat(600))).toBe(false);
  });
  it("checks request/payload identity", () => {
    const req = fixture("request.valid.json");
    const q: Record<string, any> = { ...fixture("message.valid.json"), role: "learner_question", assessment_disposition: "not_assessed" };
    expect(validatePayload(req, q)).toEqual([]);
    expect(validatePayload(req, { ...q, scope: { ...q.scope, course_id: "other-course" } }).length).toBeGreaterThan(0);
    expect(validatePayload(req, { ...q, thread_key: "other-thread" }).length).toBeGreaterThan(0);
    expect(validatePayload(req, { ...q, role: "tutor" }).length).toBeGreaterThan(0);
    expect(validatePayload(req, { ...q, assessment_disposition: "canonical_saved" }).length).toBeGreaterThan(0);
    expect(validatePayload(req, fixture("submission.valid.json")).length).toBeGreaterThan(0);
  });
  it("keeps the action→payload mapping closed", () => {
    expect(payloadSchemaFor("ask")).toBe("message");
    expect(payloadSchemaFor("explain")).toBe("submission");
    expect(() => payloadSchemaFor("run_shell")).toThrow(ContractError);
  });
  it("requires an explain request to carry the matching explain-back submission", () => {
    const req: Record<string, any> = { ...fixture("request.valid.json"), action: "explain" };
    const sub: Record<string, any> = { ...fixture("submission.valid.json"), logical_input_id: req.logical_input_id, scope: req.scope, interaction: "explain_back" };
    expect(validatePayload(req, sub)).toEqual([]);
    expect(validatePayload(req, { ...sub, interaction: "practice" }).length).toBeGreaterThan(0);
    expect(validatePayload(req, { ...sub, logical_input_id: "another-input" }).length).toBeGreaterThan(0);
  });
});

describe("generated artifacts", () => {
  it("canonical bytes match the Python serializer", () => {
    expect(new TextDecoder().decode(canonicalJsonBytes({ b: 1, a: "é", n: [true, null, 1.5] }))).toBe('{"a":"é","b":1,"n":[true,null,1.5]}');
  });
  it("were generated from the current schema files", () => {
    const names = ["annotation", "bundle", "common", "context", "control", "message", "native-result", "publication", "request", "resume", "review-event", "review-item", "signature", "submission", "view"];
    const h = createHash("sha256");
    for (const n of names) h.update(readFileSync(resolve(repo, `contracts/v1/${n}.schema.json`)));
    h.update(readFileSync(resolve(repo, "contracts/index.json")));
    expect(SCHEMA_SET_SHA256).toBe(h.digest("hex"));
  });
});
