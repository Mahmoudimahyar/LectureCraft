// Figures, times and line breaks (design specification 9.11). Pure functions, no wording of their own.
//
// The wording of every state, the identity line, the support sentence, the where-phrase, what stands beside an
// evidence state and the stale line live in ./labels and ./r2, with the short references that hold their parts
// together (pageRef, pagesRef, durationLabel, timeSpanLabel, rangeOrdinalLabel, countLabel). This module adds only what
// those do not have: the clock under the name older callers import, and the two ways several facts share one line.
import { NBSP, clockLabel, nb } from "./labels";

/** One helper, used by every label function: ordinary spaces become non-breaking, so one fact is never broken inside. */
export { nb, countLabel } from "./labels";

/** "18:24" under an hour, "1:08:20" from an hour. The one clock of the app (labels.clockLabel) under its older name. */
export const formatMs: (ms: number) => string = clockLabel;

export const MIDDLE_DOT = "·";
type Part = string | null | undefined | false;
const present = (part: Part): part is string => typeof part === "string" && part !== "";

/**
 * Parts of one line joined by a middle dot between ordinary spaces: "PDF page 23 of 91 · build 2 of 3",
 * "Assisted: solution shown · 1 attempt · prior exposure". A part that is not there is left out; the parts themselves
 * are not changed (a part that must not break is passed through `nb` by whoever composes it).
 */
export function dotJoin(parts: readonly Part[]): string {
  return parts.filter(present).join(` ${MIDDLE_DOT} `);
}

/**
 * A line of facts that breaks only between facts: "91 pages, recording 1 h 20 min, 18 questions". Each fact becomes one
 * unbreakable unit; facts are separated by a comma and an ordinary space. A missing thing is passed in words ("no
 * recording") and is one unit like any other; a fact that is not there is left out.
 */
export function factsLine(facts: readonly Part[]): string {
  return facts.filter(present).map((fact) => nb(fact.split(NBSP).join(" "))).join(", ");
}

/** The units of a line that a renderer may break between (it was split at ordinary spaces only). */
export function factUnits(line: string): string[] {
  return line.split(" ").filter((unit) => unit !== "");
}
