import { describe, expect, it } from "vitest";

describe("toolchain", () => {
  it("runs vitest with jsdom and IndexedDB", () => {
    expect(document.createElement("div")).toBeInstanceOf(HTMLElement);
    expect(typeof indexedDB.open).toBe("function");
  });
});
