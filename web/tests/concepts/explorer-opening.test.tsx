// How the concept explorer opens (design specification 7.1, 7.3; UI contract R2-C): "Concept map" opens on something
// drawn, with its detail beside it. A lecture opens with its first topic selected, and so does a slide of three topics
// or fewer; the course scope entered from a lecture opens on that lecture's first topic; the course scope entered from
// Study keeps its topic cards and selects nothing. The selection is written into the address like any other. Also the words
// of the map (its key, the line above it, a node's evidence), the scope switch from the first paint, and which
// questions of a node the scope holds. The Brain is a LABELED DOUBLE (a stubbed fetch); the app state is a stand-in
// that carries only the workspace view.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, configure, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { ConceptExplorer, questionsInScope, scopeSegments } from "@/features/concepts/ConceptExplorer";
import { KEY_WORDS, drawnSentence, edgeTitle, nodeStateLines } from "@/features/concepts/ConceptMap";
import { buildMapModel } from "@/features/concepts/map-model";
import { sampleConceptGraphLecture, sampleConceptGraphSlide, sampleEvidence } from "@/lib/fixtures/r2-sample";
import { NBSP } from "@/lib/labels";
import type { ConceptGraphEdge, ConceptGraphNode, ConceptGraphView, OutlineView } from "@/lib/types";

vi.mock("@/app/state", () => ({ useApp: () => ({ workspace: { courses: [{ course_id: "sample-course", display_name: "Sample course (from the workspace view)" }] } }) }));
// An opening is several answers one after another (the scope, the selection written to the address, its neighbourhood, its
// detail): on a busy machine that can take longer than the library's one second, and waiting longer changes no result.
configure({ asyncUtilTimeout: 5000 });

const plain = (text: string | null | undefined): string => (text ?? "").split(NBSP).join(" ");
const node = (id: string, kind: ConceptGraphNode["kind"], label: string, extra: Partial<ConceptGraphNode> = {}): ConceptGraphNode =>
  ({ id, kind, label, counts: { skills: 1, questions: 1 }, in_scope: true, where: null, support_pages: [], evidence: null, ...extra });
let serial = 0;
const edge = (relation: string, from: string, to: string): ConceptGraphEdge => ({ id: `e-${(serial += 1)}`, from, to, family: "structure", relation, provenance: "question index", automatic_credit: false, tie: null, support_pages: null });

/** A course of four topics; lecture-90 holds two of them, lecture-91 all four. */
const TOPICS = ["Delta", "Alpha", "Charlie", "Bravo"].map((name) => node(`t-${name.toLowerCase()}`, "topic", `${name} topic`));
const CONCEPTS = TOPICS.map((topic) => node(`c-${topic.id.slice(2)}`, "concept", `${topic.label.split(" ")[0]} concept`));
const HELD: Record<string, string[]> = { course: TOPICS.map((topic) => topic.id), "lecture:lecture-90": ["t-delta", "t-charlie"], "lecture:lecture-91": TOPICS.map((topic) => topic.id), "slide:lecture-90:4": ["t-charlie"] };
function scopeGraph(scope: string, focus: string | null): ConceptGraphView | null {
  const held = HELD[scope];
  if (!held) return null;
  const [kind, lectureId, page] = scope.split(":");
  const topics = TOPICS.filter((topic) => held.includes(topic.id));
  const concepts = CONCEPTS.filter((concept) => held.includes(`t-${concept.id.slice(2)}`));
  const all = [...topics, ...concepts];
  const nodes = focus ? all.filter((entry) => entry.id === focus || entry.id.slice(2) === focus.slice(2)) : all;
  return {
    course_id: "sample-course", graph_version: "concept-graph/1",
    scope: { kind: kind as "course" | "lecture" | "slide", lecture_id: lectureId ?? null, page: page ? Number(page) : null, logical_slide_id: page ? "ls-sample-p4" : null, label: page ? `PDF page ${page} of 12` : null, pages: page ? [Number(page)] : [], note: null },
    nodes, edges: concepts.filter((concept) => nodes.includes(concept)).map((concept) => edge("topic_includes_concept", `t-${concept.id.slice(2)}`, concept.id)).filter((entry) => nodes.some((candidate) => candidate.id === entry.from)),
    focus, truncated: false, dropped: 0, totals: { topic: topics.length, concept: concepts.length, skill: 0, question: 0, criterion: 0 },
    revisions: { question_index_sha256: "a".repeat(64), map_revision: null, evidence_revision: "b".repeat(16), scope_revision: scope },
  };
}
const outline: OutlineView = { course_id: "sample-course", scope: { kind: "course", basis: "catalog", note: "", questions_in_scope: 0 },
  canonical_counts: { topic: 4, concept: 4, skill: 0, question_family: 0, question: 0, criterion: 0, question_relationship: 0 }, rows: [], total_children: 0, truncated: false, note: "" };

let asked: string[] = [];
beforeEach(() => {
  asked = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.pathname.endsWith("/concept-graph")) {
      const scope = url.searchParams.get("scope") ?? "course";
      asked.push(`${scope}${url.searchParams.get("focus") ? ` focus=${url.searchParams.get("focus")}` : ""}`);
      const graph = scopeGraph(scope, url.searchParams.get("focus"));
      return graph ? json(graph) : json({ detail: "Unknown scope" }, 404);
    }
    if (url.pathname.endsWith("/outline")) return json(outline);
    if (url.pathname.endsWith("/outline/node")) {
      const id = url.searchParams.get("id") ?? "";
      const found = [...TOPICS, ...CONCEPTS].find((entry) => entry.id === id);
      return found ? json({ node: { node_id: id, kind: found.kind, label: found.label }, parents: [], sources: [], sources_total: 0, questions: [], questions_total: 0, links: [], definition: null,
        evidence: { unit: "skill", skills: [], skills_total: 0, state: "unknown", assistance: null, prior_exposure: "unknown", attempts: 0, observations: [], summary: { independent: 0, assisted: 0, not_separately_observed: 0, unknown: 0, observations: 0, attempts: 0 } } })
        : json({ detail: "Unknown catalog object" }, 404);
    }
    if (/\/courses\/[^/]+$/.test(url.pathname)) return json({ course_id: "sample-course", display_name: "Sample course", lectures: [{ lecture_id: "lecture-90", title: "Sample lecture 90" }, { lecture_id: "lecture-91", title: "Sample lecture 91" }] });
    return json({ detail: "not mocked" }, 404);
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

let address = "";
function Address() {
  const location = useLocation();
  address = `${location.pathname}${location.search}`;
  return null;
}
function open(path: string, state?: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: path.split("?")[0]!, search: path.includes("?") ? `?${path.split("?")[1]}` : "", state }]}>
        <Address />
        <Routes><Route path="courses/:courseId/concepts" element={<ConceptExplorer />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const selected = (): string | null => new URLSearchParams(address.split("?")[1] ?? "").get("node");

describe("the selection a scope opens with", () => {
  it("selects the first topic of a lecture of three topics or fewer, in the order the map draws them", async () => {
    open("/courses/sample-course/concepts?scope=lecture%3Alecture-90");
    await waitFor(() => expect(selected()).toBe("t-charlie"));
    expect(new URLSearchParams(address.split("?")[1]).get("scope")).toBe("lecture:lecture-90"); // the scope stays in the address
    expect(await screen.findByRole("heading", { name: "Charlie topic", hidden: true })).toBeInTheDocument(); // the detail opens with it (one pane is shown at a time in this window)
  });

  it("selects the first topic of a slide", async () => {
    open("/courses/sample-course/concepts?scope=slide%3Alecture-90%3A4");
    await waitFor(() => expect(selected()).toBe("t-charlie"));
  });

  it("selects the first topic of a lecture of more than three topics too, and asks for that topic's own neighbourhood", async () => {
    open("/courses/sample-course/concepts?scope=lecture%3Alecture-91");
    await waitFor(() => expect(selected()).toBe("t-alpha"));
    await screen.findByText(/: 4\sconcepts/);
    await waitFor(() => expect(asked).toContain("lecture:lecture-91 focus=t-alpha")); // drawn from the topic's neighbourhood, not as the whole lecture
    expect(await screen.findByRole("heading", { name: "Alpha topic", hidden: true })).toBeInTheDocument();
  });

  it("selects nothing in the course scope entered from Study", async () => {
    open("/courses/sample-course/concepts");
    await screen.findByText(/^Course: 4\sconcepts/);
    expect(selected()).toBeNull();
    expect(asked.every((scope) => scope === "course")).toBe(true); // no lecture is looked up for it
    expect(screen.getByRole("heading", { name: "Nothing is selected", hidden: true })).toBeInTheDocument();
  });

  it("opens the course scope entered from a lecture on that lecture's first topic", async () => {
    open("/courses/sample-course/concepts", { returnTo: "/courses/sample-course/lectures/lecture-90?page=4", returnLabel: "Back to page 4" });
    await waitFor(() => expect(selected()).toBe("t-charlie"));
    expect(new URLSearchParams(address.split("?")[1]).get("scope")).toBeNull(); // still the course scope
    expect(asked).toContain("lecture:lecture-90");
    expect(asked).toContain("course focus=t-charlie");
  });

  it("keeps a selection that came with the address", async () => {
    open("/courses/sample-course/concepts?scope=lecture%3Alecture-90&node=c-delta");
    expect(await screen.findByRole("heading", { name: "Delta concept", hidden: true })).toBeInTheDocument();
    await waitFor(() => expect(asked).toContain("lecture:lecture-90 focus=c-delta"));
    expect(selected()).toBe("c-delta");
  });
});

describe("the scope switch, from the first paint", () => {
  it("always holds Course and Lecture, Lecture waiting disabled until a lecture is known", () => {
    expect(scopeSegments({ lectureId: null, page: null, lecturesLoading: true })).toEqual([
      { value: "course", label: "Course", disabled: false, why: null }, { value: "lecture", label: "Lecture", disabled: true, why: "Reading the course's lectures…" },
    ]);
    expect(scopeSegments({ lectureId: "lecture-90", page: null, lecturesLoading: false }).map((entry) => `${entry.label}:${entry.disabled}`)).toEqual(["Course:false", "Lecture:false"]);
    expect(scopeSegments({ lectureId: null, page: null, lecturesLoading: false })[1]).toMatchObject({ disabled: true, why: "This course lists no lecture" });
    expect(scopeSegments({ lectureId: "lecture-90", page: 4, lecturesLoading: false }).map((entry) => entry.label)).toEqual(["Course", "Lecture", "This slide"]);
  });

  it("shows both segments before the course's lectures have arrived", async () => {
    open("/courses/sample-course/concepts");
    // the first paint, before any answer: Course is chosen, Lecture is there and waits
    const radios = screen.getAllByRole("radio");
    expect(radios.map((radio) => radio.textContent)).toEqual(expect.arrayContaining(["Course", "Lecture"]));
    expect(screen.getAllByRole("radio", { name: "Lecture" })[0]).toBeDisabled();
    await waitFor(() => expect(screen.getAllByRole("radio", { name: "Lecture" })[0]).not.toBeDisabled());
  });
});

describe("which questions of a node the scope holds", () => {
  const concept = sampleConceptGraphSlide.nodes.find((entry) => entry.id === sampleConceptGraphSlide.focus)!;
  const inScope = sampleConceptGraphSlide.nodes.filter((entry) => entry.kind === "question" && entry.in_scope !== false).map((entry) => entry.id);

  it("reads them from the node's own neighbourhood, when they are as many as the node's own count", () => {
    expect([...(questionsInScope(sampleConceptGraphSlide, { ...concept, counts: { skills: 1, questions: inScope.length } }, "slide") ?? [])].sort()).toEqual([...inScope].sort());
    expect(inScope).not.toContain("P90-Q01"); // a question drawn although it lies outside the scope is not one of them
  });

  it("says nothing when it cannot be said in full", () => {
    const counted = { ...concept, counts: { skills: 1, questions: inScope.length } };
    expect(questionsInScope(sampleConceptGraphSlide, counted, "course")).toBeNull(); // the course scope holds every question
    expect(questionsInScope(sampleConceptGraphSlide, { ...counted, counts: { skills: 1, questions: inScope.length + 1 } }, "slide")).toBeNull(); // not as many as the node says
    expect(questionsInScope({ ...sampleConceptGraphSlide, truncated: true, dropped: 2 }, counted, "slide")).toBeNull(); // cut by the limit
    expect(questionsInScope(sampleConceptGraphSlide, { ...counted, kind: "topic" }, "slide")).toBeNull(); // a topic's neighbourhood does not reach its questions
    expect(questionsInScope(sampleConceptGraphSlide, { ...counted, id: "another" }, "slide")).toBeNull(); // not this node's neighbourhood
    expect(questionsInScope(undefined, counted, "slide")).toBeNull();
  });
});

describe("the words of the map", () => {
  it("names each line of the key by what it says of the two things it joins", () => {
    expect(KEY_WORDS).toMatchObject({ hierarchy: "Part of", assessment: "Assesses", source: "Supported on this slide" });
    expect(Object.values(KEY_WORDS)).not.toContain("Outline");
    expect(edgeTitle({ legend: "hierarchy", label: null, tie: null, provenance: "question index" })).toBe("Part of. From question index.");
    expect(edgeTitle({ legend: "source", label: null, tie: "agent_inferred", provenance: "suggested link (agent-inferred)" })).toBe("Supported on this slide: Suggested link. From suggested link (agent-inferred).");
  });

  it("says above the map what is drawn", () => {
    expect(drawnSentence(buildMapModel(sampleConceptGraphLecture))).toBe("Drawn: what surrounds the selected row.");
    expect(drawnSentence(buildMapModel({ ...sampleConceptGraphSlide, focus: null }))).toBe("Drawn: the concepts and skills this slide supports.");
    const lecture: ConceptGraphView = { ...sampleConceptGraphLecture, focus: null, nodes: sampleConceptGraphLecture.nodes.filter((entry) => ["topic", "concept", "skill"].includes(entry.kind)),
      edges: sampleConceptGraphLecture.edges.filter((entry) => entry.family === "structure" && !/Q0|P90/.test(`${entry.from}${entry.to}`)) };
    expect(drawnSentence(buildMapModel(lecture, { overview: true }))).toBe("Drawn: its topics with their concepts.");
    expect(drawnSentence(buildMapModel(lecture, { overview: true, depth: 2 }))).toBe("Drawn: its topics with their concepts and skills.");
    expect(drawnSentence(buildMapModel({ ...lecture, focus: "t-sample-a" }))).toBe("Drawn: the selected topic with its concepts.");
    expect(drawnSentence(buildMapModel({ ...lecture, focus: "t-sample-a" }, { depth: 2 }))).toBe("Drawn: the selected topic with its concepts and their skills.");
    expect(drawnSentence(buildMapModel({ ...lecture, focus: null }))).toBe(""); // the topic cards have their own sentence
  });

  it("gives a node's evidence as two lines: the state, never broken unless it names a kind of help, then what stands beside it", () => {
    expect(nodeStateLines(sampleEvidence.unknown)).toEqual({ state: "Unknown", unbroken: true, beside: "no recorded attempt" });
    expect(nodeStateLines(sampleEvidence.not_separately_observed)).toMatchObject({ state: "Not separately observed", unbroken: true });
    const assisted = nodeStateLines(sampleEvidence.assisted);
    expect(assisted.state).toBe("Assisted: solution shown");
    expect(assisted.unbroken).toBe(false);
    expect(plain(assisted.beside)).toBe("1 attempt · prior exposure");
    // prior exposure is said beside the state and is never a state
    expect(plain(nodeStateLines(sampleEvidence.independent).beside)).toBe("2 attempts · prior exposure");
    expect(nodeStateLines(sampleEvidence.not_applicable).beside).toBeNull();
  });
});
