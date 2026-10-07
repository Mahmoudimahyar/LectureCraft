// The Questions tab and the question entry (design specification 5.9, 9.6 – 9.8): three lists whose counts equal their
// rows, one basis label per tie, where the support is inside a build group, the decisions on a suggested link, and the
// two no-link lines. Rendered in jsdom with the synthetic sample of lib/fixtures/r2-sample: structure, wording and
// what is sent, not pixels.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { QuestionsTab } from "@/features/lecture/QuestionsTab";
import { QuestionListItem, answerAction, pageCitations, promptParts, questionName } from "@/features/question/QuestionList";
import { SAMPLE_COURSE_ID, sampleLectureView, sampleLectureViewWithoutR2, sampleQuestionRowRejectedByLearner, sampleTieKeptByConfirmation } from "@/lib/fixtures/r2-sample";
import { DECISION_NOTE, NBSP, QUESTION_LIST_LABEL } from "@/lib/labels";
import { nextContentPage } from "@/lib/r2";
import type { LectureQuestionTie, LectureView, QuestionRow, RelatedQuestion, SlidePosition } from "@/lib/types";

const plain = (value: string | null | undefined): string => (value ?? "").split(NBSP).join(" ").replace(/\s+/g, " ").trim();
const textOf = (element: Element | null): string => plain(element?.textContent);

function Where() {
  const location = useLocation();
  return <span data-testid="where">{location.pathname + location.search}</span>;
}
function mount(ui: ReactElement, at = "/courses/sample-course/lectures/lecture-90?page=4&panel=questions") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[at]}>{ui}<Where /></MemoryRouter>
    </QueryClientProvider>,
  );
}
const tabOf = (page: number, view: LectureView, onGoToPage: (page: number) => void = () => undefined) => (
  <QuestionsTab courseId={SAMPLE_COURSE_ID} lecture={view} page={page} slide={view.slides.find((slide) => slide.page === page)} onGoToPage={onGoToPage} nextContentPage={nextContentPage(view, page)} />
);
function tab(page: number, view: LectureView = sampleLectureView, onGoToPage: (page: number) => void = () => undefined) {
  return mount(tabOf(page, view, onGoToPage), `/courses/sample-course/lectures/lecture-90?page=${page}&panel=questions`);
}
/** The tab in a tree that can be drawn again with a later view or another page, as the workspace does after a refetch or a page turn. */
function liveTab(page: number, view: LectureView = sampleLectureView) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tree = (at: number, shown: LectureView) => (
    <QueryClientProvider client={client}><MemoryRouter initialEntries={[`/courses/sample-course/lectures/lecture-90?page=${page}&panel=questions`]}>{tabOf(at, shown)}</MemoryRouter></QueryClientProvider>
  );
  const drawn = render(tree(page, view));
  return { show: (at: number, shown: LectureView) => drawn.rerender(tree(at, shown)) };
}
/** The view the Brain sends once a suggested link was rejected: the link is on no page any more. */
const withoutSuggestion = (view: LectureView, suggestionId: string): LectureView => ({
  ...view, slides: view.slides.map((slide) => ({ ...slide, question_ties: slide.question_ties?.filter((tie) => !(tie.tie === "agent_inferred" && tie.suggestion_id === suggestionId)) })),
});
const row = (id: string, within_: HTMLElement = document.body): HTMLElement => {
  const found = within_.querySelector<HTMLElement>(`[data-testid="question-row"][data-question-id="${id}"]`);
  if (!found) throw new Error(`no row for ${id}`);
  return found;
};
const section = (name: RegExp): HTMLElement => screen.getByRole("button", { name });

afterEach(() => vi.unstubAllGlobals());

describe("questionName", () => {
  it("names a question by its collection and number, with the catalog's own title beside it", () => {
    expect(questionName({ question_id: "S90-Q04", collection: "S90", number: 4, title: "Sample question 4" })).toEqual({ place: `S90,${NBSP}question${NBSP}4`, title: "Sample question 4" });
  });
  it("uses what is recorded and nothing else: no number, no collection, no title", () => {
    expect(questionName({ question_id: "S90-Q04", collection: "S90", number: null, title: null })).toEqual({ place: "S90", title: null });
    expect(questionName({ question_id: "S90-Q04", collection: null, number: 4, title: "" })).toEqual({ place: "S90-Q04", title: null });
    expect(questionName({ question_id: "S90-Q04", collection: "S90", number: 4, title: "S90-Q04" }).title).toBeNull();
  });
});

describe("answerAction", () => {
  it("is Answer until an attempt is recorded, then Answer again", () => {
    expect(answerAction({ prompt_in_index: true }, null)).toBe("Answer");
    expect(answerAction({ prompt_in_index: true }, { attempts: 0 })).toBe("Answer");
    expect(answerAction({ prompt_in_index: true }, { attempts: 2 })).toBe("Answer again");
  });
  it("opens the source question when the wording is kept in the source", () => {
    expect(answerAction({ prompt_in_index: false }, { attempts: 3 })).toBe("Open the source question");
  });
});

describe("pageCitations", () => {
  const group = [22, 23, 24];
  const positionOf = (page: number): SlidePosition | null => (group.includes(page) ? { kind: "build", ordinal: group.indexOf(page) + 1, of: 3 } : null);
  it("words each page of a group with its build, the page on screen as on screen, and joins plain neighbours", () => {
    const cited = pageCitations([31, 22, 23, 26, 27, 23], { current: 23, positionOf });
    expect(cited.map((entry) => [plain(entry.label), entry.qualifier ? plain(entry.qualifier) : null, entry.current, entry.page])).toEqual([
      ["p. 22", "build 1 of 3", false, 22],
      ["p. 23", "on screen", true, 23],
      ["pp. 26–27", null, false, 26],
      ["p. 31", null, false, 31],
    ]);
  });
  it("keeps a unit together with non-breaking spaces", () => {
    const [first] = pageCitations([22], { positionOf });
    expect(first!.label).toBe(`p.${NBSP}22`);
    expect(first!.qualifier).toBe(`build${NBSP}1${NBSP}of${NBSP}3`);
  });
  it("gives nothing for no page and never joins across a gap or a group", () => {
    expect(pageCitations([], {})).toEqual([]);
    expect(pageCitations([5, 7], {}).map((entry) => plain(entry.label))).toEqual(["p. 5", "p. 7"]);
    expect(pageCitations([21, 22], { positionOf }).map((entry) => plain(entry.label))).toEqual(["p. 21", "p. 22"]);
  });
});

describe("Questions tab, a page of a build group (page 4, build 2 of 3)", () => {
  it("heads three lists with counts that equal their rows; only the first is open", () => {
    tab(4);
    const here = section(new RegExp(`^${QUESTION_LIST_LABEL.this_slide} 3$`));
    expect(here).toHaveAttribute("aria-expanded", "true");
    expect(section(new RegExp(`^${QUESTION_LIST_LABEL.related_concepts} 1$`))).toHaveAttribute("aria-expanded", "false");
    expect(section(new RegExp(`^${QUESTION_LIST_LABEL.all_lecture} 8$`))).toHaveAttribute("aria-expanded", "false");
    const list = screen.getByTestId("this-slide-list");
    expect(within(list).getAllByTestId("question-row")).toHaveLength(3);
  });

  it("gives every tie one basis label and says where its support is", () => {
    tab(4);
    const list = screen.getByTestId("this-slide-list");
    const stated = textOf(row("S90-Q02", list));
    expect(stated).toContain("Stated. The course record names this page. Its page basis is not reviewed.");
    expect(stated).toContain("Group-level: all 3 builds.");
    const checked = textOf(row("S90-Q03", list));
    expect(checked).toContain("Suggested link, checked by a second pass.");
    expect(checked).toContain("Supports 2 of 2 criteria: criterion 1 (Sample concept one) and criterion 2 (Sample concept two).");
    expect(checked).toContain("Elsewhere in this sequence: build 3.");
    expect(checked).not.toMatch(/teaches|answers|whole question/i);
    const unchecked = textOf(row("S90-Q04", list));
    expect(unchecked).toContain("Suggested link, not yet checked.");
    expect(unchecked).toContain("Supports 2 of 3 criteria, each in part: criterion 1 (Sample concept one) and criterion 3 (Sample concept three).");
    expect(unchecked).toContain("Why: Synthetic rationale: the second step shows what criterion 1 asks about");
    expect(unchecked).toContain("On this build.");
  });

  it("names the criterion this page supports when the link names more than this page does", () => {
    tab(4);
    const list = screen.getByTestId("this-slide-list");
    // Two criteria on two pages; this page carries the first.
    expect(textOf(row("S90-Q04", list))).toContain("This page supports 1 of 3: criterion 1 (Sample concept one).");
    // Every criterion of the link is on the other page of the group: nothing is named for this one.
    expect(textOf(row("S90-Q03", list))).not.toMatch(/This page supports \d of \d:/);
  });
  it("names no criterion for the page when the producer made no page-by-page statement, or when the page carries them all", () => {
    tab(8);
    expect(textOf(row("S90-Q05", screen.getByTestId("this-slide-list")))).toContain("This page supports 1 of 3.");
  });

  it("cites the source pages: the page on screen is marked and is not a link, another page turns the slide to it", () => {
    const goTo = vi.fn();
    tab(4, sampleLectureView, goTo);
    const sources = within(row("S90-Q04", screen.getByTestId("this-slide-list"))).getByTestId("question-sources");
    expect(textOf(sources)).toBe("Sources p. 4 on screen p. 9");
    expect(within(sources).queryByRole("link", { name: (name) => plain(name).startsWith("p. 4") })).toBeNull();
    const here = sources.querySelector("[aria-current]");
    expect(textOf(here)).toBe("p. 4 on screen");
    fireEvent.click(within(sources).getByRole("link", { name: (name) => plain(name) === "p. 9" }));
    expect(goTo).toHaveBeenCalledWith(9);
    const group = within(row("S90-Q02", screen.getByTestId("this-slide-list"))).getByTestId("question-sources");
    expect(textOf(group)).toBe("Sources p. 3 build 1 of 3 p. 4 on screen p. 5 build 3 of 3");
  });

  it("makes every source one target that holds its whole label, the build included", () => {
    const goTo = vi.fn();
    tab(4, sampleLectureView, goTo);
    const group = within(row("S90-Q02", screen.getByTestId("this-slide-list"))).getByTestId("question-sources");
    const links = within(group).getAllByRole("link").map((link) => plain(link.getAttribute("aria-label") ?? link.textContent));
    expect(links).toEqual(["p. 3 build 1 of 3", "p. 5 build 3 of 3"]);
    fireEvent.click(within(group).getByRole("link", { name: (name) => plain(name) === "p. 5 build 3 of 3" }));
    expect(goTo).toHaveBeenCalledWith(5);
    // A press target, not a word in a line: the button shape of the sheet (28 px high, 44 on touch).
    for (const link of within(group).getAllByRole("link")) expect(link.className).toMatch(/\bll-btn-xs\b/);
  });

  it("lists a question once: a study-map tie of a question that is tied to this page is a second basis line of its entry", () => {
    tab(4);
    const here = screen.getByTestId("this-slide-list");
    const both = textOf(row("S90-Q02", here));
    expect(both).toContain("Stated. The course record names this page. Its page basis is not reviewed.");
    expect(both).toContain("Stated for a part of the lecture. The course's study map places it in pp. 2–5 and names no single page.");
    expect(within(row("S90-Q02", here)).getAllByTestId("question-basis").map((basis) => basis.getAttribute("data-tie"))).toEqual(["stated", "section"]);
    const whole = screen.getByTestId("questions-tab");
    expect(whole.querySelectorAll('[data-testid="question-row"][data-question-id="S90-Q02"]')).toHaveLength(1);
  });

  it("lists the questions that have only a study-map tie apart, under their own heading and count, never among the page ties", () => {
    tab(4);
    const apart = screen.getByTestId("section-ties");
    expect(textOf(within(apart).getByRole("heading"))).toBe("In this part of the lecture, by the course's study map: pp. 2–5 (Sample section: the idea and its mechanism) 2");
    expect(within(apart).getAllByTestId("question-row").map((entry) => entry.getAttribute("data-question-id"))).toEqual(["S90-Q01", "S90-Q05"]);
    expect(textOf(row("S90-Q05", apart))).toContain("Stated for a part of the lecture. The course's study map places part of it in pp. 2–5 and names no single page.");
    expect(screen.getByTestId("this-slide-list").contains(apart)).toBe(false);
  });

  it("offers Answer and the question bank on a row, with the evidence state and prior exposure beside the name", () => {
    tab(4);
    const entry = row("S90-Q02", screen.getByTestId("this-slide-list"));
    expect(textOf(entry)).toContain("S90, question 2");
    expect(textOf(entry.querySelector("[data-state]"))).toBe("Assisted: solution shown · 1 attempt · prior exposure");
    expect(within(entry).getByRole("link", { name: /^Answer again/ })).toHaveAttribute("href", "/courses/sample-course/questions/S90-Q02");
    expect(within(entry).getByRole("link", { name: /^Open in the question bank/ })).toHaveAttribute("href", expect.stringContaining("/courses/sample-course/questions?q=S90-Q02"));
  });
});

describe("Questions tab, decisions on a suggested link", () => {
  it("offers Accept and Reject on a link without a decision and sends the decision", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ course_id: SAMPLE_COURSE_ID, suggestion_id: "ia-0000000000000004", decision: "confirmed", revision: 1,
      status: "recorded", decided_at: null, question_id: "S90-Q04" }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    tab(4);
    const entry = row("S90-Q04", screen.getByTestId("this-slide-list"));
    expect(textOf(entry)).toContain(DECISION_NOTE);
    expect(within(entry).getByRole("button", { name: /^Reject/ })).toBeInTheDocument();
    fireEvent.click(within(entry).getByRole("button", { name: /^Accept/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/courses/sample-course/suggestions/ia-0000000000000004/decision");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ decision: "confirmed" });
  });

  it("a confirmed link stays a suggested link, says so, and can be taken back", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ course_id: SAMPLE_COURSE_ID, suggestion_id: "ia-0000000000000005", decision: "cleared", revision: 2,
      status: "recorded", decided_at: null, question_id: "S90-Q05" }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    tab(8);
    const entry = row("S90-Q05", screen.getByTestId("this-slide-list"));
    const words = textOf(entry);
    expect(words).toContain("Suggested link, confirmed by you.");
    expect(words).toContain("The second pass kept fewer pages or criteria than first proposed.");
    expect(words).not.toMatch(/\bExact\b|\bStated\b\./);
    expect(within(entry).queryByRole("button", { name: /^Accept/ })).toBeNull();
    fireEvent.click(within(entry).getByRole("button", { name: /^Take back/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({ decision: "cleared" });
  });

  it("says that the list changed when the Brain refuses a decision made against an older revision", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "revision conflict" }), { status: 409, headers: { "content-type": "application/json" } })));
    tab(4);
    fireEvent.click(within(row("S90-Q04", screen.getByTestId("this-slide-list"))).getByRole("button", { name: /^Reject/ }));
    const notice = await screen.findByRole("status");
    expect(textOf(notice)).toContain("This list was made before the suggested links changed.");
    expect(within(notice).getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("never words a link the second pass rejected as checked", () => {
    const view: LectureView = { ...sampleLectureView, slides: sampleLectureView.slides.map((slide) => (slide.page === 9 ? { ...slide, question_ties: [...(slide.question_ties ?? []), sampleTieKeptByConfirmation] } : slide)) };
    tab(9, view);
    const words = textOf(row("S90-Q10", screen.getByTestId("this-slide-list")));
    expect(words).toContain("Suggested link, rejected by a second pass, kept because you confirmed it.");
    expect(words).toContain("Synthetic note of the checking pass: the page names the term");
    expect(words).not.toContain("checked by a second pass");
  });
});

describe("Questions tab, the other two lists", () => {
  it("Related concepts names the shared concept and claims nothing about the slide", () => {
    tab(2);
    fireEvent.click(section(new RegExp(`^${QUESTION_LIST_LABEL.related_concepts} 2$`)));
    const list = screen.getByTestId("related-list");
    expect(within(list).getAllByTestId("question-row")).toHaveLength(2);
    expect(textOf(list)).toContain("These share a concept with this slide. None of them is tied to a page here.");
    expect(textOf(row("S90-Q03", list))).toContain("Concept-related. Through 'Sample concept one'. Not a claim about this slide.");
    expect(textOf(row("P90-Q01", list))).toContain("P90, question 1");
  });

  it("the lecture's list holds every question with all its ties or its one no-link line", () => {
    tab(4);
    fireEvent.click(section(new RegExp(`^${QUESTION_LIST_LABEL.all_lecture} 8$`)));
    const list = screen.getByTestId("lecture-questions");
    expect(within(list).getAllByTestId("question-row")).toHaveLength(8);
    expect(textOf(list)).toContain("8 questions: 3 anchored by the course, 3 with a suggested link, 2 without a link.");
    expect(textOf(row("S90-Q01", list))).toContain("Exact. A reviewed anchor of the course record names p. 2 and transcript lines 120–164.");
    expect(textOf(row("S90-Q01", list))).toContain("Stated for a part of the lecture. The course's study map places it in pp. 2–5 and names no single page.");
    expect(textOf(row("S90-Q04", list))).toContain("p. 4 and p. 9 support 2 of 3 criteria, each in part: criterion 1 (Sample concept one) and criterion 3 (Sample concept three).");
    expect(textOf(row("S90-Q03", list))).toContain("p. 5 supports 2 of 2 criteria: criterion 1 (Sample concept one) and criterion 2 (Sample concept two).");
    expect(textOf(row("S90-Q02", list))).toContain("Stated. The course record names pp. 3–5. Its page basis is not reviewed.");
    expect(textOf(row("S90-Q06", list))).toContain("Inspected, no supporting page found. Synthetic note of the checking pass: the proposed page names the term");
    expect(textOf(row("S90-Q07", list))).toContain("No suggested link. None is recorded for this question.");
    const kept = row("S90-Q08", list);
    expect(textOf(kept)).toContain("The wording of this question is kept in its original source. Open the source to read it.");
    expect(textOf(kept)).toContain("Exact. A reviewed anchor of the course record names transcript lines 40–52.");
    expect(textOf(list)).not.toMatch(/no slide (is )?named/i);
  });

  it("a transcript-line link opens the Transcript tab at those lines", () => {
    tab(2);
    const sources = within(row("S90-Q01", screen.getByTestId("this-slide-list"))).getByTestId("question-sources");
    fireEvent.click(within(sources).getByRole("link", { name: (name) => plain(name) === "transcript lines 120–164" }));
    const at = new URLSearchParams(screen.getByTestId("where").textContent!.split("?")[1]);
    expect(at.get("panel")).toBe("transcript");
    expect(at.get("line")).toBe("120");
    expect(at.get("page")).toBe("2");
  });
});

describe("Questions tab, a structural page", () => {
  it("keeps no list for the single slide, never says there are no questions, and opens the lecture's list", () => {
    const goTo = vi.fn();
    tab(1, sampleLectureView, goTo);
    expect(screen.queryByRole("button", { name: new RegExp(`^${QUESTION_LIST_LABEL.this_slide}`) })).toBeNull();
    const note = screen.getByTestId("structural-note");
    expect(within(note).getByRole("heading")).toHaveTextContent("Structural (title or section)");
    expect(textOf(note)).toContain("Lists for a single slide are not kept for a title, section, administrative or blank page. The lecture's questions stay available below.");
    fireEvent.click(within(note).getByRole("button", { name: "Next content" }));
    expect(goTo).toHaveBeenCalledWith(2);
    expect(section(new RegExp(`^${QUESTION_LIST_LABEL.all_lecture} 8$`))).toHaveAttribute("aria-expanded", "true");
    expect(textOf(screen.getByTestId("questions-tab"))).not.toMatch(/no questions?\b/i);
  });
});

describe("Questions tab, a page no question is tied to", () => {
  it("says so in one sentence and opens the lecture's list, so the lecture's questions are what is read", () => {
    tab(7);
    expect(section(new RegExp(`^${QUESTION_LIST_LABEL.this_slide} 0$`))).toHaveAttribute("aria-expanded", "true");
    expect(textOf(screen.getByTestId("lecture-questions-hint"))).toBe("No question is tied to this page. This lecture has 8 questions; they are listed under All lecture questions.");
    expect(section(new RegExp(`^${QUESTION_LIST_LABEL.all_lecture} 8$`))).toHaveAttribute("aria-expanded", "true");
    expect(within(screen.getByTestId("lecture-questions")).getAllByTestId("question-row")).toHaveLength(8);
  });

  it("opens Related concepts instead when the page has related questions, and leaves the lecture's list closed", () => {
    const shared: RelatedQuestion = { ...sampleLectureView.slides.find((slide) => slide.page === 2)!.related_questions![0]! };
    const view: LectureView = { ...sampleLectureView, slides: sampleLectureView.slides.map((slide) => (slide.page === 7 ? { ...slide, related_questions: [shared], related_questions_total: 1 } : slide)) };
    tab(7, view);
    expect(section(new RegExp(`^${QUESTION_LIST_LABEL.related_concepts} 1$`))).toHaveAttribute("aria-expanded", "true");
    expect(within(screen.getByTestId("related-list")).getAllByTestId("question-row")).toHaveLength(1);
    expect(section(new RegExp(`^${QUESTION_LIST_LABEL.all_lecture} 8$`))).toHaveAttribute("aria-expanded", "false");
  });

  it("lets the learner close what was opened for the page, and opens nothing on a page that has its own questions", () => {
    const drawn = liveTab(7);
    fireEvent.click(section(new RegExp(`^${QUESTION_LIST_LABEL.all_lecture} 8$`)));
    expect(section(new RegExp(`^${QUESTION_LIST_LABEL.all_lecture} 8$`))).toHaveAttribute("aria-expanded", "false");
    drawn.show(4, sampleLectureView);
    expect(section(new RegExp(`^${QUESTION_LIST_LABEL.this_slide} 3$`))).toHaveAttribute("aria-expanded", "true");
    expect(section(new RegExp(`^${QUESTION_LIST_LABEL.all_lecture} 8$`))).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Questions tab, after Reject", () => {
  const answer = (decision: string) => new Response(JSON.stringify({ course_id: SAMPLE_COURSE_ID, suggestion_id: "ia-0000000000000004", decision, revision: 1, status: "recorded", decided_at: null,
    question_id: "S90-Q04" }), { status: 200, headers: { "content-type": "application/json" } });

  it("leaves one line where the entry was: what was rejected, with Take back, and announces it", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => answer(JSON.parse(String(init?.body)).decision));
    vi.stubGlobal("fetch", fetchMock);
    const drawn = liveTab(4);
    expect(screen.queryByTestId("rejected-stub")).toBeNull();
    fireEvent.click(within(row("S90-Q04", screen.getByTestId("this-slide-list"))).getByRole("button", { name: /^Reject/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // The Brain's next view no longer ties the question to the page: the entry goes, the line stays in its place.
    const after = withoutSuggestion(sampleLectureView, "ia-0000000000000004");
    drawn.show(4, after);
    const list = screen.getByTestId("this-slide-list");
    expect(list.querySelector('[data-testid="question-row"][data-question-id="S90-Q04"]')).toBeNull();
    const stub = within(list).getByTestId("rejected-stub");
    expect(textOf(stub)).toContain("S90, question 4");
    expect(textOf(stub)).toContain("You rejected the suggested link pp. 4, 9.");
    expect(list.lastElementChild).toBe(stub); // third of three, as the entry was
    expect(textOf(screen.getByTestId("questions-announce"))).toBe("You rejected the suggested link pp. 4, 9 of S90, question 4 · Sample question 4. Take back is beside it.");
    expect(screen.getByTestId("questions-announce")).toHaveAttribute("aria-live", "polite");
    expect(section(new RegExp(`^${QUESTION_LIST_LABEL.this_slide} 2$`))).toBeInTheDocument(); // the count is still the rows that are questions

    fireEvent.click(within(stub).getByRole("button", { name: /^Take back/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({ decision: "cleared" });
    drawn.show(4, sampleLectureView); // the link is back: the entry returns and the line goes
    expect(screen.queryByTestId("rejected-stub")).toBeNull();
    expect(row("S90-Q04", screen.getByTestId("this-slide-list"))).toBeInTheDocument();
  });

  it("drops the line when the page changes, and shows none when the decision was not recorded", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => answer(JSON.parse(String(init?.body)).decision));
    vi.stubGlobal("fetch", fetchMock);
    const drawn = liveTab(4);
    fireEvent.click(within(row("S90-Q04", screen.getByTestId("this-slide-list"))).getByRole("button", { name: /^Reject/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const after = withoutSuggestion(sampleLectureView, "ia-0000000000000004");
    drawn.show(4, after);
    expect(screen.getByTestId("rejected-stub")).toBeInTheDocument();
    drawn.show(5, after);
    expect(screen.queryByTestId("rejected-stub")).toBeNull();
    drawn.show(4, after);
    expect(screen.queryByTestId("rejected-stub")).toBeNull();
  });

  it("keeps the line inside the entry when the question has another tie to the page", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => answer(JSON.parse(String(init?.body)).decision));
    vi.stubGlobal("fetch", fetchMock);
    // Question 4 is also named by the course record on this page.
    const exact = { ...sampleLectureView.slides.find((slide) => slide.page === 2)!.question_ties![0]!, ...{ question_id: "S90-Q04", number: 4, title: "Sample question 4", support_pages: [4], transcript_lines: [] } };
    const view: LectureView = { ...sampleLectureView, slides: sampleLectureView.slides.map((slide) => (slide.page === 4 ? { ...slide, question_ties: [...(slide.question_ties ?? []), exact] } : slide)) };
    const drawn = liveTab(4, view);
    fireEvent.click(within(row("S90-Q04", screen.getByTestId("this-slide-list"))).getByRole("button", { name: /^Reject/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    drawn.show(4, withoutSuggestion(view, "ia-0000000000000004"));
    const entry = row("S90-Q04", screen.getByTestId("this-slide-list"));
    expect(textOf(entry)).toContain("Exact. A reviewed anchor of the course record names this page.");
    expect(textOf(within(entry).getByTestId("rejected-stub"))).toContain("You rejected the suggested link pp. 4, 9.");
  });
});

describe("promptParts", () => {
  it("reads the emphasis marks a catalogued prompt carries and leaves every other asterisk alone", () => {
    expect(promptParts("**Model one cell.** Find its *wet* mass.")).toEqual([
      { text: "Model one cell.", mark: "strong" }, { text: " Find its ", mark: null }, { text: "wet", mark: "em" }, { text: " mass.", mark: null },
    ]);
    expect(promptParts("Compute 2*x*y and a * b * c.")).toEqual([{ text: "Compute 2*x*y and a * b * c.", mark: null }]);
    expect(promptParts("k_on and k_off stay as written")).toEqual([{ text: "k_on and k_off stay as written", mark: null }]);
    expect(promptParts("An unclosed **mark stays")).toEqual([{ text: "An unclosed **mark stays", mark: null }]);
    expect(promptParts("")).toEqual([]);
  });
  it("shows a prompt without its marks in an entry", () => {
    const view: LectureView = { ...sampleLectureView, slides: sampleLectureView.slides.map((slide) => (slide.page === 2
      ? { ...slide, question_ties: slide.question_ties!.map((tie) => ({ ...tie, prompt: "**Synthetic title.** State the *sample* idea." })) } : slide)) };
    tab(2, view);
    const prompt = within(row("S90-Q01", screen.getByTestId("this-slide-list"))).getByTestId("question-prompt");
    expect(textOf(prompt)).toBe("Synthetic title. State the sample idea.");
    expect(prompt.querySelector("strong")).toHaveTextContent("Synthetic title.");
    expect(prompt.querySelector("em")).toHaveTextContent("sample");
  });
});

describe("Questions tab, a view without R2 fields", () => {
  it("renders the lecture's questions from the course record alone and invents no tie", () => {
    tab(2, sampleLectureViewWithoutR2);
    // The course record places no question on this page, so the lecture's list is opened for it.
    expect(textOf(screen.getByTestId("lecture-questions-hint"))).toContain("The course record places no question on this page.");
    expect(section(new RegExp(`^${QUESTION_LIST_LABEL.all_lecture} 8$`))).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByTestId("lecture-questions");
    expect(within(list).getAllByTestId("question-row")).toHaveLength(8);
    expect(textOf(list)).not.toMatch(/Suggested link|Exact\.|Stated\./);
  });
});

describe("a question row in the bank, with the question's own ties (no deck is on screen there)", () => {
  const exact = sampleLectureView.questions.all.flatMap((entry) => entry.ties ?? []).find((tie) => tie.tie === "exact" && tie.granularity !== "section" && (tie.pages ?? []).length > 0)!;
  const suggested = sampleLectureView.questions.all.flatMap((entry) => entry.ties ?? []).find((tie) => tie.tie === "agent_inferred" && tie.granularity !== "section")!;
  const bankRow = (ties: LectureQuestionTie[]): QuestionRow => ({ ...sampleQuestionRowRejectedByLearner, question_id: "S90-Q77", ties, no_link: null,
    suggestion_history: { stale: 0, rejected_by_verifier: 0, rejected_by_learner: [], decisions_not_shown: [] } });

  it("a course anchor on the slides of its lecture reads as a page of the slides and opens the lecture", () => {
    mount(<ul><QuestionListItem courseId={SAMPLE_COURSE_ID} row={bankRow([{ ...exact, on_displayed_deck: false, on_lecture_deck: true }])} /></ul>, "/courses/sample-course/questions");
    const entry = row("S90-Q77");
    expect(textOf(entry)).not.toMatch(/another file|its source file/);
    const page = within(entry).getAllByRole("link").find((link) => /^pp?\./.test(link.textContent ?? ""))!;
    expect(page.getAttribute("href")).toContain(`/lectures/${exact.lecture_id}`);
  });

  it("a suggested link on the slides of its lecture opens the lecture too", () => {
    mount(<ul><QuestionListItem courseId={SAMPLE_COURSE_ID} row={bankRow([{ ...suggested, on_displayed_deck: false, on_lecture_deck: true }])} /></ul>, "/courses/sample-course/questions");
    const page = within(row("S90-Q77")).getAllByRole("link").find((link) => /^pp?\./.test(link.textContent ?? ""))!;
    expect(page.getAttribute("href")).toContain(`/lectures/${suggested.lecture_id}`);
  });

  it("a course anchor to a file of no lecture unit (a problem set) keeps the wording of the catalog anchors", () => {
    const sheet: LectureQuestionTie = { ...exact, tie: "stated", lecture_id: null, source_id: "src-problem-set", pages: [2], transcript_lines: [], on_displayed_deck: false, on_lecture_deck: false, logical_slide_ids: [] } as LectureQuestionTie;
    mount(<ul><QuestionListItem courseId={SAMPLE_COURSE_ID} row={bankRow([sheet])} /></ul>, "/courses/sample-course/questions");
    const entry = row("S90-Q77");
    expect(textOf(entry)).toContain("The course record names p. 2 of its source file, not a slide of the deck.");
    const page = within(entry).getAllByRole("link").find((link) => /^pp?\./.test(link.textContent ?? ""))!;
    expect(page.getAttribute("href")).toContain("/sources/src-problem-set"); // the file itself, never a lecture page
  });

  it("a course anchor to another file of a lecture unit says so", () => {
    const sheet: LectureQuestionTie = { ...exact, tie: "stated", source_id: "src-in-class-sheet", pages: [3], transcript_lines: [], on_displayed_deck: false, on_lecture_deck: false, logical_slide_ids: [] } as LectureQuestionTie;
    mount(<ul><QuestionListItem courseId={SAMPLE_COURSE_ID} row={bankRow([sheet])} /></ul>, "/courses/sample-course/questions");
    expect(textOf(row("S90-Q77"))).toContain("The course record names p. 3 of another file of this unit.");
  });
});

describe("a question row outside a lecture (the question bank)", () => {
  it("shows a rejected suggestion on request and lets the learner take the rejection back", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ course_id: SAMPLE_COURSE_ID, suggestion_id: "ia-0000000000000009", decision: "cleared", revision: 2,
      status: "recorded", decided_at: null, question_id: "S90-Q09" }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    mount(<ul><QuestionListItem courseId={SAMPLE_COURSE_ID} row={sampleQuestionRowRejectedByLearner} /></ul>, "/courses/sample-course/questions");
    const entry = row("S90-Q09");
    expect(textOf(entry)).toContain("No suggested link. You rejected the one that was suggested.");
    fireEvent.click(within(entry).getByRole("button", { name: /^Show it/ }));
    expect(textOf(entry)).toContain("p. 9");
    fireEvent.click(within(entry).getByRole("button", { name: /^Take back/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/courses/sample-course/suggestions/ia-0000000000000009/decision");
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({ decision: "cleared" });
  });
});
