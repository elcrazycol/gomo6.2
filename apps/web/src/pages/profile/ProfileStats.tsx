import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { formatCompactNumber } from "@/utils/formatNumber";
import type { Profile } from "./types";

export interface ProfileStatsProps {
  profile: Profile;
  /** Whether this viewer may see the summary (owner, or public stats not hidden). */
  show: boolean;
  /** Opens the wall tab (used by the views counter — each wall post shows its own). */
  onOpenWall: () => void;
}

/** Stats summary — rendered inside the "card" background variant or standalone. */
export function ProfileStats({ profile, show, onOpenWall }: ProfileStatsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  if (!show) return null;

  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 sm:gap-4 p-3 sm:p-4 bg-post-header border border-border">
      <button
        type="button"
        onClick={() => navigate(`/stats?metric=posts&user=${profile.id}`)}
        className="text-left"
      >
        <p className="text-xs sm:text-sm text-muted-foreground">{t("profile.posts")}</p>
        <p className="text-xl sm:text-2xl font-bold">{(profile.thread_count ?? 0) + (profile.wall_post_count ?? 0)}</p>
      </button>
      <button
        type="button"
        onClick={() => navigate(`/stats?metric=comments&user=${profile.id}`)}
        className="text-left"
      >
        <p className="text-xs sm:text-sm text-muted-foreground">{t("profile.comments")}</p>
        <p className="text-xl sm:text-2xl font-bold">{profile.comment_count ?? 0}</p>
      </button>
      <button
        type="button"
        onClick={() => navigate(`/stats?metric=likes&user=${profile.id}`)}
        className="text-left"
      >
        <p className="text-xs sm:text-sm text-muted-foreground">{t("profile.likes")}</p>
        <p className="text-xl sm:text-2xl font-bold">{profile.likes_received_count ?? 0}</p>
      </button>
      {/* Total unique views across the author's wall posts —
          clicks open the wall, where each post shows its own
          counter. */}
      <button
        type="button"
        onClick={onOpenWall}
        className="text-left"
      >
        <p className="text-xs sm:text-sm text-muted-foreground">{t("profile.views")}</p>
        <p className="text-xl sm:text-2xl font-bold">{formatCompactNumber(profile.views_received_count ?? 0)}</p>
      </button>
      <button
        type="button"
        onClick={() => navigate(`/stats?metric=garma&user=${profile.id}`)}
        className="text-left"
      >
        <p className="text-xs sm:text-sm text-muted-foreground">{t("profile.karma")}</p>
        <p className="text-xl sm:text-2xl font-bold">{profile.garma}</p>
      </button>
    </div>
  );
}