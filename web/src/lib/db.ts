// Durable browser-side state (IndexedDB via idb): drafts, the retained outbox, local request records
// and device key material. Every write reports what actually happened: a draft is "saved on this
// device" only after the transaction commits; when storage is unavailable (private mode, quota,
// blocked) the caller is told so and the UI must say "Local save failed" — never "saved offline".
import { openDB, type IDBPDatabase } from "idb";

export interface SourceRef {
  source_id: string;
  version_id: string;
  sha256: string;
  locator: Record<string, unknown> & { kind: string };
}

export interface DraftContext {
  lectureId?: string;
  page?: number;
  questionId?: string;
  source?: SourceRef;
  label: string;
}

export type DraftMode = "quick" | "understand" | "explain" | "practice" | "diagnostic" | "review" | "note";

export interface Draft {
  draftId: string;
  courseId: string;
  mode: DraftMode;
  context: DraftContext;
  text: string;
  updatedAt: string;
  /** Lineage: the draft this one was explicitly re-pinned or restored from. */
  parentDraftId?: string;
  transcript?: { revision: string; original: string } | null;
}

export interface OutboxItem {
  requestId: string;
  courseId: string;
  createdAt: string;
  files: Array<{ path: string; bytes: Uint8Array }>;
  manifest: Uint8Array;
  signature: Uint8Array;
  attempts: number;
  lastError?: string;
}

export interface LocalRequest {
  requestId: string;
  courseId: string;
  action: string;
  depth: string;
  logicalInputId: string;
  parentRequestId: string | null;
  createdAt: string;
  label: string;
  context: DraftContext;
  text: string;
  upload: "retained_locally" | "uploaded" | "upload_failed";
  sessionId: string;
}

export type Durability = "saved_on_device" | "memory_only";
export interface SaveResult {
  durability: Durability;
  reason?: string;
}

const DB_NAME = "lecture-learning";
const DB_VERSION = 1;
let dbPromise: Promise<IDBPDatabase> | null = null;
let unavailableReason: string | null = null;
const memory = { drafts: new Map<string, Draft>(), kv: new Map<string, unknown>(), outbox: new Map<string, OutboxItem>(), requests: new Map<string, LocalRequest>() };
const listeners = new Set<() => void>();

function open(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts", { keyPath: "draftId" }).createIndex("courseId", "courseId");
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "requestId" });
        if (!db.objectStoreNames.contains("requests")) db.createObjectStore("requests", { keyPath: "requestId" }).createIndex("courseId", "courseId");
      },
    });
  }
  return dbPromise;
}

function fail(error: unknown): string {
  unavailableReason = error instanceof Error ? error.message || error.name : String(error);
  listeners.forEach((l) => l());
  return unavailableReason;
}

/** null while storage works; otherwise the reason local persistence is unavailable. */
export function storageProblem(): string | null {
  return unavailableReason;
}
export function onStorageChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
/** Test hook: close and forget the cached connection and in-memory state (simulates a page reload). */
export async function resetDbForTests(): Promise<void> {
  const pending = dbPromise;
  dbPromise = null;
  unavailableReason = null;
  Object.values(memory).forEach((m) => m.clear());
  if (pending) {
    try {
      (await pending).close();
    } catch {
      /* the connection never opened */
    }
  }
}

async function put<T>(store: "drafts" | "outbox" | "requests", value: T & { [k: string]: unknown }, key: string): Promise<SaveResult> {
  (memory[store] as Map<string, unknown>).set(key, value);
  try {
    const db = await open();
    await db.put(store, value);
    if (unavailableReason) {
      unavailableReason = null;
      listeners.forEach((l) => l());
    }
    return { durability: "saved_on_device" };
  } catch (error) {
    return { durability: "memory_only", reason: fail(error) };
  }
}

async function getAll<T>(store: "drafts" | "outbox" | "requests"): Promise<T[]> {
  try {
    const db = await open();
    return (await db.getAll(store)) as T[];
  } catch (error) {
    fail(error);
    return [...(memory[store] as Map<string, unknown>).values()] as T[];
  }
}

async function remove(store: "drafts" | "outbox" | "requests", key: string): Promise<void> {
  memory[store].delete(key);
  try {
    const db = await open();
    await db.delete(store, key);
  } catch (error) {
    fail(error);
  }
}

// ---- drafts -------------------------------------------------------------------------------------
export const saveDraft = (draft: Draft): Promise<SaveResult> => put("drafts", draft as Draft & Record<string, unknown>, draft.draftId);
export const listDrafts = async (courseId?: string): Promise<Draft[]> =>
  (await getAll<Draft>("drafts")).filter((d) => !courseId || d.courseId === courseId).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
export const getDraft = async (draftId: string): Promise<Draft | undefined> => (await getAll<Draft>("drafts")).find((d) => d.draftId === draftId);
export const deleteDraft = (draftId: string): Promise<void> => remove("drafts", draftId);

// ---- outbox (submitted, not yet delivered) ---------------------------------------------------------
export const retainInOutbox = (item: OutboxItem): Promise<SaveResult> => put("outbox", item as OutboxItem & Record<string, unknown>, item.requestId);
export const listOutbox = (): Promise<OutboxItem[]> => getAll<OutboxItem>("outbox");
export const removeFromOutbox = (requestId: string): Promise<void> => remove("outbox", requestId);

// ---- local request records -------------------------------------------------------------------------
export const saveLocalRequest = (request: LocalRequest): Promise<SaveResult> => put("requests", request as LocalRequest & Record<string, unknown>, request.requestId);
export const listLocalRequests = async (courseId?: string): Promise<LocalRequest[]> =>
  (await getAll<LocalRequest>("requests")).filter((r) => !courseId || r.courseId === courseId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
export const getLocalRequest = async (requestId: string): Promise<LocalRequest | undefined> => (await getAll<LocalRequest>("requests")).find((r) => r.requestId === requestId);

// ---- key/value -------------------------------------------------------------------------------------
export async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open();
    const value = (await db.get("kv", key)) as T | undefined;
    return value === undefined ? (memory.kv.get(key) as T | undefined) : value;
  } catch (error) {
    fail(error);
    return memory.kv.get(key) as T | undefined;
  }
}

export async function kvSet(key: string, value: unknown): Promise<SaveResult> {
  memory.kv.set(key, value);
  try {
    const db = await open();
    await db.put("kv", value, key);
    return { durability: "saved_on_device" };
  } catch (error) {
    return { durability: "memory_only", reason: fail(error) };
  }
}

/** Atomic counter in one transaction (device sequence numbers must never repeat). */
export async function kvIncrement(key: string): Promise<number> {
  try {
    const db = await open();
    const tx = db.transaction("kv", "readwrite");
    const next = (((await tx.store.get(key)) as number | undefined) ?? 0) + 1;
    await tx.store.put(next, key);
    await tx.done;
    memory.kv.set(key, next);
    return next;
  } catch (error) {
    fail(error);
    // Without durable storage, derive a monotonic value from the clock so numbers do not repeat after reload.
    const next = Math.max(((memory.kv.get(key) as number | undefined) ?? 0) + 1, Math.floor(Date.now() / 1000));
    memory.kv.set(key, next);
    return next;
  }
}

/** Remove this device's local data (sign-out / "remove local data"). Does not touch the Brain or Drive. */
export async function clearLocalData(options: { keepDrafts: boolean }): Promise<{ cleared: string[]; kept: string[] }> {
  const cleared: string[] = [];
  const kept: string[] = [];
  try {
    const db = await open();
    for (const store of ["kv", "requests", "outbox", "drafts"] as const) {
      if (store === "drafts" && options.keepDrafts) {
        kept.push("drafts");
        continue;
      }
      await db.clear(store);
      memory[store].clear();
      cleared.push(store);
    }
  } catch (error) {
    fail(error);
  }
  return { cleared, kept };
}
