import { useTranslation } from "react-i18next";
import {
  EyeOff,
  ImageOff,
  LayoutGrid,
  Lock,
  Radio,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { SETTING_BLOCK_CHROME, SettingBlock, SettingGroup, SettingRow } from "./SettingRow";
import { SettingsSaveBar } from "./SettingsSaveBar";
import { STAT_VISIBILITY_KEYS, usePrivacySettings, type StatVisibilityKey } from "./usePrivacySettings";

/**
 * Settings → Приватность.
 *
 * Grouped around the questions a user actually asks ("кто видит мой профиль",
 * "что видно другим", "кто может писать на стене"), not around the database
 * columns. Everything writes through `usePrivacySettings`, which keeps a draft
 * and commits with the sticky save bar — the "confirm before it goes live"
 * half of the mixed save model.
 */

const STAT_LABELS: Record<StatVisibilityKey, string> = {
  garma: "settings2.statGarma",
  posts: "settings2.statPosts",
  threads: "settings2.statThreads",
  postLikes: "settings2.statPostLikes",
  threadLikes: "settings2.statThreadLikes",
  replies: "settings2.statReplies",
  time: "settings2.statTime",
};

interface ToggleRowProps {
  id?: string;
  icon?: typeof Lock;
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (value: boolean) => void;
}

const ToggleRow = ({ id, icon, title, description, checked, disabled, onCheckedChange }: ToggleRowProps) => (
  <SettingRow id={id} icon={icon} title={title} description={description} disabled={disabled}>
    <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-label={title} />
  </SettingRow>
);

interface PrivacySectionProps {
  userId?: string | null;
}

export const PrivacySection = ({ userId }: PrivacySectionProps) => {
  const { t } = useTranslation();
  const { settings, loading, saving, dirty, changedCount, setBoolean, setStatVisibility, save, reset } =
    usePrivacySettings(userId);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  const isPrivate = settings.private_profile;

  return (
    <div className="space-y-5">
      {/* ── Приватный профиль ─────────────────────────────────────────── */}
      <SettingGroup divided={false}>
        <SettingBlock
          id="set-private-profile"
          title={t("settings2.privProfileTitle")}
          description={t("settings2.privProfileDesc")}
          icon={Lock}
        >
          <SettingRow
            className={SETTING_BLOCK_CHROME}
            icon={ShieldCheck}
            title={t("settings.privateProfile")}
            description={t("settings.privateProfileDescription")}
          >
            <Switch
              checked={isPrivate}
              onCheckedChange={(value) => setBoolean("private_profile", value)}
              aria-label={t("settings.privateProfile")}
            />
          </SettingRow>

          <div
            className={cn(
              "mt-3 ml-4 border-l-2 pl-3 transition-colors sm:ml-5",
              isPrivate ? "border-primary/35" : "border-border/70",
            )}
          >
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {t("settings2.privPrivateOnlyTitle")}
            </p>
            <div className={cn("divide-y divide-border/50 transition-opacity", !isPrivate && "opacity-60")}>
              <ToggleRow
                title={t("settings.hideThreads")}
                description={t("settings2.privHideThreadsDesc")}
                checked={settings.private_hide_threads}
                disabled={!isPrivate}
                onCheckedChange={(value) => setBoolean("private_hide_threads", value)}
              />
              <ToggleRow
                title={t("settings.hideFriends")}
                description={t("settings2.privHideFriendsDesc")}
                checked={settings.private_hide_friends}
                disabled={!isPrivate}
                onCheckedChange={(value) => setBoolean("private_hide_friends", value)}
              />
              <ToggleRow
                title={t("settings.hideGifts")}
                description={t("settings2.privHideGiftsDesc")}
                checked={settings.private_hide_gifts}
                disabled={!isPrivate}
                onCheckedChange={(value) => setBoolean("private_hide_gifts", value)}
              />
              <ToggleRow
                title={t("settings.hideAchievements")}
                description={t("settings2.privHideAchievementsDesc")}
                checked={settings.private_hide_achievements}
                disabled={!isPrivate}
                onCheckedChange={(value) => setBoolean("private_hide_achievements", value)}
              />
            </div>
          </div>
        </SettingBlock>
      </SettingGroup>

      {/* ── Что видят другие ──────────────────────────────────────────── */}
      <SettingGroup divided={false}>
        <SettingBlock
          id="set-what-others-see"
          title={t("settings2.privHideTitle")}
          description={t("settings2.privHideDesc")}
          icon={EyeOff}
        >
          <SettingRow
            className={SETTING_BLOCK_CHROME}
            title={t("settings.hideAvatar")}
            description={t("settings2.privHideAvatarDesc")}
          >
            <Switch
              checked={settings.private_hide_avatar}
              onCheckedChange={(value) => setBoolean("private_hide_avatar", value)}
              aria-label={t("settings.hideAvatar")}
            />
          </SettingRow>
          <SettingRow
            className={SETTING_BLOCK_CHROME}
            title={t("settings.hideWall")}
            description={t("settings2.privHideWallDesc")}
          >
            <Switch
              checked={settings.private_hide_wall}
              onCheckedChange={(value) => setBoolean("private_hide_wall", value)}
              aria-label={t("settings.hideWall")}
            />
          </SettingRow>
          <SettingRow
            className={SETTING_BLOCK_CHROME}
            title={t("settings.hideStats")}
            description={t("settings2.privHideStatsDesc")}
          >
            <Switch
              checked={settings.private_hide_stats}
              onCheckedChange={(value) => setBoolean("private_hide_stats", value)}
              aria-label={t("settings.hideStats")}
            />
          </SettingRow>
        </SettingBlock>
      </SettingGroup>

      {/* ── Стена ─────────────────────────────────────────────────────── */}
      <SettingGroup divided={false}>
        <SettingBlock
          id="set-wall"
          title={t("settings2.privWallTitle")}
          description={t("settings2.privWallDesc")}
          icon={LayoutGrid}
        >
          <SettingRow
            className={SETTING_BLOCK_CHROME}
            title={t("settings.showProfileWall")}
            description={t("settings2.privShowWallDesc")}
          >
            <Switch
              checked={settings.show_profile_wall}
              onCheckedChange={(value) => setBoolean("show_profile_wall", value)}
              aria-label={t("settings.showProfileWall")}
            />
          </SettingRow>
          <SettingRow
            className={SETTING_BLOCK_CHROME}
            title={t("settings.allowWallPosts")}
            description={t("settings2.privAllowWallPostsDesc")}
            disabled={!settings.show_profile_wall}
          >
            <Switch
              checked={settings.allow_wall_posts_from_others}
              onCheckedChange={(value) => setBoolean("allow_wall_posts_from_others", value)}
              disabled={!settings.show_profile_wall}
              aria-label={t("settings.allowWallPosts")}
            />
          </SettingRow>
        </SettingBlock>
      </SettingGroup>

      {/* ── Статистика ────────────────────────────────────────────────── */}
      <SettingGroup divided={false}>
        <SettingBlock
          id="set-stats"
          title={t("settings2.privStatsTitle")}
          description={t("settings2.privStatsDesc")}
          icon={TrendingUp}
        >
          <SettingRow
            className={SETTING_BLOCK_CHROME}
            title={t("settings.showProfileStats")}
            description={t("settings2.privShowStatsDesc")}
          >
            <Switch
              checked={settings.show_profile_stats}
              onCheckedChange={(value) => setBoolean("show_profile_stats", value)}
              aria-label={t("settings.showProfileStats")}
            />
          </SettingRow>
          <SettingRow
            className={SETTING_BLOCK_CHROME}
            title={t("settings.showDetailedStats")}
            description={t("settings2.privShowDetailedStatsDesc")}
          >
            <Switch
              checked={settings.show_detailed_stats}
              onCheckedChange={(value) => setBoolean("show_detailed_stats", value)}
              aria-label={t("settings.showDetailedStats")}
            />
          </SettingRow>

          <div
            className={cn(
              "mt-3 ml-4 border-l-2 pl-3 transition-colors sm:ml-5",
              settings.show_detailed_stats ? "border-primary/35" : "border-border/70",
            )}
          >
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {t("settings2.privStatsMetricsTitle")}
            </p>
            <div className={cn("divide-y divide-border/50 transition-opacity", !settings.show_detailed_stats && "opacity-60")}>
              {STAT_VISIBILITY_KEYS.map((key) => (
                <ToggleRow
                  key={key}
                  title={t(STAT_LABELS[key])}
                  checked={settings.stats_visibility[key] === true}
                  disabled={!settings.show_detailed_stats}
                  onCheckedChange={(value) => setStatVisibility(key, value)}
                />
              ))}
            </div>
          </div>
        </SettingBlock>
      </SettingGroup>

      {/* ── Присутствие ───────────────────────────────────────────────── */}
      <SettingGroup divided={false}>
        <SettingBlock
          id="set-presence"
          title={t("settings2.privPresenceTitle")}
          description={t("settings2.privPresenceDesc")}
          icon={Radio}
        >
          <SettingRow
            className={SETTING_BLOCK_CHROME}
            title={t("settings.showOnlineStatus")}
            description={t("settings.showOnlineStatusHint")}
          >
            <Switch
              checked={settings.show_online_status}
              onCheckedChange={(value) => setBoolean("show_online_status", value)}
              aria-label={t("settings.showOnlineStatus")}
            />
          </SettingRow>
        </SettingBlock>
      </SettingGroup>

      {/* ── Данные ────────────────────────────────────────────────────── */}
      <SettingGroup divided={false}>
        <SettingBlock
          id="set-metadata"
          title={t("settings2.privDataTitle")}
          description={t("settings2.privDataDesc")}
          icon={ImageOff}
        >
          <SettingRow
            className={SETTING_BLOCK_CHROME}
            title={t("settings.removeMetadata")}
            description={t("settings.removeMetadataHint")}
          >
            <Switch
              checked={settings.remove_image_metadata}
              onCheckedChange={(value) => setBoolean("remove_image_metadata", value)}
              aria-label={t("settings.removeMetadata")}
            />
          </SettingRow>
        </SettingBlock>
      </SettingGroup>

      <SettingsSaveBar dirty={dirty} saving={saving} changedCount={changedCount} onSave={() => void save()} onReset={reset} />
    </div>
  );
};
