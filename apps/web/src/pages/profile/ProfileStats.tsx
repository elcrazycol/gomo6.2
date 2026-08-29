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

/**
 * Stats summary — rendered inside the "card" background variant or standalone.
 * Row: four compact square cells (Записи/Комментарии, Лайков, Просмотры, Гарма)
 * plus ActiEye — a separate circular widget on the right (~1/5 of the row).
 */
export function ProfileStats({ profile, show, onOpenWall }: ProfileStatsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  if (!show) return null;

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="grid grid-cols-4 gap-1.5 sm:gap-2 p-1.5 sm:p-2 bg-post-header border border-border">
        {/* Записи (сабы + стена) / Комментарии — одна клетка */}
        <button
          type="button"
          onClick={() => navigate(`/stats?metric=posts&user=${profile.id}`)}
          className="flex flex-col items-center justify-center size-16 sm:size-24 rounded-md bg-background/50 hover:bg-background/80 transition-colors px-1 text-center"
        >
          <p className="text-[10px] sm:text-xs leading-tight text-muted-foreground">{t("profile.postsComments")}</p>
          <p className="text-sm sm:text-xl font-bold leading-tight">
            {(profile.thread_count ?? 0) + (profile.wall_post_count ?? 0)}/{profile.comment_count ?? 0}
          </p>
        </button>
        <button
          type="button"
          onClick={() => navigate(`/stats?metric=likes&user=${profile.id}`)}
          className="flex flex-col items-center justify-center size-16 sm:size-24 rounded-md bg-background/50 hover:bg-background/80 transition-colors px-1 text-center"
        >
          <p className="text-[10px] sm:text-xs leading-tight text-muted-foreground">{t("profile.likes")}</p>
          <p className="text-sm sm:text-xl font-bold leading-tight">{profile.likes_received_count ?? 0}</p>
        </button>
        {/* Total unique views across the author's wall posts —
            clicks open the wall, where each post shows its own
            counter. */}
        <button
          type="button"
          onClick={onOpenWall}
          className="flex flex-col items-center justify-center size-16 sm:size-24 rounded-md bg-background/50 hover:bg-background/80 transition-colors px-1 text-center"
        >
          <p className="text-[10px] sm:text-xs leading-tight text-muted-foreground">{t("profile.views")}</p>
          <p className="text-sm sm:text-xl font-bold leading-tight">{formatCompactNumber(profile.views_received_count ?? 0)}</p>
        </button>
        <button
          type="button"
          onClick={() => navigate(`/stats?metric=garma&user=${profile.id}`)}
          className="flex flex-col items-center justify-center size-16 sm:size-24 rounded-md bg-background/50 hover:bg-background/80 transition-colors px-1 text-center"
        >
          <p className="text-[10px] sm:text-xs leading-tight text-muted-foreground">{t("profile.karma")}</p>
          <p className="text-sm sm:text-xl font-bold leading-tight">{profile.garma}</p>
        </button>
      </div>
      {/* ActiEye — простой оранжевый круг, прижат к правому краю */}
      <ActiEye className="mr-1" />
    </div>
  );
}
