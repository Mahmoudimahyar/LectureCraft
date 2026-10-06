// Shared UI primitives (design specification 8.1). Accessible behaviour comes from Radix (dialog focus trap and
// return, tabs with roving focus, toggle groups, accordions); these wrappers add the app's look through the classes
// of src/styles.css, so a link or a router element can wear the same class as the component. Components are written
// here in the shadcn composition style on top of the `radix-ui` package: no template or registry copy.
import { forwardRef, useRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { Accordion as RAccordion, Dialog as RDialog, Tabs as RTabs, ToggleGroup as RToggleGroup } from "radix-ui";
import { Check, ChevronDown, ChevronRight, Flag, Loader2, Minus, X } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { R2_ACTION } from "@/lib/labels";
import { ErrorGlyph, StaleGlyph } from "./glyphs";

// The names of the type scale and of the radii by role are this app's own (src/styles.css, @theme). Without them the
// merger takes `text-ui` for a colour and drops it beside `text-muted`. Always merge classes through `cn`.
const merge = extendTailwindMerge({
  extend: { theme: { text: ["micro", "meta", "ui", "read", "head", "title", "display"], radius: ["thumb", "row", "control", "region", "ll"] } },
});
export const cn = (...inputs: ClassValue[]) => merge(clsx(inputs));

// ---- buttons ---------------------------------------------------------------------------------------------------------
type ButtonVariant = "default" | "primary" | "quiet";
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `default`: a neutral pad. `primary`: the accent fill, one per view. `quiet`: bare, for a secondary action. */
  variant?: ButtonVariant;
  /** 40 px (`md`), 36 (`sm`), 44 (`lg`), 28 (`xs`, for Accept and Reject in a line of text). */
  size?: "md" | "sm" | "lg" | "xs";
  /** The action is in progress: the label names it, the button cannot be pressed again and keeps its fill. */
  busy?: boolean;
}
const BUTTON_SIZE = { md: "", sm: "ll-btn-sm", lg: "ll-btn-lg", xs: "ll-btn-xs" } as const;
/**
 * A button. Disabled is drawn without the pad and without the weight (never by opacity); say why in a sentence beside it.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "default", size = "md", busy, className, children, disabled, type = "button", ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={cn("ll-btn", variant === "primary" && "ll-btn-primary", variant === "quiet" && "ll-btn-quiet", BUTTON_SIZE[size], className)}
      disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy && <Loader2 aria-hidden className="animate-spin" />}
      {children}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The accessible name, and the tooltip. */
  label: string;
  variant?: ButtonVariant;
  /** 36 px square (`md`), 28 (`sm`), 44 (`lg`). */
  size?: "md" | "sm" | "lg";
  busy?: boolean;
}
const ICON_BUTTON_SIZE = { md: "", sm: "ll-ib-sm", lg: "ll-ib-lg" } as const;
/** A bare square button holding one icon. `aria-pressed` draws it as on (tint, accent text, a 1.5 px ring). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, variant = "default", size = "md", busy, className, children, disabled, type = "button", ...rest }, ref) {
  return (
    <button ref={ref} type={type} aria-label={label} title={label} className={cn("ll-ib", variant === "primary" && "ll-ib-primary", ICON_BUTTON_SIZE[size], className)}
      disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <Loader2 aria-hidden className="animate-spin" /> : children}
    </button>
  );
});

interface ToolbarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** A leading icon, drawn at 18 px. */
  icon?: ReactNode;
  /** A trailing chevron, for a button that opens a menu or a list. */
  chevron?: boolean;
  /** 36 px (`md`), 28 (`sm`, inside the range line). */
  size?: "md" | "sm";
}
/** A bare text button of a toolbar or a band: Find, Next content, Note, Fit page, the lecture picker, Whole recording. */
export const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(function ToolbarButton({ icon, chevron, size = "md", className, children, type = "button", ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={cn("ll-tbtn", size === "sm" && "ll-tbtn-sm", className)} {...rest}>
      {icon}
      <span>{children}</span>
      {chevron && <ChevronDown aria-hidden />}
    </button>
  );
});

// ---- status of a job (always a glyph and words, never colour alone, never a pill) --------------------------------------
export type Tone = "neutral" | "accent" | "success" | "caution" | "danger" | "unassessed";
const TONE_TEXT: Record<Tone, string> = { neutral: "text-muted", accent: "text-accent-text", success: "text-success", caution: "text-caution", danger: "text-danger", unassessed: "text-unassessed" };
// None of these is a ring (rings are evidence states), and only an error is a triangle.
const TONE_ICON = { neutral: Minus, accent: ChevronRight, success: Check, caution: Flag, unassessed: Minus } as const;
function ToneGlyph({ tone, className }: { tone: Tone; className?: string }) {
  if (tone === "danger") return <ErrorGlyph className={className} />;
  const Icon = TONE_ICON[tone];
  return <Icon aria-hidden className={cn("shrink-0", TONE_TEXT[tone], className)} />;
}

/**
 * The state of a job or of a connection on Activity and Settings: a glyph in the tone's colour and neutral words.
 * Evidence states use `StateLabel` and the basis of a link `BasisLabel` (components/labels.tsx), never this.
 */
export function StatusChip({ tone = "neutral", children, icon, title }: { tone?: Tone; children: ReactNode; icon?: ReactNode; title?: string }) {
  return (
    <span className="ll-chip" title={title}>
      {icon ?? <ToneGlyph tone={tone} className="size-4" />}
      <span>{children}</span>
    </span>
  );
}

/**
 * A note in the flow of a page: a glyph, a title, a sentence and its actions on a pad. Only an error that blocks the
 * page (tone "danger") keeps a coloured edge.
 */
export function Callout({ tone = "neutral", title, children, role, className, actions }: { tone?: Tone; title?: string; children?: ReactNode; role?: "status" | "alert" | "note"; className?: string; actions?: ReactNode }) {
  return (
    <div role={role ?? "note"} className={cn("flex gap-3 rounded-control bg-pad p-3", tone === "danger" && "border-l-[3px] border-l-danger", className)}>
      <ToneGlyph tone={tone} className="mt-0.5 size-5" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-ui text-muted [&_strong]:text-ink">{children}</div>}
        {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

// ---- skeleton, loading, empty, error, stale --------------------------------------------------------------------------------
/** A flat block standing for something not drawn yet. It does not pulse. Size it with a class or with `width` and `height`. */
export function Skeleton({ className, width, height, style }: { className?: string; width?: CSSProperties["width"]; height?: CSSProperties["height"]; style?: CSSProperties }) {
  return <span aria-hidden className={cn("ll-sk", className)} style={{ width, height, ...style }} />;
}

/** Loading: quiet blocks in the shape of a heading and three lines. The label is read out and is not drawn. */
export function LoadingState({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("flex w-full max-w-[34rem] flex-col gap-2 p-4", className)}>
      <span className="sr-only">{label}</span>
      <Skeleton height={18} width="50%" className="mb-1.5" />
      <Skeleton height={14} width="90%" />
      <Skeleton height={14} width="82%" />
      <Skeleton height={14} width="60%" />
    </div>
  );
}

/** Empty: a heading and one sentence that names the next action. No box, no picture. */
export function EmptyState({ title, children, action, className }: { title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-start gap-1 py-4", className)}>
      <h3 className="text-head font-semibold">{title}</h3>
      {children && <div className="ll-measure text-ui text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * Error: the triangle, what failed, what still works, one action. `title` says what failed; `stillWorks` what the
 * learner can go on doing.
 */
export function ErrorState({ error, retry, title = "This could not be loaded", stillWorks, className }: { error: Error | null; retry?: () => void; title?: string; stillWorks?: ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-1 py-4", className)}>
      <p className="ll-err"><ErrorGlyph /><span>{title}</span></p>
      <p className="ll-measure text-ui text-muted">{error?.message ?? "Unknown problem"}</p>
      {stillWorks && <p className="ll-measure text-ui text-muted">{stillWorks}</p>}
      {retry && <Button size="sm" className="mt-2" onClick={retry}>Try again</Button>}
    </div>
  );
}

/**
 * The stale notice: one line as the first element of a view that is older than its inputs, with the link that
 * refetches it. The view keeps showing its content; nothing is refreshed silently.
 */
export function StaleNotice({ children, onRefresh, actionLabel = R2_ACTION.refresh, className }: { children: ReactNode; onRefresh?: () => void; actionLabel?: string; className?: string }) {
  return (
    <p role="status" className={cn("ll-stale", className)}>
      <StaleGlyph />
      <span>{children}</span>
      {onRefresh && <button type="button" className="ll-link" onClick={onRefresh}>{actionLabel}</button>}
    </p>
  );
}

// ---- segmented choice ---------------------------------------------------------------------------------
/**
 * One choice of a few: a pad track, the chosen segment drawn with the selection idiom (tint, accent text, a 1.5 px
 * ring). Arrow keys move. Never placed directly under a tab row.
 */
export function Segmented<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (value: T) => void; options: Array<{ value: T; label: string; icon?: ReactNode }>; label: string; className?: string }) {
  return (
    <RToggleGroup.Root type="single" value={value} onValueChange={(v) => v && onChange(v as T)} aria-label={label} className={cn("ll-seg", className)}>
      {options.map((option) => (
        <RToggleGroup.Item key={option.value} value={option.value} className="ll-seg-item">
          {option.icon}
          {option.label}
        </RToggleGroup.Item>
      ))}
    </RToggleGroup.Root>
  );
}

// ---- tabs -----------------------------------------------------------------------------------------------
export const Tabs = RTabs.Root;
/** A row of text tabs over a hairline. In a band the caller sets the height; alone a tab is 44 px high. */
export function TabList({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return (
    <RTabs.List aria-label={label} className={cn("ll-tabs border-b border-hairline", className)}>
      {children}
    </RTabs.List>
  );
}
/** One text tab. `count` is a muted figure after the label and is part of the tab's name; leave it out when there is nothing to count. */
export function Tab({ value, children, count, className }: { value: string; children: ReactNode; count?: number | null; className?: string }) {
  return (
    <RTabs.Trigger value={value} className={cn("ll-tab", className)}>
      <span>{children}</span>
      {typeof count === "number" && <>{" "}<span className="ll-tab-n">{count}</span></>}
    </RTabs.Trigger>
  );
}
export const TabPanel = RTabs.Content;

// ---- a section heading that opens -----------------------------------------------------------------------------
interface SectionToggleProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The number of rows the heading heads, as a muted figure; left out when null. */
  count?: number | null;
}
/**
 * The heading of a section that opens: a chevron, the name at heading size and a muted count. Alone it is a button
 * with `aria-expanded`; inside `Sections` Radix supplies the state.
 */
export const SectionToggle = forwardRef<HTMLButtonElement, SectionToggleProps>(function SectionToggle({ count, className, children, type = "button", ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={cn("ll-sec", className)} {...rest}>
      <ChevronRight aria-hidden />
      <span className="min-w-0">{children}</span>
      {typeof count === "number" && <>{" "}<span className="ll-sec-n">{count}</span></>}
    </button>
  );
});
/** Stacked sections in one scroll (Radix Accordion); several may be open. `value` lists the open ones. */
export function Sections({ children, value, defaultValue, onValueChange, className }: { children: ReactNode; value?: string[]; defaultValue?: string[]; onValueChange?: (open: string[]) => void; className?: string }) {
  return <RAccordion.Root type="multiple" value={value} defaultValue={defaultValue} onValueChange={onValueChange} className={className}>{children}</RAccordion.Root>;
}
/** One section of `Sections`: its heading (a level-3 heading unless `level` says otherwise) and what it holds. */
export function Section({ value, title, count, children, level = 3, className }: { value: string; title: ReactNode; count?: number | null; children: ReactNode; level?: 2 | 3 | 4; className?: string }) {
  const Heading = `h${level}` as "h2" | "h3" | "h4";
  return (
    <RAccordion.Item value={value} className={cn("border-b border-hairline last:border-b-0", className)}>
      <RAccordion.Header asChild>
        <Heading>
          <RAccordion.Trigger asChild><SectionToggle count={count}>{title}</SectionToggle></RAccordion.Trigger>
        </Heading>
      </RAccordion.Header>
      <RAccordion.Content className="pb-3">{children}</RAccordion.Content>
    </RAccordion.Item>
  );
}

// ---- dialog / drawer -------------------------------------------------------------------------------------
interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  side?: "center" | "right";
  footer?: ReactNode;
  wide?: boolean;
}
/** Modal dialog or side drawer. Focus is trapped while open and returns to the invoking control on close. */
export function Dialog({ open, onOpenChange, title, description, children, side = "center", footer, wide }: DialogProps) {
  // These dialogs are opened by state, not by a Radix trigger, so remember the invoking control ourselves.
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) opener.current = typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null;
  wasOpen.current = open;
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-[var(--ll-scrim)]" />
        <RDialog.Content
          onCloseAutoFocus={(event) => {
            const target = opener.current;
            if (target && target.isConnected && target !== document.body) {
              event.preventDefault();
              target.focus();
            }
          }}
          className={cn("ll-pop fixed z-50 flex flex-col outline-none",
            side === "center" ? cn("left-1/2 top-1/2 max-h-[90dvh] w-[min(96vw,40rem)] -translate-x-1/2 -translate-y-1/2 rounded-region", wide && "w-[min(96vw,56rem)]")
              : "inset-y-0 right-0 w-full max-w-[34rem] rounded-none max-sm:max-w-none")}>
          <div className="flex items-start justify-between gap-3 border-b border-hairline py-3 pl-4 pr-3">
            <div className="min-w-0 py-1">
              <RDialog.Title className="text-head font-semibold">{title}</RDialog.Title>
              {description ? <RDialog.Description className="text-ui text-muted">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{title}</RDialog.Description>}
            </div>
            <RDialog.Close asChild>
              <IconButton label="Close"><X aria-hidden /></IconButton>
            </RDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-hairline p-4">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

// ---- safe rich text -----------------------------------------------------------------------------------------
const SAFE_URL = /^(https?:|mailto:|#)/i;
/** Restricted Markdown + KaTeX. Raw HTML is not rendered; only http(s)/mailto links survive and they open explicitly. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="ll-prose break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: "ignore", trust: false, throwOnError: false }]]}
        skipHtml
        urlTransform={(url) => (SAFE_URL.test(url) ? url : "")}
        components={{
          a: ({ href, children: linkChildren }) => (href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow">{linkChildren}</a> : <span>{linkChildren}</span>),
          img: ({ alt }) => <span className="text-muted">[image not shown: {alt || "no description"}]</span>,
        }}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-ui font-semibold">{label}</label>
      {children}
      {hint && <p className="text-ui text-muted">{hint}</p>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-display font-semibold tracking-[-0.015em]">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export const OUTCOME_LABEL: Record<string, { label: string; tone: Tone }> = {
  demonstrated: { label: "Demonstrated", tone: "success" },
  partial: { label: "Partly shown", tone: "caution" },
  not_demonstrated: { label: "Not shown in this response", tone: "danger" },
  not_observed: { label: "Not observed (not asked or not addressed)", tone: "unassessed" },
  uncertain: { label: "Uncertain", tone: "unassessed" },
};

// Times are formatted in lib/format.ts; re-exported here while callers move.
export { formatMs } from "@/lib/format";

export function formatWhen(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "time not recorded";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
