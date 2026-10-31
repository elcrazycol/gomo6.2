import { cn } from "@/lib/utils";

export type TriState = "allow" | "inherit" | "deny";

/**
 * Tri-state permission toggle: deny (red ✕) left, inherit (grey –) center,
 * allow (green ✓) right. Shared by the role editor (server-level grants) and
 * the channel overwrite editor so both read the same way.
 */
export const TriStateControl = ({
  state,
  onPick,
  disabled,
  size = "md",
}: {
  state: TriState;
  onPick: (s: TriState) => void;
  disabled?: boolean;
  size?: "sm" | "md";
}) => {
  const dim = size === "sm" ? "w-7 h-6 text-[11px]" : "w-9 h-7 text-xs";
  return (
    <span className="inline-flex rounded-lg border border-border/70 overflow-hidden shrink-0" role="radiogroup">
      {(["deny", "inherit", "allow"] as TriState[]).map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={state === s}
          disabled={disabled}
          onClick={() => onPick(s)}
          title={s === "allow" ? "Разрешить" : s === "deny" ? "Запретить" : "Наследовать"}
          className={cn(
            dim,
            "font-bold transition-colors disabled:opacity-50",
            state === s
              ? s === "allow"
                ? "bg-emerald-500/90 text-white"
                : s === "deny"
                  ? "bg-destructive text-white"
                  : "bg-muted text-foreground"
              : "bg-surface text-muted-foreground hover:bg-muted",
          )}
        >
          {s === "allow" ? "✓" : s === "deny" ? "✕" : "–"}
        </button>
      ))}
    </span>
  );
};
