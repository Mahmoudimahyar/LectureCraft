// The Questions tab (design specification 5.9, 9.6, 9.7): three stacked sections in one scroll, each a heading that
// opens, with a count that equals the rows it heads. The lower two start closed.
//
//   This slide            the page ties of the page on screen (lib/r2 `questionsForPage`), one full entry per question
//                         with every tie it has here; below them, APART, what the course's study map places in this
//                         part of the lecture (never a page anchor, never counted with the page ties)
//   Related concepts      questions that share a concept with the slide, the concept named; never a claim about a page
//   All lecture questions every question the catalog holds for the lecture, each with all its ties or its no-link line
//
// The headings are lib/labels `QUESTION_LIST_LABEL` (one line there changes them). A source-page link turns the slide to
// that page and a transcript-line link opens the Transcript tab at those lines; both keep the draft and the recording.
// On a structural page no list for the single slide is forced and nothing says "no questions": the role is said and the
// lecture's list is open. A view from an older Brain (no tie data) shows the questions the course record places on the
// slide and invents no tie.
//
// A question is ONE entry in a section. When the study map also places a question that is tied to this page, that is a
// second basis line of its entry ("Stated for a part of the lecture"), as the question bank shows it; the sub-heading
// below lists only the questions that have no tie to the page itself.
//
// When nothing is tied to the page, This slide says so in one sentence and the next list that has rows is opened for
// the page (Related concepts, else All lecture questions), so the lecture's questions are what is read. The learner
// can close it; what they opened or closed themselves is kept.
//
// Reject takes a suggested link out of the list with the next view. One line stays where it stood until the page
// changes ("You rejected the suggested link pp. 5–6." with Take back) and is announced; the history row of the
// lecture's list is unchanged.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { SkipForward } from "lucide-react";
import { useWorkspaceFrame } from "@/app/WorkspaceFrame";
import { Button, Sections, Section, cn } from "@/components/ui";
import { QUESTION_LIST_LABEL, R2_ACTION, ROLE_LABEL, SECTION_TIE, countLabel, pagesRef, sectionHeading, unlistedLabel } from "@/lib/labels";
import { identityOf, isStructuralPage, questionsForPage } from "@/lib/r2";
import type { QuestionRow, SlideQuestionTie, SlideSectionTie } from "@/lib/types";
import {
  LectureQuestionsPanel, PROSE, QuestionEntries, QuestionEntry, QuestionListItem, QuestionNavProvider, RejectedStub, RelatedBasis, SectionTieBasis, SlideTieBasis, SourcesLine, SuggestionsChangedNotice, mergeLines,
  positionsOf, questionName, type DecisionEvent, type EntryQuestion, type QuestionNav,
} from "@/features/question/QuestionList";
import type { QuestionsTabProps } from "./contracts";

type SectionId = "this_slide" | "related_concepts" | "all_lecture";

/** Section ties that speak of the same part of the lecture, under one sub-heading; a question once in each. */
function sectionGroups(ties: readonly SlideSectionTie[]): SlideSectionTie[][] {
  const groups = new Map<string, SlideSectionTie[]>();
  for (const tie of ties) {
    const key = JSON.stringify([tie.section?.page_ranges ?? [], tie.section?.label ?? null]);
    const group = groups.get(key) ?? [];
    if (!group.some((other) => other.question_id === tie.question_id)) groups.set(key, [...group, tie]);
  }
  return [...groups.values()];
}

/** A suggested link the learner rejected on this page: what the line in its place needs. */
interface Rejection {
  page: number;
  suggestionId: string;
  question: Pick<EntryQuestion, "question_id" | "collection" | "number" | "title">;
  pages: number[];
  /** Where its entry stood in the list of the slide. */
  index: number;
}
/** A sentence of the tab: the reading size, muted, on the measure of prose (the same as a sentence of an entry). */
const SENTENCE = `${PROSE} text-read text-muted`;
const nameOf = (question: Pick<EntryQuestion, "question_id" | "collection" | "number" | "title">): string => {
  const { place, title } = questionName(question);
  return title ? `${place} · ${title}` : place;
};

export function QuestionsTab({ courseId, lecture, page, slide, onGoToPage, nextContentPage, onOpenTranscriptLines }: QuestionsTabProps) {
  const frame = useWorkspaceFrame();
  const client = useQueryClient();
  const [, setParams] = useSearchParams();
  const questions = useMemo(() => questionsForPage(lecture, page), [lecture, page]);
  const identity = useMemo(() => identityOf(lecture, page), [lecture, page]);
  const structural = isStructuralPage(lecture, page);
  const rows = useMemo(() => new Map(lecture.questions.all.map((row) => [row.question_id, row])), [lecture.questions.all]);
  const [conflict, setConflict] = useState(false);

  // Older view: the questions the course record places on this slide, and lecture questions that share one of its concepts.
  const legacyHere: QuestionRow[] = useMemo(() => (questions.known || !slide ? [] : slide.questions.map((entry) => rows.get(entry.question_id)).filter((row): row is QuestionRow => !!row)), [questions.known, slide, rows]);
  const legacyRelated: QuestionRow[] = useMemo(() => {
    if (questions.known || !slide) return [];
    const here = new Set(slide.concepts.map((concept) => concept.concept_id));
    const placed = new Set(slide.questions.map((question) => question.question_id));
    return lecture.questions.all.filter((row) => !placed.has(row.question_id) && row.concept_ids.some((id) => here.has(id)));
  }, [questions.known, slide, lecture.questions.all]);

  const hereCount = questions.known ? questions.counts.thisSlide : legacyHere.length;
  const relatedCount = questions.known ? questions.counts.related : legacyRelated.length;
  const allCount = lecture.questions.all.length;
  // One entry per question: the study-map tie of a question that is tied to this page goes into that entry; the
  // sub-heading keeps the questions the study map alone places here.
  const { sectionOfQuestion, sections } = useMemo(() => {
    const here = new Set(questions.thisSlide.map((entry) => entry.question_id));
    const inEntry = new Map<string, SlideSectionTie[]>();
    for (const tie of questions.section) if (here.has(tie.question_id)) inEntry.set(tie.question_id, [...(inEntry.get(tie.question_id) ?? []), tie]);
    return { sectionOfQuestion: inEntry, sections: sectionGroups(questions.section.filter((tie) => !here.has(tie.question_id))) };
  }, [questions.thisSlide, questions.section]);
  /** A structural page with nothing tied to it: no list of its own is drawn, and the lecture's list is opened for it. */
  const noOwnList = structural && hereCount === 0 && questions.counts.section === 0;

  // Links the learner rejected on this page. A line stands for each while its link is out of the list.
  const [rejections, setRejections] = useState<Rejection[]>([]);
  useEffect(() => setRejections([]), [page]);
  const stubs = useMemo(() => {
    const listed = new Set(questions.thisSlide.flatMap((entry) => entry.ties).flatMap((tie) => (tie.tie === "agent_inferred" ? [tie.suggestion_id] : [])));
    return rejections.filter((entry) => entry.page === page && !listed.has(entry.suggestionId)).sort((a, b) => a.index - b.index);
  }, [rejections, questions.thisSlide, page]);
  /** Lines whose question left the list with its link; a line of a question that is still listed stands inside its entry. */
  const alone = stubs.filter((stub) => !questions.thisSlide.some((entry) => entry.question_id === stub.question.question_id));
  const onDecide = useCallback((event: DecisionEvent) => {
    if (event.decision !== "rejected") return;
    if (event.outcome === "failed") return setRejections((current) => current.filter((entry) => entry.suggestionId !== event.suggestionId));
    const index = questions.thisSlide.findIndex((entry) => entry.ties.some((tie) => tie.tie === "agent_inferred" && tie.suggestion_id === event.suggestionId));
    const tie = questions.thisSlide[index]?.ties.find((candidate) => candidate.tie === "agent_inferred" && candidate.suggestion_id === event.suggestionId);
    if (!tie) return; // a row of another list: it keeps its own line there
    const question = { question_id: tie.question_id, collection: tie.collection, number: tie.number, title: tie.title };
    setRejections((current) => [...current.filter((entry) => entry.suggestionId !== event.suggestionId), { page, suggestionId: event.suggestionId, question, pages: [...tie.support_pages, ...tie.other_pages], index }]);
  }, [questions.thisSlide, page]);
  const lastStub = stubs[stubs.length - 1];
  const announcement = lastStub ? `You rejected the suggested link${lastStub.pages.length ? ` ${pagesRef(lastStub.pages)}` : ""} of ${nameOf(lastStub.question)}. ${R2_ACTION.take_back} is beside it.` : "";

  /** Nothing of its own to read on this page: the next list that has rows is opened for it. */
  const emptyHere = !noOwnList && hereCount === 0 && sections.length === 0 && alone.length === 0;
  const auto: SectionId | null = noOwnList ? "all_lecture" : emptyHere ? (relatedCount > 0 ? "related_concepts" : allCount > 0 ? "all_lecture" : null) : null;

  // What the learner left open. A list opened for the page closes again with the page; closing it by hand holds for the page.
  const [chosen, setChosen] = useState<SectionId[]>(["this_slide"]);
  const [closedAt, setClosedAt] = useState<number | null>(null);
  useEffect(() => setClosedAt(null), [page]);
  const opened = auto !== null && !chosen.includes(auto);
  const open = opened && closedAt !== page ? [...chosen, auto] : chosen;
  const onOpenChange = (next: string[]) => {
    const wanted = next as SectionId[];
    if (opened) {
      setClosedAt(wanted.includes(auto) ? null : page);
      setChosen(wanted.filter((id) => id !== auto));
    } else setChosen(wanted);
  };

  // A source page turns the slide. Alone in a pane the slide is not on screen, so the same step shows the Slide pane
  // (one address change: two in a row would overwrite each other). Back returns to the list.
  const turnTo = useCallback((target: number) => {
    if (frame.arrangement !== "panes") return onGoToPage(target);
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("page", String(target));
      next.set("panel", "slide");
      next.delete("line");
      return next;
    });
  }, [frame.arrangement, onGoToPage, setParams]);
  const openLines = useCallback((start: number, end: number) => {
    if (onOpenTranscriptLines) return onOpenTranscriptLines(start, end);
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("panel", "transcript");
      next.set("line", String(start));
      return next;
    });
  }, [onOpenTranscriptLines, setParams]);

  const nav = useMemo<QuestionNav>(() => ({
    lectureId: lecture.lecture_id, page, onGoToPage: turnTo, onOpenLines: openLines, positionOf: positionsOf(lecture),
    fileName: (sourceId) => lecture.other_materials.find((item) => item.source_id === sourceId)?.filename ?? null,
    onConflict: () => setConflict(true), onDecide,
  }), [lecture, page, turnTo, openLines, onDecide]);

  const stubLine = (stub: Rejection, alone_: boolean): ReactNode => (
    <RejectedStub key={`stub-${stub.suggestionId}`} as={alone_ ? "li" : "div"} courseId={courseId} suggestionId={stub.suggestionId} pages={stub.pages} about={nameOf(stub.question)}
      name={alone_ ? nameOf(stub.question) : undefined} className={alone_ ? "border-t border-hairline py-4 first:border-t-0" : undefined} />
  );
  const slideEntry = (entry: { question_id: string; ties: SlideQuestionTie[] }) => {
    const [first] = entry.ties;
    if (!first) return null;
    const about = nameOf(first);
    return (
      <QuestionEntry key={entry.question_id} courseId={courseId} question={first} evidence={first.evidence} variant="slide"
        sources={<SourcesLine courseId={courseId} lectureId={lecture.lecture_id} pages={entry.ties.flatMap((tie) => [...tie.support_pages, ...tie.other_pages])} lines={mergeLines(entry.ties.map((tie) => tie.transcript_lines))} />}>
        {entry.ties.map((tie, index) => <SlideTieBasis key={index} courseId={courseId} tie={tie} identity={identity} about={about} />)}
        {(sectionOfQuestion.get(entry.question_id) ?? []).map((tie, index) => <SectionTieBasis key={`s${index}`} section={tie.section} />)}
        {stubs.filter((stub) => stub.question.question_id === entry.question_id).map((stub) => stubLine(stub, false))}
      </QuestionEntry>
    );
  };
  /** The entries of the slide, with the line of a rejected link where its entry stood. */
  const hereRows = (): ReactNode[] => {
    const rows: ReactNode[] = questions.thisSlide.map(slideEntry);
    for (const stub of alone) rows.splice(Math.min(stub.index, rows.length), 0, stubLine(stub, true));
    return rows;
  };

  return (
    <QuestionNavProvider value={nav}>
      <div className="flex flex-col" data-testid="questions-tab">
        {/* Said aloud when a rejected link leaves the list; always in the page, so the change is announced. */}
        <p className="sr-only" aria-live="polite" data-testid="questions-announce">{announcement}</p>
        {conflict && <SuggestionsChangedNotice className="mb-3" onRefresh={() => { setConflict(false); void client.invalidateQueries({ queryKey: ["lecture", courseId, lecture.lecture_id] }); }} />}
        {noOwnList && (
          <div className="mb-2 flex flex-col items-start gap-2 border-b border-hairline pb-4" data-testid="structural-note">
            <h3 className="text-head font-semibold">{slide?.role ? ROLE_LABEL[slide.role.value] ?? unlistedLabel(String(slide.role.value)) : "Structural page"}</h3>
            <p className={SENTENCE}>Lists for a single slide are not kept for a title, section, administrative or blank page. The lecture's questions stay available below.</p>
            {nextContentPage !== null && <Button size="sm" onClick={() => onGoToPage(nextContentPage)}><SkipForward aria-hidden />{R2_ACTION.next_content}</Button>}
          </div>
        )}
        <Sections value={open} onValueChange={onOpenChange} className={noOwnList ? undefined : "[&>*:first-child_.ll-sec]:pt-1"}>
          {!noOwnList && (
            <Section value="this_slide" title={QUESTION_LIST_LABEL.this_slide} count={hereCount}>
              {hereCount === 0 && alone.length === 0 && (
                <p className={SENTENCE} data-testid="lecture-questions-hint">
                  {questions.known ? "No question is tied to this page." : "The course record places no question on this page."}
                  {allCount > 0 ? ` This lecture has ${countLabel(allCount, "question")}; they are listed under ${QUESTION_LIST_LABEL.all_lecture}.` : ""}
                </p>
              )}
              {(hereCount > 0 || alone.length > 0) && (
                <QuestionEntries data-testid="this-slide-list" aria-label={QUESTION_LIST_LABEL.this_slide}>
                  {questions.known ? hereRows() : legacyHere.map((row) => <QuestionListItem key={row.question_id} courseId={courseId} row={row} />)}
                </QuestionEntries>
              )}
              {sections.map((group, index) => (
                <section key={index} className="ll-measure mt-2 border-t border-hairline pt-3" data-testid="section-ties">
                  <h4 className="flex items-baseline justify-between gap-3 text-ui font-semibold text-muted">
                    <span>{sectionHeading(group[0]!.section) || SECTION_TIE.label}</span>{" "}<span className="ll-num font-normal">{group.length}</span>
                  </h4>
                  <QuestionEntries>
                    {group.map((tie) => (
                      <QuestionEntry key={tie.question_id} courseId={courseId} question={tie} evidence={tie.evidence} variant="list"><SectionTieBasis section={tie.section} /></QuestionEntry>
                    ))}
                  </QuestionEntries>
                </section>
              ))}
            </Section>
          )}
          {/* A structural page with nothing related draws no empty list of its own either. */}
          {!(noOwnList && relatedCount === 0) && <Section value="related_concepts" title={QUESTION_LIST_LABEL.related_concepts} count={relatedCount}>
            <div data-testid="related-list">
              <p className={cn(SENTENCE, "mb-1")}>These share a concept with this slide. None of them is tied to a page here.</p>
              <QuestionEntries aria-label={QUESTION_LIST_LABEL.related_concepts}>
                {questions.known ? questions.related.map((entry) => (
                  <QuestionEntry key={entry.question_id} courseId={courseId} question={{ ...entry, prompt: rows.get(entry.question_id)?.prompt ?? null }} evidence={entry.evidence} variant="list">
                    <RelatedBasis via={entry.via_concepts} />
                  </QuestionEntry>
                )) : legacyRelated.map((row) => <QuestionListItem key={row.question_id} courseId={courseId} row={row} variant="list" />)}
              </QuestionEntries>
              {questions.counts.relatedTotal > questions.counts.related && (
                <p className={cn(SENTENCE, "mt-2")}>{questions.counts.related} of {questions.counts.relatedTotal} shown. <Link className="ll-link" to={`/courses/${courseId}/questions?lecture=${encodeURIComponent(lecture.lecture_id)}`}>Open the question bank</Link></p>
              )}
            </div>
          </Section>}
          <Section value="all_lecture" title={QUESTION_LIST_LABEL.all_lecture} count={allCount}>
            <LectureQuestionsPanel courseId={courseId} lecture={lecture} />
          </Section>
        </Sections>
      </div>
    </QuestionNavProvider>
  );
}
