// What the Study home says (design specification 6, 9.11): the facts of a lecture row, the sentence of a course, the
// line of a course tab and the place you left. Pure functions over the read API; no component, no storage.
//
// Rules kept here so they cannot be forgotten in one place:
//   - every fact is real data of a view; a missing thing is said in words ("no recording"), an unknown thing is not said
//     as zero and no length, page count or progress is ever invented;
//   - each fact is one unbreakable unit (lib/format `factsLine` joins them), so a line breaks only between facts;
//   - "Lecture 03" is the unit id as written, never a slide or page number, and a title is never altered.
import { MIDDLE_DOT } from "@/lib/format";
import { clockLabel, countLabel, durationLabel, nb, unlistedLabel } from "@/lib/labels";
import type { CourseLecture, CourseTimingView, CourseView, ResumeHead, TimingStage, TimingSummary, WorkspaceCourse } from "@/lib/types";

// ---- fixed sentences of the page (design specification 6) ---------------------------------------------------------------
export const STUDY_FIRST_RUN = "Nothing has been opened on this device yet. Choose a lecture below. Your place is remembered from then on.";
/** Said once under the title when the profile is not the learner's own courses (R2-B3). */
export const STUDY_SAMPLE_SENTENCE = "These are synthetic sample courses, not your own.";
export const STUDY_CLOSING_LINE = "The numbers say what exists and what was recorded. They do not measure what you know.";
export const NO_LECTURES_SENTENCE = "No lectures are registered for this course.";
export const RESUME_ACTION = "Resume lecture";
export const START_ACTION = "Start from page 1";
export const RESUME_PICTURE_LABEL = "Open the lecture at the page you left";
/** The one muted line of a first load that takes longer than two seconds (the Brain reads the course folders over a synced drive). */
export const STUDY_READING_LINE = "Reading your course folders…";

// ---- a lecture's name ----------------------------------------------------------------------------------------------------
const UNIT_ID = /^lecture-(\d+)$/i;

/**
 * "Lecture 03" for the unit id `lecture-03`, with the number as the id writes it. Null for an id of another shape, and
 * when the title already carries the same lecture number (the title then says it and nothing is repeated).
 */
export function lectureKicker(lectureId: string, title?: string | null): string | null {
  const digits = UNIT_ID.exec(lectureId)?.[1];
  if (!digits) return null;
  // The word "lecture" on its own, then the same number, not followed by another digit. A title written like a file name
  // ("Lecture_3_Topic") says it too: an underscore after the number is no part of it.
  const said = new RegExp(`(?<![A-Za-z])lecture[\\s_-]*0*${Number(digits)}(?![0-9])`, "i");
  return title && said.test(title) ? null : nb(`Lecture ${digits}`);
}
const idWords = (lectureId: string): string => lectureId.replace(/[-_]+/g, " ");
/** The lecture as a heading: "Lecture 03 – Example topic", or the title alone when it already names the lecture. */
export function lectureHeading(lectureId: string, title?: string | null): string {
  const kicker = lectureKicker(lectureId, title);
  if (title) return kicker ? `${kicker} – ${title}` : title;
  return kicker ?? idWords(lectureId);
}
/** The lecture inside a sentence: "Lecture 03" where the unit id says so (whatever the title repeats), otherwise its title. */
export function lectureShortName(lectureId: string, title?: string | null): string {
  return lectureKicker(lectureId) ?? title ?? idWords(lectureId);
}

// ---- the facts of a lecture row --------------------------------------------------------------------------------------------
/** A lecture of `GET …/timing`. `summary` is read when a Brain sends it for a lecture; today's does not. */
export type TimingLectureRow = CourseTimingView["lectures"][number] & { summary?: Partial<Pick<TimingSummary, "pages" | "pages_with_range">> | null };

/** The stage of a lecture's timing as one fact of the row; the two ends of the scale are worded from their own data. */
export const STUDY_STAGE_FACT: Record<TimingStage, string | null> = {
  no_recording: null, // the recording fact says it
  audio_unprocessed: "not transcribed yet",
  partly_processed: "transcribed in part",
  processed: "slides not linked yet",
  associated: null, // the ranges say it
};

const sessionRecordings = (lecture: CourseLecture): number => lecture.sessions.reduce((count, session) => count + session.items.filter((item) => item.kind === "lecture_recording").length, 0);

function slidesFact(lecture: CourseLecture): string {
  if (!lecture.deck) return lecture.deck_choice.state === "unresolved" ? `${lecture.deck_choice.candidates} candidate slide files` : "no slides";
  if (typeof lecture.pages === "number") return countLabel(lecture.pages, "page");
  return lecture.displayable ? "pages not counted yet" : "slides cannot be shown";
}

function recordingFact(lecture: CourseLecture, timing: TimingLectureRow | null | undefined, unlinkedRecordings: number): string {
  const count = timing ? timing.recordings.length : sessionRecordings(lecture);
  if (count === 0) return lecture.sessions.length === 0 && unlinkedRecordings > 0 ? "no recording linked" : "no recording";
  const lengths = timing ? timing.recordings.map((recording) => recording.duration_ms) : [];
  const known = lengths.length === count && lengths.every((ms): ms is number => typeof ms === "number" && ms > 0);
  if (!known) return countLabel(count, "recording");
  const total = durationLabel((lengths as number[]).reduce((sum, ms) => sum + ms, 0));
  return count === 1 ? `recording ${total}` : `${countLabel(count, "recording")} (${total})`;
}

function stageFact(timing: TimingLectureRow | null | undefined): string | null {
  if (!timing || timing.recordings.length === 0) return null;
  if (timing.stage === "associated") {
    const pages = timing.summary?.pages;
    const withRange = timing.summary?.pages_with_range;
    if (typeof pages === "number" && typeof withRange === "number" && pages > 0) return `ranges on ${withRange} of ${countLabel(pages, "page")}`;
    const ranges = timing.recordings.reduce((sum, recording) => sum + (recording.association.state === "current" ? recording.association.ranges ?? 0 : 0), 0);
    return ranges > 0 ? countLabel(ranges, "range") : "no ranges";
  }
  if (timing.stage === "processed" && timing.recordings.some((recording) => recording.association.state === "stale")) return "ranges out of date";
  if (timing.stage in STUDY_STAGE_FACT) return STUDY_STAGE_FACT[timing.stage];
  return unlistedLabel(String(timing.stage)); // a value this build has no words for is shown as recorded (9.1)
}

/**
 * Said after the recording of a lecture whose session the course records link to no unit: the session is offered only
 * because the file name of its recording or transcript carries this unit's lecture number (`session_link`
 * `suggested_by_file_name`, read API 1.1). Nobody has confirmed it, so the row says where the pairing comes from.
 */
export const OFFERED_BY_FILE_NAME = nb("offered by file name");
function offeredFact(lecture: CourseLecture, timing: TimingLectureRow | null | undefined): string | null {
  if (lecture.session_link !== "suggested_by_file_name") return null;
  return (timing ? timing.recordings.length : sessionRecordings(lecture)) > 0 ? OFFERED_BY_FILE_NAME : null;
}

/**
 * True for a lecture whose session holds a recording: the timing answer will say its length and where its timing stands.
 * While that answer is on its way the row keeps a place for those words, so it does not change height when they arrive.
 */
export const awaitsTimingFact = (lecture: CourseLecture): boolean => sessionRecordings(lecture) > 0;

/**
 * The facts of one lecture row, in order: its pages, its recording (with the length where the Brain measured it, and
 * "offered by file name" where the session is only suggested), where its timing stands, its questions. `timing` is the
 * lecture's row of `GET …/timing`; without it only what the course view holds is said. `unlinkedRecordings`: recordings
 * of the course that sit in dated sessions linked to no lecture. The questions fact is always the last one.
 */
export function lectureFacts(lecture: CourseLecture, timing?: TimingLectureRow | null, options: { unlinkedRecordings?: number } = {}): string[] {
  const facts: Array<string | null> = [
    slidesFact(lecture),
    recordingFact(lecture, timing, options.unlinkedRecordings ?? 0),
    offeredFact(lecture, timing),
    stageFact(timing),
    lecture.questions.count > 0 ? countLabel(lecture.questions.count, "question") : "no questions in the catalog",
  ];
  return facts.filter((fact): fact is string => !!fact);
}

/** Why the slides of a lecture cannot be shown, in the Brain's own sentence; null when they can, or when there are none. */
export function slidesProblem(lecture: CourseLecture): string | null {
  if (lecture.displayable) return null;
  if (!lecture.deck) return lecture.deck_choice.state === "unresolved" ? "The course index does not say which file is the lecture deck. Open the lecture to choose one." : null;
  const [kind, ...rest] = lecture.disposition.split(":");
  const detail = rest.join(":").trim();
  return (kind === "no_source" || kind === "blocked") && detail ? detail : null;
}

/**
 * The content path of the lecture's displayed deck when it is the original PDF (the path the lecture view states as
 * `display.content`); null when the lecture has no deck that can be shown, or is shown through a prepared copy whose
 * path the course view does not carry. A row then keeps its neutral placeholder.
 */
export function lectureDeckContent(courseId: string, lecture: CourseLecture): string | null {
  if (!lecture.deck || !lecture.displayable || lecture.deck.rendition !== "native_pdf") return null;
  return `sources/${encodeURIComponent(courseId)}/${encodeURIComponent(lecture.deck.source_id)}/content`;
}

// ---- a course ----------------------------------------------------------------------------------------------------------------
/** The facts of the course sentence: "14 lectures, 120 questions in the catalog, 9 recorded attempts." Real totals only. */
export function courseCounts(course: WorkspaceCourse, view?: Pick<CourseView, "lectures" | "question_bank" | "recorded_attempts"> | null): string[] {
  const lectures = view ? view.lectures.length : course.lecture_units;
  const questions = view ? view.question_bank.total : course.catalogued_questions;
  const attempts = view ? view.recorded_attempts : course.recorded_attempts;
  const facts: string[] = [];
  if (typeof lectures === "number") facts.push(lectures > 0 ? countLabel(lectures, "lecture") : "no lectures");
  if (typeof questions === "number") facts.push(questions > 0 ? `${countLabel(questions, "question")} in the catalog` : "no questions in the catalog");
  if (typeof attempts === "number") facts.push(attempts > 0 ? countLabel(attempts, "recorded attempt") : "no recorded attempts");
  return facts;
}

/** Recordings that sit in dated sessions the course records link to no lecture. */
export const unlinkedRecordingCount = (view: Pick<CourseView, "unlinked_sessions"> | null | undefined): number =>
  (view?.unlinked_sessions ?? []).filter((session) => session.items.some((item) => item.kind === "lecture_recording")).length;

/** One sentence for dated sessions that belong to no lecture by the course records; null when there are none. Nothing is paired by date. */
export function unlinkedSessionsSentence(view: Pick<CourseView, "unlinked_sessions">): string | null {
  const total = view.unlinked_sessions.length;
  if (total === 0) return null;
  const recorded = unlinkedRecordingCount(view);
  const verb = total === 1 ? "is" : "are";
  const head = recorded === total ? `${countLabel(total, "dated session")} with a recording ${verb}` : `${countLabel(total, "dated session")} ${verb}`;
  const tail = recorded > 0 && recorded < total ? `, ${recorded} of them with a recording` : "";
  return `${head} not linked to a lecture by the course records${tail}. No pairing is assumed.`;
}

// ---- the names kept on this device for the first frame ---------------------------------------------------------------------
/**
 * What the Study home keeps of the last successful load of the workspace (`ll.study.courses`), so the next first frame
 * shows the courses at once instead of grey blocks: each course's id, name and binding, and how many lecture rows its
 * pane has (the size of the skeleton only). No count is kept that the page would show as a fact: totals are said only
 * from an answer of the Brain.
 */
export interface RememberedCourse { course_id: string; display_name: string; binding: string; problem: string | null; rows: number | null }
export interface RememberedCourses { sample: boolean; courses: RememberedCourse[] }

export function coursesToRemember(workspace: { fixture_label?: string | null; courses: readonly WorkspaceCourse[] }): string {
  const kept: RememberedCourses = {
    sample: !!workspace.fixture_label,
    courses: workspace.courses.map((course) => ({ course_id: course.course_id, display_name: course.display_name, binding: course.binding, problem: course.problem ?? null,
      rows: typeof course.lecture_units === "number" ? course.lecture_units : null })),
  };
  return JSON.stringify(kept);
}

/** Parses what `coursesToRemember` wrote; anything else (and an empty list) is refused, and the page draws its skeleton. */
export function readRememberedCourses(raw: string | null | undefined): RememberedCourses | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { sample?: unknown; courses?: unknown } | null;
    if (!value || typeof value !== "object" || !Array.isArray(value.courses) || value.courses.length === 0) return null;
    const courses: RememberedCourse[] = [];
    for (const entry of value.courses as Array<Partial<RememberedCourse> | null>) {
      if (!entry || typeof entry.course_id !== "string" || entry.course_id === "" || typeof entry.display_name !== "string" || typeof entry.binding !== "string") return null;
      courses.push({ course_id: entry.course_id, display_name: entry.display_name, binding: entry.binding, problem: typeof entry.problem === "string" ? entry.problem : null,
        rows: typeof entry.rows === "number" && Number.isInteger(entry.rows) && entry.rows >= 0 ? entry.rows : null });
    }
    return { sample: value.sample === true, courses };
  } catch {
    return null;
  }
}

const LAST_PLACE_KEY = "ll.last.";
/** The course of a place stored by the lecture workspace, from its storage key `ll.last.<course>`; null for any other key. */
export function storedPlaceCourse(key: string): string | null {
  return key.startsWith(LAST_PLACE_KEY) && key.length > LAST_PLACE_KEY.length ? key.slice(LAST_PLACE_KEY.length) : null;
}

/** The course to show: the one asked for (a route or a chosen tab), then the active course, then the first configured. */
export function chosenCourseId(courses: ReadonlyArray<{ course_id: string }>, wanted: string | null | undefined, active: string | null | undefined): string | null {
  const has = (id: string | null | undefined): id is string => !!id && courses.some((course) => course.course_id === id);
  return has(wanted) ? wanted : has(active) ? active : courses[0]?.course_id ?? null;
}

// ---- the place you left -------------------------------------------------------------------------------------------------------
/** What the lecture workspace stores per course on this device (`ll.last.<course>`). */
export interface LastPlace { lectureId: string; page: number; title?: string; at?: number }
export interface StudyPlace {
  courseId: string;
  lectureId: string;
  page: number;
  /** The title as stored with the place; null for a synchronised position (the lecture view names it). */
  title: string | null;
  /** When the place was left, in ms; null when not recorded. */
  at: number | null;
  /** `synchronised`: nothing was opened on this device; the position comes from a finished session's checkpoint. */
  origin: "this_device" | "synchronised";
  /** Where the recording stood in the checkpoint of this very page; null when no checkpoint says. */
  positionMs: number | null;
}

/** Parses a stored place; anything that is not a lecture id with a page from 1 is refused. */
export function readLastPlace(raw: string | null | undefined): LastPlace | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LastPlace> | null;
    if (!value || typeof value.lectureId !== "string" || value.lectureId === "" || !Number.isInteger(value.page) || (value.page as number) < 1) return null;
    return { lectureId: value.lectureId, page: value.page as number, ...(typeof value.title === "string" ? { title: value.title } : {}), ...(typeof value.at === "number" ? { at: value.at } : {}) };
  } catch {
    return null;
  }
}

const headPage = (head: ResumeHead): number => {
  const page = (head.cursor.source.locator as { page?: unknown }).page;
  return typeof page === "number" && Number.isInteger(page) && page >= 1 ? page : 1;
};

/**
 * The place of one course: this device's own last place, or, when the device has opened nothing in the course, the
 * position a finished session synchronised. Clocks of different devices are never compared to pick one.
 */
export function studyPlace(courseId: string, local: LastPlace | null, head: ResumeHead | null | undefined): StudyPlace | null {
  if (local) {
    const same = !!head && head.cursor.lecture_id === local.lectureId && headPage(head) === local.page;
    return { courseId, lectureId: local.lectureId, page: local.page, title: local.title ?? null, at: local.at ?? null, origin: "this_device", positionMs: same ? head.cursor.position_ms : null };
  }
  if (!head) return null;
  const at = Date.parse(head.updated_at);
  return { courseId, lectureId: head.cursor.lecture_id, page: headPage(head), title: null, at: Number.isNaN(at) ? null : at, origin: "synchronised", positionMs: head.cursor.position_ms };
}

/** A synchronised position that is not this device's place (another lecture or page); null when there is none or it is the same. */
export function otherSynchronisedPlace(local: Pick<LastPlace, "lectureId" | "page"> | null, head: ResumeHead | null | undefined): { lectureId: string; page: number; updatedAt: string } | null {
  if (!local || !head) return null;
  const page = headPage(head);
  return head.cursor.lecture_id === local.lectureId && page === local.page ? null : { lectureId: head.cursor.lecture_id, page, updatedAt: head.updated_at };
}

/** Where Resume leads: the place opened last on this device; a synchronised position only when the device has none. */
export function latestPlace(places: ReadonlyArray<StudyPlace | null | undefined>): StudyPlace | null {
  const newest = (origin: StudyPlace["origin"]): StudyPlace | null => places.reduce<StudyPlace | null>((best, place) => {
    if (!place || place.origin !== origin) return best;
    return !best || (place.at ?? -Infinity) > (best.at ?? -Infinity) ? place : best;
  }, null);
  return newest("this_device") ?? newest("synchronised");
}

/**
 * "You stopped on PDF page 23 of 91 · build 2 of 3, with the recording paused at 18:24." The identity parts are those
 * of lib/r2 `identityOf`. A synchronised position is worded as a finished session; which device finished it is not claimed.
 */
export function stoppedSentence(place: { identityParts: readonly string[]; positionMs: number | null; origin: StudyPlace["origin"]; at: number | null }): string {
  const where = place.identityParts.join(` ${MIDDLE_DOT} `);
  const lead = place.origin === "synchronised" ? "Your last finished session stopped on" : "You stopped on";
  const recording = typeof place.positionMs === "number" ? `, with the recording paused ${nb(`at ${clockLabel(place.positionMs)}`)}` : "";
  return `${lead} ${where}${recording}.`;
}

/** "One unsent draft is kept in Tutor."; null when there is none. */
export function draftSentence(drafts: number): string | null {
  if (drafts <= 0) return null;
  return drafts === 1 ? "One unsent draft is kept in Tutor." : `${countLabel(drafts, "unsent draft")} are kept in Tutor.`;
}

/** The second line of a course tab: a state that needs the learner first, then where the course was left. */
export function courseTabLine(place: StudyPlace | null, state: { bound: boolean; conflict: boolean }): string {
  if (!state.bound) return "Not bound: this course cannot be opened";
  if (state.conflict) return "Two study positions need your choice";
  if (!place) return "Not opened on this device";
  const name = lectureKicker(place.lectureId) ?? place.title ?? nb(idWords(place.lectureId));
  return `Left at ${name}, ${nb(`page ${place.page}`)}${place.origin === "synchronised" ? ` ${nb("in a finished session")}` : ""}`;
}
