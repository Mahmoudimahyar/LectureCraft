// Slide canvas (LL011; design specification 5.4): the original PDF page rendered with PDF.js as the one bright card of
// the stage, with a selectable text layer. The page is the card: white, a hairline ring and the source shadow; no frame,
// no mat, no caption, no zoom row. The app theme never recolours, inverts or dims the source.
//
// Sizing. In the lecture workspace the stage gives the page its width (`pageWidth`, by the stage rule: slide and bar are
// one block) and the page's own shape gives the height. In every other fit ("Fit width", 100 %, 150 %, 200 %) the page
// is sized here and scrolls inside its own place; the app around it never scrolls sideways. Used alone (the Library's
// file viewer) the canvas keeps its own fit and offers the one size menu itself.
//
// Before a page has been drawn its place is a flat block of the page's shape (4:3 until pdf.js has reported it) that
// says which page is being opened. A page is drawn off screen and put on the canvas in one step, so paging goes from one
// page to the next without a blank or half-drawn canvas; a new width of the same page is redrawn once the width settles.
import { useEffect, useRef, useState, type ReactNode } from "react";
import * as pdfjs from "pdfjs-dist";
import { DropdownMenu } from "radix-ui";
import { Check } from "lucide-react";
import { ErrorGlyph } from "@/components/glyphs";
import { Button, cn, ToolbarButton } from "@/components/ui";
import { NBSP } from "@/lib/labels";
import { loadPdf, notePageBox, usePageBox, type PdfDocument } from "@/lib/thumbs";
import type { SlideFit } from "./contracts";

export { loadPdf } from "@/lib/thumbs";

// ---- sizes (pure; web/tests/lib/lecture-source.test.ts) ------------------------------------------------------------------
/** CSS pixels per PDF point at 100 %: a point is 1/72 in, a CSS pixel 1/96 in. */
export const PDF_CSS_UNITS = 96 / 72;
/** The entries of the size menu, in order. The two magnifications follow a separator. */
export const SLIDE_FITS: readonly SlideFit[] = ["page", "width", "100", "150", "200"];
export const FIT_LABEL: Record<SlideFit, string> = { page: "Fit page", width: "Fit width", "100": `100${NBSP}%`, "150": `150${NBSP}%`, "200": `200${NBSP}%` };
/** `data-fit` of the slide's place, for measurements: the whole page is `contain`. */
export const FIT_DATA: Record<SlideFit, string> = { page: "contain", width: "width", "100": "100", "150": "150", "200": "200" };
/** A page shape nobody has reported yet counts as 4:3. */
export const DEFAULT_PAGE_SHAPE = 4 / 3;
/** The most pixels one canvas is asked to hold (a 200 % page on a dense screen is drawn a little softer instead). */
const MAX_CANVAS_PIXELS = 16_000_000;

/**
 * CSS width of the page for a fit. `pageFitWidth` is the width at which the whole page fits its place, `boxWidth` the
 * width of the place it scrolls in, `naturalWidth` the page's own width in points (null until the file has been read:
 * a percentage of an unknown size is 0, and nothing is drawn until it is known).
 */
export function slideWidth(fit: SlideFit, sizes: { pageFitWidth: number; boxWidth: number; naturalWidth: number | null }): number {
  const whole = (value: number): number => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
  if (fit === "page") return whole(sizes.pageFitWidth);
  if (fit === "width") return whole(sizes.boxWidth);
  return sizes.naturalWidth ? whole(Math.round(sizes.naturalWidth * PDF_CSS_UNITS * (Number(fit) / 100))) : 0;
}

/** Device pixels per CSS pixel a page of this CSS size is drawn at: the screen's own, at most 2, less when the canvas would pass its pixel budget. */
export function canvasDensity(cssWidth: number, cssHeight: number, devicePixelRatio: number): number {
  const wanted = Math.min(Math.max(devicePixelRatio || 1, 1), 2);
  const area = Math.max(1, cssWidth * cssHeight);
  return Math.max(0.5, Math.min(wanted, Math.sqrt(MAX_CANVAS_PIXELS / area)));
}

// ---- drawing ---------------------------------------------------------------------------------------------------------------
async function drawPage(doc: PdfDocument, url: string, pageNumber: number, cssWidth: number, target: HTMLCanvasElement, textLayer: HTMLDivElement | null, alive: () => boolean,
  onTask: (task: { cancel: () => void }) => void): Promise<void> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  notePageBox(url, pageNumber, base);
  const scale = cssWidth / base.width;
  const density = canvasDensity(cssWidth, base.height * scale, window.devicePixelRatio);
  const viewport = page.getViewport({ scale: scale * density });
  // Drawn off screen, then put on the page in one step.
  const buffer = document.createElement("canvas");
  buffer.width = Math.max(1, Math.floor(viewport.width));
  buffer.height = Math.max(1, Math.floor(viewport.height));
  const task = page.render({ canvas: buffer, viewport, background: "#ffffff" });
  onTask(task);
  await task.promise;
  if (!alive()) return;
  target.width = buffer.width;
  target.height = buffer.height;
  target.getContext("2d")?.drawImage(buffer, 0, 0);
  buffer.width = 0; // give the bitmap back at once
  buffer.height = 0;
  if (textLayer) {
    textLayer.replaceChildren();
    const cssViewport = page.getViewport({ scale });
    textLayer.style.width = `${Math.floor(cssViewport.width)}px`;
    textLayer.style.height = `${Math.floor(cssViewport.height)}px`;
    textLayer.style.setProperty("--scale-factor", String(scale));
    textLayer.style.setProperty("--total-scale-factor", String(scale));
    try {
      await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textLayer, viewport: cssViewport }).render();
    } catch {
      /* a missing text layer is reported by the "readable text" view; the image stays usable */
    }
  }
}

// ---- the one size menu -----------------------------------------------------------------------------------------------------
const MENU = "ll-pop z-50 min-w-[11rem] p-1";

/** The items of the size menu, for a menu that holds other things too (the pager's More). */
export function FitMenuItems({ fit, onFit }: { fit: SlideFit; onFit: (fit: SlideFit) => void }) {
  return (
    <DropdownMenu.RadioGroup value={fit} onValueChange={(value) => onFit(value as SlideFit)} aria-label="Page size">
      {SLIDE_FITS.map((value) => (
        <div key={value} className={cn(value === "100" && "mt-1 border-t border-hairline pt-1")}>
          <DropdownMenu.RadioItem value={value} className="ll-menu-item ll-num justify-between">
            {FIT_LABEL[value]}
            <DropdownMenu.ItemIndicator><Check aria-hidden className="size-4" /></DropdownMenu.ItemIndicator>
          </DropdownMenu.RadioItem>
        </div>
      ))}
    </DropdownMenu.RadioGroup>
  );
}

/** "Fit page" with its menu: Fit page, Fit width, 100 %, and the two magnifications. One control, never a row of zoom buttons. */
export function FitMenu({ fit, onFit, className }: { fit: SlideFit; onFit: (fit: SlideFit) => void; className?: string }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <ToolbarButton chevron className={cn("ll-num flex-none", className)} aria-label={`Page size: ${FIT_LABEL[fit]}`} data-testid="fit-menu">{FIT_LABEL[fit]}</ToolbarButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className={MENU}><FitMenuItems fit={fit} onFit={onFit} /></DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// ---- the canvas ------------------------------------------------------------------------------------------------------------
interface SlideCanvasProps {
  url: string;
  page: number;
  /** Accessible name of the picture: which page of what, and that it is the original. */
  label: string;
  onPageCount?: (count: number) => void;
  /** The learner answers without the slide: nothing of the page is drawn. */
  hidden?: boolean;
  /** How the page is sized. Leave it out and the canvas keeps its own (starting at Fit width) and offers the size menu itself. */
  fit?: SlideFit;
  /** For Fit page under a parent that sizes the block (the stage rule of 5.4): the page's CSS width. The height follows from the page's own shape. */
  pageWidth?: number | null;
  className?: string;
}

/** A flat block in the page's place: before the page is drawn, when it cannot be drawn, when it is hidden on purpose. */
function PlaceBlock({ children, role, strong = false }: { children: ReactNode; role?: "status" | "alert"; strong?: boolean }) {
  return (
    <div role={role} className={cn("absolute inset-0 grid place-items-center overflow-auto rounded-row p-4 text-center text-ui text-muted", strong ? "bg-pad-strong" : "bg-pad")}>
      <div className="flex max-w-[34rem] flex-col items-center gap-2">{children}</div>
    </div>
  );
}

export function SlideCanvas({ url, page, label, onPageCount, hidden = false, fit: givenFit, pageWidth, className }: SlideCanvasProps) {
  const alone = givenFit === undefined;
  const [ownFit, setOwnFit] = useState<SlideFit>("width");
  const fit = givenFit ?? ownFit;
  /** The parent placed the page: its place is exactly the page, nothing scrolls. */
  const placed = !alone && fit === "page" && pageWidth != null;

  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ width: 0, room: 0 });
  const { box, shape } = usePageBox(url, page);
  const aspect = shape ?? DEFAULT_PAGE_SHAPE;

  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [late, setLate] = useState(false);
  const [drawn, setDrawn] = useState<{ url: string; page: number } | null>(null);
  const [renderWidth, setRenderWidth] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const onCount = useRef(onPageCount);
  onCount.current = onPageCount;

  // The place the page scrolls in. A hidden pane measures 0: the last real size is kept, so a pane change never redraws the slide.
  useEffect(() => {
    const node = frameRef.current;
    if (!node || placed || typeof ResizeObserver === "undefined") return;
    const update = () => {
      if (node.clientWidth <= 0) return;
      // Alone, the place grows with the page up to 72 % of the window's height; in a stage it has the height it is given.
      const next = { width: node.clientWidth, room: alone ? Math.round(window.innerHeight * 0.72) : node.clientHeight };
      setFrame((current) => (current.width === next.width && current.room === next.room ? current : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [placed, alone]);

  const target = placed ? Math.max(0, Math.floor(pageWidth ?? 0))
    : slideWidth(fit, { pageFitWidth: Math.min(frame.width, frame.room * aspect), boxWidth: frame.width, naturalWidth: box?.width ?? null });
  const height = Math.round(target / aspect);
  const samePage = drawn?.url === url && drawn.page === page;

  // The first picture of a page is made at once; a new width of the page on screen waits until the width has settled
  // (a panel being dragged), while the picture already there is stretched to the new size.
  useEffect(() => {
    if (target <= 0 || hidden) return;
    if (!samePage || renderWidth === 0) {
      setRenderWidth(target);
      return;
    }
    if (target === renderWidth) return;
    const id = window.setTimeout(() => setRenderWidth(target), 140);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, samePage, hidden]);

  useEffect(() => {
    if (hidden) {
      setDrawn(null); // the canvas leaves the page with the slide
      return;
    }
    if (renderWidth <= 0) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    setState("loading");
    setLate(false);
    const lateTimer = window.setTimeout(() => !cancelled && setLate(true), 180);
    loadPdf(url)
      .then(async (doc) => {
        if (cancelled) return;
        onCount.current?.(doc.numPages);
        if (page < 1 || page > doc.numPages) throw new Error(`This file has ${doc.numPages} page(s); page ${page} does not exist.`);
        const canvas = canvasRef.current;
        if (!canvas) return;
        await drawPage(doc, url, page, renderWidth, canvas, textRef.current, () => !cancelled, (t) => { task = t; });
        if (cancelled) return;
        setDrawn({ url, page });
        setState("ready");
      })
      .catch((e: Error) => {
        if (!cancelled && e?.name !== "RenderingCancelledException") {
          setError(e?.message || "The PDF could not be rendered.");
          setState("error");
        }
      })
      .finally(() => window.clearTimeout(lateTimer));
    return () => {
      cancelled = true;
      window.clearTimeout(lateTimer);
      task?.cancel(); // a quick page change never draws a stale page
    };
  }, [url, page, renderWidth, hidden, attempt]);

  // The page being opened is announced by a flat block: at once when nothing is drawn, after a moment when the page
  // before it is still on the canvas (most pages are drawn before that moment has passed).
  const opening = !hidden && state === "loading" && (!drawn || (!samePage && late));
  const failed = !hidden && state === "error";
  const covered = hidden || opening || failed;
  const surfaceStyle = target > 0 ? { width: target, height } : placed ? { width: 0, height: 0 } : { width: "100%", aspectRatio: String(aspect) };

  const surface = (
    <div className={cn("relative shrink-0", !placed && "m-auto", covered ? "rounded-row" : "ll-source-page shadow-[0_0_0_1px_var(--ll-hairline),var(--ll-shadow-source)]")}
      style={surfaceStyle} data-testid="slide-surface" data-render-state={hidden ? "hidden" : state}>
      {!hidden && (
        <>
          <canvas ref={canvasRef} role="img" aria-label={label} className={cn("block size-full rounded-row", covered && "invisible")} data-testid="slide-canvas" data-rendered={drawn && samePage ? drawn.page : ""} />
          <div ref={textRef} className={cn("ll-pdf-textlayer", (covered || renderWidth !== target) && "invisible")} />
        </>
      )}
      {hidden && (
        <PlaceBlock role="status">
          <p className="font-semibold text-ink">Slide hidden while you explain</p>
          <p>You chose to answer without the slide. This is self-reported; it does not prove no other help was used.</p>
        </PlaceBlock>
      )}
      {opening && <PlaceBlock role="status" strong><p className="ll-num">Opening page {page}</p></PlaceBlock>}
      {failed && (
        <PlaceBlock role="alert">
          <p className="ll-err"><ErrorGlyph /><span>This page could not be shown</span></p>
          <p>{error} The original file is unchanged; nothing was regenerated in its place.</p>
          <Button size="sm" onClick={() => setAttempt((count) => count + 1)}>Try again</Button>
        </PlaceBlock>
      )}
    </div>
  );

  if (placed) {
    return <div ref={frameRef} className={cn("flex-none", className)} style={{ width: target }} data-fit={FIT_DATA[fit]} data-testid="slide-frame">{surface}</div>;
  }
  const scroller = (
    <div ref={frameRef} tabIndex={0} role="group" aria-label={`${label}. Scroll to pan when the page is larger than its place.`} data-fit={FIT_DATA[fit]} data-testid="slide-frame"
      className={cn("flex min-w-0 rounded-row [scrollbar-width:thin]", fit === "width" ? "overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]" : "overflow-auto",
        alone ? "max-h-[72dvh]" : "min-h-0 flex-1", !alone && className)}>
      {surface}
    </div>
  );
  if (!alone) return scroller;
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      {!hidden && <div className="flex justify-end"><FitMenu fit={fit} onFit={setOwnFit} /></div>}
      {scroller}
    </div>
  );
}
