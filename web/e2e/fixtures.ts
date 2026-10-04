// Every browser test fails if the page logged an error, threw, or the Brain returned a 5xx —
// unless the test deliberately declares the outage it is exercising.
import { test as base, expect } from "@playwright/test";
import { watchProblems } from "./helpers";

interface Extras {
  problems: { problems: string[]; allow: (pattern: RegExp) => void };
  /** Text that is unique to this project and run, so repeated runs never collide on a stable request id. */
  unique: (text: string) => string;
}

export const test = base.extend<Extras>({
  problems: [async ({ page }, use) => {
    const watched = watchProblems(page);
    const allowed: RegExp[] = [];
    await use({ problems: watched.problems, allow: (pattern) => void allowed.push(pattern) });
    const unexpected = watched.problems.filter((p) => !allowed.some((a) => a.test(p)));
    expect(unexpected, "console errors, page errors or server failures during the test").toEqual([]);
  }, { auto: true }],
  unique: async ({}, use, testInfo) => {
    const tag = `${testInfo.project.name}-${Date.now().toString(36)}`;
    await use((text) => `${text} [${tag}]`);
  },
});

export { expect };
