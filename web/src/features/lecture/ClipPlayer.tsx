// The ONE player of a lecture workspace (design specification 5.5, 4.4 "what never remounts"). No bar is drawn here:
//
//   RangePlayer    the rules, free of React and of the DOM: a selected range is one bounded interval; selecting it seeks
//                  to its start, playback stops at its end, Repeat replays it, the whole recording has no bounds. It
//                  drives anything shaped like a media element, so the rules are unit-tested with a fake one.
//   useClipPlayer  binds those rules to the one <audio>/<video> element under ONE Media Chrome controller. The element
//                  is rendered into the workspace frame's persistent media host (useWorkspaceFrame().mediaHost), which
//                  no arrangement moves or re-creates, so playback survives a change of tab, pane, theme and size.
//
// The bar (./Transport), the range list (./RangeList) and the docked strip (./DockedTransport) are views of this.
// Nothing is played between two ranges, nothing plays by itself, and no interval is invented.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { MediaController } from "media-chrome/react";
import { contentUrl } from "@/lib/api";
import { clampToRange, stopAtEnd, toMs, withinRange, type MsRange, type StopDecision } from "@/lib/r2";
import type { RecordingView } from "@/lib/types";

// ---- the rules ---------------------------------------------------------------------------------------------------------
/** What the player touches of a media element. */
export interface MediaLike {
  /** Seconds. */
  currentTime: number;
  readonly paused: boolean;
  /** Seconds; NaN until known. */
  readonly duration: number;
  /** 0 until the element knows its resource. Absent counts as loaded. */
  readonly readyState?: number;
  readonly playbackRate?: number;
  play(): Promise<void> | void;
  pause(): void;
}

export type RangePlayerEvent =
  /** Playback reached the end of the selected range and was paused there. */
  | { type: "stopped"; at_ms: number }
  /** Repeat is on: playback went back to the start of the range. */
  | { type: "looped"; to_ms: number }
  /** A jump to a time outside the selected range: the whole recording is now what plays. */
  | { type: "left_range" }
  | { type: "error"; message: string };

/**
 * How close to the end of a range a time update counts as the end. The player also asks for a tick exactly at the end
 * (`msUntilStop`), so this only covers the jitter of that timer.
 */
export const STOP_TOLERANCE_MS = 30;
/** A seek made outside this player is put back into the range only when it lands further out than this (a browser rounds seeks). */
export const SEEK_SLACK_MS = 250;

export class RangePlayer {
  private bounds: MsRange | null = null;
  private repeating = false;
  private stopped = false;
  /** A position asked for before the element could take it (no element yet, or its recording still loading). */
  private pendingMs: number | null = null;

  constructor(
    private readonly media: () => MediaLike | null,
    private readonly emit: (event: RangePlayerEvent) => void = () => undefined,
    private readonly toleranceMs: number = STOP_TOLERANCE_MS,
  ) {}

  /** The selected range, or null for the whole recording. */
  get range(): MsRange | null {
    return this.bounds;
  }
  get repeat(): boolean {
    return this.repeating;
  }
  /** Playback reached the end of the range and nothing has moved it since. */
  get stoppedAtEnd(): boolean {
    return this.stopped;
  }
  isPlaying(): boolean {
    const media = this.media();
    return !!media && !media.paused;
  }
  /** Where the player stands (the position it was asked to take, while the recording is still loading). */
  currentMs(): number {
    if (this.pendingMs !== null) return this.pendingMs;
    const media = this.media();
    return media ? toMs(media.currentTime) : 0;
  }

  /**
   * Select a range (the player goes to its start; `play` keeps a recording that was playing going, from there) or the
   * whole recording (null: the position stays where it is and nothing starts or stops). Never starts playback by itself.
   */
  select(range: MsRange | null, options: { play?: boolean } = {}): void {
    this.bounds = range ? { start_ms: range.start_ms, end_ms: range.end_ms } : null;
    this.stopped = false;
    if (!range) return;
    this.go(range.start_ms);
    if (options.play) void this.play();
  }

  setRepeat(on: boolean): void {
    this.repeating = on;
  }

  /** Play. With a range selected, a position outside it or at its end starts again from its start. */
  async play(): Promise<void> {
    const media = this.media();
    if (!media) return;
    if (this.bounds && stopAtEnd(this.bounds, this.currentMs(), { toleranceMs: this.toleranceMs }).action !== "play") this.go(this.bounds.start_ms);
    this.stopped = false;
    try {
      await media.play();
    } catch (error) {
      this.emit({ type: "error", message: `Playback did not start: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  pause(): void {
    this.media()?.pause();
  }
  async toggle(): Promise<void> {
    if (this.isPlaying()) this.pause();
    else await this.play();
  }

  /** A seek of the bar: kept inside the selected range, or inside the recording. */
  seek(ms: number): void {
    const duration = this.media()?.duration;
    const end = typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? toMs(duration) : null;
    const target = this.bounds ? clampToRange(this.bounds, ms) : Math.max(0, end === null ? ms : Math.min(ms, end));
    this.stopped = false;
    this.go(target);
  }
  /** Back or forward by `deltaMs`, kept inside what is selected. */
  step(deltaMs: number): void {
    this.seek(this.currentMs() + deltaMs);
  }
  /**
   * Go to a time of the recording, wherever it lies (a timed transcript line, a preview). A time outside the selected
   * range leaves the range for the whole recording; true is returned then, and "left_range" is emitted.
   */
  seekTo(ms: number): boolean {
    const target = Math.max(0, ms);
    const left = !!this.bounds && !withinRange(this.bounds, target);
    if (left) {
      this.bounds = null;
      this.emit({ type: "left_range" });
    }
    this.stopped = false;
    this.go(target);
    return left;
  }

  /**
   * What a time update means while a range is selected: play on inside it; at its end pause there (or, under Repeat, go
   * back to its start); before its start go to the start. A paused player is never moved or looped at the end.
   */
  tick(): StopDecision["action"] {
    const media = this.media();
    const range = this.bounds;
    if (!media || !range) return "play";
    if (this.pendingMs !== null && (media.readyState ?? 4) < 1) return "play"; // its recording is still loading
    const decision = stopAtEnd(range, toMs(media.currentTime), { repeat: this.repeating, toleranceMs: this.toleranceMs });
    if (decision.action === "stop") {
      if (!media.paused) {
        media.pause();
        this.go(decision.at_ms);
        this.stopped = true;
        this.emit({ type: "stopped", at_ms: decision.at_ms });
      }
    } else if (decision.action === "loop") {
      if (!media.paused) {
        this.go(decision.to_ms);
        this.emit({ type: "looped", to_ms: decision.to_ms });
      }
    } else if (decision.action === "seek") {
      this.go(decision.to_ms);
    }
    return decision.action;
  }
  /** Put a seek that did not come through this player (a seek button of the controller, a media key) back inside the range. */
  clamp(): void {
    const media = this.media();
    const range = this.bounds;
    if (!media || !range) return;
    const now = toMs(media.currentTime);
    const target = clampToRange(range, now);
    if (Math.abs(target - now) >= SEEK_SLACK_MS) this.go(target);
  }
  /** The element knows its recording now: a position asked for earlier is applied. */
  loaded(): void {
    const pending = this.pendingMs;
    if (pending === null) return;
    this.pendingMs = null;
    this.go(pending);
  }
  /** Milliseconds of real time until playback reaches the end of the range at the current speed; null while paused or unbounded. */
  msUntilStop(): number | null {
    const media = this.media();
    const range = this.bounds;
    if (!media || !range || media.paused) return null;
    const rate = media.playbackRate && media.playbackRate > 0 ? media.playbackRate : 1;
    return Math.max(0, (range.end_ms - toMs(media.currentTime)) / rate);
  }

  private go(ms: number): void {
    const media = this.media();
    this.pendingMs = ms;
    if (!media) return;
    try {
      media.currentTime = ms / 1000;
      if ((media.readyState ?? 4) >= 1) this.pendingMs = null;
    } catch {
      this.pendingMs = null;
      this.emit({ type: "error", message: "Seeking is not possible for this recording right now." });
    }
  }
}

// ---- the one media element -----------------------------------------------------------------------------------------------
const MEDIA_ERRORS: Record<number, string> = {
  1: "Loading the recording was stopped.", 2: "A network problem interrupted loading the recording.", 3: "The recording could not be decoded by this browser.",
  4: "This browser cannot play this recording's format.",
};
/** One sentence for a media element's error code. */
export const mediaErrorSentence = (code: number | null | undefined): string => MEDIA_ERRORS[code ?? 0] ?? "The recording could not be played.";

/** The bounded part of a recording that is selected: a range of the page, or a candidate the learner is listening to. */
export interface ClipBounds extends MsRange {
  /** What tells one selection from another (a `range_id`). */
  id: string;
  /** The recording the times belong to. */
  recording_source_id: string | null;
}

export interface ClipPlayerOptions {
  /** The node the media element lives in. Nothing is rendered until one is given. */
  host: HTMLElement | null;
  recordings: RecordingView[];
  /** The selected range, or null for the whole recording. */
  bounds: ClipBounds | null;
  /** Changes when the page on screen does: a new page pauses and never plays by itself. */
  pageKey: string;
  onTime?: (ms: number, playing: boolean) => void;
  /** A jump outside the selected range was asked for (the transcript, a preview): the selection becomes the whole recording. */
  onLeftRange?: () => void;
  /** Playback reached the end of the selected range and stopped there. */
  onStopped?: () => void;
}

export interface ClipPlayer {
  /** The media element under its controller, as a portal into the host. Render it once. */
  element: ReactNode;
  /** The id of the Media Chrome controller, for controls drawn outside it; null until the controller is in the document. */
  controllerId: string | null;
  /** The recording loaded in the player. */
  recording: RecordingView | null;
  playing: boolean;
  positionMs: number;
  /** Length of the loaded recording (the element's own once it knows it, else the catalogued one). */
  durationMs: number | null;
  rate: number;
  muted: boolean;
  volume: number;
  repeat: boolean;
  /** Playback stopped at the end of the selected range and nothing has moved since. */
  stoppedAtEnd: boolean;
  /** A sentence when the recording could not be loaded or played. */
  error: string | null;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  /** A seek of the bar, kept inside what is selected. */
  seek: (ms: number) => void;
  step: (deltaMs: number) => void;
  /** Go to a time wherever it lies; leaves the selected range when it lies outside it. */
  seekTo: (ms: number) => void;
  setRate: (rate: number) => void;
  setRepeat: (on: boolean) => void;
  setMuted: (muted: boolean) => void;
  /** Say, before the selection is changed by the learner, that a playing recording should go on playing in the new range. */
  keepPlaying: () => void;
  /** After a stop at the end of a range: remove the bounds and play on from there. */
  goOn: () => void;
  /** Load the recording again after a failure; the position is kept. */
  reload: () => void;
  isPlaying: () => boolean;
  currentMs: () => number;
}

type MediaElement = HTMLAudioElement & HTMLVideoElement;

/** The one player of a lecture workspace. Call it once per workspace and render `element` once. */
export function useClipPlayer({ host, recordings, bounds, pageKey, onTime, onLeftRange, onStopped }: ClipPlayerOptions): ClipPlayer {
  const mediaRef = useRef<MediaElement | null>(null);
  const controllerId = `ll-player-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const [controllerReady, setControllerReady] = useState(false);
  const controllerRef = useCallback((node: HTMLElement | null) => setControllerReady(!!node), []); // stable: a new callback each render would detach and attach it for ever
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [elementDurationMs, setElementDurationMs] = useState<number | null>(null);
  const [rate, setRateState] = useState(1);
  const [muted, setMutedState] = useState(false);
  const [volume, setVolume] = useState(1);
  const [repeat, setRepeatState] = useState(false);
  const [stoppedAtEnd, setStoppedAtEnd] = useState(false);
  // Two kinds of failure: the recording did not load (it stays failed until it is loaded again), or one action did not work.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const callbacks = useRef({ onTime, onLeftRange, onStopped });
  callbacks.current = { onTime, onLeftRange, onStopped };

  const player = useMemo(() => new RangePlayer(() => mediaRef.current, (event) => {
    if (event.type === "stopped") {
      setStoppedAtEnd(true);
      callbacks.current.onStopped?.();
    } else if (event.type === "left_range") callbacks.current.onLeftRange?.();
    else if (event.type === "error") setActionError(event.message);
  }), []);

  // The recording in the player: the one the selected range belongs to; in the whole recording, the one already loaded.
  const wanted = bounds?.recording_source_id ?? null;
  const recording = recordings.find((entry) => entry.source_id === wanted) ?? recordings.find((entry) => entry.source_id === loadedId) ?? recordings[0] ?? null;
  useEffect(() => {
    if (recording && recording.source_id !== loadedId) setLoadedId(recording.source_id);
  }, [recording, loadedId]);
  const src = recording ? contentUrl(recording.content) : undefined;
  const isVideo = !!recording?.media_type.startsWith("video/");

  const sync = useCallback(() => {
    const media = mediaRef.current;
    const ms = player.currentMs();
    const isPlaying = !!media && !media.paused;
    setPositionMs(ms);
    setPlaying(isPlaying);
    setStoppedAtEnd(player.stoppedAtEnd);
    callbacks.current.onTime?.(ms, isPlaying);
  }, [player]);

  // A time update comes a few times a second; the end of a range is met by a timer set for the moment itself.
  const timer = useRef<number | null>(null);
  const schedule = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const wait = player.msUntilStop();
    if (wait === null || wait > 1_000) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      player.tick();
      sync();
      schedule();
    }, Math.max(0, wait - STOP_TOLERANCE_MS / 2));
  }, [player, sync]);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  // The selection, and a new page: a new page pauses; a range is cued at its start; nothing plays by itself.
  const resume = useRef(false);
  const lastPage = useRef(pageKey);
  const boundsKey = bounds ? `${bounds.id}|${bounds.recording_source_id ?? ""}|${bounds.start_ms}|${bounds.end_ms}` : "";
  useEffect(() => {
    const pageChanged = lastPage.current !== pageKey;
    lastPage.current = pageKey;
    if (pageChanged) player.pause();
    const carryOn = !pageChanged && (resume.current || player.isPlaying());
    resume.current = false;
    setActionError(null);
    player.select(bounds ? { start_ms: bounds.start_ms, end_ms: bounds.end_ms } : null, { play: carryOn });
    sync();
    schedule();
    // `bounds` is read through its key: an equal range in a new object selects nothing again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey, boundsKey, player, sync, schedule]);

  useEffect(() => {
    if (mediaRef.current) mediaRef.current.playbackRate = rate;
  }, [rate, src]);
  // Another recording: its own length, its own errors.
  useEffect(() => {
    setElementDurationMs(null);
    setLoadError(null);
    setActionError(null);
  }, [src]);

  const onTimeUpdate = () => {
    player.tick();
    sync();
    schedule();
  };
  const media = {
    ref: mediaRef, slot: "media", src, preload: "metadata" as const, "data-testid": "lecture-media",
    onTimeUpdate, onPlay: onTimeUpdate, onPause: onTimeUpdate, onSeeked: onTimeUpdate, onRateChange: onTimeUpdate,
    onSeeking: () => {
      player.clamp();
      sync();
    },
    onLoadedMetadata: (event: SyntheticEvent<HTMLMediaElement>) => {
      const seconds = event.currentTarget.duration;
      setElementDurationMs(Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null);
      event.currentTarget.playbackRate = rate;
      setMutedState(event.currentTarget.muted);
      setVolume(event.currentTarget.volume);
      setLoadError(null);
      player.loaded();
      sync();
    },
    onVolumeChange: (event: SyntheticEvent<HTMLMediaElement>) => {
      setMutedState(event.currentTarget.muted);
      setVolume(event.currentTarget.volume);
    },
    onError: (event: SyntheticEvent<HTMLMediaElement>) => setLoadError(mediaErrorSentence(event.currentTarget.error?.code)),
  };

  const element = host && recording ? createPortal(
    // Its controls are drawn in the bar and bound to it by id; here it only holds the element. No hotkeys: it is never focused.
    <MediaController ref={controllerRef} id={controllerId} audio={isVideo ? undefined : true} noHotkeys>
      {isVideo ? <video {...media} playsInline /> : <audio {...media} />}
    </MediaController>,
    host,
  ) : null;

  const act = useCallback((run: () => void | Promise<void>) => {
    setActionError(null);
    void Promise.resolve(run()).then(() => {
      sync();
      schedule();
    });
  }, [sync, schedule]);

  return {
    element,
    controllerId: controllerReady && element ? controllerId : null,
    recording,
    playing,
    positionMs,
    durationMs: elementDurationMs ?? recording?.duration_ms ?? null,
    rate,
    muted,
    volume,
    repeat,
    stoppedAtEnd,
    error: loadError ?? actionError,
    toggle: useCallback(() => act(() => player.toggle()), [act, player]),
    play: useCallback(() => act(() => player.play()), [act, player]),
    pause: useCallback(() => act(() => player.pause()), [act, player]),
    seek: useCallback((ms: number) => act(() => player.seek(ms)), [act, player]),
    step: useCallback((deltaMs: number) => act(() => player.step(deltaMs)), [act, player]),
    seekTo: useCallback((ms: number) => act(() => { player.seekTo(ms); }), [act, player]),
    setRate: useCallback((next: number) => setRateState(next), []),
    setRepeat: useCallback((on: boolean) => {
      player.setRepeat(on);
      setRepeatState(on);
    }, [player]),
    setMuted: useCallback((next: boolean) => {
      if (mediaRef.current) mediaRef.current.muted = next;
    }, []),
    keepPlaying: useCallback(() => {
      resume.current = player.isPlaying();
    }, [player]),
    goOn: useCallback(() => act(() => {
      player.select(null);
      return player.play();
    }), [act, player]),
    reload: useCallback(() => {
      const at = player.currentMs();
      setLoadError(null);
      setActionError(null);
      mediaRef.current?.load();
      player.seek(at); // applied once the recording has loaded
      sync();
    }, [player, sync]),
    isPlaying: useCallback(() => player.isPlaying(), [player]),
    currentMs: useCallback(() => player.currentMs(), [player]),
  };
}
