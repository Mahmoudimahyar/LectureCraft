// The lecture outline as drawn (web/src/features/lecture/LectureOutline.tsx; design specification 5.2) on the synthetic
// sample of every R2 state, in jsdom and without a PDF (pictures are flat blocks): the outline is ONE Tab stop whose
// arrow keys move inside it and never turn the page, and a row's note counts what the range list of its page shows.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { LectureOutline } from "@/features/lecture/LectureOutline";
import { sampleLectureView } from "@/lib/fixtures/r2-sample";
import { NBSP } from "@/lib/labels";
import { rangesForPage } from "@/lib/r2";

const text = (element: Element | null): string => (element?.textContent ?? "").split(NBSP).join(" ").replace(/\s+/g, " ").trim();

function Outline({ start, onSelect }: { start: number; onSelect?: (page: number) => void }) {
  const [page, setPage] = useState(start);
  return <LectureOutline lecture={sampleLectureView} page={page} pageCount={12} pdfUrl={null} layout="list" onSelect={(next) => { onSelect?.(next); setPage(next); }} />;
}
const list = () => screen.getByRole("navigation", { name: "Pages" });
const stops = () => [...list().querySelectorAll<HTMLElement>("[data-stop]")];
const tabStops = () => stops().filter((stop) => stop.tabIndex === 0);
const row = (name: RegExp) => within(list()).getByRole("button", { name });
/** A key pressed on the focused element; true when the outline kept it (the page shortcut, which honours preventDefault, then does not run). */
const press = (key: string): boolean => !fireEvent.keyDown(document.activeElement!, { key });

describe("the outline is one Tab stop", () => {
  it("is entered at the row on screen, and no other row or page of a group is a Tab stop", () => {
    render(<Outline start={4} />);
    expect(stops().length).toBe(9 + 3); // nine rows and the three pages of the open group
    expect(tabStops().map((stop) => (stop.getAttribute("aria-label") ?? "").split(NBSP).join(" "))).toEqual(["Pages 3–5: A sample mechanism, step by step, 3 builds, pp. 3–5"]);
  });
  it("keeps a Tab stop when the row on screen is filtered out by Find", () => {
    render(<Outline start={4} />);
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "12" } });
    expect(tabStops().map((stop) => stop.getAttribute("aria-label"))).toEqual(["Page 12: Sample housekeeping, Administrative"]);
  });
});

describe("the arrow keys move inside the outline and never turn the page", () => {
  it("Down and Up move through the rows; the Tab stop follows the focus", () => {
    render(<Outline start={2} />);
    row(/^Page 2:/).focus();
    expect(press("ArrowDown")).toBe(true);
    expect(document.activeElement).toBe(row(/^Pages 3–5:/));
    expect(tabStops()).toEqual([row(/^Pages 3–5:/)]);
    expect(press("ArrowUp")).toBe(true);
    expect(press("ArrowUp")).toBe(true);
    expect(document.activeElement).toBe(row(/^Page 1:/));
    expect(press("ArrowUp")).toBe(true); // at the top: kept, nothing moves
    expect(document.activeElement).toBe(row(/^Page 1:/));
  });
  it("Home and End go to the first and the last row", () => {
    render(<Outline start={8} />);
    row(/^Page 8:/).focus();
    press("End");
    expect(document.activeElement).toBe(row(/^Page 12:/));
    press("Home");
    expect(document.activeElement).toBe(row(/^Page 1:/));
  });
  it("Left and Right are the outline's also where they have nothing to do", () => {
    const onSelect = vi.fn();
    render(<Outline start={8} onSelect={onSelect} />);
    row(/^Page 8:/).focus();
    expect(press("ArrowLeft")).toBe(true);
    expect(press("ArrowRight")).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(row(/^Page 8:/));
  });
  it("leaves Enter, Space and Tab to the browser: they press the row or leave the outline", () => {
    render(<Outline start={8} />);
    row(/^Page 8:/).focus();
    for (const key of ["Enter", " ", "Tab"]) expect(press(key)).toBe(false);
  });
  it("selects the focused row on a press, and the Tab stop is then the row on screen", () => {
    const onSelect = vi.fn();
    render(<Outline start={2} onSelect={onSelect} />);
    row(/^Page 2:/).focus();
    press("End");
    fireEvent.click(document.activeElement!);
    expect(onSelect).toHaveBeenCalledWith(12);
    expect(tabStops()).toEqual([row(/^Page 12:/)]);
  });
});

describe("a build group opens and closes from the keyboard", () => {
  it("Right on the open group goes to its first page, Left from a page goes back to the row", () => {
    render(<Outline start={4} />);
    row(/^Pages 3–5:/).focus();
    press("ArrowRight");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Page 3, 1 of 3" }));
    press("ArrowDown");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Page 4, 2 of 3" }));
    press("ArrowLeft");
    expect(document.activeElement).toBe(row(/^Pages 3–5:/));
  });
  it("Left on the open group closes it and Right opens it again; the page on screen does not change", () => {
    const onSelect = vi.fn();
    render(<Outline start={4} onSelect={onSelect} />);
    const group = row(/^Pages 3–5:/);
    group.focus();
    expect(group).toHaveAttribute("aria-expanded", "true");
    press("ArrowLeft");
    expect(group).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "Pages of this slide" })).toBeNull();
    expect(stops().length).toBe(9);
    press("ArrowRight");
    expect(group).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("group", { name: "Pages of this slide" })).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("Right on a closed group opens it by going to its first page", () => {
    const onSelect = vi.fn();
    render(<Outline start={2} onSelect={onSelect} />);
    const group = row(/^Pages 6–7:/);
    group.focus();
    expect(group).toHaveAttribute("aria-expanded", "false");
    press("ArrowRight");
    expect(onSelect).toHaveBeenCalledWith(6);
    expect(row(/^Pages 6–7:/)).toHaveAttribute("aria-expanded", "true");
  });
});

describe("a row's range note is the number of rows its page's range list shows", () => {
  it("for every page of the sample, with the page on screen", () => {
    for (const slide of sampleLectureView.slides) {
      const view = render(<Outline start={slide.page} />);
      const current = list().querySelector<HTMLElement>('button[data-row][aria-current="true"], div[aria-current="true"] > button[data-row]')!;
      const note = text(current.querySelector("[data-row-figures]"));
      const own = Number((note.match(/(\d+) ranges?(?! for| on)/) ?? [])[1] ?? 0);
      const section = Number((note.match(/(\d+) for its section/) ?? note.match(/(\d+) ranges? for its section only/) ?? [])[1] ?? 0);
      expect([slide.page, own + section]).toEqual([slide.page, rangesForPage(sampleLectureView, slide.page).ranges.length]);
      view.unmount();
    }
  });
  it("words the ranges by their scope", () => {
    render(<Outline start={2} />);
    expect(text(row(/^Page 2:/))).toContain("1 question · 2 ranges · 1 for its section");
    expect(text(row(/^Pages 3–5:/))).toContain("3 questions · 1 range · 1 for its section");
    expect(text(row(/^Pages 6–7:/))).toContain("1 range on p. 7"); // the row stands on page 6, whose own list is empty
    expect(text(row(/^Page 8:/))).toContain("No recording range");
  });
});
