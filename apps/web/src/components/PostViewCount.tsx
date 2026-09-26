import { Eye } from "lucide-react";

import { formatCompactNumber } from "@/utils/formatNumber";

interface PostViewCountProps {
  count?: number | null;
  /** Compact feed style: same rhythm as the minimal ActionButtons; a zero
   *  count hides the whole element (a lone "0" is just noise). */
  minimal?: boolean;
}

/**
 * Non-interactive views counter for wall post cards — an eye icon + number,
 * matching the height/rhythm of the ActionButtons it sits next to. The number
 * is server-authoritative (embedded in the wall GET); the client never writes
 * it directly.
 */
export const PostViewCount = ({ count, minimal = false }: PostViewCountProps) => {
  if (typeof count !== "number") return null;
  if (minimal && count === 0) return null;

  return (
    <span
      className={`ml-auto inline-flex items-center text-muted-foreground ${
        minimal
          ? "h-8 gap-1 px-2 text-xs font-medium tabular-nums"
          : "h-8 gap-1.5 px-1.5 text-xs sm:h-9 sm:px-2 sm:text-sm"
      }`}
      title="Просмотры"
      data-testid="post-views-count"
    >
      <Eye className="h-4 w-4" />
      <span className={minimal ? undefined : "text-foreground/80"}>{formatCompactNumber(count)}</span>
    </span>
  );
};
