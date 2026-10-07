// R2-T6 on screen: what a suggestion says about the method that made it and about a benchmark of that method
// (web/src/lib/labels.ts, web/src/features/lecture/RangeList.tsx). The Brain states it per range (`benchmark`, from the
// installation's own benchmark record); here it is worded in plain words. Synthetic samples only: the "record" below is
// invented and measures nothing.
import { MemoryRouter } from "react-router";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RANGE_KIND_WORDS, RangeList, rangeKindSentence, rangeKindWords, rangeListMethodLine } from "@/features/lecture/RangeList";
import { sampleLectureView, sampleRangeBuildGroup, sampleRangeConfirmed, sampleRangeFirstVisit, sampleRangeManual, sampleRangeSecondVisit, sampleRangeSection } from "@/lib/fixtures/r2-sample";
import {
  BASELINE_WORDS, BENCHMARK_RESULT_WORDS, COURSE_STUDY_MAP_WORDS, METHOD_WORDS, NBSP, NOT_A_SUGGESTION_WORDS, NOT_BENCHMARKED_WORDS, RANGE_KIND_LABEL, RANGE_ORIGIN_LABEL, benchmarkSentence, methodStatement,
  methodVersionWords, rangeKindLabel,
} from "@/lib/labels";
import type { BenchmarkStatement, MethodRef, TimingRange } from "@/lib/types";

const text = (element: Element | null): string => (element?.textContent ?? "").split(NBSP).join(" ").replace(/\s+/g, " ").trim();
const plain = (value: string): string => value.split(NBSP).join(" ");

const SEQUENCE: MethodRef = { name: "lexical-sequence", version: "2" };
const NOTHING = { baseline: null, compared_on: null, labelled_windows: null, result: null, thresholds_fixed_before_reading_answers: null, produced_at: null };
const notBenchmarked = (reason = "no_record", method: MethodRef | null = SEQUENCE): BenchmarkStatement => ({ state: "not_benchmarked", reason, method, ...NOTHING });
const notApplicable = (reason: string, method: MethodRef | null): BenchmarkStatement => ({ state: "not_applicable", reason, method, ...NOTHING });
/** A LABELLED SYNTHETIC statement, as the Brain derives one from a record that names exactly the range's method and version. */
const benchmarked = (result = "not_clearly_better", over: Partial<BenchmarkStatement> = {}): BenchmarkStatement => ({
  state: "benchmarked", reason: null, method: SEQUENCE, baseline: { name: "lexical-monotone-baseline" }, compared_on: "synthetic labelled windows of two sample lectures", labelled_windows: 120, result,
  thresholds_fixed_before_reading_answers: true, produced_at: "2026-10-06T08:00:00Z", ...over,
});
const withStatement = (range: TimingRange, benchmark: BenchmarkStatement | null): TimingRange => ({ ...range, benchmark });

describe("the method of a suggestion, in words", () => {
  it("names the method and its version in plain words, never by its identifier", () => {
    expect(methodVersionWords(SEQUENCE)).toBe("Wording match, version 2");
    expect(methodVersionWords({ name: "lexical-sequence", version: null })).toBe("Wording match");
    expect(methodVersionWords({ name: "transcript-cue-match", version: null })).toBe("Transcript cue match"); // a name without words of its own: read as words
    expect(methodVersionWords(null)).toBe("");
    expect(methodVersionWords(SEQUENCE)).not.toMatch(/lexical|sequence/i);
  });

  it("says not benchmarked when the installation has no record for exactly this method and version, with the reason", () => {
    expect(plain(methodStatement(withStatement(sampleRangeFirstVisit, notBenchmarked())))).toBe("Wording match, version 2. Not benchmarked on this installation.");
    expect(plain(methodStatement(withStatement(sampleRangeFirstVisit, notBenchmarked("record_unreadable"))))).toBe("Wording match, version 2. Not benchmarked on this installation: its benchmark record could not be read.");
    expect(plain(methodStatement(withStatement(sampleRangeFirstVisit, notBenchmarked("record_is_for_another_version")))))
      .toBe("Wording match, version 2. Not benchmarked on this installation: the benchmark record here is for another version of this method.");
    expect(plain(methodStatement(withStatement(sampleRangeFirstVisit, notBenchmarked("record_is_for_another_method")))))
      .toBe("Wording match, version 2. Not benchmarked on this installation: the benchmark record here is for another method.");
    // A reason this build has no words for still says the one thing that is known.
    expect(plain(methodStatement(withStatement(sampleRangeFirstVisit, notBenchmarked("some_later_reason"))))).toBe("Wording match, version 2. Not benchmarked on this installation.");
    // A Brain that states nothing about a benchmark names no record: the suggestion says so too.
    expect(plain(methodStatement(sampleRangeFirstVisit))).toBe("Wording match, version 2. Not benchmarked on this installation.");
    expect(plain(methodStatement(withStatement(sampleRangeFirstVisit, null)))).toBe("Wording match, version 2. Not benchmarked on this installation.");
  });

  it("says what the record states when it names this method and version: against what, on what, and the result", () => {
    expect(plain(methodStatement(withStatement(sampleRangeFirstVisit, benchmarked()))))
      .toBe("Wording match, version 2. Compared with plain word overlap on synthetic labelled windows of two sample lectures: not clearly better.");
    expect(plain(benchmarkSentence(benchmarked("better")))).toBe("Compared with plain word overlap on synthetic labelled windows of two sample lectures: better.");
    expect(plain(benchmarkSentence(benchmarked("worse")))).toBe("Compared with plain word overlap on synthetic labelled windows of two sample lectures: worse.");
    // a baseline this build has no words for is read as words; a result it has no words for is shown as recorded
    expect(plain(benchmarkSentence(benchmarked("better", { baseline: { name: "plain-overlap" } })))).toBe("Compared with plain overlap on synthetic labelled windows of two sample lectures: better.");
    expect(plain(benchmarkSentence(benchmarked("much_better")))).toBe("Compared with plain word overlap on synthetic labelled windows of two sample lectures: much better.");
    // thresholds that were set after the answers were read are said beside the result
    expect(plain(benchmarkSentence(benchmarked("better", { thresholds_fixed_before_reading_answers: false }))))
      .toBe("Compared with plain word overlap on synthetic labelled windows of two sample lectures: better. The thresholds were set after the answers were read.");
  });

  it("says of the baseline itself that it is the baseline and not benchmarked", () => {
    const baseline: MethodRef = { name: "lexical-monotone-baseline", version: "preparation.align_lines_to_slides" };
    const range = withStatement({ ...sampleRangeFirstVisit, method: baseline }, notBenchmarked("is_the_baseline", baseline));
    expect(plain(methodStatement(range))).toBe("Plain word overlap. This is the baseline itself: not benchmarked.");
    expect(methodStatement(range)).not.toMatch(/preparation|align_lines/);
  });

  it("says of the course's own statement that it is no method's suggestion, and nothing of a link a person made", () => {
    expect(plain(methodStatement(withStatement(sampleRangeSection, notApplicable("stated_by_the_course", sampleRangeSection.method)))))
      .toBe("Stated by the course's study map, not suggested by a matching method.");
    expect(plain(methodStatement(sampleRangeSection))).toBe("Stated by the course's study map, not suggested by a matching method."); // also when the Brain states nothing
    expect(methodStatement(withStatement(sampleRangeManual, notApplicable("entered_by_a_person", sampleRangeManual.method)))).toBe("");
    expect(methodStatement(sampleRangeManual)).toBe("");
    expect(methodStatement(sampleRangeConfirmed)).toBe(""); // a suggestion the learner confirmed is theirs
  });
});

describe("no suggestion is worded as aligned, verified or confirmed", () => {
  const FORBIDDEN = /\b(aligned|alignment|verified|verification|confirmed|certified|proven|validated)\b/i;
  const results = ["better", "not_clearly_better", "worse", "unlisted_result"];
  const suggestion = (benchmark: BenchmarkStatement | null): TimingRange => withStatement(sampleRangeFirstVisit, benchmark);

  it("in every label table a suggestion is worded from", () => {
    const tables: Record<string, string[]> = {
      METHOD_WORDS: Object.values(METHOD_WORDS), BASELINE_WORDS: Object.values(BASELINE_WORDS), BENCHMARK_RESULT_WORDS: Object.values(BENCHMARK_RESULT_WORDS),
      NOT_BENCHMARKED_WORDS: Object.values(NOT_BENCHMARKED_WORDS), NOT_A_SUGGESTION_WORDS: Object.values(NOT_A_SUGGESTION_WORDS), COURSE_STUDY_MAP_WORDS: [COURSE_STUDY_MAP_WORDS],
      "RANGE_KIND_LABEL (suggestions)": [RANGE_KIND_LABEL.suggestion, RANGE_KIND_LABEL.suggestion_checked], "RANGE_KIND_WORDS (suggestions)": [RANGE_KIND_WORDS.suggestion, RANGE_KIND_WORDS.suggestion_checked],
      "RANGE_ORIGIN_LABEL (pipeline, course)": [RANGE_ORIGIN_LABEL.pipeline, RANGE_ORIGIN_LABEL.reviewed_source_map],
    };
    for (const [table, words] of Object.entries(tables)) {
      expect(words.length, table).toBeGreaterThan(0);
      for (const entry of words) expect(entry, `${table}: "${entry}"`).not.toMatch(FORBIDDEN);
    }
  });

  it("in every sentence made for a suggestion, whatever the record says", () => {
    const statements: Array<BenchmarkStatement | null> = [null, ...Object.keys(NOT_BENCHMARKED_WORDS).map((reason) => notBenchmarked(reason)), ...results.map((result) => benchmarked(result)),
      benchmarked("better", { thresholds_fixed_before_reading_answers: false })];
    for (const statement of statements) {
      const range = suggestion(statement);
      for (const sentence of [methodStatement(range), rangeKindWords(range), rangeKindLabel(range), rangeKindSentence(range), rangeListMethodLine([range]), statement ? benchmarkSentence(statement) : ""]) {
        expect(sentence, `${statement?.state ?? "none"} / ${statement?.reason ?? statement?.result ?? ""}: "${sentence}"`).not.toMatch(FORBIDDEN);
      }
      // A benchmark of the method does not make the range anything but a suggestion.
      expect(rangeKindWords(range)).toBe("Suggestion (wording match)");
    }
  });
});

// ---- the range list ---------------------------------------------------------------------------------------------------------
function list(ranges: TimingRange[], selection: string) {
  const anchor = { current: document.body };
  return render(
    <MemoryRouter>
      <RangeList pages={[3, 4, 5]} ranges={ranges} selection={selection} onSelect={() => undefined} open onOpenChange={() => undefined} trigger={<button type="button">All ranges</button>} anchor={anchor}
        recordings={sampleLectureView.recordings} groupKind="build" />
    </MemoryRouter>,
  );
}

describe("the range list and the method of its suggestions", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("says in its head, once per method, how the suggestions were made and whether that method is benchmarked here", () => {
    expect(plain(rangeListMethodLine([withStatement(sampleRangeFirstVisit, notBenchmarked()), withStatement(sampleRangeSecondVisit, notBenchmarked())])))
      .toBe("How the suggestions were made: wording match, version 2. Not benchmarked on this installation.");
    expect(plain(rangeListMethodLine([withStatement(sampleRangeBuildGroup, benchmarked("not_clearly_better")), withStatement(sampleRangeSection, notApplicable("stated_by_the_course", sampleRangeSection.method))])))
      .toBe("How the suggestions were made: wording match, version 2. Compared with plain word overlap on synthetic labelled windows of two sample lectures: not clearly better.");
    // nothing is said where no method suggested anything
    expect(rangeListMethodLine([sampleRangeManual, sampleRangeConfirmed])).toBe("");
    expect(rangeListMethodLine([withStatement(sampleRangeSection, notApplicable("stated_by_the_course", sampleRangeSection.method))])).toBe("");
    expect(rangeListMethodLine([])).toBe("");

    list([withStatement(sampleRangeSection, notApplicable("stated_by_the_course", sampleRangeSection.method)), withStatement(sampleRangeBuildGroup, notBenchmarked())], sampleRangeBuildGroup.range_id);
    expect(text(screen.getByTestId("range-list-method"))).toBe("How the suggestions were made: wording match, version 2. Not benchmarked on this installation.");
  });

  it("shows no method line in the head of a list that holds only the learner's own ranges", () => {
    list([sampleRangeManual], sampleRangeManual.range_id);
    expect(screen.queryByTestId("range-list-method")).toBeNull();
  });

  it("says the same under a range's Qualities, on a row of its own, and keeps the recorded identifier once in the evidence line", () => {
    list([withStatement(sampleRangeBuildGroup, benchmarked("not_clearly_better"))], sampleRangeBuildGroup.range_id);
    fireEvent.click(screen.getByRole("button", { name: /^Qualities of the range/ }));
    const qualities = screen.getByTestId("range-qualities");
    expect(within(qualities).getAllByRole("term").map((term) => text(term))).toContain("Method");
    expect(text(within(qualities).getByTestId("range-benchmark"))).toBe("Wording match, version 2. Compared with plain word overlap on synthetic labelled windows of two sample lectures: not clearly better.");
    expect(text(within(qualities).getByTestId("range-method"))).toBe("· Method: lexical-sequence 2"); // the record's own name of the method, selectable
    expect(text(qualities).match(/lexical-sequence/g)).toHaveLength(1);
    expect(text(qualities)).toContain("Suggested by a wording match. Nobody has checked it."); // a benchmark of the method checks no range
  });

  it("shows the course's own statement as such and no method row for a range the learner entered", () => {
    list([withStatement(sampleRangeSection, notApplicable("stated_by_the_course", sampleRangeSection.method))], sampleRangeSection.range_id);
    fireEvent.click(screen.getByRole("button", { name: /^Qualities of the range/ }));
    expect(text(screen.getByTestId("range-benchmark"))).toBe("Stated by the course's study map, not suggested by a matching method.");
  });
  it("shows no method row for a range the learner entered", () => {
    list([withStatement(sampleRangeManual, notApplicable("entered_by_a_person", sampleRangeManual.method))], sampleRangeManual.range_id);
    fireEvent.click(screen.getByRole("button", { name: /^Qualities of the range/ }));
    expect(screen.queryByTestId("range-benchmark")).toBeNull();
  });
});
