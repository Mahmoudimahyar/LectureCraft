// R2-S10 and the deck part of R2-T12: the pages of a deck by role, in words. The raw page count and the count of pages
// that are teaching content are two figures that are always stated together; the other roles are counted in sentences so
// that everything on screen adds up to the page count; who set the roles is said, deck-wide and for the pages outside
// the teaching count. No percentage, and nothing calls a deck complete.
import { describe, expect, it } from "vitest";
import {
  DECK_CAUSE_SENTENCE, DECK_STATE_LABEL, INSTRUCTIONAL_PAGES_TERM, INSTRUCTIONAL_ROLES, RAW_PAGES_TERM, deckCauseSentence, deckPageFacts, deckStateLabel, rangesOnPagesLabel, rolePagesLabel,
  rolesEstablishedOf,
} from "@/lib/labels";
import { sampleLectureView } from "@/lib/fixtures/r2-sample";
import type { DeckReadbackState, SlideRole, SlideRoleValue, SourceMapDenominators, SourceMapUnavailableReason } from "@/lib/types";

const plain = (text: string): string => text.replace(/[   ]/g, " ");
const roles = (counts: Partial<Record<SlideRoleValue, number>>): Record<SlideRoleValue, number> => ({
  instructional: 0, worked_example_or_question: 0, mixed: 0, objectives_or_summary: 0, unknown: 0, structural_title_or_section: 0, administrative: 0, blank: 0, ...counts,
});
/** The showcase deck of the synthetic course: 14 pages. */
const SHOWCASE: SourceMapDenominators = {
  raw: 14, instructional: 10, uncertain: 2, excluded: 2,
  by_role: roles({ instructional: 9, worked_example_or_question: 1, objectives_or_summary: 2, structural_title_or_section: 1, administrative: 1 }),
};
const GENERATED = { generated: 14, agent_reviewed: 0, human_confirmed: 0 };
const numbersOf = (text: string): number[] => (plain(text).match(/\d+/g) ?? []).map(Number);

describe("the pages of a deck by role", () => {
  it("states the raw page count and the teaching-content count as two labelled figures", () => {
    const facts = deckPageFacts(SHOWCASE, { all: GENERATED, outside: { generated: 4, agent_reviewed: 0, human_confirmed: 0 } })!;
    expect([facts.raw, facts.instructional]).toEqual([14, 10]);
    expect([RAW_PAGES_TERM, INSTRUCTIONAL_PAGES_TERM]).toEqual(["PDF pages", "Count as teaching content"]);
    expect(INSTRUCTIONAL_ROLES).toEqual(["instructional", "worked_example_or_question", "mixed"]);
  });

  it("counts the other roles in words: uncertain is said to be not excluded, and the excluded pages are named by role", () => {
    const facts = deckPageFacts(SHOWCASE)!;
    expect(facts.others.map(plain)).toEqual([
      "2 objectives or summary pages are listed as uncertain, not excluded.",
      "2 pages are excluded: 1 title or section page, 1 administrative page.",
    ]);
    // What is on screen adds up to the page count.
    expect(facts.instructional! + facts.uncertain! + facts.excluded!).toBe(facts.raw);
    expect(numbersOf(facts.others[0]!)[0]! + numbersOf(facts.others[1]!)[0]! + facts.instructional!).toBe(14);
  });

  it("never counts a page of unknown role as excluded", () => {
    const facts = deckPageFacts({ raw: 6, instructional: 3, uncertain: 2, excluded: 1, by_role: roles({ instructional: 3, objectives_or_summary: 1, unknown: 1, blank: 1 }) })!;
    expect(facts.others.map(plain)).toEqual([
      "2 pages are listed as uncertain, not excluded: 1 objectives or summary page, 1 page of unknown role.",
      "1 blank page is excluded.",
    ]);
    const alone = deckPageFacts({ raw: 3, instructional: 2, uncertain: 1, excluded: 0, by_role: roles({ instructional: 2, unknown: 1 }) })!;
    expect(alone.others.map(plain)).toEqual(["1 page of unknown role is listed as uncertain, not excluded."]);
  });

  it("says so when no page is outside the teaching count, and never calls the deck complete", () => {
    const facts = deckPageFacts({ raw: 5, instructional: 5, uncertain: 0, excluded: 0, by_role: roles({ instructional: 4, mixed: 1 }) }, { all: { generated: 5, agent_reviewed: 0, human_confirmed: 0 } })!;
    expect(facts.others).toEqual(["No page is listed as uncertain or excluded."]);
    expect([...facts.others, ...facts.established].join(" ")).not.toMatch(/complete|done|finished|covered|%/i);
  });

  it("after two pages are re-labelled the raw figure is the same, the excluded count is higher by two and the line says who set them", () => {
    const before = deckPageFacts(SHOWCASE, { all: GENERATED, outside: { generated: 4, agent_reviewed: 0, human_confirmed: 0 } })!;
    const after = deckPageFacts(
      { raw: 14, instructional: 10, uncertain: 0, excluded: 4, by_role: roles({ instructional: 9, worked_example_or_question: 1, structural_title_or_section: 1, administrative: 2, blank: 1 }) },
      { all: { generated: 12, agent_reviewed: 0, human_confirmed: 2 }, outside: { generated: 2, agent_reviewed: 0, human_confirmed: 2 } },
    )!;
    expect(after.raw).toBe(before.raw);
    expect(after.excluded).toBe(before.excluded! + 2);
    expect(after.others.map(plain)).toEqual(["4 pages are excluded: 1 title or section page, 2 administrative pages, 1 blank page."]);
    expect(before.established.map(plain)).toEqual(["Roles: 14 generated by the detector, none set by you or by an agent."]);
    expect(after.established.map(plain)).toEqual([
      "Roles: 12 generated by the detector, 2 set by you.",
      "Of the 4 pages outside the teaching count: 2 set by you, 2 generated by the detector.",
    ]);
  });

  it("keeps an agent's corrections apart from yours, and says when no page outside the count was set by anyone", () => {
    const mixed = deckPageFacts(SHOWCASE, { all: { generated: 11, agent_reviewed: 1, human_confirmed: 2 }, outside: { generated: 3, agent_reviewed: 1, human_confirmed: 0 } })!;
    expect(mixed.established.map(plain)).toEqual([
      "Roles: 11 generated by the detector, 2 set by you, 1 set by an agent.",
      "Of the 4 pages outside the teaching count: 1 set by an agent, 3 generated by the detector.",
    ]);
    const inside = deckPageFacts(SHOWCASE, { all: { generated: 13, agent_reviewed: 0, human_confirmed: 1 }, outside: { generated: 4, agent_reviewed: 0, human_confirmed: 0 } })!;
    expect(plain(inside.established[1]!)).toBe("None of the 4 pages outside the teaching count had its role set by you or by an agent.");
  });

  it("states only the page count when no role was established, and nothing at all when the pages were not counted", () => {
    expect(deckPageFacts({ raw: 14, instructional: null, by_role: null, uncertain: null, excluded: null })).toEqual({ raw: 14, instructional: null, uncertain: null, excluded: null, others: [], established: [] });
    expect(deckPageFacts({ raw: null, instructional: null, by_role: null, uncertain: null, excluded: null })).toBeNull();
    expect(deckPageFacts(null)).toBeNull();
    expect(deckPageFacts(undefined)).toBeNull();
  });

  it("states a count without its roles when the roles sent do not add up to it, and shows a role it has no words for as recorded", () => {
    const facts = deckPageFacts({ raw: 9, instructional: 5, uncertain: 2, excluded: 2, by_role: { ...roles({ instructional: 5, objectives_or_summary: 1, blank: 1 }), appendix_page: 2 } as Record<SlideRoleValue, number> })!;
    expect(facts.others.map(plain)).toEqual(["2 pages are listed as uncertain, not excluded.", "2 pages are excluded."]);
    expect(plain(rolePagesLabel("appendix_page", 2))).toBe("2 pages of role appendix page");
    expect(plain(rolePagesLabel("blank", 1))).toBe("1 blank page");
  });

  it("counts who set the roles from the pages of the lecture view, and leaves out a page whose role nobody established", () => {
    const role = (value: SlideRoleValue, state: SlideRole["state"]): { role: SlideRole } => ({ role: { value, state, uncertain: false, forced_requirements: true, basis: [] } });
    const counted = rolesEstablishedOf([role("instructional", "generated"), role("blank", "human_confirmed"), role("administrative", "agent_reviewed"), role("objectives_or_summary", "generated"),
      role("mixed", "human_confirmed"), role("unknown", null), {}]);
    expect(counted.all).toEqual({ generated: 2, agent_reviewed: 1, human_confirmed: 2 });
    expect(counted.outside).toEqual({ generated: 1, agent_reviewed: 1, human_confirmed: 1 });
    // The sample lecture: its figures and its pages agree.
    const sample = rolesEstablishedOf(sampleLectureView.slides);
    const figures = sampleLectureView.source_map!.denominators!;
    expect(sample.all.generated + sample.all.agent_reviewed + sample.all.human_confirmed).toBe(sampleLectureView.slides.length);
    expect(sample.outside.generated + sample.outside.agent_reviewed + sample.outside.human_confirmed).toBe((figures.uncertain ?? 0) + (figures.excluded ?? 0));
  });
});

describe("the deck of a lecture in the course readback", () => {
  it("has words for every state, and names a PowerPoint file as one", () => {
    const states: DeckReadbackState[] = ["pdf", "not_a_pdf", "no_deck", "unreadable"];
    for (const state of states) expect(DECK_STATE_LABEL[state]).toBeTruthy();
    expect(deckStateLabel({ state: "pdf", filename: "deck.pdf" })).toBe("Readable PDF");
    expect(deckStateLabel({ state: "not_a_pdf", filename: "Fixture 572 Lecture 02.pptx" })).toBe("PowerPoint only: no pages");
    expect(deckStateLabel({ state: "not_a_pdf", filename: "notes.docx" })).toBe("Not a PDF: no pages");
    expect(deckStateLabel({ state: "no_deck", filename: null })).toBe("No deck named");
    expect(deckStateLabel({ state: "unreadable", filename: "empty.pdf" })).toBe("Unreadable");
    expect(deckStateLabel({ state: "password_protected" as DeckReadbackState, filename: "x.pdf" })).toBe("password protected");
  });

  it("states the cause in words for every reason there are no figures", () => {
    const causes: SourceMapUnavailableReason[] = ["no_deck", "not_a_pdf", "unreadable", "not_built"];
    for (const cause of causes) expect(DECK_CAUSE_SENTENCE[cause]).toMatch(/\.$/);
    expect(deckCauseSentence("not_built")).toBe("Its pages are not counted yet: the source map of this file has not been built.");
    expect(deckCauseSentence("unreadable")).toBe("The file is missing, empty or could not be read, so no pages are counted.");
    expect(deckCauseSentence("not_a_pdf")).toBe("Pages are counted in a PDF file only.");
    expect(deckCauseSentence("no_deck")).toBe("No slides file is chosen for this lecture, so no pages are counted.");
    expect(deckCauseSentence("held_by_another_program")).toBe("Held by another program.");
    expect(deckCauseSentence(null)).toBeNull();
  });

  it("says on how many pages a range lies only when both figures were sent", () => {
    expect(plain(rangesOnPagesLabel({ pages: 14, pages_with_range: 8 })!)).toBe("Ranges on 8 of 14 pages.");
    expect(plain(rangesOnPagesLabel({ pages: 1, pages_with_range: 0 })!)).toBe("Ranges on 0 of 1 page.");
    expect(rangesOnPagesLabel({ pages: 14, pages_with_range: null })).toBeNull();
    expect(rangesOnPagesLabel({ pages: null, pages_with_range: null })).toBeNull();
    expect(rangesOnPagesLabel(null)).toBeNull();
  });
});
