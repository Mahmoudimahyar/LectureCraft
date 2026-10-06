// Build identity as the learner can read it (R2-B1, R2-B2; design specification 4.2). The facts come from lib/build.ts:
// the build compiled into this page, and what the Brain says it is serving right now (`GET /api/health` → `build`).
// Nothing is guessed: a fact that was not established is said to be unknown.
//
//   <BuildIdentity variant="shell" />     ONE discreet line. In the rail: the build of this page (the commit) and nothing
//                                         under it; the profile and the port are in its title and name, and in full in
//                                         Settings. In the menu of a narrow window: commit · profile · port.
//   <BuildIdentity variant="settings" />  the same facts in full, as text that can be read and copied
//   <OlderPageLine />                     the one standing line of the shell: this page is older than the app being served
import { WEB_BUILD, bundleMatchesBrain, loadedAssets, pageMatchesServed, type ServedIdentity } from "@/lib/build";
import { R2_ACTION } from "@/lib/labels";
import { useServedIdentity } from "@/lib/queries";
import { cn } from "./ui";

/** The three facts of the discreet line, each as it is known. */
export function buildLine(served: ServedIdentity | null | undefined): { commit: string; profile: string | null; port: number | null; sentence: string } {
  const commit = WEB_BUILD.commit === "unknown" ? "build unknown" : `${WEB_BUILD.commit}${WEB_BUILD.dirty ? "+" : ""}`;
  const profile = served?.profile ?? null;
  const port = served?.port ?? null;
  const sentence = [
    WEB_BUILD.commit === "unknown" ? "The build of this page is not known" : `This page is build ${WEB_BUILD.commit}${WEB_BUILD.dirty ? ", built from a modified working tree" : ""}`,
    served ? `the Brain runs the ${served.profile} profile${served.port ? ` on port ${served.port}` : ""}` : "the Brain states no identity",
  ].join("; ") + ".";
  return { commit, profile, port, sentence };
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[11rem_minmax(0,1fr)] gap-3 border-t border-hairline py-2 first:border-t-0 max-[599px]:grid-cols-1 max-[599px]:gap-0">
      <dt className="text-ui text-muted">{term}</dt>
      <dd className="ll-num min-w-0 break-words text-read">{children}</dd>
    </div>
  );
}

const unknown = <span className="text-muted">not established</span>;

export function BuildIdentity({ variant, layout = "rail", className }: { variant: "shell" | "settings"; /** shell only: the commit alone (a rail 76 px wide) or commit · profile · port (a menu). Always one line. */ layout?: "rail" | "line"; className?: string }) {
  const served = useServedIdentity(true);
  const identity = served.data ?? null;
  const line = buildLine(identity);

  if (variant === "shell") {
    const parts = [line.commit, line.profile, line.port === null ? null : String(line.port)].filter((part): part is string => part !== null);
    return (
      <p className={cn("ll-num text-micro text-muted", layout === "rail" ? "max-w-full truncate text-center" : "", className)} title={line.sentence} aria-label={line.sentence} data-testid="build-line">
        {layout === "rail" ? line.commit : parts.join(" · ")}
      </p>
    );
  }

  const assets = loadedAssets();
  const page = pageMatchesServed(identity);
  const bundle = bundleMatchesBrain(identity);
  const courses = Object.entries(identity?.courses ?? {});
  return (
    <section aria-label="Build and data identity" className={cn("flex flex-col gap-4", className)} data-testid="build-identity">
      <dl>
        <Fact term="This page">
          {WEB_BUILD.commit === "unknown" ? unknown : <>commit {WEB_BUILD.commit}{WEB_BUILD.dirty === true ? ", built from a modified working tree" : WEB_BUILD.dirty === false ? ", clean working tree" : ""}</>}
          {WEB_BUILD.builtAt !== "unknown" && <>, built {WEB_BUILD.builtAt}</>}
        </Fact>
        <Fact term="Script files">{assets.script.length ? assets.script.join(", ") : unknown}</Fact>
        <Fact term="Style files">{assets.style.length ? assets.style.join(", ") : unknown}</Fact>
        <Fact term="Brain">
          {identity ? <>profile {identity.profile}{identity.port ? `, port ${identity.port}` : ""}, process {identity.pid}, started {identity.process_started_at}</> : served.isLoading ? "Asking the Brain…" : "The Brain states no identity (an older process, or it is not reachable)."}
        </Fact>
        {identity && <Fact term="Brain code">{identity.commit_short ? <>commit {identity.commit_short}{identity.branch ? ` on ${identity.branch}` : ""}{identity.dirty ? ", modified working tree" : ""}</> : unknown}</Fact>}
        {identity && (
          <Fact term="Page and server">
            {page === "same" ? "This page is the build the Brain serves now." : page === "different" ? "This page is older than the app now being served. Reload shows the newer build." : "Whether this page is the served build could not be compared."}
            {" "}
            {bundle === "same_commit" ? "The served app was built from the commit the Brain runs." : bundle === "modified_tree" ? "The served app was built from the Brain's commit with a modified working tree." : bundle === "other_commit" ? "The served app was built from another commit than the Brain runs." : ""}
          </Fact>
        )}
      </dl>
      {courses.length > 0 && (
        <dl aria-label="Preparation in use, by course">
          {courses.map(([courseId, course]) => {
            const maps = Object.entries(course.map_revisions ?? {}).flatMap(([deck, versions]) => versions.map((version) => `${deck}: ${version.map_revision ?? "no map"}${version.overrides_revision ? ` (corrections ${version.overrides_revision})` : ""}`));
            return (
              <Fact key={courseId} term={courseId}>
                preparation generation {course.preparation_generation ?? "none (nothing prepared yet)"}, {course.prepared_lectures} lecture{course.prepared_lectures === 1 ? "" : "s"} prepared
                {maps.length > 0 && <span className="block text-ui text-muted">Source-map revisions: {maps.join("; ")}</span>}
              </Fact>
            );
          })}
        </dl>
      )}
    </section>
  );
}

/** One line, shown only when this page does not belong to the build the Brain now serves (R2-B2). */
export function OlderPageLine({ className }: { className?: string }) {
  const served = useServedIdentity(true);
  if (pageMatchesServed(served.data ?? null) !== "different") return null;
  return (
    <p role="status" className={cn("flex flex-wrap items-center justify-center gap-x-3 bg-pad px-4 py-1.5 text-ui", className)} data-testid="older-page-line">
      <span>This page is older than the app now being served.</span>
      <button type="button" className="ll-link border-0 bg-transparent p-0 font-semibold" onClick={() => window.location.reload()}>{R2_ACTION.reload}</button>
    </p>
  );
}
