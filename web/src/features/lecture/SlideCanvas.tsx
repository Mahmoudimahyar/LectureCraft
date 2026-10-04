// Slide canvas (LL011): the original PDF page rendered with PDF.js on a white source surface, with a
// selectable text layer. The app theme never recolours or inverts the source. Zoom and pan stay inside
// the canvas; app controls reflow around it. A PDF rendition of an office deck is labelled as such.
import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Minus, Plus, Maximize2 } from "lucide-react";
import { Callout, IconButton, LoadingState } from "@/components/ui";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type PdfDocument = Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
const documents = new Map<string, Promise<PdfDocument>>();

/** One loaded document per URL for the lifetime of the page (theme/panel changes never reload it). */
export function loadPdf(url: string): Promise<PdfDocument> {
  let doc = documents.get(url);
  if (!doc) {
    // Scripts, external links and embedded actions in the source are not executed or followed.
    doc = pdfjs.getDocument({ url, enableXfa: false, disableAutoFetch: true, stopAtErrors: false }).promise;
    doc.catch(() => documents.delete(url));
    documents.set(url, doc);
  }
  return doc;
}

async function renderPage(doc: PdfDocument, pageNumber: number, canvas: HTMLCanvasElement, cssWidth: number, textLayer?: HTMLDivElement | null, onTask?: (task: { cancel: () => void }) => void): Promise<{ width: number; height: number }> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = cssWidth / base.width;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: scale * ratio });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(base.width * scale)}px`;
  canvas.style.height = `${Math.floor(base.height * scale)}px`;
  const task = page.render({ canvas, viewport, background: "#ffffff" });
  onTask?.(task);
  await task.promise;
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
  return { width: Math.floor(base.width * scale), height: Math.floor(base.height * scale) };
}

interface SlideCanvasProps {
  url: string;
  page: number;
  label: string;
  onPageCount?: (count: number) => void;
  hidden?: boolean;
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export function SlideCanvas({ url, page, label, onPageCount, hidden }: SlideCanvasProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState<number | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    // A hidden pane measures 0: keep the last real width so switching panes never re-renders the slide.
    const update = () => {
      if (frame.clientWidth > 0) setFitWidth(Math.max(240, frame.clientWidth - 2));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!fitWidth || hidden) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    setState("loading");
    setRendered(null);
    loadPdf(url)
      .then(async (doc) => {
        if (cancelled) return;
        onPageCount?.(doc.numPages);
        if (page < 1 || page > doc.numPages) throw new Error(`This deck has ${doc.numPages} page(s); page ${page} does not exist.`);
        await renderPage(doc, page, canvasRef.current!, fitWidth * zoom, textRef.current, (t) => { task = t; });
        if (!cancelled) {
          setState("ready");
          setRendered(page);
        }
      })
      .catch((e: Error) => {
        if (!cancelled && e?.name !== "RenderingCancelledException") {
          setError(e.message || "The PDF could not be rendered.");
          setState("error");
        }
      });
    return () => {
      cancelled = true;
      task?.cancel(); // one render per canvas at a time: a quick slide change never draws a stale page
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, page, fitWidth, zoom, hidden]);

  const step = (direction: 1 | -1) => setZoom((current) => ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, ZOOMS.indexOf(current) + direction))] ?? 1);

  if (hidden) {
    return <Callout tone="unassessed" title="Slide hidden while you explain">You chose to answer without the slide. This is self-reported; it does not prove no other help was used.</Callout>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end gap-1">
        <span className="mr-auto text-sm text-muted" aria-live="polite">{Math.round(zoom * 100)}% of fit width</span>
        <IconButton label="Zoom out" size="sm" onClick={() => step(-1)} disabled={zoom === ZOOMS[0]}><Minus aria-hidden className="size-4" /></IconButton>
        <IconButton label="Fit width" size="sm" onClick={() => setZoom(1)}><Maximize2 aria-hidden className="size-4" /></IconButton>
        <IconButton label="Zoom in" size="sm" onClick={() => step(1)} disabled={zoom === ZOOMS[ZOOMS.length - 1]}><Plus aria-hidden className="size-4" /></IconButton>
      </div>
      <div ref={frameRef} className="max-h-[72dvh] overflow-auto rounded-[var(--ll-radius)] border border-line/50 bg-raised" tabIndex={0} role="group" aria-label={`${label}. Scroll to pan when zoomed.`}>
        {state === "error" ? (
          <div className="p-4"><Callout tone="danger" role="alert" title="This slide could not be shown">{error} The original file is unchanged; nothing was regenerated in its place.</Callout></div>
        ) : (
          <div className="ll-source-surface relative mx-auto w-fit" data-testid="slide-surface" data-render-state={state}>
            <canvas ref={canvasRef} role="img" aria-label={label} className="block" data-testid="slide-canvas" data-rendered={rendered ?? ""} />
            <div ref={textRef} className="ll-pdf-textlayer" />
            {state === "loading" && <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-[#132238]"><LoadingState label="Rendering slide…" /></div>}
          </div>
        )}
      </div>
    </div>
  );
}

export function SlideThumb({ url, page, active, title, onSelect }: { url: string; page: number; active: boolean; title: string | null; onSelect: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = buttonRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "200px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    loadPdf(url).then((doc) => (!cancelled && canvasRef.current ? renderPage(doc, page, canvasRef.current, 132) : null)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [url, page, visible]);

  useEffect(() => {
    if (active) buttonRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <button ref={buttonRef} type="button" onClick={onSelect} aria-current={active ? "true" : undefined} aria-label={`Slide ${page}${title ? `: ${title}` : ""}`}
      className={`flex w-full items-start gap-2 rounded-[var(--ll-radius)] p-1.5 text-left ${active ? "bg-raised outline outline-2 outline-accent" : "hover:bg-raised"}`}>
      <span className={`w-5 shrink-0 pt-1 text-right text-xs ${active ? "font-bold text-accent" : "text-muted"}`}>{page}</span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="ll-source-surface block overflow-hidden rounded border border-line/50"><canvas ref={canvasRef} className="block" width={132} height={99} aria-hidden /></span>
        <span className={`truncate text-xs ${active ? "font-semibold text-accent" : "text-muted"}`}>{title ?? `Slide ${page}`}</span>
      </span>
    </button>
  );
}
