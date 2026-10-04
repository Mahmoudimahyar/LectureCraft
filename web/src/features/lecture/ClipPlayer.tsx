// Clip playback (LL012): one stable media element; a thin adapter enforces the selected interval.
// Starts paused. "Play segment" seeks to one bounded interval and stops at its end; Repeat is explicit;
// another occurrence or the whole recording is an explicit, labelled choice. Changing slide pauses.
// Nothing is played between disjoint ranges and no timestamp is invented when there is no timed match.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { MediaControlBar, MediaController, MediaMuteButton, MediaTimeDisplay, MediaVolumeRange } from "media-chrome/react";
import { Pause, Play, Repeat, RotateCcw, RotateCw } from "lucide-react";
import { Button, Callout, cn, formatMs, IconButton, StatusChip } from "@/components/ui";
import { contentUrl } from "@/lib/api";
import { REVIEW_STATE } from "@/lib/labels";
import type { Occurrence, RecordingView } from "@/lib/types";

export interface ClipPlayerHandle {
  pause(): void;
  seekTo(ms: number): void;
  currentMs(): number;
  isPlaying(): boolean;
}

interface ClipPlayerProps {
  recordings: RecordingView[];
  occurrences: Occurrence[];
  page: number;
  onTime?: (ms: number, playing: boolean) => void;
  onEditMatch?: (occurrence: Occurrence) => void;
  announce?: (message: string) => void;
}

const RATES = [0.75, 1, 1.25, 1.5, 2];
const MEDIA_ERRORS: Record<number, string> = { 1: "Playback was aborted.", 2: "A network problem interrupted loading the recording.", 3: "The recording could not be decoded by this browser.", 4: "This browser cannot play this recording's format." };

export const ClipPlayer = forwardRef<ClipPlayerHandle, ClipPlayerProps>(function ClipPlayer({ recordings, occurrences, page, onTime, onEditMatch, announce }, ref) {
  const mediaRef = useRef<HTMLAudioElement & HTMLVideoElement>(null);
  const [choice, setChoice] = useState<string>("whole");
  const [repeat, setRepeat] = useState(false);
  const [rate, setRate] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const occurrence = useMemo(() => occurrences.find((o) => o.annotation_id === choice) ?? null, [occurrences, choice]);
  const recording = useMemo(() => recordings.find((r) => r.source_id === occurrence?.source.source_id) ?? recordings[0] ?? null, [recordings, occurrence]);
  const src = recording ? contentUrl(recording.content) : undefined;
  const isVideo = !!recording?.media_type.startsWith("video/");
  const clip = occurrence ? { start: occurrence.start_ms, end: occurrence.end_ms } : null;
  const clipRef = useRef(clip);
  clipRef.current = clip;
  const repeatRef = useRef(repeat);
  repeatRef.current = repeat;

  // Changing slide pauses playback and selects that slide's first occurrence (never autoplay).
  useEffect(() => {
    mediaRef.current?.pause();
    setChoice(occurrences[0]?.annotation_id ?? "whole");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, occurrences.map((o) => o.annotation_id).join("|")]);

  useEffect(() => {
    if (mediaRef.current) mediaRef.current.playbackRate = rate;
  }, [rate, src]);

  const seek = useCallback((ms: number) => {
    const media = mediaRef.current;
    if (!media) return;
    const bounds = clipRef.current;
    const target = bounds ? Math.min(Math.max(ms, bounds.start), bounds.end) : Math.max(0, ms);
    try {
      media.currentTime = target / 1000;
      setPositionMs(target);
    } catch {
      setError("Seeking is not possible for this recording right now.");
    }
  }, []);

  useImperativeHandle(ref, () => ({
    pause: () => mediaRef.current?.pause(),
    seekTo: (ms) => {
      // A jump requested from the transcript leaves clip mode deliberately only if it is outside the clip.
      const bounds = clipRef.current;
      if (bounds && (ms < bounds.start || ms >= bounds.end)) setChoice("whole");
      const media = mediaRef.current;
      if (media) {
        media.currentTime = ms / 1000;
        setPositionMs(ms);
      }
    },
    currentMs: () => Math.round((mediaRef.current?.currentTime ?? 0) * 1000),
    isPlaying: () => !!mediaRef.current && !mediaRef.current.paused,
  }), []);

  const onTimeUpdate = () => {
    const media = mediaRef.current;
    if (!media) return;
    const now = media.currentTime * 1000;
    const bounds = clipRef.current;
    if (bounds && now >= bounds.end - 40) {
      if (repeatRef.current) {
        media.currentTime = bounds.start / 1000;
      } else if (!media.paused) {
        media.pause();
        media.currentTime = bounds.end / 1000;
        announce?.("End of this slide's segment. Playback stopped.");
      }
    }
    setPositionMs(Math.round(media.currentTime * 1000));
    onTime?.(Math.round(media.currentTime * 1000), !media.paused);
  };

  const onSeeking = () => {
    const media = mediaRef.current;
    const bounds = clipRef.current;
    if (!media || !bounds) return;
    const now = media.currentTime * 1000;
    if (now < bounds.start - 250) media.currentTime = bounds.start / 1000;
    else if (now > bounds.end + 250) media.currentTime = bounds.end / 1000;
  };

  const toggle = async () => {
    const media = mediaRef.current;
    if (!media) return;
    setError(null);
    if (!media.paused) {
      media.pause();
      return;
    }
    const bounds = clipRef.current;
    const now = media.currentTime * 1000;
    if (bounds && (now < bounds.start || now >= bounds.end - 40)) media.currentTime = bounds.start / 1000;
    try {
      await media.play();
    } catch (e) {
      setError(`Playback did not start: ${(e as Error).message}`);
    }
  };

  if (!recording) {
    return (
      <Callout tone="unassessed" title="No recording is linked to this lecture">
        The course records link no recorded session to these slides, so there is nothing to play and no times are shown. Slides, transcript text and sources stay available.
      </Callout>
    );
  }

  const rangeMin = clip ? clip.start : 0;
  const rangeMax = clip ? clip.end : (durationMs ?? recording.duration_ms ?? 0);
  const review = occurrence ? REVIEW_STATE[occurrence.review_state] : null;
  return (
    <section aria-label="Lecture recording" className="ll-card flex flex-col gap-3 p-3" data-testid="clip-player">
      <MediaController audio={!isVideo ? true : undefined} className="block w-full rounded-[var(--ll-radius)]"
        style={{ "--media-background-color": "var(--ll-surface-raised)", "--media-control-background": "transparent", "--media-control-padding": "8px", "--media-primary-color": "var(--ll-text)", "--media-secondary-color": "transparent", "--media-control-hover-background": "var(--ll-surface-raised)", "--media-text-color": "var(--ll-text)",
                 "--media-range-track-background": "var(--ll-border)", "--media-range-bar-color": "var(--ll-accent)", "--media-font-family": "var(--ll-font-ui)" } as React.CSSProperties}>
        {isVideo ? (
          <video ref={mediaRef} slot="media" src={src} preload="metadata" playsInline onTimeUpdate={onTimeUpdate} onSeeking={onSeeking} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
            onLoadedMetadata={(e) => setDurationMs(Number.isFinite(e.currentTarget.duration) ? Math.round(e.currentTarget.duration * 1000) : null)}
            onError={(e) => setError(MEDIA_ERRORS[e.currentTarget.error?.code ?? 0] ?? "The recording could not be played.")} className="max-h-[40dvh] w-full" data-testid="lecture-media" />
        ) : (
          <audio ref={mediaRef} slot="media" src={src} preload="metadata" onTimeUpdate={onTimeUpdate} onSeeking={onSeeking} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
            onLoadedMetadata={(e) => setDurationMs(Number.isFinite(e.currentTarget.duration) ? Math.round(e.currentTarget.duration * 1000) : null)}
            onError={(e) => setError(MEDIA_ERRORS[e.currentTarget.error?.code ?? 0] ?? "The recording could not be played.")} data-testid="lecture-media" />
        )}
        <MediaControlBar className="justify-end">
          <MediaTimeDisplay showDuration />
          <MediaMuteButton />
          <MediaVolumeRange />
        </MediaControlBar>
      </MediaController>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={toggle} aria-label={playing ? "Pause" : clip ? "Play this slide's segment" : "Play whole recording"} className="min-w-[52px] rounded-full px-3" data-testid="play-toggle">
          {playing ? <Pause aria-hidden className="size-5" /> : <Play aria-hidden className="size-5" />}
        </Button>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{clip ? "This slide's recording segment" : "Whole recording"}</p>
          <p className="text-sm text-muted" data-testid="clip-label">
            {clip ? `${formatMs(clip.start)} – ${formatMs(clip.end)}` : durationMs ? `0:00 – ${formatMs(durationMs)}` : "length unknown until loaded"} · {recording.filename} · session {recording.session_id}
            {recording.registration === "unregistered" ? " · not registered by the course updater" : ""}
          </p>
        </div>
        {review && occurrence && (
          <StatusChip tone={review.tone} title={`Basis: ${occurrence.basis.replace(/_/g, " ")}`}>
            {occurrence.relation === "displayed_during" ? "Shown during" : "Discussed during"} · {review.label}
          </StatusChip>
        )}
      </div>

      {occurrences.length === 0 && (
        <Callout tone="unassessed" title="No timed match for this slide">No reviewed or suggested interval links this slide to the recording. You can browse the whole recording; no start time is guessed.</Callout>
      )}

      <div className="flex items-center gap-2">
        <span className="w-12 text-right text-sm tabular-nums" aria-hidden>{formatMs(positionMs)}</span>
        <input type="range" className="h-11 flex-1 accent-[var(--ll-accent)]" min={rangeMin} max={Math.max(rangeMax, rangeMin + 1)} step={250} value={Math.min(Math.max(positionMs, rangeMin), Math.max(rangeMax, rangeMin + 1))}
          onChange={(e) => seek(Number(e.target.value))} aria-label={clip ? "Position within this segment" : "Position in the recording"} aria-valuetext={`${formatMs(positionMs)} of ${formatMs(rangeMax)}`} data-testid="clip-scrubber" />
        <span className="w-12 text-sm tabular-nums" aria-hidden>{formatMs(rangeMax)}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <IconButton label="Back 10 seconds" size="sm" onClick={() => seek(positionMs - 10_000)}><RotateCcw aria-hidden className="size-4" /></IconButton>
        <IconButton label="Forward 10 seconds" size="sm" onClick={() => seek(positionMs + 10_000)}><RotateCw aria-hidden className="size-4" /></IconButton>
        <label className="flex items-center gap-1 text-sm">
          <span>Speed</span>
          <select className="ll-input min-h-[36px] w-auto py-0" value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Playback speed">
            {RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
          </select>
        </label>
        <Button size="sm" aria-pressed={repeat} onClick={() => setRepeat((r) => !r)} disabled={!clip} className={cn(repeat && "border-accent text-accent")}>
          <Repeat aria-hidden className="size-4" /> Repeat segment{repeat ? ": on" : ""}
        </Button>
        <label className="flex items-center gap-1 text-sm">
          <span>Play</span>
          <select className="ll-input min-h-[36px] w-auto py-0" value={choice} aria-label="Which part of the recording to play"
            onChange={(e) => {
              mediaRef.current?.pause();
              setChoice(e.target.value);
            }}>
            {occurrences.map((o, i) => (
              <option key={o.annotation_id} value={o.annotation_id}>
                Occurrence {i + 1}: {formatMs(o.start_ms)}–{formatMs(o.end_ms)} ({o.review_state === "confirmed" ? "reviewed" : "suggested"})
              </option>
            ))}
            <option value="whole">Whole recording</option>
          </select>
        </label>
        {occurrence && onEditMatch && <Button size="sm" variant="quiet" className="ml-auto" onClick={() => onEditMatch(occurrence)}>Edit match</Button>}
      </div>
      {error && <Callout tone="danger" role="alert" title="Playback problem">{error} The recording file itself was not changed.</Callout>}
    </section>
  );
});
