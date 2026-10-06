// The Study home as rendered (design specification 6): what it says to assistive technology and which links it offers.
// jsdom: structure, names and addresses, not pixels (those are looked at in a browser). Page pictures are not drawn here
// (lib/thumbs is replaced), so every row shows its neutral placeholder. All data is synthetic.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
}));
vi.mock("@/app/state", () => ({ useApp: () => mocks.app.current }));
vi.mock("@/lib/queries", () => ({ useCourse: (id?: string) => mocks.course(id), useCourseTiming: (id?: string) => mocks.timing(id), useLecture: (c?: string, l?: string, d?: string | null) => mocks.lecture(c, l, d) }));
vi.mock("@/lib/api", () => ({ apiGet: (path: string) => mocks.resume(path), contentUrl: (relative: string) => `/api/${relative}` }));
vi.mock("@/lib/db", () => ({ getDraft: (id: string) => mocks.draft(id) }));
vi.mock("@/lib/thumbs", () => ({ useNearViewport: () => [{ current: null }, false], useThumb: () => ({ thumb: null, shape: null }), useFirstPageShape: () => null }));

import { CoursePane, CourseTabs, LectureRow } from "@/features/study/CourseBrowser";
import { ResumeFirstRun, ResumeView } from "@/features/study/ResumeBlock";
import { CourseLectures, StudyHome } from "@/features/study/StudyPages";
import { NO_LECTURES_SENTENCE, STUDY_CLOSING_LINE, STUDY_FIRST_RUN, STUDY_SAMPLE_SENTENCE, type TimingLectureRow } from "@/features/study/study-facts";

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
function page(element: ReactElement, at = "/study") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
    const link = screen.getByRole("link", { name: named("Lecture 90 Sample topic (synthetic)") });
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
    unmount();
    setApp({ workspace: undefined, workspaceLoading: false, workspaceError: new Error("The Brain on this PC did not answer.") });
    page(<StudyHome />);
    expect(screen.getByRole("alert")).toHaveTextContent("The Brain on this PC did not answer.");
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
