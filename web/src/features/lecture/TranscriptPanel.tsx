// Transcript panel (UI08): read, search, follow and quote. Highlight and auto-follow exist only where
// timing is supported by a link; an untimed transcript still gives exact line references but no moving
// highlight. Scrolling away suspends following until the learner chooses "Follow playback".
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Callout, cn, formatMs, StatusChip } from "@/components/ui";
import type { SourceRef } from "@/lib/db";
import type { GeneratedText, TranscriptRange, TranscriptView } from "@/lib/types";

interface TranscriptPanelProps {
  transcripts: TranscriptView[];
  slideRanges: TranscriptRange[];
  positionMs: number;
  playing: boolean;
  focusLine?: number | null;
  onSeek: (ms: number) => void;
  onQuote: (source: SourceRef, text: string) => void;
  onReportError: (source: SourceRef, text: string) => void;
}

export function TranscriptPanel({ transcripts, slideRanges, positionMs, playing, focusLine, onSeek, onQuote, onReportError }: TranscriptPanelProps) {
  const [index, setIndex] = useState(0);
  const [follow, setFollow] = useState(true);
  const [filter, setFilter] = useState("");
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const programmatic = useRef(0);
  const transcript = transcripts[index];

  const activeSpan = useMemo(() => {
    if (!transcript || !playing) return null;
    return transcript.line_times.find((t) => positionMs >= t.start_ms && positionMs < t.end_ms) ?? null;
  }, [transcript, positionMs, playing]);
  const slideLines = useMemo(() => {
    const set = new Set<number>();
    for (const range of slideRanges) if (range.source.source_id === transcript?.source_id) for (let n = range.start; n <= range.end; n++) set.add(n);
    return set;
  }, [slideRanges, transcript]);

  useEffect(() => {
    if (!follow || !activeSpan) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-line="${activeSpan.start}"]`);
    if (node) {
      programmatic.current = Date.now();
      node.scrollIntoView({ block: "nearest" });
    }
  }, [activeSpan, follow]);

  useEffect(() => {
    if (!focusLine) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-line="${focusLine}"]`);
    if (node) {
      programmatic.current = Date.now();
      node.scrollIntoView({ block: "center" });
      setSelection({ start: focusLine, end: focusLine });
    }
  }, [focusLine, transcript]);

  if (!transcript) {
    return <Callout tone="unassessed" title="No transcript is linked to this lecture">There is no transcript file in a session linked to these slides. Nothing is generated in its place.</Callout>;
  }

  const timeFor = (line: number) => transcript.line_times.find((t) => line >= t.start && line <= t.end) ?? null;
  const matches = filter.trim() ? transcript.lines.map((text, i) => ({ text, n: i + 1 })).filter((l) => l.text.toLowerCase().includes(filter.toLowerCase())) : null;
  const selectedText = selection ? transcript.lines.slice(selection.start - 1, selection.end).join("\n") : "";
  const selectionRef: SourceRef | null = selection && transcript.sha256 && transcript.version_id
    ? { source_id: transcript.source_id, version_id: transcript.version_id, sha256: transcript.sha256, locator: { kind: "lines", start: selection.start, end: selection.end } } : null;

  const pick = (line: number, extend: boolean) => {
    setSelection((current) => (extend && current ? { start: Math.min(current.start, line), end: Math.max(current.end, line) } : { start: line, end: line }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {transcripts.length > 1 && (
          <select className="ll-input w-full min-w-0" value={index} onChange={(e) => setIndex(Number(e.target.value))} aria-label="Transcript">
            {transcripts.map((t, i) => <option key={t.source_id} value={i}>{t.filename} (session {t.session_id})</option>)}
          </select>
        )}
        <StatusChip tone={transcript.timing === "annotated" ? "success" : "unassessed"}>{transcript.timing === "annotated" ? "Timed where linked" : "Untimed: line references only"}</StatusChip>
        <input type="search" className="ll-input min-w-[9rem] flex-1" placeholder="Search this transcript…" aria-label="Search this transcript" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <p className="text-sm text-muted">{transcript.filename} · {transcript.lines.length} lines · version {transcript.version_id ?? "not yet identified (file not hashed)"}{transcript.timing_note ? ` · ${transcript.timing_note}` : ""}</p>
      {/* What the marked lines mean for the slide on screen: reviewed, or only a text match awaiting review. Never a time. */}
      <p className="text-sm" data-testid="slide-lines-note" role="note">
        {(() => {
          const mine = slideRanges.filter((r) => r.source.source_id === transcript.source_id).sort((a, b) => a.start - b.start);
          if (!mine.length) return <span className="text-muted">No transcript lines are linked to this slide. Nothing is inferred for it.</span>;
          const span = (r: TranscriptRange) => (r.start === r.end ? `${r.start}` : `${r.start}–${r.end}`);
          const reviewed = mine.filter((r) => r.review_state === "confirmed");
          const suggested = mine.filter((r) => r.review_state !== "confirmed");
          return (
            <>
              {reviewed.length > 0 && <span>Lines {reviewed.map(span).join(", ")} are linked to this slide (reviewed). </span>}
              {suggested.length > 0 && (
                <span>Lines {suggested.map(span).join(", ")} are a suggested match for this slide: found by comparing words, not reviewed, and not a time in the recording.</span>
              )}
            </>
          );
        })()}
      </p>
      {!follow && transcript.timing === "annotated" && (
        <div><Button size="sm" onClick={() => setFollow(true)}>Follow playback</Button> <span className="text-sm text-muted">Following paused because you scrolled.</span></div>
      )}
      {matches && <p className="text-sm text-muted" role="status">{matches.length} matching line{matches.length === 1 ? "" : "s"}</p>}
      <ol ref={listRef} className="min-h-0 flex-1 overflow-y-auto rounded-[var(--ll-radius)] border border-line/40 p-1" aria-label="Transcript lines" data-testid="transcript-lines"
        onScroll={() => {
          if (Date.now() - programmatic.current > 400 && follow && playing) setFollow(false);
        }}>
        {(matches ?? transcript.lines.map((text, i) => ({ text, n: i + 1 }))).map(({ text, n }) => {
          const timing = timeFor(n);
          const active = !!activeSpan && n >= activeSpan.start && n <= activeSpan.end;
          const selected = !!selection && n >= selection.start && n <= selection.end;
          return (
            <li key={n} data-line={n} aria-current={active ? "true" : undefined}
              className={cn("flex gap-2 rounded px-1.5 py-1", slideLines.has(n) && "border-l-2 border-accent", active && "bg-raised font-medium", selected && "outline outline-2 outline-focus")}>
              <button type="button" className="w-9 shrink-0 text-right text-xs tabular-nums text-muted hover:underline" onClick={(e) => pick(n, e.shiftKey)} aria-label={`Select line ${n}${selected ? " (selected)" : ""}`}>{n}</button>
              <span className="min-w-0 flex-1">{text || <span className="text-muted">(blank line)</span>}</span>
              {timing && (
                <button type="button" className="shrink-0 text-sm tabular-nums text-accent underline" onClick={() => onSeek(timing.start_ms)}
                  aria-label={`Go to ${formatMs(timing.start_ms)} in the recording (${timing.review_state === "confirmed" ? "reviewed" : "suggested"} timing)`}>
                  {formatMs(timing.start_ms)}{timing.review_state !== "confirmed" ? " ?" : ""}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {selection && (
        <div className="ll-card flex flex-wrap items-center gap-2 p-2 text-sm" role="group" aria-label="Selected transcript lines">
          <span>Lines {selection.start}{selection.end !== selection.start ? `–${selection.end}` : ""} selected</span>
          <Button size="sm" disabled={!selectionRef} onClick={() => selectionRef && onQuote(selectionRef, selectedText)} title={selectionRef ? undefined : "This file has not been identified by bytes yet, so an exact quote cannot be attached"}>Ask about this</Button>
          <Button size="sm" variant="quiet" disabled={!selectionRef} onClick={() => selectionRef && onReportError(selectionRef, selectedText)}>Report a transcript error</Button>
          <Button size="sm" variant="quiet" onClick={() => setSelection(null)}>Clear</Button>
          <span className="text-sm text-muted">Shift-click a line number to extend the selection.</span>
        </div>
      )}
    </div>
  );
}

/** Speech text generated outside the app (imported from a verified manifest). Shown apart from the course transcript:
 *  it is new text with its own times, it is not reviewed, and it says nothing about which slide was on screen. */
export function GeneratedTextPanel({ recordings, onSeek }: { recordings: Array<{ filename: string; generated_text?: GeneratedText | null }>; onSeek: (ms: number) => void }) {
  const [open, setOpen] = useState(false);
  const withText = recordings.filter((r) => r.generated_text);
  if (withText.length === 0) return null;
  return (
    <section aria-label="Generated speech text" className="ll-card flex flex-col gap-1 p-2" data-testid="generated-text">
      {withText.map((r) => {
        const g = r.generated_text!;
        return (
          <div key={g.generation} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip tone="unassessed">Generated speech text · not reviewed</StatusChip>
              <span className="text-sm text-muted" data-testid="generated-window">covers {formatMs(g.window.start_ms)}–{formatMs(g.window.end_ms)}{g.duration_ms ? ` of ${formatMs(g.duration_ms)}` : ""}{g.covers_whole_recording ? "" : " (part of the recording)"}</span>
              <Button size="sm" variant="quiet" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Show"} {g.segments_total} segments</Button>
            </div>
            {open && (
              <>
                <p className="text-sm text-muted">{g.note}</p>
                <ol className="max-h-[14rem] overflow-y-auto">
                  {g.segments.map((s) => (
                    <li key={s.start_ms} className="flex gap-2 px-1 py-0.5">
                      <button type="button" className="shrink-0 text-sm tabular-nums text-accent underline" onClick={() => onSeek(s.start_ms)} aria-label={`Go to ${formatMs(s.start_ms)} in the recording (generated timing, not reviewed)`}>{formatMs(s.start_ms)}</button>
                      <span className="min-w-0 flex-1">{s.text}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
