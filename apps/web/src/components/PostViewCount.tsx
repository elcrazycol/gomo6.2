import { Eye } from "lucide-react";

import { formatCompactNumber } from "@/utils/formatNumber";

interface PostViewCountProps {
  count?: number | null;
}

/**
 * Non-interactive views counter for wall post cards — an eye icon + number,
 * matching the height/rhythm of the ActionButtons it sits next to. The number
 * is server-authoritative (embedded in the wall GET); the client never writes
 * it directly.
 */
export const PostViewCount = ({ count }: PostViewCountProps) => {
  if (typeof count !== "number") return null;

  return (
    <span
      className="inline-flex h-8 items-center gap-1.5 px-1.5 text-xs text-muted-foreground sm:h-9 sm:px-2 sm:text-sm"
      title="Просмотры"
      data-testid="post-views-count"
    >
      <Eye className="h-4 w-4" />
      <span className="text-foreground/80">{formatCompactNumber(count)}</span>
    </span>
  );
};
