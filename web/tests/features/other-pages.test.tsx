// The pages that keep their layout (Settings, Progress, Review, Library, Activity, question practice): the logic they
// add for amendment R2. Settings reads back timing and suggested links per course; Progress shows the five evidence
// states where the Brain sends them. Synthetic samples only (src/lib/fixtures/r2-sample.ts); nothing here is a measurement.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  sampleConceptGraphCourse, sampleCourseTiming, sampleEvidence, sampleInferredAnchors, sampleInferredAnchorsEarlierCatalog,
} from "@/lib/fixtures/r2-sample";
import { NBSP } from "@/lib/labels";
import type { EvidenceObservation, OutlineNodeView, SkillRow } from "@/lib/types";
import { allowanceLine, anchorCountRows, coverageLines, decisionRows, linksWords, queueWords, refusedRows, stageRows } from "@/features/settings/SettingsPages";
import { SkillState, attemptRecordLine, observationsByAttempt, rowEvidence, skillEvidenceIndex } from "@/features/progress/ProgressPages";
import { Callout, Disclosure, Fact, Facts, Lead, Picker, StateWords, lectureNameOf } from "@/features/search/SearchOverlay";
import { bindingFacts } from "@/features/connect/ConnectPage";

/** A fact keeps its parts together with non-breaking spaces; the wording is compared with plain ones. */
const plain = (text: string | null | undefined): string => (text ?? "").split(NBSP).join(" ");

describe("Settings: timing and transcription of a course", () => {
  const summary = sampleCourseTiming.summary;

  it("lists the stages the Brain counted, in the order of preparation, in the stage words of the preparation details", () => {
    expect(stageRows(summary)).toEqual([
      { stage: "no_recording", label: "No recording", lectures: 1 },
      { stage: "audio_unprocessed", label: "Inventoried, not transcribed yet", lectures: 1 },
      { stage: "partly_processed", label: "Transcribed in part", lectures: 1 },
      { stage: "processed", label: "Transcribed, slides not linked yet", lectures: 0 },
      { stage: "associated", label: "Slide-linked", lectures: 1 },
    ]);
  });

  it("leaves out a stage the Brain did not count (never written as 0) and shows a stage it has no words for as recorded", () => {
    expect(stageRows({ stages: { associated: 2 } })).toEqual([{ stage: "associated", label: "Slide-linked", lectures: 2 }]);
    expect(stageRows({ stages: { associated: 1, held_for_review: 3 } as Record<string, number> })).toEqual([
      { stage: "associated", label: "Slide-linked", lectures: 1 },
      { stage: "held_for_review", label: "held for review", lectures: 3 },
    ]);
    expect(stageRows(null)).toEqual([]);
    expect(stageRows({})).toEqual([]);
  });

  it("says what was measured in durations, with the denominators, and never as a percentage", () => {
    const lines = coverageLines(summary).map(plain);
    expect(lines).toEqual([
      "3 recordings, 3 h 30 min in all.",
      "Speech text was generated for 2 of 3 recordings and covers 1 h 49 min of them.",
      "1 min could not be resolved: neither speech nor silence is known there.",
      "Slides are linked for 1 of 3 recordings: 4 ranges.",
    ]);
    expect(lines.join(" ")).not.toContain("%");
  });

  it("keeps a line back when its figures were not sent, instead of writing a zero", () => {
    expect(coverageLines({ recordings: 2 }).map(plain)).toEqual(["2 recordings."]);
    expect(coverageLines({}).map(plain)).toEqual([]);
    expect(coverageLines({ recordings: 1, duration_ms: 60_000, recordings_with_generated: 0, covered_ms: 0, unresolved_ms: 0 }).map(plain)).toEqual([
      "1 recording, 1 min in all.",
      "No speech text has been generated yet.",
    ]);
  });

  it("states the allowance as used, ceiling and remaining, and says so when the record is absent", () => {
    expect(plain(allowanceLine(sampleCourseTiming.allowance))).toBe("1 h 30 min used of 4 h; 2 h 30 min remaining.");
    expect(allowanceLine(null)).toBe("The allowance record is absent or could not be read, so nothing is stated about it.");
  });

  it("words the queue of a recording as recorded, with its chunks only when it has any", () => {
    expect(plain(queueWords({ state: "partial", chunks_done: 3, chunks_total: 7, seconds_covered: 1740, position: 2 }))).toBe("partial · 3 of 7 chunks · 29 min covered");
    expect(plain(queueWords({ state: "not_in_frozen_queue", chunks_done: 0, chunks_total: 0, seconds_covered: 0 }))).toBe("not in frozen queue");
    expect(plain(queueWords({ state: "not_listed", chunks_done: null, chunks_total: null, seconds_covered: null }))).toBe("not listed");
    expect(queueWords(null)).toBeNull();
  });

  it("words the stored ranges of a lecture against the current inputs, naming what differs", () => {
    expect(linksWords({ state: "current", differs: [], built_at: "2026-10-06T03:00:00Z" })).toBe("current");
    expect(linksWords({ state: "stale", differs: ["generation", "map_revision"], built_at: null })).toBe("stale (differs: generation, map revision)");
    expect(linksWords({ state: "missing", differs: [], built_at: null })).toBe("missing");
    expect(linksWords(undefined)).toBeNull();
  });
});

describe("Settings: suggested question links of a course", () => {
  it("reads back the counts of the file as figures with their own words", () => {
    expect(anchorCountRows(sampleInferredAnchors)).toEqual([
      { key: "accepted", label: "Suggested links in force", count: 3 },
      { key: "stale", label: "Made for an earlier version (not shown as links)", count: 0 },
      { key: "rejected_by_verifier", label: "Rejected by the second pass (never shown as links)", count: 1 },
      { key: "refused", label: "Refused entries (not valid; never repaired)", count: 0 },
      { key: "no_candidate", label: "Questions inspected, no supporting page found", count: 0 },
    ]);
    expect(anchorCountRows(sampleInferredAnchorsEarlierCatalog).find((row) => row.key === "stale")?.count).toBe(4);
  });

  it("leaves out a count the Brain did not send", () => {
    const { no_candidate: _none, ...older } = sampleInferredAnchors;
    expect(anchorCountRows(older).map((row) => row.key)).toEqual(["accepted", "stale", "rejected_by_verifier", "refused"]);
  });

  it("lists refused entries by reason, most frequent first, in the reason's own words", () => {
    expect(refusedRows({ unknown_question: 1, page_out_of_range: 2, "bad-shape": 1 })).toEqual([
      { reason: "page out of range", count: 2 },
      { reason: "bad-shape", count: 1 },
      { reason: "unknown question", count: 1 },
    ]);
    expect(refusedRows({})).toEqual([]);
    expect(refusedRows(undefined)).toEqual([]);
  });

  it("counts the learner's decisions, and those no current link carries", () => {
    expect(decisionRows(sampleInferredAnchors.decisions)).toEqual([
      { key: "confirmed", label: "Confirmed by you", count: 1 },
      { key: "rejected", label: "Rejected by you", count: 0 },
    ]);
    expect(decisionRows(sampleInferredAnchorsEarlierCatalog.decisions)).toEqual([
      { key: "confirmed", label: "Confirmed by you", count: 0 },
      { key: "rejected", label: "Rejected by you", count: 0 },
      { key: "on_stale", label: "Decisions on links made for an earlier version", count: 1 },
    ]);
    expect(decisionRows(undefined)).toEqual([]);
  });
});

describe("Progress: the five evidence states, where the Brain sends them", () => {
  const row = (skillId: string, extra: Partial<SkillRow> = {}): SkillRow => ({
    skill_id: skillId, label: "A sample skill", ability: null, topic_ids: [], concept_id: null, status: "not_assessed",
    facet: { facet: null, state: "unclassified", tokens: [], token_basis: "", candidates: [], rationale: "", mapping_version: 1 },
    observations_by_condition: {}, episodes: 0, latest: null, gap: null, counterevidence: [], unaided_demonstrated: 0,
    study: { priority: null, priority_reason: null, need_basis: null, study_decision: null, note: "" }, history: [], ...extra,
  });

  it("indexes the evidence of the skills of a course graph by skill id, and nothing else", () => {
    const index = skillEvidenceIndex(sampleConceptGraphCourse);
    expect([...index.keys()].sort()).toEqual(["s-sample-1", "s-sample-2", "s-sample-3"]);
    expect(index.get("s-sample-1")?.state).toBe("independent");
    expect(index.get("s-sample-2")?.state).toBe("assisted");
    expect(index.get("s-sample-3")?.state).toBe("not_separately_observed");
    expect(skillEvidenceIndex(undefined).size).toBe(0);
  });

  it("reads the row's own evidence first, then the graph's; without either it claims nothing", () => {
    const index = skillEvidenceIndex(sampleConceptGraphCourse);
    expect(rowEvidence(row("s-sample-2"), index)?.state).toBe("assisted");
    expect(rowEvidence({ ...row("s-sample-2"), evidence: sampleEvidence.unknown }, index)?.state).toBe("unknown");
    expect(rowEvidence(row("s-sample-9"), index)).toBeNull();
  });

  it("shows prior exposure beside the state, never as assistance and never as the state", () => {
    render(<SkillState evidence={sampleEvidence.independent} />);
    const label = screen.getByTestId("skill-state");
    expect(plain(label.textContent)).toBe("Independent · 2 attempts · prior exposure");
    expect(label.querySelector("[data-state]")?.getAttribute("data-state")).toBe("independent");
    expect(label.textContent).not.toMatch(/assist/i);
  });

  it("names the kind of help inside Assisted, and draws nothing when no evidence object was sent", () => {
    const { unmount } = render(<SkillState evidence={sampleEvidence.assisted} />);
    expect(plain(screen.getByTestId("skill-state").textContent)).toBe("Assisted: solution shown · 1 attempt · prior exposure");
    unmount();
    const { container } = render(<SkillState evidence={null} />);
    expect(container.textContent).toBe("");
  });

  it("indexes the observations of a node by attempt, so an attempt line can state its own conditions", () => {
    const observations: EvidenceObservation[] = [
      { attempt_id: "a-2", recorded_at: "2026-09-06T15:00:00Z", outcome: "demonstrated", state: "independent", assistance: null, prior_exposure: "seen", question_id: "Q1", skill_id: "s-sample-1" },
      { attempt_id: "a-1", recorded_at: "2026-09-05T15:00:00Z", outcome: "partial", state: "assisted", assistance: "hint", prior_exposure: "unseen", question_id: "Q1", skill_id: "s-sample-1" },
    ];
    const detail = { evidence: { observations } } as unknown as OutlineNodeView;
    const index = observationsByAttempt(detail);
    expect(index.get("a-2")?.prior_exposure).toBe("seen");
    expect(index.get("a-1")?.assistance).toBe("hint");
    expect(observationsByAttempt(undefined).size).toBe(0);
    expect(observationsByAttempt({ evidence: {} } as unknown as OutlineNodeView).size).toBe(0);
  });
});

describe("what the pages share", () => {
  it("a picker is a combobox named by its label that shows the chosen option", () => {
    render(<Picker label="Show" value="b" onChange={vi.fn()} options={[{ value: "a", label: "all skills" }, { value: "b", label: "Not assessed" }]} />);
    const box = screen.getByRole("combobox", { name: "Show" });
    expect(box.textContent).toContain("Not assessed");
    expect(box.textContent).not.toContain("all skills");
  });

  it("a state in words carries no glyph, and an error carries the triangle: never a ring, never a pill", () => {
    const { container, unmount } = render(<StateWords tone="success">Available</StateWords>);
    expect(container.textContent).toBe("Available");
    expect(container.querySelector("svg")).toBeNull();
    unmount();
    const error = render(<StateWords tone="danger" detail="The file is not at its recorded location.">Inaccessible</StateWords>);
    expect(error.container.textContent).toBe("Inaccessible");
    expect(error.container.querySelectorAll("svg")).toHaveLength(1);
    expect(error.container.querySelector("svg circle")).toBeNull();
    expect(error.container.querySelector("[title]")?.getAttribute("title")).toBe("The file is not at its recorded location.");
  });

  it("facts are terms and values of one description list, each value straight after its term", () => {
    render(<Facts label="Where it stands"><Fact term="Native turn">Cancelled</Fact><Fact term="Answer" testId="answer-fact">None</Fact></Facts>);
    const list = screen.getByLabelText("Where it stands");
    expect(list.tagName).toBe("DL");
    expect(list.textContent).toBe("Native turnCancelledAnswerNone");
    expect(list.querySelectorAll("dt")).toHaveLength(2);
    expect(screen.getByTestId("answer-fact").tagName).toBe("DD");
  });

  it("a note keeps its role, its title and its own classes, and is held to a reading measure", () => {
    render(<Callout tone="neutral" role="note" title="Understanding was not assessed" className="mt-4">No result was recorded.</Callout>);
    const note = screen.getByRole("note");
    expect(note.textContent).toContain("Understanding was not assessed");
    expect(note.textContent).toContain("No result was recorded.");
    expect(note.className).toContain("max-w-[36rem]");
    expect(note.className).toContain("mt-4");
    const { container } = render(<Lead>One sentence under a title.</Lead>);
    expect(container.querySelector(".ll-measure")?.textContent).toBe("One sentence under a title.");
  });

  it("detail that opens on request is a button that says whether it is open, and its content is absent until opened", () => {
    render(<Disclosure title="Background preparation" count={6}><p>be505 · source refresh</p></Disclosure>);
    const toggle = screen.getByRole("button", { name: /^Background preparation\s+6$/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("be505 · source refresh")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("be505 · source refresh")).toBeTruthy();
    expect(document.getElementById(toggle.getAttribute("aria-controls") ?? "")?.textContent).toBe("be505 · source refresh");
    fireEvent.click(toggle);
    expect(screen.queryByText("be505 · source refresh")).toBeNull();
  });

  it("a lecture is named by its title where the course lists it, and by its identifier otherwise: no title is made up", () => {
    const course = { lectures: [{ lecture_id: "lecture-02", title: "Lecture 02 - Expression control" }] };
    expect(lectureNameOf(course, "lecture-02")).toBe("Lecture 02 - Expression control");
    expect(lectureNameOf(course, "lecture-09")).toBe("lecture-09");
    expect(lectureNameOf(undefined, "lecture-02")).toBe("lecture-02");
    expect(lectureNameOf({ lectures: [{ lecture_id: "lecture-02", title: "" }] }, "lecture-02")).toBe("lecture-02");
  });
});

describe("Connect: what a bound course holds", () => {
  it("counts lecture units and sessions with the right number of each word", () => {
    expect(bindingFacts({ course_id: "be505", lecture_units: 5, sessions: 4 })).toEqual(["be505", "5 lecture units", "4 sessions"]);
    expect(bindingFacts({ course_id: "cs542", lecture_units: 1, sessions: 1 })).toEqual(["cs542", "1 lecture unit", "1 session"]);
    expect(bindingFacts({ course_id: "ds551", lecture_units: 0, sessions: 2 })).toEqual(["ds551", "0 lecture units", "2 sessions"]);
  });

  it("writes each fact with ordinary spaces: the page keeps a figure with its word by not wrapping, so the text can be found as typed", () => {
    expect(bindingFacts({ course_id: "be505", lecture_units: 5, sessions: 4 }).join(" · ")).not.toContain(NBSP);
  });

  it("states only the identifier of a course whose counts were not sent", () => {
    expect(bindingFacts({ course_id: "be562" })).toEqual(["be562"]);
  });
});

describe("Progress: what the record states about one attempt, beside its state", () => {
  it("keeps the record's own word for prior exposure, which the state label reduces to seen or not", () => {
    expect(attemptRecordLine({ reference_access: "none", confidence: "medium", prior_exposure: "seen_exact" })).toBe("no references · confidence medium · prior exposure: seen exact");
    expect(attemptRecordLine({ reference_access: "notes", confidence: "low", prior_exposure: "same_family" })).toBe("notes/sources open · confidence low · prior exposure: same family");
  });

  it("shows a value this build has no words for as recorded", () => {
    expect(attemptRecordLine({ reference_access: "open_book_exam", confidence: "high", prior_exposure: "unknown" })).toBe("open book exam · confidence high · prior exposure: unknown");
  });
});
