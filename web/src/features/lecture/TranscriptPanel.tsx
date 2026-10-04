// Transcript panel (UI08): read, search, follow and quote. Highlight and auto-follow exist only where
// timing is supported by a link; an untimed transcript still gives exact line references but no moving
// highlight. Scrolling away suspends following until the learner chooses "Follow playback".
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Callout, cn, formatMs, StatusChip } from "@/components/ui";
import type { SourceRef } from "@/lib/db";
import type { TranscriptRange, TranscriptView } from "@/lib/types";

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
      <p className="text-xs text-muted">{transcript.filename} · {transcript.lines.length} lines · version {transcript.version_id ?? "not yet identified (file not hashed)"}{transcript.timing_note ? ` · ${transcript.timing_note}` : ""}</p>
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
              className={cn("flex gap-2 rounded px-1.5 py-1 text-sm", slideLines.has(n) && "border-l-2 border-accent", active && "bg-raised font-medium", selected && "outline outline-2 outline-focus")}>
              <button type="button" className="w-9 shrink-0 text-right text-xs tabular-nums text-muted hover:underline" onClick={(e) => pick(n, e.shiftKey)} aria-label={`Select line ${n}${selected ? " (selected)" : ""}`}>{n}</button>
              <span className="min-w-0 flex-1">{text || <span className="text-muted">(blank line)</span>}</span>
              {timing && (
                <button type="button" className="shrink-0 text-xs tabular-nums text-accent underline" onClick={() => onSeek(timing.start_ms)}
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
          <span className="text-xs text-muted">Shift-click a line number to extend the selection.</span>
        </div>
      )}
    </div>
  );
}
