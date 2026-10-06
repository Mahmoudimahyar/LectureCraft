// The context side of the lecture workspace apart from the question lists (design specification 5.7, 5.8, 5.12): the
// panel's tabs and their counts, the scrolling body of a tab with its docked foot, what the tutor says beside Send, and
// the facts of the page in the Sources tab with the corrections it offers. Rendered in jsdom with the synthetic sample.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ContextPanel, TabFoot, TabScroll } from "@/features/lecture/ContextPanel";
import { SourcesPanel, groupingChoices } from "@/features/lecture/SourcesPanel";
import { NOT_ASSESSED_LEAD, tutorHeading } from "@/features/tutor/RequestCard";
import { aboutPage, sendBlockedReason } from "@/features/tutor/TutorPanel";
import { sampleLectureView, sampleLectureViewWithoutR2 } from "@/lib/fixtures/r2-sample";
import { NBSP } from "@/lib/labels";

const plain = (value: string | null | undefined): string => (value ?? "").split(NBSP).join(" ").replace(/\s+/g, " ").trim();
const textOf = (element: Element | null): string => plain(element?.textContent);

describe("ContextPanel", () => {
  const tabs = { tutor: <p>tutor body</p>, questions: <p>questions body</p>, concepts: <p>concepts body</p>, transcript: <p>transcript body</p>, sources: <p>sources body</p> };
  it("shows five text tabs in the fixed order, with the count of the first question list as a figure", () => {
    render(<ContextPanel tab="questions" onTabChange={() => undefined} counts={{ questions: 2 }} tabs={tabs} />);
    const names = within(screen.getByRole("tablist", { name: "Context panel" })).getAllByRole("tab").map((tab) => textOf(tab));
    expect(names).toEqual(["Tutor", expect.stringMatching(/^Questions ?2$/), "Concepts", "Transcript", "Sources"]);
    expect(screen.getByRole("tab", { name: /^Questions/ })).toHaveAttribute("aria-selected", "true");
  });
  it("leaves the figure out when the count is zero (a structural page, or a page without ties)", () => {
    render(<ContextPanel tab="questions" onTabChange={() => undefined} counts={{ questions: 0 }} tabs={tabs} />);
    expect(textOf(screen.getByRole("tab", { name: /^Questions/ }))).toBe("Questions");
  });
  it("keeps the tutor mounted behind another tab, so a draft is never lost to a tab change", () => {
    render(<ContextPanel tab="sources" onTabChange={() => undefined} tabs={tabs} />);
    const tutor = screen.getByTestId("tutor-panel");
    expect(tutor).toContainHTML("tutor body");
    expect(tutor).not.toBeVisible();
    expect(screen.queryByText("questions body")).toBeNull(); // the others are mounted on first use
    expect(screen.getByText("sources body")).toBeVisible();
  });
});

describe("TabScroll and TabFoot", () => {
  it("draws the foot under the scrolling body, after it in reading order, and outside what scrolls", () => {
    const { container } = render(<TabScroll><p>thread</p><TabFoot><button type="button">Send</button></TabFoot></TabScroll>);
    const scroller = container.querySelector("[data-tab-scroll]")!;
    const foot = container.querySelector("[data-tab-foot]")!;
    expect(scroller).toContainElement(screen.getByText("thread"));
    expect(foot).toContainElement(screen.getByRole("button", { name: "Send" }));
    expect(scroller).not.toContainElement(screen.getByRole("button", { name: "Send" }));
    expect(scroller.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("adds nothing when it stands inside another: the outer one scrolls and holds the foot", () => {
    const { container } = render(<TabScroll><TabScroll><p>thread</p><TabFoot><button type="button">Send</button></TabFoot></TabScroll></TabScroll>);
    expect(container.querySelectorAll("[data-tab-scroll]")).toHaveLength(1);
    expect(container.querySelector("[data-tab-foot]")).toContainElement(screen.getByRole("button", { name: "Send" }));
  });
  it("draws a foot written outside any scrolling body where it is written", () => {
    render(<div data-testid="alone"><TabFoot><button type="button">Send</button></TabFoot></div>);
    expect(screen.getByTestId("alone")).toContainElement(screen.getByRole("button", { name: "Send" }));
  });
});

describe("the tutor's composer", () => {
  it("says what the next message is about in the words of the identity line, never a slide number from the page index", () => {
    expect(plain(aboutPage(sampleLectureView, 2))).toBe("About page 2");
    expect(plain(aboutPage(sampleLectureView, 4))).toBe("About page 4, build 2 of 3");
    expect(plain(aboutPage(sampleLectureView, 7))).toBe("About page 7, step 2 of 2");
    expect(plain(aboutPage(sampleLectureViewWithoutR2, 4))).toBe("About page 4");
    expect(aboutPage(sampleLectureView, 4)).toContain(`page${NBSP}4`);
  });
  it("Send is off when the device is not paired, or while nothing is written; pairing is not judged before it is known", () => {
    expect(sendBlockedReason({ paired: false, ready: true, empty: false })).toBe("unpaired");
    expect(sendBlockedReason({ paired: false, ready: true, empty: true })).toBe("unpaired");
    expect(sendBlockedReason({ paired: true, ready: true, empty: true })).toBe("empty");
    expect(sendBlockedReason({ paired: true, ready: true, empty: false })).toBeNull();
    expect(sendBlockedReason({ paired: false, ready: false, empty: false })).toBeNull();
  });
  it("heads a reply by the kind of help that was asked for, and words the note as not assessed", () => {
    expect(tutorHeading({ action: "ask", depth: "quick" })).toBe("Tutor, quick answer");
    expect(tutorHeading({ action: "ask", depth: "standard" })).toBe("Tutor, explanation");
    expect(tutorHeading({ action: "ask", depth: "deep" })).toBe("Tutor, going deeper");
    expect(tutorHeading({ action: "explain", depth: "" })).toBe("Tutor, feedback");
    expect(NOT_ASSESSED_LEAD).toBe("Not assessed in this exchange.");
  });
});

describe("Sources tab", () => {
  const panel = (page: number, lecture = sampleLectureView) => render(
    <MemoryRouter><SourcesPanel courseId="sample-course" lecture={lecture} page={page} slide={lecture.slides.find((slide) => slide.page === page)} onPin={() => undefined} /></MemoryRouter>,
  );
  const fact = (term: string): string => {
    const row = [...screen.getByTestId("page-facts").querySelectorAll("dt")].find((node) => textOf(node) === term);
    return textOf(row?.nextElementSibling ?? null);
  };

  it("lists the sources of the lecture with the file and version facts of the deck", () => {
    panel(4);
    const sources = screen.getByRole("region", { name: "Sources of this lecture" });
    expect(textOf(within(sources).getByTestId("source-deck"))).toBe("12 pages. sample-deck-90.pdf · version v1-dddddddddddd");
    expect(textOf(sources)).toContain("Lecture recording");
    expect(textOf(sources)).toContain("1 h 20 min.");
    expect(textOf(within(sources).getByTestId("source-timing"))).toBe("Slide-linked. 6 ranges for 6 of 12 pages; 1 page expects none.");
  });

  it("says what is known of a page of a build group and how it was established", () => {
    panel(4);
    expect(fact("Position")).toBe("PDF page 4 of 12");
    expect(fact("Group")).toContain("Build 2 of 3, pp. 3–5.");
    expect(fact("Group")).toContain("Inferred from the file, generated: same heading, ordered text containment.");
    expect(fact("Printed slide number")).toBe("Not established");
    expect(fact("PowerPoint slide")).toBe("No match is recorded for this page");
    expect(fact("Role")).toContain("Instructional, generated.");
    expect(textOf(screen.getByRole("region", { name: "What the map cannot tell" }))).toContain("Text extraction cannot tell covered text from visible text.");
    expect(screen.getByRole("button", { name: "Correct the grouping or the role" })).toBeInTheDocument();
  });

  it("names a printed number and a PowerPoint match each with its own basis, and never derives one from the page index", () => {
    panel(8);
    expect(fact("Printed slide number")).toBe("5, printed on the page");
    expect(fact("PowerPoint slide")).toBe("6, matched by title and text, generated");
    expect(fact("Group")).toBe("A single page.");
    expect(fact("Role")).toContain("Worked example or question, agent-reviewed.");
  });

  it("without a source map claims the position only and offers no correction", () => {
    panel(4, sampleLectureViewWithoutR2);
    expect(fact("Position")).toBe("PDF page 4 of 12");
    expect(fact("Group")).toBe("Grouping not established.");
    expect(fact("Role")).toBe("Not established");
    expect(screen.queryByRole("button", { name: "Correct the grouping or the role" })).toBeNull();
    expect(screen.queryByRole("region", { name: "What the map cannot tell" })).toBeNull();
  });
});

describe("groupingChoices", () => {
  const requests = (page: number) => groupingChoices(sampleLectureView, page).map((choice) => [choice.id, choice.request.op, choice.request.pages]);
  it("inside a group offers a new slide from this page, every page alone, and joining with the neighbours", () => {
    expect(requests(4)).toEqual([["split_before", "split_before", [4]], ["split", "split", [3, 4, 5]], ["group_before", "group", [2, 3, 4, 5]], ["group_after", "group", [3, 4, 5, 6, 7]]]);
    expect(groupingChoices(sampleLectureView, 4).map((choice) => plain(choice.label))).toEqual(["Page 4 starts a new slide", "Each of pp. 3–5 is a slide of its own", "pp. 2–5 are one slide", "pp. 3–7 are one slide"]);
  });
  it("does not offer a new slide from the first page of a group, nor a neighbour the file does not have", () => {
    expect(requests(3).map(([id]) => id)).toEqual(["split", "group_before", "group_after"]);
    expect(requests(1)).toEqual([["group_after", "group", [1, 2]]]);
    expect(requests(12)).toEqual([["group_before", "group", [11, 12]]]);
    expect(requests(99)).toEqual([]);
  });
});
