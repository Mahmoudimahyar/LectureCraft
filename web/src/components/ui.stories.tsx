// Shared component states for local visual review in Light and Dark (LL005). These are the
// primitives every screen is built from; each story shows the states a learner can actually meet,
// including errors, empty lists and "not assessed".
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Callout, Dialog, EmptyState, ErrorState, Field, IconButton, LoadingState, Markdown, OUTCOME_LABEL, PageHeader, Segmented, StatusChip, Tab, TabList, TabPanel, Tabs, type Tone } from "./ui";

const meta: Meta = { title: "Shared components" };
export default meta;
type Story = StoryObj;

const TONES: Tone[] = ["neutral", "accent", "success", "caution", "danger", "unassessed"];

export const Buttons: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary">Primary action</Button>
        <Button>Default</Button>
        <Button variant="quiet">Quiet</Button>
        <Button disabled>Disabled</Button>
        <Button variant="primary" busy>Sending</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary">Small primary</Button>
        <Button size="sm">Small</Button>
        <IconButton label="Close">×</IconButton>
        <IconButton label="Close (small)" size="sm">×</IconButton>
      </div>
    </div>
  ),
};

export const StatusChips: Story = {
  name: "Status chips (text + icon, never colour alone)",
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">{TONES.map((tone) => <StatusChip key={tone} tone={tone}>{tone}</StatusChip>)}</div>
      <div className="flex flex-wrap gap-2">{Object.entries(OUTCOME_LABEL).map(([key, value]) => <StatusChip key={key} tone={value.tone}>{value.label}</StatusChip>)}</div>
      <div className="flex flex-wrap gap-2">
        <StatusChip tone="success">Your input: captured</StatusChip>
        <StatusChip tone="neutral">Sent · waiting for the Brain to receive complete files</StatusChip>
        <StatusChip tone="caution">Completion unknown</StatusChip>
        <StatusChip tone="caution">Awaiting course save</StatusChip>
        <StatusChip tone="unassessed">Not assessed</StatusChip>
      </div>
    </div>
  ),
};

export const Callouts: Story = {
  render: () => (
    <div className="flex max-w-3xl flex-col gap-3">
      {TONES.map((tone) => (
        <Callout key={tone} tone={tone} title={`${tone[0]!.toUpperCase()}${tone.slice(1)} callout`} actions={tone === "caution" ? <Button size="sm">Setup details</Button> : undefined}>
          Body text explains what happened and what stays unchanged.
        </Callout>
      ))}
      <Callout tone="danger" role="alert" title="Local save failed">This browser cannot store drafts right now. What you type is kept only while this page stays open.</Callout>
      <Callout tone="unassessed" role="note" title="Not assessed this exchange">Receiving an answer does not establish understanding. Your earlier evidence is unchanged.</Callout>
    </div>
  ),
};

export const LoadingEmptyAndError: Story = {
  name: "Loading, empty list and error",
  render: () => (
    <div className="grid max-w-4xl gap-6 md:grid-cols-3">
      <LoadingState label="Reading the source inventory…" />
      <EmptyState title="No captured conversation yet" action={<Button size="sm">Open a lecture</Button>}>Questions and explanations you send from this app are kept here exactly as submitted.</EmptyState>
      <ErrorState error={new Error("The Brain on this PC is not reachable (connection refused).")} retry={() => undefined} />
    </div>
  ),
};

function SegmentedDemo() {
  const [mode, setMode] = useState<"quick" | "understand" | "explain">("quick");
  return <Segmented label="Interaction" value={mode} onChange={setMode} options={[{ value: "quick", label: "Quick answer" }, { value: "understand", label: "Understand" }, { value: "explain", label: "Explain back" }]} />;
}

export const SegmentedAndTabs: Story = {
  name: "Segmented control and tabs (keyboard: arrows)",
  render: () => (
    <div className="flex max-w-xl flex-col gap-6">
      <SegmentedDemo />
      <Tabs defaultValue="tutor">
        <TabList label="Context panel"><Tab value="tutor">Tutor</Tab><Tab value="transcript">Transcript</Tab><Tab value="sources">Sources</Tab></TabList>
        <TabPanel value="tutor" className="pt-3">Tutor panel content.</TabPanel>
        <TabPanel value="transcript" className="pt-3">No transcript is linked to this lecture.</TabPanel>
        <TabPanel value="sources" className="pt-3">Nothing is linked to this slide yet.</TabPanel>
      </Tabs>
    </div>
  ),
};

function DialogDemo({ side }: { side: "center" | "right" }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open {side === "right" ? "drawer" : "dialog"}</Button>
      <Dialog open={open} onOpenChange={setOpen} side={side} title="Save a note on this slide" description="A note is your own work linked to this exact slide version."
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary">Save note</Button></>}>
        <Field label="Note" htmlFor="story-note" hint="Focus is trapped while this is open and returns to the opener on close."><textarea id="story-note" className="ll-input min-h-[6rem]" /></Field>
      </Dialog>
    </>
  );
}

export const DialogCentered: Story = { name: "Dialog", render: () => <DialogDemo side="center" /> };
export const DialogDrawer: Story = { name: "Drawer", render: () => <DialogDemo side="right" /> };

export const FieldsAndHeader: Story = {
  name: "Fields and page header",
  render: () => (
    <div className="flex max-w-xl flex-col gap-4">
      <PageHeader title="Progress" subtitle="What your recorded responses showed — not a score." actions={<Button>Study history</Button>} />
      <Field label="Start (seconds)" htmlFor="story-start"><input id="story-start" className="ll-input" defaultValue="20" aria-invalid /></Field>
      <p role="alert" className="text-sm font-medium text-danger">The end must be after the start.</p>
      <Field label="Search this transcript" htmlFor="story-search" hint="Matches are case-insensitive."><input id="story-search" className="ll-input" type="search" placeholder="Term…" /></Field>
    </div>
  ),
};

export const SafeMarkdown: Story = {
  name: "Tutor text: restricted Markdown and maths; raw HTML and script links are inert",
  render: () => (
    <div className="max-w-2xl">
      <Markdown>{[
        "**Short version.** The repressor binds the *operator* and blocks transcription.",
        "",
        "- Inducer bound → repressor releases the operator",
        "- Leaky expression should be measured: $r = \\dfrac{E_{\\text{uninduced}}}{E_{\\text{induced}}}$",
        "",
        "| State | Transcription |",
        "|---|---|",
        "| repressed | low |",
        "| induced | high |",
        "",
        '<img src=x onerror="alert(1)"> <script>alert(2)</script> [unsafe link](javascript:alert(3)) [safe link](https://example.org)',
      ].join("\n")}</Markdown>
    </div>
  ),
};
