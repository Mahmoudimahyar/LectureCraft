// The stage's band (design specification 5.3): outline toggle, previous and next page, Next content, the identity line,
// the role of the page with its correction menu, then Note, the size menu, full screen and More.
//
// Previous and Next move one physical page and say so inside a group ("Next page: build 3 of 3"). Next content passes
// over the pages of which nothing is forced (title, section, administrative, blank). The identity line is composed by
// lib/r2 `identityOf` in the words of 9.2 and is the polite position announcement; it is never cut: what the band cannot
// hold leaves it in the order the specification gives and is offered in More, first by the band's width (900, 780, 640,
// 480 px) and then, when a long identity line still does not fit, one step further at a time. Only when nothing more can
// leave (a build with a printed slide number on a phone, say) does the line break, between two of its parts and never
// inside one, so that every part and the More button stay on screen.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { DropdownMenu } from "radix-ui";
import { Check, ChevronLeft, ChevronRight, Ellipsis, Maximize, Minimize, PanelLeftClose, PanelLeftOpen, Pencil, SkipForward } from "lucide-react";
import { BAND_CLASS, useWorkspaceFrame } from "@/app/WorkspaceFrame";
import { BasisGlyph, type BasisGlyphKind } from "@/components/glyphs";
import { cn, IconButton, ToolbarButton } from "@/components/ui";
import {
  GROUPING_NOT_ESTABLISHED, NBSP, NO_PPTX_MATCH_LABEL, R2_ACTION, ROLE_LABEL, copyOfOneSlideLabel, groupRowLabel, groupingLabel, nb, positionLabel, pptxMatchLabel, pptxSlideLabel, printedBasisLabel,
  printedSlideLabel, roleStateLabel,
} from "@/lib/labels";
import { identityOf, nextContentPage, type IdentityView } from "@/lib/r2";
import type { LectureView, SlideRole, SlideRoleValue } from "@/lib/types";
import type { PagerProps } from "./contracts";
import { FitMenu, FitMenuItems } from "./SlideCanvas";

/** The eight roles, in the order of 9.3: the five of which something is forced, then the three of which nothing is. */
export const ROLE_ORDER: readonly SlideRoleValue[] = ["instructional", "worked_example_or_question", "objectives_or_summary", "mixed", "unknown", "structural_title_or_section", "administrative", "blank"];
const MENU = "ll-pop z-50 max-h-[min(70dvh,36rem)] min-w-[15rem] max-w-[min(92vw,24rem)] overflow-y-auto p-1";
const MENU_LABEL = "px-3 pb-1 pt-2 text-ui text-muted";
const SEPARATOR = "my-1 h-px bg-hairline";

// ---- what the band holds (pure; web/tests/lib/lecture-source.test.ts) ------------------------------------------------------
/** Band widths under which something leaves the band, widest first (5.3). */
export const PAGER_STEPS = [900, 780, 640, 480] as const;
export type PagerLevel = 0 | 1 | 2 | 3 | 4;
/** One step past the last width step: nothing more can leave the band, so the identity line may break between its parts. Never reached by a width alone. */
export const PAGER_LAST_LEVEL = 5;
export interface PagerHolds {
  /** The words of how the role was established stand beside the role. */
  roleState: boolean;
  /** Note and the size menu are in the band (else in More). */
  noteAndFit: boolean;
  /** The role button is in the band (else its menu is in More). */
  role: boolean;
  /** Next content shows its words (else its icon only). */
  nextContentWords: boolean;
  /** Full screen is in the band (else in More). */
  fullScreen: boolean;
  /** The identity line is set at the control size. */
  smallIdentity: boolean;
  /** The identity line may break between two of its parts (never inside one); the band grows only if two lines are not enough. */
  wrapIdentity: boolean;
}
/** How many of the steps a band of this width is under. A width that is not known yet (0) holds everything. */
export function pagerLevelFor(width: number): PagerLevel {
  if (!(width > 0)) return 0;
  return PAGER_STEPS.filter((step) => width < step).length as PagerLevel;
}
/** What the band holds once `level` steps have been taken; each step keeps what the steps before it took out. */
export function pagerHolds(level: number): PagerHolds {
  return { roleState: level < 1, noteAndFit: level < 2, role: level < 3, nextContentWords: level < 4, fullScreen: level < 4, smallIdentity: level >= 4, wrapIdentity: level >= PAGER_LAST_LEVEL };
}

/** Width of the band (the menus live outside it, where a container query cannot reach). */
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

// ---- words -----------------------------------------------------------------------------------------------------------------
/** One part of the identity line with the figure that changes in semibold; the part never breaks inside. */
function IdentityPart({ text }: { text: string }) {
  const match = /^(\D*)(\d+)(.*)$/.exec(text);
  if (!match) return <span className="ll-nb">{nb(text)}</span>;
  return <span className="ll-nb">{nb(match[1]!)}<b className="font-semibold">{match[2]}</b>{nb(match[3]!)}</span>;
}

const roleBasis = (role: SlideRole): BasisGlyphKind => (role.state === "human_confirmed" ? "by_you" : role.state === "agent_reviewed" ? "checked" : "suggested");

/** Something a menu item opens (a dialog) starts once the menu has closed and focus is back on its button, so closing the dialog returns focus there and not to nothing. */
const afterMenu = (action: () => void): void => {
  window.setTimeout(action, 80); // the menu hands focus back on a timer of its own
};

/** In a group the paging controls say which member they go to. */
export function stepName(direction: "Previous" | "Next", current: IdentityView, target: IdentityView | null): string {
  const same = target && target.known && current.logicalSlideId !== null && target.logicalSlideId === current.logicalSlideId && target.position;
  return same ? `${direction} page: ${positionLabel(target.position!)}` : `${direction} page`;
}

/**
 * What is known about the page beyond its identity line, said on request (9.2): the grouping with its basis, state and
 * signals; a repeated page as a copy of one slide; how a printed number or a PowerPoint match is known; that no match is
 * recorded when the unit has a PowerPoint file. Nothing is said about what the Brain did not send.
 */
export function identityDetails(lecture: LectureView, page: number): string[] {
  const identity = identityOf(lecture, page);
  if (!identity.known) return [];
  const raw = lecture.slides.find((slide) => slide.page === page)?.identity;
  const lines: string[] = [];
  if (identity.groupPages.length > 1 && identity.logicalSlideKind) {
    const group = groupRowLabel(identity.logicalSlideKind, identity.groupPages, identity.grouping?.state ?? null);
    const how = identity.grouping ? groupingLabel(identity.grouping) : "";
    if (group) lines.push(how ? `${group}: ${how}` : group);
  }
  if (identity.position?.kind === "copy" && identity.position.ordinal > 1) lines.push(copyOfOneSlideLabel(identity.position));
  if (identity.groupingNote) lines.push(identity.groupingNote === GROUPING_NOT_ESTABLISHED ? "Grouping not established" : identity.groupingNote);
  if (raw?.printed_slide_number) lines.push(`${printedSlideLabel(raw.printed_slide_number.value)}: ${printedBasisLabel(raw.printed_slide_number.basis)}`);
  if (raw?.pptx) lines.push(`${pptxSlideLabel(raw.pptx.ordinal)}: ${pptxMatchLabel(raw.pptx)}`);
  else if (lecture.source_map?.state === "ready" && lecture.source_map.pptx) lines.push(`PowerPoint file: ${NO_PPTX_MATCH_LABEL.charAt(0).toLowerCase()}${NO_PPTX_MATCH_LABEL.slice(1)}`);
  return lines;
}

export function Pager({ lecture, page, total, onGoTo, onNote, fit, onFit, focus, onFocus, onFinishSession, readable, onReadable, onChooseAnotherFile, onCorrectPage, onSetRole, onTakeBackRole }: PagerProps) {
  const frame = useWorkspaceFrame();
  const band = useRef<HTMLDivElement>(null);
  const width = useWidth(band);
  const [roleBusy, setRoleBusy] = useState(false);
  const [extra, setExtra] = useState<{ key: string; level: number }>({ key: "", level: 0 });

  /** A page of a file is on screen (not the choice among files, not a file that cannot be displayed). */
  const paged = lecture.display.kind === "original_pdf" || lecture.display.kind === "rendition_pdf";
  const identity = identityOf(lecture, page);
  const role = paged ? lecture.slides.find((slide) => slide.page === page)?.role ?? null : null;
  const nextContent = paged ? nextContentPage(lecture, page) : null;
  const hasPrevious = paged && page > 1;
  const hasNext = paged && !!total && page < total;
  const previousName = stepName("Previous", identity, hasPrevious ? identityOf(lecture, page - 1) : null);
  const nextName = stepName("Next", identity, hasNext ? identityOf(lecture, page + 1) : null);
  const roleWords = role ? ROLE_LABEL[role.value] ?? String(role.value).replace(/_/g, " ") : "";
  const details = paged ? identityDetails(lecture, page) : [];

  // First the steps of the band's width; then, while the row is still wider than the band, one more step at a time.
  // Whatever changes what the row holds starts the count again from the width's own level.
  const key = [width, identity.label, roleWords, role ? roleStateLabel(role) : "", !!onNote, frame.arrangement, paged].join("|");
  const base = pagerLevelFor(width);
  const level = Math.min(PAGER_LAST_LEVEL, Math.max(base, extra.key === key ? extra.level : 0));
  useLayoutEffect(() => {
    const node = band.current;
    if (!node || node.clientWidth <= 0) return;
    if (level < PAGER_LAST_LEVEL && node.scrollWidth > node.clientWidth + 1) setExtra({ key, level: level + 1 });
  }, [key, level]);
  const holds = pagerHolds(level);

  const setRole = async (value: SlideRoleValue) => {
    if (!onSetRole || roleBusy) return;
    setRoleBusy(true);
    try {
      await onSetRole(value);
    } finally {
      setRoleBusy(false);
    }
  };
  const takeBackRole = async () => {
    if (!onTakeBackRole || roleBusy) return;
    setRoleBusy(true);
    try {
      await onTakeBackRole();
    } finally {
      setRoleBusy(false);
    }
  };

  const roleItems = (current: SlideRole): ReactNode => (
    <>
      <DropdownMenu.Label className="px-3 pb-1 pt-2 text-ui"><b className="font-semibold">Role of this page</b> <span className="text-muted"><span aria-hidden className="mx-0.5">·</span> {roleStateLabel(current)}</span></DropdownMenu.Label>
      <DropdownMenu.RadioGroup value={current.value} onValueChange={(value) => void setRole(value as SlideRoleValue)} aria-label="Role of this page">
        {ROLE_ORDER.map((value) => (
          <DropdownMenu.RadioItem key={value} value={value} disabled={!onSetRole || roleBusy} className="ll-menu-item justify-between">
            {ROLE_LABEL[value]}
            <DropdownMenu.ItemIndicator><Check aria-hidden className="size-4" /></DropdownMenu.ItemIndicator>
          </DropdownMenu.RadioItem>
        ))}
      </DropdownMenu.RadioGroup>
      {onSetRole && current.state !== "human_confirmed" && (
        <>
          <DropdownMenu.Separator className={SEPARATOR} />
          <DropdownMenu.Item className="ll-menu-item" disabled={roleBusy} onSelect={() => void setRole(current.value)}>This is right</DropdownMenu.Item>
        </>
      )}
      {onTakeBackRole && current.state === "human_confirmed" && (
        <>
          <DropdownMenu.Separator className={SEPARATOR} />
          <DropdownMenu.Item className="ll-menu-item" disabled={roleBusy} onSelect={() => void takeBackRole()}>{R2_ACTION.take_back} your correction</DropdownMenu.Item>
        </>
      )}
      {!onSetRole && <p className="px-3 pb-2 text-ui text-muted">The role cannot be corrected here: this file has no source map yet.</p>}
      {current.basis.length > 0 && (
        <>
          <DropdownMenu.Separator className={SEPARATOR} />
          <DropdownMenu.Label className={MENU_LABEL}>How it was established</DropdownMenu.Label>
          <ul className="px-3 pb-2 text-ui">{current.basis.map((line, index) => <li key={index} className="break-words">{line}</li>)}</ul>
        </>
      )}
      {details.length > 0 && (
        <>
          <DropdownMenu.Separator className={SEPARATOR} />
          <DropdownMenu.Label className={MENU_LABEL}>About this page</DropdownMenu.Label>
          <ul className="flex flex-col gap-1 px-3 pb-2 text-ui" data-testid="identity-details">{details.map((line, index) => <li key={index} className="break-words">{line}</li>)}</ul>
        </>
      )}
    </>
  );

  const fullScreenName = focus ? "Leave full screen" : "Show the slide full screen";
  const nextContentName = nextContent === null ? `${R2_ACTION.next_content}: no further content page` : `${R2_ACTION.next_content}: the next page that is not a title, section, administrative or blank page`;
  return (
    <div ref={band} className={cn(BAND_CLASS, "min-w-0 gap-1 overflow-hidden pl-3 pr-2 max-[599px]:h-11 max-[599px]:px-1",
      holds.wrapIdentity && "h-auto min-h-[var(--ll-band-h,48px)] py-1 max-[599px]:h-auto max-[599px]:min-h-11")} data-testid="pager" data-level={level}>
      {frame.arrangement === "frame" && (
        <IconButton label={frame.outlineOpen ? "Hide the outline" : "Show the outline"} aria-pressed={frame.outlineOpen} onClick={frame.toggleOutline} data-testid="outline-toggle">
          {frame.outlineOpen ? <PanelLeftClose aria-hidden /> : <PanelLeftOpen aria-hidden />}
        </IconButton>
      )}
      <div className="flex flex-none" role="group" aria-label="Page">
        <IconButton label={previousName} onClick={() => onGoTo(page - 1)} disabled={!hasPrevious}><ChevronLeft aria-hidden /></IconButton>
        <IconButton label={nextName} onClick={() => onGoTo(page + 1)} disabled={!hasNext}><ChevronRight aria-hidden /></IconButton>
      </div>
      {/* Not `disabled`: it stays focusable so that its reason can be read. */}
      <ToolbarButton icon={<SkipForward aria-hidden />} onClick={() => nextContent !== null && onGoTo(nextContent)} aria-disabled={nextContent === null || undefined} aria-label={nextContentName}
        title={nextContent === null ? "No further content page" : holds.nextContentWords ? undefined : R2_ACTION.next_content} className={cn("flex-none", !holds.nextContentWords && "px-2 [&>span]:sr-only")}
        data-testid="next-content">
        {R2_ACTION.next_content}
      </ToolbarButton>
      <p className={cn("ll-num", holds.wrapIdentity ? "min-w-0 shrink text-ui leading-[1.125rem]" : "flex-none whitespace-nowrap", !holds.wrapIdentity && (holds.smallIdentity ? "ml-0 text-ui" : "ml-1 text-read max-[899px]:text-ui"))}
        aria-live="polite" data-testid="slide-position">
        {/* The separators are text, so the line reads and copies as "PDF page 23 of 91 · build 2 of 3". A dot stays with
            the part before it, so a line that has to break ends with the dot and the next begins with a part. */}
        {paged ? identity.parts.map((part, index) => (
          <span key={index}>
            {index > 0 && " "}
            <span className="ll-nb"><IdentityPart text={part} />{index < identity.parts.length - 1 && <>{NBSP}<span className="mx-0.5 text-muted">·</span></>}</span>
          </span>
        )) : <span className="text-muted">No page is on screen</span>}
      </p>
      {role && holds.role && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <ToolbarButton icon={<BasisGlyph basis={roleBasis(role)} />} chevron disabled={roleBusy} aria-label={`Role of this page: ${roleWords}, ${roleStateLabel(role)}. Correct it`}
              className="flex-none px-2 text-muted" data-testid="role-button">
              {roleWords}{holds.roleState && <span> <span aria-hidden className="mx-0.5">·</span> {roleStateLabel(role)}</span>}
            </ToolbarButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content align="start" sideOffset={6} className={MENU} data-testid="role-menu">{roleItems(role)}</DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
      <span className="min-w-0 flex-1" />
      {holds.noteAndFit && onNote && <ToolbarButton icon={<Pencil aria-hidden />} onClick={onNote} className="flex-none">Note</ToolbarButton>}
      {holds.noteAndFit && paged && <FitMenu fit={fit} onFit={onFit} />}
      {holds.fullScreen && (
        <IconButton label={fullScreenName} aria-pressed={focus} onClick={() => onFocus(!focus)}>{focus ? <Minimize aria-hidden /> : <Maximize aria-hidden />}</IconButton>
      )}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild><IconButton label="More: finish the session, readable text, this page"><Ellipsis aria-hidden /></IconButton></DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={6} className={MENU} data-testid="pager-more">
            {!holds.noteAndFit && onNote && <DropdownMenu.Item className="ll-menu-item" onSelect={() => afterMenu(onNote)}>Note</DropdownMenu.Item>}
            {!holds.fullScreen && <DropdownMenu.Item className="ll-menu-item" onSelect={() => onFocus(!focus)}>{fullScreenName}</DropdownMenu.Item>}
            {!holds.noteAndFit && paged && (
              <>
                <DropdownMenu.Separator className={SEPARATOR} />
                <DropdownMenu.Label className={MENU_LABEL}>Page size</DropdownMenu.Label>
                <FitMenuItems fit={fit} onFit={onFit} />
                <DropdownMenu.Separator className={SEPARATOR} />
              </>
            )}
            <DropdownMenu.Item className="ll-menu-item" onSelect={onFinishSession}>Finish the session</DropdownMenu.Item>
            {onReadable && <DropdownMenu.Item className="ll-menu-item" onSelect={() => onReadable(!readable)}>{readable ? "Hide readable text" : "Show readable text"}</DropdownMenu.Item>}
            {onChooseAnotherFile && <DropdownMenu.Item className="ll-menu-item" onSelect={onChooseAnotherFile}>Choose another file</DropdownMenu.Item>}
            {onCorrectPage && <DropdownMenu.Item className="ll-menu-item" onSelect={() => afterMenu(onCorrectPage)}>Correct the grouping of this page</DropdownMenu.Item>}
            {role && !holds.role && (
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
