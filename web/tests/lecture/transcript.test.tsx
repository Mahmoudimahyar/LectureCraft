// The Transcript tab (web/src/features/lecture/TranscriptPanel.tsx; design specification 5.11, 9.10): the course
// transcript and the generated speech text are two labelled things; a line shows a time only where the Brain says it
// has one; the lines of the selected range are marked; search and quoting stay. Rendered in jsdom with synthetic data.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  GeneratedTextPanel, TranscriptPanel, generatedCoverageLine, generatedRows, lineTimeIndex, linesAt, linesOfRange, rowOfLine, speakerTag, timeBasisWords, transcriptClosingLine, transcriptRows,
  type TimedTranscript,
} from "@/features/lecture/TranscriptPanel";
import type { SourceRef } from "@/lib/db";
import { sampleLectureTiming, sampleLectureView, sampleRangeFirstVisit, sampleRangeSecondVisit } from "@/lib/fixtures/r2-sample";
import { NBSP } from "@/lib/labels";
import type { GeneratedText, LectureTiming, RecordingView, TimingRange, TranscriptRange } from "@/lib/types";

const text = (element: Element | null): string => (element?.textContent ?? "").split(NBSP).join(" ").replace(/\s+/g, " ").trim();
const REC = sampleLectureView.recordings[0]!.source_id;
const START = sampleRangeFirstVisit.start_ms; // 17:52
const aligned = (line: number, at: number) => ({ line, start_ms: START + at * 20_000, end_ms: START + (at + 1) * 20_000, recording_source_id: REC, review_state: "generated", method: { name: "anchored-token-alignment", version: "2" } });
/** Twelve synthetic lines; text alignment timed lines 3, 4, 5, 6, 8 and 9 (17:52, 18:12, …), the rest have no time. */
const transcript: TimedTranscript = {
  source_id: "src-sample-transcript-90", version_id: "v1-ffffffffffff", sha256: "f".repeat(64), filename: "sample-transcript-90.txt", session_id: "session-90",
  lines: Array.from({ length: 12 }, (_, index) => `Synthetic transcript line ${index + 1}${index === 6 ? " with the word promoter" : ""}.`), timing: "untimed", timing_note: null, line_times: [],
  generated_line_times: [aligned(3, 0), aligned(4, 1), aligned(5, 2), aligned(6, 3), aligned(8, 4), aligned(9, 5)],
  text_alignment: [{ recording_source_id: REC, state: "accepted", reason: null, lines_aligned: 6, lines_total: 12, method: { name: "anchored-token-alignment", version: "2" } }],
};
const linkTime = (id: string, state: string, start: number, end: number, startMs: number, endMs: number) => ({ annotation_id: id, review_state: state, start, end, start_ms: startMs, end_ms: endMs, recording_source_id: REC });
/** The same lines with two linked stretches instead (an R1 view): lines 1–4 reviewed, lines 5–8 suggested. */
const linked: TimedTranscript = { ...transcript, generated_line_times: undefined, text_alignment: undefined, timing: "annotated",
  line_times: [linkTime("a", "confirmed", 1, 4, 0, 15_000), linkTime("b", "suggested", 5, 8, 15_000, 30_000)] };
const range = (extra: Partial<TimingRange> = {}): TimingRange => ({ ...sampleRangeFirstVisit, evidence: { transcript_lines: [[3, 6]] }, ...extra });

/**
 * A transcript as a speech-to-text export writes one (synthetic): a heading, then for every turn a line that is only a
 * speaker tag, the talk, and a blank line. Lines 4, 7, 10 and 13 are talk; text alignment timed 4, 7 and 13.
 */
const tagged: TimedTranscript = {
  ...transcript, source_id: "src-sample-transcript-91", filename: "sample-transcript-91.txt",
  lines: ["Synthetic recording, turn by turn.", "", "[Speaker 1]", "First synthetic turn about the promoter.", "", "[Speaker 1]", "Second synthetic turn.", "", "[Speaker 2]", "A synthetic question from the room.", "",
    "[Speaker 1]", "The synthetic answer.", "", "[Speaker 1]"],
  generated_line_times: [aligned(4, 0), aligned(7, 1), aligned(13, 2)],
  text_alignment: [{ recording_source_id: REC, state: "accepted", reason: null, lines_aligned: 3, lines_total: 5, method: { name: "anchored-token-alignment", version: "2" } }],
};

// ---- pure parts ------------------------------------------------------------------------------------------------------------
describe("the rows of a transcript: speech only", () => {
  it("knows a line that is only a speaker tag from a line of talk", () => {
    expect(speakerTag("[Speaker 1]")).toBe("Speaker 1");
    expect(speakerTag("  [Speaker 12]  ")).toBe("Speaker 12");
    expect(speakerTag("Dr. Example:")).toBeNull(); // a full stop inside: not taken for a name
    expect(speakerTag("Sample Lecturer:")).toBe("Sample Lecturer");
    for (const talk of ["Okay.", "So: what is a promoter?", "[inaudible] and then it binds.", "A line of talk that ends with a colon after many words of it:", "", "[]", `[${"x".repeat(41)}]`]) expect(speakerTag(talk)).toBeNull();
  });

  it("folds a tag into the talk after it, draws no blank line, and renumbers nothing", () => {
    expect(transcriptRows(tagged.lines)).toEqual([
      { n: 1, first: 1, last: 1, speaker: null, text: "Synthetic recording, turn by turn." },
      { n: 4, first: 3, last: 4, speaker: "Speaker 1", text: "First synthetic turn about the promoter." },
      { n: 7, first: 6, last: 7, speaker: "Speaker 1", text: "Second synthetic turn." },
      { n: 10, first: 9, last: 10, speaker: "Speaker 2", text: "A synthetic question from the room." },
      { n: 13, first: 12, last: 13, speaker: "Speaker 1", text: "The synthetic answer." },
      { n: 15, first: 15, last: 15, speaker: null, text: "[Speaker 1]" }, // a tag with no talk after it stays, as written: no line with text goes unseen
    ]);
    expect(transcriptRows(transcript.lines).map((row) => [row.n, row.first, row.last])).toEqual(transcript.lines.map((_, index) => [index + 1, index + 1, index + 1])); // plain lines: one row each
    expect(transcriptRows(["[Speaker 1]", "[Speaker 2]", "Talk."]).map((row) => [row.n, row.speaker, row.text])).toEqual([[1, null, "[Speaker 1]"], [3, "Speaker 2", "Talk."]]);
    expect(transcriptRows([])).toEqual([]);
  });

  it("finds the row that stands for a line of the file: a tag's line, a blank line, a line of talk", () => {
    const rows = transcriptRows(tagged.lines);
    expect(rowOfLine(rows, 3)?.n).toBe(4); // the tag line
    expect(rowOfLine(rows, 4)?.n).toBe(4);
    expect(rowOfLine(rows, 5)?.n).toBe(7); // a blank line: the row after it
    expect(rowOfLine(rows, 16)).toBeNull();
  });
});

describe("which lines show a time", () => {
  it("only the lines the text alignment timed, each with its own time", () => {
    const index = lineTimeIndex(transcript);
    expect([...index.keys()].sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 8, 9]);
    expect(index.get(3)).toMatchObject({ ms: START, basis: "aligned", state: "generated", lines: [3, 3] });
    expect(index.has(7)).toBe(false); // alignment found no time for it: no time is made up from its neighbours
  });
  it("for a linked stretch, its first line only: the link gives the stretch one start, not one per line", () => {
    const index = lineTimeIndex(linked);
    expect([...index.keys()]).toEqual([1, 5]);
    expect(index.get(5)).toMatchObject({ ms: 15_000, endMs: 30_000, basis: "link", state: "suggested", lines: [5, 8] });
  });
  it("lets a reviewed link stand before an aligned time, and that before a suggested link", () => {
    const both: TimedTranscript = { ...transcript, line_times: [linkTime("a", "confirmed", 3, 4, 111_000, 120_000), linkTime("b", "suggested", 8, 9, 222_000, 230_000)] };
    const index = lineTimeIndex(both);
    expect(index.get(3)).toMatchObject({ ms: 111_000, basis: "link" });
    expect(index.get(8)).toMatchObject({ ms: START + 80_000, basis: "aligned" });
  });
  it("ignores a time that is not one, and a view without the fields", () => {
    expect(lineTimeIndex({ ...transcript, generated_line_times: [{ ...aligned(3, 0), end_ms: START }] }).size).toBe(0);
    expect(lineTimeIndex({ ...transcript, generated_line_times: undefined }).size).toBe(0);
    expect(lineTimeIndex(null).size).toBe(0);
  });
  it("names what kind of time it is", () => {
    expect(timeBasisWords({ basis: "aligned", state: "generated" })).toBe("generated timing, not reviewed");
    expect(timeBasisWords({ basis: "link", state: "confirmed" })).toBe("reviewed timing");
    expect(timeBasisWords({ basis: "link", state: "suggested" })).toBe("suggested timing");
  });
});

describe("the lines of a range", () => {
  it("are the transcript lines the range names as its evidence", () => {
    expect(linesOfRange(transcript, range())).toEqual([3, 4, 5, 6]);
    expect(linesOfRange(transcript, range({ evidence: { transcript_lines: [[11, 40]] } }))).toEqual([11, 12]); // never past the last line
  });
  it("otherwise the lines whose own time lies in the range", () => {
    expect(linesOfRange(transcript, range({ evidence: {} }))).toEqual([3, 4, 5, 6, 8, 9]); // 17:52 – 20:36 holds all six times
    expect(linesOfRange(transcript, range({ evidence: {}, end_ms: START + 60_000 }))).toEqual([3, 4, 5]);
    expect(linesOfRange(transcript, range({ evidence: { transcript_lines: [[3, 6]] } }), { evidenceApplies: false })).toEqual([3, 4, 5, 6, 8, 9]); // another transcript's line numbers are not applied
  });
  it("and the stretches a link ties to a part of the recording that overlaps it", () => {
    expect(linesOfRange(linked, { start_ms: 15_000, end_ms: 30_000, recording: sampleRangeFirstVisit.recording, evidence: {} })).toEqual([5, 6, 7, 8]);
    expect(linesOfRange(linked, { start_ms: 30_000, end_ms: 45_000, recording: sampleRangeFirstVisit.recording, evidence: {} })).toEqual([]); // touching is not overlapping
  });
  it("are none for the whole recording, for another recording's times, or without a transcript", () => {
    expect(linesOfRange(transcript, null)).toEqual([]);
    expect(linesOfRange(null, range())).toEqual([]);
    expect(linesOfRange(transcript, range({ evidence: {}, recording: { source_id: "another-recording", version_id: null, sha256: null } }))).toEqual([]);
  });
});

describe("the line being spoken", () => {
  it("is the line whose own time holds the position, or the linked stretch that does", () => {
    const index = lineTimeIndex(transcript);
    expect(linesAt(index, START + 25_000)).toEqual([4, 4]);
    expect(linesAt(index, START - 1)).toBeNull();
    expect(linesAt(lineTimeIndex(linked), 20_000)).toEqual([5, 8]);
    expect(linesAt(index, START + 25_000, "another-recording")).toBeNull();
  });
});

describe("the closing line of the course transcript", () => {
  it("says how many lines have a time and what those times are", () => {
    expect(text({ textContent: transcriptClosingLine(transcript, true) } as Element)).toBe("6 of 12 lines have a time. A line shows a time only where text alignment supports it; the times are generated and not reviewed.");
  });
  it("says why no line has one", () => {
    const refused: TimedTranscript = { ...transcript, generated_line_times: [], text_alignment: [{ recording_source_id: REC, state: "refused", reason: "too_few_anchors", lines_aligned: 0, lines_total: 12, method: null }] };
    expect(transcriptClosingLine(refused, true)).toBe("The generated text and this transcript do not correspond well enough, so no line has a time (too few anchors).");
    expect(transcriptClosingLine({ ...transcript, generated_line_times: [], text_alignment: [] }, true)).toBe("Times have not been worked out for this transcript.");
  });
  it("says how far linked stretches were reviewed, and that the time stands on the first line", () => {
    expect(text({ textContent: transcriptClosingLine(linked, false) } as Element)).toBe("2 stretches of lines are linked to a time in the recording (1 reviewed, 1 suggested and not reviewed); the time stands on the first line of each.");
  });
  it("says nothing for a view that states nothing about timing", () => {
    expect(transcriptClosingLine({ ...transcript, generated_line_times: undefined, text_alignment: undefined }, false)).toBeNull();
  });
});

describe("generated speech text", () => {
  it("lists what it covers and what was withheld while the stretches are few", () => {
    expect(text({ textContent: generatedCoverageLine({ covered_intervals: [[0, 90_000], [98_000, 150_000]], unresolved_intervals: [[90_000, 98_000]], unresolved_ms: 8_000 }) } as Element))
      .toBe("Covers 0:00 – 1:30 and 1:38 – 2:30 of the recording. Not resolved: 1:30 – 1:38.");
    expect(generatedCoverageLine(null)).toBe("No speech text has been generated for this recording.");
  });
  it("sums a recording with many stretches instead of listing them, and still says how much was withheld", () => {
    const covered: Array<[number, number]> = [[0, 600_000], [610_000, 1_200_000], [1_230_000, 1_800_000], [1_815_000, 2_400_000]];
    const gaps: Array<[number, number]> = [[600_000, 610_000], [1_200_000, 1_230_000], [1_800_000, 1_815_000]];
    expect(text({ textContent: generatedCoverageLine({ covered_intervals: covered, unresolved_intervals: gaps, unresolved_ms: 55_000 }) } as Element))
      .toBe("Covers 39 min 5 s of the recording in 4 stretches, between 0:00 and 40:00. Text is withheld for 55 s in 3 gaps; each is said in its place.");
  });
  it("puts each gap in its place among the text, never filled", () => {
    const rows = generatedRows({ segments: [{ start_ms: 0, end_ms: 4_000, text: "one" }, { start_ms: 98_000, end_ms: 101_000, text: "three" }, { start_ms: 4_000, end_ms: 9_000, text: "two" }] }, [[90_000, 98_000], { start_ms: 120_000, end_ms: 121_000 }, "broken"]);
    expect(rows.map((row) => (row.kind === "gap" ? `gap ${row.start_ms}` : row.text))).toEqual(["one", "two", "gap 90000", "three", "gap 120000"]);
    expect(generatedRows(null)).toEqual([]);
  });
});

// ---- the tab ---------------------------------------------------------------------------------------------------------------
interface Probe { seeks: number[]; quotes: Array<[SourceRef, string]>; errors: Array<[SourceRef, string]> }
const GENERATED: GeneratedText = { generation: "sp-sample90", created_at: "2026-10-06T03:00:00Z", window: { start_ms: 0, end_ms: 150_000 }, duration_ms: 150_000, coverage_fraction: 0.95, covers_whole_recording: false,
  text_origin: "generated_speech_text", review_state: "generated_unreviewed", note: "Synthetic.", producer: {}, segments: [{ start_ms: 0, end_ms: 4_000, text: "Generated stretch one." }, { start_ms: 98_000, end_ms: 104_000, text: "Generated stretch two." }], segments_total: 2 };
const recordings: RecordingView[] = [{ ...sampleLectureView.recordings[0]!, generated_text: GENERATED }];
const timing: LectureTiming = { ...sampleLectureTiming, recordings: [{ ...sampleLectureTiming.recordings[0]!, generated: { ...sampleLectureTiming.recordings[0]!.generated!, covered_intervals: [[0, 90_000], [98_000, 150_000]],
  unresolved_intervals: [[90_000, 98_000]], unresolved_ms: 8_000, covers_whole_recording: false } }] };
function tab(props: Partial<Parameters<typeof TranscriptPanel>[0]> = {}): Probe {
  const probe: Probe = { seeks: [], quotes: [], errors: [] };
  render(<TranscriptPanel transcripts={[transcript]} slideRanges={[]} positionMs={0} playing={false} onSeek={(ms) => probe.seeks.push(ms)} onQuote={(source, quoted) => probe.quotes.push([source, quoted])}
    onReportError={(source, quoted) => probe.errors.push([source, quoted])} range={range()} rangeOrdinal={{ index: 1, of: 2 }} recordings={recordings} timing={timing} {...props} />);
  return probe;
}
const row = (line: number): HTMLElement => document.querySelector<HTMLElement>(`[data-line="${line}"]`)!;

describe("the Transcript tab", () => {
  it("is two labelled sections: the course transcript open, the generated speech text closed", () => {
    tab();
    expect(screen.getByRole("button", { name: "Course transcript" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Generated speech text" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => text(heading))).toEqual(["Course transcript", "Generated speech text"]);
    expect(within(screen.getByTestId("course-transcript")).queryByText(/Generated stretch/)).toBeNull(); // never mixed
  });

  it("shows a time only on a line the Brain timed; the others have an empty gutter and are not links", () => {
    const probe = tab();
    expect(within(row(3)).getByRole("button", { name: "Go to 17:52 in the recording (generated timing, not reviewed)" })).toHaveTextContent("17:52");
    expect(within(row(7)).queryByRole("button", { name: /^Go to/ })).toBeNull();
    expect(text(row(7))).toBe("Synthetic transcript line 7 with the word promoter."); // no "line 7" is drawn in the gutter
    expect(within(row(7)).getByRole("button", { name: "Select line 7" })).toHaveAttribute("title", expect.stringMatching(/^Line 7\./)); // the number is on the quote button
    expect(screen.getAllByRole("button", { name: /^Go to .* in the recording/ })).toHaveLength(6);
    fireEvent.click(within(row(5)).getByRole("button", { name: /^Go to 18:32/ }));
    expect(probe.seeks).toEqual([START + 40_000]); // pressing a timed line seeks the one player
  });

  it("puts the lines of the selected range under one divider that says what the range is, and marks where it ends", () => {
    tab();
    const divider = screen.getByTestId("range-divider");
    expect(text(divider)).toBe("Suggestion (wording match)Range 1 of 2");
    expect(row(3)).toContainElement(divider); // before the first line of the range
    expect(row(6)).toContainElement(screen.getByTestId("after-range"));
    expect(text(screen.getByTestId("after-range"))).toBe("After this range");
    for (const line of [3, 4, 5, 6]) expect(row(line).querySelector("[class*='border-accent-text']")).not.toBeNull();
    for (const line of [2, 7, 8]) expect(row(line).querySelector("[class*='border-accent-text']")).toBeNull();
    expect(screen.getAllByTestId("range-divider")).toHaveLength(1); // the ranges are not listed again here
  });

  it("has no divider for the whole recording, and then marks the lines links tie to the slide", () => {
    const slideRanges = [{ source: { source_id: transcript.source_id }, start: 9, end: 10, review_state: "suggested" }] as unknown as TranscriptRange[];
    tab({ range: null, rangeOrdinal: null, slideRanges });
    expect(screen.queryByTestId("range-divider")).toBeNull();
    expect(row(9).querySelector("[class*='border-accent-text']")).not.toBeNull();
    expect(text(screen.getByTestId("slide-lines-note"))).toBe("Lines 9–10 are a suggested match for this slide: found by comparing words, not reviewed, and not a time in the recording.");
  });

  it("says when no lines are linked to the slide, and words a checked range as checked", () => {
    tab({ range: { ...sampleRangeSecondVisit, evidence: { transcript_lines: [[8, 9]] } }, rangeOrdinal: { index: 2, of: 2 } });
    expect(text(screen.getByTestId("slide-lines-note"))).toBe("No transcript lines are linked to this slide. Nothing is inferred for it.");
    expect(text(screen.getByTestId("range-divider"))).toBe("CheckedRange 2 of 2");
  });

  it("marks the line being spoken", () => {
    tab({ positionMs: START + 25_000, playing: true });
    expect(row(4)).toHaveAttribute("aria-current", "true");
    expect(row(3)).not.toHaveAttribute("aria-current");
  });

  it("closes with what the times are", () => {
    tab();
    expect(text(screen.getByTestId("transcript-closing"))).toMatch(/^6 of 12 lines have a time\./);
  });

  it("draws speech only: no blank line, a speaker tag as a muted prefix where the speaker changes", () => {
    tab({ transcripts: [tagged], range: null, rangeOrdinal: null });
    const items = within(screen.getByTestId("transcript-lines")).getAllByRole("listitem");
    expect(items.map((item) => Number(item.getAttribute("data-line")))).toEqual([1, 4, 7, 10, 13, 15]); // six rows for fifteen lines of the file
    expect(text(screen.getByTestId("transcript-lines"))).not.toContain("(blank line)");
    expect(text(row(4))).toBe("17:52[Speaker 1] First synthetic turn about the promoter.");
    expect(text(row(7))).toBe("18:12Second synthetic turn."); // the same speaker goes on: not said again
    expect(text(row(10))).toBe("[Speaker 2] A synthetic question from the room.");
    expect(text(row(13))).toBe("18:32[Speaker 1] The synthetic answer.");
    expect(screen.getAllByTestId("speaker-tag")).toHaveLength(3);
    expect(row(4)).toHaveAttribute("data-lines", "3-4"); // the row stands for its tag's line too
  });

  it("marks the rows of a range by the lines of the file, and opens a line that is a tag or a blank at its row", () => {
    tab({ transcripts: [tagged], range: range({ evidence: { transcript_lines: [[5, 9]] } }), focusLine: 9 }); // lines 5–9: a blank, a turn, a blank, the tag of the next turn
    expect(row(7)).toContainElement(screen.getByTestId("range-divider"));
    expect(row(10)).toContainElement(screen.getByTestId("after-range"));
    for (const line of [7, 10]) expect(row(line).querySelector("[class*='border-accent-text']")).not.toBeNull();
    for (const line of [4, 13]) expect(row(line).querySelector("[class*='border-accent-text']")).toBeNull();
    expect(text(screen.getByRole("group", { name: "Selected transcript lines" }))).toContain("Lines 9–10 selected"); // line 9 is the tag of the row of line 10
  });

  it("quotes a turn with the line that names its speaker", () => {
    const probe = tab({ transcripts: [tagged], range: null, rangeOrdinal: null });
    fireEvent.click(screen.getByRole("button", { name: "Select line 4" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Selected transcript lines" })).getByRole("button", { name: "Ask about this" }));
    expect(probe.quotes).toEqual([[{ source_id: tagged.source_id, version_id: tagged.version_id, sha256: tagged.sha256, locator: { kind: "lines", start: 3, end: 4 } }, "[Speaker 1]\nFirst synthetic turn about the promoter."]]);
  });

  it("searches talk and speakers", () => {
    tab({ transcripts: [tagged], range: null, rangeOrdinal: null });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search this transcript" }), { target: { value: "speaker 2" } });
    expect(screen.getByRole("status")).toHaveTextContent(/1\smatching\sline/);
    expect(text(row(10))).toBe("[Speaker 2] A synthetic question from the room.");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search this transcript" }), { target: { value: "synthetic turn" } });
    expect(within(screen.getByTestId("transcript-lines")).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByTestId("speaker-tag")).toHaveLength(2); // out of their order, every row says who speaks
  });

  it("searches the transcript", () => {
    tab();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search this transcript" }), { target: { value: "PROMOTER" } });
    expect(screen.getByRole("status")).toHaveTextContent(/1\smatching\sline/);
    expect(within(screen.getByTestId("transcript-lines")).getAllByRole("listitem")).toHaveLength(1);
    expect(row(7)).toBeInTheDocument();
  });

  it("quotes selected lines into a question with their exact source, and reports a transcript error", () => {
    const probe = tab();
    fireEvent.click(screen.getByRole("button", { name: "Select line 4" }));
    fireEvent.click(screen.getByRole("button", { name: "Select line 6" }), { shiftKey: true });
    const selected = screen.getByRole("group", { name: "Selected transcript lines" });
    expect(text(selected)).toContain("Lines 4–6 selected");
    fireEvent.click(within(selected).getByRole("button", { name: "Ask about this" }));
    expect(probe.quotes).toEqual([[{ source_id: transcript.source_id, version_id: transcript.version_id, sha256: transcript.sha256, locator: { kind: "lines", start: 4, end: 6 } },
      "Synthetic transcript line 4.\nSynthetic transcript line 5.\nSynthetic transcript line 6."]]);
    fireEvent.click(within(selected).getByRole("button", { name: "Report a transcript error" }));
    expect(probe.errors).toHaveLength(1);
    fireEvent.click(within(selected).getByRole("button", { name: "Clear" }));
    expect(screen.queryByRole("group", { name: "Selected transcript lines" })).toBeNull();
  });

  it("cannot attach a quote from a file that is not identified yet, and says why", () => {
    tab({ transcripts: [{ ...transcript, sha256: null, version_id: null }] });
    fireEvent.click(screen.getByRole("button", { name: "Select line 2" }));
    expect(screen.getByRole("button", { name: "Ask about this" })).toBeDisabled();
    expect(screen.getByRole("group", { name: "Selected transcript lines" })).toHaveTextContent("has not been identified by its bytes yet");
  });

  it("labels the generated speech text as generated and not reviewed, with what it covers and what was withheld", () => {
    const probe = tab();
    const section = screen.getByTestId("generated-text");
    expect(text(within(section).getByTestId("generated-window"))).toBe("Covers 0:00 – 1:30 and 1:38 – 2:30 of the recording. Not resolved: 1:30 – 1:38. Generated, not reviewed. Made on this PC.");
    expect(within(section).queryByText("Generated stretch one.")).toBeNull(); // closed until asked for
    fireEvent.click(screen.getByRole("button", { name: "Generated speech text" }));
    expect(within(section).getByText("Generated stretch one.")).toBeInTheDocument();
    expect(text(within(section).getByTestId("generated-gap"))).toBe("No text for 1:30 – 1:38");
    fireEvent.click(within(section).getByRole("button", { name: "Go to 1:38 in the recording (generated timing, not reviewed)" }));
    expect(probe.seeks).toEqual([98_000]);
  });

  it("opens the generated speech text when the lecture has no course transcript, and generates nothing in its place", () => {
    tab({ transcripts: [] });
    expect(screen.getByTestId("course-transcript")).toHaveTextContent("No transcript is linked to this lecture.");
    expect(screen.getByRole("button", { name: "Generated speech text" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Generated stretch two.")).toBeInTheDocument();
  });

  it("says that nothing was generated, and has no generated section without a recording", () => {
    tab({ recordings: [{ ...recordings[0]!, generated_text: null }], timing: { ...timing, recordings: [{ ...timing.recordings[0]!, generated: null }] } });
    expect(text(screen.getByTestId("generated-window"))).toBe("No speech text has been generated for this recording.");
    document.body.innerHTML = "";
    tab({ recordings: [], timing: null });
    expect(screen.queryByTestId("generated-text")).toBeNull();
  });

  it("renders a view of an older Brain: linked stretches show their one time, nothing else is claimed", () => {
    tab({ transcripts: [linked], range: null, rangeOrdinal: null, timing: null, recordings: [] });
    expect(within(row(1)).getByRole("button", { name: "Go to 0:00 in the recording (reviewed timing)" })).toBeInTheDocument();
    expect(within(row(5)).getByRole("button", { name: "Go to 0:15 in the recording (suggested timing)" })).toBeInTheDocument();
    expect(within(row(2)).queryByRole("button", { name: /^Go to/ })).toBeNull();
    expect(text(screen.getByTestId("transcript-closing"))).toMatch(/^2 stretches of lines are linked to a time/);
  });

  it("offers the other transcripts of the lecture without a native select", () => {
    tab({ transcripts: [transcript, { ...linked, source_id: "src-other", filename: "other-transcript.vtt" }] });
    expect(screen.getByRole("button", { name: "Transcript: sample-transcript-90.txt" })).toHaveAttribute("aria-haspopup", "menu");
    expect(document.querySelector("select")).toBeNull();
  });

  it("keeps the earlier generated-text panel as an empty part: its content is the second section now", () => {
    const { container } = render(<GeneratedTextPanel recordings={recordings} onSeek={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
