// The generated token stylesheet says what the token file says (design spec 3.6): every palette key, wash, scale
// role, weight, radius role and spacing step of docs/project/design-tokens.json has its custom property in
// src/styles/tokens.css with the same value, and src/styles.css names each of them for Tailwind. The contrast
// arithmetic is not repeated here: it lives in one place, the kit check (tools/check_baseline.py).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Palette = Record<string, string>;
interface ScaleRow { size: number[]; line: number[] }
interface Tokens {
  version: string;
  light: Palette;
  dark: Palette;
  wash_pct: { ink: string; light: Record<string, number>; dark: Record<string, number> };
  typography: { ui: string; base_px: number; line_height: number; weights: Record<string, number>; scale_from_px: number[]; scale_px: Record<string, ScaleRow> };
  spacing_px: number[];
  radius_px: number;
  radius_role_px: Record<string, number>;
  motion: { small_ms: number; panel_ms: number; reduced_motion_ms: number };
}

const web = resolve(import.meta.dirname, "../..");
const tokens = JSON.parse(readFileSync(resolve(web, "../docs/project/design-tokens.json"), "utf8")) as Tokens;
const css = readFileSync(resolve(web, "src/styles/tokens.css"), "utf8").replace(/\r/g, "");
const styles = readFileSync(resolve(web, "src/styles.css"), "utf8").replace(/\r/g, "");
const kebab = (key: string): string => key.replace(/_/g, "-");
const rem = (px: number): string => `${px / tokens.typography.base_px}rem`;

/** The declarations of every rule whose selector line is exactly `selector`, outside any @media block or inside the named one. */
function declarations(sheet: string, selector: string, media: string | null = null): Map<string, string> {
  const found = new Map<string, string>();
  let at: string | null = null;
  let depth = 0;
  let open: string | null = null;
  for (const raw of sheet.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("@media")) {
      at = line.replace(/\s*\{$/, "");
      depth = 1;
      continue;
    }
    if (line.endsWith("{")) {
      open = line.replace(/\s*\{$/, "");
      if (at) depth += 1;
      continue;
    }
    if (line === "}") {
      if (open !== null) open = null;
      if (at) {
        depth -= 1;
        if (depth === 0) at = null;
      }
      continue;
    }
    const match = /^(--[a-z0-9-]+):\s*(.+);$/.exec(line);
    if (match && open === selector && at === media) found.set(match[1]!, match[2]!);
  }
  return found;
}

/** What the stylesheet must declare for one theme: the palette and the washes. */
function expectedTheme(theme: "light" | "dark"): Map<string, string> {
  const wanted = new Map<string, string>();
  for (const [key, value] of Object.entries(tokens[theme])) wanted.set(`--ll-${kebab(key)}`, value);
  for (const [name, pct] of Object.entries(tokens.wash_pct[theme])) wanted.set(`--ll-${kebab(name)}`, `color-mix(in srgb, var(--ll-${kebab(tokens.wash_pct.ink)}) ${pct}%, transparent)`);
  return wanted;
}

/** Every property of `wanted` that `sheet` lacks or declares with another value, as "name: wanted ≠ found". */
function mismatches(wanted: Map<string, string>, found: Map<string, string>): string[] {
  return [...wanted].filter(([name, value]) => found.get(name) !== value).map(([name, value]) => `${name}: ${value} ≠ ${found.get(name) ?? "(absent)"}`);
}

describe("generated design tokens", () => {
  it("names the version of the token file it was generated from", () => {
    expect(css.split("\n")[0]).toContain(`(v${tokens.version})`);
  });

  it("declares the same 18 palette keys in both themes, each an opaque hex colour", () => {
    expect(Object.keys(tokens.light).sort()).toEqual(Object.keys(tokens.dark).sort());
    expect(Object.keys(tokens.light)).toHaveLength(18);
    for (const theme of ["light", "dark"] as const) for (const value of Object.values(tokens[theme])) expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("carries every palette key and wash of the light theme", () => {
    expect(mismatches(expectedTheme("light"), declarations(css, ':root, [data-theme="light"]'))).toEqual([]);
  });

  it("carries every palette key and wash of the dark theme", () => {
    expect(mismatches(expectedTheme("dark"), declarations(css, '[data-theme="dark"]'))).toEqual([]);
  });

  it("declares nothing in a theme block that the token file does not hold", () => {
    for (const [theme, selector] of [["light", ':root, [data-theme="light"]'], ["dark", '[data-theme="dark"]']] as const) {
      expect([...declarations(css, selector).keys()].sort()).toEqual([...expectedTheme(theme).keys()].sort());
    }
  });

  it("carries the weights, the radii by role, the spacing steps and the motion durations", () => {
    const wanted = new Map<string, string>([["--ll-font-ui", tokens.typography.ui], ["--ll-line-height", String(tokens.typography.line_height)], ["--ll-radius", `${tokens.radius_px}px`],
      ["--ll-motion-small", `${tokens.motion.small_ms}ms`], ["--ll-motion-panel", `${tokens.motion.panel_ms}ms`]]);
    for (const [name, value] of Object.entries(tokens.typography.weights)) wanted.set(`--ll-weight-${kebab(name)}`, String(value));
    for (const [name, value] of Object.entries(tokens.radius_role_px)) wanted.set(`--ll-radius-${kebab(name)}`, `${value}px`);
    tokens.spacing_px.forEach((value, index) => wanted.set(`--ll-space-${index + 1}`, `${value}px`));
    expect(tokens.spacing_px).toHaveLength(7);
    expect(tokens.radius_role_px.control).toBe(tokens.radius_px);
    expect(mismatches(wanted, declarations(css, ":root"))).toEqual([]);
  });

  it("carries the type scale: every role at the base width, then only what changes at each step", () => {
    const steps = tokens.typography.scale_from_px;
    expect(steps[0]).toBe(0);
    for (const [index, from] of steps.entries()) {
      const wanted = new Map<string, string>();
      for (const [role, row] of Object.entries(tokens.typography.scale_px)) {
        if (index === 0 || row.size[index] !== row.size[index - 1]) wanted.set(`--ll-fs-${kebab(role)}`, rem(row.size[index]!));
        if (index === 0 || row.line[index] !== row.line[index - 1]) wanted.set(`--ll-lh-${kebab(role)}`, rem(row.line[index]!));
      }
      const found = declarations(css, ":root", index === 0 ? null : `@media (min-width: ${from}px)`);
      expect(mismatches(wanted, found), `step from ${from} px`).toEqual([]);
      if (index > 0) expect([...found.keys()].sort(), `step from ${from} px declares only what changes`).toEqual([...wanted.keys()].sort());
    }
  });

  it("turns motion off under reduced motion, by preference and by setting", () => {
    const off = `${tokens.motion.reduced_motion_ms}ms`;
    expect(off).toBe("0ms");
    for (const found of [declarations(css, ":root", "@media (prefers-reduced-motion: reduce)"), declarations(css, '[data-motion="reduced"]')]) {
      expect(found.get("--ll-motion-small")).toBe(off);
      expect(found.get("--ll-motion-panel")).toBe(off);
    }
  });

  it("reports a missing or changed property (the comparison is not vacuous)", () => {
    const doctored = css.replace(/^ {2}--ll-accent-text: .*;\n/m, "").replace(`--ll-tint: ${tokens.light.tint};`, "--ll-tint: #000000;");
    const problems = mismatches(expectedTheme("light"), declarations(doctored, ':root, [data-theme="light"]'));
    expect(problems).toEqual([`--ll-accent-text: ${tokens.light.accent_text} ≠ (absent)`, `--ll-tint: ${tokens.light.tint} ≠ #000000`]);
  });
});

describe("Tailwind names of the tokens (src/styles.css, @theme inline)", () => {
  const theme = new Map<string, string>();
  for (const block of styles.matchAll(/@theme inline \{([^}]*)\}/g)) for (const line of block[1]!.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) theme.set(line[1]!, line[2]!.trim());

  it("keeps the thirteen names of token version 1", () => {
    const wanted = new Map<string, string>([["--color-bg", "var(--ll-background)"], ["--color-surface", "var(--ll-surface)"], ["--color-raised", "var(--ll-surface-raised)"], ["--color-ink", "var(--ll-text)"],
      ["--color-muted", "var(--ll-muted-text)"], ["--color-line", "var(--ll-border)"], ["--color-accent", "var(--ll-accent)"], ["--color-on-accent", "var(--ll-on-accent)"], ["--color-focus", "var(--ll-focus)"],
      ["--color-success", "var(--ll-success)"], ["--color-caution", "var(--ll-caution)"], ["--color-danger", "var(--ll-danger)"], ["--color-unassessed", "var(--ll-unassessed)"]]);
    expect(mismatches(wanted, theme)).toEqual([]);
  });

  it("names the derived colours and the washes", () => {
    const wanted = new Map<string, string>();
    for (const key of ["hairline", "accent_hover", "accent_text", "tint", "tint_strong"]) wanted.set(`--color-${kebab(key)}`, `var(--ll-${kebab(key)})`);
    for (const name of Object.keys(tokens.wash_pct.light)) wanted.set(`--color-${kebab(name)}`, `var(--ll-${kebab(name)})`);
    expect(mismatches(wanted, theme)).toEqual([]);
  });

  it("names every role of the type scale with its line height", () => {
    const wanted = new Map<string, string>();
    for (const role of Object.keys(tokens.typography.scale_px)) {
      wanted.set(`--text-${kebab(role)}`, `var(--ll-fs-${kebab(role)})`);
      wanted.set(`--text-${kebab(role)}--line-height`, `var(--ll-lh-${kebab(role)})`);
    }
    expect(wanted.size).toBe(14);
    expect(mismatches(wanted, theme)).toEqual([]);
  });

  it("names the radii by role", () => {
    const wanted = new Map<string, string>();
    for (const role of ["thumb", "row", "control", "region"]) wanted.set(`--radius-${role}`, `var(--ll-radius-${role})`);
    expect(mismatches(wanted, theme)).toEqual([]);
  });

  it("points every name at a property the generated stylesheet declares", () => {
    const declared = new Set([...css.matchAll(/(--ll-[a-z0-9-]+):/g)].map((match) => match[1]!));
    const dangling = [...theme].filter(([, value]) => /^var\(--ll-[a-z0-9-]+\)$/.test(value)).map(([, value]) => value.slice(4, -1)).filter((name) => !declared.has(name));
    expect(dangling).toEqual([]);
  });
});
