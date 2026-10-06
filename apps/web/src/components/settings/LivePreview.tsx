import { useTranslation } from "react-i18next";
import { Heart, MessageCircle, Repeat2, Share2 } from "lucide-react";
import { PublishButton } from "@/components/PublishButton";
import { UserAvatar } from "@/components/UserAvatar";
import { ActionButton } from "@/components/WallActionButton";
import { PostCardShell, PostCardActions, PostSourceChip } from "@/components/post/PostCardChrome";
import { formatShortRelativeTime } from "@/utils/relativeTimeShort";
import { cn } from "@/lib/utils";
import type { PublishButtonStyle } from "@/lib/publishButtonStyle";
import type { HeaderBehavior } from "@/lib/headerBehavior";

/**
 * Sticky desktop preview for Settings → Внешний вид.
 *
 * The theme and the custom font are applied to <html>/<body> globally, so this
 * mock reflects them for free. The card reuses the real feed chrome
 * (`PostCardShell` / `PostCardActions` / the header row of `PostCardHeader`), so
 * what the user sees is the actual feed card, not a hand-drawn imitation.
 */

interface LivePreviewProps {
  publishStyle: PublishButtonStyle;
  headerBehavior: HeaderBehavior;
  className?: string;
}

const SAMPLE_CREATED_AT = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

export const LivePreview = ({ publishStyle, headerBehavior, className }: LivePreviewProps) => {
  const { t, i18n } = useTranslation();

  return (
    <aside className={cn(className)}>
      <div className="sticky top-24 space-y-3">
        <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {t("settings2.preview")}
        </p>

        {/* App header — shows the chosen scroll behaviour. */}
        <div className="relative h-9 overflow-hidden rounded-xl border border-border/60 bg-background/70">
          <div
            className={cn(
              "absolute inset-x-0 top-0 flex h-9 items-center gap-2 px-3 transition-all duration-500",
              headerBehavior === "auto-hide" && "-translate-y-7 opacity-30",
            )}
          >
            <span className="h-4 w-4 rounded-full bg-primary/60" />
            <span className="h-1.5 w-10 rounded-full bg-foreground/30" />
            <span className="ml-auto h-1.5 w-6 rounded-full bg-foreground/20" />
          </div>
          {headerBehavior === "auto-hide" && (
            <span className="absolute bottom-1 left-3 text-[9px] text-muted-foreground">
              ↓ {t("settings2.headerAutoHideHint")}
            </span>
          )}
        </div>

        {/* Composer — where the publish button lives. */}
        <div className="rounded-[var(--card-radius)] border border-border/70 bg-surface p-3">
          <div className="flex items-center gap-2">
            <UserAvatar alt="nickname" className="h-8 w-8" />
            <span className="text-sm text-muted-foreground">{t("settings2.composerPlaceholder")}</span>
          </div>
          <div className="mt-3 flex justify-end">
            <PublishButton style={publishStyle} onClick={() => {}} />
          </div>
        </div>

        {/* The real feed post card. */}
        <PostCardShell contentClassName="space-y-3 p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="flex shrink-0 items-center">
              <UserAvatar alt="nickname" className="h-8 w-8" />
            </span>
            <div className="flex min-w-0 flex-1 items-center">
              <span className="inline-flex max-w-full min-w-0 items-center gap-1 overflow-hidden">
                <span className="font-bold text-sm">nickname</span>
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <PostSourceChip label="Стена" />
              <time className="text-sm font-medium tabular-nums text-muted-foreground">
                {formatShortRelativeTime(new Date(SAMPLE_CREATED_AT), i18n.language)}
              </time>
            </div>
          </div>

          <p className="break-words text-[14px] leading-6 sm:text-[15px] sm:leading-7">
            {t("settings2.postSample")}
          </p>

          <PostCardActions>
            <ActionButton minimal icon={<Heart className="h-4 w-4 fill-current" />} label="Нравится" count={12} active onClick={() => {}} />
            <ActionButton minimal icon={<MessageCircle className="h-4 w-4" />} label="Комментарии" count={3} onClick={() => {}} />
            <ActionButton minimal icon={<Repeat2 className="h-4 w-4" />} label="Репосты" count={1} onClick={() => {}} />
            <ActionButton minimal icon={<Share2 className="h-4 w-4" />} label="Поделиться" onClick={() => {}} />
          </PostCardActions>
        </PostCardShell>

        <p className="px-1 text-[11px] leading-snug text-muted-foreground">{t("settings2.previewHint")}</p>
      </div>
    </aside>
  );
};
