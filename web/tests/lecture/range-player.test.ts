// The rules of the ONE player (web/src/features/lecture/ClipPlayer.tsx, `RangePlayer`): selecting a range seeks the
// real player to its start, playback stops at its end, Repeat replays it, the whole recording has no bounds. The media
// element is a LABELED DOUBLE here (`FakeMedia`: a clock that advances only when asked); the same rules are checked on
// a real <audio> element in a browser (.local/preview/l2/range-check.mjs).
import { describe, expect, it } from "vitest";
import { RangePlayer, SEEK_SLACK_MS, STOP_TOLERANCE_MS, type MediaLike, type RangePlayerEvent } from "@/features/lecture/ClipPlayer";
import { sampleRangeFirstVisit, sampleRangeSecondVisit } from "@/lib/fixtures/r2-sample";

/** A media element reduced to what the player touches. Time passes only through `advance`, in steps like a browser's time updates. */
class FakeMedia implements MediaLike {
  currentTime = 0;
  paused = true;
  duration = 4_800;
  readyState = 4;
  playbackRate = 1;
  plays = 0;
  seeks: number[] = [];
  private position = 0;
  constructor() {
    Object.defineProperty(this, "currentTime", { get: () => this.position, set: (value: number) => { this.position = value; this.seeks.push(Math.round(value * 1000)); } });
  }
  play(): Promise<void> {
    this.paused = false;
    this.plays += 1;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  /** Let `ms` of media time pass in time updates `stepMs` apart, calling `onUpdate` after each, as a playing element does. */
  advance(ms: number, onUpdate: () => void, stepMs = 250): void {
    for (let passed = 0; passed < ms && !this.paused; passed += stepMs) {
      this.position += (Math.min(stepMs, ms - passed) / 1000) * this.playbackRate;
      onUpdate();
    }
  }
  get ms(): number {
    return Math.round(this.position * 1000);
  }
}

function setup(toleranceMs = STOP_TOLERANCE_MS) {
  const media = new FakeMedia();
  const events: RangePlayerEvent[] = [];
  const player = new RangePlayer(() => media, (event) => events.push(event), toleranceMs);
  const run = (ms: number, stepMs?: number) => media.advance(ms, () => player.tick(), stepMs);
  return { media, events, player, run };
}
const first = { start_ms: sampleRangeFirstVisit.start_ms, end_ms: sampleRangeFirstVisit.end_ms }; // 17:52 – 20:36
const second = { start_ms: sampleRangeSecondVisit.start_ms, end_ms: sampleRangeSecondVisit.end_ms }; // 41:10 – 42:05

describe("selecting a range", () => {
  it("seeks the player to the start of the range and leaves it paused", () => {
    const { media, player } = setup();
    player.select(first);
    expect(media.ms).toBe(first.start_ms);
    expect(media.paused).toBe(true);
    expect(media.plays).toBe(0); // never autoplay
    expect(player.range).toEqual(first);
    expect(player.currentMs()).toBe(first.start_ms);
  });

  it("goes on playing from the start of the new range when the recording was playing", async () => {
    const { media, player, run } = setup();
    player.select(first);
    await player.play();
    run(5_000);
    player.select(second, { play: true });
    await Promise.resolve();
    expect(media.ms).toBe(second.start_ms);
    expect(media.paused).toBe(false);
  });

  it("does not move the position for the whole recording, and starts or stops nothing", async () => {
    const { media, player, run } = setup();
    player.select(first);
    await player.play();
    run(3_000);
    const at = media.ms;
    player.select(null);
    expect(media.ms).toBe(at);
    expect(media.paused).toBe(false);
    expect(player.range).toBeNull();
  });

  it("keeps the start as a pending seek until the recording has loaded, then applies it", () => {
    const { media, player } = setup();
    media.readyState = 0; // a range of another recording: the source was just switched
    player.select(second);
    expect(player.currentMs()).toBe(second.start_ms); // what the bar shows meanwhile
    media.currentTime = 0; // the element resets while it loads
    media.readyState = 1;
    player.loaded();
    expect(media.ms).toBe(second.start_ms);
    expect(media.paused).toBe(true);
  });
});

describe("stop at the end", () => {
  it("plays to the end of the range, pauses there and says so once", async () => {
    const { media, events, player, run } = setup();
    player.select(first);
    await player.play();
    run(first.end_ms - first.start_ms + 5_000); // more than the range holds
    expect(media.paused).toBe(true);
    expect(media.ms).toBe(first.end_ms); // at the end itself, not a time update past it
    expect(player.stoppedAtEnd).toBe(true);
    expect(events.filter((event) => event.type === "stopped")).toEqual([{ type: "stopped", at_ms: first.end_ms }]);
  });

  it("counts a time update that lands just short of the end as the end", async () => {
    const { media, player } = setup(40);
    player.select(first);
    await player.play();
    media.currentTime = (first.end_ms - 30) / 1000;
    expect(player.tick()).toBe("stop");
    expect(media.paused).toBe(true);
    expect(media.ms).toBe(first.end_ms);
  });

  it("never plays what lies between two visits", async () => {
    const { media, player } = setup();
    player.select(second);
    await player.play();
    media.currentTime = (first.end_ms + 60_000) / 1000; // somewhere between the first visit and the second
    expect(player.tick()).toBe("seek");
    expect(media.ms).toBe(second.start_ms);
  });

  it("starts again from the start when Play is pressed after it stopped", async () => {
    const { media, player, run } = setup();
    player.select(first);
    await player.play();
    run(first.end_ms - first.start_ms + 1_000);
    expect(media.paused).toBe(true);
    await player.play();
    expect(media.ms).toBe(first.start_ms);
    expect(media.paused).toBe(false);
    expect(player.stoppedAtEnd).toBe(false);
  });

  it("does nothing at the end while the player is paused there", () => {
    const { media, events, player } = setup();
    player.select(first);
    player.seek(first.end_ms);
    expect(player.tick()).toBe("stop");
    expect(media.paused).toBe(true);
    expect(events).toEqual([]); // nothing stopped: nothing was playing
  });

  it("has no bound in the whole recording", async () => {
    const { media, events, player, run } = setup();
    player.select(null);
    media.currentTime = first.end_ms / 1000 - 2;
    await player.play();
    run(10_000);
    expect(media.paused).toBe(false);
    expect(media.ms).toBe(first.end_ms + 8_000);
    expect(events).toEqual([]);
  });

  it("still plays a range that is shorter than the tolerance", async () => {
    const { media, player, run } = setup(250);
    const short = { start_ms: 1_000, end_ms: 1_100 };
    player.select(short);
    await player.play();
    expect(media.paused).toBe(false);
    expect(player.tick()).toBe("play"); // at its very start: not already "at the end"
    run(200, 50);
    expect(media.paused).toBe(true);
    expect(media.ms).toBe(short.end_ms);
  });

  it("tells how long until the stop at the current speed, and nothing while paused or unbounded", async () => {
    const { media, player } = setup();
    player.select(first);
    expect(player.msUntilStop()).toBeNull(); // paused
    await player.play();
    media.currentTime = (first.end_ms - 3_000) / 1000;
    expect(player.msUntilStop()).toBe(3_000);
    media.playbackRate = 2;
    expect(player.msUntilStop()).toBe(1_500);
    player.select(null);
    expect(player.msUntilStop()).toBeNull();
  });
});

describe("repeat", () => {
  it("goes back to the start of the range at its end and keeps playing", async () => {
    const { media, events, player, run } = setup();
    player.select(second); // 55 s
    player.setRepeat(true);
    await player.play();
    run(55_000 + 10_000);
    expect(media.paused).toBe(false);
    expect(media.ms).toBeGreaterThanOrEqual(second.start_ms);
    expect(media.ms).toBeLessThan(second.end_ms);
    expect(events.some((event) => event.type === "stopped")).toBe(false);
    expect(events.filter((event) => event.type === "looped")).toEqual([{ type: "looped", to_ms: second.start_ms }]);
  });

  it("stops at the next end once it is turned off", async () => {
    const { media, events, player, run } = setup();
    player.select(second);
    player.setRepeat(true);
    await player.play();
    run(60_000); // one pass and a little
    player.setRepeat(false);
    run(60_000);
    expect(media.paused).toBe(true);
    expect(media.ms).toBe(second.end_ms);
    expect(events.filter((event) => event.type === "stopped")).toHaveLength(1);
  });

  it("does not loop a paused player", () => {
    const { media, player } = setup();
    player.select(second);
    player.setRepeat(true);
    player.seek(second.end_ms);
    player.tick();
    expect(media.ms).toBe(second.end_ms);
    expect(media.paused).toBe(true);
  });
});

describe("seeking", () => {
  it("keeps a seek of the bar inside the selected range", () => {
    const { media, player } = setup();
    player.select(first);
    player.seek(first.start_ms - 30_000);
    expect(media.ms).toBe(first.start_ms);
    player.seek(first.end_ms + 30_000);
    expect(media.ms).toBe(first.end_ms);
    player.seek(first.start_ms + 12_000);
    expect(media.ms).toBe(first.start_ms + 12_000);
    player.step(-10_000);
    expect(media.ms).toBe(first.start_ms + 2_000);
    player.step(-10_000);
    expect(media.ms).toBe(first.start_ms); // back 10 s never leaves the range
  });

  it("never seeks before the start of the recording, nor past a known end", () => {
    const { media, player } = setup();
    player.select(null);
    player.seek(-5_000);
    expect(media.ms).toBe(0);
    player.seek(99_000_000);
    expect(media.ms).toBe(4_800_000);
  });

  it("puts a seek made elsewhere (a seek button, a media key) back inside the range", () => {
    const { media, player } = setup();
    player.select(first);
    media.currentTime = (first.start_ms - 7_000) / 1000;
    player.clamp();
    expect(media.ms).toBe(first.start_ms);
    media.currentTime = (first.end_ms + 9_000) / 1000;
    player.clamp();
    expect(media.ms).toBe(first.end_ms);
    const inside = first.start_ms + 500;
    media.currentTime = inside / 1000;
    const seeks = media.seeks.length;
    player.clamp();
    expect(media.seeks.length).toBe(seeks); // inside: left alone
    media.currentTime = (first.end_ms + SEEK_SLACK_MS - 1) / 1000; // within the slack of a browser's rounding
    player.clamp();
    expect(media.ms).toBe(first.end_ms + SEEK_SLACK_MS - 1);
  });

  it("leaves the range for the whole recording when asked to go to a time outside it", () => {
    const { media, events, player } = setup();
    player.select(first);
    expect(player.seekTo(first.start_ms + 1_000)).toBe(false); // inside: the range stays
    expect(player.range).toEqual(first);
    expect(player.seekTo(second.start_ms)).toBe(true);
    expect(player.range).toBeNull();
    expect(media.ms).toBe(second.start_ms);
    expect(events).toEqual([{ type: "left_range" }]);
  });

  it("reports a refused seek instead of throwing", () => {
    const events: RangePlayerEvent[] = [];
    const media: MediaLike = { paused: true, duration: 60, play: () => undefined, pause: () => undefined,
      get currentTime() { return 0; }, set currentTime(_value: number) { throw new Error("not seekable"); } };
    const player = new RangePlayer(() => media, (event) => events.push(event));
    expect(() => player.select(first)).not.toThrow();
    expect(events[0]?.type).toBe("error");
  });
});

describe("play and pause", () => {
  it("toggles, and reports a refused start instead of throwing", async () => {
    const { media, events, player } = setup();
    player.select(first);
    await player.toggle();
    expect(media.paused).toBe(false);
    await player.toggle();
    expect(media.paused).toBe(true);
    media.play = () => Promise.reject(new Error("NotAllowedError"));
    await player.toggle();
    expect(events).toEqual([{ type: "error", message: "Playback did not start: NotAllowedError" }]);
  });

  it("does nothing without a media element", async () => {
    const player = new RangePlayer(() => null);
    player.select(first);
    await player.toggle();
    player.seek(5);
    expect(player.tick()).toBe("play");
    expect(player.currentMs()).toBe(first.start_ms); // the pending position
    expect(player.isPlaying()).toBe(false);
  });
});
