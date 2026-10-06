// lib/format.ts: figures, times and line breaks (design specification 9.11). The wording itself (labels, sentences,
// the identity line) is tested with lib/labels.ts and lib/r2.ts; this file tests only what format.ts adds.
import { describe, expect, it } from "vitest";
import { MIDDLE_DOT, dotJoin, factUnits, factsLine, formatMs, nb } from "@/lib/format";
import { NBSP, clockLabel } from "@/lib/labels";
import { formatMs as formatMsFromUi } from "@/components/ui";

describe("formatMs", () => {
  it("writes m:ss under an hour and h:mm:ss from an hour", () => {
    expect(formatMs(0)).toBe("0:00");
    expect(formatMs(59_400)).toBe("0:59");
    expect(formatMs(1_104_000)).toBe("18:24");
    expect(formatMs(3_599_000)).toBe("59:59");
    expect(formatMs(3_600_000)).toBe("1:00:00");
    expect(formatMs(4_100_000)).toBe("1:08:20");
  });

  it("never writes a negative or a broken time", () => {
    expect(formatMs(-5_000)).toBe("0:00");
    expect(formatMs(Number.NaN)).toBe("0:00");
  });

  it("is the one clock of the app: the same words as the label functions, and still exported where callers import it", () => {
    for (const ms of [0, 999, 61_000, 3_725_000]) expect(formatMs(ms)).toBe(clockLabel(ms));
    expect(formatMsFromUi).toBe(formatMs);
  });
});

describe("dotJoin", () => {
  it("joins what stands beside a state with middle dots", () => {
    expect(dotJoin(["Assisted: solution shown", "1 attempt", "prior exposure"])).toBe(`Assisted: solution shown ${MIDDLE_DOT} 1 attempt ${MIDDLE_DOT} prior exposure`);
    expect(MIDDLE_DOT).toBe("·");
  });

  it("leaves out what is not there, and writes no dot for one part or none", () => {
    expect(dotJoin(["PDF page 23 of 91", null, "", undefined, false, "build 2 of 3"])).toBe("PDF page 23 of 91 · build 2 of 3");
    expect(dotJoin(["Independent"])).toBe("Independent");
    expect(dotJoin([])).toBe("");
    expect(dotJoin([null, ""])).toBe("");
  });

  it("keeps a part as it is: it does not trim or reword", () => {
    expect(dotJoin([nb("PDF page 23 of 91"), nb("build 2 of 3")])).toBe(`PDF${NBSP}page${NBSP}23${NBSP}of${NBSP}91 · build${NBSP}2${NBSP}of${NBSP}3`);
  });
});

describe("factsLine", () => {
  it("makes each fact one unbreakable unit and separates facts with a comma and an ordinary space", () => {
    const line = factsLine(["91 pages", "recording 1 h 20 min", "18 questions"]);
    expect(line).toBe(`91${NBSP}pages, recording${NBSP}1${NBSP}h${NBSP}20${NBSP}min, 18${NBSP}questions`);
    // The only ordinary spaces are the two between facts: a line can break there and nowhere else.
    expect(line.split(" ")).toHaveLength(3);
  });

  it("says a missing thing in words as one unit, and leaves out a fact that is not there", () => {
    expect(factsLine(["83 pages", "no recording", null, "no questions in the catalog", ""])).toBe(`83${NBSP}pages, no${NBSP}recording, no${NBSP}questions${NBSP}in${NBSP}the${NBSP}catalog`);
    expect(factsLine([])).toBe("");
  });

  it("does not double a non-breaking space a fact already holds", () => {
    expect(factsLine([`91${NBSP}pages`])).toBe(`91${NBSP}pages`);
  });
});

describe("factUnits", () => {
  it("splits a line into the units a renderer may break between", () => {
    expect(factUnits(`91${NBSP}pages, recording${NBSP}1${NBSP}h${NBSP}20${NBSP}min, 18${NBSP}questions`)).toEqual([`91${NBSP}pages,`, `recording${NBSP}1${NBSP}h${NBSP}20${NBSP}min,`, `18${NBSP}questions`]);
    expect(factUnits("")).toEqual([]);
    expect(factUnits("  one   two ")).toEqual(["one", "two"]);
  });

  it("is the inverse of joining with ordinary spaces", () => {
    const line = factsLine(["14 lectures", "120 questions in the catalog", "9 recorded attempts"]);
    expect(factUnits(line).join(" ")).toBe(line);
  });
});

describe("nb", () => {
  it("is the one helper every label function uses: the same function wherever it is imported from", async () => {
    const labels = await import("@/lib/labels");
    expect(nb).toBe(labels.nb);
    expect(nb("PDF page 23 of 91")).toBe(`PDF${NBSP}page${NBSP}23${NBSP}of${NBSP}91`);
  });
});
