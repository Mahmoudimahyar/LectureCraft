// Starts a real fixture-profile Brain for the browser tests: fresh synthetic course roots and a fresh
// journal under .local/e2e, loopback only, serving the built app from web/dist. Nothing here touches
// real course folders, a native tutor, Drive or any account.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const area = join(repo, ".local", "e2e");
const port = process.env.LL_E2E_PORT ?? "8791";
const python = join(repo, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

if (!existsSync(join(repo, "web", "dist", "index.html"))) {
  console.error("web/dist is missing: run `npm run build` (or `python tools/ci.py --only e2e`) first.");
  process.exit(2);
}
rmSync(area, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
mkdirSync(area, { recursive: true });

const child = spawn(python, ["-m", "lecture_brain", "--profile", "fixture", "--state-dir", join(area, "state"), "serve", "--port", port, "--static", join(repo, "web", "dist")], {
  cwd: repo,
  stdio: "inherit",
  env: { ...process.env, LL_PROFILE: "fixture", LL_FIXTURE_ROOT: join(area, "fixture-workspace"), PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" },
});
const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
