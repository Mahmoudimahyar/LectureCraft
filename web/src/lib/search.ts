// Bounded client-side search over the prepared index of one course (or, explicitly, several).
// No model prompt, no always-on graph server; the index never contains answer keys.
import type { SearchEntry, SearchIndex } from "./types";

export interface SearchHit {
  courseId: string;
  courseName: string;
  entry: SearchEntry;
  score: number;
  snippet: string;
}

const tokenize = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];

function snippetOf(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  const at = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 50);
  const piece = text.slice(start, start + 180).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + piece + (start + 180 < text.length ? "…" : "");
}

/** All query terms must match (prefix match on words). Title matches rank above body matches. */
export function searchIndexes(indexes: SearchIndex[], query: string, limit?: number): { hits: SearchHit[]; total: number; truncated: boolean } {
  const terms = tokenize(query);
  if (!terms.length) return { hits: [], total: 0, truncated: false };
  const hits: SearchHit[] = [];
  for (const index of indexes) {
    for (const entry of index.entries) {
      const title = tokenize(entry.title);
      const body = tokenize(entry.text);
      let score = 0;
      let matchedAll = true;
      for (const term of terms) {
        const inTitle = title.some((w) => w.startsWith(term));
        const inBody = body.some((w) => w.startsWith(term));
        if (!inTitle && !inBody) {
          matchedAll = false;
          break;
        }
        score += (inTitle ? 3 : 0) + (inBody ? 1 : 0);
      }
      if (!matchedAll) continue;
      if (entry.type === "slide" || entry.type === "question") score += 0.5;
      hits.push({ courseId: index.course_id, courseName: index.display_name, entry, score, snippet: snippetOf(entry.text || entry.title, terms) });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title));
  const max = limit ?? Math.min(...indexes.map((i) => i.max_results), 50);
  return { hits: hits.slice(0, max), total: hits.length, truncated: hits.length > max };
}

export const TYPE_LABEL: Record<SearchEntry["type"], string> = {
  lecture: "Lecture", slide: "Slide", transcript: "Transcript line", question: "Question", concept: "Concept", skill: "Skill", source: "Source file",
};

/** Route for a hit. Text without a verified locator opens its source context, never an invented page or time. */
export function hitHref(hit: SearchHit): string {
  const { ref } = hit.entry;
  const base = `/courses/${hit.courseId}`;
  switch (hit.entry.type) {
    case "lecture":
      return `${base}/lectures/${ref.lecture_id}`;
    case "slide":
      return `${base}/lectures/${ref.lecture_id}?page=${ref.page}`;
    case "transcript":
      return `${base}/lectures/${ref.lecture_id}?panel=transcript&line=${ref.line}`;
    case "question":
      return `${base}/questions/${encodeURIComponent(ref.question_id ?? "")}`;
    case "concept":
    case "skill":
      return `${base}/concepts/${encodeURIComponent(ref.node_id ?? "")}`;
    default: {
      // A further file of a unit opens at its page; a transcript the course links to no lecture opens at its line.
      const where = ref.page ? `?page=${ref.page}` : ref.line ? `?line=${ref.line}` : "";
      return `${base}/sources/${encodeURIComponent(ref.source_id ?? "")}${where}`;
    }
  }
}
