import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// ---- build identity --------------------------------------------------------------------------------------------------
// Which commit a bundle was built from, whether the working tree was modified at that moment, and when. It is compiled
// into the app (`__LL_BUILD__`, read in src/lib/build.ts) and stamped into the built index.html (a <meta> the Brain
// reports in /api/health and tools/preview_identity.py reads from the page actually served), so a bundle can be told
// from the commit a server runs. Unknown stays unknown; nothing is guessed.
export const BUILD_STAMP = "ll-build";

export interface BuildIdentity {
  /** Short commit of the checkout being built, or "unknown". */
  commit: string;
  /** The full commit id, or null when it could not be read. */
  commitFull: string | null;
  /** Uncommitted changes or new unignored files in the checkout when the build ran; null when not determined (and under the development server, which serves the files as they are). */
  dirty: boolean | null;
  /** UTC time of the build (under the development server: of its start). */
  builtAt: string;
}

/** Full id of the checkout's HEAD, read from git's own files (no git executable, no dependency); null when unknown. */
export function headCommit(checkout: string = here("..")): string | null {
  try {
    let gitDir = join(checkout, ".git");
    if (statSync(gitDir).isFile()) gitDir = resolve(checkout, readFileSync(gitDir, "utf8").trim().replace(/^gitdir:\s*/, "")); // linked worktree
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    let value = head;
    if (head.startsWith("ref:")) {
      const ref = head.slice(4).trim();
      if (!ref.startsWith("refs/") || ref.split("/").includes("..")) return null;
      const commonFile = join(gitDir, "commondir");
      const common = existsSync(commonFile) ? resolve(gitDir, readFileSync(commonFile, "utf8").trim()) : gitDir;
      const loose = [join(gitDir, ref), join(common, ref)].find((file) => existsSync(file));
      const packed = join(common, "packed-refs");
      if (loose) value = readFileSync(loose, "utf8").trim();
      else value = (existsSync(packed) ? readFileSync(packed, "utf8").split(/\r?\n/) : []).find((line) => line.endsWith(` ${ref}`))?.split(" ")[0] ?? "";
    }
    return /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function shortCommit(checkout: string = here("..")): string {
  return headCommit(checkout)?.slice(0, 7) ?? "unknown";
}

/**
 * Whether exactly this checkout has uncommitted changes or new unignored files: one bounded, read-only `git status`
 * (no lock, nothing refreshed, inherited GIT_* variables not passed on, no parent folder searched). null when git is
 * absent, slow or refuses, or this is not a checkout.
 */
export function workingTreeModified(checkout: string = here("..")): boolean | null {
  try {
    if (!existsSync(join(checkout, ".git"))) return null;
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")));
    const args = ["--no-optional-locks", "-c", "core.fsmonitor=false", "--git-dir", join(checkout, ".git"), "--work-tree", checkout, "status", "--porcelain", "--untracked-files=normal"];
    // Started from Node's own folder: a program named git in the project folder is never the one that runs.
    const out = execFileSync("git", args, { encoding: "utf8", timeout: 10_000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"], env, cwd: dirname(process.execPath) });
    return out.trim().length > 0;
  } catch {
    return null;
  }
}

export function buildIdentity(command: "build" | "serve", checkout: string = here(".."), now: Date = new Date()): BuildIdentity {
  const commitFull = headCommit(checkout);
  return { commit: commitFull?.slice(0, 7) ?? "unknown", commitFull, dirty: command === "build" ? workingTreeModified(checkout) : null, builtAt: now.toISOString().replace(/\.\d{3}Z$/, "Z") };
}

/** The content of the stamp: `commit=<full id|unknown>; dirty=<true|false|unknown>; built_at=<UTC time>` (no quotes, so it survives any HTML writer). */
export function stampContent(identity: BuildIdentity): string {
  return `commit=${identity.commitFull ?? "unknown"}; dirty=${identity.dirty === null ? "unknown" : String(identity.dirty)}; built_at=${identity.builtAt}`;
}

export function buildIdentityPlugin(checkout: string = here("..")): Plugin {
  let identity = buildIdentity("serve", checkout);
  return {
    name: "ll-build-identity",
    config(_config, env) {
      identity = buildIdentity(env.command, checkout);
      return { define: { __LL_BUILD__: JSON.stringify({ commit: identity.commit, dirty: identity.dirty, builtAt: identity.builtAt }) } };
    },
    // Built pages only: the development server serves the working files as they are, so there is no build to name.
    transformIndexHtml: (_html, context) => (context.server ? [] : [{ tag: "meta", attrs: { name: BUILD_STAMP, content: stampContent(identity) }, injectTo: "head" }]),
  };
}

// Static SPA only: no SSR, no hosted inference backend. The dev server binds loopback.
// In development /api is proxied to the loopback Brain operator surface; production
// cross-device builds use the Drive transport instead and never reach a PC port.
export default defineConfig({
  plugins: [react(), tailwindcss(), buildIdentityPlugin()],
  resolve: {
    alias: { "@": here("./src"), "@contracts": here("../contracts") },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: { allow: [here("."), here("../contracts"), here("../config"), here("../docs/project")] },
    proxy: {
      "/api": { target: `http://127.0.0.1:${process.env.LL_BRAIN_PORT ?? "8765"}`, changeOrigin: false },
    },
  },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  // manifest: the bundler's own list of the files it emitted under content-hashed names (.vite/manifest.json). The Brain
  // lets a browser keep exactly those files; anything merely copied into the built app is asked for again each time.
  build: { target: "es2022", sourcemap: true, outDir: "dist", manifest: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    css: false,
    restoreMocks: true,
  },
});
