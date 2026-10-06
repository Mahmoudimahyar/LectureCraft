// Which page of a course an address is, and where the header's "Concept map" tool leads from it (UI contract R2,
// "Concepts": Concept map in every course header). Pure rules of web/src/lib/course-route.ts.
import { describe, expect, it } from "vitest";
import { conceptMapEntry, parseCourseRoute } from "@/lib/course-route";

describe("parseCourseRoute", () => {
  it("answers null outside a course", () => {
    for (const pathname of ["/", "/study", "/review", "/sources", "/settings/build", "/courses", "/courses/"]) expect(parseCourseRoute(pathname)).toBeNull();
  });

  it("names the course, the section and the item", () => {
    expect(parseCourseRoute("/courses/be505")).toEqual({ courseId: "be505", section: null, item: null, lectureId: null, conceptMap: false, workspace: false });
    expect(parseCourseRoute("/courses/be505/questions")).toMatchObject({ courseId: "be505", section: "questions", item: null, lectureId: null, workspace: false });
    expect(parseCourseRoute("/courses/be505/questions/BE505-L01-Q01")).toMatchObject({ section: "questions", item: "BE505-L01-Q01", lectureId: null, conceptMap: false, workspace: false });
    expect(parseCourseRoute("/courses/be505/sources/src-1")).toMatchObject({ section: "sources", item: "src-1", workspace: false });
  });

  it("knows the two workspaces: a lecture and the concept map", () => {
    expect(parseCourseRoute("/courses/be505/lectures/lecture-05")).toMatchObject({ lectureId: "lecture-05", conceptMap: false, workspace: true });
    expect(parseCourseRoute("/courses/be505/concepts")).toMatchObject({ lectureId: null, conceptMap: true, workspace: true });
    expect(parseCourseRoute("/courses/be505/outline")).toMatchObject({ conceptMap: true, workspace: true });
    // One concept's own page is an ordinary page, not the map.
    expect(parseCourseRoute("/courses/be505/concepts/concept%3Ablank")).toMatchObject({ section: "concepts", item: "concept%3Ablank", conceptMap: false, workspace: false });
    // "lectures" without a lecture is not a lecture.
    expect(parseCourseRoute("/courses/be505/lectures")).toMatchObject({ lectureId: null, workspace: false });
  });
});

describe("conceptMapEntry", () => {
  it("is offered on every page of a course", () => {
    for (const pathname of ["/courses/be505", "/courses/be505/questions", "/courses/be505/questions/BE505-L01-Q01", "/courses/be505/sources/src-1", "/courses/be505/concepts/concept%3Ablank"]) {
      expect(conceptMapEntry(pathname), pathname).toEqual({ href: "/courses/be505/concepts", state: null });
    }
  });

  it("opens the lecture's scope from a lecture and remembers the way back, with the page and the tab", () => {
    expect(conceptMapEntry("/courses/be505/lectures/lecture-05", "?page=5&panel=questions")).toEqual({
      href: "/courses/be505/concepts?scope=lecture%3Alecture-05",
      state: { returnTo: "/courses/be505/lectures/lecture-05?page=5&panel=questions", returnLabel: "Back to the lecture" },
    });
    expect(conceptMapEntry("/courses/be505/lectures/lecture-05")?.state?.returnTo).toBe("/courses/be505/lectures/lecture-05");
  });

  it("is not offered on the concept map itself, nor outside a course", () => {
    for (const pathname of ["/courses/be505/concepts", "/courses/be505/outline", "/study", "/review", "/progress", "/settings"]) expect(conceptMapEntry(pathname), pathname).toBeNull();
  });
});
