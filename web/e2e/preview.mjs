// Developer aid (not a test): an OWNED loopback preview of the app with synthetic fixture courses.
// Each name gets its own build folder, state folder and port under .local/preview/<name>, so several
// people (or agents) can look at their own work at once without touching the browser-test instance
// (port 8791, .local/e2e) or anybody else's server.
//
//   node e2e/preview.mjs start <name> <port>   build the app, start a fixture-profile Brain, keep running
//   node e2e/preview.mjs build <name>          rebuild the app only (a running preview serves it on reload)
//   node e2e/preview.mjs stop  <name>          stop the Brain this tool started for <name> (by its recorded pid)
//   node e2e/preview.mjs status <name>
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(web, "..");
const [command, name, portArg] = process.argv.slice(2);
if (!["start", "build", "stop", "status"].includes(command ?? "") || !/^[a-z0-9-]{1,24}$/.test(name ?? "")) {
  console.error("usage: node e2e/preview.mjs start|build|stop|status <name> [port]   (name: a-z, 0-9, -)");
  process.exit(2);
}
const area = join(repo, ".local", "preview", name);
const dist = join(area, "dist");
const pidFile = join(area, "brain.json");
const python = join(repo, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

function build() {
  mkdirSync(area, { recursive: true });
  const run = spawnSync(process.execPath, [join(web, "node_modules", "vite", "bin", "vite.js"), "build", "--outDir", dist, "--emptyOutDir", "--logLevel", "warn"], { cwd: web, stdio: "inherit" });
  if (run.status !== 0) {
    console.error("build failed");
    process.exit(run.status ?? 1);
  }
  console.log(`built ${dist}`);
}

function recorded() {
  try {
    return JSON.parse(readFileSync(pidFile, "utf8"));
  } catch {
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

if (command === "build") build();

if (command === "status") {
  const info = recorded();
  console.log(JSON.stringify(info ? { ...info, alive: alive(info.pid) } : { running: false }));
}

if (command === "stop") {
  const info = recorded();
  if (info && alive(info.pid)) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(info.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(info.pid);
    console.log(`stopped pid ${info.pid} (${info.url})`);
  } else console.log("not running");
  rmSync(pidFile, { force: true });
}

if (command === "start") {
  const port = Number(portArg);
  if (!Number.isInteger(port) || port < 8800 || port > 8899) {
    console.error("port must be in 8800-8899 (8765, 8791, 8793 and 8797 belong to others)");
    process.exit(2);
  }
  const previous = recorded();
  if (previous && alive(previous.pid)) {
    console.error(`already running: ${previous.url} (pid ${previous.pid}); use 'build' to refresh or 'stop' first`);
    process.exit(2);
  }
  build();
  rmSync(join(area, "state"), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  rmSync(join(area, "fixture-workspace"), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  const child = spawn(python, ["-m", "lecture_brain", "--profile", "fixture", "--state-dir", join(area, "state"), "serve", "--port", String(port), "--static", dist], {
    cwd: repo,
    stdio: "inherit",
    env: { ...process.env, LL_PROFILE: "fixture", LL_FIXTURE_ROOT: join(area, "fixture-workspace"), PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" },
  });
  const url = `http://127.0.0.1:${port}`;
  writeFileSync(pidFile, JSON.stringify({ pid: child.pid, url, port, name, started_at: new Date().toISOString() }));
  console.log(`preview ${name}: ${url} (pid ${child.pid}); synthetic fixture courses; stop with: node e2e/preview.mjs stop ${name}`);
  const stop = () => child.kill();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code) => {
    if (existsSync(pidFile) && recorded()?.pid === child.pid) rmSync(pidFile, { force: true });
    process.exit(code ?? 0);
  });
}
