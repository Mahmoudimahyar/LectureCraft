// The Study home as rendered (design specification 6): what it says to assistive technology and which links it offers.
// jsdom: structure, names and addresses, not pixels (those are looked at in a browser). Page pictures are not drawn here
// (lib/thumbs is replaced), so every row shows its neutral placeholder. All data is synthetic.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { Tabs } from "radix-ui";
import type { ReactElement } from "react";
import { sampleCourseTiming, sampleLectureView, SAMPLE_COURSE_ID, SAMPLE_LECTURE_ID } from "@/lib/fixtures/r2-sample";
import { NBSP } from "@/lib/labels";
import type { CourseLecture, CourseView, ResumeHead, ResumeState, SessionView, WorkspaceCourse, WorkspaceView } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  app: { current: null as unknown },
  course: vi.fn(),
  timing: vi.fn(),
  lecture: vi.fn(),
  resume: vi.fn(),
  draft: vi.fn(),
  thumb: vi.fn(),
  near: { current: false },
}));
vi.mock("@/app/state", () => ({ useApp: () => mocks.app.current }));
vi.mock("@/lib/queries", () => ({ useCourse: (id?: string) => mocks.course(id), useCourseTiming: (id?: string) => mocks.timing(id), useLecture: (c?: string, l?: string, d?: string | null) => mocks.lecture(c, l, d) }));
vi.mock("@/lib/api", () => ({ apiGet: (path: string) => mocks.resume(path), contentUrl: (relative: string) => `/api/${relative}` }));
vi.mock("@/lib/db", () => ({ getDraft: (id: string) => mocks.draft(id) }));
vi.mock("@/lib/thumbs", () => ({
  useNearViewport: () => [{ current: null }, mocks.near.current], useFirstPageShape: () => null, cachedThumb: () => null,
  requestThumb: (url: string, page: number) => mocks.thumb(url, page),
}));

import { CoursePane, CourseTabs, LectureRow } from "@/features/study/CourseBrowser";
import { ResumeFirstRun, ResumeView } from "@/features/study/ResumeBlock";
import { CourseLectures, StudyHome } from "@/features/study/StudyPages";
import { NO_LECTURES_SENTENCE, STUDY_CLOSING_LINE, STUDY_FIRST_RUN, STUDY_READING_LINE, STUDY_SAMPLE_SENTENCE, coursesToRemember, readRememberedCourses, type TimingLectureRow } from "@/features/study/study-facts";

const text = (element: Element | null): string => (element?.textContent ?? "").split(NBSP).join(" ");
/** Matches an accessible name whatever kind of space holds its units together. */
const named = (name: string) => (accessibleName: string) => accessibleName.split(NBSP).join(" ") === name;

const session = (kinds: string[], id = "session-1"): SessionView => ({
  session_id: id, date: "2026-09-03", state: "transcript_and_recording", linked_lecture_ids: [],
  items: kinds.map((kind, index) => ({ source_id: `src-${id}-${index}`, kind, filename: `${kind}.bin`, state: "registered_readable", registration: "registered", bytes: 10, media_type: null })),
});
const lecture = (id: string, title: string, over: Partial<CourseLecture> = {}): CourseLecture => ({
  lecture_id: id, title, session_link: "owner_related_sources",
  deck: { source_id: `src-${id}-slides`, kind: "lecture_slides", filename: `${title}.pdf`, state: "registered_readable", registration: "registered", bytes: 1000, media_type: "application/pdf", rendition: "native_pdf" },
  displayable: true, other_materials_count: 0, sessions: [session(["lecture_transcript", "lecture_recording"])], disposition: "links_pending_review", pages: 12, pages_confirmed: 0, pages_suggested: 0,
  pages_unresolved: null, deck_choice: { state: "selected", basis: "index_kind", candidates: 1 }, questions: { count: 8, collections: ["S90"] }, ...over,
});
const course = (id: string, name: string, over: Partial<WorkspaceCourse> = {}): WorkspaceCourse => ({ course_id: id, display_name: name, binding: "bound", problem: null, lecture_units: 2, catalogued_questions: 8, recorded_attempts: 0, ...over });
const COURSES: WorkspaceCourse[] = [
  course(SAMPLE_COURSE_ID, "Sample course A (synthetic)", { recorded_attempts: 3 }),
  course("sample-b", "Sample course B (synthetic)", { catalogued_questions: 0 }),
  course("sample-c", "Sample course C (synthetic)"),
  course("sample-d", "Sample course D (synthetic)"),
  { course_id: "sample-e", display_name: "Sample course E (synthetic)", binding: "unbound", problem: "The course folder is not on this PC." },
];
const courseView = (id: string, over: Partial<CourseView> = {}): CourseView => ({
  course_id: id, display_name: COURSES.find((c) => c.course_id === id)?.display_name ?? id, index: { status: "ok" },
  lectures: [lecture(SAMPLE_LECTURE_ID, "Sample lecture 90 (synthetic)"), lecture("lecture-93", "Reading group notes (synthetic)", { sessions: [], questions: { count: 0, collections: [] }, pages: 3 })],
  unlinked_sessions: [], other_sources: [], recorded_attempts: 3, learning_view_status: "current", enumeration_truncated: false, question_bank: { total: 8, collections: [] }, ...over,
});
const query = <T,>(data: T | undefined, over: Record<string, unknown> = {}) => ({ data, isLoading: false, isError: false, error: null, refetch: vi.fn(), ...over });
const noResume = (id: string): ResumeState => ({ course_id: id, current: null, conflict: null, checkpoints: 0 });
const head = (lectureId: string, page: number, positionMs: number | null = null): ResumeHead => ({
  checkpoint_id: "cp-1", device_id: "device-b", session_id: "session-1", sequence: 1,
  cursor: { lecture_id: lectureId, source: { source_id: "src", version_id: "v1", sha256: "0".repeat(64), locator: { kind: "page", page } }, position_ms: positionMs, panel: "slide", draft: null },
  updated_at: "2026-10-05T12:00:00Z", parent: null, artifact: { path: "p", sha256: "0".repeat(64), bytes: 1, media_type: "application/json" }, autoplay: false,
});

function setApp(over: Record<string, unknown> = {}) {
  const workspace = { profile: "fixture", fixture_label: "SAMPLE PROFILE", term: "2026-fall", courses: COURSES } as unknown as WorkspaceView;
  mocks.app.current = { workspace, workspaceLoading: false, workspaceError: null, courseId: SAMPLE_COURSE_ID, setCourseId: vi.fn(), pairing: { state: "paired" }, ...over };
  return mocks.app.current as { setCourseId: ReturnType<typeof vi.fn> };
}

function Where() {
  const location = useLocation();
  return <span data-testid="where">{location.pathname + location.search}</span>;
}
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
function page(element: ReactElement, at = "/study", client: QueryClient = newClient()) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route path="study" element={element} />
          <Route path="courses/:courseId" element={<CourseLectures />} />
          <Route path="*" element={<p>another page</p>} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const inRouter = (element: ReactElement) => render(<MemoryRouter>{element}</MemoryRouter>);

beforeEach(() => {
  window.localStorage.clear();
  mocks.course.mockReset().mockImplementation((id?: string) => query(id ? courseView(id) : undefined));
  mocks.timing.mockReset().mockImplementation((id?: string) => query(id === SAMPLE_COURSE_ID ? sampleCourseTiming : undefined));
  mocks.lecture.mockReset().mockImplementation((c?: string, l?: string) => query(c && l ? sampleLectureView : undefined));
  mocks.resume.mockReset().mockImplementation(async (path: string) => noResume(path.split("/")[1]!));
  mocks.draft.mockReset().mockResolvedValue(undefined);
  mocks.thumb.mockReset().mockImplementation(() => new Promise(() => undefined)); // a picture that is still being made
  mocks.near.current = false;
  setApp();
});

describe("ResumeView", () => {
  const props = { courseName: "Sample course A (synthetic)", heading: "Lecture 90 – Sample lecture", sentence: "You stopped on PDF page 4 of 12 · build 2 of 3.", draft: null,
    resumeHref: "/courses/sample-course/lectures/lecture-90?page=4", startHref: "/courses/sample-course/lectures/lecture-90?page=1", picture: null, shape: null };

  it("names the course, the lecture and where you stopped, with one primary and one neutral action", () => {
    inRouter(<ResumeView {...props} draft="One unsent draft is kept in Tutor." />);
    const resume = screen.getByRole("region", { name: "Resume" });
    expect(within(resume).getByText("Resume in Sample course A (synthetic)")).toBeInTheDocument();
    expect(within(resume).getByRole("heading", { level: 2, name: "Lecture 90 – Sample lecture" })).toBeInTheDocument();
    expect(within(resume).getByTestId("resume-where")).toHaveTextContent("You stopped on PDF page 4 of 12 · build 2 of 3. One unsent draft is kept in Tutor.");
    const primary = within(resume).getByRole("link", { name: "Resume lecture" });
    expect(primary).toHaveAttribute("href", "/courses/sample-course/lectures/lecture-90?page=4");
    expect(primary).toHaveClass("ll-btn-primary");
    const start = within(resume).getByRole("link", { name: "Start from page 1" });
    expect(start).toHaveAttribute("href", "/courses/sample-course/lectures/lecture-90?page=1");
    expect(start).not.toHaveClass("ll-btn-primary"); // one primary button per view
  });

  it("makes the picture a link to the same place, and draws no fake page while there is no picture", () => {
    inRouter(<ResumeView {...props} />);
    const picture = screen.getByRole("link", { name: "Open the lecture at the page you left" });
    expect(picture).toHaveAttribute("href", props.resumeHref);
    expect(picture.querySelector("img")).toBeNull();
  });

  it("shows the rendered page when there is one, and no second action on the first page", () => {
    inRouter(<ResumeView {...props} startHref={null} picture={{ src: "blob:sample", width: 600, height: 450 }} />);
    expect(screen.getByRole("link", { name: "Open the lecture at the page you left" }).querySelector("img")).toHaveAttribute("src", "blob:sample");
    expect(screen.queryByRole("link", { name: "Start from page 1" })).toBeNull();
  });

  it("shows a picture that is still being made as loading, and keeps a place for a course name it does not know yet", () => {
    const { rerender } = inRouter(<ResumeView {...props} pictureLoading courseName={null} />);
    const picture = screen.getByTestId("resume-picture");
    expect(picture.querySelector('[data-state="loading"]')).not.toBeNull();
    expect(screen.getByText(/^Resume in/).querySelector('[data-pending="course"]')).not.toBeNull();
    rerender(<MemoryRouter><ResumeView {...props} /></MemoryRouter>);
    expect(screen.getByTestId("resume-picture").querySelector('[data-state="loading"]')).toBeNull(); // no picture will come: a still block
    expect(screen.getByText("Resume in Sample course A (synthetic)")).toBeInTheDocument();
  });

  it("is one sentence on a first run", () => {
    render(<ResumeFirstRun />);
    expect(screen.getByText(STUDY_FIRST_RUN)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("CourseTabs", () => {
  it("is one tab list of the courses, each with its name and where it was left; the chosen one is selected", () => {
    render(
      <Tabs.Root value="b" orientation="vertical">
        <CourseTabs chosen="b" items={[{ courseId: "a", name: "Course A", line: "Not opened on this device" }, { courseId: "b", name: "Course B", line: "Left at Lecture 03, page 23" }]} />
      </Tabs.Root>,
    );
    const list = screen.getByRole("tablist", { name: "Courses" });
    expect(list).toHaveAttribute("aria-orientation", "vertical");
    const tabs = within(list).getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(tabs[0]).toHaveTextContent("Course A");
    expect(tabs[0]).toHaveTextContent("Not opened on this device");
    expect(tabs[1]).toHaveTextContent("Left at Lecture 03, page 23");
  });
});

describe("LectureRow", () => {
  const timingOf = (id: string): TimingLectureRow => sampleCourseTiming.lectures.find((row) => row.lecture_id === id)!;

  it("is one link named by the lecture, described by its facts, to the lecture", () => {
    inRouter(<ul><LectureRow courseId="sample-course" lecture={lecture("lecture-90", "Sample topic (synthetic)")} timing={timingOf("lecture-90")} leftAt={null} /></ul>);
    const link = screen.getByRole("link", { name: named("Lecture 90 – Sample topic (synthetic)") });
    expect(link).toHaveAttribute("href", "/courses/sample-course/lectures/lecture-90");
    expect(text(document.getElementById(link.getAttribute("aria-describedby")!))).toBe("12 pages, recording 1 h 20 min, 4 ranges, 8 questions");
    expect(link.querySelector("img")).toBeNull(); // no picture yet: the neutral placeholder
    expect(link.querySelector('[data-thumb="placeholder"]')).not.toBeNull();
  });

  it("marks the row you left and opens it at that page", () => {
    inRouter(<ul><LectureRow courseId="sample-course" lecture={lecture("lecture-90", "Sample topic (synthetic)")} leftAt={7} /></ul>);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/courses/sample-course/lectures/lecture-90?page=7");
    expect(text(link)).toContain("You left this at page 7");
  });

  it("writes “No slides” in the placeholder of a lecture without a deck and says why slides cannot be shown", () => {
    inRouter(
      <ul>
        <LectureRow courseId="c" lecture={lecture("lecture-01", "Notes only (synthetic)", { deck: null, displayable: false, pages: null, disposition: "no_source" })} leftAt={null} />
        <LectureRow courseId="c" lecture={lecture("lecture-02", "Slides file (synthetic)", { displayable: false, pages: null, disposition: "blocked: This deck is not a PDF." })} leftAt={null} />
      </ul>,
    );
    const [none, blocked] = screen.getAllByRole("listitem");
    expect(text(none!.querySelector('[data-thumb="placeholder"]'))).toBe("No slides");
    expect(text(none!)).toContain("no slides, 1 recording, 8 questions");
    expect(text(blocked!.querySelector('[data-thumb="placeholder"]'))).toBe("");
    expect(text(blocked!)).toContain("slides cannot be shown");
    expect(text(blocked!)).toContain("This deck is not a PDF.");
  });

  it("names every row by one line: a title that already says the lecture number stands alone", () => {
    inRouter(
      <ul>
        <LectureRow courseId="c" lecture={lecture("lecture-05", "Lecture 05 – Sampling (synthetic)")} leftAt={null} />
        <LectureRow courseId="c" lecture={lecture("lecture-08", "Signal detection (synthetic)")} leftAt={null} />
      </ul>,
    );
    expect(screen.getByRole("link", { name: named("Lecture 05 – Sampling (synthetic)") })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: named("Lecture 08 – Signal detection (synthetic)") })).toBeInTheDocument();
    // one structure for every row: a title line and the facts, no separate line above some titles
    const shape = screen.getAllByRole("link").map((link) => link.querySelectorAll(":scope > span:last-child > *").length);
    expect(shape).toEqual([2, 2]);
  });

  it("says that a recording is only offered by file name", () => {
    inRouter(<ul><LectureRow courseId="c" lecture={lecture("lecture-03", "Sample topic (synthetic)", { session_link: "suggested_by_file_name" })} timing={timingOf("lecture-91")} leftAt={null} /></ul>);
    expect(text(document.getElementById(screen.getByRole("link").getAttribute("aria-describedby")!))).toBe("12 pages, recording 1 h 10 min, offered by file name, transcribed in part, 8 questions");
  });

  it("keeps a place for the timing words while the timing answer is on its way, and reads out only what is known", () => {
    const { rerender } = inRouter(<ul><LectureRow courseId="c" lecture={lecture("lecture-90", "Sample topic (synthetic)")} timingPending leftAt={null} /></ul>);
    const link = screen.getByRole("link");
    expect(link.querySelector('[data-pending="timing"]')).not.toBeNull();
    expect(link).toHaveAccessibleDescription(/^12\s+pages,\s+1\s+recording,\s+8\s+questions$/); // \s also matches the spaces that hold a fact together
    // the answer arrived: the words stand where the place was kept
    rerender(<MemoryRouter><ul><LectureRow courseId="c" lecture={lecture("lecture-90", "Sample topic (synthetic)")} timing={timingOf("lecture-90")} timingPending={false} leftAt={null} /></ul></MemoryRouter>);
    expect(screen.getByRole("link").querySelector('[data-pending="timing"]')).toBeNull();
    expect(text(screen.getByRole("listitem"))).toContain("12 pages, recording 1 h 20 min, 4 ranges, 8 questions");
  });

  it("keeps no place where the timing answer will add nothing (a lecture without a recording)", () => {
    inRouter(<ul><LectureRow courseId="c" lecture={lecture("lecture-93", "Notes (synthetic)", { sessions: [] })} timingPending leftAt={null} /></ul>);
    expect(screen.getByRole("link").querySelector('[data-pending="timing"]')).toBeNull();
  });

  it("shows a picture that is still being made as loading, the finished picture in its place, and a failed one as a still block", async () => {
    mocks.near.current = true;
    let finish: (thumb: { src: string; width: number; height: number; aspect: number }) => void = () => undefined;
    mocks.thumb.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { unmount } = inRouter(<ul><LectureRow courseId="c" lecture={lecture("lecture-01", "Sample topic (synthetic)")} leftAt={null} /></ul>);
    const placeholder = screen.getByRole("link").querySelector('[data-thumb="placeholder"]')!;
    expect(placeholder).toHaveAttribute("data-state", "loading");
    expect(mocks.thumb).toHaveBeenCalledWith("/api/sources/c/src-lecture-01-slides/content", 1);
    await act(async () => finish({ src: "blob:first-page", width: 320, height: 180, aspect: 16 / 9 }));
    expect(screen.getByRole("link").querySelector("img")).toHaveAttribute("src", "blob:first-page");
    expect(screen.getByRole("link").querySelector('[data-thumb="placeholder"]')).toBeNull();
    unmount();

    mocks.thumb.mockImplementation(() => Promise.reject(new Error("The file could not be read.")));
    inRouter(<ul><LectureRow courseId="c" lecture={lecture("lecture-02", "Sample topic (synthetic)")} leftAt={null} /></ul>);
    await waitFor(() => expect(screen.getByRole("link").querySelector('[data-thumb="placeholder"]')).toHaveAttribute("data-state", "none"));
    expect(screen.getByRole("link").querySelector("img")).toBeNull(); // nothing is drawn in place of a page that could not be rendered
  });

  it("does not show a lecture without slides, or one whose slides cannot be shown, as loading", () => {
    inRouter(
      <ul>
        <LectureRow courseId="c" lecture={lecture("lecture-01", "Notes only (synthetic)", { deck: null, displayable: false, pages: null, disposition: "no_source" })} leftAt={null} />
        <LectureRow courseId="c" lecture={lecture("lecture-02", "Slides file (synthetic)", { displayable: false, pages: null, disposition: "blocked: This deck is not a PDF." })} leftAt={null} />
      </ul>,
    );
    expect([...document.querySelectorAll('[data-thumb="placeholder"]')].map((node) => node.getAttribute("data-state"))).toEqual(["none", "none"]);
  });
});

describe("CoursePane", () => {
  const base = { loading: false, error: null, timing: new Map<string, TimingLectureRow>(), leftAt: null };

  it("heads the pane with the course, one sentence of real totals and the two ways into the course", () => {
    inRouter(<CoursePane {...base} course={COURSES[0]!} view={courseView(SAMPLE_COURSE_ID)} />);
    expect(screen.getByRole("heading", { level: 3, name: "Sample course A (synthetic)" })).toBeInTheDocument();
    expect(text(screen.getByTestId("course-counts"))).toBe("2 lectures, 8 questions in the catalog, 3 recorded attempts.");
    expect(screen.getByRole("link", { name: "Concept map" })).toHaveAttribute("href", "/courses/sample-course/concepts");
    expect(screen.getByRole("link", { name: "Question bank" })).toHaveAttribute("href", "/courses/sample-course/questions");
    expect(within(screen.getByRole("list", { name: "Lectures of Sample course A (synthetic)" })).getAllByRole("listitem")).toHaveLength(2);
  });

  it("says in words that a course has no lectures, is loading, or failed to load", () => {
    const { rerender } = inRouter(<CoursePane {...base} course={COURSES[0]!} view={courseView(SAMPLE_COURSE_ID, { lectures: [] })} />);
    expect(screen.getByText(NO_LECTURES_SENTENCE)).toBeInTheDocument();
    rerender(<MemoryRouter><CoursePane {...base} course={COURSES[0]!} view={undefined} loading /></MemoryRouter>);
    expect(screen.getByRole("status")).toHaveTextContent("Loading lectures…");
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(document.querySelectorAll('[data-skeleton="lecture-row"]')).toHaveLength(2); // as many rows as the course has lectures (COURSES[0].lecture_units)
    const retry = vi.fn();
    rerender(<MemoryRouter><CoursePane {...base} course={COURSES[0]!} view={undefined} error={new Error("The Brain did not answer.")} onRetry={retry} /></MemoryRouter>);
    expect(screen.getByRole("alert")).toHaveTextContent("The Brain did not answer.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("shows why a course that is not bound cannot be opened, and offers nothing that would need it", () => {
    inRouter(<CoursePane {...base} course={COURSES[4]!} view={undefined} />);
    expect(screen.getByRole("note")).toHaveTextContent("This course is not bound");
    expect(screen.getByRole("note")).toHaveTextContent("The course folder is not on this PC. Other courses are unaffected.");
    expect(screen.queryByRole("link", { name: "Concept map" })).toBeNull();
  });

  it("says once that dated sessions belong to no lecture, and words a lecture's missing recording accordingly", () => {
    const onActivate = vi.fn();
    inRouter(<CoursePane {...base} course={COURSES[0]!} onActivate={onActivate} view={courseView(SAMPLE_COURSE_ID, { unlinked_sessions: [session(["lecture_transcript", "lecture_recording"], "u1")] })} />);
    const line = screen.getByTestId("unlinked-sessions");
    expect(text(line)).toBe("1 dated session with a recording is not linked to a lecture by the course records. No pairing is assumed. It is listed in the Library.");
    fireEvent.click(within(line).getByRole("link", { name: "Library" }));
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(text(screen.getByRole("list", { name: /^Lectures of/ }))).toContain("no recording linked"); // the lecture with no session of its own
  });

  it("keeps the line of totals as a place while they are not known, and never shows a remembered number", () => {
    const remembered: WorkspaceCourse = { course_id: SAMPLE_COURSE_ID, display_name: "Sample course A (synthetic)", binding: "bound", problem: null };
    inRouter(<CoursePane {...base} course={remembered} view={undefined} loading skeletonRows={4} />);
    expect(screen.getByRole("heading", { level: 3, name: "Sample course A (synthetic)" })).toBeInTheDocument();
    expect(screen.queryByTestId("course-counts")).toBeNull();
    expect(document.querySelector('[data-pending="counts"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-skeleton="lecture-row"]')).toHaveLength(4);
    expect(screen.getByRole("link", { name: "Concept map" })).toBeInTheDocument(); // the ways into the course do not wait
  });

  it("asks for the pictures so that they arrive from the top row down (the picture queue serves the last request first)", async () => {
    mocks.near.current = true;
    const lectures = ["lecture-01", "lecture-02", "lecture-03", "lecture-04"].map((id) => lecture(id, `${id} (synthetic)`));
    inRouter(<CoursePane {...base} course={COURSES[0]!} view={courseView(SAMPLE_COURSE_ID, { lectures })} />);
    await waitFor(() => expect(mocks.thumb).toHaveBeenCalled());
    const asked = mocks.thumb.mock.calls.map((call) => /src-(lecture-\d+)-slides/.exec(String(call[0]))![1]);
    // the top row first (it starts at once when nothing is being drawn), then from the bottom up, and the top row once
    // more, so that it is also the next one served when something else was being drawn
    expect(asked).toEqual(["lecture-01", "lecture-04", "lecture-03", "lecture-02", "lecture-01"]);
  });

  it("hands the rows the place for their timing words while the timing answer is on its way", () => {
    inRouter(<CoursePane {...base} course={COURSES[0]!} view={courseView(SAMPLE_COURSE_ID)} timingPending />);
    const rows = within(screen.getByRole("list", { name: /^Lectures of/ })).getAllByRole("listitem");
    expect(rows.map((row) => !!row.querySelector('[data-pending="timing"]'))).toEqual([true, false]); // the second lecture has no recording
  });
});

describe("Study home", () => {
  it("leads with the title and, for sample data, says so once; lists every configured course as a tab", async () => {
    page(<StudyHome />);
    expect(screen.getByRole("heading", { level: 1, name: "Study" })).toBeInTheDocument();
    expect(screen.getAllByText(STUDY_SAMPLE_SENTENCE)).toHaveLength(1);
    expect(within(screen.getByRole("tablist", { name: "Courses" })).getAllByRole("tab")).toHaveLength(5);
    expect(screen.getByText(STUDY_CLOSING_LINE)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(STUDY_FIRST_RUN)).toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "Resume" })).toBeNull();
  });

  it("does not say “sample” for the learner's own courses", () => {
    setApp({ workspace: { profile: "local", fixture_label: null, term: "2026-fall", courses: COURSES } });
    page(<StudyHome />);
    expect(screen.queryByText(STUDY_SAMPLE_SENTENCE)).toBeNull();
  });

  it("shows the active course's lectures with their timing facts, and another course when its tab is chosen", async () => {
    const app = setApp();
    page(<StudyHome />);
    const pane = screen.getByRole("tabpanel");
    expect(within(pane).getByRole("heading", { level: 3 })).toHaveTextContent("Sample course A (synthetic)");
    expect(text(within(pane).getAllByRole("listitem")[0]!)).toContain("12 pages, recording 1 h 20 min, 4 ranges, 8 questions");
    expect(text(within(pane).getAllByRole("listitem")[1]!)).toContain("3 pages, no recording, no questions in the catalog");

    const other = screen.getByRole("tab", { name: /Sample course B/ });
    fireEvent.mouseDown(other);
    fireEvent.click(other);
    await waitFor(() => expect(within(screen.getByRole("tabpanel")).getByRole("heading", { level: 3 })).toHaveTextContent("Sample course B (synthetic)"));
    expect(app.setCourseId).toHaveBeenCalledWith("sample-b");
    expect(screen.getByTestId("where")).toHaveTextContent("/study"); // the address of Study does not change
    // without timing data the row states only what the course view holds
    expect(text(within(screen.getByRole("tabpanel")).getAllByRole("listitem")[0]!)).toContain("12 pages, 1 recording, 8 questions");
  });

  it("lets a course that is not bound be chosen to read why, without making it the active course", async () => {
    const app = setApp();
    page(<StudyHome />);
    const unbound = screen.getByRole("tab", { name: /Sample course E/ });
    expect(unbound).toHaveTextContent("Not bound: this course cannot be opened");
    fireEvent.mouseDown(unbound);
    fireEvent.click(unbound);
    await waitFor(() => expect(screen.getByRole("tabpanel")).toHaveTextContent("The course folder is not on this PC."));
    expect(app.setCourseId).not.toHaveBeenCalled();
  });

  it("resumes at the lecture and page last opened on this device, in the words of the identity line", async () => {
    window.localStorage.setItem(`ll.last.${SAMPLE_COURSE_ID}`, JSON.stringify({ lectureId: SAMPLE_LECTURE_ID, page: 4, title: "stored title", at: 20 }));
    window.localStorage.setItem("ll.last.sample-b", JSON.stringify({ lectureId: "lecture-02", page: 9, title: "Older place", at: 10 }));
    mocks.draft.mockResolvedValue({ draftId: "d", text: "half a question" });
    page(<StudyHome />);
    const resume = screen.getByRole("region", { name: "Resume" });
    expect(within(resume).getByText("Resume in Sample course A (synthetic)")).toBeInTheDocument();
    expect(text(within(resume).getByRole("heading", { level: 2 }))).toBe(sampleLectureView.title); // the lecture view's title (it names the lecture itself), not the stored one
    expect(text(within(resume).getByTestId("resume-where"))).toMatch(/^You stopped on PDF page 4 of 12 · build 2 of 3\./);
    expect(within(resume).getByRole("link", { name: "Resume lecture" })).toHaveAttribute("href", `/courses/${SAMPLE_COURSE_ID}/lectures/${SAMPLE_LECTURE_ID}?page=4`);
    await waitFor(() => expect(text(within(resume).getByTestId("resume-where"))).toContain("One unsent draft is kept in Tutor."));
    expect(mocks.draft).toHaveBeenCalledWith(`tutor:${SAMPLE_COURSE_ID}:${SAMPLE_LECTURE_ID}`);
    // the tabs say where each course was left, and the row of the place is marked
    expect(text(screen.getByRole("tab", { name: /Sample course A/ }))).toContain("Left at Lecture 90, page 4");
    expect(text(screen.getByRole("tab", { name: /Sample course B/ }))).toContain("Left at Lecture 02, page 9");
    expect(text(screen.getByRole("tab", { name: /Sample course C/ }))).toContain("Not opened on this device");
    const row = within(screen.getByRole("tabpanel")).getAllByRole("listitem")[0]!;
    expect(text(row)).toContain("You left this at page 4");
    expect(within(row).getByRole("link")).toHaveAttribute("href", `/courses/${SAMPLE_COURSE_ID}/lectures/${SAMPLE_LECTURE_ID}?page=4`);
  });

  it("uses a synchronised position when this device has opened nothing, and says where it comes from", async () => {
    mocks.resume.mockImplementation(async (path: string) => (path.includes("sample-b") ? { ...noResume("sample-b"), current: head("lecture-02", 3) } : noResume(path.split("/")[1]!)));
    page(<StudyHome />);
    const resume = await screen.findByRole("region", { name: "Resume" });
    expect(text(within(resume).getByTestId("resume-where"))).toMatch(/^Your last finished session stopped on PDF page 3 of 12/);
    expect(within(resume).getByRole("link", { name: "Resume lecture" })).toHaveAttribute("href", "/courses/sample-b/lectures/lecture-02?page=3");
    expect(text(screen.getByRole("tab", { name: /Sample course B/ }))).toContain("Left at Lecture 02, page 3 in a finished session");
  });

  it("keeps the choice between two study positions reachable from the course it belongs to", async () => {
    mocks.resume.mockImplementation(async (path: string) => (path.includes(SAMPLE_COURSE_ID) ? { ...noResume(SAMPLE_COURSE_ID), conflict: { heads: [head("lecture-90", 2), head("lecture-90", 5)], note: "" } } : noResume(path.split("/")[1]!)));
    page(<StudyHome />);
    await waitFor(() => expect(screen.getByRole("tab", { name: /Sample course A/ })).toHaveTextContent("Two study positions need your choice"));
    const notice = screen.getByTestId("resume-conflict");
    expect(notice).toHaveTextContent("Both drafts are kept; nothing was merged or overwritten.");
    expect(within(notice).getByRole("link", { name: "Compare and choose" })).toHaveAttribute("href", `/activity/conflicts/resume-${SAMPLE_COURSE_ID}`);
  });

  it("points at a place another device left when it differs from this device's own", async () => {
    window.localStorage.setItem(`ll.last.${SAMPLE_COURSE_ID}`, JSON.stringify({ lectureId: SAMPLE_LECTURE_ID, page: 4, at: 20 }));
    mocks.resume.mockImplementation(async (path: string) => (path.includes(SAMPLE_COURSE_ID) ? { ...noResume(SAMPLE_COURSE_ID), current: head("lecture-93", 2) } : noResume(path.split("/")[1]!)));
    page(<StudyHome />);
    const line = await screen.findByTestId("synchronised-place");
    expect(within(line).getByRole("link")).toHaveAttribute("href", `/courses/${SAMPLE_COURSE_ID}/lectures/lecture-93?page=2`);
    expect(text(within(line).getByRole("link"))).toBe("Lecture 93, page 2");
    // Resume still leads to this device's own place
    expect(within(screen.getByRole("region", { name: "Resume" })).getByRole("link", { name: "Resume lecture" })).toHaveAttribute("href", `/courses/${SAMPLE_COURSE_ID}/lectures/${SAMPLE_LECTURE_ID}?page=4`);
  });

  it("shows loading and failure of the workspace in words", () => {
    setApp({ workspace: undefined, workspaceLoading: true });
    const { unmount } = page(<StudyHome />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading your courses…");
    // a first visit: the frame of the page that follows is there at once, in grey where nothing is known yet
    expect(screen.getByTestId("study-home")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("heading", { level: 2, name: "Courses" })).toBeInTheDocument();
    expect(screen.getByText(STUDY_FIRST_RUN)).toBeInTheDocument(); // the device knows it has opened nothing
    expect(screen.getByTestId("course-tabs-skeleton").children).toHaveLength(5);
    expect(document.querySelectorAll('[data-skeleton="lecture-row"]').length).toBeGreaterThan(0);
    expect(screen.getByText(STUDY_CLOSING_LINE)).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(mocks.course).toHaveBeenCalledWith(SAMPLE_COURSE_ID); // the course that was active on this device is asked for beside the workspace
    expect(screen.queryByRole("listitem")).toBeNull(); // and nothing of it is shown before the workspace has named it
    unmount();
    setApp({ workspace: undefined, workspaceLoading: false, workspaceError: new Error("The Brain on this PC did not answer.") });
    page(<StudyHome />);
    expect(screen.getByRole("alert")).toHaveTextContent("The Brain on this PC did not answer.");
  });
});

describe("Study home: the first frame, a slow load and a revisit", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the course names of a successful load on this device", () => {
    page(<StudyHome />);
    const kept = readRememberedCourses(window.localStorage.getItem("ll.study.courses"));
    expect(kept?.sample).toBe(true);
    expect(kept?.courses.map((course) => course.display_name)).toEqual(COURSES.map((course) => course.display_name));
    expect(kept?.courses[4]).toMatchObject({ binding: "unbound", problem: "The course folder is not on this PC." });
  });

  it("paints the courses it remembers, their lectures and the place you left while the workspace is still being read", () => {
    window.localStorage.setItem("ll.study.courses", coursesToRemember({ fixture_label: null, courses: COURSES }));
    window.localStorage.setItem(`ll.last.${SAMPLE_COURSE_ID}`, JSON.stringify({ lectureId: SAMPLE_LECTURE_ID, page: 4, title: "stored title", at: 20 }));
    setApp({ workspace: undefined, workspaceLoading: true });
    page(<StudyHome />);
    expect(screen.getByTestId("study-home")).toHaveAttribute("aria-busy", "true");
    const tabs = within(screen.getByRole("tablist", { name: "Courses" })).getAllByRole("tab");
    expect(tabs).toHaveLength(5);
    expect(text(tabs[0]!)).toContain("Sample course A (synthetic)");
    expect(text(tabs[0]!)).toContain("Left at Lecture 90, page 4");
    // the active course is asked for at once, beside the workspace, and its lectures are shown as soon as they are there
    expect(within(screen.getByRole("tabpanel")).getAllByRole("listitem")).toHaveLength(2);
    const resume = screen.getByRole("region", { name: "Resume" });
    expect(within(resume).getByText("Resume in Sample course A (synthetic)")).toBeInTheDocument();
    expect(within(resume).getByRole("link", { name: "Resume lecture" })).toHaveAttribute("href", `/courses/${SAMPLE_COURSE_ID}/lectures/${SAMPLE_LECTURE_ID}?page=4`);
    expect(screen.queryByText(STUDY_SAMPLE_SENTENCE)).toBeNull(); // remembered as the learner's own courses
  });

  it("leads with the place you left on a first load that remembers no course names", () => {
    window.localStorage.setItem("ll.last.sample-b", JSON.stringify({ lectureId: "lecture-02", page: 9, title: "Older place", at: 10 }));
    mocks.lecture.mockImplementation(() => query(undefined, { isLoading: true }));
    setApp({ workspace: undefined, workspaceLoading: true });
    page(<StudyHome />);
    const resume = screen.getByRole("region", { name: "Resume" });
    expect(text(within(resume).getByRole("heading", { level: 2 }))).toBe("Lecture 02 – Older place");
    expect(within(resume).getByRole("link", { name: "Resume lecture" })).toHaveAttribute("href", "/courses/sample-b/lectures/lecture-02?page=9");
    expect(within(resume).getByTestId("resume-picture").querySelector('[data-state="loading"]')).not.toBeNull();
    expect(screen.queryByText(STUDY_FIRST_RUN)).toBeNull();
  });

  it("says at once that nothing was opened on this device, without waiting for the positions of other devices", () => {
    mocks.resume.mockImplementation(() => new Promise(() => undefined)); // never answers
    page(<StudyHome />);
    expect(screen.getByText(STUDY_FIRST_RUN)).toBeInTheDocument();
    expect(screen.queryByText(/Looking for where you left off/)).toBeNull();
  });

  it("says after two seconds what a slow load is doing, and not before", () => {
    vi.useFakeTimers();
    setApp({ workspace: undefined, workspaceLoading: true });
    const { unmount } = page(<StudyHome />);
    expect(screen.queryByText(STUDY_READING_LINE)).toBeNull();
    act(() => { vi.advanceTimersByTime(1_900); });
    expect(screen.queryByText(STUDY_READING_LINE)).toBeNull();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByTestId("study-status")).toHaveTextContent(STUDY_READING_LINE);
    unmount();

    // the same while the lectures of the chosen course are read
    setApp();
    mocks.course.mockImplementation((id?: string) => query(undefined, { isLoading: !!id }));
    page(<StudyHome />);
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText(STUDY_READING_LINE)).toBeNull();
    act(() => { vi.advanceTimersByTime(2_100); });
    expect(screen.getByTestId("study-status")).toHaveTextContent(STUDY_READING_LINE);
  });

  it("is not busy and says nothing about reading once everything is there", () => {
    vi.useFakeTimers();
    page(<StudyHome />);
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(screen.getByTestId("study-home")).not.toHaveAttribute("aria-busy");
    expect(screen.getByRole("tabpanel")).not.toHaveAttribute("aria-busy");
    expect(screen.getByTestId("study-status")).toBeEmptyDOMElement();
  });

  it("shows the lectures it had when you come back while the course is being read again", () => {
    const client = newClient();
    const first = page(<StudyHome />, "/study", client);
    expect(within(screen.getByRole("tabpanel")).getAllByRole("listitem")).toHaveLength(2);
    first.unmount();
    // back from a lecture: the cached answer is gone and the course is read again
    mocks.course.mockImplementation((id?: string) => query(undefined, { isLoading: !!id }));
    mocks.timing.mockImplementation((id?: string) => query(undefined, { isLoading: !!id }));
    page(<StudyHome />, "/study", client);
    const rows = within(screen.getByRole("tabpanel")).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(text(rows[0]!)).toContain("12 pages, recording 1 h 20 min, 4 ranges, 8 questions"); // with the timing words it had
    expect(screen.queryByText("Loading lectures…")).toBeNull();
    expect(screen.getByTestId("study-home")).not.toHaveAttribute("aria-busy");
  });

  it("still says so when reading the course again fails", () => {
    const client = newClient();
    page(<StudyHome />, "/study", client).unmount();
    mocks.course.mockImplementation((id?: string) => query(undefined, { isError: !!id, error: id ? new Error("The Brain did not answer.") : null }));
    page(<StudyHome />, "/study", client);
    expect(within(screen.getByRole("tabpanel")).getByRole("alert")).toHaveTextContent("The Brain did not answer.");
  });

  it("does not call an address unknown while the courses are still being read", () => {
    window.localStorage.setItem("ll.study.courses", coursesToRemember({ fixture_label: null, courses: COURSES.slice(0, 2) }));
    setApp({ workspace: undefined, workspaceLoading: true });
    page(<StudyHome />, "/courses/sample-d");
    expect(screen.queryByRole("heading", { name: "No course is configured under this address" })).toBeNull();
  });
});

describe("The course on Study (/courses/:courseId)", () => {
  it("is the same page with that course chosen, whatever the active course is", () => {
    page(<StudyHome />, "/courses/sample-c");
    expect(screen.getByRole("heading", { level: 1, name: "Study" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Sample course C/ })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("tabpanel")).getByRole("heading", { level: 3 })).toHaveTextContent("Sample course C (synthetic)");
  });

  it("goes to the address of another course when its tab is chosen", async () => {
    page(<StudyHome />, "/courses/sample-c");
    const other = screen.getByRole("tab", { name: /Sample course D/ });
    fireEvent.mouseDown(other);
    fireEvent.click(other);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/courses/sample-d"));
    expect(screen.getByRole("tab", { name: /Sample course D/ })).toHaveAttribute("aria-selected", "true");
  });

  it("explains an address that names no configured course, with a way back", () => {
    page(<StudyHome />, "/courses/not-a-course");
    expect(screen.getByRole("heading", { name: "No course is configured under this address" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Study" })).toHaveAttribute("href", "/study");
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });
});
