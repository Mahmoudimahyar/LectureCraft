// Shared UI primitives. Accessible behaviour comes from Radix (dialog focus trap/return, tabs roving
// focus, toggle groups); these wrappers add the app's semantic tokens. Components are written here
// in the shadcn composition style on top of the `radix-ui` package — no template or registry copy.
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Dialog as RDialog, Tabs as RTabs, ToggleGroup as RToggleGroup } from "radix-ui";
import { AlertTriangle, CheckCircle2, CircleDashed, HelpCircle, Info, Loader2, X, XCircle } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

// ---- buttons ---------------------------------------------------------------------------------------
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "quiet";
  size?: "md" | "sm";
  busy?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "default", size = "md", busy, className, children, disabled, type = "button", ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={cn("ll-btn", variant === "primary" && "ll-btn-primary", variant === "quiet" && "ll-btn-quiet", size === "sm" && "ll-btn-sm", className)}
      disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(function IconButton({ label, className, children, ...rest }, ref) {
  return (
    <Button ref={ref} aria-label={label} title={label} className={cn("px-2 min-w-[44px]", className)} {...rest}>
      {children}
    </Button>
  );
});

// ---- status (always icon + words, never colour alone) -----------------------------------------------
export type Tone = "neutral" | "accent" | "success" | "caution" | "danger" | "unassessed";
const TONE_TEXT: Record<Tone, string> = { neutral: "text-ink", accent: "text-accent", success: "text-success", caution: "text-caution", danger: "text-danger", unassessed: "text-unassessed" };
const TONE_ICON = { neutral: Info, accent: Info, success: CheckCircle2, caution: AlertTriangle, danger: XCircle, unassessed: CircleDashed };

export function StatusChip({ tone = "neutral", children, icon, title }: { tone?: Tone; children: ReactNode; icon?: ReactNode; title?: string }) {
  const Icon = TONE_ICON[tone];
  return (
    <span className={cn("ll-chip font-medium", TONE_TEXT[tone])} title={title}>
      {icon ?? <Icon aria-hidden className="size-4 shrink-0" />}
      <span>{children}</span>
    </span>
  );
}

export function Callout({ tone = "neutral", title, children, role, className, actions }: { tone?: Tone; title?: string; children?: ReactNode; role?: "status" | "alert" | "note"; className?: string; actions?: ReactNode }) {
  const Icon = TONE_ICON[tone];
  return (
    <div role={role ?? "note"} className={cn("ll-card flex gap-3 p-3", tone !== "neutral" && "border-l-4", tone === "caution" && "border-l-caution", tone === "danger" && "border-l-danger",
      tone === "success" && "border-l-success", tone === "accent" && "border-l-accent", tone === "unassessed" && "border-l-unassessed", className)}>
      <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", TONE_TEXT[tone])} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-sm text-muted [&_strong]:text-ink">{children}</div>}
        {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 p-6 text-muted">
      <Loader2 aria-hidden className="size-5 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="ll-card flex flex-col items-start gap-2 p-6">
      <HelpCircle aria-hidden className="size-6 text-unassessed" />
      <h3 className="text-lg font-semibold">{title}</h3>
      {children && <div className="text-muted">{children}</div>}
      {action}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: Error | null; retry?: () => void }) {
  return (
    <Callout tone="danger" role="alert" title="This could not be loaded" actions={retry ? <Button size="sm" onClick={retry}>Try again</Button> : undefined}>
      {error?.message ?? "Unknown problem"}
    </Callout>
  );
}

// ---- segmented choice ---------------------------------------------------------------------------------
export function Segmented<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (value: T) => void; options: Array<{ value: T; label: string; icon?: ReactNode }>; label: string; className?: string }) {
  return (
    <RToggleGroup.Root type="single" value={value} onValueChange={(v) => v && onChange(v as T)} aria-label={label} className={cn("inline-flex flex-wrap gap-1 rounded-[var(--ll-radius)] bg-raised p-1", className)}>
      {options.map((option) => (
        <RToggleGroup.Item key={option.value} value={option.value}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-[calc(var(--ll-radius)-3px)] px-3 text-sm font-medium text-muted data-[state=on]:bg-surface data-[state=on]:text-accent data-[state=on]:shadow-sm data-[state=on]:font-semibold">
          {option.icon}
          {option.label}
        </RToggleGroup.Item>
      ))}
    </RToggleGroup.Root>
  );
}

// ---- tabs -----------------------------------------------------------------------------------------------
export const Tabs = RTabs.Root;
export function TabList({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return (
    <RTabs.List aria-label={label} className={cn("flex gap-1 border-b border-line/40", className)}>
      {children}
    </RTabs.List>
  );
}
export function Tab({ value, children }: { value: string; children: ReactNode }) {
  return (
    <RTabs.Trigger value={value} className="-mb-px min-h-[44px] border-b-2 border-transparent px-3 font-medium text-muted data-[state=active]:border-accent data-[state=active]:font-semibold data-[state=active]:text-accent">
      {children}
    </RTabs.Trigger>
  );
}
export const TabPanel = RTabs.Content;

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
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-black/45" />
        <RDialog.Content
          aria-describedby={description ? undefined : undefined}
          className={cn("fixed z-50 flex flex-col bg-surface text-ink shadow-2xl outline-none",
            side === "center" ? cn("left-1/2 top-1/2 max-h-[90dvh] w-[min(96vw,40rem)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--ll-radius)] border border-line/50", wide && "w-[min(96vw,56rem)]")
              : "inset-y-0 right-0 w-full max-w-[34rem] border-l border-line/50 max-sm:max-w-none")}>
          <div className="flex items-start justify-between gap-3 border-b border-line/40 p-4">
            <div className="min-w-0">
              <RDialog.Title className="text-lg font-semibold">{title}</RDialog.Title>
              {description ? <RDialog.Description className="text-sm text-muted">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{title}</RDialog.Description>}
            </div>
            <RDialog.Close asChild>
              <IconButton label="Close" variant="quiet"><X aria-hidden className="size-5" /></IconButton>
            </RDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line/40 p-4">{footer}</div>}
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
      <label htmlFor={htmlFor} className="font-medium">{label}</label>
      {children}
      {hint && <p className="text-sm text-muted">{hint}</p>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-muted">{subtitle}</p>}
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

export function formatMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function formatWhen(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "time not recorded";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
