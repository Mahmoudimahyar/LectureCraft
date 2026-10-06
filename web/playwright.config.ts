import { defineConfig, devices } from "@playwright/test";

// Real-browser checks against a real fixture-profile Brain on loopback (see e2e/serve-brain.mjs).
// One worker: every test shares one journal, exactly like one learner with one always-on PC.
// These are LOCAL checks with a labeled test-double tutor; they are not live acceptance.
const PORT = Number(process.env.LL_E2E_PORT ?? 8791);
const baseURL = `http://127.0.0.1:${PORT}`;
const chrome = devices["Desktop Chrome"];
// A separately owned run (LL_E2E_PORT, LL_E2E_AREA, LL_E2E_DIST, LL_STORIES_PORT) keeps its results apart too.
const RESULTS = process.env.LL_E2E_RESULTS ?? "../.local/e2e-results";

const viewport = (name: string, width: number, height: number, colorScheme: "light" | "dark", extra: Record<string, unknown> = {}) => ({
  name,
  use: { ...chrome, viewport: { width, height }, colorScheme, ...extra },
});

export default defineConfig({
  testDir: "./e2e",
  outputDir: `${RESULTS}/artifacts`,
  fullyParallel: false,
  workers: 1,
  // One retry absorbs OS-level loopback socket exhaustion seen on Windows in long runs (net::ERR_NO_BUFFER_SPACE).
  // A test that needed it is reported as "flaky", never as a plain pass; TEST_REPORT lists every such case.
  retries: Number(process.env.LL_E2E_RETRIES ?? 1), // set LL_E2E_RETRIES=0 for a run in which nothing can pass on a second try
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["json", { outputFile: `${RESULTS}/report.json` }]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure", actionTimeout: 10_000, launchOptions: { args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } },
  webServer: [
    { command: "node e2e/serve-brain.mjs", url: `${baseURL}/api/health`, reuseExistingServer: !!process.env.LL_E2E_REUSE, timeout: 120_000, stdout: "pipe", stderr: "pipe" },
    { command: "node e2e/serve-static.mjs", url: `http://127.0.0.1:${process.env.LL_STORIES_PORT ?? 8793}/index.json`, reuseExistingServer: !!process.env.LL_E2E_REUSE, timeout: 30_000 },
  ],
  projects: [
    // Component states: every shared story, both themes.
    { ...viewport("stories-light", 1280, 800, "light"), testMatch: /stories\/.*\.spec\.ts/ },
    { ...viewport("stories-dark", 1280, 800, "dark"), testMatch: /stories\/.*\.spec\.ts/ },
    // Flows: every journey in a wide Light layout and a narrow Dark layout.
    { ...viewport("flows-desktop-light", 1280, 800, "light"), testMatch: /flows\/.*\.spec\.ts/ },
    { ...viewport("flows-phone-dark", 390, 844, "dark", { hasTouch: true }), testMatch: /flows\/.*\.spec\.ts/, dependencies: ["flows-desktop-light"] },
    // Sweep: every screen at each required viewport in both themes (layout, contrast, accessibility, source fidelity).
    ...(["light", "dark"] as const).flatMap((scheme) => [
      viewport(`sweep-360-${scheme}`, 360, 800, scheme, { hasTouch: true }),
      viewport(`sweep-390-${scheme}`, 390, 844, scheme, { hasTouch: true }),
      viewport(`sweep-768-${scheme}`, 768, 1024, scheme),
      viewport(`sweep-1280-${scheme}`, 1280, 800, scheme),
      viewport(`sweep-1440-${scheme}`, 1440, 900, scheme),
    ]).map((p) => ({ ...p, testMatch: /sweep\/.*\.spec\.ts/, dependencies: ["flows-phone-dark"] })),
  ],
});
