// The seams a visual review found between Study and the pages that keep their layout (Review, Progress, Library,
// Activity, Settings, Connect, session summary, question practice): one page column, plain words where an identifier
// stood in a sentence or as a heading, and identifiers kept on request. Synthetic values only.
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { formatWhen } from "@/components/ui";
import studySource from "@/features/study/StudyPages.tsx?raw";
import activitySource from "@/features/activity/ActivityPages.tsx?raw";
import connectSource from "@/features/connect/ConnectPage.tsx?raw";
import progressSource from "@/features/progress/ProgressPages.tsx?raw";
import practiceSource from "@/features/question/QuestionPractice.tsx?raw";
import reviewSource from "@/features/review/ReviewPages.tsx?raw";
import sessionSource from "@/features/session/SessionWrapUp.tsx?raw";
import settingsSource from "@/features/settings/SettingsPages.tsx?raw";
import sourcesSource from "@/features/sources/SourcesPages.tsx?raw";
import { attemptWhenLine, ruleVersionSentence, skillLabel, skillLabelIndex } from "@/features/progress/ProgressPages";
import { Details, PAGE_COLUMN, Page, keyWords } from "@/features/search/SearchOverlay";
import { retentionHeading } from "@/features/settings/SettingsPages";

describe("one page column for every browsing page", () => {
  it("is the column of the Study home, class for class, so a page title does not move when the rail item changes", () => {
    const study = /const COLUMN = "([^"]+)"/.exec(studySource)?.[1];
    expect(study, "the Study home states its column in one constant").toBeTruthy();
    expect(PAGE_COLUMN.split(/\s+/).sort()).toEqual(study!.split(/\s+/).sort());
  });

  it("is what every page of this area stands in: none still names the earlier, wider page class", () => {
    const pages = { activitySource, connectSource, progressSource, practiceSource, reviewSource, sessionSource, settingsSource, sourcesSource };
    for (const [name, source] of Object.entries(pages)) {
      expect(/\bll-page(-reading)?\b/.test(source), `${name} names the earlier page class`).toBe(false);
      expect(source.includes("<Page"), `${name} stands in the page column`).toBe(true);
    }
  });

  it("holds a browsing page directly, with the page's own classes and test id on the column", () => {
    render(<Page testId="p" className="flex flex-col">content</Page>);
    const column = screen.getByTestId("p");
    for (const name of PAGE_COLUMN.split(/\s+/)) expect(column.classList.contains(name), name).toBe(true);
    expect(column.classList.contains("flex-col")).toBe(true);
    expect(column.textContent).toBe("content");
    expect(column.children).toHaveLength(0);
  });

  it("keeps a reading page on the same left edge: the column is the same and only what it holds is capped to a measure", () => {
    render(<Page reading testId="r" className="flex flex-col"><p>prose</p></Page>);
    const column = screen.getByTestId("r");
    for (const name of PAGE_COLUMN.split(/\s+/)) expect(column.classList.contains(name), name).toBe(true);
    expect(column.children).toHaveLength(1);
    const held = column.firstElementChild!;
    expect(held.classList.contains("max-w-[56rem]")).toBe(true);
    expect(held.classList.contains("flex-col"), "the page's own classes arrange what the measure holds").toBe(true);
    expect(held.classList.contains("mx-auto"), "never centred apart from the column").toBe(false);
    expect(held.textContent).toBe("prose");
  });
});

describe("plain words where an identifier stood", () => {
  it("writes a key as words that start with a capital, for a heading that has no better name", () => {
    expect(keyWords("raw_teachback_audio")).toBe("Raw teachback audio");
    expect(keyWords("no-unreconciled-work")).toBe("No unreconciled work");
    expect(keyWords("held_for-review")).toBe("Held for review");
    expect(keyWords("")).toBe("");
  });

  it("names each kind of kept data in words; a kind this build has no name for is shown as recorded, in words", () => {
    expect(retentionHeading("raw_teachback_audio")).toBe("Recordings of your spoken explanations");
    expect(retentionHeading("text_evidence")).toBe("The text you submit");
    expect(retentionHeading("referenced_sidecars")).toBe("Full responses an attempt refers to");
    expect(retentionHeading("operational_logs")).toBe("Activity logs");
    expect(retentionHeading("reproducible_cache")).toBe("Prepared copies that can be rebuilt");
    expect(retentionHeading("original_sources")).toBe("Original course files");
    expect(retentionHeading("exported_archives")).toBe("Exported archives");
    for (const known of ["raw_teachback_audio", "text_evidence", "referenced_sidecars", "operational_logs", "reproducible_cache", "original_sources"]) {
      expect(retentionHeading(known)).not.toMatch(/_/);
      expect(retentionHeading(known)[0]).toMatch(/[A-Z]/);
    }
  });

  it("states the rule versions of the facet table as a sentence: the versions stay with the figures, the identifiers do not", () => {
    const sentence = ruleVersionSentence({ evidence_conditions: "evidence-conditions/1", facet_mapping: 1 });
    expect(sentence).toBe("Counted with version 1 of the rules for evidence conditions and version 1 of the mapping of skills to kinds of performance.");
    expect(sentence).not.toMatch(/evidence-conditions\/|\bv1\b/);
    expect(ruleVersionSentence({ evidence_conditions: "evidence-conditions/12", facet_mapping: 3 })).toContain("version 12 of the rules for evidence conditions and version 3 of the mapping");
  });

  it("shows a rule version it cannot read as recorded, and never invents a number for it", () => {
    expect(ruleVersionSentence({ evidence_conditions: "conditions-draft", facet_mapping: 2 }))
      .toBe("Counted with the rules for evidence conditions recorded as “conditions-draft” and version 2 of the mapping of skills to kinds of performance.");
  });

  it("names a skill of an attempt by the catalog's own label, and by its identifier only when the catalog sends none", () => {
    const index = skillLabelIndex([{ skill_id: "c.skill.a", label: "Explain what A does" }, { skill_id: "c.skill.b", label: "" }]);
    expect(skillLabel(index, "c.skill.a")).toBe("Explain what A does");
    expect(skillLabel(index, "c.skill.b")).toBe("c.skill.b");
    expect(skillLabel(index, "c.skill.unknown")).toBe("c.skill.unknown");
    expect(skillLabel(skillLabelIndex(null), "c.skill.a")).toBe("c.skill.a");
  });

  it("opens an attempt of the history with when it was recorded and when it happened, not with its identifier", () => {
    const line = attemptWhenLine({ mode: "assess", recorded_at: "2026-09-09T15:00:00Z", occurred_at: "2026-09-09T15:00:00Z", time_basis: "observed" });
    expect(line.startsWith(`Recorded ${formatWhen("2026-09-09T15:00:00Z")} · happened ${formatWhen("2026-09-09T15:00:00Z")} (`)).toBe(true);
    expect(line.endsWith(" · mode: assess")).toBe(true);
    const unknown = attemptWhenLine({ mode: "learn", recorded_at: "2026-09-07T15:00:00Z", occurred_at: null, time_basis: "unknown" });
    expect(unknown).toContain("time of the response not recorded");
    expect(unknown, "an unknown time is not invented").not.toContain("happened");
  });
});

describe("identifiers on request", () => {
  it("are behind a closed button named Details and are not in the page until it is opened", () => {
    render(<Details rows={[["Attempt", "c-20260909-q01-04"], ["Skill", "c.skill.a"], ["Family", null], ["Earlier versions", ""]]} />);
    const toggle = screen.getByRole("button", { name: "Details" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("c-20260909-q01-04")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Attempt").tagName).toBe("DT");
    expect(screen.getByText("c-20260909-q01-04").closest("dd")).not.toBeNull();
    expect(screen.getByText("c.skill.a")).toBeTruthy();
    expect(screen.queryByText("Family"), "a row with nothing to state is left out").toBeNull();
    expect(screen.queryByText("Earlier versions")).toBeNull();
  });

  it("draw nothing at all when there is no identifier to state", () => {
    const { container } = render(<Details rows={[["Version", null], ["Source", undefined]]} />);
    expect(container.innerHTML).toBe("");
  });
});
