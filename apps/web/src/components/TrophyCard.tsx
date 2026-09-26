import { useTranslation } from "react-i18next";
import { Award } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAchievementIcon } from "@/components/AchievementIcons";
import { getIntlLanguage } from "@/i18n/dateLocale";
import {
  formatOwnerShare,
  trophyDescription,
  trophyName,
  TROPHY_TIER_GLOW,
  type Trophy,
} from "@/utils/trophies";

/**
 * The visual badge: the per-level artwork when it exists, otherwise the catalog
 * icon. The artwork carries its own baked-in caption, so no text is placed next
 * to it — only a subtle aura whose colour follows the owner-share tier. The
 * `trophy-badge`/`trophy-glint` CSS adds the hover sway and the masked light
 * sweep (see index.css).
 */
export function TrophyBadge({
  trophy,
  label,
  className,
}: {
  trophy: Trophy;
  /** Accessible name / tooltip (art has no alt text of its own). */
  label: string;
  className?: string;
}) {
  const Icon = getAchievementIcon(trophy.icon);
  const glow = TROPHY_TIER_GLOW[trophy.tier] ?? TROPHY_TIER_GLOW.common;

  const maskStyle: React.CSSProperties | undefined = trophy.artUrl
    ? {
        WebkitMaskImage: `url(${trophy.artUrl})`,
        maskImage: `url(${trophy.artUrl})`,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }
    : undefined;

  return (
    <div
      className={cn("trophy-badge relative aspect-square select-none", className)}
      style={{ "--trophy-glow": glow } as React.CSSProperties}
      title={label}
    >
      {trophy.artUrl ? (
        <>
          <img
            src={trophy.artUrl}
            alt={label}
            loading="lazy"
            draggable={false}
            className="relative z-10 h-full w-full object-contain"
          />
          <span
            aria-hidden
            className="trophy-glint pointer-events-none absolute inset-0 z-20"
            style={maskStyle}
          />
        </>
      ) : (
        <div className="flex h-full w-full items-center justify-center rounded-xl border border-border/60 bg-muted/40 text-muted-foreground">
          <Icon size={52} />
        </div>
      )}

      {trophy.kind === "award" && (
        <span
          className="absolute right-1 top-1 z-30 inline-flex h-5 w-5 items-center justify-center rounded-full bg-background/85 text-amber-500 shadow-sm backdrop-blur"
          title={label}
        >
          <Award className="h-3 w-3" />
        </span>
      )}
    </div>
  );
}

/**
 * Grid cell for the trophy hall / profile case: the badge, its name (only when
 * there is no art, since art is captioned), and the real owner share.
 */
export function TrophyCard({ trophy, className }: { trophy: Trophy; className?: string }) {
  const { t } = useTranslation();
  const name = trophyName(t, trophy);
  const share = formatOwnerShare(trophy.ownerShare, getIntlLanguage());

  return (
    <div className={cn("flex flex-col items-center gap-1.5 text-center", className)}>
      <TrophyBadge trophy={trophy} label={name} className="w-full" />
      {!trophy.artUrl && (
        <p className="line-clamp-2 text-xs font-medium leading-tight text-foreground">{name}</p>
      )}
      {share && (
        <p className="text-[11px] tabular-nums text-muted-foreground">
          {share} {t("achievements.owners")}
        </p>
      )}
    </div>
  );
}

/**
 * Row for a hand-granted award: unlike an auto milestone, an award needs its
 * provenance — who gave it, why, and when — next to the badge.
 */
export function AwardCard({ trophy, className }: { trophy: Trophy; className?: string }) {
  const { t } = useTranslation();
  const name = trophyName(t, trophy);
  const description = trophyDescription(t, trophy);
  const share = formatOwnerShare(trophy.ownerShare, getIntlLanguage());
  const date = trophy.grantedAt
    ? new Date(trophy.grantedAt).toLocaleDateString(getIntlLanguage(), {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";

  return (
    <div className={cn("flex items-start gap-4 rounded-xl border border-border bg-card p-4", className)}>
      <TrophyBadge trophy={trophy} label={name} className="w-16 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <p className="truncate font-medium text-foreground">{name}</p>
          {share && (
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {share} {t("achievements.owners")}
            </span>
          )}
        </div>
        {description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        )}
        {trophy.reason && (
          <p className="mt-1 text-sm italic text-foreground/70">«{trophy.reason}»</p>
        )}
        <p className="mt-1.5 text-xs text-muted-foreground/70">
          {t("achievements.grantedBy")}
          {trophy.grantedByUsername ? ` @${trophy.grantedByUsername}` : ""}
          {date ? ` · ${date}` : ""}
        </p>
      </div>
    </div>
  );
}
