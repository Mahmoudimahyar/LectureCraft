// The shared primitives, glyph families and labels (design specification 8.1 to 8.3): what each one says to
// assistive technology, which glyph stands for which state, and that no two members of a family share a shape.
// Rendered in jsdom: this checks structure, names and state attributes, not pixels (those are looked at in a browser).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import {
  Button, EmptyState, ErrorState, IconButton, LoadingState, Section, SectionToggle, Sections, Segmented, Skeleton, StaleNotice, StatusChip, Tab, TabList, TabPanel, Tabs, ToolbarButton, cn, formatMs,
} from "@/components/ui";
import { BASIS_GLYPH_KINDS, BasisGlyph, EVIDENCE_GLYPH_COLOUR, EVIDENCE_GLYPH_STATES, ErrorGlyph, EvidenceGlyph, KIND_GLYPH_KINDS, KindGlyph, PriorExposureGlyph, StaleGlyph } from "@/components/glyphs";
import { BasisLabel, StateLabel, rangeBasisGlyph, tieBasisGlyph, tieBasisWords } from "@/components/labels";
import { sampleEvidence, sampleRangeConfirmed, sampleRangeFirstVisit, sampleRangeManual, sampleRangeSecondVisit, sampleRangeSection } from "@/lib/fixtures/r2-sample";
import { EVIDENCE_STATE, NBSP, R2_ACTION, SECTION_TIE, TIE_KIND, evidenceLine, rangeKindLabel, suggestedLinkLabel } from "@/lib/labels";
import type { EvidenceState } from "@/lib/types";

/** The drawing of a glyph without its size, colour and class: what makes its shape. */
function shape(element: ReactElement): string {
  const { container, unmount } = render(element);
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("no glyph was drawn");
  const drawing = svg.innerHTML.replace(/\s(id|mask|class|key)="[^"]*"/g, "");
  unmount();
  return drawing;
}
const text = (element: Element | null): string => (element?.textContent ?? "").split(NBSP).join(" ");

describe("cn", () => {
  it("keeps a size of the type scale beside a colour (the merger knows the app's own names)", () => {
    expect(cn("text-ui", "text-muted")).toBe("text-ui text-muted");
    expect(cn("text-muted text-read")).toBe("text-muted text-read");
    expect(cn("text-head font-semibold", "text-accent-text")).toBe("text-head font-semibold text-accent-text");
  });

  it("lets a later size, colour or radius replace an earlier one of the same kind", () => {
    expect(cn("text-ui", "text-read")).toBe("text-read");
    expect(cn("text-muted", "text-accent-text")).toBe("text-accent-text");
    expect(cn("rounded-control", "rounded-row")).toBe("rounded-row");
    expect(cn("bg-pad", false, undefined, "bg-tint")).toBe("bg-tint");
  });
});

describe("Button", () => {
  it("is a button of type button with its label as its name", () => {
    render(<Button>Start from page 1</Button>);
    const button = screen.getByRole("button", { name: "Start from page 1" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("ll-btn");
    expect(button).not.toHaveClass("ll-btn-primary");
  });

  it("draws variants and sizes through classes, never through inline colour", () => {
    render(<><Button variant="primary">Resume lecture</Button><Button variant="quiet" size="sm">Cancel</Button><Button size="lg">Large</Button><Button size="xs">Accept</Button></>);
    expect(screen.getByRole("button", { name: "Resume lecture" })).toHaveClass("ll-btn", "ll-btn-primary");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("ll-btn-quiet", "ll-btn-sm");
    expect(screen.getByRole("button", { name: "Large" })).toHaveClass("ll-btn-lg");
    expect(screen.getByRole("button", { name: "Accept" })).toHaveClass("ll-btn-xs");
    for (const button of screen.getAllByRole("button")) expect(button.getAttribute("style")).toBeNull();
  });

  it("cannot be pressed while disabled or busy, and says busy only when it is", () => {
    const press = vi.fn();
    render(<><Button disabled onClick={press}>Send</Button><Button busy onClick={press}>Sending</Button><Button onClick={press}>Save</Button></>);
    const [off, busy, live] = [screen.getByRole("button", { name: "Send" }), screen.getByRole("button", { name: "Sending" }), screen.getByRole("button", { name: "Save" })];
    for (const button of [off, busy, live]) fireEvent.click(button);
    expect(press).toHaveBeenCalledTimes(1);
    expect(off).toBeDisabled();
    expect(off).not.toHaveAttribute("aria-busy");
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(live).not.toHaveAttribute("aria-busy");
  });
});

describe("IconButton and ToolbarButton", () => {
  it("names an icon button by its label and shows the same words as its tooltip", () => {
    render(<IconButton label="Next page"><svg aria-hidden /></IconButton>);
    const button = screen.getByRole("button", { name: "Next page" });
    expect(button).toHaveAttribute("title", "Next page");
    expect(button).toHaveClass("ll-ib");
  });

  it("keeps the sizes apart and passes a toggle's state through", () => {
    render(<><IconButton label="Small" size="sm">a</IconButton><IconButton label="Large" size="lg">b</IconButton><IconButton label="Repeat this range: on" aria-pressed>c</IconButton></>);
    expect(screen.getByRole("button", { name: "Small" })).toHaveClass("ll-ib-sm");
    expect(screen.getByRole("button", { name: "Large" })).toHaveClass("ll-ib-lg");
    expect(screen.getByRole("button", { name: "Repeat this range: on" })).toHaveAttribute("aria-pressed", "true");
  });

  it("names a toolbar button by its words; its icon and chevron are not part of the name", () => {
    render(<><ToolbarButton icon={<svg aria-hidden data-testid="lead" />} chevron>Fit page</ToolbarButton><ToolbarButton size="sm" aria-pressed>Whole recording</ToolbarButton></>);
    const fit = screen.getByRole("button", { name: "Fit page" });
    expect(fit).toHaveClass("ll-tbtn");
    expect(fit.querySelectorAll("svg")).toHaveLength(2);
    for (const icon of fit.querySelectorAll("svg")) expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Whole recording" })).toHaveClass("ll-tbtn-sm");
    expect(screen.getByRole("button", { name: "Whole recording", pressed: true })).toBeInTheDocument();
  });
});

describe("Segmented and Tabs", () => {
  it("offers one choice of a few and reports the one pressed", () => {
    const change = vi.fn();
    render(<Segmented label="Kind of help" value="quick" onChange={change} options={[{ value: "quick", label: "Quick answer" }, { value: "understand", label: "Understand" }, { value: "explain", label: "Explain back" }]} />);
    const group = screen.getByRole("radiogroup", { name: "Kind of help" });
    expect(group).toHaveClass("ll-seg");
    expect(within(group).getByRole("radio", { name: "Quick answer" })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "Understand" })).not.toBeChecked();
    fireEvent.click(within(group).getByRole("radio", { name: "Explain back" }));
    expect(change).toHaveBeenCalledWith("explain");
    // Pressing the chosen segment again does not clear the choice.
    fireEvent.click(within(group).getByRole("radio", { name: "Quick answer" }));
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("writes a tab's count as a figure after the label and leaves it out when there is nothing to count", () => {
    render(
      <Tabs defaultValue="questions">
        <TabList label="Context panel"><Tab value="tutor">Tutor</Tab><Tab value="questions" count={2}>Questions</Tab><Tab value="concepts" count={null}>Concepts</Tab><Tab value="sources" count={0}>Sources</Tab></TabList>
        <TabPanel value="tutor">Tutor content</TabPanel><TabPanel value="questions">Question content</TabPanel>
      </Tabs>,
    );
    const list = screen.getByRole("tablist", { name: "Context panel" });
    const questions = within(list).getByRole("tab", { name: "Questions 2" });
    expect(questions).toHaveAttribute("aria-selected", "true");
    expect(questions.querySelector(".ll-tab-n")).toHaveTextContent("2");
    expect(within(list).getByRole("tab", { name: "Tutor" }).querySelector(".ll-tab-n")).toBeNull();
    expect(within(list).getByRole("tab", { name: "Concepts" }).querySelector(".ll-tab-n")).toBeNull();
    expect(within(list).getByRole("tab", { name: "Sources 0" })).toBeInTheDocument(); // a zero is the caller's to leave out
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Question content");
  });
});

describe("section headings that open", () => {
  it("opens several sections at once and says which are open", () => {
    render(
      <Sections defaultValue={["slide"]}>
        <Section value="slide" title="On this slide" count={2}>Two entries</Section>
        <Section value="all" title="Whole lecture" count={20}>Twenty entries</Section>
      </Sections>,
    );
    const slide = screen.getByRole("button", { name: "On this slide 2" });
    const all = screen.getByRole("button", { name: "Whole lecture 20" });
    expect(slide).toHaveAttribute("aria-expanded", "true");
    expect(all).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Two entries")).toBeInTheDocument();
    expect(screen.queryByText("Twenty entries")).toBeNull();
    fireEvent.click(all);
    expect(all).toHaveAttribute("aria-expanded", "true");
    expect(slide).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Twenty entries")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
  });

  it("is a plain button with its own state when it stands alone", () => {
    const press = vi.fn();
    render(<SectionToggle aria-expanded={false} onClick={press} count={3}>Related concepts</SectionToggle>);
    const toggle = screen.getByRole("button", { name: "Related concepts 3", expanded: false });
    fireEvent.click(toggle);
    expect(press).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveClass("ll-sec");
  });
});

describe("loading, empty, error and stale", () => {
  it("announces loading in words and draws blocks, not a spinner", () => {
    const { container } = render(<LoadingState label="Reading the source inventory…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Reading the source inventory…");
    expect(container.querySelectorAll(".ll-sk").length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector(".animate-spin, .animate-pulse")).toBeNull();
    for (const block of container.querySelectorAll(".ll-sk")) expect(block).toHaveAttribute("aria-hidden", "true");
  });

  it("sizes a skeleton block from its props", () => {
    const { container } = render(<Skeleton width={96} height={72} />);
    expect(container.querySelector(".ll-sk")).toHaveStyle({ width: "96px", height: "72px" });
  });

  it("gives an empty state a heading, a sentence and its one action", () => {
    render(<EmptyState title="No lectures are registered for this course." action={<Button>Open the library</Button>}>Register a lecture in the course folder.</EmptyState>);
    expect(screen.getByRole("heading", { name: "No lectures are registered for this course." })).toBeInTheDocument();
    expect(screen.getByText("Register a lecture in the course folder.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open the library" })).toBeInTheDocument();
  });

  it("says what failed, what still works, and offers one action", () => {
    const retry = vi.fn();
    render(<ErrorState title="The transcript could not be loaded." error={new Error("The service on this PC did not answer.")} stillWorks="What is already open stays readable." retry={retry} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("The transcript could not be loaded.");
    expect(alert).toHaveTextContent("The service on this PC did not answer.");
    expect(alert).toHaveTextContent("What is already open stays readable.");
    expect(within(alert).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("keeps the older wording and offers no action when there is nothing to retry", () => {
    render(<ErrorState error={null} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("This could not be loaded");
    expect(alert).toHaveTextContent("Unknown problem");
    expect(within(alert).queryByRole("button")).toBeNull();
  });

  it("shows the stale line with a Refresh that does nothing until it is pressed", () => {
    const refresh = vi.fn();
    render(<StaleNotice onRefresh={refresh}>This list was made before the question catalog changed.</StaleNotice>);
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("This list was made before the question catalog changed.");
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(within(notice).getByRole("button", { name: R2_ACTION.refresh }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("draws a job status as a glyph and words, with no ring and no pill", () => {
    const { container } = render(<><StatusChip tone="success">Completed</StatusChip><StatusChip tone="danger">Failed</StatusChip><StatusChip tone="neutral">Queued</StatusChip></>);
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(container.querySelectorAll("svg")).toHaveLength(3);
    expect(container.querySelector("svg circle")).toBeNull(); // rings are evidence states and nothing else
    for (const icon of container.querySelectorAll("svg")) expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("still gives callers the clock from where they import it", () => {
    expect(formatMs(1_104_000)).toBe("18:24");
  });
});

describe("glyph families", () => {
  const evidence = EVIDENCE_GLYPH_STATES.map((state) => shape(<EvidenceGlyph state={state} />));
  const basis = BASIS_GLYPH_KINDS.map((kind) => shape(<BasisGlyph basis={kind} />));
  const kinds = KIND_GLYPH_KINDS.map((kind) => shape(<KindGlyph kind={kind} />));
  const others = [shape(<ErrorGlyph />), shape(<PriorExposureGlyph />), shape(<StaleGlyph />)];

  it("has five evidence states, six bases and six kinds", () => {
    expect(EVIDENCE_GLYPH_STATES).toHaveLength(5);
    expect([...EVIDENCE_GLYPH_STATES].sort()).toEqual(Object.keys(EVIDENCE_STATE).sort());
    expect(BASIS_GLYPH_KINDS).toHaveLength(6);
    expect(KIND_GLYPH_KINDS).toHaveLength(6);
  });

  it("never uses one shape for two meanings, inside a family or across families", () => {
    const all = [...evidence, ...basis, ...kinds, ...others];
    expect(new Set(all).size).toBe(all.length);
  });

  it("draws every evidence state as a ring and nothing else as one", () => {
    for (const drawing of evidence) expect(drawing).toMatch(/<circle[^>]*r="(10|9\.5)"|<circle[^>]*cx="12"[^>]*cy="12"[^>]*r="10"/);
    for (const drawing of [...basis, ...others.slice(0, 1)]) expect(drawing).not.toMatch(/<circle[^>]*r="(10|9\.5)"/);
  });

  it("draws every kind as a filled shape with no stroke", () => {
    for (const kind of KIND_GLYPH_KINDS) {
      const { container, unmount } = render(<KindGlyph kind={kind} />);
      const svg = container.querySelector("svg")!;
      expect(svg).toHaveAttribute("fill", "currentColor");
      expect(svg).toHaveAttribute("stroke", "none");
      expect(svg).toHaveAttribute("width", "12");
      unmount();
    }
  });

  it("colours an evidence glyph by its state alone, and draws a value it does not know as Unknown is drawn", () => {
    expect(EVIDENCE_GLYPH_COLOUR.independent).toBe("text-success");
    expect(EVIDENCE_GLYPH_COLOUR.assisted).toBe("text-caution");
    for (const state of ["not_separately_observed", "unknown", "not_applicable"] as const) expect(EVIDENCE_GLYPH_COLOUR[state]).toBe("text-unassessed");
    expect(shape(<EvidenceGlyph state="a_state_added_later" />)).toBe(shape(<EvidenceGlyph state="unknown" />));
    expect(shape(<EvidenceGlyph state="toString" />)).toBe(shape(<EvidenceGlyph state="unknown" />));
  });

  it("hides every glyph from assistive technology: the words beside it carry the meaning", () => {
    const { container } = render(<>{EVIDENCE_GLYPH_STATES.map((state) => <EvidenceGlyph key={state} state={state} />)}{BASIS_GLYPH_KINDS.map((kind) => <BasisGlyph key={kind} basis={kind} />)}
      {KIND_GLYPH_KINDS.map((kind) => <KindGlyph key={kind} kind={kind} />)}<ErrorGlyph /><PriorExposureGlyph /><StaleGlyph /></>);
    const glyphs = container.querySelectorAll("svg");
    expect(glyphs).toHaveLength(5 + 6 + 6 + 3);
    for (const glyph of glyphs) expect(glyph).toHaveAttribute("aria-hidden", "true");
  });

  it("gives two Independent glyphs on one page their own cut-outs", () => {
    const { container } = render(<><EvidenceGlyph state="independent" /><EvidenceGlyph state="independent" /></>);
    const ids = [...container.querySelectorAll("mask")].map((mask) => mask.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
  });
});

describe("StateLabel", () => {
  it("says each of the five states in the words of the label table, with what stands beside it", () => {
    for (const state of Object.keys(sampleEvidence) as EvidenceState[]) {
      const { container, unmount } = render(<StateLabel evidence={sampleEvidence[state]} />);
      const label = container.querySelector(".ll-state")!;
      expect(text(label), state).toBe(evidenceLine(sampleEvidence[state]).split(NBSP).join(" "));
      expect(label).toHaveAttribute("data-state", state);
      expect(label.querySelector("svg")).toHaveClass(EVIDENCE_GLYPH_COLOUR[state]);
      unmount();
    }
  });

  it("shows prior exposure beside the state with its own glyph, and never as the state", () => {
    const { container } = render(<StateLabel evidence={sampleEvidence.independent} />);
    const label = container.querySelector(".ll-state")!;
    expect(text(label)).toBe("Independent · 2 attempts · prior exposure");
    expect(label.querySelectorAll("svg")).toHaveLength(2);
    expect(label.querySelector("svg")).toHaveClass("text-success"); // prior exposure changes neither the glyph nor its colour
    expect(label.querySelector(".ll-beside svg")).toHaveClass("text-muted");
    expect(label.querySelector(".text-caution")).toBeNull();
  });

  it("adds nothing for a question not seen before or with nothing recorded", () => {
    const { container } = render(<><StateLabel evidence={sampleEvidence.not_separately_observed} /><StateLabel evidence={sampleEvidence.not_applicable} /></>);
    const [first, second] = [...container.querySelectorAll(".ll-state")];
    expect(text(first!)).toBe("Not separately observed");
    expect(text(second!)).toBe("Not applicable");
    expect(container.querySelectorAll(".ll-beside")).toHaveLength(0);
  });

  it("never writes unknown as zero attempts", () => {
    const { container } = render(<StateLabel evidence={sampleEvidence.unknown} />);
    expect(text(container.querySelector(".ll-state"))).toBe("Unknown · no recorded attempt");
    expect(container.textContent).not.toMatch(/0/);
  });

  it("takes a bare state, other words and its own beside-line", () => {
    const { container } = render(<><StateLabel state="assisted" /><StateLabel state="independent" label="Independent" beside={["1 attempt", null, "last week"]} priorExposure /></>);
    const [bare, composed] = [...container.querySelectorAll(".ll-state")];
    expect(text(bare!)).toBe("Assisted");
    expect(text(composed!)).toBe("Independent · 1 attempt · last week · prior exposure");
  });

  it("shows a state this build has no words for as recorded, with the neutral ring", () => {
    const { container } = render(<StateLabel state="observed_in_group" />);
    const label = container.querySelector(".ll-state")!;
    expect(text(label)).toBe("observed in group");
    expect(label.querySelector("svg")).toHaveClass("text-unassessed");
  });
});

describe("BasisLabel", () => {
  const tie = (learner_decision: "confirmed" | "rejected" | null, state: "agent_inferred" | "agent_reviewed" = "agent_inferred", verdict: "upheld" | "narrowed" | "rejected" | null = null) =>
    ({ tie: "agent_inferred", state, verdict, learner_decision });

  it("gives each kind of tie its own glyph", () => {
    expect(tieBasisGlyph({ tie: "exact" })).toBe("exact");
    expect(tieBasisGlyph({ tie: "stated" })).toBe("stated");
    expect(tieBasisGlyph({ tie: "stated", granularity: "section" })).toBe("stated");
    expect(tieBasisGlyph({ tie: "concept_related" })).toBe("concept_related");
    expect(tieBasisGlyph(tie(null))).toBe("suggested");
    expect(tieBasisGlyph(tie(null, "agent_reviewed", "upheld"))).toBe("checked");
    expect(tieBasisGlyph(tie(null, "agent_reviewed", "narrowed"))).toBe("checked");
    expect(tieBasisGlyph(tie("confirmed"))).toBe("by_you");
    expect(tieBasisGlyph(tie("confirmed", "agent_reviewed", "upheld"))).toBe("by_you");
    expect(tieBasisGlyph({ tie: "a_kind_added_later" })).toBe("suggested");
  });

  it("never draws a suggested link with the solid square of an exact or a stated anchor, whoever checked or confirmed it", () => {
    for (const decision of ["confirmed", "rejected", null] as const) {
      for (const [state, verdict] of [["agent_inferred", null], ["agent_reviewed", "upheld"], ["agent_reviewed", "narrowed"], ["agent_reviewed", "rejected"]] as const) {
        expect(["exact", "stated"]).not.toContain(tieBasisGlyph(tie(decision, state, verdict)));
        expect(tieBasisWords(tie(decision, state, verdict))).toBe(suggestedLinkLabel({ state, verdict, learner_decision: decision }));
        expect(tieBasisWords(tie(decision, state, verdict))).not.toMatch(/^(Exact|Stated)/);
      }
    }
  });

  it("does not draw a link the second pass rejected as checked", () => {
    expect(tieBasisGlyph(tie(null, "agent_reviewed", "rejected"))).toBe("suggested");
  });

  it("words each tie from the label tables", () => {
    expect(tieBasisWords({ tie: "exact" })).toBe(TIE_KIND.exact.label);
    expect(tieBasisWords({ tie: "stated" })).toBe(TIE_KIND.stated.label);
    expect(tieBasisWords({ tie: "stated", granularity: "section" })).toBe(SECTION_TIE.label);
    expect(tieBasisWords({ tie: "concept_related" })).toBe(TIE_KIND.concept_related.label);
    expect(tieBasisWords({ tie: "a_kind_added_later" })).toBe("a kind added later");
  });

  it("gives a range the dashed square until a person marked it", () => {
    expect(rangeBasisGlyph(sampleRangeFirstVisit)).toBe("suggested");
    expect(rangeBasisGlyph(sampleRangeSecondVisit)).toBe("checked");
    expect(rangeBasisGlyph(sampleRangeSection)).toBe("suggested");
    expect(rangeBasisGlyph(sampleRangeConfirmed)).toBe("by_you");
    expect(rangeBasisGlyph(sampleRangeManual)).toBe("by_you");
  });

  it("renders the glyph, the words and the sentence of a question entry", () => {
    const { container } = render(<BasisLabel tie={{ tie: "stated" }} sentence="The course record names this page. Its page basis is not reviewed." />);
    const label = container.querySelector(".ll-basis")!;
    expect(label).toHaveAttribute("data-basis", "stated");
    expect(label.querySelector(".ll-basis-strong")).toHaveTextContent("Stated.");
    expect(text(label)).toBe("Stated. The course record names this page. Its page basis is not reviewed.");
    expect(label.querySelector("svg")).toHaveClass("text-muted");
  });

  it("renders a range in the words of the label functions, muted and without emphasis", () => {
    const { container } = render(<BasisLabel range={sampleRangeFirstVisit} />);
    const label = container.querySelector(".ll-basis")!;
    expect(text(label)).toBe(rangeKindLabel(sampleRangeFirstVisit));
    expect(label.querySelector(".ll-basis-strong")).toBeNull();
    expect(label).toHaveAttribute("data-basis", "suggested");
  });

  it("takes a glyph and words of the caller's choosing", () => {
    const { container } = render(<BasisLabel basis="by_you" strong>Marked by you</BasisLabel>);
    const label = container.querySelector(".ll-basis")!;
    expect(label).toHaveAttribute("data-basis", "by_you");
    expect(label.querySelector(".ll-basis-strong")).toHaveTextContent("Marked by you");
    expect(text(label)).toBe("Marked by you");
  });
});
