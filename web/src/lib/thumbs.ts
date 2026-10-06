// Page thumbnails for navigation (the lecture outline, the build strip, Study rows, the Resume picture): ONE pdf.js queue
// and one cache for the session (design specification 5.2, 6). One page is rendered at a time, the row asked for last
// first, so what is in view wins over what was scrolled past. A rendered page is kept as an image for the session; a
// request for the same page at the same or a smaller width is answered from memory. Nothing is drawn in place of a page
// that cannot be rendered: the caller keeps its neutral placeholder.
//
// The document itself comes from the slide canvas's loader, so a deck is opened once however many pictures are made.
import { useEffect, useRef, useState, type RefObject } from "react";
import { loadPdf } from "@/features/lecture/SlideCanvas";

export interface Thumb {
  /** An object URL of the rendered page (valid for the session). */
  src: string;
  /** Rendered size in device pixels. */
  width: number;
  height: number;
  /** Width over height of the page. */
  aspect: number;
}

interface Job {
  key: string;
  url: string;
  page: number;
  width: number;
  waiting: Array<{ resolve: (thumb: Thumb) => void; reject: (reason: unknown) => void; signal?: AbortSignal }>;
}

/** Rendered width in device pixels for a row of the given CSS width: twice the width, in steps of 80, never past 640. */
export function thumbRenderWidth(cssWidth: number): number {
  const wanted = Math.max(80, Math.ceil((Math.max(1, cssWidth) * 2) / 80) * 80);
  return Math.min(640, wanted);
}

const cache = new Map<string, Thumb>();
const shapes = new Map<string, number>();
const queue: Job[] = [];
let running = false;

const pageKey = (url: string, page: number): string => `${url}#${page}`;

/** A page already rendered at this width or wider, or null. */
export function cachedThumb(url: string, page: number, cssWidth: number): Thumb | null {
  const hit = cache.get(pageKey(url, page));
  return hit && hit.width >= thumbRenderWidth(cssWidth) ? hit : null;
}
/** The shape (width over height) of a page whose picture or size is already known, or null. */
export const knownPageShape = (url: string, page: number): number | null => shapes.get(pageKey(url, page)) ?? null;

async function render(job: Job): Promise<Thumb> {
  const doc = await loadPdf(job.url);
  if (job.page < 1 || job.page > doc.numPages) throw new Error(`This file has ${doc.numPages} page(s); page ${job.page} does not exist.`);
  const page = await doc.getPage(job.page);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: job.width / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  await page.render({ canvas, viewport, background: "#ffffff" }).promise;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The page picture could not be made.");
  const thumb: Thumb = { src: URL.createObjectURL(blob), width: canvas.width, height: canvas.height, aspect: base.width / base.height };
  canvas.width = 0; // give the bitmap back at once
  canvas.height = 0;
  return thumb;
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const job = queue.pop(); // the one asked for last
      if (!job) break;
      const wanted = job.waiting.filter((entry) => !entry.signal?.aborted);
      if (wanted.length === 0) continue; // every row that asked has left
      try {
        const previous = cache.get(job.key);
        const thumb = previous && previous.width >= job.width ? previous : await render(job);
        if (thumb !== previous) {
          if (previous) URL.revokeObjectURL(previous.src);
          cache.set(job.key, thumb);
          shapes.set(job.key, thumb.aspect);
        }
        for (const entry of job.waiting) entry.resolve(thumb);
      } catch (error) {
        for (const entry of job.waiting) entry.reject(error);
      }
    }
  } finally {
    running = false;
  }
}

/** The picture of one page at a row's CSS width. Answered from memory when it can be; otherwise queued, newest request first. */
export function requestThumb(url: string, page: number, cssWidth: number, signal?: AbortSignal): Promise<Thumb> {
  const hit = cachedThumb(url, page, cssWidth);
  if (hit) return Promise.resolve(hit);
  const key = pageKey(url, page);
  const width = thumbRenderWidth(cssWidth);
  return new Promise<Thumb>((resolve, reject) => {
    const at = queue.findIndex((job) => job.key === key);
    const job: Job = at >= 0 ? queue.splice(at, 1)[0]! : { key, url, page, width, waiting: [] };
    job.width = Math.max(job.width, width);
    job.waiting.push({ resolve, reject, signal });
    queue.push(job); // (back) to the head of the line
    void drain();
  });
}

/** Width over height of a page, read from the file without rendering it. Remembered for the session. */
export async function pageShape(url: string, page = 1): Promise<number> {
  const key = pageKey(url, page);
  const known = shapes.get(key);
  if (known) return known;
  const doc = await loadPdf(url);
  const base = (await doc.getPage(Math.min(Math.max(1, page), doc.numPages))).getViewport({ scale: 1 });
  const aspect = base.width / base.height;
  shapes.set(key, aspect);
  return aspect;
}

/** True once the element has come within `margin` of the viewport of its scroller (and stays true: a rendered page is kept). */
export function useNearViewport<T extends Element>(margin = "200px"): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setNear(true);
    }, { rootMargin: margin });
    observer.observe(node);
    return () => observer.disconnect();
  }, [near, margin]);
  return [ref, near];
}

/**
 * The picture of a page for a row `cssWidth` wide, once `wanted` (the row is near the viewport). `thumb` stays null until
 * it is ready and when it cannot be made; `shape` is the page's own shape as soon as anything is known about it.
 */
export function useThumb(url: string | null | undefined, page: number, cssWidth: number, wanted: boolean): { thumb: Thumb | null; shape: number | null } {
  const [thumb, setThumb] = useState<Thumb | null>(() => (url ? cachedThumb(url, page, cssWidth) : null));
  useEffect(() => {
    if (!url) {
      setThumb(null);
      return;
    }
    const hit = cachedThumb(url, page, cssWidth);
    setThumb(hit ?? cache.get(pageKey(url, page)) ?? null); // a smaller picture stands in while the wider one is made
    if (hit || !wanted) return;
    const abort = new AbortController();
    requestThumb(url, page, cssWidth, abort.signal).then((made) => {
      if (!abort.signal.aborted) setThumb(made);
    }).catch(() => undefined);
    return () => abort.abort();
  }, [url, page, cssWidth, wanted]);
  return { thumb, shape: thumb?.aspect ?? (url ? knownPageShape(url, page) : null) };
}

/** The shape of the deck's first page as soon as pdf.js reports it (placeholders are 4:3 until then, 5.2). */
export function useFirstPageShape(url: string | null | undefined): number | null {
  const [shape, setShape] = useState<number | null>(() => (url ? knownPageShape(url, 1) : null));
  useEffect(() => {
    let alive = true;
    setShape(url ? knownPageShape(url, 1) : null);
    if (url) pageShape(url, 1).then((aspect) => alive && setShape(aspect)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [url]);
  return shape;
}
