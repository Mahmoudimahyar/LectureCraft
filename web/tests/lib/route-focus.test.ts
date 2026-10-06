// Where keyboard focus goes when the page under it changes (web/src/lib/route-focus.ts). Rendered in jsdom: the
// rules only; that a real browser follows them is looked at in the preview.
import { afterEach, describe, expect, it } from "vitest";
import { findAgain, focusIsLost, inOverlay, pageHeading, rememberFocus, settleRouteFocus } from "@/lib/route-focus";

function page(html: string): HTMLElement {
  document.body.innerHTML = `<header><a href="/study" id="brand">Lecture Learning</a><button id="search">Search</button></header><main id="main" tabindex="-1">${html}</main>`;
  return document.getElementById("main")!;
}
afterEach(() => { document.body.innerHTML = ""; });

describe("pageHeading", () => {
  it("is the page's first heading, made focusable without joining the tab order", () => {
    const main = page("<h1>Review</h1><button>Start</button>");
    const heading = pageHeading(main);
    expect(heading.tagName).toBe("H1");
    expect(heading.getAttribute("tabindex")).toBe("-1");
  });

  it("is the main area itself when the page has no heading (a workspace), or only a hidden one", () => {
    expect(pageHeading(page("<button>Next page</button>")).id).toBe("main");
    expect(pageHeading(page("<div hidden><h1>Old</h1></div><button>Go</button>")).id).toBe("main");
    expect(pageHeading(page("<div inert><h1>Parked</h1></div>")).id).toBe("main");
  });

  it("leaves a heading's own tabindex alone", () => {
    const main = page('<h1 tabindex="0">Study</h1>');
    expect(pageHeading(main).getAttribute("tabindex")).toBe("0");
  });
});

describe("focusIsLost", () => {
  it("is true on the body and false on a control", () => {
    const main = page("<button>Start</button>");
    (document.activeElement as HTMLElement | null)?.blur();
    expect(focusIsLost()).toBe(true);
    main.querySelector("button")!.focus();
    expect(focusIsLost()).toBe(false);
  });
});

describe("inOverlay", () => {
  it("is true inside a dialog, a menu or a list of options, wherever they are drawn", () => {
    page("");
    document.body.insertAdjacentHTML("beforeend", '<div role="dialog"><input id="d" /></div><div role="menu"><button id="m" role="menuitem">Light</button></div><div role="listbox"><div id="o" role="option" tabindex="0">One</div></div>');
    for (const id of ["d", "m", "o"]) expect(inOverlay(document.getElementById(id)), id).toBe(true);
    expect(inOverlay(document.getElementById("search"))).toBe(false);
    expect(inOverlay(null)).toBe(false);
  });
});

describe("settleRouteFocus (after the address changed to another page)", () => {
  it("moves focus from the body to the page heading", () => {
    const main = page("<h1>Review</h1><button>Start</button>");
    expect(settleRouteFocus(main)).toBe("moved");
    expect(document.activeElement?.tagName).toBe("H1");
  });

  it("moves focus off a control that stayed outside the page (the rail, the header)", () => {
    const main = page("<h1>Progress</h1>");
    document.getElementById("search")!.focus();
    expect(settleRouteFocus(main)).toBe("moved");
    expect(document.activeElement?.tagName).toBe("H1");
  });

  it("goes to the main area while the page has no heading yet, and to the heading once it is there", () => {
    const main = page("<p>Loading…</p>");
    expect(settleRouteFocus(main)).toBe("waiting");
    expect(document.activeElement).toBe(main);
    main.innerHTML = "<h1>Question bank</h1><a href='#'>Question 1</a>";
    expect(settleRouteFocus(main)).toBe("moved");
    expect(document.activeElement?.tagName).toBe("H1");
    // Settled: asking again changes nothing.
    expect(settleRouteFocus(main)).toBe("kept");
  });

  it("leaves focus where the page itself put it", () => {
    const main = page('<h1>Question</h1><textarea id="answer"></textarea>');
    document.getElementById("answer")!.focus();
    expect(settleRouteFocus(main)).toBe("kept");
    expect(document.activeElement?.id).toBe("answer");
  });

  it("leaves focus on the page's own name in the header (the picker that was just used to choose it)", () => {
    const main = page("<h1>Lecture 2</h1>");
    document.querySelector("header")!.insertAdjacentHTML("beforeend", '<nav id="path"><button id="picker">Lecture: Lecture 2</button></nav>');
    const path = document.getElementById("path");
    document.getElementById("picker")!.focus();
    expect(settleRouteFocus(main, document, path)).toBe("kept");
    expect(document.activeElement?.id).toBe("picker");
    // Any other control of the header is not the page's name.
    document.getElementById("search")!.focus();
    expect(settleRouteFocus(main, document, path)).toBe("moved");
    expect(document.activeElement?.tagName).toBe("H1");
  });

  it("waits while a dialog or a menu still holds focus", () => {
    const main = page("<h1>Lecture</h1>");
    document.body.insertAdjacentHTML("beforeend", '<div role="dialog"><a href="#" id="result">A result</a></div>');
    document.getElementById("result")!.focus();
    expect(settleRouteFocus(main)).toBe("waiting");
    expect(document.activeElement?.id).toBe("result");
  });
});

describe("rememberFocus and findAgain (a control that a re-render replaced)", () => {
  it("finds the control again by its id", () => {
    const main = page('<button id="next">Next page</button>');
    const memo = rememberFocus(document.getElementById("next")!);
    main.innerHTML = '<button id="next">Next page</button>';
    expect(memo.element.isConnected).toBe(false);
    expect(findAgain(main, memo)?.id).toBe("next");
  });

  it("finds the same control of the same node of a drawing (data-id), not its neighbour", () => {
    const drawing = (): string => ['topic.a', 'concept."b"'].map((id) => `<div class="node" data-id='${id}'><button>Open ${id}</button><button>Show more of ${id}</button></div>`).join("");
    const main = page(drawing());
    const second = main.querySelectorAll("button")[3]!;
    const memo = rememberFocus(second);
    expect(memo.nodeId).toBe('concept."b"');
    main.innerHTML = drawing();
    expect(findAgain(main, memo)?.textContent).toBe('Show more of concept."b"');
    // The node came back with fewer controls: its first one.
    main.innerHTML = `<div class="node" data-id='concept."b"'><button>Open</button></div>`;
    expect(findAgain(main, memo)?.textContent).toBe("Open");
    // A node that is itself the control.
    main.innerHTML = `<div class="node" data-id='concept."b"' tabindex="0">Node</div>`;
    expect(findAgain(main, memo)?.textContent).toBe("Node");
  });

  it("answers null when nothing identifies the control, when it is gone, or when it came back hidden", () => {
    const main = page("<button>Reject</button>");
    const plain = rememberFocus(main.querySelector("button")!);
    main.innerHTML = "<button>Reject</button>";
    expect(findAgain(main, plain)).toBeNull();

    main.innerHTML = '<div data-id="n1"><button>Open</button></div>';
    const memo = rememberFocus(main.querySelector("button")!);
    main.innerHTML = '<div data-id="n2"><button>Open</button></div>';
    expect(findAgain(main, memo)).toBeNull();
    main.innerHTML = '<div hidden><div data-id="n1"><button>Open</button></div></div>';
    expect(findAgain(main, memo)).toBeNull();
  });
});
