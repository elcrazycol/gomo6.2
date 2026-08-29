import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { formatCompactNumber } from "@/utils/formatNumber";
import { ActiEye } from "@/components/ActiEye";
import type { Profile } from "./types";

export interface ProfileStatsProps {
  profile: Profile;
  /** Whether this viewer may see the summary (owner, or public stats not hidden). */
  show: boolean;
  /** Opens the wall tab (used by the views counter — each wall post shows its own). */
  onOpenWall: () => void;
}

/** One clickable stat of the inline row — number + label, X-style. */
function Stat({
  value,
  label,
  onClick,
  title,
}: {
  value: string;
  label: string;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex items-baseline gap-1 whitespace-nowrap rounded px-1 py-0.5 transition-[text-shadow] duration-150 hover:[text-shadow:0_2px_3px_rgb(0_0_0_/_0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="text-sm sm:text-base font-semibold leading-none">{value}</span>
      <span className="text-[11px] sm:text-xs text-muted-foreground leading-none">{label}</span>
    </button>
  );
}

/**
 * Stats summary — rendered inside the "card" background variant or standalone.
 * A single X-style inline row (posts/comments, likes, views, garma) with
 * ActiEye pinned to the right edge of the same row.
 */
export function ProfileStats({ profile, show, onOpenWall }: ProfileStatsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  if (!show) return null;

  const posts = (profile.thread_count ?? 0) + (profile.wall_post_count ?? 0);

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* Записи (сабы + стена) / Комментарии — объединённый счётчик */}
        <Stat
          value={`${posts}/${profile.comment_count ?? 0}`}
          label={t("profile.postsComments")}
          title={t("profile.posts")}
          onClick={() => navigate(`/stats?metric=posts&user=${profile.id}`)}
        />
        <span className="text-muted-foreground/50 select-none">·</span>
        <Stat
          value={formatCompactNumber(profile.likes_received_count ?? 0)}
          label={t("profile.likes")}
          onClick={() => navigate(`/stats?metric=likes&user=${profile.id}`)}
        />
        <span className="text-muted-foreground/50 select-none">·</span>
        {/* Total unique views across the author's wall posts —
            clicks open the wall, where each post shows its own
            counter. */}
        <Stat
          value={formatCompactNumber(profile.views_received_count ?? 0)}
          label={t("profile.views")}
          onClick={onOpenWall}
        />
        <span className="text-muted-foreground/50 select-none">·</span>
        <Stat
          value={formatCompactNumber(profile.garma)}
          label={t("profile.karma")}
          onClick={() => navigate(`/stats?metric=garma&user=${profile.id}`)}
        />
      </div>
      {/* ActiEye — круг, прижат к правому краю строки */}
      <ActiEye className="mr-1" />
    </div>
  );
}
