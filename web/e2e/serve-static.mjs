// Minimal loopback static file server for the built component stories (.local/storybook-static).
// Test-only; it serves files from one directory and nothing else.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const root = join(repo, ".local", "storybook-static");
const port = Number(process.env.LL_STORIES_PORT ?? 8793);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".ico": "image/x-icon", ".map": "application/json" };

if (!existsSync(join(root, "index.json"))) {
  console.error("Component stories are not built: run `python tools/ci.py --only storybook` first.");
  process.exit(2);
}
createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  const target = normalize(join(root, path === "/" ? "index.html" : path));
  if (!(target === root || target.startsWith(root + sep)) || !existsSync(target) || !statSync(target).isFile()) {
    response.writeHead(404).end("not found");
    return;
  }
  response.writeHead(200, { "Content-Type": TYPES[extname(target)] ?? "application/octet-stream", "Cache-Control": "no-store" }).end(readFileSync(target));
}).listen(port, "127.0.0.1");
