// The Questions tab (design specification 5.9), FIRST VERSION: three stacked sections in one scroll, each a heading that
// opens, with a count that equals the rows it heads. The rows are still the existing question rows
// (features/question/QuestionList); the next version replaces them with the unboxed entry and its basis block.
//
//   This slide            ties of the page (lib/r2 `questionsForPage`), the course's own first; section ties apart
//   Related concepts      questions that share a concept with the slide; never a claim about a page
//   All lecture questions every question the catalog holds for the lecture
//
// A view from an older Brain (no tie data) falls back to the questions the course record places on the slide. On a
// structural page no list for the single slide is forced: the role is said, and the lecture's questions are open.
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { Button, Sections, Section } from "@/components/ui";
import { QUESTION_LIST_LABEL, R2_ACTION, ROLE_LABEL, SECTION_TIE, TIE_KIND, countLabel, relatedSentence, sectionHeading, suggestedLinkLabel } from "@/lib/labels";
import { identityOf, isStructuralPage, questionsForPage, whereLine } from "@/lib/r2";
import type { QuestionRow, SlideQuestionTie } from "@/lib/types";
import { LectureQuestionsPanel, QuestionListItem } from "@/features/question/QuestionList";
import type { QuestionsTabProps } from "./contracts";

type SectionId = "this_slide" | "related_concepts" | "all_lecture";

/** What a tie is, in the words of lib/labels: its kind, and for a suggested link how far it was checked. */
function tieLabel(tie: SlideQuestionTie): string {
  return tie.tie === "agent_inferred" ? suggestedLinkLabel(tie) : TIE_KIND[tie.tie]?.label ?? tie.tie.replace(/_/g, " ");
}

/** A question the lecture's list does not hold in full (a tie to a question of another collection): its name and a way in. */
function BareQuestion({ courseId, questionId, title, children }: { courseId: string; questionId: string; title: string | null; children?: React.ReactNode }) {
  const location = useLocation();
  return (
    <li className="flex flex-col gap-1 py-3" data-testid="question-row" data-question-id={questionId}>
      <Link className="ll-link font-semibold" to={`/courses/${courseId}/questions/${encodeURIComponent(questionId)}`} state={{ returnTo: location.pathname + location.search, returnLabel: "Return" }}>{title ?? questionId}</Link>
      {children}
    </li>
  );
}

export function QuestionsTab({ courseId, lecture, page, slide, onGoToPage, nextContentPage }: QuestionsTabProps) {
  const questions = useMemo(() => questionsForPage(lecture, page), [lecture, page]);
  const identity = useMemo(() => identityOf(lecture, page), [lecture, page]);
  const structural = isStructuralPage(lecture, page);
  const rows = useMemo(() => new Map(lecture.questions.all.map((row) => [row.question_id, row])), [lecture.questions.all]);
  const deckId = lecture.deck?.source_id;

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
  const showThisSlide = !(structural && hereCount === 0 && questions.counts.section === 0);

  const [open, setOpen] = useState<SectionId[]>(() => [structural ? "all_lecture" : "this_slide"]);
  // A structural page opens the lecture's questions; an ordinary page opens its own list again.
  useEffect(() => {
    setOpen((current) => {
      const wanted: SectionId = structural ? "all_lecture" : "this_slide";
      return current.includes(wanted) ? current : [...current, wanted];
    });
  }, [structural, page]);

  return (
    <div className="flex flex-col" data-testid="questions-tab">
      {structural && !showThisSlide && (
        <div className="mb-4 flex flex-col items-start gap-2" data-testid="structural-note">
          <h3 className="text-head font-semibold">{slide?.role ? ROLE_LABEL[slide.role.value] ?? slide.role.value : "Structural page"}</h3>
          <p className="ll-measure text-ui text-muted">Lists for a single slide are not kept for a title, section, administrative or blank page. The lecture's questions stay available below.</p>
          {nextContentPage !== null && <Button size="sm" onClick={() => onGoToPage(nextContentPage)}>{R2_ACTION.next_content}</Button>}
        </div>
      )}
      <Sections value={open} onValueChange={(next) => setOpen(next as SectionId[])}>
        {showThisSlide && (
          <Section value="this_slide" title={QUESTION_LIST_LABEL.this_slide} count={hereCount}>
            {hereCount === 0 && questions.counts.section === 0 && (
              <p className="ll-measure text-ui text-muted" data-testid="lecture-questions-hint">
                {questions.known ? "No question is tied to this page." : "The course record places no question on this page."}
                {allCount > 0 ? ` This lecture has ${countLabel(allCount, "question")}; they are listed under ${QUESTION_LIST_LABEL.all_lecture}.` : ""}
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {questions.known ? questions.thisSlide.map((entry) => {
                const row = rows.get(entry.question_id);
                const lines = entry.ties.map((tie, index) => (
                  <p key={index} className="text-ui text-muted" data-testid="question-tie"><span className="font-semibold text-ink">{tieLabel(tie)}.</span>{" "}{whereLine(identity, tie) ?? ""}</p>
                ));
                return row ? <QuestionListItem key={entry.question_id} courseId={courseId} row={row} onGoToPage={onGoToPage} deckId={deckId}>{lines}</QuestionListItem>
                  : <BareQuestion key={entry.question_id} courseId={courseId} questionId={entry.question_id} title={entry.ties[0]?.title ?? null}>{lines}</BareQuestion>;
              }) : legacyHere.map((row) => <QuestionListItem key={row.question_id} courseId={courseId} row={row} onGoToPage={onGoToPage} deckId={deckId} />)}
            </ul>
            {questions.section.length > 0 && (
              <div className="mt-3 border-t border-hairline pt-3" data-testid="section-ties">
                <p className="flex items-baseline justify-between gap-3 text-ui font-semibold text-muted">
                  <span>{sectionHeading(questions.section[0]!.section) || SECTION_TIE.label}</span><span className="ll-num font-normal">{questions.section.length}</span>
                </p>
                <ul className="mt-2 flex flex-col gap-2">
                  {questions.section.map((tie) => {
                    const row = rows.get(tie.question_id);
                    return row ? <QuestionListItem key={tie.question_id} courseId={courseId} row={row} onGoToPage={onGoToPage} deckId={deckId} />
                      : <BareQuestion key={tie.question_id} courseId={courseId} questionId={tie.question_id} title={tie.title} />;
                  })}
                </ul>
              </div>
            )}
          </Section>
        )}
        <Section value="related_concepts" title={QUESTION_LIST_LABEL.related_concepts} count={relatedCount}>
          <p className="ll-measure mb-2 text-ui text-muted">These share a concept with this slide. None of them is tied to a page here.</p>
          <ul className="flex flex-col gap-2">
            {questions.known ? questions.related.map((entry) => {
              const row = rows.get(entry.question_id);
              const via = <p className="text-ui text-muted">{relatedSentence(entry.via_concepts)}</p>;
              return row ? <QuestionListItem key={entry.question_id} courseId={courseId} row={row}>{via}</QuestionListItem>
                : <BareQuestion key={entry.question_id} courseId={courseId} questionId={entry.question_id} title={entry.title}>{via}</BareQuestion>;
            }) : legacyRelated.map((row) => <QuestionListItem key={row.question_id} courseId={courseId} row={row} />)}
          </ul>
          {questions.counts.relatedTotal > questions.counts.related && (
            <p className="mt-2 text-ui text-muted">{questions.counts.related} of {questions.counts.relatedTotal} shown. <Link className="ll-link" to={`/courses/${courseId}/questions?lecture=${encodeURIComponent(lecture.lecture_id)}`}>Open the question bank</Link></p>
          )}
        </Section>
        <Section value="all_lecture" title={QUESTION_LIST_LABEL.all_lecture} count={allCount}>
          <LectureQuestionsPanel courseId={courseId} lecture={lecture} onGoToPage={onGoToPage} />
        </Section>
      </Sections>
    </div>
  );
}
