// The ONE transport bar, its range list and the docked strip (web/src/features/lecture/Transport.tsx, RangeList.tsx,
// DockedTransport.tsx; design specification 5.5, 5.6, 4.4, 9.4, 9.5): what each state says and offers. Rendered in
// jsdom with the synthetic sample of web/src/lib/fixtures/r2-sample.ts; the media element is a LABELED DOUBLE (jsdom
// plays nothing: `play` and `pause` are stubbed). Real playback is checked in a browser (.local/preview/l2/range-check.mjs).
import { createRef, type ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DockedTransport } from "@/features/lecture/DockedTransport";
import { CANDIDATE_WORDS, RangeList, candidateId, qualityLine, rangeKindParts, rangeKindWords } from "@/features/lecture/RangeList";
import { Transport, barLayout, noRangeLine, playLabel, processedShare, rangesFromLinks, scrubberValueText, shareLabel, spokenTime, trackSegments } from "@/features/lecture/Transport";
import { WHOLE_RECORDING, type LecturePlayerHandle } from "@/features/lecture/contracts";
import {
  sampleLectureView, sampleLectureViewWithoutR2, sampleNoRange, sampleRangeBuildGroup, sampleRangeConfirmed, sampleRangeFirstVisit, sampleRangeManual, sampleRangeSecondVisit, sampleRangeSection,
} from "@/lib/fixtures/r2-sample";
import { NBSP } from "@/lib/labels";
import type { LectureView, NoRange, Occurrence, TimingRange } from "@/lib/types";

const text = (element: Element | null): string => (element?.textContent ?? "").split(NBSP).join(" ").replace(/\s+/g, " ").trim();
const recordings = sampleLectureView.recordings;
const DURATION = recordings[0]!.duration_ms!;

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function play(this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", { configurable: true, value: false });
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function pause(this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", { configurable: true, value: true });
  });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

// ---- pure parts ------------------------------------------------------------------------------------------------------------
describe("what the bar keeps at a width", () => {
  it("drops things in the order of the specification, and never the range's times or the disclosure", () => {
    expect(barLayout(919)).toEqual({ applies: true, method: true, volume: true, wholeToggle: true, hints: true, speed: true, stacked: false });
    expect(barLayout(759)).toMatchObject({ applies: false, method: true, wholeToggle: true, stacked: false });
    expect(barLayout(639)).toMatchObject({ applies: false, method: false, volume: false, wholeToggle: true });
    expect(barLayout(559)).toMatchObject({ wholeToggle: false, hints: false, speed: true, stacked: false });
    expect(barLayout(479)).toMatchObject({ speed: false, stacked: true });
    expect(barLayout(366).stacked).toBe(true);
  });
  it("takes a bar that was not measured for a wide one", () => {
    expect(barLayout(null)).toMatchObject({ applies: true, stacked: false });
    expect(barLayout(0)).toMatchObject({ applies: true, stacked: false });
  });
});

describe("times as they are read out", () => {
  it("says a time in hours, minutes and seconds", () => {
    expect(spokenTime(1_104_000)).toBe("18 minutes 24 seconds");
    expect(spokenTime(4_800_000)).toBe("1 hour 20 minutes");
    expect(spokenTime(61_000)).toBe("1 minute 1 second");
    expect(spokenTime(0)).toBe("0 seconds");
    expect(spokenTime(Number.NaN)).toBe("0 seconds");
  });
  it("words the track's value by what the track spans", () => {
    expect(scrubberValueText(1_104_000, sampleRangeFirstVisit, DURATION)).toBe("18 minutes 24 seconds, in the range 17:52 to 20:36");
    expect(scrubberValueText(1_104_000, null, DURATION)).toBe("18 minutes 24 seconds of 1 hour 20 minutes");
    expect(scrubberValueText(5_000, null, null)).toBe("5 seconds");
  });
  it("names the play disc by what a press does", () => {
    expect(playLabel(true, sampleRangeFirstVisit)).toBe("Pause");
    expect(playLabel(false, sampleRangeFirstVisit)).toBe("Play the range 17:52 to 20:36");
    expect(playLabel(false, null)).toBe("Play the whole recording");
  });
});

describe("segments above the track", () => {
  it("places each range of the page by its share of the recording", () => {
    const segments = trackSegments([sampleRangeFirstVisit, sampleRangeSecondVisit], recordings[0]!.source_id, DURATION);
    expect(segments.map((segment) => segment.id)).toEqual([sampleRangeFirstVisit.range_id, sampleRangeSecondVisit.range_id]);
    expect(segments[0]!.left).toBeCloseTo((1_072_000 / DURATION) * 100, 6);
    expect(segments[0]!.width).toBeCloseTo((164_000 / DURATION) * 100, 6);
    expect(segments[1]!.left).toBeGreaterThan(segments[0]!.left + segments[0]!.width); // separate visits stay separate: nothing is drawn between them
  });
  it("draws nothing for another recording, or without a length", () => {
    expect(trackSegments([sampleRangeFirstVisit], "another-recording", DURATION)).toEqual([]);
    expect(trackSegments([sampleRangeFirstVisit], recordings[0]!.source_id, null)).toEqual([]);
  });
  it("keeps a range inside the track when it runs past the end of the recording", () => {
    const [segment] = trackSegments([{ ...sampleRangeFirstVisit, end_ms: DURATION + 60_000 }], null, DURATION);
    expect(segment!.left + segment!.width).toBeCloseTo(100, 6);
  });
});

describe("the one line of a page without a range", () => {
  it("has a name, a sentence and at most one action for each of the six states", () => {
    const lines = Object.fromEntries((Object.keys(sampleNoRange) as Array<keyof typeof sampleNoRange>).map((state) => [state, noRangeLine(sampleNoRange[state], recordings)]));
    expect(lines.not_discussed).toMatchObject({ name: "Not discussed (searched)", action: "open_whole_recording" });
    expect(lines.association_not_run).toMatchObject({ name: "Not matched yet", action: "open_whole_recording" });
    expect(lines.ambiguous).toMatchObject({ name: "Ambiguous", action: "show_candidates" });
    expect(lines.recording_unavailable).toMatchObject({ name: "Recording unavailable", action: null });
    expect(lines.no_range_expected).toMatchObject({ name: "Structural page", action: "next_content" });
    for (const state of Object.keys(sampleNoRange) as Array<keyof typeof sampleNoRange>) expect(lines[state]!.sentence).toBe(sampleNoRange[state].text); // the Brain's sentence, verbatim
    expect(new Set(Object.values(lines).map((line) => line!.name)).size).toBe(6); // the same name never serves two states
  });

  it("says how much was processed when talk was looked for in a processed part only", () => {
    // 0:00 – 40:00 of a recording of 1 h 20 min
    expect(processedShare(sampleNoRange.audio_unprocessed, recordings)).toBeCloseTo(0.5, 6);
    expect(text({ textContent: noRangeLine(sampleNoRange.audio_unprocessed, recordings).name } as Element)).toBe("Not found in the processed part of the recording (50.0 %)");
    const almost: NoRange = { state: "audio_unprocessed", text: "Timing covers 1:19:46 of the recording's 1:20:00; nothing was found for this page in that part.",
      detail: { processed: [[recordings[0]!.source_id, 0, 2_000_000], [recordings[0]!.source_id, 2_014_400, DURATION]], reason: "partly_processed" } };
    expect(text({ textContent: noRangeLine(almost, recordings).name } as Element)).toBe("Not found in the processed part of the recording (99.7 %)");
    expect(text({ textContent: noRangeLine(almost, recordings).brief } as Element)).toBe("Not found in 99.7 %"); // a phone-wide bar still says how much
    expect(noRangeLine(almost, recordings).action).toBe("open_whole_recording");
  });

  it("keeps the contract's name while nothing of the recording has timing", () => {
    const none: NoRange = { state: "audio_unprocessed", text: "The recording has not been processed yet.", detail: { processed: [], reason: "no_generated_timing" } };
    expect(noRangeLine(none, recordings)).toEqual({ name: "Audio not processed yet", brief: "Audio not processed yet", sentence: "The recording has not been processed yet.", action: "open_whole_recording" });
  });

  it("states no share that it cannot work out", () => {
    const unknownLength: NoRange = { state: "audio_unprocessed", text: "Only part has timing.", detail: { processed: [["some-other-recording", 0, 60_000]], reason: "partly_processed" } };
    expect(processedShare(unknownLength, recordings)).toBeNull();
    expect(noRangeLine(unknownLength, recordings).name).toBe("Not found in the processed part of the recording");
    const stated: NoRange = { state: "audio_unprocessed", text: "Only part has timing.", detail: { processed: [["some-other-recording", 0, 60_000]], reason: "partly_processed",
      coverage: [{ recording_source_id: "some-other-recording", coverage_fraction: 0.25, covers_whole_recording: false, unresolved_ms: 0, lines_aligned: null, lines_total: null }] } };
    expect(processedShare(stated, recordings)).toBe(0.25);
    expect(processedShare(sampleNoRange.not_discussed, recordings)).toBeNull();
  });

  it("never writes a share under the whole as 100, nor one above nothing as 0", () => {
    expect(text({ textContent: shareLabel(0.9997) } as Element)).toBe("99.9 %");
    expect(text({ textContent: shareLabel(0.99999) } as Element)).toBe("99.9 %");
    expect(text({ textContent: shareLabel(1) } as Element)).toBe("100 %");
    expect(text({ textContent: shareLabel(0.00001) } as Element)).toBe("0.1 %");
    expect(text({ textContent: shareLabel(0) } as Element)).toBe("0.0 %");
    expect(text({ textContent: shareLabel(0.9466666) } as Element)).toBe("94.7 %");
  });

  it("shows a state this build has no words for as recorded, with its sentence and no action", () => {
    const later = { state: "held_for_review", text: "A later Brain says this.", detail: {} } as unknown as NoRange;
    expect(noRangeLine(later, recordings)).toEqual({ name: "Held for review", brief: "Held for review", sentence: "A later Brain says this.", action: null });
  });
});

describe("what a range is, in words", () => {
  it("words the kinds as the specification does, a suggestion always with its method", () => {
    expect(rangeKindWords(sampleRangeFirstVisit)).toBe("Suggestion (wording match)");
    expect(rangeKindWords(sampleRangeSection)).toBe("Suggestion (course study map)");
    expect(rangeKindWords(sampleRangeSecondVisit)).toBe("Checked");
    expect(rangeKindWords(sampleRangeConfirmed)).toBe("Marked by you");
    expect(rangeKindWords(sampleRangeManual)).toBe("Marked by you");
    expect(rangeKindParts(sampleRangeFirstVisit)).toEqual({ label: "Suggestion", method: "wording match" });
    expect(rangeKindParts({ ...sampleRangeFirstVisit, method: { name: "frame-inspection", version: "1" } }).method).toBe("frame-inspection"); // a method without words is shown as it is
  });
  it("never words a suggestion as confirmed, nor a second pass as the learner's", () => {
    for (const range of [sampleRangeFirstVisit, sampleRangeSection, sampleRangeBuildGroup, sampleRangeSecondVisit]) expect(rangeKindWords(range)).not.toMatch(/marked|confirmed|reviewed/i);
  });
  it("gives each quality its own sentence and the Brain's basis verbatim", () => {
    expect(qualityLine(sampleRangeFirstVisit.quality.acoustic)).toBe("Generated on this PC from the audio. Not reviewed. Word times of generated speech text; nobody has listened to them.");
    expect(qualityLine(sampleRangeFirstVisit.quality.association)).toBe("Candidate. Shared wording and the order of the slides.");
    expect(qualityLine({ state: "human_entered", basis: "Times as entered or confirmed by a person." })).toBe("Human entered. Times as entered or confirmed by a person."); // a state without words: as recorded
    expect(qualityLine(undefined)).toBe("Not stated.");
  });
});

describe("timed links of a view without ranges (an older Brain)", () => {
  const link = (id: string, state: Occurrence["review_state"], start: number, end: number): Occurrence => ({
    annotation_id: id, revision: 1, review_state: state, basis: state === "confirmed" ? "manual_review" : "transcript_only", relation: "displayed_during",
    source: { source_id: recordings[0]!.source_id, version_id: "v1", sha256: "e".repeat(64), locator: { kind: "media", start_ms: start, end_ms: end } }, start_ms: start, end_ms: end,
  } as unknown as Occurrence);
  it("are shown as ranges, with nothing added and nothing rejected", () => {
    const ranges = rangesFromLinks([link("a", "confirmed", 15_000, 30_000), link("b", "suggested", 55_000, 60_000), link("c", "rejected", 1_000, 2_000), link("d", "suggested", 9_000, 9_000)], 2);
    expect(ranges.map((range) => range.range_id)).toEqual(["a", "b"]);
    expect(ranges[0]).toMatchObject({ start_ms: 15_000, end_ms: 30_000, relation: "displayed_during", occurrence_index: 1, occurrences_total: 2, support: { scope: "page", pages: [2] }, annotation_id: "a" });
    expect(rangeKindWords(ranges[0]!)).toBe("Marked by you");
    expect(rangeKindWords(ranges[1]!)).toBe("Suggestion (transcript only)");
    expect(qualityLine(ranges[1]!.quality.acoustic)).toBe("Not stated.");
  });
});

// ---- the bar ---------------------------------------------------------------------------------------------------------------
interface Probe { selected: string[]; times: Array<[number, boolean]>; said: string[]; next: number; added: Array<number | undefined>; edited: Occurrence[]; player: { current: LecturePlayerHandle | null } }
function bar(view: LectureView, page: number, selection: string, extra: { canMark?: boolean } = {}): { probe: Probe; element: ReactElement } {
  const probe: Probe = { selected: [], times: [], said: [], next: 0, added: [], edited: [], player: createRef<LecturePlayerHandle | null>() as { current: LecturePlayerHandle | null } };
  const element = (
    <MemoryRouter>
      <Transport lecture={view} page={page} slide={view.slides.find((slide) => slide.page === page)} selection={selection} onSelect={(next) => probe.selected.push(next)} playerRef={probe.player}
        onTime={(ms, playing) => probe.times.push([ms, playing])} announce={(message) => probe.said.push(message)} onNextContent={() => { probe.next += 1; }}
        onAddMatch={extra.canMark === false ? undefined : (start) => probe.added.push(start)} onEditMatch={(link) => probe.edited.push(link)} />
    </MemoryRouter>
  );
  return { probe, element };
}
const line = () => screen.queryByTestId("range-line") ?? screen.getByTestId("no-range-line");

describe("the transport bar with a range selected", () => {
  it("says which range of how many, its times, what it is and where it applies", () => {
    const { element } = bar(sampleLectureView, 2, sampleRangeFirstVisit.range_id);
    render(element);
    expect(text(screen.getByTestId("range-line"))).toContain("Range 2 of 3");
    expect(text(screen.getByTestId("range-times"))).toBe("17:52 – 20:36");
    expect(text(screen.getByTestId("range-line"))).toContain("Suggestion (wording match)");
    expect(text(screen.getByTestId("range-line"))).toContain("this page");
    expect(screen.getByRole("button", { name: "Whole recording" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("range-list-toggle")).toHaveTextContent(/All\s3\sranges/);
    expect(screen.getByTestId("transport")).toHaveAttribute("data-mode", "range");
  });

  it("has one play control, named for what it plays, and one media element", () => {
    const { element } = bar(sampleLectureView, 2, sampleRangeFirstVisit.range_id);
    const { container } = render(element);
    expect(screen.getAllByTestId("play-toggle")).toHaveLength(1);
    expect(screen.getByTestId("play-toggle")).toHaveAccessibleName("Play the range 17:52 to 20:36");
    expect(container.ownerDocument.querySelectorAll("audio, video")).toHaveLength(1);
    expect(container.ownerDocument.querySelectorAll("media-controller")).toHaveLength(1);
    expect(screen.getByRole("slider", { name: "Position in the selected range" })).toHaveAttribute("aria-valuetext", "17 minutes 52 seconds, in the range 17:52 to 20:36");
    expect(text(screen.getByTestId("time-readout"))).toBe("17:52 / 20:36"); // the position and the end of what the track spans
  });

  it("steps to the neighbouring ranges and reports the choice; the ends are disabled", () => {
    const first = bar(sampleLectureView, 2, sampleRangeSection.range_id);
    const view = render(first.element);
    expect(screen.getByRole("button", { name: "Previous range" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next range" }));
    expect(first.probe.selected).toEqual([sampleRangeFirstVisit.range_id]);
    view.unmount();
    const last = bar(sampleLectureView, 2, sampleRangeSecondVisit.range_id);
    render(last.element);
    expect(screen.getByRole("button", { name: "Next range" })).toBeDisabled();
    expect(text(screen.getByTestId("range-line"))).toContain("Checked");
  });

  it("has no stepper for a page with one range, and names the disclosure for it", () => {
    const { element } = bar(sampleLectureView, 7, sampleRangeConfirmed.range_id);
    render(element);
    expect(screen.queryByTestId("range-stepper")).toBeNull();
    expect(screen.getByTestId("range-list-toggle")).toHaveTextContent("Range details");
    expect(text(screen.getByTestId("range-line"))).toContain("Marked by you");
  });

  it("words a section the course's study map states as that, for pages and never for slide numbers", () => {
    const { element } = bar(sampleLectureView, 3, sampleRangeSection.range_id);
    render(element);
    expect(text(screen.getByTestId("range-line"))).toContain("Suggestion (course study map)");
    expect(text(screen.getByTestId("range-line"))).toContain("a section of the lecture, pp. 2–5");
  });

  it("says that a range over a structural page is discussion of the topic", () => {
    const { element } = bar(sampleLectureView, 12, sampleRangeManual.range_id);
    render(element);
    expect(text(screen.getByTestId("range-line"))).toContain("Discussion of the topic. Not evidence of what was displayed.");
    expect(screen.queryByTestId("no-range-line")).toBeNull(); // the structural line is not shown when a range exists
  });

  it("offers the whole recording as an explicit choice", () => {
    const { probe, element } = bar(sampleLectureView, 2, sampleRangeFirstVisit.range_id);
    render(element);
    fireEvent.click(screen.getByRole("button", { name: "Whole recording" }));
    expect(probe.selected).toEqual([WHOLE_RECORDING]);
  });

  it("in the whole recording shows the page's ranges as segments, disables Repeat and returns to the range on request", () => {
    const { probe, element } = bar(sampleLectureView, 2, WHOLE_RECORDING);
    render(element);
    expect(screen.getByTestId("transport")).toHaveAttribute("data-mode", "whole");
    expect(text(screen.getByTestId("range-line"))).toContain("Whole recording");
    expect(screen.getByTestId("track-segments").querySelectorAll("i")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Repeat this range" })).toBeDisabled();
    expect(screen.getByRole("slider", { name: "Position in the whole recording" })).toBeInTheDocument();
    expect(screen.getByTestId("play-toggle")).toHaveAccessibleName("Play the whole recording");
    fireEvent.click(screen.getByRole("button", { name: "Whole recording" }));
    expect(probe.selected).toEqual([sampleRangeFirstVisit.range_id]); // back to the page's own first range
  });

  it("turns Repeat on and says so in the line", () => {
    const { element } = bar(sampleLectureView, 2, sampleRangeFirstVisit.range_id);
    render(element);
    const repeat = screen.getByRole("button", { name: "Repeat this range" });
    expect(repeat).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(repeat);
    expect(repeat).toHaveAttribute("aria-pressed", "true");
    expect(text(screen.getByTestId("range-line"))).toContain("Repeats this range until you turn it off");
  });

  it("gives the workspace one player handle; a jump outside the range leaves it for the whole recording", () => {
    const { probe, element } = bar(sampleLectureView, 2, sampleRangeFirstVisit.range_id);
    render(element);
    const player = probe.player.current!;
    expect(player.recording()?.source_id).toBe(recordings[0]!.source_id);
    expect(player.durationMs()).toBe(DURATION);
    expect(player.isPlaying()).toBe(false);
    expect(player.currentMs()).toBe(sampleRangeFirstVisit.start_ms); // cued at the start of the range, paused
    player.seekTo(sampleRangeFirstVisit.start_ms + 5_000);
    expect(probe.selected).toEqual([]);
    player.seekTo(sampleRangeSecondVisit.start_ms);
    expect(probe.selected).toEqual([WHOLE_RECORDING]);
  });

  it("keeps the names of the two seek buttons for assistive technology", () => {
    const { element } = bar(sampleLectureView, 2, sampleRangeFirstVisit.range_id);
    const { container } = render(element);
    const back = container.querySelector("media-seek-backward-button")!;
    const forward = container.querySelector("media-seek-forward-button")!;
    expect(document.getElementById(back.getAttribute("aria-labelledby")!)).toHaveTextContent("Back 10 seconds");
    expect(document.getElementById(forward.getAttribute("aria-labelledby")!)).toHaveTextContent("Forward 10 seconds");
    expect(back.getAttribute("seekoffset")).toBe("10");
  });
});

describe("the transport bar on a page without a range", () => {
  it("shows the one line of the state and one action; nothing can be played until the whole recording is opened", () => {
    const { element } = bar(sampleLectureView, 8, WHOLE_RECORDING);
    render(element);
    const noRange = screen.getByTestId("no-range-line");
    expect(noRange).toHaveAttribute("data-state", "not_discussed");
    expect(text(noRange)).toContain("Not discussed (searched)");
    expect(text(noRange)).toContain("The whole recording was processed and matched; nothing was found for this page.");
    expect(within(noRange).getAllByRole("button").filter((button) => !button.getAttribute("aria-label")?.startsWith("Read in full"))).toHaveLength(1);
    expect(screen.getByTestId("play-toggle")).toBeDisabled();
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.getByRole("button", { name: "Repeat this range" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Open whole recording" }));
    expect(screen.getByTestId("play-toggle")).toBeEnabled();
    expect(screen.getByTestId("play-toggle")).toHaveAccessibleName("Play the whole recording");
    expect(screen.getByRole("slider", { name: "Position in the whole recording" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Whole recording" })).toHaveAttribute("aria-pressed", "true");
    expect(text(screen.getByTestId("no-range-line"))).toContain("Not discussed (searched)"); // the reason stays
  });

  it("says how much of the recording was processed when nothing was found in that part", () => {
    const { element } = bar(sampleLectureView, 9, WHOLE_RECORDING);
    render(element);
    expect(screen.getByTestId("no-range-line")).toHaveAttribute("data-state", "audio_unprocessed");
    expect(text(screen.getByTestId("no-range-line"))).toContain("Not found in the processed part of the recording (50.0 %)");
    expect(screen.getByRole("button", { name: "Open whole recording" })).toBeInTheDocument();
  });

  it("offers Next content on a structural page, and Show candidates on an ambiguous one", () => {
    const structural = bar(sampleLectureView, 1, WHOLE_RECORDING);
    const first = render(structural.element);
    expect(text(screen.getByTestId("no-range-line"))).toContain("Structural page");
    fireEvent.click(screen.getByRole("button", { name: "Next content" }));
    expect(structural.probe.next).toBe(1);
    expect(screen.queryByRole("button", { name: "Open whole recording" })).toBeNull();
    first.unmount();
    render(bar(sampleLectureView, 6, WHOLE_RECORDING).element);
    expect(text(screen.getByTestId("no-range-line"))).toContain("Ambiguous");
    expect(screen.getByRole("button", { name: "Show candidates" })).toBeInTheDocument();
  });

  it("draws no control when the recording is unavailable: the name and the sentence only", () => {
    const { element } = bar(sampleLectureView, 11, WHOLE_RECORDING);
    render(element);
    expect(screen.getByTestId("transport")).toHaveAttribute("data-mode", "unavailable");
    expect(text(screen.getByTestId("no-range-line"))).toBe("Recording unavailable The recording of this lecture cannot be read.");
    expect(screen.queryByTestId("play-toggle")).toBeNull();
    expect(within(screen.getByTestId("transport")).queryAllByRole("button")).toHaveLength(0);
  });

  it("says so, with no control, for a lecture without a recording", () => {
    const view: LectureView = { ...sampleLectureView, recordings: [] };
    render(bar(view, 2, sampleRangeFirstVisit.range_id).element);
    expect(screen.getByTestId("transport")).toHaveAttribute("data-mode", "unavailable");
    expect(document.querySelectorAll("audio, video")).toHaveLength(0);
  });

  it("opens the whole recording when the workspace asks the idle player to play or to go to a time", () => {
    const { probe, element } = bar(sampleLectureView, 8, WHOLE_RECORDING);
    render(element);
    expect(screen.getByTestId("play-toggle")).toBeDisabled();
    act(() => probe.player.current!.seekTo(90_000));
    expect(screen.getByTestId("play-toggle")).toBeEnabled();
  });
});

describe("the transport bar without range data (an older Brain)", () => {
  it("renders, invents no range and plays the whole recording as before", () => {
    const { element } = bar(sampleLectureViewWithoutR2, 2, WHOLE_RECORDING);
    render(element);
    expect(text(line())).toContain("No recording range");
    expect(screen.queryByTestId("range-stepper")).toBeNull();
    expect(screen.getByTestId("play-toggle")).toBeEnabled();
    expect(screen.getByTestId("play-toggle")).toHaveAccessibleName("Play the whole recording");
  });
});

// ---- the range list --------------------------------------------------------------------------------------------------------
function list(ranges: TimingRange[], selection: string, extra: Partial<Parameters<typeof RangeList>[0]> = {}) {
  const chosen: string[] = [];
  const corrected: TimingRange[] = [];
  const anchor = { current: document.body };
  const view = render(
    <MemoryRouter>
      <RangeList pages={[3, 4, 5]} ranges={ranges} selection={selection} onSelect={(next) => chosen.push(next)} open onOpenChange={() => undefined} trigger={<button type="button">All ranges</button>} anchor={anchor}
        recordings={recordings} groupKind="build" onMarkRange={() => chosen.push("mark")} onCorrectRange={(range) => corrected.push(range)} {...extra} />
    </MemoryRouter>,
  );
  return { chosen, corrected, view };
}

describe("the range list", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lists every range as a radio row: times, length, what it is, the recording, where it applies and why", () => {
    list([sampleRangeSection, sampleRangeBuildGroup], sampleRangeBuildGroup.range_id);
    const dialog = screen.getByTestId("range-list");
    expect(text(dialog)).toContain("Where pages 3–5 are discussed");
    expect(text(dialog)).toContain("2 ranges. Each is a separate visit. Playing one stops at its end.");
    const rows = within(dialog).getAllByRole("radio");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveAttribute("aria-checked", "true");
    expect(text(rows[1]!)).toBe("20:36 – 26:205 min 44 sSuggestion (wording match)Lecture recording · all 3 builds · Follows the wording of the slide"); // five cells: times, length, kind, then the second line
    expect(text(rows[0]!)).toContain("Suggestion (course study map)");
    expect(text(rows[0]!)).toContain("a section of the lecture, pp. 2–5");
  });

  it("reports the row that is chosen, also when it is the chosen one again", () => {
    const { chosen } = list([sampleRangeSection, sampleRangeBuildGroup], sampleRangeBuildGroup.range_id);
    const rows = within(screen.getByTestId("range-list")).getAllByRole("radio");
    fireEvent.click(rows[0]!);
    fireEvent.click(rows[1]!);
    expect(chosen).toEqual([sampleRangeSection.range_id, sampleRangeBuildGroup.range_id]);
  });

  it("opens the three qualities on request, each on its own line, with the evidence and the correction", () => {
    const { corrected } = list([sampleRangeBuildGroup], sampleRangeBuildGroup.range_id);
    expect(screen.queryByTestId("range-qualities")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Qualities of the range/ }));
    const qualities = screen.getByTestId("range-qualities");
    const terms = within(qualities).getAllByRole("term").map((term) => text(term));
    expect(terms.slice(0, 3)).toEqual(["Timestamp quality (are the times of the words right)", "Association quality (is this talk about this slide)", "Group-mapping quality (is this page correctly grouped)"]);
    expect(text(qualities)).toContain("Made by the method lexical-sequence, version 2. Nobody has checked it.");
    expect(text(qualities)).toContain("It applies to the whole group, pp. 3–5; no time is given per build.");
    expect(within(qualities).getByRole("link", { name: /^transcript\slines\s165–228$/ })).toHaveAttribute("href", expect.stringContaining("panel=transcript&line=165"));
    expect(text(qualities)).toContain("Terms: sample, mechanism");
    expect(text(qualities)).not.toMatch(/confidence|%/i); // never one merged figure
    fireEvent.click(within(qualities).getByRole("button", { name: "Correct this range" }));
    expect(corrected).toEqual([sampleRangeBuildGroup]);
  });

  it("hands the lines of the evidence to the caller when it says how to open them", () => {
    const opened: Array<[number, number]> = [];
    list([sampleRangeBuildGroup], sampleRangeBuildGroup.range_id, { onOpenTranscriptLines: (start, end) => opened.push([start, end]) });
    fireEvent.click(screen.getByRole("button", { name: /^Qualities of the range/ }));
    fireEvent.click(screen.getByRole("button", { name: /^transcript\slines\s165–228$/ }));
    expect(opened).toEqual([[165, 228]]);
  });

  it("lists the candidates of an ambiguous page as candidates, never as ranges", () => {
    const candidates = (sampleNoRange.ambiguous.detail as { candidates: Parameters<typeof candidateId>[0][] }).candidates;
    const { chosen } = list([], WHOLE_RECORDING, { pages: [6], candidates: candidates as never });
    const dialog = screen.getByTestId("range-list");
    expect(text(dialog)).toContain("Candidates for page 6");
    const rows = within(dialog).getAllByRole("radio");
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(text(row)).toContain(CANDIDATE_WORDS);
    expect(text(rows[0]!)).toContain("28:20 – 29:20");
    expect(text(rows[0]!)).toContain("Another slide fits this stretch about as well");
    expect(within(dialog).queryByRole("button", { name: /Qualities/ })).toBeNull();
    fireEvent.click(rows[1]!);
    expect(chosen).toEqual([candidateId(candidates[1]!)]);
  });

  it("offers marking a range yourself at its foot", () => {
    const { chosen } = list([sampleRangeBuildGroup], sampleRangeBuildGroup.range_id);
    fireEvent.click(screen.getByRole("button", { name: "Mark a range yourself" }));
    expect(chosen).toEqual(["mark"]);
  });
});

// ---- the docked strip ------------------------------------------------------------------------------------------------------
describe("the docked strip", () => {
  it("plays and pauses in place with its disc, and opens the Slide pane with the rest", () => {
    const pressed: string[] = [];
    render(<DockedTransport position={{ ms: 1_104_000, playing: false }} range={sampleRangeFirstVisit} available onToggle={() => pressed.push("toggle")} onOpenSlide={() => pressed.push("open")} page={2} />);
    const dock = screen.getByTestId("dock");
    expect(text(dock)).toBe("17:52 – 20:36Suggestion for page 218:24");
    fireEvent.click(screen.getByRole("button", { name: "Play the range 17:52 to 20:36" }));
    fireEvent.click(screen.getByRole("button", { name: "Paused at 18:24 in the range 17:52 to 20:36. Open the Slide pane." }));
    expect(pressed).toEqual(["toggle", "open"]);
  });

  it("names the whole recording, says why there is no range, and says Pause while playing", () => {
    render(<DockedTransport position={{ ms: 65_000, playing: true }} range={null} available onToggle={() => undefined} onOpenSlide={() => undefined} page={8} note="Not discussed (searched)" durationMs={DURATION} />);
    expect(text(screen.getByTestId("dock"))).toBe("Whole recordingNot discussed (searched)1:05");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Playing at 1:05 in the whole recording. Open the Slide pane." })).toBeInTheDocument();
  });

  it("has no control when the lecture has no recording", () => {
    render(<DockedTransport position={{ ms: 0, playing: false }} range={null} available={false} onToggle={() => undefined} onOpenSlide={() => undefined} />);
    expect(screen.getByTestId("dock")).toHaveTextContent("No recording is linked to this lecture.");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
