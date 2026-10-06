// Build identity: the helpers of web/src/lib/build.ts and the build-identity part of web/vite.config.ts.
// PROPOSED LOCATION: web/tests/lib/build.test.ts (copy as it is: every import is location-independent).
// The Brain is a LABELED DOUBLE here (a stubbed fetch); no server is contacted, nothing is built and no file is written.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WEB_BUILD, bundleMatchesBrain, fetchServedIdentity, loadedAssets, pageMatchesServed, type ServedIdentity } from "@/lib/build";
import viteConfig, { BUILD_STAMP, buildIdentity, buildIdentityPlugin, headCommit, shortCommit, stampContent, workingTreeModified } from "@/../vite.config";

const A = "a1".repeat(20);
const B = "b2".repeat(20);
const served = (script: string[], style: string[], extra: Partial<ServedIdentity> = {}): ServedIdentity => ({
  app_version: "0.0.0-double", commit: A, commit_short: A.slice(0, 7), branch: "main", dirty: false, pid: 4242, process_started_at: "2026-10-05T23:00:00Z",
  process_started_basis: "os_process_creation", profile: "fixture", port: 8765, preparation_tool_version: "prep-5", source_map_version: "source-map/1",
  assets: { script, style }, web_build: { commit: A, commit_short: A.slice(0, 7), dirty: false, built_at: "2026-10-05T22:59:00Z" },
  static: { served: true, directory: "web/dist", index_modified_at: "2026-10-05T22:59:00Z", index_sha256: "0".repeat(64) },
  courses: { be505: { preparation_generation: "0123456789abcdef", prepared_lectures: 2, preparation_tool_versions: ["prep-5"], map_revisions: {}, derived_generations: {} } },
  ...extra,
});
// The checkout this test runs in (the config's own default), when it is one.
const inCheckout = existsSync(resolve(process.cwd(), "..", ".git")); // vitest runs from web/
const NOWHERE = resolve(process.cwd(), "..", ".local", "nowhere-ll-build-test"); // never created

afterEach(() => vi.unstubAllGlobals());

describe("the identity compiled into the app", () => {
  it("is the commit of this checkout, not the fallback, and says the tree state was not determined outside a build", () => {
    expect(WEB_BUILD.builtAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/); // the define was applied: "unknown" here means it was removed or misspelled
    expect(WEB_BUILD.commit).toBe(shortCommit());
    if (inCheckout) expect(WEB_BUILD.commit).toMatch(/^[0-9a-f]{7}$/);
    expect(WEB_BUILD.dirty).toBeNull(); // this is a test run (the development pipeline), not a build
  });
});

describe("the build stamp written by vite.config.ts", () => {
  it("reads the full commit from git's own files and falls back to unknown without guessing", () => {
    const full = headCommit();
    if (inCheckout) expect(full).toMatch(/^[0-9a-f]{40}$/);
    expect(shortCommit()).toBe(full ? full.slice(0, 7) : "unknown");
    expect(headCommit(NOWHERE)).toBeNull();
    expect(shortCommit(NOWHERE)).toBe("unknown");
    expect(workingTreeModified(NOWHERE)).toBeNull(); // not a checkout: unknown, and no git is started
  });

  it("states commit, tree state and time in the one format the Brain and the identity tool read", () => {
    const now = new Date("2026-10-05T21:50:44.123Z");
    expect(stampContent({ commit: A.slice(0, 7), commitFull: A, dirty: false, builtAt: "2026-10-05T21:50:44Z" })).toBe(`commit=${A}; dirty=false; built_at=2026-10-05T21:50:44Z`);
    expect(stampContent({ commit: A.slice(0, 7), commitFull: A, dirty: true, builtAt: "2026-10-05T21:50:44Z" })).toContain("dirty=true");
    expect(stampContent({ commit: "unknown", commitFull: null, dirty: null, builtAt: "2026-10-05T21:50:44Z" })).toBe("commit=unknown; dirty=unknown; built_at=2026-10-05T21:50:44Z");
    const dev = buildIdentity("serve", undefined, now);
    expect(dev).toEqual({ commit: shortCommit(), commitFull: headCommit(), dirty: null, builtAt: "2026-10-05T21:50:44Z" }); // the development server serves working files: no tree state is claimed
    expect(stampContent(dev)).toMatch(/^commit=([0-9a-f]{40}|unknown); dirty=(true|false|unknown); built_at=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(BUILD_STAMP).toBe("ll-build");
  });

  it("is injected into a built page only, with the same identity the bundle is compiled with", () => {
    const plugin = buildIdentityPlugin();
    const config = plugin.config as (config: object, env: { command: "build" | "serve"; mode: string }) => { define: Record<string, string> };
    const transform = plugin.transformIndexHtml as (html: string, context: { server?: object }) => { tag: string; attrs: Record<string, string>; injectTo: string }[];
    const compiled = JSON.parse(config({}, { command: "serve", mode: "test" }).define.__LL_BUILD__ ?? "null") as { commit: string; dirty: boolean | null; builtAt: string };
    expect(compiled.commit).toBe(shortCommit());
    expect(compiled.dirty).toBeNull();
    expect(transform("<html></html>", { server: {} })).toEqual([]); // development server: nothing is stamped
    const tags = transform("<html></html>", {});
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({ tag: "meta", injectTo: "head", attrs: { name: "ll-build" } });
    expect(tags[0]?.attrs.content).toBe(`commit=${headCommit() ?? "unknown"}; dirty=unknown; built_at=${compiled.builtAt}`);
    expect(tags[0]?.attrs.content).not.toMatch(/["'<>&]/); // nothing an HTML writer would have to escape
  });

  it("is part of the project's configuration, together with the bundler's manifest the Brain's cache rule reads", () => {
    const plugins = (viteConfig.plugins ?? []).flat(5) as { name?: string }[];
    expect(plugins.filter((plugin) => plugin?.name === "ll-build-identity")).toHaveLength(1);
    expect(viteConfig.build?.manifest).toBe(true);
    expect(viteConfig.define?.__LL_BUILD__).toBeUndefined(); // one source: the plugin
  });
});

describe("what the Brain serves", () => {
  it("returns the build stated by /api/health, and null for a Brain that states none", async () => {
    const identity = served(["assets/index-AbCd1234.js"], ["assets/index-Zy_Xw-98.css"]);
    const fetchDouble = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({ ok: true, profile: "fixture", build: identity }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchDouble);
    expect(await fetchServedIdentity()).toEqual(identity);
    expect(fetchDouble.mock.calls[0]?.[0]).toBe("/api/health");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, profile: "local" }), { status: 200 })));
    expect(await fetchServedIdentity()).toBeNull();
  });

  it("names the files this page loaded the way the Brain names them", () => {
    const doc = document.implementation.createHTMLDocument("page");
    doc.head.innerHTML =
      '<script src="/theme-boot.js"></script><script type="module" crossorigin src="/assets/index-AbCd1234.js"></script>' +
      '<link rel="modulepreload" href="/assets/vendor-Qr_St-56.js"><link rel="stylesheet" crossorigin href="/assets/index-Zy_Xw-98.css?v=1">' +
      '<link rel="icon" href="/favicon.ico"><meta name="ll-build" content="commit=unknown; dirty=unknown; built_at=2026-10-05T21:50:44Z"><script>window.inline = 1;</script>';
    expect(loadedAssets(doc)).toEqual({ script: ["theme-boot.js", "assets/index-AbCd1234.js", "assets/vendor-Qr_St-56.js"], style: ["assets/index-Zy_Xw-98.css"] });
  });

  it("tells a current page from one loaded before a rebuild, and says unknown when nothing can be compared", () => {
    const loaded = { script: ["theme-boot.js", "assets/index-AbCd1234.js", "assets/lazy-Mm33Nn44.js"], style: ["assets/index-Zy_Xw-98.css"] };
    expect(pageMatchesServed(served(["theme-boot.js", "assets/index-AbCd1234.js"], ["assets/index-Zy_Xw-98.css"]), loaded, false)).toBe("same");
    expect(pageMatchesServed(served(["theme-boot.js", "assets/index-Nn00Pp11.js"], ["assets/index-Zy_Xw-98.css"]), loaded, false)).toBe("different");
    expect(pageMatchesServed(served(["theme-boot.js", "assets/index-AbCd1234.js"], ["assets/index-OTHER000.css"]), loaded, false)).toBe("different");
    expect(pageMatchesServed(null, loaded, false)).toBe("unknown");
    expect(pageMatchesServed(served([], [], { static: { served: false, directory: null, index_modified_at: null, index_sha256: null } }), loaded, false)).toBe("unknown");
    expect(pageMatchesServed(served([], []), loaded, false)).toBe("unknown");
    expect(pageMatchesServed(served(["assets/index-Nn00Pp11.js"], []), loaded, true)).toBe("unknown"); // development server
    // A Brain that still states the first version's shape (static.js / static.css, no assets) is "unknown", never a crash.
    const firstVersion = { ...served([], []), assets: undefined, static: { served: true, js: ["assets/index-Nn00Pp11.js"], css: [] } } as unknown as ServedIdentity;
    expect(pageMatchesServed(firstVersion, loaded, false)).toBe("unknown");
  });

  it("tells a bundle built from the commit the Brain runs from a stale or modified one", () => {
    const names: [string[], string[]] = [["assets/index-AbCd1234.js"], []];
    expect(bundleMatchesBrain(served(...names))).toBe("same_commit");
    expect(bundleMatchesBrain(served(...names, { commit: B, commit_short: B.slice(0, 7) }))).toBe("other_commit"); // a commit without a rebuild
    expect(bundleMatchesBrain(served(...names, { web_build: { commit: A, commit_short: A.slice(0, 7), dirty: true, built_at: null } }))).toBe("modified_tree");
    expect(bundleMatchesBrain(served(...names, { web_build: { commit: A, commit_short: A.slice(0, 7), dirty: null, built_at: null } }))).toBe("modified_tree"); // not known to be unmodified
    expect(bundleMatchesBrain(served(...names, { web_build: null }))).toBe("unknown"); // built before the stamp existed
    expect(bundleMatchesBrain(served(...names, { web_build: { commit: null, commit_short: null, dirty: null, built_at: null } }))).toBe("unknown");
    expect(bundleMatchesBrain(served(...names, { commit: null }))).toBe("unknown");
    expect(bundleMatchesBrain(null)).toBe("unknown");
  });
});
