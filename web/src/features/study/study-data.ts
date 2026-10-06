// What the Study home reads besides the workspace view: this device's last places (a per-device convenience, never
// learning evidence), the synchronised position of every bound course, the lecture view of the place you left and the
// unsent tutor draft kept for it. Hooks only; the wording is in ./study-facts.
import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { getDraft } from "@/lib/db";
import { useLecture } from "@/lib/queries";
import type { LectureView, ResumeState } from "@/lib/types";
import { readLastPlace, type LastPlace } from "./study-facts";

function stored(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null; // blocked or cleared storage: the page renders its first-run state
  }
}

/** The lecture and page last opened in a course on this device (written by the lecture workspace as `ll.last.<course>`). */
export const lastPosition = (courseId: string): LastPlace | null => readLastPlace(stored(`ll.last.${courseId}`));

/** A file chosen earlier on this device for a unit with several equal candidates (written by the lecture workspace). */
const rememberedDeck = (courseId: string, lectureId: string): string | null => stored(`ll.deck.${courseId}.${lectureId}`) || null;

/**
 * The synchronised study position of each bound course, by course id. The same cache entries as `useResume` of
 * lib/queries (key and route are its own), read for a list of courses at once.
 */
export function useCourseResumes(courseIds: readonly string[]): { byCourse: Record<string, ResumeState | undefined>; settled: boolean } {
  return useQueries({
    queries: courseIds.map((courseId) => ({ queryKey: ["resume", courseId], queryFn: ({ signal }: { signal: AbortSignal }) => apiGet<ResumeState>(`courses/${courseId}/resume`, signal), retry: false as const, staleTime: 5_000 })),
    combine: (results) => ({
      byCourse: Object.fromEntries(courseIds.map((courseId, index) => [courseId, results[index]?.data])) as Record<string, ResumeState | undefined>,
      settled: results.every((result) => !result.isLoading),
    }),
  });
}

/**
 * The lecture view of the place you left: its real title, the identity of the page and the file its picture is drawn
 * from. A unit with several equal candidate files is read with the file chosen earlier on this device, as the lecture
 * workspace opens it.
 */
export function useResumeLecture(courseId: string, lectureId: string): { lecture: LectureView | undefined; loading: boolean } {
  const first = useLecture(courseId, lectureId);
  const remembered = useMemo(() => {
    const view = first.data;
    if (!view || view.display.kind !== "choose_deck") return null;
    const deck = rememberedDeck(courseId, lectureId);
    return deck && view.deck_choice.candidates.some((candidate) => candidate.source_id === deck) ? deck : null;
  }, [first.data, courseId, lectureId]);
  const chosen = useLecture(remembered ? courseId : undefined, remembered ? lectureId : undefined, remembered);
  return { lecture: (remembered ? chosen.data : undefined) ?? first.data, loading: first.isLoading || (!!remembered && chosen.isLoading) };
}

/** 1 when an unsent tutor draft with text is kept on this device for the lecture, otherwise 0. */
export function useTutorDraftCount(courseId: string, lectureId: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    setCount(0);
    getDraft(`tutor:${courseId}:${lectureId}`).then((draft) => alive && setCount(draft && draft.text.trim() ? 1 : 0)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [courseId, lectureId]);
  return count;
}
