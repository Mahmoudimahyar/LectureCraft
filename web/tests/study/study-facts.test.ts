// features/study/study-facts.ts: what the Study home says about a lecture, a course and the place you left (design
// specification 6, 9.11). Pure wording, tested without a browser: every fact is real data of the read API, a missing thing
// is said in words, a line breaks only between facts, and nothing is derived from an id or invented.
import { describe, expect, it } from "vitest";
import {
  NO_LECTURES_SENTENCE, STUDY_CLOSING_LINE, STUDY_FIRST_RUN, STUDY_SAMPLE_SENTENCE, chosenCourseId, courseCounts, courseTabLine, draftSentence, latestPlace, lectureDeckContent, lectureFacts,
  lectureHeading, lectureKicker, lectureShortName, otherSynchronisedPlace, readLastPlace, slidesProblem, stoppedSentence, studyPlace, unlinkedSessionsSentence, type TimingLectureRow,
} from "@/features/study/study-facts";
import { factUnits, factsLine } from "@/lib/format";
import { sampleCourseTiming } from "@/lib/fixtures/r2-sample";
import { NBSP } from "@/lib/labels";
import type { CourseLecture, CourseView, ResumeHead, SessionView, WorkspaceCourse } from "@/lib/types";

const plain = (text: string): string => text.split(NBSP).join(" ");

const session = (state: string, kinds: string[], id = "session-1"): SessionView => ({
  session_id: id, date: "2026-09-03", state, linked_lecture_ids: [],
  items: kinds.map((kind, index) => ({ source_id: `src-${id}-${index}`, kind, filename: `${kind}.bin`, state: "registered_readable", registration: "registered", bytes: 10, media_type: null })),
});

const lecture = (over: Partial<CourseLecture> = {}): CourseLecture => ({
  lecture_id: "lecture-03", title: "Sample topic (synthetic)", session_link: "owner_related_sources",
  deck: { source_id: "src-sample-deck-03", kind: "lecture_slides", filename: "Sample topic (synthetic).pdf", state: "registered_readable", registration: "registered", bytes: 1000, media_type: "application/pdf", rendition: "native_pdf" },
  displayable: true, other_materials_count: 0, sessions: [session("transcript_and_recording", ["lecture_transcript", "lecture_recording"])], disposition: "links_pending_review", pages: 91, pages_confirmed: 0,
  pages_suggested: 0, pages_unresolved: null, deck_choice: { state: "selected", basis: "index_kind", candidates: 1 }, questions: { count: 18, collections: ["S03"] }, ...over,
});

const timingRow = (id: string): TimingLectureRow => sampleCourseTiming.lectures.find((row) => row.lecture_id === id)!;

describe("lectureKicker, lectureHeading, lectureShortName", () => {
  it("words the unit id `lecture-03` as “Lecture 03”, the number as the id writes it", () => {
    expect(plain(lectureKicker("lecture-03", "Sample topic")!)).toBe("Lecture 03");
    expect(plain(lectureKicker("lecture-3", "Sample topic")!)).toBe("Lecture 3");
    expect(lectureKicker("lecture-03", "Sample topic")).toContain(NBSP); // one unit
  });

  it("is silent when the title already says the same number, and for an id of another shape", () => {
    expect(lectureKicker("lecture-03", "Fixture Lecture 03 - Cloning workflow")).toBeNull();
    expect(lectureKicker("lecture-03", "lecture 3: cloning")).toBeNull();
    expect(lectureKicker("week-2-intro", "Introduction")).toBeNull();
    expect(lectureKicker("lecture-03", "Lecture 30 overview")).not.toBeNull(); // 30 is not 03
  });

  it("composes the heading and the short name from what is known, never altering the title", () => {
    expect(plain(lectureHeading("lecture-03", "Sample topic"))).toBe("Lecture 03 – Sample topic");
    expect(lectureHeading("lecture-03", "Fixture Lecture 03 - Cloning workflow")).toBe("Fixture Lecture 03 - Cloning workflow");
    expect(plain(lectureHeading("lecture-03", null))).toBe("Lecture 03");
    expect(lectureHeading("week-2-intro", undefined)).toBe("week 2 intro");
    expect(plain(lectureShortName("lecture-03", "Sample topic"))).toBe("Lecture 03");
    expect(plain(lectureShortName("lecture-03", "Fixture Lecture 03 - Cloning workflow"))).toBe("Lecture 03"); // in a sentence the short name is enough
    expect(lectureShortName("week-2-intro", "Introduction")).toBe("Introduction");
  });
});

describe("lectureFacts", () => {
  it("lists pages, the recording with its length, the timing stage and the questions, in that order", () => {
    const facts = lectureFacts(lecture(), timingRow("lecture-90")).map(plain);
    expect(facts).toEqual(["91 pages", "recording 1 h 20 min", "4 ranges", "18 questions"]);
  });

  it("says where the ranges are when the Brain reports the pages of the lecture", () => {
    const row: TimingLectureRow = { ...timingRow("lecture-90"), summary: { pages: 91, pages_with_range: 55 } };
    expect(lectureFacts(lecture(), row).map(plain)).toEqual(["91 pages", "recording 1 h 20 min", "ranges on 55 of 91 pages", "18 questions"]);
  });

  it("words each stage before slide matching in its own words", () => {
    expect(lectureFacts(lecture(), timingRow("lecture-92")).map(plain)).toEqual(["91 pages", "recording 1 h", "not transcribed yet", "18 questions"]);
    expect(lectureFacts(lecture(), timingRow("lecture-91")).map(plain)).toEqual(["91 pages", "recording 1 h 10 min", "transcribed in part", "18 questions"]);
    const processed: TimingLectureRow = { ...timingRow("lecture-90"), stage: "processed", recordings: timingRow("lecture-90").recordings.map((r) => ({ ...r, association: { ...r.association, state: "not_run", ranges: 0 } })) };
    expect(lectureFacts(lecture(), processed).map(plain)).toContain("slides not linked yet");
    const stale: TimingLectureRow = { ...processed, recordings: processed.recordings.map((r) => ({ ...r, association: { ...r.association, state: "stale" } })) };
    expect(lectureFacts(lecture(), stale).map(plain)).toContain("ranges out of date");
    const none: TimingLectureRow = { ...timingRow("lecture-90"), recordings: timingRow("lecture-90").recordings.map((r) => ({ ...r, association: { ...r.association, ranges: 0 } })) };
    expect(lectureFacts(lecture(), none).map(plain)).toContain("no ranges");
  });

  it("shows a stage this build has no words for as recorded, never as the nearest known one", () => {
    const odd = { ...timingRow("lecture-92"), stage: "queued_elsewhere" } as unknown as TimingLectureRow;
    expect(lectureFacts(lecture(), odd).map(plain)).toContain("queued elsewhere");
  });

  it("says missing things in words: no recording, no questions in the catalog, no slides", () => {
    const bare = lecture({ sessions: [], questions: { count: 0, collections: [] } });
    expect(lectureFacts(bare, timingRow("lecture-93")).map(plain)).toEqual(["91 pages", "no recording", "no questions in the catalog"]);
    expect(lectureFacts(lecture({ deck: null, displayable: false, pages: null, deck_choice: { state: "none", basis: null, candidates: 0 } }), timingRow("lecture-93")).map(plain)[0]).toBe("no slides");
  });

  it("tells a recording that exists but is linked to no lecture from a recording that does not exist", () => {
    const unlinked = lecture({ sessions: [], session_link: "none_recorded" });
    expect(lectureFacts(unlinked, timingRow("lecture-93"), { unlinkedRecordings: 2 }).map(plain)).toContain("no recording linked");
    expect(lectureFacts(unlinked, timingRow("lecture-93"), { unlinkedRecordings: 0 }).map(plain)).toContain("no recording");
    // A lecture whose own session has no recording file has no recording, whatever else the course holds.
    expect(lectureFacts(lecture({ sessions: [session("transcript_only_no_recording", ["lecture_transcript"])] }), timingRow("lecture-93"), { unlinkedRecordings: 2 }).map(plain)).toContain("no recording");
  });

  it("without timing data (an older Brain, or still loading) states only what the course view holds, and no length", () => {
    expect(lectureFacts(lecture()).map(plain)).toEqual(["91 pages", "1 recording", "18 questions"]);
    expect(lectureFacts(lecture({ sessions: [session("transcript_only_no_recording", ["lecture_transcript"])] })).map(plain)).toEqual(["91 pages", "no recording", "18 questions"]);
  });

  it("never invents a length: several recordings give a total only when every length is known", () => {
    const two = timingRow("lecture-90").recordings[0]!;
    const known: TimingLectureRow = { ...timingRow("lecture-92"), recordings: [{ ...two, duration_ms: 3_600_000 }, { ...two, source_id: "b", duration_ms: 1_800_000 }] };
    expect(lectureFacts(lecture(), known).map(plain)).toContain("2 recordings (1 h 30 min)");
    const partly: TimingLectureRow = { ...known, recordings: [{ ...two, duration_ms: 3_600_000 }, { ...two, source_id: "b", duration_ms: null }] };
    expect(lectureFacts(lecture(), partly).map(plain)).toContain("2 recordings");
    const unknown: TimingLectureRow = { ...known, recordings: [{ ...two, duration_ms: null }] };
    expect(lectureFacts(lecture(), unknown).map(plain)).toContain("1 recording");
  });

  it("words the slides honestly when they cannot be counted, shown or chosen", () => {
    expect(lectureFacts(lecture({ pages: null, disposition: "not_processed" })).map(plain)[0]).toBe("pages not counted yet");
    expect(lectureFacts(lecture({ pages: null, displayable: false, disposition: "no_source: The deck file is empty (zero bytes)." })).map(plain)[0]).toBe("slides cannot be shown");
    expect(lectureFacts(lecture({ deck: null, pages: null, displayable: false, deck_choice: { state: "unresolved", basis: null, candidates: 2 } })).map(plain)[0]).toBe("2 candidate slide files");
    expect(lectureFacts(lecture({ pages: 1 })).map(plain)[0]).toBe("1 page");
  });

  it("makes a line that breaks only between facts", () => {
    const line = factsLine(lectureFacts(lecture(), timingRow("lecture-90")));
    expect(factUnits(line).map(plain)).toEqual(["91 pages,", "recording 1 h 20 min,", "4 ranges,", "18 questions"]);
  });
});

describe("slidesProblem and lectureDeckContent", () => {
  it("passes on the Brain's own sentence when the slides cannot be shown, and nothing otherwise", () => {
    expect(slidesProblem(lecture())).toBeNull();
    expect(slidesProblem(lecture({ displayable: false, disposition: "no_source: The deck file is empty (zero bytes)." }))).toBe("The deck file is empty (zero bytes).");
    expect(slidesProblem(lecture({ displayable: false, disposition: "blocked: This deck is not a PDF." }))).toBe("This deck is not a PDF.");
    expect(slidesProblem(lecture({ deck: null, displayable: false, deck_choice: { state: "unresolved", basis: null, candidates: 3 } }))).toBe("The course index does not say which file is the lecture deck. Open the lecture to choose one.");
    expect(slidesProblem(lecture({ deck: null, displayable: false, disposition: "no_source" }))).toBeNull(); // "no slides" already says it
  });

  it("names the original PDF of a displayable deck, and nothing for a deck the course view cannot address", () => {
    expect(lectureDeckContent("sample-course", lecture())).toBe("sources/sample-course/src-sample-deck-03/content");
    expect(lectureDeckContent("sample-course", lecture({ displayable: false }))).toBeNull();
    expect(lectureDeckContent("sample-course", lecture({ deck: null }))).toBeNull();
    const rendition = lecture();
    rendition.deck = { ...rendition.deck!, rendition: "needs_rendition" }; // shown through a prepared copy whose path the course view does not carry
    expect(lectureDeckContent("sample-course", rendition)).toBeNull();
    expect(lectureDeckContent("a/b", lecture())).toBe("sources/a%2Fb/src-sample-deck-03/content");
  });
});

describe("courseCounts", () => {
  const course: WorkspaceCourse = { course_id: "sample-course", display_name: "Sample course (synthetic)", binding: "bound", problem: null, lecture_units: 14, catalogued_questions: 120, recorded_attempts: 9 };
  it("is one sentence of real totals", () => {
    expect(courseCounts(course).map(plain)).toEqual(["14 lectures", "120 questions in the catalog", "9 recorded attempts"]);
    expect(plain(`${factsLine(courseCounts(course))}.`)).toBe("14 lectures, 120 questions in the catalog, 9 recorded attempts.");
  });
  it("prefers the course view once it is loaded, and says zero in words", () => {
    const view = { lectures: [lecture()], question_bank: { total: 0, collections: [] }, recorded_attempts: 0 } as unknown as CourseView;
    expect(courseCounts(course, view).map(plain)).toEqual(["1 lecture", "no questions in the catalog", "no recorded attempts"]);
  });
  it("leaves out what is not known (a course that is not bound reports no totals)", () => {
    expect(courseCounts({ course_id: "x", display_name: "X", binding: "unbound", problem: "The folder is missing." })).toEqual([]);
  });
});

describe("the place you left", () => {
  const head = (lectureId: string, page: number, updated: string, positionMs: number | null = null): ResumeHead => ({
    checkpoint_id: "cp-1", device_id: "device-b", session_id: "session-1", sequence: 1,
    cursor: { lecture_id: lectureId, source: { source_id: "src", version_id: "v1", sha256: "0".repeat(64), locator: { kind: "page", page } }, position_ms: positionMs, panel: "slide", draft: null },
    updated_at: updated, parent: null, artifact: { path: "p", sha256: "0".repeat(64), bytes: 1, media_type: "application/json" }, autoplay: false,
  });

  it("reads what the lecture workspace stored, and refuses anything else", () => {
    expect(readLastPlace(JSON.stringify({ lectureId: "lecture-03", page: 23, title: "Sample topic", at: 5 }))).toEqual({ lectureId: "lecture-03", page: 23, title: "Sample topic", at: 5 });
    expect(readLastPlace(null)).toBeNull();
    expect(readLastPlace("not json")).toBeNull();
    expect(readLastPlace(JSON.stringify({ lectureId: "lecture-03", page: "x" }))).toBeNull();
    expect(readLastPlace(JSON.stringify({ lectureId: "", page: 2 }))).toBeNull();
    expect(readLastPlace(JSON.stringify({ lectureId: "lecture-03", page: 0 }))).toBeNull();
  });

  it("is this device's own last place; a checkpoint of the same page adds where the recording stood", () => {
    const local = { lectureId: "lecture-03", page: 23, title: "Sample topic", at: 1_000 };
    expect(studyPlace("c", local, null)).toEqual({ courseId: "c", lectureId: "lecture-03", page: 23, title: "Sample topic", at: 1_000, origin: "this_device", positionMs: null });
    expect(studyPlace("c", local, head("lecture-03", 23, "2026-10-05T12:00:00Z", 1_104_000))!.positionMs).toBe(1_104_000);
    expect(studyPlace("c", local, head("lecture-03", 24, "2026-10-05T12:00:00Z", 1_104_000))!.positionMs).toBeNull(); // another page: not this place
  });

  it("falls back to the synchronised position when this device has opened nothing in the course", () => {
    const place = studyPlace("c", null, head("lecture-02", 3, "2026-10-05T12:00:00Z", null))!;
    expect(place).toMatchObject({ courseId: "c", lectureId: "lecture-02", page: 3, origin: "synchronised", title: null, at: Date.parse("2026-10-05T12:00:00Z") });
    expect(studyPlace("c", null, null)).toBeNull();
  });

  it("offers a synchronised position that differs from this device's place, and only then", () => {
    const local = { lectureId: "lecture-03", page: 23 };
    expect(otherSynchronisedPlace(local, head("lecture-02", 3, "2026-10-05T12:00:00Z"))).toMatchObject({ lectureId: "lecture-02", page: 3 });
    expect(otherSynchronisedPlace(local, head("lecture-03", 23, "2026-10-05T12:00:00Z"))).toBeNull();
    expect(otherSynchronisedPlace(null, head("lecture-02", 3, "2026-10-05T12:00:00Z"))).toBeNull(); // then it IS the place
    expect(otherSynchronisedPlace(local, null)).toBeNull();
  });

  it("resumes at the place opened last on this device; a synchronised position only when the device has none", () => {
    const a = studyPlace("a", { lectureId: "lecture-01", page: 2, at: 10 }, null);
    const b = studyPlace("b", { lectureId: "lecture-05", page: 8, at: 30 }, null);
    const synced = studyPlace("c", null, head("lecture-02", 3, "2030-01-01T00:00:00Z"));
    expect(latestPlace([a, b, synced, null])).toBe(b); // a later clock on another device does not outrank this device
    expect(latestPlace([synced, null])).toBe(synced);
    expect(latestPlace([null, null])).toBeNull();
    const undated = studyPlace("d", { lectureId: "lecture-01", page: 1 }, null);
    expect(latestPlace([undated, a])).toBe(a);
    expect(latestPlace([undated])).toBe(undated);
  });

  it("says where you stopped in the words of the identity line, once", () => {
    const parts = ["PDF page 23 of 91", "build 2 of 3"];
    expect(stoppedSentence({ identityParts: parts, positionMs: null, origin: "this_device", at: 1 })).toBe("You stopped on PDF page 23 of 91 · build 2 of 3.");
    expect(plain(stoppedSentence({ identityParts: parts, positionMs: 1_104_000, origin: "this_device", at: 1 }))).toBe("You stopped on PDF page 23 of 91 · build 2 of 3, with the recording paused at 18:24.");
    // A synchronised position is worded as what it is, a finished session; which device finished it is not claimed.
    expect(stoppedSentence({ identityParts: ["PDF page 3 of 3"], positionMs: null, origin: "synchronised", at: null })).toBe("Your last finished session stopped on PDF page 3 of 3.");
  });

  it("mentions an unsent draft only when there is one", () => {
    expect(draftSentence(0)).toBeNull();
    expect(draftSentence(1)).toBe("One unsent draft is kept in Tutor.");
    expect(plain(draftSentence(2)!)).toBe("2 unsent drafts are kept in Tutor.");
  });
});

describe("courseTabLine", () => {
  it("says where the course was left, or that it was not opened on this device", () => {
    const place = { courseId: "c", lectureId: "lecture-03", page: 23, title: "Sample topic", at: 1, origin: "this_device" as const, positionMs: null };
    expect(plain(courseTabLine(place, { bound: true, conflict: false }))).toBe("Left at Lecture 03, page 23");
    expect(factUnits(courseTabLine(place, { bound: true, conflict: false })).map(plain)).toEqual(["Left", "at", "Lecture 03,", "page 23"]);
    expect(courseTabLine(null, { bound: true, conflict: false })).toBe("Not opened on this device");
    expect(plain(courseTabLine({ ...place, origin: "synchronised" }, { bound: true, conflict: false }))).toBe("Left at Lecture 03, page 23 in a finished session");
  });
  it("puts a state that needs the learner before the place", () => {
    expect(courseTabLine(null, { bound: false, conflict: false })).toBe("Not bound: this course cannot be opened");
    expect(courseTabLine(null, { bound: true, conflict: true })).toBe("Two study positions need your choice");
  });
});

describe("unlinkedSessionsSentence", () => {
  const view = (sessions: SessionView[]): CourseView => ({ unlinked_sessions: sessions } as unknown as CourseView);
  it("is silent when every dated session is linked", () => {
    expect(unlinkedSessionsSentence(view([]))).toBeNull();
  });
  it("counts the sessions, and those among them that hold a recording, without pairing any", () => {
    expect(plain(unlinkedSessionsSentence(view([session("empty_unrecorded", [])]))!)).toBe("1 dated session is not linked to a lecture by the course records. No pairing is assumed.");
    expect(plain(unlinkedSessionsSentence(view([session("transcript_and_recording", ["lecture_transcript", "lecture_recording"], "a"), session("transcript_only_no_recording", ["lecture_transcript"], "b")]))!))
      .toBe("2 dated sessions are not linked to a lecture by the course records, 1 of them with a recording. No pairing is assumed.");
    expect(plain(unlinkedSessionsSentence(view([session("recording_only_no_transcript", ["lecture_recording"])]))!)).toBe("1 dated session with a recording is not linked to a lecture by the course records. No pairing is assumed.");
  });
});

describe("chosenCourseId", () => {
  const courses = [{ course_id: "a" }, { course_id: "b" }, { course_id: "c" }];
  it("is the course asked for, then the active course, then the first", () => {
    expect(chosenCourseId(courses, "b", "c")).toBe("b");
    expect(chosenCourseId(courses, null, "c")).toBe("c");
    expect(chosenCourseId(courses, "zzz", "c")).toBe("c");
    expect(chosenCourseId(courses, null, undefined)).toBe("a");
    expect(chosenCourseId([], null, "c")).toBeNull();
  });
});

describe("fixed sentences of the page", () => {
  it("are the specification's words", () => {
    expect(STUDY_FIRST_RUN).toBe("Nothing has been opened on this device yet. Choose a lecture below. Your place is remembered from then on.");
    expect(STUDY_SAMPLE_SENTENCE).toBe("These are synthetic sample courses, not your own.");
    expect(STUDY_CLOSING_LINE).toBe("The numbers say what exists and what was recorded. They do not measure what you know.");
    expect(NO_LECTURES_SENTENCE).toBe("No lectures are registered for this course.");
  });
});
