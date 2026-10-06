// Fix round of the shell area: a segmented choice that arrow keys choose in, and the one build line of the rail.
// Rendered in jsdom. The Brain is a LABELED DOUBLE here (an identity placed in the query cache; no server is contacted).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ToggleGroup } from "radix-ui";
import { BuildIdentity, buildLine } from "@/components/BuildIdentity";
import { Segmented, chooseInSegmented } from "@/components/ui";
import { WEB_BUILD, type ServedIdentity } from "@/lib/build";
import { queryKeys } from "@/lib/queries";

const HELP = [{ value: "quick", label: "Quick answer" }, { value: "understand", label: "Understand" }, { value: "explain", label: "Explain back" }];

describe("Segmented: arrow keys choose, as in a group of radios", () => {
  function Harness({ onChange, onOuterKey }: { onChange: (value: string) => void; onOuterKey: (key: string) => void }) {
    const [value, setValue] = useState("quick");
    return (
      // The slide of a lecture pages on the arrow keys: a key the control used must not reach what is around it.
      <div onKeyDown={(event) => onOuterKey(event.key)}>
        <Segmented label="Kind of help" value={value} onChange={(next) => { onChange(next); setValue(next); }} options={HELP} />
      </div>
    );
  }
  const setup = () => {
    const change = vi.fn();
    const outer = vi.fn();
    render(<Harness onChange={change} onOuterKey={outer} />);
    const group = screen.getByRole("radiogroup", { name: "Kind of help" });
    const radio = (name: string) => within(group).getByRole("radio", { name });
    return { change, outer, radio };
  };

  it("Right and Down move to the next segment and choose it; a key press of no length is enough", () => {
    const { change, outer, radio } = setup();
    radio("Quick answer").focus();
    fireEvent.keyDown(radio("Quick answer"), { key: "ArrowRight" });
    expect(change).toHaveBeenLastCalledWith("understand");
    expect(radio("Understand")).toHaveFocus();
    expect(radio("Understand")).toBeChecked();
    fireEvent.keyDown(radio("Understand"), { key: "ArrowDown" });
    expect(change).toHaveBeenLastCalledWith("explain");
    expect(radio("Explain back")).toHaveFocus();
    expect(change).toHaveBeenCalledTimes(2);
    expect(outer).not.toHaveBeenCalled();
  });

  it("Left and Up go back, and the ends wrap around", () => {
    const { change, radio } = setup();
    radio("Quick answer").focus();
    fireEvent.keyDown(radio("Quick answer"), { key: "ArrowLeft" });
    expect(change).toHaveBeenLastCalledWith("explain");
    expect(radio("Explain back")).toHaveFocus();
    fireEvent.keyDown(radio("Explain back"), { key: "ArrowUp" });
    expect(change).toHaveBeenLastCalledWith("understand");
    fireEvent.keyDown(radio("Understand"), { key: "End" });
    expect(change).toHaveBeenLastCalledWith("explain");
    fireEvent.keyDown(radio("Explain back"), { key: "ArrowRight" });
    expect(change).toHaveBeenLastCalledWith("quick");
    fireEvent.keyDown(radio("Quick answer"), { key: "End" });
    fireEvent.keyDown(radio("Explain back"), { key: "Home" });
    expect(change).toHaveBeenLastCalledWith("quick");
    expect(radio("Quick answer")).toHaveFocus();
  });

  it("only the chosen segment is in the tab order, and other keys are left alone", () => {
    const { change, outer, radio } = setup();
    radio("Quick answer").focus();
    fireEvent.keyDown(radio("Quick answer"), { key: "ArrowRight" });
    expect(radio("Understand")).toHaveAttribute("tabindex", "0");
    expect(radio("Quick answer")).toHaveAttribute("tabindex", "-1");
    change.mockClear();
    fireEvent.keyDown(radio("Understand"), { key: "a" });
    fireEvent.keyDown(radio("Understand"), { key: "ArrowRight", ctrlKey: true });
    expect(change).not.toHaveBeenCalled();
    expect(outer).toHaveBeenCalledTimes(2);
    // Home on the first and End on the last have nowhere to go and choose nothing again.
    fireEvent.keyDown(radio("Understand"), { key: "Home" });
    change.mockClear();
    fireEvent.keyDown(radio("Quick answer"), { key: "Home" });
    expect(change).not.toHaveBeenCalled();
  });

  it("can hold a segment that waits disabled, with the reason in its title, and the keys step over it", () => {
    const change = vi.fn();
    render(<Segmented label="Scope" value="course" onChange={change} options={[{ value: "course", label: "Course" }, { value: "lecture", label: "Lecture", disabled: true, title: "Choose a lecture first" }, { value: "slide", label: "This slide" }]} />);
    const radio = (name: string) => screen.getByRole("radio", { name });
    expect(radio("Lecture")).toBeDisabled();
    expect(radio("Lecture")).toHaveAttribute("title", "Choose a lecture first");
    radio("Course").focus();
    fireEvent.keyDown(radio("Course"), { key: "ArrowRight" });
    expect(change).toHaveBeenLastCalledWith("slide");
    expect(radio("This slide")).toHaveFocus();
  });
});

describe("chooseInSegmented: the shell's rule for every segmented control, also one a page built itself", () => {
  // The concept explorer draws its scope switch with the classes of the segmented control but not with the component,
  // so that a segment can wait disabled. The shell applies the same keys to it from above.
  function Local({ onChange, onOuterKey }: { onChange: (value: string) => void; onOuterKey: (key: string) => void }) {
    const [scope, setScope] = useState("lecture");
    return (
      <div onKeyDown={(event) => onOuterKey(event.key)}>
        <div onKeyDownCapture={chooseInSegmented}>
          <ToggleGroup.Root type="single" value={scope} onValueChange={(next) => { if (next) { onChange(next); setScope(next); } }} aria-label="Scope of the concept map" className="ll-seg">
            <ToggleGroup.Item value="course" className="ll-seg-item">Course</ToggleGroup.Item>
            <ToggleGroup.Item value="lecture" className="ll-seg-item">Lecture</ToggleGroup.Item>
            <ToggleGroup.Item value="slide" disabled className="ll-seg-item">This slide</ToggleGroup.Item>
          </ToggleGroup.Root>
          <div role="radiogroup" aria-label="Ranges of this page">
            <button type="button" role="radio" aria-checked="true">First range</button>
            <button type="button" role="radio" aria-checked="false" onClick={() => onChange("second range")}>Second range</button>
          </div>
        </div>
      </div>
    );
  }

  it("chooses the neighbour on an arrow key and steps over a segment that is disabled", () => {
    const change = vi.fn();
    const outer = vi.fn();
    render(<Local onChange={change} onOuterKey={outer} />);
    const group = screen.getByRole("radiogroup", { name: "Scope of the concept map" });
    const radio = (name: string) => within(group).getByRole("radio", { name });
    radio("Lecture").focus();
    fireEvent.keyDown(radio("Lecture"), { key: "ArrowLeft" });
    expect(change).toHaveBeenLastCalledWith("course");
    expect(radio("Course")).toHaveFocus();
    expect(radio("Course")).toBeChecked();
    // Right of Lecture is the disabled segment: the choice wraps to Course and never lands on it.
    fireEvent.keyDown(radio("Course"), { key: "ArrowRight" });
    expect(change).toHaveBeenLastCalledWith("lecture");
    fireEvent.keyDown(radio("Lecture"), { key: "ArrowRight" });
    expect(change).toHaveBeenLastCalledWith("course");
    expect(radio("This slide")).not.toBeChecked();
    expect(change).toHaveBeenCalledTimes(3);
    expect(outer).not.toHaveBeenCalled();
  });

  it("leaves a group of radios that is not a segmented control to its own keys", () => {
    const change = vi.fn();
    const outer = vi.fn();
    render(<Local onChange={change} onOuterKey={outer} />);
    const first = within(screen.getByRole("radiogroup", { name: "Ranges of this page" })).getByRole("radio", { name: "First range" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(change).not.toHaveBeenCalled();
    expect(first).toHaveFocus();
    expect(outer).toHaveBeenCalledWith("ArrowDown");
  });
});

describe("the build line of the shell", () => {
  const served: ServedIdentity = {
    app_version: "0.0.0-double", commit: "a1".repeat(20), commit_short: "a1a1a1a", branch: "main", dirty: false, pid: 4242, process_started_at: "2026-10-05T23:00:00Z",
    process_started_basis: "os_process_creation", profile: "fixture", port: 8765, preparation_tool_version: "prep-5", source_map_version: "source-map/1",
    assets: { script: [], style: [] }, web_build: { commit: "a1".repeat(20), commit_short: "a1a1a1a", dirty: false, built_at: "2026-10-05T22:59:00Z" },
    static: { served: true, directory: "web/dist", index_modified_at: "2026-10-05T22:59:00Z", index_sha256: "0".repeat(64) },
    courses: {},
  };
  const show = (layout?: "rail" | "line") => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(queryKeys.servedIdentity(), served);
    render(<QueryClientProvider client={client}><BuildIdentity variant="shell" layout={layout} /></QueryClientProvider>);
    return screen.getByTestId("build-line");
  };
  const commit = buildLine(served).commit;

  it("is ONE short line in the rail: the build of this page, nothing stacked under it", () => {
    const line = show();
    expect(line.textContent).toBe(commit);
    expect(line.children).toHaveLength(0);
    expect(line.textContent).not.toMatch(/fixture|8765/);
    // The other facts are still said to a reader that asks: the title and the name carry the whole sentence.
    expect(line).toHaveAttribute("title", buildLine(served).sentence);
    expect(line).toHaveAccessibleName(buildLine(served).sentence);
    expect(buildLine(served).sentence).toMatch(/fixture profile on port 8765/);
  });

  it("is one line with profile and port in the menu of a narrow window", () => {
    expect(show("line").textContent).toBe(`${commit} · fixture · 8765`);
  });

  it("says the build is unknown instead of guessing", () => {
    expect(buildLine(null).commit).toBe(WEB_BUILD.commit === "unknown" ? "build unknown" : `${WEB_BUILD.commit}${WEB_BUILD.dirty ? "+" : ""}`);
    expect(buildLine(null).sentence).toMatch(/the Brain states no identity/);
  });
});
