// The concept tree (design specification 7.2, 5.10) in jsdom: what a row says, the keyboard of the tree pattern
// (roving focus, arrows, Home and End, typeahead, Enter), branches read only when opened, the group for what the
// catalog files under no topic, and the compact form of the Concepts tab (rows are links, topic to skill).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import type { ReactElement } from "react";
import { ConceptTree, rowLines, typeaheadIndex, wherePhrase } from "@/features/concepts/ConceptTree";
import { sampleEvidence } from "@/lib/fixtures/r2-sample";
import { NBSP } from "@/lib/labels";
import type { OutlineRow, OutlineView } from "@/lib/types";

const plain = (text: string | null | undefined): string => (text ?? "").split(NBSP).join(" ");
const row = (path: string, kind: OutlineRow["kind"], label: string, extra: Partial<OutlineRow> = {}): OutlineRow => {
  const ids = path.split(">");
  return { instance_id: path, node_id: ids[ids.length - 1]!, kind, label, relation: ids.length === 1 ? "root" : "child", depth: ids.length - 1, repeated_on_path: false, has_children: kind !== "criterion", ...extra };
};
const TREE: Record<string, OutlineRow[]> = {
  "": [
    row("t-a", "topic", "Alpha topic", { skills: 2, questions: 3 }), row("t-b", "topic", "Beta topic", { skills: 1, questions: 0 }),
    row("c-loose", "concept", "Loose concept", { relation: "unfiled", skills: 0, questions: 0, has_children: false }),
  ],
  "t-a": [row("t-a>c-1", "concept", "Calibration", { skills: 1, questions: 2, where: "on_this_page", support_pages: [4] }), row("t-a>c-2", "concept", "Blank subtraction", { skills: 1, questions: 1, where: "elsewhere_in_sequence", support_pages: [6] })],
  "t-a>c-1": [row("t-a>c-1>s-1", "skill", "Explain the slope", { evidence: sampleEvidence.independent, where: "group_level", support_pages: [4, 5, 6] }), row("t-a>c-1>s-2", "skill", "Read the blank", { has_children: false, evidence: sampleEvidence.unknown })],
  "t-a>c-1>s-1": [row("t-a>c-1>s-1>q-1", "question", "Lecture question 1", { evidence: sampleEvidence.assisted })],
  "t-a>c-1>s-1>q-1": [row("t-a>c-1>s-1>q-1>k-1", "criterion", "Criterion 1", { on_parent_skill: true }), row("t-a>c-1>s-1>q-1>k-2", "criterion", "Criterion 2", { on_parent_skill: false, evidence: sampleEvidence.not_separately_observed })],
  "t-b": [row("t-b>c-3", "concept", "Gamma concept", { skills: 1, questions: 0 })],
};
const view = (parent: string): OutlineView => ({
  course_id: "sample-course", scope: { kind: "course", basis: "catalog", note: "", questions_in_scope: 3 },
  canonical_counts: { topic: 2, concept: 4, skill: 2, question_family: 1, question: 1, criterion: 2, question_relationship: 0 }, rows: TREE[parent] ?? [], total_children: (TREE[parent] ?? []).length, truncated: false, note: "",
});

let requested: string[] = [];
beforeEach(() => {
  requested = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    requested.push(url.searchParams.get("parent") ?? "");
    return new Response(JSON.stringify(view(url.searchParams.get("parent") ?? "")), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => vi.unstubAllGlobals());

function mount(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}
const item = (name: string | RegExp) => screen.getByRole("treeitem", { name });
const press = (key: string) => act(() => { fireEvent.keyDown(document.activeElement!, { key }); });

describe("what a row says", () => {
  const place = { page: 5, position: { ordinal: 2, of: 3, kind: "build" as const }, groupPages: [4, 5, 6] };

  it("gives a topic its concepts (when the scope's graph states them), skills and questions, and a concept its skills and questions", () => {
    expect(plain(rowLines(TREE[""]![0]!, { scopeKind: "course", conceptCounts: new Map([["t-a", 2]]) }).counts)).toBe("2 concepts, 2 skills, 3 questions");
    expect(plain(rowLines(TREE[""]![0]!, { scopeKind: "course" }).counts)).toBe("2 skills, 3 questions");
    expect(plain(rowLines(TREE["t-a"]![0]!, { scopeKind: "course" }).counts)).toBe("1 skill, 2 questions");
    expect(rowLines(TREE["t-a>c-1"]![0]!, { scopeKind: "course" }).counts).toBeNull();
  });

  it("says where the support is only in the slide scope, naming the build when it is elsewhere", () => {
    expect(rowLines(TREE["t-a"]![0]!, { scopeKind: "lecture", place }).where).toBeNull();
    expect(plain(rowLines({ ...TREE["t-a"]![0]!, support_pages: [5] }, { scopeKind: "slide", place }).where)).toBe("on this build");
    expect(plain(rowLines(TREE["t-a"]![1]!, { scopeKind: "slide", place }).where)).toBe("elsewhere in this sequence: build 3");
    expect(plain(rowLines(TREE["t-a>c-1"]![0]!, { scopeKind: "slide", place }).where)).toBe("group-level: all 3 builds");
    // a page in no group
    expect(wherePhrase({ where: "on_this_page", support_pages: [9] }, { page: 9, position: null, groupPages: [9] })).toBe("on this page");
    expect(wherePhrase({ where: null }, place)).toBeNull();
  });

  it("says so when a suggested link is all that ties an entry to the slide, and says nothing of a course anchor", () => {
    const concept = { ...TREE["t-a"]![0]!, support_pages: [5] };
    const suggested = rowLines(concept, { scopeKind: "slide", place, ties: new Map([["c-1", "agent_inferred"]]) });
    expect(suggested.suggested).toBe(true);
    expect(plain(suggested.where)).toBe("on this build"); // where the support is stays its own phrase
    expect(rowLines(concept, { scopeKind: "slide", place, ties: new Map([["c-1", "exact"]]) }).suggested).toBe(false);
    expect(rowLines(concept, { scopeKind: "slide", place, ties: new Map([["c-1", "stated"]]) }).suggested).toBe(false);
    expect(rowLines(concept, { scopeKind: "slide", place }).suggested).toBe(false); // the tie is not known: nothing is claimed
    // A question the scope lists as tied by a suggestion only.
    const question = { ...TREE["t-a>c-1>s-1"]![0]!, where: "on_this_page" as const, support_pages: [5] };
    expect(rowLines(question, { scopeKind: "slide", place, suggestedQuestions: new Set(["q-1"]) }).suggested).toBe(true);
    expect(rowLines(question, { scopeKind: "slide", place, suggestedQuestions: new Set(["q-9"]) }).suggested).toBe(false);
    // Outside the slide scope there is no slide to be tied to.
    expect(rowLines(concept, { scopeKind: "lecture", place, ties: new Map([["c-1", "agent_inferred"]]) }).suggested).toBe(false);
  });

  it("draws the suggestion as a basis label on the row: the dashed square with its words", async () => {
    mount(<ConceptTree courseId="sample-course" scope="slide:lecture-90:5" scopeKind="slide" place={place} ties={new Map([["c-1", "agent_inferred"], ["c-2", "exact"]])} openKinds={["topic"]} onSelect={() => undefined} label="Concept outline" />);
    const calibration = await screen.findByRole("treeitem", { name: /Calibration/ });
    const basis = within(calibration).getByText("Suggested link").closest("[data-basis]");
    expect(basis).toHaveAttribute("data-basis", "suggested");
    expect(calibration).toHaveAccessibleDescription(/Suggested link/);
    expect(within(screen.getByRole("treeitem", { name: /Blank subtraction/ })).queryByText("Suggested link")).toBeNull();
  });

  it("states a gap in the words of the scope, and never for a skill that has questions", () => {
    const bare = TREE["t-a>c-1"]![1]!;
    expect(rowLines(bare, { scopeKind: "course" }).note).toBe("No question in the catalog");
    expect(rowLines(bare, { scopeKind: "lecture" }).note).toBe("No question in this lecture");
    expect(rowLines(bare, { scopeKind: "slide" }).note).toBe("No question tied to this slide");
    expect(rowLines(TREE["t-a>c-1"]![0]!, { scopeKind: "course" }).note).toBeNull();
    expect(rowLines(TREE["t-a>c-1>s-1>q-1"]![1]!, { scopeKind: "course" }).note).toBe("Assesses another skill of this question");
    expect(rowLines({ ...bare, repeated_on_path: true }, { scopeKind: "course" }).note).toBe("Already on this branch");
  });
});

describe("typeahead", () => {
  const labels = ["Alpha topic", "Beta topic", "Blank subtraction", "Calibration"];
  it("moves to the next row whose name starts with what was typed, and wraps round", () => {
    expect(typeaheadIndex(labels, 0, "b")).toBe(1);
    expect(typeaheadIndex(labels, 1, "b")).toBe(2);
    expect(typeaheadIndex(labels, 2, "b")).toBe(1);
    expect(typeaheadIndex(labels, 0, "bl")).toBe(2);
    expect(typeaheadIndex(labels, 3, "A")).toBe(0);
  });
  it("finds nothing for a name that does not occur", () => {
    expect(typeaheadIndex(labels, 0, "z")).toBe(-1);
    expect(typeaheadIndex([], 0, "a")).toBe(-1);
    expect(typeaheadIndex(labels, 0, " ")).toBe(-1);
  });
});

describe("the tree of the concept explorer", () => {
  it("opens at topic level, reads a branch only when it is opened, and goes down to criteria", async () => {
    const onSelect = vi.fn();
    mount(<ConceptTree courseId="sample-course" scope="course" scopeKind="course" onSelect={onSelect} label="Concept outline" />);
    const tree = await screen.findByRole("tree", { name: "Concept outline" });
    expect(within(tree).getAllByRole("treeitem").map((entry) => entry.dataset.label)).toEqual(["Alpha topic", "Beta topic", "No topic in the catalog"]);
    expect(requested).toEqual([""]);
    expect(item("Topic: Alpha topic")).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByRole("button", { name: "Expand Alpha topic" }));
    await screen.findByRole("treeitem", { name: "Concept: Calibration" });
    expect(requested).toEqual(["", "t-a"]);
    fireEvent.click(screen.getByRole("button", { name: "Expand Calibration" }));
    fireEvent.click(await screen.findByRole("button", { name: "Expand Explain the slope" }));
    fireEvent.click(await screen.findByRole("button", { name: "Expand Lecture question 1" }));
    await waitFor(() => expect(tree.querySelectorAll('[data-kind="criterion"]')).toHaveLength(2));
    expect(item("Criterion: Criterion 2")).toHaveAccessibleDescription(/Assesses another skill of this question/);
    expect(item("Criterion: Criterion 2")).toHaveAccessibleDescription(/Not separately observed/);
    expect(item("Criterion: Criterion 1")).not.toHaveAttribute("aria-expanded");

    // a state is a glyph with words, and the row's own level and place are announced
    expect(item("Skill: Explain the slope")).toHaveAccessibleDescription(/Independent/);
    expect(item("Skill: Explain the slope")).toHaveAttribute("aria-level", "3");
    expect(item("Question: Lecture question 1")).toHaveAccessibleDescription(/Assisted: solution shown/);

    fireEvent.click(within(item("Concept: Calibration")).getAllByRole("button").find((button) => button.hasAttribute("data-tree-action"))!);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0].node_id).toBe("c-1");
  });

  it("marks the selected node on every branch it sits on", async () => {
    mount(<ConceptTree courseId="sample-course" scope="course" scopeKind="course" selected="c-1" onSelect={() => undefined} reveal={["t-a", "c-1"]} label="Concept outline" />);
    const selected = await screen.findByRole("treeitem", { name: "Concept: Calibration" }); // the reveal opened the topic
    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(item("Concept: Blank subtraction")).toHaveAttribute("aria-selected", "false");
    expect(requested).toContain("t-a");
    // the selected row is opened as well: what it holds is listed under it, as the map draws what surrounds it
    expect(await screen.findByRole("treeitem", { name: "Skill: Explain the slope" })).toBeInTheDocument();
    expect(selected).toHaveAttribute("aria-expanded", "true");
    expect(requested).toContain("t-a>c-1");
    // and it can be closed again: the reveal does not hold it open
    fireEvent.click(screen.getByRole("button", { name: "Collapse Calibration" }));
    expect(selected).toHaveAttribute("aria-expanded", "false");
  });

  it("is one tab stop, moved by the arrow keys; Right opens and steps in, Left closes and steps out", async () => {
    mount(<ConceptTree courseId="sample-course" scope="course" scopeKind="course" onSelect={() => undefined} label="Concept outline" />);
    const tree = await screen.findByRole("tree");
    const stops = () => within(tree).getAllByRole("treeitem").filter((entry) => entry.tabIndex === 0).map((entry) => entry.dataset.label);
    expect(stops()).toEqual(["Alpha topic"]);

    act(() => item("Topic: Alpha topic").focus());
    press("ArrowDown");
    expect(document.activeElement).toBe(item("Topic: Beta topic"));
    expect(stops()).toEqual(["Beta topic"]);
    press("End");
    expect(document.activeElement).toBe(item("No topic in the catalog"));
    press("Home");
    expect(document.activeElement).toBe(item("Topic: Alpha topic"));

    press("ArrowRight"); // opens
    await screen.findByRole("treeitem", { name: "Concept: Calibration" });
    expect(item("Topic: Alpha topic")).toHaveAttribute("aria-expanded", "true");
    press("ArrowRight"); // steps in
    expect(document.activeElement).toBe(item("Concept: Calibration")); // the first child, in the order the Brain sent
    press("ArrowLeft"); // a closed row: steps out to its parent
    expect(document.activeElement).toBe(item("Topic: Alpha topic"));
    press("ArrowLeft"); // an open row: closes
    expect(item("Topic: Alpha topic")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("treeitem", { name: "Concept: Calibration" })).toBeNull();
  });

  it("moves by typing a name, and Enter selects the focused row", async () => {
    const onSelect = vi.fn();
    mount(<ConceptTree courseId="sample-course" scope="course" scopeKind="course" onSelect={onSelect} label="Concept outline" />);
    await screen.findByRole("tree");
    act(() => item("Topic: Alpha topic").focus());
    press("b");
    expect(document.activeElement).toBe(item("Topic: Beta topic"));
    press("Enter");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0].node_id).toBe("t-b");
  });

  it("lists what the catalog files under no topic as a last group of its own", async () => {
    mount(<ConceptTree courseId="sample-course" scope="course" scopeKind="course" onSelect={() => undefined} label="Concept outline" />);
    const group = await screen.findByRole("treeitem", { name: "No topic in the catalog" });
    expect(group).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Expand No topic in the catalog" }));
    expect(await screen.findByRole("treeitem", { name: "Concept: Loose concept" })).toHaveAttribute("aria-level", "2");
  });

  it("shows what it is given when the scope holds nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...view(""), rows: [], total_children: 0 }), { status: 200 })));
    mount(<ConceptTree courseId="sample-course" scope="slide:lecture-90:1" scopeKind="slide" onSelect={() => undefined} label="Concept outline" empty={<p>Nothing is listed for this page.</p>} />);
    expect(await screen.findByText("Nothing is listed for this page.")).toBeInTheDocument();
    expect(screen.queryByRole("tree")).toBeNull();
  });
});

describe("the same tree, compactly, in the Concepts tab", () => {
  it("starts open down to skills, stops there, and every row is a link into the concept map", async () => {
    mount(<ConceptTree courseId="sample-course" scope="slide:lecture-90:5" scopeKind="slide" hrefFor={(entry) => `/courses/sample-course/concepts?node=${entry.node_id}`} deepest="skill"
      openKinds={["topic", "concept"]} place={{ page: 5, position: { ordinal: 2, of: 3, kind: "build" }, groupPages: [4, 5, 6] }} label="Concepts of this slide" />);
    const skill = await screen.findByRole("treeitem", { name: "Skill: Explain the slope" });
    expect(skill).not.toHaveAttribute("aria-expanded"); // the tab stops at skills
    expect(skill).not.toHaveAttribute("aria-selected");
    expect(plain(skill.textContent)).toContain("group-level: all 3 builds");
    expect(within(skill).getByRole("link")).toHaveAttribute("href", "/courses/sample-course/concepts?node=s-1");
    expect(screen.queryByRole("treeitem", { name: /^Question/ })).toBeNull();
    expect(requested).not.toContain("t-a>c-1>s-1");
    expect(plain(item("Concept: Blank subtraction").textContent)).toContain("elsewhere in this sequence: build 3");
  });
});
