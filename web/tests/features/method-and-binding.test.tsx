// Settings > Build and data, amendment R2 (R2-T6, R2-T2): the installation's benchmark record of the slide-matching
// method, what made each generated speech text, and the prepared (never active) binding of later transcription runs.
// The wording is pure and tested here; every value below is an invented sample and measures nothing.
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import {
  BenchmarkBlock, BindingBlock, RunnersBlock, benchmarkRecordLead, benchmarkRecordRows, bindingLead, runnerIdentityDetails, runnerIdentityWords, shortDigest,
} from "@/features/settings/SettingsPages";
import { NBSP } from "@/lib/labels";
import type { BenchmarkReadback, BenchmarkStatement, PreparedBinding, RunnerIdentity } from "@/lib/types";

const plain = (text: string | null | undefined): string => (text ?? "").split(NBSP).join(" ").replace(/\s+/g, " ").trim();
const SEQUENCE = { name: "lexical-sequence", version: "2" };
const NOTHING = { baseline: null, compared_on: null, labelled_windows: null, result: null, thresholds_fixed_before_reading_answers: null, produced_at: null };
const none: BenchmarkStatement = { state: "not_benchmarked", reason: "no_record", method: SEQUENCE, ...NOTHING };
const recorded = { method: SEQUENCE, baseline: { name: "lexical-monotone-baseline" }, compared_on: "synthetic labelled windows of two sample lectures", labelled_windows: 120, result: "not_clearly_better",
  thresholds_fixed_before_reading_answers: true, produced_at: "2026-10-06T08:00:00Z", note: "LABELLED SYNTHETIC SAMPLE." };
const present: BenchmarkReadback = { record: "present", detail: null, recorded, current_method: SEQUENCE,
  statement: { state: "benchmarked", reason: null, method: SEQUENCE, baseline: recorded.baseline, compared_on: recorded.compared_on, labelled_windows: 120, result: "not_clearly_better",
    thresholds_fixed_before_reading_answers: true, produced_at: recorded.produced_at } };
const absent: BenchmarkReadback = { record: "absent", detail: null, recorded: null, current_method: SEQUENCE, statement: none };

describe("Settings: the benchmark record of the slide-matching method", () => {
  it("says 'No benchmark record' and that the method in use is not benchmarked here", () => {
    expect(plain(benchmarkRecordLead(absent))).toBe("No benchmark record on this installation. The method that suggests ranges now (wording match, version 2) is not benchmarked here.");
    expect(benchmarkRecordRows(absent)).toEqual([]);
    expect(plain(benchmarkRecordLead(null))).toBe("The Brain states nothing about a benchmark record.");
    expect(plain(benchmarkRecordLead(undefined))).toBe("The Brain states nothing about a benchmark record.");
  });

  it("says that an unreadable record is treated as absent, with what is wrong with it", () => {
    const unreadable: BenchmarkReadback = { ...absent, record: "unreadable", detail: "labelled_windows must be a whole number of at least 1", statement: { ...none, reason: "record_unreadable" } };
    expect(plain(benchmarkRecordLead(unreadable)))
      .toBe("The benchmark record of this installation could not be read (labelled_windows must be a whole number of at least 1). It is treated as absent and was not changed: the method that suggests ranges now (wording match, version 2) is not benchmarked here.");
    expect(benchmarkRecordRows(unreadable)).toEqual([]);
  });

  it("shows the record: method, version, what it was compared with and on what, the result, the labelled windows and the date", () => {
    expect(plain(benchmarkRecordLead(present))).toBe("This installation has a benchmark record for the method that suggests ranges now.");
    const rows = benchmarkRecordRows(present).map(([term, value]) => [term, plain(value)]);
    expect(rows.slice(0, 5)).toEqual([
      ["Method", "Wording match, version 2"],
      ["Compared with", "Plain word overlap, on synthetic labelled windows of two sample lectures"],
      ["Result", "Not clearly better"],
      ["Labelled windows", "120"],
      ["Thresholds", "Fixed before the answers were read"],
    ]);
    expect(rows[5]![0]).toBe("Recorded");
    expect(rows[5]![1]).toMatch(/2026/);
    expect(rows[6]).toEqual(["Note", "LABELLED SYNTHETIC SAMPLE."]);
    expect(rows.map(([, value]) => value).join(" ")).not.toMatch(/%|lexical-sequence|\b(aligned|verified)\b/i);
  });

  it("says when the record is for another version than the one in use, and when its thresholds were not fixed first", () => {
    const older: BenchmarkReadback = { ...present, recorded: { ...recorded, method: { name: "lexical-sequence", version: "1" }, thresholds_fixed_before_reading_answers: false },
      statement: { ...none, reason: "record_is_for_another_version" } };
    expect(plain(benchmarkRecordLead(older)))
      .toBe("This installation has a benchmark record, but not for the method that suggests ranges now (wording match, version 2), which is not benchmarked here.");
    const rows = Object.fromEntries(benchmarkRecordRows(older).map(([term, value]) => [term, plain(value)]));
    expect(rows.Method).toBe("Wording match, version 1");
    expect(rows.Thresholds).toBe("Set after the answers were read");
  });

  it("is drawn with the record as terms and values, or as the one sentence", () => {
    const { unmount } = render(<BenchmarkBlock benchmark={present} />);
    const block = screen.getByTestId("timing-benchmark");
    expect(plain(block.textContent)).toContain("Benchmark of the slide-matching method");
    expect(plain(block.textContent)).toMatch(/Result\s*Not clearly better/); // a term and its value, drawn as two cells
    unmount();
    render(<BenchmarkBlock benchmark={absent} />);
    expect(plain(screen.getByTestId("timing-benchmark").textContent)).toContain("No benchmark record on this installation.");
  });
});

const runner: RunnerIdentity = { origin: "speech_runner", runner: "speech-runner-3", tool: "sample-speech-tool", tool_version: "1.2.1", model: "Sample/sample-speech-model@0123456789abcdef0123456789abcdef01234567",
  language: "en", parameters_sha256: "b".repeat(64), settings_sha256: "0a1b2c3d4e5f".padEnd(64, "9"), same_as_prepared: true, generations: 3,
  recordings: [{ source_id: "src-1", filename: "Sample Lec 1.m4a", generation: "sp-1" }, { source_id: "src-2", filename: "Sample Lec 2.m4a", generation: "sp-2" }, { source_id: "src-3", filename: null, generation: "sp-3" }] };

describe("Settings: what made each generated speech text", () => {
  it("names the tool, its version and the model in words, with the number of recordings it made the text of", () => {
    expect(plain(runnerIdentityWords(runner))).toBe("sample-speech-tool, version 1.2.1, model Sample/sample-speech-model. 3 recordings. Same settings as the prepared command.");
    expect(plain(runnerIdentityWords({ ...runner, same_as_prepared: false, generations: 1 }))).toBe("sample-speech-tool, version 1.2.1, model Sample/sample-speech-model. 1 recording. Other settings than the prepared command.");
    // An identity that states less says less; nothing is filled in.
    expect(plain(runnerIdentityWords({ ...runner, tool_version: "unknown", model: null, same_as_prepared: null, settings_sha256: null }))).toBe("sample-speech-tool, model not stated. 3 recordings.");
    expect(plain(runnerIdentityWords({ ...runner, tool: null, tool_version: null, model: null, same_as_prepared: null }))).toBe("Tool not stated, model not stated. 3 recordings.");
  });

  it("keeps the identifiers under Details: the settings identity as a short digest, the model revision, the runner, the recordings", () => {
    expect(shortDigest("0a1b2c3d4e5f".padEnd(64, "9"))).toBe("0a1b2c3d4e5f…");
    expect(shortDigest("abc")).toBe("abc");
    expect(shortDigest(null)).toBe("");
    const rows = Object.fromEntries(runnerIdentityDetails(runner).map(([term, value]) => [term, plain(String(value))]));
    expect(rows).toEqual({
      "Settings identity": "0a1b2c3d4e5f…", "Parameters stated by the text": "bbbbbbbbbbbb…", "Model revision": "0123456789ab…", "Made by": "This installation's runner (speech-runner-3)",
      Recordings: "Sample Lec 1.m4a, Sample Lec 2.m4a, src-3",
    });
    // A text this installation's runner did not make states its own parameters only.
    const imported = Object.fromEntries(runnerIdentityDetails({ ...runner, origin: null, runner: null, settings_sha256: null, same_as_prepared: null, model: "none-synthetic" }).map(([term, value]) => [term, plain(String(value))]));
    expect(imported).toEqual({ "Parameters stated by the text": "bbbbbbbbbbbb…", "Made by": "Not stated by the text", Recordings: "Sample Lec 1.m4a, Sample Lec 2.m4a, src-3" });
  });

  it("lists every identity with its closed Details, or says that nothing was generated", () => {
    const { unmount } = render(<MemoryRouter><RunnersBlock runners={[runner]} /></MemoryRouter>);
    const block = screen.getByTestId("timing-runners");
    expect(plain(block.textContent)).toContain("sample-speech-tool, version 1.2.1, model Sample/sample-speech-model. 3 recordings.");
    expect(plain(block.textContent)).not.toContain("0a1b2c3d4e5f"); // closed until asked for
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(plain(block.textContent)).toMatch(/Settings identity\s*0a1b2c3d4e5f…/);
    unmount();
    render(<MemoryRouter><RunnersBlock runners={[]} /></MemoryRouter>);
    expect(plain(screen.getByTestId("timing-runners").textContent)).toContain("No speech text has been generated for this course.");
  });
});

const binding: PreparedBinding = { state: "prepared_inactive", command: "python.exe -m lecture_brain --profile sample --state-dir C:\\sample\\state speech-run", argv: [], command_sha256: "c".repeat(64),
  settings_sha256: "0a1b2c3d4e5f".padEnd(64, "9"), runner: "speech-runner-3", same_runner: true, schedule: null,
  note: "Prepared, not active. Nothing is scheduled: no task, service or startup entry exists for it, and the app never starts it. It is the same command and the same settings as the runs that made the speech text shown here." };

describe("Settings: the prepared binding of later transcription runs", () => {
  it("says prepared and not active, that nothing is scheduled, and that it is the same runner", () => {
    expect(plain(bindingLead(binding, null))).toBe(binding.note);
    expect(plain(bindingLead(binding, null))).toMatch(/^Prepared, not active\. Nothing is scheduled/);
  });

  it("says when the binding would not be the same runner, in the Brain's words, and never calls it prepared", () => {
    const refused: PreparedBinding = { ...binding, state: "refused", same_runner: false, note: "Not prepared. The settings this command would use now are not the settings the published speech text was made with, so the runner would refuse to continue its queue with them. Nothing is scheduled." };
    expect(plain(bindingLead(refused, null))).toMatch(/^Not prepared\./);
    // A binding that claims a schedule is not what this page was told to expect: it says so instead of repeating "nothing is scheduled".
    const scheduled = { ...binding, schedule: { every: "night" } } as unknown as PreparedBinding;
    expect(plain(bindingLead(scheduled, null))).toBe("The Brain reports a schedule for this command. This page expected none; check it on the Brain PC before relying on what is said here.");
  });

  it("says why the installation has none, in the Brain's words, or that nothing was stated", () => {
    expect(plain(bindingLead(null, { code: "no_speech_binding", text: "No speech tool is set up on this installation, so no later run is prepared and nothing is scheduled." })))
      .toBe("No speech tool is set up on this installation, so no later run is prepared and nothing is scheduled.");
    expect(plain(bindingLead(null, null))).toBe("The Brain states nothing about a prepared later run.");
    expect(plain(bindingLead(undefined, undefined))).toBe("The Brain states nothing about a prepared later run.");
  });

  it("shows the command to copy and its identities under Details only when a binding is listed", () => {
    const { unmount } = render(<MemoryRouter><BindingBlock binding={binding} reason={null} /></MemoryRouter>);
    const block = screen.getByTestId("timing-binding");
    expect(plain(block.textContent)).toContain("Later transcription runs");
    expect(plain(block.textContent)).toContain("Prepared, not active. Nothing is scheduled");
    expect(plain(block.textContent)).toContain("speech-run");
    expect(screen.getByRole("button", { name: /Copy the command/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(plain(block.textContent)).toMatch(/Settings identity\s*0a1b2c3d4e5f…/);
    unmount();
    render(<MemoryRouter><BindingBlock binding={null} reason={{ code: "no_speech_binding", text: "No speech tool is set up on this installation, so no later run is prepared and nothing is scheduled." }} /></MemoryRouter>);
    expect(plain(screen.getByTestId("timing-binding").textContent)).toContain("No speech tool is set up on this installation");
    expect(screen.queryByRole("button", { name: /Copy the command/ })).toBeNull();
  });
});
