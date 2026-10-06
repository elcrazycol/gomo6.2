interface UnreadBadgeProps {
  count: number;
  /** Counts above this render as "N+". */
  max?: number;
}

/**
 * The unread counter that hangs off the header icons (bell, messenger).
 *
 * Deliberately quiet: it wears the theme accent instead of alarm red and stays
 * a step smaller than the icon it sits on, so it reads as a hint rather than
 * something shouting for attention. Shared so the bell and the messenger can
 * never drift apart.
 */
export const UnreadBadge = ({ count, max = 99 }: UnreadBadgeProps) => {
  if (count <= 0) return null;

  return (
    <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-none tabular-nums text-primary-foreground">
      {count > max ? `${max}+` : count}
    </span>
  );
};
