// Which page of a course an address is, and where the header's "Concept map" tool leads from it. Pure rules, used by
// the shell (web/tests/lib/course-route.test.ts). Segments are kept as the address has them (still percent-encoded).

export interface CourseRoute {
  courseId: string;
  /** The part after the course: "lectures", "questions", "sources", "concepts", "outline"; null on the course's own page. */
  section: string | null;
  /** The one thing of that section the address names (a lecture, a question, a source, a concept), or null. */
  item: string | null;
  lectureId: string | null;
  /** The concept map itself (the explorer), not one concept's page. */
  conceptMap: boolean;
  /** A lecture and the concept map fill the window; every other page scrolls inside the main area. */
  workspace: boolean;
}

const COURSE_ROUTE = /^[/]courses[/]([^/]+)(?:[/]([^/]+))?(?:[/]([^/]+))?/;

export function parseCourseRoute(pathname: string): CourseRoute | null {
  const match = COURSE_ROUTE.exec(pathname);
  if (!match) return null;
  const [, courseId, section = null, item = null] = match;
  const lectureId = section === "lectures" ? item : null;
  const conceptMap = !item && (section === "concepts" || section === "outline");
  return { courseId: courseId!, section, item, lectureId, conceptMap, workspace: !!lectureId || conceptMap };
}

export interface ConceptMapEntry {
  href: string;
  /** From a lecture: the way back, with the page, range and tab the address carries. Elsewhere the browser's Back and the path return. */
  state: { returnTo: string; returnLabel: string } | null;
}

/**
 * The "Concept map" tool of the header (UI contract R2-C: in every course header). From a lecture it opens the map at
 * that lecture's scope; from any other page of a course at the course's. Not offered on the map itself or outside a course.
 */
export function conceptMapEntry(pathname: string, search = ""): ConceptMapEntry | null {
  const route = parseCourseRoute(pathname);
  if (!route || route.conceptMap) return null;
  const base = `/courses/${route.courseId}/concepts`;
  if (!route.lectureId) return { href: base, state: null };
  let lecture = route.lectureId;
  try {
    lecture = decodeURIComponent(route.lectureId);
  } catch {
    /* an address that is not valid percent-encoding is passed on as it is */
  }
  return { href: `${base}?scope=${encodeURIComponent(`lecture:${lecture}`)}`, state: { returnTo: pathname + search, returnLabel: "Back to the lecture" } };
}
