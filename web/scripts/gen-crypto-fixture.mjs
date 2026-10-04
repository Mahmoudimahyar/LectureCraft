// Generates fixtures/crypto/webcrypto-p256-signature.json using the WebCrypto API (the same
// SubtleCrypto interface browsers expose). The private key is generated non-extractable and is
// discarded; only the public key, a sample manifest and its detached signature are written.
// Used by the Python suite to prove browser → Brain signature compatibility (LL017).
import { webcrypto } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const subtle = webcrypto.subtle;
const out = resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures/crypto/webcrypto-p256-signature.json");
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
const b64 = (buf) => Buffer.from(buf).toString("base64");
const b64url = (buf) => Buffer.from(buf).toString("base64url");

const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
const spki = await subtle.exportKey("spki", pair.publicKey);
const manifest = new TextEncoder().encode('{"bundle_id":"bundle-crypto-fixture","contract":"ll.bundle/1","note":"synthetic manifest bytes for signature compatibility only"}');
const manifestSha = hex(await subtle.digest("SHA-256", manifest));
const message = new TextEncoder().encode(`LL-BUNDLE-V1\n${manifestSha}`);
const signature = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, message); // 64-byte r||s (P1363)
const fingerprint = hex(await subtle.digest("SHA-256", spki));

mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify(
    {
      note: "Synthetic cross-language signature fixture. No private key is stored.",
      produced_by: `node ${process.version} webcrypto.subtle`,
      public_key_spki_b64: b64(spki),
      fingerprint,
      manifest_b64: b64(manifest),
      signature_record: {
        contract: "ll.signature/1",
        signature: { algorithm: "ES256-P1363", key_id: `dev-${fingerprint.slice(0, 24)}`, manifest_sha256: manifestSha, value: b64url(signature) },
      },
    },
    null,
    2,
  ) + "\n",
);
console.log(`wrote ${out}`);
