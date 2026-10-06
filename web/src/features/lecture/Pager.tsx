// The stage's band (design specification 5.3): outline toggle, previous and next page, Next content, the identity line,
// the role of the page with its correction menu, then Note, Fit page, full screen and More. FIRST VERSION: the controls
// are real and wired; the look is the band of the specification.
//
// Previous and Next move one physical page and say so inside a group ("Next page: build 3 of 3"). The identity line is
// composed by lib/r2 `identityOf` and is the polite position announcement; it never wraps and is never cut. What the
// band cannot hold moves into More, in the order the specification gives.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DropdownMenu } from "radix-ui";
import { ChevronLeft, ChevronRight, Ellipsis, Maximize, Minimize, PanelLeftClose, PanelLeftOpen, Pencil, SkipForward } from "lucide-react";
import { BAND_CLASS, useWorkspaceFrame } from "@/app/WorkspaceFrame";
import { BasisGlyph, type BasisGlyphKind } from "@/components/glyphs";
import { cn, IconButton, ToolbarButton } from "@/components/ui";
import { R2_ACTION, ROLE_LABEL, nb, positionLabel, roleStateLabel } from "@/lib/labels";
import { identityOf, nextContentPage, type IdentityView } from "@/lib/r2";
import type { SlideRole, SlideRoleValue } from "@/lib/types";
import type { PagerProps, SlideFit } from "./contracts";

const ROLES: SlideRoleValue[] = ["instructional", "worked_example_or_question", "objectives_or_summary", "mixed", "unknown", "structural_title_or_section", "administrative", "blank"];
const FIT_LABEL: Record<SlideFit, string> = { page: "Fit page", width: "Fit width" };
const MENU = "ll-pop z-50 max-h-[min(70dvh,34rem)] min-w-[15rem] max-w-[min(92vw,24rem)] overflow-y-auto p-1";
const MENU_LABEL = "px-3 pb-1 pt-2 text-ui text-muted";
const SEPARATOR = "my-1 h-px bg-hairline";

/** Width of the band, so that what does not fit is offered in More (the menu lives outside the band, where a container query cannot reach). */
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const update = () => node.clientWidth > 0 && setWidth(node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** One part of the identity line with the figure that changes in semibold; the part never breaks inside. */
function IdentityPart({ text }: { text: string }) {
  const match = /^(\D*)(\d+)(.*)$/.exec(text);
  if (!match) return <span className="ll-nb">{nb(text)}</span>;
  return <span className="ll-nb">{nb(match[1]!)}<b className="font-semibold">{match[2]}</b>{nb(match[3]!)}</span>;
}

const roleBasis = (role: SlideRole): BasisGlyphKind => (role.state === "human_confirmed" ? "by_you" : role.state === "agent_reviewed" ? "checked" : "suggested");

/** In a group the paging controls say which member they go to. */
function stepName(direction: "Previous" | "Next", current: IdentityView, target: IdentityView | null): string {
  const same = target && target.known && current.logicalSlideId !== null && target.logicalSlideId === current.logicalSlideId && target.position;
  return same ? `${direction} page: ${positionLabel(target.position!)}` : `${direction} page`;
}

export function Pager({ lecture, page, total, onGoTo, onNote, fit, onFit, focus, onFocus, onFinishSession, readable, onReadable, onChooseAnotherFile, onCorrectPage, onSetRole }: PagerProps) {
  const frame = useWorkspaceFrame();
  const band = useRef<HTMLDivElement>(null);
  const width = useWidth(band);
  const [roleBusy, setRoleBusy] = useState(false);

  const identity = identityOf(lecture, page);
  const role = lecture.slides.find((slide) => slide.page === page)?.role ?? null;
  const nextContent = nextContentPage(lecture, page);
  const hasPrevious = page > 1;
  const hasNext = !!total && page < total;
  const previousName = stepName("Previous", identity, hasPrevious ? identityOf(lecture, page - 1) : null);
  const nextName = stepName("Next", identity, hasNext ? identityOf(lecture, page + 1) : null);

  // What the band holds at this width (5.3). Until the band has been measured everything is shown.
  const measured = width > 0;
  const showRoleState = !measured || width >= 900;
  const showNoteAndFit = !measured || width >= 780;
  const showRole = !measured || width >= 640;
  const showFullScreen = !measured || width >= 480;
  const nextContentWords = !measured || width >= 480;
  const smallIdentity = measured && width < 480;

  const setRole = async (value: SlideRoleValue) => {
    if (!onSetRole || roleBusy) return;
    setRoleBusy(true);
    try {
      await onSetRole(value);
    } finally {
      setRoleBusy(false);
    }
  };

  const roleItems = (current: SlideRole): ReactNode => (
    <>
      <DropdownMenu.Label className={MENU_LABEL}>Role of this page: {roleStateLabel(current)}</DropdownMenu.Label>
      <DropdownMenu.RadioGroup value={current.value} onValueChange={(value) => void setRole(value as SlideRoleValue)} aria-label="Role of this page">
        {ROLES.map((value) => <DropdownMenu.RadioItem key={value} value={value} disabled={!onSetRole || roleBusy} className="ll-menu-item">{ROLE_LABEL[value]}</DropdownMenu.RadioItem>)}
      </DropdownMenu.RadioGroup>
      {current.basis.length > 0 && (
        <>
          <DropdownMenu.Separator className={SEPARATOR} />
          <DropdownMenu.Label className={MENU_LABEL}>How it was established</DropdownMenu.Label>
          <ul className="px-3 pb-2 text-ui text-muted">{current.basis.map((line, index) => <li key={index} className="break-words">{line}</li>)}</ul>
        </>
      )}
      {onSetRole && current.state !== "human_confirmed" && (
        <>
          <DropdownMenu.Separator className={SEPARATOR} />
          <DropdownMenu.Item className="ll-menu-item" disabled={roleBusy} onSelect={() => void setRole(current.value)}>This is right</DropdownMenu.Item>
        </>
      )}
      {!onSetRole && <p className="px-3 pb-2 text-ui text-muted">The role cannot be corrected here: this deck has no source map yet.</p>}
    </>
  );

  return (
    <div ref={band} className={cn(BAND_CLASS, "min-w-0 gap-1 pl-3 pr-2 max-[599px]:h-11 max-[599px]:px-1")} data-testid="pager">
      {frame.arrangement === "frame" && (
        <IconButton label={frame.outlineOpen ? "Hide the outline" : "Show the outline"} aria-pressed={frame.outlineOpen} onClick={frame.toggleOutline} data-testid="outline-toggle">
          {frame.outlineOpen ? <PanelLeftClose aria-hidden /> : <PanelLeftOpen aria-hidden />}
        </IconButton>
      )}
      <div className="flex flex-none" role="group" aria-label="Page">
        <IconButton label={previousName} onClick={() => onGoTo(page - 1)} disabled={!hasPrevious}><ChevronLeft aria-hidden /></IconButton>
        <IconButton label={nextName} onClick={() => onGoTo(page + 1)} disabled={!hasNext}><ChevronRight aria-hidden /></IconButton>
      </div>
      <ToolbarButton icon={<SkipForward aria-hidden />} onClick={() => nextContent !== null && onGoTo(nextContent)} disabled={nextContent === null}
        aria-label={nextContent === null ? `${R2_ACTION.next_content}: no further content page` : `${R2_ACTION.next_content}: the next page that is not a title, section, administrative or blank page`}
        title={nextContent === null ? "No further content page" : undefined} className={cn("flex-none", !nextContentWords && "px-2 [&>span]:sr-only")}>
        {R2_ACTION.next_content}
      </ToolbarButton>
      <p className={cn("ll-num ml-1 flex-none whitespace-nowrap", smallIdentity ? "ml-0 text-ui" : "text-read max-[899px]:text-ui")} aria-live="polite" data-testid="slide-position">
        {total || identity.pageCount ? identity.parts.map((part, index) => (
          <span key={index}>{index > 0 && <span className="mx-1.5 text-muted" aria-hidden>·</span>}{index > 0 && <span className="sr-only">, </span>}<IdentityPart text={part} /></span>
        )) : "Page count unavailable"}
      </p>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {role && showRole && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <ToolbarButton icon={<BasisGlyph basis={roleBasis(role)} />} chevron aria-label={`Role of this page: ${ROLE_LABEL[role.value] ?? role.value}, ${roleStateLabel(role)}. Correct it`} className="min-w-0 flex-none px-2 text-muted" data-testid="role-button">
                {ROLE_LABEL[role.value] ?? role.value}{showRoleState && <span> <span aria-hidden className="mx-0.5">·</span> {roleStateLabel(role)}</span>}
              </ToolbarButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal><DropdownMenu.Content align="start" sideOffset={6} className={MENU}>{roleItems(role)}</DropdownMenu.Content></DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
        <span className="flex-1" />
        {showNoteAndFit && onNote && <ToolbarButton icon={<Pencil aria-hidden />} onClick={onNote} className="flex-none">Note</ToolbarButton>}
        {showNoteAndFit && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild><ToolbarButton chevron className="flex-none" aria-label={`Page size: ${FIT_LABEL[fit]}`}>{nb(FIT_LABEL[fit])}</ToolbarButton></DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={6} className={MENU}>
                <DropdownMenu.RadioGroup value={fit} onValueChange={(value) => onFit(value as SlideFit)} aria-label="Page size">
                  {(Object.keys(FIT_LABEL) as SlideFit[]).map((value) => <DropdownMenu.RadioItem key={value} value={value} className="ll-menu-item">{FIT_LABEL[value]}</DropdownMenu.RadioItem>)}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </div>
      {showFullScreen && (
        <IconButton label={focus ? "Leave full screen" : "Show the slide full screen"} aria-pressed={focus} onClick={() => onFocus(!focus)}>{focus ? <Minimize aria-hidden /> : <Maximize aria-hidden />}</IconButton>
      )}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild><IconButton label="More: finish the session, readable text, this page"><Ellipsis aria-hidden /></IconButton></DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={6} className={MENU}>
            {!showNoteAndFit && onNote && <DropdownMenu.Item className="ll-menu-item" onSelect={onNote}>Note</DropdownMenu.Item>}
            {!showNoteAndFit && (Object.keys(FIT_LABEL) as SlideFit[]).map((value) => (
              <DropdownMenu.CheckboxItem key={value} checked={fit === value} onCheckedChange={() => onFit(value)} className="ll-menu-item">{FIT_LABEL[value]}</DropdownMenu.CheckboxItem>
            ))}
            {!showFullScreen && <DropdownMenu.Item className="ll-menu-item" onSelect={() => onFocus(!focus)}>{focus ? "Leave full screen" : "Show the slide full screen"}</DropdownMenu.Item>}
            {(!showNoteAndFit || !showFullScreen) && <DropdownMenu.Separator className={SEPARATOR} />}
            <DropdownMenu.Item className="ll-menu-item" onSelect={onFinishSession}>Finish the session</DropdownMenu.Item>
            {onReadable && <DropdownMenu.Item className="ll-menu-item" onSelect={() => onReadable(!readable)}>{readable ? "Hide readable text" : "Show readable text"}</DropdownMenu.Item>}
            {onChooseAnotherFile && <DropdownMenu.Item className="ll-menu-item" onSelect={onChooseAnotherFile}>Choose another file</DropdownMenu.Item>}
            {onCorrectPage && <DropdownMenu.Item className="ll-menu-item" onSelect={onCorrectPage}>Correct the grouping of this page</DropdownMenu.Item>}
            {role && !showRole && (
              <>
                <DropdownMenu.Separator className={SEPARATOR} />
                {roleItems(role)}
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
