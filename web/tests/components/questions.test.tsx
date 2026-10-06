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
import { QuestionListItem, answerAction, pageCitations, questionName } from "@/features/question/QuestionList";
import { SAMPLE_COURSE_ID, sampleLectureView, sampleLectureViewWithoutR2, sampleQuestionRowRejectedByLearner, sampleTieKeptByConfirmation } from "@/lib/fixtures/r2-sample";
import { DECISION_NOTE, NBSP, QUESTION_LIST_LABEL } from "@/lib/labels";
import { nextContentPage } from "@/lib/r2";
import type { LectureView, SlidePosition } from "@/lib/types";

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
function tab(page: number, view: LectureView = sampleLectureView, onGoToPage: (page: number) => void = () => undefined) {
  return mount(<QuestionsTab courseId={SAMPLE_COURSE_ID} lecture={view} page={page} slide={view.slides.find((slide) => slide.page === page)} onGoToPage={onGoToPage}
    nextContentPage={nextContentPage(view, page)} />, `/courses/sample-course/lectures/lecture-90?page=${page}&panel=questions`);
}
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
    expect(unchecked).toContain("This page supports 1 of 3.");
    expect(unchecked).toContain("Why: Synthetic rationale: the second step shows what criterion 1 asks about");
    expect(unchecked).toContain("On this build.");
  });

  it("cites the source pages: the page on screen is not a link, another page turns the slide to it", () => {
    const goTo = vi.fn();
    tab(4, sampleLectureView, goTo);
    const sources = within(row("S90-Q04", screen.getByTestId("this-slide-list"))).getByTestId("question-sources");
    expect(textOf(sources)).toBe("Sources p. 4 on screen p. 9");
    expect(within(sources).queryByRole("link", { name: (name) => plain(name) === "p. 4" })).toBeNull();
    fireEvent.click(within(sources).getByRole("link", { name: (name) => plain(name) === "p. 9" }));
    expect(goTo).toHaveBeenCalledWith(9);
    const group = within(row("S90-Q02", screen.getByTestId("this-slide-list"))).getByTestId("question-sources");
    expect(textOf(group)).toBe("Sources p. 3 build 1 of 3 p. 4 on screen p. 5 build 3 of 3");
  });

  it("lists the section ties apart, under their own heading and count, never among the page ties", () => {
    tab(4);
    const apart = screen.getByTestId("section-ties");
    expect(textOf(within(apart).getByRole("heading"))).toBe("In this part of the lecture, by the course's study map: pp. 2–5 (Sample section: the idea and its mechanism) 3");
    expect(within(apart).getAllByTestId("question-row")).toHaveLength(3);
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

describe("Questions tab, a view without R2 fields", () => {
  it("renders the lecture's questions from the course record alone and invents no tie", () => {
    tab(2, sampleLectureViewWithoutR2);
    fireEvent.click(section(new RegExp(`^${QUESTION_LIST_LABEL.all_lecture} 8$`)));
    const list = screen.getByTestId("lecture-questions");
    expect(within(list).getAllByTestId("question-row")).toHaveLength(8);
    expect(textOf(list)).not.toMatch(/Suggested link|Exact\.|Stated\./);
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
