// Device identity and exact-byte manifest signatures (WebCrypto P-256, ES256-P1363).
// The private key is generated non-extractable and kept in IndexedDB as a CryptoKey handle; it is
// never exported, logged or sent. Pairing happens on the Brain PC after a human compares the
// fingerprint. A signature proves possession of a paired key — nothing more.
import { kvGet, kvIncrement, kvSet } from "./db";

export interface DeviceIdentity {
  deviceId: string;
  keyId: string;
  fingerprint: string;
  spkiB64: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  durable: boolean;
}

export interface BrainIdentity {
  key_id: string;
  public_key_spki_b64: string;
  fingerprint: string;
}

export interface SignatureRecord {
  contract: "ll.signature/1";
  signature: { algorithm: "ES256-P1363"; key_id: string; manifest_sha256: string; value: string };
}

const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;
let cached: DeviceIdentity | null = null;

export const toHex = (buffer: ArrayBuffer | Uint8Array): string => Array.from(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const toBase64Url = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (text: string) => fromBase64(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

async function signingMessage(manifest: Uint8Array): Promise<Uint8Array> {
  return new TextEncoder().encode(`LL-BUNDLE-V1\n${await sha256Hex(manifest)}`);
}

function randomId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return `${prefix}-${toHex(bytes)}`;
}

/** Group a fingerprint for human comparison: "ab12 cd34 …". */
export function formatFingerprint(fingerprint: string): string {
  return (fingerprint.match(/.{1,4}/g) ?? []).join(" ");
}

export async function getOrCreateDevice(): Promise<DeviceIdentity> {
  if (cached) return cached;
  const stored = await kvGet<Omit<DeviceIdentity, "durable">>("device");
  if (stored?.privateKey && stored.publicKey) {
    cached = { ...stored, durable: true };
    return cached;
  }
  const pair = (await crypto.subtle.generateKey(ALGORITHM, false, ["sign", "verify"])) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const fingerprint = toHex(await crypto.subtle.digest("SHA-256", spki as BufferSource));
  const identity = { deviceId: randomId("device"), keyId: `dev-${fingerprint.slice(0, 24)}`, fingerprint, spkiB64: toBase64(spki), privateKey: pair.privateKey, publicKey: pair.publicKey };
  const saved = await kvSet("device", identity);
  cached = { ...identity, durable: saved.durability === "saved_on_device" };
  return cached;
}

export function forgetDeviceForTests(): void {
  cached = null;
}

export const nextSequence = (): Promise<number> => kvIncrement("device-sequence");

export async function signManifest(device: DeviceIdentity, manifest: Uint8Array): Promise<SignatureRecord> {
  const signature = new Uint8Array(await crypto.subtle.sign(SIGN, device.privateKey, (await signingMessage(manifest)) as BufferSource)); // 64-byte r||s
  return { contract: "ll.signature/1", signature: { algorithm: "ES256-P1363", key_id: device.keyId, manifest_sha256: await sha256Hex(manifest), value: toBase64Url(signature) } };
}

/** True only when the detached signature covers exactly these manifest bytes under this public key. */
export async function verifyManifest(spkiB64: string, manifest: Uint8Array, record: SignatureRecord): Promise<boolean> {
  try {
    const sig = record.signature;
    if (record.contract !== "ll.signature/1" || sig.algorithm !== "ES256-P1363") return false;
    if (sig.manifest_sha256 !== (await sha256Hex(manifest))) return false;
    const raw = fromBase64Url(sig.value);
    if (raw.length !== 64) return false;
    const key = await crypto.subtle.importKey("spki", fromBase64(spkiB64) as BufferSource, ALGORITHM, false, ["verify"]);
    return await crypto.subtle.verify(SIGN, key, raw as BufferSource, (await signingMessage(manifest)) as BufferSource);
  } catch {
    return false;
  }
}

export const getBrain = (): Promise<BrainIdentity | undefined> => kvGet<BrainIdentity>("brain");
export const setBrain = (brain: BrainIdentity) => kvSet("brain", brain);

export interface PairingState {
  state: "unpaired" | "pending" | "paired" | "revoked";
  bindingRevision?: string;
  courses?: string[];
}
export const getPairing = async (): Promise<PairingState> => (await kvGet<PairingState>("pairing")) ?? { state: "unpaired" };
export const setPairing = (pairing: PairingState) => kvSet("pairing", pairing);
