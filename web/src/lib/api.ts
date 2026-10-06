// Read access to the Brain's views. On this PC the app talks to the loopback Brain (same origin via
// the dev proxy or the Brain's own static hosting). There is no hosted backend and no inference API.
export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
    /**
     * The Brain's own code of a refusal, when its answer carries one: a source-map correction (`invalid_override`,
     * `learner_correction_in_force`), or the concept graph's error document (`unknown_scope`, `unknown_focus`).
     */
    public code?: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

export const API_BASE = "/api";

const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value : undefined);
/** The messages of a request the Brain could not read (422): `[{loc: ["query", "depth"], msg: "…"}]` → "depth: …; limit: …". */
function validationMessages(detail: unknown): string | undefined {
  if (!Array.isArray(detail)) return undefined;
  const lines = detail.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") return undefined;
    const { loc, msg } = entry as { loc?: unknown; msg?: unknown };
    const message = text(msg);
    const where = Array.isArray(loc) ? loc.filter((part) => typeof part === "string" || typeof part === "number").slice(-1)[0] : undefined;
    return message === undefined ? undefined : where === undefined ? message : `${where}: ${message}`;
  }).filter((line): line is string => line !== undefined);
  return lines.length ? lines.join("; ") : undefined;
}
/**
 * The error the Brain answered, in each spelling it uses: `{detail}` (with `code` on a refusal), a list of messages
 * under `detail` for a malformed request, and the error document of the concept graph, `{course_id, graph_version,
 * error: {code, detail}}` (docs/engineering/r2-read-api.md 1.4). Anything else keeps the status text.
 */
async function parseError(response: Response): Promise<ApiError> {
  let detail = response.statusText || `HTTP ${response.status}`;
  let code: string | undefined;
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object") {
      const { detail: stated, code: statedCode, error } = body as { detail?: unknown; code?: unknown; error?: unknown };
      const document = error && typeof error === "object" ? (error as { code?: unknown; detail?: unknown }) : null;
      detail = text(stated) ?? validationMessages(stated) ?? text(document?.detail) ?? detail;
      code = text(statedCode) ?? text(document?.code);
    }
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(response.status, detail, code);
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

// ---- Remediation amendment R2: routes of docs/engineering/r2-read-api.md, section 2 ----------------------------------------
/** A concept-graph scope: `course`, `lecture:<lecture_id>` or `slide:<lecture_id>:<page>`. One model, three filters. */
export const conceptScope = {
  course: "course" as const,
  lecture: (lectureId: string): `lecture:${string}` => `lecture:${lectureId}`,
  slide: (lectureId: string, page: number): `slide:${string}:${number}` => `slide:${lectureId}:${page}`,
};
/** The query of `GET /api/courses/{c}/concept-graph`. */
export interface ConceptGraphQuery {
  /** Default: the course. */
  scope?: "course" | `lecture:${string}` | `slide:${string}:${number}`;
  /** A node id: the answer is then that node's neighbourhood, questions and criteria included. */
  focus?: string | null;
  /** 1 to 3 relations around the focus (default 1). */
  depth?: number;
  /** Cap on nodes (default 150, at most 400). */
  limit?: number;
}
const id = encodeURIComponent;
/** Paths under `/api`, for `apiGet` and `apiPost`. An id is always one path segment or one query value, never a path. */
export const r2Paths = {
  conceptGraph(courseId: string, query: ConceptGraphQuery = {}): string {
    const params = new URLSearchParams({ scope: query.scope ?? "course" });
    if (query.focus) params.set("focus", query.focus);
    if (query.depth !== undefined) params.set("depth", String(query.depth));
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    return `courses/${id(courseId)}/concept-graph?${params.toString()}`;
  },
  outlineNode: (courseId: string, nodeId: string): string => `courses/${id(courseId)}/outline/node?id=${id(nodeId)}`,
  /** `queue: false` leaves out the transcription runner's queue and allowance (it walks every course): for screens that show no queue. */
  courseTiming: (courseId: string, options: { queue?: boolean } = {}): string => `courses/${id(courseId)}/timing${options.queue === false ? "?queue=false" : ""}`,
  /** POST: rebuilds the lecture's derived timing links from current inputs (app-private file only). */
  timingBuild: (courseId: string, lectureId: string): string => `courses/${id(courseId)}/lectures/${id(lectureId)}/timing/build`,
  /** `deck` selects another file of the unit, like the lecture view's own `?deck=`. */
  sourceMap: (courseId: string, lectureId: string, deck?: string | null): string => `courses/${id(courseId)}/lectures/${id(lectureId)}/source-map${deck ? `?deck=${id(deck)}` : ""}`,
  /** POST: a learner correction as a new immutable revision. A refusal carries the source map's code (ApiError.code): 422 for a correction that is not valid, 409 for one that cannot be recorded now. */
  sourceMapOverrides: (courseId: string, lectureId: string, deck?: string | null): string =>
    `courses/${id(courseId)}/lectures/${id(lectureId)}/source-map/overrides${deck ? `?deck=${id(deck)}` : ""}`,
  inferredAnchors: (courseId: string): string => `courses/${id(courseId)}/inferred-anchors`,
  /** POST: the learner's own decision on a suggested link; a versioned local annotation that outranks the file. */
  suggestionDecision: (courseId: string, suggestionId: string): string => `courses/${id(courseId)}/suggestions/${id(suggestionId)}/decision`,
};
