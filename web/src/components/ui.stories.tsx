// Shared component states for local visual review (design specification 8.1 to 8.3). Every story draws its states
// twice, on a light and on a dark ground side by side, so both themes are reviewed at one glance whatever the toolbar
// says. All strings are synthetic.
import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Bookmark, ChevronLeft, ChevronRight, Maximize, Pencil, Repeat, Search, SkipForward, Volume2 } from "lucide-react";
import {
  Button, Callout, Dialog, EmptyState, ErrorState, Field, IconButton, LoadingState, Markdown, OUTCOME_LABEL, PageHeader, Section, SectionToggle, Sections, Segmented, Skeleton, StaleNotice, StatusChip, Tab,
  TabList, TabPanel, Tabs, ToolbarButton, type Tone,
} from "./ui";
import { BASIS_GLYPH_KINDS, BasisGlyph, EVIDENCE_GLYPH_STATES, ErrorGlyph, EvidenceGlyph, KIND_GLYPH_KINDS, KindGlyph, PriorExposureGlyph, StaleGlyph } from "./glyphs";
import { BasisLabel, StateLabel } from "./labels";
import { sampleEvidence, sampleRangeConfirmed, sampleRangeFirstVisit, sampleRangeManual } from "@/lib/fixtures/r2-sample";
import { GRAPH_NODE_KIND_LABEL, TIE_SENTENCE } from "@/lib/labels";

const meta: Meta = { title: "Shared components" };
export default meta;
type Story = StoryObj;

const TONES: Tone[] = ["neutral", "accent", "success", "caution", "danger", "unassessed"];

/** The same content on the three grounds of each theme: work area, chrome, raised. */
function Themes({ children, ground = "surface" }: { children: ReactNode; ground?: "bg" | "surface" | "raised" }) {
  const tone = ground === "bg" ? "bg-bg" : ground === "raised" ? "bg-raised" : "bg-surface";
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {(["light", "dark"] as const).map((theme) => (
        <section key={theme} data-theme={theme} aria-label={`${theme} theme`} className="rounded-region bg-bg p-4 text-ink" style={{ colorScheme: theme }}>
          <p className="mb-3 text-meta text-muted">{theme === "light" ? "Light" : "Dark"}</p>
          <div className={`rounded-region p-4 ${tone}`}>{children}</div>
        </section>
      ))}
    </div>
  );
}
const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex flex-wrap items-center gap-3 py-2">
    <span className="w-40 shrink-0 text-meta text-muted">{label}</span>
    {children}
  </div>
);

export const Buttons: Story = {
  name: "Button: neutral, primary, quiet, sizes, disabled, busy",
  render: () => (
    <Themes>
      <Row label="Neutral (pad, no stroke)"><Button>Start from page 1</Button><Button><Bookmark aria-hidden />With an icon</Button></Row>
      <Row label="Primary (one per view)"><Button variant="primary">Resume lecture</Button></Row>
      <Row label="Quiet (bare)"><Button variant="quiet">Cancel</Button></Row>
      <Row label="Sizes 44, 40, 36, 28"><Button size="lg">Large</Button><Button>Default</Button><Button size="sm">Small</Button><Button size="xs">Accept</Button><Button size="xs">Reject</Button></Row>
      <Row label="Disabled (no pad, regular)"><Button disabled>Send</Button><Button variant="primary" disabled>Send</Button><span className="text-ui text-muted">Sending is off because this device is not paired.</span></Row>
      <Row label="Busy (names the action)"><Button variant="primary" busy>Sending</Button><Button busy>Saving the note</Button></Row>
      <Row label="As a link"><a className="ll-btn" href="#question-bank">Question bank</a><a className="ll-link" href="#bank">Open in the question bank</a></Row>
    </Themes>
  ),
};

function PressedDemo() {
  const [on, setOn] = useState(true);
  return <IconButton label={on ? "Repeat this range: on" : "Repeat this range"} aria-pressed={on} onClick={() => setOn(!on)}><Repeat aria-hidden /></IconButton>;
}

export const IconButtons: Story = {
  name: "Icon button and toolbar button",
  render: () => (
    <Themes>
      <Row label="Icon, 36"><IconButton label="Previous page"><ChevronLeft aria-hidden /></IconButton><IconButton label="Next page"><ChevronRight aria-hidden /></IconButton><IconButton label="Search"><Search aria-hidden /></IconButton></Row>
      <Row label="Icon, 28 and 44"><IconButton size="sm" label="Volume"><Volume2 aria-hidden /></IconButton><IconButton size="lg" label="Full screen"><Maximize aria-hidden /></IconButton></Row>
      <Row label="On (aria-pressed)"><PressedDemo /></Row>
      <Row label="Disabled (glyph in border)"><IconButton label="Previous page" disabled><ChevronLeft aria-hidden /></IconButton></Row>
      <Row label="Toolbar text button"><ToolbarButton>Find</ToolbarButton><ToolbarButton icon={<SkipForward aria-hidden />}>Next content</ToolbarButton><ToolbarButton icon={<Pencil aria-hidden />}>Note</ToolbarButton><ToolbarButton chevron>Fit page</ToolbarButton></Row>
      <Row label="Toolbar, on and small"><ToolbarButton aria-pressed>Whole recording</ToolbarButton><ToolbarButton size="sm">Whole recording</ToolbarButton><ToolbarButton size="sm" chevron>All 2 ranges</ToolbarButton></Row>
      <Row label="Toolbar, disabled"><ToolbarButton disabled>Next content</ToolbarButton></Row>
    </Themes>
  ),
};

function SegmentedDemo() {
  const [mode, setMode] = useState<"quick" | "understand" | "explain">("quick");
  return <Segmented label="Kind of help" value={mode} onChange={setMode} options={[{ value: "quick", label: "Quick answer" }, { value: "understand", label: "Understand" }, { value: "explain", label: "Explain back" }]} />;
}
function ScopeDemo() {
  const [scope, setScope] = useState<"course" | "lecture" | "slide">("slide");
  return <Segmented label="Scope" value={scope} onChange={setScope} options={[{ value: "course", label: "Course" }, { value: "lecture", label: "Lecture" }, { value: "slide", label: "This slide" }]} />;
}

export const SegmentedAndTabs: Story = {
  name: "Segmented control and text tabs (keyboard: arrows)",
  render: () => (
    <Themes>
      <Row label="Kind of help"><SegmentedDemo /></Row>
      <Row label="Scope"><ScopeDemo /></Row>
      <Tabs defaultValue="questions" className="mt-4">
        <TabList label="Context panel"><Tab value="tutor">Tutor</Tab><Tab value="questions" count={2}>Questions</Tab><Tab value="concepts">Concepts</Tab><Tab value="transcript">Transcript</Tab><Tab value="sources">Sources</Tab></TabList>
        <TabPanel value="tutor" className="pt-3 text-ui">Tutor panel content.</TabPanel>
        <TabPanel value="questions" className="pt-3 text-ui">The count after the label is a muted figure, not a badge.</TabPanel>
        <TabPanel value="concepts" className="pt-3 text-ui">Concepts of this slide.</TabPanel>
        <TabPanel value="transcript" className="pt-3 text-ui">No transcript is linked to this lecture.</TabPanel>
        <TabPanel value="sources" className="pt-3 text-ui">Nothing is linked to this slide yet.</TabPanel>
      </Tabs>
    </Themes>
  ),
};

function SectionsDemo() {
  const [alone, setAlone] = useState(false);
  return (
    <div className="max-w-xl">
      <Sections defaultValue={["slide"]}>
        <Section value="slide" title="On this slide" count={2}><p className="text-ui text-muted">Two question entries.</p></Section>
        <Section value="related" title="Related concepts" count={5}><p className="text-ui text-muted">These share a concept with this slide. None of them is tied to a page here.</p></Section>
        <Section value="all" title="Whole lecture" count={20}><p className="text-ui text-muted">20 questions: 12 anchored by the course, 6 with a suggested link, 2 without a link.</p></Section>
      </Sections>
      <div className="mt-4">
        <SectionToggle aria-expanded={alone} onClick={() => setAlone(!alone)} count={3}>A heading on its own</SectionToggle>
        {alone && <p className="text-ui text-muted">Shown while the heading is open.</p>}
      </div>
    </div>
  );
}

export const SectionHeadings: Story = { name: "Section heading that opens", render: () => <Themes><SectionsDemo /></Themes> };

export const StateLabels: Story = {
  name: "State label: the five evidence states (rings)",
  render: () => (
    <Themes>
      <div className="flex flex-col gap-2">
        {EVIDENCE_GLYPH_STATES.map((state) => <div key={state}><StateLabel evidence={sampleEvidence[state]} /></div>)}
        <div><StateLabel evidence={{ ...sampleEvidence.not_separately_observed, attempts: 1 }} /></div>
        <div><StateLabel evidence={{ ...sampleEvidence.unknown, attempts: 3 }} /></div>
        <div><StateLabel state="independent" /></div>
        <div><StateLabel state="unknown" quiet /></div>
        <div><StateLabel state="observed_in_group" /> <span className="text-meta text-muted">(a value this build has no words for)</span></div>
      </div>
      <div className="mt-4 rounded-row bg-tint p-2"><StateLabel evidence={sampleEvidence.independent} /> <span className="text-meta text-muted">(inside a selected row: the tick lets the tint through)</span></div>
    </Themes>
  ),
};

export const BasisLabels: Story = {
  name: "Basis label: what a link or a range rests on (squares, a pencil, a link)",
  render: () => (
    <Themes>
      <div className="flex max-w-xl flex-col gap-3">
        <BasisLabel tie={{ tie: "exact" }} sentence={TIE_SENTENCE.exact} />
        <BasisLabel tie={{ tie: "stated" }} sentence={TIE_SENTENCE.stated} />
        <BasisLabel tie={{ tie: "stated", granularity: "section" }} />
        <BasisLabel tie={{ tie: "agent_inferred", state: "agent_inferred", verdict: null, learner_decision: null }} sentence="Supports 2 of 4 criteria: criterion 1 (Example concept one) and criterion 3 (Example concept two)." />
        <BasisLabel tie={{ tie: "agent_inferred", state: "agent_reviewed", verdict: "upheld", learner_decision: null }} strong />
        <BasisLabel tie={{ tie: "agent_inferred", state: "agent_reviewed", verdict: "upheld", learner_decision: "confirmed" }} strong />
        <BasisLabel tie={{ tie: "concept_related" }} sentence="Through 'Example concept one'. Not a claim about this slide." />
        <BasisLabel tie={{ tie: "some_new_kind" }} />
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <BasisLabel range={sampleRangeFirstVisit} />
        <BasisLabel range={{ ...sampleRangeFirstVisit, review_state: "agent_reviewed" }} />
        <BasisLabel range={sampleRangeConfirmed} />
        <BasisLabel range={sampleRangeManual} />
      </div>
    </Themes>
  ),
};

export const GlyphFamilies: Story = {
  name: "Glyph families: rings, squares, filled shapes, the triangle",
  render: () => (
    <Themes>
      <Row label="Evidence (rings only)">{EVIDENCE_GLYPH_STATES.map((state) => <EvidenceGlyph key={state} state={state} size={20} />)}</Row>
      <Row label="Basis (squares, pencil, link)">{BASIS_GLYPH_KINDS.map((basis) => <BasisGlyph key={basis} basis={basis} size={20} />)}</Row>
      <Row label="Kinds (filled, 12 px)">{KIND_GLYPH_KINDS.map((kind) => <span key={kind} className="inline-flex items-center gap-2 text-ui"><KindGlyph kind={kind} />{kind === "source_page" ? "Source page" : GRAPH_NODE_KIND_LABEL[kind]}</span>)}</Row>
      <Row label="Kinds, selected"><span aria-current="true" className="inline-flex items-center gap-2 rounded-row bg-tint px-2 py-1 text-ui font-semibold text-accent-text"><KindGlyph kind="concept" />Example concept one</span><KindGlyph kind="skill" selected /></Row>
      <Row label="Error, prior exposure, stale"><ErrorGlyph size={20} /><PriorExposureGlyph size={20} /><StaleGlyph size={20} /></Row>
    </Themes>
  ),
};

export const LoadingEmptyErrorStale: Story = {
  name: "Skeleton, empty, error and the stale notice",
  render: () => (
    <Themes>
      <div className="grid gap-6 md:grid-cols-2">
        <div><p className="mb-1 text-meta text-muted">Loading</p><LoadingState label="Reading the source inventory…" /></div>
        <div><p className="mb-1 text-meta text-muted">Skeleton blocks</p><div className="flex items-center gap-3"><Skeleton width={96} height={72} /><div className="flex flex-1 flex-col gap-2"><Skeleton height={14} width="40%" /><Skeleton height={16} width="80%" /><Skeleton height={14} width="60%" /></div></div></div>
        <div><p className="mb-1 text-meta text-muted">Empty</p><EmptyState title="No captured conversation yet" action={<Button size="sm">Open a lecture</Button>}>Questions and explanations you send from this app are kept here exactly as submitted.</EmptyState></div>
        <div><p className="mb-1 text-meta text-muted">Error</p><ErrorState title="The transcript could not be loaded." error={new Error("The service on this PC did not answer.")} stillWorks="What is already open stays readable." retry={() => undefined} /></div>
      </div>
      <div className="mt-4"><StaleNotice onRefresh={() => undefined}>This list was made before the question catalog changed.</StaleNotice></div>
    </Themes>
  ),
};

export const StatusAndCallouts: Story = {
  name: "Job status and callouts (a glyph and words, never a pill)",
  render: () => (
    <Themes>
      <div className="flex flex-wrap gap-x-6 gap-y-2">{TONES.map((tone) => <StatusChip key={tone} tone={tone}>{tone}</StatusChip>)}</div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">{Object.entries(OUTCOME_LABEL).map(([key, value]) => <StatusChip key={key} tone={value.tone}>{value.label}</StatusChip>)}</div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        <StatusChip tone="success">Your input: captured</StatusChip>
        <StatusChip tone="neutral">Sent · waiting for the Brain to receive complete files</StatusChip>
        <StatusChip tone="caution">Completion unknown</StatusChip>
        <StatusChip tone="danger">Failed</StatusChip>
      </div>
      <div className="mt-4 flex max-w-3xl flex-col gap-3">
        <Callout tone="danger" role="alert" title="Local save failed">This browser cannot store drafts right now. What you type is kept only while this page stays open.</Callout>
        <Callout tone="caution" title="Setup is not finished" actions={<Button size="sm">Setup details</Button>}>Body text explains what happened and what stays unchanged.</Callout>
        <Callout tone="unassessed" role="note" title="Not assessed in this exchange">Receiving an answer does not show what you can do on your own. Your earlier evidence is unchanged.</Callout>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-ui">
        <span className="ll-token">Page 23, build 2 of 3<IconButton size="sm" label="Remove page 23">×</IconButton></span>
        <span className="ll-token">transcript lines 120–164<IconButton size="sm" label="Remove transcript lines 120 to 164">×</IconButton></span>
        <span className="text-meta text-muted">(the one rounded token: something attached that can be removed)</span>
      </div>
    </Themes>
  ),
};

function DialogDemo({ side }: { side: "center" | "right" }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open {side === "right" ? "drawer" : "dialog"}</Button>
      <Dialog open={open} onOpenChange={setOpen} side={side} title="Save a note on this slide" description="A note is your own work linked to this exact slide version."
        footer={<><Button variant="quiet" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary">Save note</Button></>}>
        <Field label="Note" htmlFor="story-note" hint="Focus is trapped while this is open and returns to the opener on close."><textarea id="story-note" className="ll-input min-h-[6rem]" /></Field>
      </Dialog>
    </>
  );
}

export const DialogCentered: Story = { name: "Dialog", render: () => <DialogDemo side="center" /> };
export const DialogDrawer: Story = { name: "Drawer", render: () => <DialogDemo side="right" /> };

export const FieldsAndHeader: Story = {
  name: "Fields, page header, links and citations",
  render: () => (
    <Themes ground="bg">
      <div className="flex max-w-xl flex-col gap-4">
        <PageHeader title="Progress" subtitle="What your recorded responses showed, not a score." actions={<Button>Study history</Button>} />
        <Field label="Start (seconds)" htmlFor="story-start"><input id="story-start" className="ll-input" defaultValue="20" aria-invalid /></Field>
        <p role="alert" className="ll-err"><ErrorGlyph /><span>The end must be after the start.</span></p>
        <Field label="Search this transcript" htmlFor="story-search" hint="Matches are case-insensitive."><input id="story-search" className="ll-input" type="search" placeholder="Term…" /></Field>
        <Field label="Disabled field" htmlFor="story-off"><input id="story-off" className="ll-input" disabled defaultValue="Not available on this device" /></Field>
        <p className="text-ui">
          <span className="text-muted">Sources </span>
          <a className="ll-link ll-num" href="#p22">p. 22</a> <span className="ll-qualifier">build 1 of 3</span>{" "}
          <strong className="ll-num">p. 23</strong> <span className="ll-qualifier">on screen</span>{" "}
          <a className="ll-link ll-num" href="#p26">pp. 26–27</a>{" "}
          <a className="ll-link ll-num" href="#lines">transcript lines 120–164</a>
        </p>
      </div>
    </Themes>
  ),
};

export const LegacyNames: Story = {
  name: "Legacy class names, restyled (pages not yet redrawn)",
  render: () => (
    <Themes ground="bg">
      <div className="flex max-w-2xl flex-col gap-3">
        <div className="ll-card p-4">
          <p className="ll-label">A sentence-case label</p>
          <p className="text-ui text-muted">A card is a tone and spacing, with no stroke.</p>
          <div className="ll-card mt-3 p-3 text-ui">A card inside a card steps to the raised tone.</div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" className="ll-btn ll-btn-primary">Primary</button>
            <button type="button" className="ll-btn">Default</button>
            <button type="button" className="ll-btn ll-btn-sm">Small</button>
            <button type="button" className="ll-btn" disabled>Disabled</button>
            <span className="ll-chip"><span>A chip is words, not a pill</span></span>
            <a className="ll-chip" href="#x">A chip that is a link</a>
            <span className="ll-chip">Pinned page 4<button type="button" aria-label="Remove pinned page 4" className="ml-1">×</button></span>
          </div>
          <input className="ll-input mt-3" placeholder="A field" aria-label="A field" />
        </div>
      </div>
    </Themes>
  ),
};

export const SafeMarkdown: Story = {
  name: "Tutor text: restricted Markdown and maths; raw HTML and script links are inert",
  render: () => (
    <Themes>
      <Markdown>{[
        "**Short version.** The first placeholder quantity sets the second, and the *third* follows from both.",
        "",
        "- Placeholder point one leads to point two",
        "- A ratio worth measuring: $r = \\dfrac{E_{\\text{before}}}{E_{\\text{after}}}$",
        "",
        "| State | Result |",
        "|---|---|",
        "| first | low |",
        "| second | high |",
        "",
        '<img src=x onerror="alert(1)"> <script>alert(2)</script> [unsafe link](javascript:alert(3)) [safe link](https://example.org)',
      ].join("\n")}</Markdown>
    </Themes>
  ),
};
