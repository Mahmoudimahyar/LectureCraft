// Resume, the first thing on the Study home (design specification 6): the picture of the page you left (the one bright
// object of the page), the course in a muted line, the lecture as the title, one sentence saying where you stopped in
// the words of the identity line, one primary action and one neutral one. Unboxed. When nothing was opened on this
// device there is one sentence in its place.
//
// The block is drawn at once from the place this device stored; what the Brain adds (the lecture view, the picture)
// arrives into places that are already there. The picture has a place of 4:3: a page of another shape is centred in it,
// so nothing under Resume moves when the picture comes.
import { Link } from "react-router";
import { cn, Skeleton } from "@/components/ui";
import { contentUrl } from "@/lib/api";
import { pdfPageLabel } from "@/lib/labels";
import { identityOf } from "@/lib/r2";
import { useFirstPageShape } from "@/lib/thumbs";
import { PULSE } from "./CourseBrowser";
import { usePagePicture, useResumeLecture, useTutorDraftCount } from "./study-data";
import { RESUME_ACTION, RESUME_PICTURE_LABEL, START_ACTION, STUDY_FIRST_RUN, draftSentence, lectureHeading, stoppedSentence, type StudyPlace } from "./study-facts";

/** Widest the picture is drawn (≥ 2400 px); narrower windows scale the same picture down. */
const PICTURE_WIDTH = 380;
/** Width over height of the place kept for the picture. */
const PICTURE_PLACE = 4 / 3;
const GRID = cn(
  "grid grid-cols-[112px_minmax(0,1fr)] items-start gap-x-4 gap-y-3",
  "min-[600px]:grid-cols-[200px_minmax(0,1fr)] min-[600px]:items-center",
  "min-[900px]:grid-cols-[240px_minmax(0,1fr)] min-[900px]:gap-x-6",
  "min-[1200px]:grid-cols-[300px_minmax(0,1fr)] min-[1200px]:gap-x-8",
  "min-[2400px]:grid-cols-[380px_minmax(0,1fr)]",
);

export interface ResumeViewProps {
  /** The course of the place; null on a first load that knows the place before the names of the courses. */
  courseName: string | null;
  /** The lecture as a heading: its real title, with "Lecture 03" before it where the unit id says so. */
  heading: string;
  /** "You stopped on PDF page 23 of 91 · build 2 of 3." */
  sentence: string;
  /** "One unsent draft is kept in Tutor."; null when there is none. */
  draft: string | null;
  resumeHref: string;
  /** The same lecture from its first page; null when the place IS the first page. */
  startHref: string | null;
  /** The rendered page; null until it exists and when the file cannot be drawn (a neutral block stands in). */
  picture: { src: string; width: number; height: number } | null;
  /** Width over height of the page, as soon as it is known. */
  shape: number | null;
  /** True while the picture is still on its way: the neutral block then reads as loading. False when none will come. */
  pictureLoading?: boolean;
}

/** The Resume block as drawn. No data access: everything it says is handed to it. */
export function ResumeView({ courseName, heading, sentence, draft, resumeHref, startHref, picture, shape, pictureLoading = false }: ResumeViewProps) {
  // A page narrower than the place (a portrait handout) is drawn as high as the place, never higher.
  const width = shape && shape > 0 && shape < PICTURE_PLACE ? `${(shape / PICTURE_PLACE) * 100}%` : "100%";
  return (
    <section aria-label="Resume" className={cn(GRID, "mt-4 min-[900px]:mt-6")} data-testid="continue-studying">
      <div className="grid aspect-[4/3] items-start min-[600px]:items-center">
        <Link to={resumeHref} aria-label={RESUME_PICTURE_LABEL} title={RESUME_PICTURE_LABEL} className="block justify-self-center rounded-row" style={{ width }} data-testid="resume-picture">
          {picture
            ? <img src={picture.src} alt="" width={picture.width} height={picture.height} decoding="async" draggable={false}
                className="ll-source-page block h-auto w-full [box-shadow:0_0_0_1px_var(--ll-hairline),var(--ll-shadow-source)]" />
            : <span className={cn("block rounded-row bg-pad-strong", pictureLoading && PULSE)} style={{ aspectRatio: String(shape ?? PICTURE_PLACE) }} data-state={pictureLoading ? "loading" : "none"} />}
        </Link>
      </div>
      <div className="contents min-[600px]:block min-[600px]:min-w-0 min-[600px]:max-w-[64ch]">
        <div className="col-start-2 min-w-0 self-center">
          <p className="text-ui text-muted">
            Resume in {courseName ?? <span data-pending="course"><Skeleton className={cn("inline-block h-[0.7em] w-40 max-w-full align-baseline", PULSE)} /></span>}
          </p>
          <h2 className="mt-1 text-title font-semibold tracking-[-0.015em] [overflow-wrap:anywhere] min-[600px]:text-display">{heading}</h2>
        </div>
        <p className="ll-num col-span-full max-w-[64ch] text-read min-[600px]:mt-3" data-testid="resume-where">
          {sentence}{draft ? ` ${draft}` : ""}
        </p>
        <div className="col-span-full flex flex-wrap items-center gap-3 min-[600px]:mt-6">
          <Link to={resumeHref} className="ll-btn ll-btn-primary ll-btn-lg max-[599px]:flex-1">{RESUME_ACTION}</Link>
          {startHref && <Link to={startHref} className="ll-btn ll-btn-lg max-[599px]:flex-1">{START_ACTION}</Link>}
        </div>
      </div>
    </section>
  );
}

/**
 * Resume for a known place. Drawn at once from what the device stored (the lecture, the page, the title it had); the
 * lecture view then adds the identity of the page and the file of the picture, and the draft kept for it.
 */
export function ResumeBlock({ place, courseName }: { place: StudyPlace; courseName: string | null }) {
  const { lecture, loading } = useResumeLecture(place.courseId, place.lectureId);
  const drafts = useTutorDraftCount(place.courseId, place.lectureId);
  const pdfUrl = lecture?.display.content ? contentUrl(lecture.display.content) : null;
  const { thumb, state } = usePagePicture(pdfUrl, place.page, PICTURE_WIDTH, true);
  const firstShape = useFirstPageShape(pdfUrl);
  const identity = lecture ? identityOf(lecture, place.page) : null;
  // A page the file no longer has is named by its number alone; the lecture explains it when opened.
  const identityParts = identity && !identity.outOfRange ? identity.parts : [pdfPageLabel(place.page, null)];
  const base = `/courses/${encodeURIComponent(place.courseId)}/lectures/${encodeURIComponent(place.lectureId)}`;
  return (
    <ResumeView courseName={courseName} heading={lectureHeading(place.lectureId, lecture?.title ?? place.title)}
      sentence={stoppedSentence({ identityParts, positionMs: place.positionMs, origin: place.origin, at: place.at })} draft={draftSentence(drafts)}
      resumeHref={`${base}?page=${place.page}`} startHref={place.page > 1 ? `${base}?page=1` : null}
      picture={thumb} shape={thumb?.aspect ?? firstShape} pictureLoading={(!lecture && loading) || state === "loading"} />
  );
}

/** Nothing was opened on this device: one sentence, no box. The device knows this itself, so it is said in the first frame. */
export function ResumeFirstRun() {
  return <p className="mt-3 max-w-[64ch] text-read text-muted" data-testid="continue-studying">{STUDY_FIRST_RUN}</p>;
}
