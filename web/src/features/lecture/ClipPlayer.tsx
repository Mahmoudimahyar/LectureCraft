// Clip playback (LL012, R1-U3/U4): one stable media element under ONE Media Chrome controller with two compact rows.
// Row 1 is the transport (play/pause, ±10 s, the one timeline, the one time readout); row 2 is scope and settings
// (segment or whole recording, speed, repeat, volume, link editing, details). Starts paused. A segment is one bounded
// interval and playback stops at its end; another occurrence or the whole recording is an explicit choice. Changing
// slide pauses. Nothing is played between disjoint ranges and no interval is invented when a slide has no timed link.
import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { MediaControlBar, MediaController, MediaMuteButton, MediaTimeDisplay, MediaVolumeRange } from "media-chrome/react";
import { ChevronDown, Pause, Play, Repeat, RotateCcw, RotateCw } from "lucide-react";
import { Button, Callout, cn, formatMs, IconButton, StatusChip } from "@/components/ui";
import { contentUrl } from "@/lib/api";
import { REVIEW_STATE } from "@/lib/labels";
import type { Occurrence, RecordingView } from "@/lib/types";

export interface ClipPlayerHandle {
  pause(): void;
  seekTo(ms: number): void;
  currentMs(): number;
  isPlaying(): boolean;
  /** Length reported by the media element itself (null until its metadata has loaded). */
  durationMs(): number | null;
  /** The recording currently loaded in the player. */
  recording(): RecordingView | null;
}

interface ClipPlayerProps {
  recordings: RecordingView[];
  occurrences: Occurrence[];
  page: number;
  onTime?: (ms: number, playing: boolean) => void;
  onEditMatch?: (occurrence: Occurrence) => void;
  /** Offered when the learner may create a link for this slide (paired device, identified files). */
  onAddMatch?: () => void;
  announce?: (message: string) => void;
}

const RATES = [0.75, 1, 1.25, 1.5, 2];
const MEDIA_ERRORS: Record<number, string> = { 1: "Playback was aborted.", 2: "A network problem interrupted loading the recording.", 3: "The recording could not be decoded by this browser.", 4: "This browser cannot play this recording's format." };

export const ClipPlayer = forwardRef<ClipPlayerHandle, ClipPlayerProps>(function ClipPlayer({ recordings, occurrences, page, onTime, onEditMatch, onAddMatch, announce }, ref) {
  const mediaRef = useRef<HTMLAudioElement & HTMLVideoElement>(null);
  const detailsId = useId();
  const [choice, setChoice] = useState<string>("whole");
  const [repeat, setRepeat] = useState(false);
  const [rate, setRate] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState(false);

  const occurrence = useMemo(() => occurrences.find((o) => o.annotation_id === choice) ?? null, [occurrences, choice]);
  const recording = useMemo(() => recordings.find((r) => r.source_id === occurrence?.source.source_id) ?? recordings[0] ?? null, [recordings, occurrence]);
  const src = recording ? contentUrl(recording.content) : undefined;
  const isVideo = !!recording?.media_type.startsWith("video/");
  const clip = occurrence ? { start: occurrence.start_ms, end: occurrence.end_ms } : null;
  const clipRef = useRef(clip);
  clipRef.current = clip;
  const repeatRef = useRef(repeat);
  repeatRef.current = repeat;
  const durationRef = useRef<number | null>(null);
  durationRef.current = durationMs ?? recording?.duration_ms ?? null;
  const recordingRef = useRef<RecordingView | null>(null);
  recordingRef.current = recording;

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
    durationMs: () => durationRef.current,
    recording: () => recordingRef.current,
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
      <p className="ll-card px-3 py-2 text-sm text-muted" data-testid="clip-player-none">
        <strong className="font-semibold text-ink">No recording is linked to this lecture.</strong> The course records link no recorded session to these slides, so no times are shown.
      </p>
    );
  }

  const rangeMin = clip ? clip.start : 0;
  const rangeMax = clip ? clip.end : (durationMs ?? recording.duration_ms ?? 0);
  const review = occurrence ? REVIEW_STATE[occurrence.review_state] : null;
  const media = {
    ref: mediaRef, slot: "media", src, preload: "metadata" as const, onTimeUpdate, onSeeking, onPlay: () => setPlaying(true), onPause: () => setPlaying(false),
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) => setDurationMs(Number.isFinite(e.currentTarget.duration) ? Math.round(e.currentTarget.duration * 1000) : null),
    onError: (e: React.SyntheticEvent<HTMLMediaElement>) => setError(MEDIA_ERRORS[e.currentTarget.error?.code ?? 0] ?? "The recording could not be played."),
  };
  return (
    <section aria-label="Lecture recording" className="ll-card ll-transport flex flex-col gap-1.5 p-2" data-testid="clip-player">
      <MediaController audio={!isVideo ? true : undefined}>
        {isVideo ? <video {...media} playsInline className="max-h-[32dvh] w-full" data-testid="lecture-media" /> : <audio {...media} data-testid="lecture-media" />}
        <MediaControlBar data-testid="transport-row">
          <Button variant="primary" onClick={toggle} aria-label={playing ? "Pause" : clip ? "Play this slide's segment" : "Play whole recording"} className="min-w-[48px] rounded-full px-3" data-testid="play-toggle">
            {playing ? <Pause aria-hidden className="size-5" /> : <Play aria-hidden className="size-5" />}
          </Button>
          <IconButton label="Back 10 seconds" size="sm" onClick={() => seek(positionMs - 10_000)}><RotateCcw aria-hidden className="size-4" /></IconButton>
          <IconButton label="Forward 10 seconds" size="sm" onClick={() => seek(positionMs + 10_000)}><RotateCw aria-hidden className="size-4" /></IconButton>
          <input type="range" className="ll-transport-range" min={rangeMin} max={Math.max(rangeMax, rangeMin + 1)} step={250} value={Math.min(Math.max(positionMs, rangeMin), Math.max(rangeMax, rangeMin + 1))}
            onChange={(e) => seek(Number(e.target.value))} aria-label={clip ? "Position within this segment" : "Position in the recording"} aria-valuetext={`${formatMs(positionMs)} of ${formatMs(rangeMax)}`} data-testid="clip-scrubber" />
          <MediaTimeDisplay showDuration data-testid="time-readout" />
          <select className="ll-input" value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Playback speed">
            {RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
          </select>
        </MediaControlBar>
        <MediaControlBar data-testid="scope-row">
          <select className="ll-input max-w-[10rem]" value={choice} aria-label="Which part of the recording to play"
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
          <span className="text-sm text-muted tabular-nums" data-testid="clip-label">
            {clip ? `${formatMs(clip.start)} – ${formatMs(clip.end)}` : durationMs ? `0:00 – ${formatMs(durationMs)}` : "length unknown until loaded"}
          </span>
          {review && occurrence && (
            <StatusChip tone={review.tone} title={`${occurrence.relation === "displayed_during" ? "Shown during" : "Discussed during"} this interval · basis: ${occurrence.basis.replace(/_/g, " ")}`}>{review.label}</StatusChip>
          )}
          {occurrences.length === 0 && <StatusChip tone="unassessed">No timed match for this slide</StatusChip>}
          {occurrences.length === 0 && onAddMatch && <Button size="sm" onClick={onAddMatch} aria-label="Link this slide to the recording">Link this slide</Button>}
          {occurrence && onEditMatch && <Button size="sm" variant="quiet" onClick={() => onEditMatch(occurrence)}>Edit match</Button>}
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            <IconButton label={`Repeat segment${repeat ? ": on" : ""}`} size="sm" aria-pressed={repeat} onClick={() => setRepeat((r) => !r)} disabled={!clip} className={cn(repeat && "border-accent-text text-accent-text")}>
              <Repeat aria-hidden className="size-4" />
            </IconButton>
            <MediaMuteButton />
            <MediaVolumeRange className="hidden min-[2200px]:inline-block" />
            <IconButton label="Details" size="sm" variant="quiet" aria-expanded={details} aria-controls={detailsId} onClick={() => setDetails((d) => !d)}>
              <ChevronDown aria-hidden className={cn("size-4", details && "rotate-180")} />
            </IconButton>
          </span>
        </MediaControlBar>
      </MediaController>
      {details && (
        <div id={detailsId} className="flex flex-col gap-1 border-t border-line/40 px-1 pt-2 text-sm" data-testid="transport-details">
          <p>{recording.filename} · session {recording.session_id}{recording.registration === "unregistered" ? " · not registered by the course updater" : ""}</p>
          {occurrences.length === 0 ? (
            <p className="text-muted">No reviewed or suggested interval links this slide to the recording. You can browse the whole recording; no start time is guessed.
              {onAddMatch ? " When you reach the part where this slide is discussed, you can record that yourself." : ""}</p>
          ) : (
            <p className="text-muted">{occurrence ? `${occurrence.relation === "displayed_during" ? "Shown during" : "Discussed during"} ${formatMs(occurrence.start_ms)}–${formatMs(occurrence.end_ms)} · ${review?.label ?? ""} · basis: ${occurrence.basis.replace(/_/g, " ")}. ` : ""}
              A segment is one bounded interval of the recording. Playback stops at its end unless Repeat is on.</p>
          )}
          {occurrences.length > 0 && onAddMatch && <div><Button size="sm" variant="quiet" onClick={onAddMatch}>Add another link</Button></div>}
        </div>
      )}
      {error && <Callout tone="danger" role="alert" title="Playback problem">{error} The recording file itself was not changed.</Callout>}
    </section>
  );
});
