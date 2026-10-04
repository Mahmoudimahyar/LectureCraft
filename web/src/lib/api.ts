// Read access to the Brain's views. On this PC the app talks to the loopback Brain (same origin via
// the dev proxy or the Brain's own static hosting). There is no hosted backend and no inference API.
export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

export const API_BASE = "/api";

async function parseError(response: Response): Promise<ApiError> {
  let detail = response.statusText || `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") detail = body.detail;
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(response.status, detail);
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/${path}`, { signal, headers: { accept: "application/json" }, cache: "no-store" });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(0, "The Brain on this PC is not reachable. Reading cached pages and drafting still work; nothing is sent until it is back.");
  }
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "The Brain on this PC is not reachable.");
  }
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

export async function apiPutBytes(path: string, bytes: Uint8Array): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/${path}`, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: bytes as BodyInit });
  } catch {
    throw new ApiError(0, "The Brain on this PC is not reachable.");
  }
  if (!response.ok) throw await parseError(response);
}

/** URL for source bytes resolved by id on the Brain (never a filesystem path or an expiring signed URL). */
export const contentUrl = (relative: string): string => `${API_BASE}/${relative}`;
