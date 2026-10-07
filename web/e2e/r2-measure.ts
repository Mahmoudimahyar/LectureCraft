// Measurements for the R2 visual checks (web/e2e/flows/08-r2-visual-identity.spec.ts). Everything here is read from the
// rendered page: computed styles, boxes and line boxes as the browser laid them out. Nothing is read from a token or a
// class name, so a check cannot pass because a style was declared and not applied.
import type { Locator, Page } from "@playwright/test";

export type Rgba = [number, number, number, number];
export interface Census {
  /** Rendered font size (CSS px, after transforms and zoom) → characters of visible text at that size. */
  sizes: Record<string, number>;
  chars: number;
  smallest: number;
  /** Share of the characters below 14 px. */
  below14: number;
  /** A few of the texts below 14 px, for the report. */
  small: string[];
}
export interface ReadingSample { selector: string; count: number; minSize: number; maxSize: number; minLineHeight: number; text: string }
export interface LongLine { chars: number; text: string; where: string }
export interface ContrastMiss { text: string; ratio: number; needed: number; size: number; color: string; on: string; where: string }
export interface PillFound { text: string; where: string; interactive: boolean; radius: string; box: string }
export interface Nesting { deepest: number; where: string; containers: number }

export interface R2Api {
  census(): Census;
  reading(selectors: string[]): ReadingSample[];
  lines(root: string): { blocks: number; lines: number; longest: number; long: LongLine[] };
  contrast(): { sampled: number; misses: ContrastMiss[] };
  pills(): PillFound[];
  nesting(selectors: string[]): Nesting;
  signature(el: Element): { all: string; shape: string };
  background(el: Element): Rgba;
  rgba(color: string): Rgba;
  ratio(a: Rgba, b: Rgba): number;
  over(top: Rgba, bottom: Rgba): Rgba;
}

/** Runs in the page before any of its scripts. Self-contained: it is serialised. */
function installInPage(): void {
  const SOURCE = ".ll-pdf-textlayer"; // the slide's own selectable text: the source's typography, left out by R2-V7
  let probe: CanvasRenderingContext2D | null = null;
  const rgba = (color: string): Rgba => {
    if (!probe) {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      probe = canvas.getContext("2d", { willReadFrequently: true });
    }
    if (!probe) return [0, 0, 0, 0];
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = "rgba(0,0,0,0)";
    probe.fillStyle = color;
    probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data;
    return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, (d[3] ?? 0) / 255];
  };
  const over = (top: Rgba, bottom: Rgba): Rgba => {
    const a = top[3] + bottom[3] * (1 - top[3]);
    if (a <= 0) return [0, 0, 0, 0];
    const mix = (i: 0 | 1 | 2) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a;
    return [mix(0), mix(1), mix(2), a];
  };
  const background = (el: Element): Rgba => {
    const layers: Rgba[] = [];
    for (let node: Element | null = el; node; node = node.parentElement) {
      const colour = rgba(getComputedStyle(node).backgroundColor);
      if (colour[3] > 0) layers.push(colour);
      if (colour[3] >= 0.999) break;
    }
    let out: Rgba = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i -= 1) out = over(layers[i]!, out);
    return out;
  };
  const luminance = (c: Rgba): number => {
    const channel = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
  };
  const ratio = (a: Rgba, b: Rgba): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };

  /** Scale applied to an element's text by transforms, the `scale` property and `zoom` on it and its ancestors. */
  const scales = new WeakMap<Element, number>();
  const scaleOf = (el: Element | null): number => {
    if (!el) return 1;
    const known = scales.get(el);
    if (known !== undefined) return known;
    const style = getComputedStyle(el);
    let own = 1;
    if (style.transform && style.transform !== "none") {
      const m = new DOMMatrixReadOnly(style.transform);
      own *= Math.hypot(m.a, m.b);
    }
    if (style.scale && style.scale !== "none") own *= parseFloat(style.scale) || 1;
    const zoom = parseFloat((style as unknown as { zoom?: string }).zoom ?? "1");
    if (zoom && zoom !== 1) own *= zoom;
    const total = own * scaleOf(el.parentElement);
    scales.set(el, total);
    return total;
  };
  /** Text the learner cannot see: not rendered, hidden, or clipped to a point for assistive technology only. */
  const unseen = (el: Element): boolean => {
    if (el.getClientRects().length === 0) return true;
    if (!(el as HTMLElement).checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return true;
    for (let node: Element | null = el; node && node !== document.documentElement; node = node.parentElement) {
      const box = node.getBoundingClientRect();
      if (box.width > 1.5 || box.height > 1.5) continue;
      const style = getComputedStyle(node);
      // a box of a point hides what is in it only when it clips; `display: contents` has no box at all and hides nothing
      if (style.display !== "contents" && style.overflow !== "visible") return true;
    }
    return false;
  };
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "OPTION", "OPTGROUP", "TITLE"]);
  const ownText = (el: Element): string => Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean).join(" ");
  /** Every element that carries visible text of the app itself, with that text. */
  const textElements = (): Array<{ el: HTMLElement; text: string }> => {
    const found: Array<{ el: HTMLElement; text: string }> = [];
    for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
      if (SKIP.has(el.tagName) || el.closest(SOURCE)) continue;
      const text = el instanceof HTMLSelectElement ? (el.selectedOptions[0]?.textContent ?? "").trim() : el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? "" : ownText(el);
      if (!text || unseen(el)) continue;
      found.push({ el, text });
    }
    return found;
  };
  const where = (el: Element): string => {
    const marked = el.closest("[data-testid]");
    const role = el.closest("[role]");
    return `${el.tagName.toLowerCase()}${marked ? ` in ${marked.getAttribute("data-testid")}` : ""}${role ? ` (${role.getAttribute("role")})` : ""}`;
  };
  const rendered = (el: Element): number => Math.round(parseFloat(getComputedStyle(el).fontSize) * scaleOf(el) * 10) / 10;

  const census = (): Census => {
    const sizes: Record<string, number> = {};
    const small: string[] = [];
    let chars = 0;
    for (const { el, text } of textElements()) {
      const size = rendered(el);
      sizes[size] = (sizes[size] ?? 0) + text.length;
      chars += text.length;
      if (size < 14 && small.length < 40) small.push(`${size}px "${text.slice(0, 40)}" ${where(el)}`);
    }
    const below = Object.entries(sizes).filter(([size]) => Number(size) < 14).reduce((sum, [, count]) => sum + count, 0);
    return { sizes, chars, smallest: Math.min(...Object.keys(sizes).map(Number)), below14: chars ? below / chars : 0, small };
  };

  const reading = (selectors: string[]): ReadingSample[] => selectors.map((selector) => {
    const seen = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((el) => !unseen(el) && ((el as HTMLTextAreaElement).placeholder || (el.textContent ?? "").trim()));
    const sizes = seen.map(rendered);
    const heights = seen.map((el) => {
      const style = getComputedStyle(el);
      return parseFloat(style.lineHeight) / parseFloat(style.fontSize); // "normal" gives NaN, which fails the check
    });
    return { selector, count: seen.length, minSize: Math.min(...sizes), maxSize: Math.max(...sizes), minLineHeight: Math.min(...heights), text: (seen[0]?.textContent ?? "").trim().slice(0, 50) };
  });

  /** Rendered lines of text, block by block: the characters the browser put on each line box. */
  const lines = (root: string): { blocks: number; lines: number; longest: number; long: LongLine[] } => {
    const base = document.querySelector(root) ?? document.body;
    const perBlock = new Map<Element, Array<{ y: number; n: number; text: string }>>();
    const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      const value = node.textContent ?? "";
      if (!parent || !value.trim() || SKIP.has(parent.tagName) || parent.closest(SOURCE) || unseen(parent)) continue;
      let block: Element = parent;
      while (block !== base && block.parentElement && getComputedStyle(block).display.startsWith("inline")) block = block.parentElement;
      const rows = perBlock.get(block) ?? [];
      perBlock.set(block, rows);
      for (let i = 0; i < value.length; i += 1) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const box = range.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue; // collapsed white space
        const y = (box.top + box.bottom) / 2;
        const row = rows.find((entry) => Math.abs(entry.y - y) < 8);
        if (row) {
          row.n += 1;
          row.text += value[i];
        } else rows.push({ y, n: 1, text: value[i] ?? "" });
      }
    }
    const long: LongLine[] = [];
    let count = 0;
    let longest = 0;
    for (const [block, rows] of perBlock) {
      for (const row of rows) {
        const n = row.text.trim().length;
        count += 1;
        longest = Math.max(longest, n);
        if (n > 80) long.push({ chars: n, text: row.text.trim().slice(0, 90), where: where(block) });
      }
    }
    return { blocks: perBlock.size, lines: count, longest, long };
  };

  /** Text against what is behind it, as rendered (WCAG 2 contrast). Disabled controls are exempt, as in WCAG. */
  const contrast = (): { sampled: number; misses: ContrastMiss[] } => {
    const misses: ContrastMiss[] = [];
    let sampled = 0;
    for (const { el, text } of textElements()) {
      if (el.closest(':disabled, [aria-disabled="true"], [inert]')) continue;
      const style = getComputedStyle(el);
      let opacity = 1;
      for (let node: Element | null = el; node; node = node.parentElement) opacity *= parseFloat(getComputedStyle(node).opacity) || 1;
      const ground = background(el);
      const ink = rgba(style.color);
      const seen = over([ink[0], ink[1], ink[2], ink[3] * opacity], ground);
      const size = rendered(el);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      const needed = large ? 3 : 4.5;
      const value = ratio(seen, ground);
      sampled += 1;
      if (value < needed - 0.005) misses.push({ text: text.slice(0, 40), ratio: Math.round(value * 100) / 100, needed, size, color: style.color, on: ground.map((v) => Math.round(v * 100) / 100).join(","), where: where(el) });
    }
    return { sampled, misses };
  };

  const ringed = (style: CSSStyleDeclaration): boolean => {
    const sides = ["Top", "Right", "Bottom", "Left"] as const;
    const bordered = sides.every((side) => parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== "none"
      && rgba(style.getPropertyValue(`border-${side.toLowerCase()}-color`))[3] > 0.02);
    // a ring drawn with a shadow: no blur, a spread of at least 1 px (inset or not)
    const shadowRing = /(?:^|,)\s*(?:rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-f]+|[a-z]+)?\s*0px 0px 0px [1-9]/i.test(style.boxShadow);
    return bordered || shadowRing;
  };

  /** Pill-styled elements: fully rounded ends, a fill or an outline, words inside. */
  const pills = (): PillFound[] => {
    const found: PillFound[] = [];
    for (const { el, text } of textElements()) {
      let node: HTMLElement | null = el;
      // the fill may sit on the element or on the nearest wrapper of the same words
      for (let depth = 0; node && depth < 2; depth += 1, node = node.parentElement) {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const radius = style.borderTopLeftRadius;
        const round = radius.endsWith("%") ? parseFloat(radius) >= 50 : parseFloat(radius) >= box.height / 2 - 0.5;
        const drawn = rgba(style.backgroundColor)[3] > 0.02 || ringed(style);
        if (!round || !drawn || box.height < 12 || box.height > 48 || box.width < box.height + 6) continue;
        if ((node.textContent ?? "").trim().length > 60) continue; // a rounded region, not a pill
        const interactive = !!node.closest('button, a[href], input, select, summary, [role="button"], [role="link"], [role="tab"], [role="radio"], [role="checkbox"], [role="switch"], [role="option"], [role="menuitem"], [role="menuitemradio"], [role="slider"]');
        found.push({ text: (node.textContent ?? text).trim().slice(0, 50), where: where(node), interactive, radius, box: `${Math.round(box.width)}x${Math.round(box.height)}` });
        break;
      }
    }
    return found;
  };

  /** How many bordered containers stand around reading content, at most. */
  const nesting = (selectors: string[]): Nesting => {
    let deepest = 0;
    let at = "";
    const containers = new Set<Element>();
    for (const el of document.querySelectorAll<HTMLElement>(selectors.join(","))) {
      if (unseen(el) || el.closest(SOURCE) || !(el.textContent ?? "").trim()) continue;
      let depth = 0;
      const path: string[] = [];
      for (let node: Element | null = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
        if (!ringed(getComputedStyle(node))) continue;
        depth += 1;
        containers.add(node);
        path.push(where(node));
      }
      if (depth > deepest) {
        deepest = depth;
        at = `"${(el.textContent ?? "").trim().slice(0, 40)}" ${where(el)} inside ${path.join(" < ")}`;
      }
    }
    return { deepest, where: at, containers: containers.size };
  };

  /**
   * What a control looks like in its present state: everything drawn (`all`) and everything drawn that is not a colour
   * (`shape`), over the control and what is inside it (a row marks its state on its title, its glyph or its picture as
   * often as on itself). Not a colour: weight, underline, an outline, border and ring widths, a drawn pseudo-element and
   * its size, which glyph is drawn, whether a part is drawn at all.
   */
  const signature = (root: Element): { all: string; shape: string } => {
    const noColour = (value: string) => value.replace(/(rgba?|color|oklch|oklab|hsla?)\([^)]*\)/g, "").replace(/#[0-9a-f]{3,8}\b/gi, "").replace(/\s+/g, " ").trim();
    const read = (el: Element, pseudo: string | null): { colour: string; shape: string } => {
      const style = getComputedStyle(el, pseudo);
      if (pseudo && (style.content === "none" || style.content === "normal")) return { colour: "", shape: "" };
      const colour = [style.color, style.backgroundColor, style.outlineColor, style.borderTopColor, style.borderBottomColor, style.borderLeftColor, style.boxShadow, style.textDecorationColor, style.fill, style.stroke, style.opacity].join("|");
      const drawn = style.display === "none" || style.visibility !== "visible" || parseFloat(style.opacity) === 0 ? "not drawn" : "drawn";
      const shape = [style.fontWeight, style.textDecorationLine, style.outlineStyle === "none" ? "0" : style.outlineWidth, style.outlineStyle, style.outlineOffset, style.borderTopWidth, style.borderBottomWidth, style.borderLeftWidth,
        noColour(style.boxShadow), pseudo ? `${style.content}/${style.height}/${style.width}` : "", style.transform, drawn].join("|");
      return { colour, shape: `${pseudo ?? el.tagName.toLowerCase()}:${shape}` };
    };
    const colours: string[] = [];
    const shapes: string[] = [];
    for (const el of [root, ...Array.from(root.querySelectorAll("*")).slice(0, 120)]) {
      if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue; // a glyph is read as a whole, below
      for (const pseudo of el instanceof HTMLElement ? [null, "::before", "::after"] : [null]) {
        const part = read(el, pseudo);
        if (!part.shape) continue;
        colours.push(part.colour);
        shapes.push(part.shape);
      }
      if (el.tagName.toLowerCase() === "svg") shapes.push(`glyph:${Array.from(el.querySelectorAll("*")).map((node) => `${node.tagName}${node.getAttribute("d") ?? node.getAttribute("points") ?? ""}`).join(",")}`);
    }
    return { all: `${colours.join(" || ")} ## ${shapes.join(" || ")}`, shape: shapes.join(" || ") };
  };

  (window as unknown as { __r2: R2Api }).__r2 = { census, reading, lines, contrast, pills, nesting, signature, background, rgba, ratio, over };
}

/** Install the measuring functions for every document this page loads from now on. Call it before the first navigation. */
export async function installMeasures(page: Page): Promise<void> {
  await page.addInitScript(installInPage);
}

const api = (): R2Api => (window as unknown as { __r2: R2Api }).__r2;

export const textCensus = (page: Page): Promise<Census> => page.evaluate(() => (window as unknown as { __r2: R2Api }).__r2.census());
export const readingText = (page: Page, selectors: string[]): Promise<ReadingSample[]> => page.evaluate((list) => (window as unknown as { __r2: R2Api }).__r2.reading(list), selectors);
export const renderedLines = (page: Page, root = "body") => page.evaluate((selector) => (window as unknown as { __r2: R2Api }).__r2.lines(selector), root);
export const textContrast = (page: Page) => page.evaluate(() => (window as unknown as { __r2: R2Api }).__r2.contrast());
export const pillCensus = (page: Page): Promise<PillFound[]> => page.evaluate(() => (window as unknown as { __r2: R2Api }).__r2.pills());
export const borderNesting = (page: Page, selectors: string[]): Promise<Nesting> => page.evaluate((list) => (window as unknown as { __r2: R2Api }).__r2.nesting(list), selectors);
export const styleSignature = (locator: Locator): Promise<{ all: string; shape: string }> => locator.evaluate((el) => (window as unknown as { __r2: R2Api }).__r2.signature(el));
/** Contrast of one drawn colour of an element (a CSS property of it or of a pseudo-element) against the ground it sits on. */
export const indicatorContrast = (locator: Locator, property: string, pseudo: string | null = null, against: "own" | "parent" = "parent"): Promise<{ ratio: number; colour: string; ground: string }> =>
  locator.evaluate((el, [prop, pseudoElement, ground]) => {
    const r2 = (window as unknown as { __r2: R2Api }).__r2;
    const behind = r2.background(ground === "own" ? el : el.parentElement ?? el);
    const raw = getComputedStyle(el, pseudoElement).getPropertyValue(prop as string);
    // a ring drawn with a shadow: "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(…) 0px 0px 0px 2px" - the first colour that is drawn
    const colours = raw.match(/(?:rgba?|color|oklch|oklab|hsla?)\([^)]*\)|#[0-9a-f]{3,8}\b/gi) ?? [raw];
    const value = colours.find((colour) => r2.rgba(colour)[3] > 0.02) ?? colours[0] ?? raw;
    const drawn = r2.over(r2.rgba(value), behind);
    return { ratio: Math.round(r2.ratio(drawn, behind) * 100) / 100, colour: value, ground: behind.map((v) => Math.round(v)).join(",") };
  }, [property, pseudo, against] as const);

void api;
