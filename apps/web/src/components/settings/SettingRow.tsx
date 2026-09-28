import type { KeyboardEvent, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared building blocks for the reworked Settings page.
 *
 * The old page assembled every control by hand (raw divs, five different
 * "selectable card" implementations, collapsibles inside collapsibles). These
 * four primitives cover the whole surface so every section reads the same:
 *
 *   SettingGroup  — card with a header and divided rows
 *   SettingRow    — icon + title + description + control (or navigation)
 *   Segmented     — pill switcher for 2–6 short options
 *   OptionCard    — rich selectable card with a live preview slot
 */

/* ── SettingGroup ────────────────────────────────────────────────────────── */

interface SettingGroupProps {
  id?: string;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Draw separators between children (default). Turn off for custom content. */
  divided?: boolean;
  className?: string;
  children: ReactNode;
}

export const SettingGroup = ({ id, title, description, action, divided = true, className, children }: SettingGroupProps) => (
  <section
    id={id}
    className={cn(
      "scroll-mt-28 overflow-hidden rounded-2xl border border-border/60 bg-card/60",
      "shadow-[0_1px_2px_oklch(var(--foreground)/0.04),0_16px_40px_-24px_oklch(var(--foreground)/0.22)] backdrop-blur-xl",
      className,
    )}
  >
    {(title || action) && (
      <header className="flex items-start justify-between gap-3 border-b border-border/50 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          {title && <h2 className="text-sm font-semibold tracking-tight">{title}</h2>}
          {description && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
    )}
    <div className={cn(divided && "divide-y divide-border/50")}>{children}</div>
  </section>
);

/* ── SettingBlock ────────────────────────────────────────────────────────── */

/** Chrome for a titled block inside a `divided={false}` group: separator + padding. */
export const SETTING_BLOCK_CHROME = "border-t border-border/50 first:border-t-0";

interface SettingBlockProps {
  id?: string;
  title?: string;
  description?: string;
  icon?: LucideIcon;
  className?: string;
  children: ReactNode;
}

/**
 * A padded sub-block inside a group — used when a section needs its own
 * heading above a grid of `OptionCard`s or a custom control instead of the
 * one-row-one-control `SettingRow` shape.
 */
export const SettingBlock = ({ id, title, description, icon: Icon, className, children }: SettingBlockProps) => (
  <div id={id} className={cn(SETTING_BLOCK_CHROME, "scroll-mt-28 px-4 py-4 sm:px-5", className)}>
    {(title || description) && (
      <div className="mb-3 flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <div>
          {title && <h3 className="text-sm font-semibold">{title}</h3>}
          {description && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{description}</p>}
        </div>
      </div>
    )}
    {children}
  </div>
);

/* ── SettingRow ──────────────────────────────────────────────────────────── */

interface SettingRowProps {
  id?: string;
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  /** Control rendered on the right (switch, select, segmented, …). */
  children?: ReactNode;
  /** Makes the whole row clickable — navigation to a sub-screen. */
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

export const SettingRow = ({ id, icon: Icon, title, description, children, onClick, disabled, className }: SettingRowProps) => {
  const body = (
    <>
      {Icon && (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15 transition-colors group-hover/row:bg-primary/15">
          <Icon className="h-4 w-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-snug">{title}</span>
        {description && <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{description}</span>}
      </span>
      {children && <span className="flex shrink-0 items-center gap-2">{children}</span>}
      {onClick && (
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover/row:translate-x-0.5" />
      )}
    </>
  );

  const base = "group/row flex w-full items-center gap-3.5 px-4 py-3.5 text-left sm:px-5";
  const interactive = "cursor-pointer transition-colors hover:bg-foreground/[0.035]";

  if (onClick) {
    return (
      <button
        type="button"
        id={id}
        onClick={onClick}
        disabled={disabled}
        className={cn(base, interactive, "scroll-mt-28 disabled:pointer-events-none disabled:opacity-50", className)}
      >
        {body}
      </button>
    );
  }

  return <div id={id} className={cn(base, "scroll-mt-28", disabled && "opacity-50", className)}>{body}</div>;
};

/* ── Segmented ───────────────────────────────────────────────────────────── */

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
  icon?: LucideIcon;
}

interface SegmentedProps<T extends string | number> {
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  className?: string;
  "aria-label"?: string;
}

export const Segmented = <T extends string | number>({
  value,
  onChange,
  options,
  className,
  "aria-label": ariaLabel,
}: SegmentedProps<T>) => {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]"));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const next = forward ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn("inline-flex items-center gap-0.5 rounded-full border border-border/60 bg-foreground/[0.04] p-0.5", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
};

/* ── OptionCard ──────────────────────────────────────────────────────────── */

interface OptionCardProps {
  selected: boolean;
  title: string;
  description?: string;
  onClick: () => void;
  /** Preview slot rendered under the title. */
  children?: ReactNode;
  /** Optional control rendered in the corner, next to the selected check. */
  action?: ReactNode;
  className?: string;
}

export const OptionCard = ({ selected, title, description, onClick, children, action, className }: OptionCardProps) => (
  // A div (not a button) so a live preview — which may contain its own
  // interactive elements, e.g. the publish button — can be nested safely.
  <div
    role="radio"
    aria-checked={selected}
    tabIndex={0}
    data-nav-item
    onClick={onClick}
    onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onClick();
      }
    }}
    className={cn(
      "group/card relative cursor-pointer overflow-hidden rounded-2xl border p-3 text-left outline-none transition-all duration-200",
      "focus-visible:ring-2 focus-visible:ring-ring/60",
      selected
        ? "border-primary/60 bg-primary/[0.06] ring-1 ring-primary/25 shadow-[0_10px_30px_-16px_oklch(var(--primary)/0.6)]"
        : "border-border/60 bg-background/40 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-foreground/[0.03] hover:shadow-md",
      className,
    )}
  >
    <span className="flex items-start justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-tight">{title}</span>
        {description && <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{description}</span>}
      </span>
      <span className="flex shrink-0 items-start gap-1.5">
        {action}
        <span
          className={cn(
            "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-all duration-200",
            selected ? "border-primary bg-primary text-primary-foreground" : "border-foreground/20",
          )}
        >
          {selected && <Check className="h-3 w-3" strokeWidth={3} />}
        </span>
      </span>
    </span>
    {children && <span className="mt-3 block">{children}</span>}
  </div>
);
