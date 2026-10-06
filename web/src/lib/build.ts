// Build identity: which app build this page is, and which build the Brain says it is serving right now.
// This module only supplies the facts; the shell and Settings decide how to show them.
import { apiGet } from "./api";

// Replaced at compile time by vite.config.ts (its build-identity plugin): the checkout's short commit, whether the
// working tree was modified when the bundle was built, and the time of the build.
declare const __LL_BUILD__: { commit: string; dirty: boolean | null; builtAt: string } | undefined;

export interface WebBuild {
  /** Short commit of the checkout this bundle was built from, or "unknown". */
  commit: string;
  /** Whether the working tree had uncommitted changes when this bundle was built; null when that was not determined (always null under the development server). */
  dirty: boolean | null;
  /** UTC time of the build (under the development server: of its start), or "unknown". */
  builtAt: string;
}

export const WEB_BUILD: WebBuild =
  typeof __LL_BUILD__ !== "undefined" && __LL_BUILD__
    ? { commit: __LL_BUILD__.commit, dirty: typeof __LL_BUILD__.dirty === "boolean" ? __LL_BUILD__.dirty : null, builtAt: __LL_BUILD__.builtAt }
    : { commit: "unknown", dirty: null, builtAt: "unknown" };

export interface AssetNames {
  /** Script files, without a leading slash. */
  script: string[];
  /** Stylesheets, without a leading slash. */
  style: string[];
}

/** What the built page the Brain serves now states about its own origin (its build stamp). A null field was not established. */
export interface ServedWebBuild {
  commit: string | null;
  commit_short: string | null;
  /** Whether the working tree was modified when that bundle was built. */
  dirty: boolean | null;
  built_at: string | null;
}

/** One course's private preparation state as stored now: ids and digests only. */
export interface CoursePreparationIdentity {
  /** One id over the stored preparation state of all lecture units; null when nothing was ever prepared. */
  preparation_generation: string | null;
  prepared_lectures: number;
  preparation_tool_versions: string[];
  /** Per deck source id: the stored source maps, one per version of the deck's bytes (oldest written first). */
  map_revisions: Record<string, { source_sha256_prefix: string; map_revision: string | null; overrides_revision: number | null }[]>;
  /** Per recording source id: ids of the stored generated-timing generations. */
  derived_generations: Record<string, string[]>;
}

/** `GET /api/health` → `build`: what the Brain process states about itself. A null field means "not established". */
export interface ServedIdentity {
  app_version: string;
  /** The commit of the code the Brain process loaded when it started. */
  commit: string | null;
  commit_short: string | null;
  branch: string | null;
  /** Uncommitted changes in the checkout when the process started; null when that could not be determined. */
  dirty: boolean | null;
  /** Operating-system id of the Brain process, to tell it from any other instance on this PC. */
  pid: number;
  process_started_at: string;
  /** How the start time is known: the operating system's record of the process, or (later) the load of the Brain's code. */
  process_started_basis: "os_process_creation" | "module_import";
  profile: string;
  /** The port the Brain itself listens on (under the development server this differs from the page's port). */
  port: number | null;
  preparation_tool_version: string;
  source_map_version: string | null;
  /** Files named by the index.html the Brain serves now. */
  assets: AssetNames;
  /** The build stamp of that index.html; null when it carries none (built before the stamp existed) or no built app is served. */
  web_build: ServedWebBuild | null;
  static: { served: boolean; directory: string | null; index_modified_at: string | null; index_sha256: string | null };
  courses: Record<string, CoursePreparationIdentity>;
}

/** The identity of the serving Brain, or null when it is an older process whose health view carries none. */
export async function fetchServedIdentity(signal?: AbortSignal): Promise<ServedIdentity | null> {
  const health = await apiGet<{ build?: ServedIdentity }>("health", signal);
  return health.build ?? null;
}

function assetName(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url, "http://page.invalid/").pathname.replace(/^\/+/, "") || null;
  } catch {
    return null;
  }
}

/** The script and stylesheet files this page itself loaded, named the same way as `ServedIdentity.assets`. */
export function loadedAssets(doc: Document = document): AssetNames {
  const names = (selector: string): string[] => {
    const found = [...doc.querySelectorAll(selector)].map((element) => assetName(element.getAttribute("src") ?? element.getAttribute("href")));
    return [...new Set(found.filter((name): name is string => name !== null))];
  };
  return { script: names('script[src], link[rel~="modulepreload"][href]'), style: names('link[rel~="stylesheet"][href]') };
}

/**
 * Is this page the build the Brain serves now?
 * - "same": every file the served index.html names was loaded by this page;
 * - "different": one was not - the app was rebuilt after this page loaded, so a reload shows the newer build;
 * - "unknown": the Brain states no identity or serves no built app, or the page comes from the development server
 *   (whose files are not the built ones, so the comparison would mean nothing).
 */
export function pageMatchesServed(served: ServedIdentity | null, loaded: AssetNames = loadedAssets(), development: boolean = import.meta.env.DEV): "same" | "different" | "unknown" {
  if (development || !served || !served.static?.served || !served.assets) return "unknown";
  const expected = [...(served.assets.script ?? []), ...(served.assets.style ?? [])];
  if (expected.length === 0) return "unknown";
  const have = new Set([...loaded.script, ...loaded.style]);
  return expected.every((name) => have.has(name)) ? "same" : "different";
}

/**
 * Was the web bundle the Brain serves built from the commit the Brain runs?
 * - "same_commit": yes, from an unmodified tree;
 * - "modified_tree": from that commit, but the working tree was modified when it was built (or that is not known);
 * - "other_commit": no - a commit was made without rebuilding the web app, or the Brain was not restarted;
 * - "unknown": the served page carries no build stamp, or the Brain states no commit.
 */
export function bundleMatchesBrain(served: ServedIdentity | null): "same_commit" | "modified_tree" | "other_commit" | "unknown" {
  const stamp = served?.web_build;
  if (!served || !stamp || !stamp.commit || !served.commit) return "unknown";
  if (stamp.commit !== served.commit) return "other_commit";
  return stamp.dirty === false ? "same_commit" : "modified_tree";
}
