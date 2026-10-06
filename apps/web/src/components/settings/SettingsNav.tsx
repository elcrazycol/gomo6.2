import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Bell, Lock, Palette, Plug, Search, ShieldCheck, UserRound, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/**
 * Settings navigation model + the search box shared by the desktop sidebar and
 * the mobile hub. One source of truth (`SETTINGS_SECTIONS`) drives both, so a
 * new section only has to be added here.
 */

export type SettingsSectionId =
  | "profile"
  | "appearance"
  | "notifications"
  | "privacy"
  | "security"
  | "integrations";

export interface SettingsSection {
  id: SettingsSectionId;
  labelKey: string;
  descriptionKey: string;
  icon: LucideIcon;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "profile", labelKey: "settings.profile", descriptionKey: "settings2.secProfileDesc", icon: UserRound },
  { id: "appearance", labelKey: "settings.appearance", descriptionKey: "settings2.secAppearanceDesc", icon: Palette },
  { id: "notifications", labelKey: "settings.notifications", descriptionKey: "settings2.secNotificationsDesc", icon: Bell },
  { id: "privacy", labelKey: "settings.privacy", descriptionKey: "settings2.secPrivacyDesc", icon: Lock },
  { id: "security", labelKey: "settings.security", descriptionKey: "settings2.secSecurityDesc", icon: ShieldCheck },
  { id: "integrations", labelKey: "settings.integrations", descriptionKey: "settings2.secIntegrationsDesc", icon: Plug },
];

export const getSettingsSection = (id?: string) =>
  SETTINGS_SECTIONS.find((section) => section.id === id);

/** Individual searchable entries (a section, or a row inside a section). */
export interface SearchEntry {
  section: SettingsSectionId;
  anchor?: string;
  labelKey: string;
  keywords: string;
}

const APPEARANCE_ENTRIES: SearchEntry[] = [
  { section: "appearance", anchor: "set-theme", labelKey: "settings.themes", keywords: "тема тёмный режим dark theme оформление цвет" },
  { section: "appearance", anchor: "set-font", labelKey: "settings.font", keywords: "шрифт шрифты font google fonts текст" },
  { section: "appearance", anchor: "set-language", labelKey: "settings.language", keywords: "язык language locale" },
  { section: "appearance", anchor: "set-autoplay", labelKey: "settings.autoplayMedia", keywords: "автовоспроизведение gif видео медиа" },
  { section: "appearance", anchor: "set-header", labelKey: "settings2.headerBehavior", keywords: "хедер шапка header скролл" },
  { section: "appearance", anchor: "set-transitions", labelKey: "settings2.transitions", keywords: "анимация переходы transition" },
  { section: "appearance", anchor: "set-mrrandom", labelKey: "settings2.mrRandom", keywords: "рандом сайдбар записи random" },
  { section: "appearance", anchor: "set-publish", labelKey: "settings2.publishButton", keywords: "кнопка публикации publish" },
];

const PRIVACY_ENTRIES: SearchEntry[] = [
  { section: "privacy", anchor: "set-private-profile", labelKey: "settings.privateProfile", keywords: "приватный профиль private profile закрытый скрыть" },
  { section: "privacy", anchor: "set-what-others-see", labelKey: "settings.hideAvatar", keywords: "аватар avatar скрыть wall стена stats статистика от других" },
  { section: "privacy", anchor: "set-wall", labelKey: "settings.showProfileWall", keywords: "стена wall записи посты другие allow posts" },
  { section: "privacy", anchor: "set-stats", labelKey: "settings.showProfileStats", keywords: "статистика stats метрики гарма garma подробная" },
  { section: "privacy", anchor: "set-presence", labelKey: "settings.showOnlineStatus", keywords: "онлайн статус online присутствие в сети" },
  { section: "privacy", anchor: "set-metadata", labelKey: "settings.removeMetadata", keywords: "метаданные exif метаданные изображений metadata" },
];

const SECURITY_ENTRIES: SearchEntry[] = [
  { section: "security", anchor: "set-password", labelKey: "settings.password", keywords: "пароль password сменить смена" },
  { section: "security", anchor: "set-two-factor", labelKey: "settings.twoFactor", keywords: "2fa двухфакторная totp аутентификатор код" },
  { section: "security", anchor: "set-passkeys", labelKey: "settings2.passkeysTitle", keywords: "passkey passkeys ключ webauthn биометрия" },
  { section: "security", anchor: "set-sessions", labelKey: "settings.devicesAndSessions", keywords: "сессии устройства sessions devices выход" },
];

const PROFILE_ENTRIES: SearchEntry[] = [
  { section: "profile", anchor: "set-profile-main", labelKey: "settings.profileStudio", keywords: "студия профиль studio дизайн шапка фон бейдж никнейм" },
  { section: "profile", anchor: "set-profile-main", labelKey: "settings.mainCustomization", keywords: "кастомизация профиль аватар био никнейм customization" },
  { section: "profile", anchor: "set-placeholders", labelKey: "settings.profilePlaceholders", keywords: "плейсхолдеры placeholders заглушка аватар наведение" },
];

const NOTIFICATION_ENTRIES: SearchEntry[] = [
  { section: "notifications", anchor: "set-push", labelKey: "notifTypes.pushTitle", keywords: "push пуш уведомления notifications устройство pwa" },
  { section: "notifications", anchor: "set-push-types", labelKey: "notifTypes.whatReceive", keywords: "типы уведомления лайки ответы друзья подарки сообщения types" },
];

const INTEGRATION_ENTRIES: SearchEntry[] = [
  { section: "integrations", anchor: "set-spotify", labelKey: "settings.integrations", keywords: "spotify спотифай музыка трек интеграция" },
];

export const SETTINGS_SEARCH_INDEX: SearchEntry[] = [
  ...SETTINGS_SECTIONS.map((section) => ({
    section: section.id,
    labelKey: section.labelKey,
    keywords: section.id,
  })),
  ...APPEARANCE_ENTRIES,
  ...PRIVACY_ENTRIES,
  ...SECURITY_ENTRIES,
  ...PROFILE_ENTRIES,
  ...NOTIFICATION_ENTRIES,
  ...INTEGRATION_ENTRIES,
];

interface SettingsSearchProps {
  className?: string;
  onNavigate: (entry: SearchEntry) => void;
}

/** Visible search field (no hotkey) — filters settings and jumps to them. */
export const SettingsSearch = ({ className, onNavigate }: SettingsSearchProps) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 1) return [];
    return SETTINGS_SEARCH_INDEX.filter((entry) => {
      const haystack = `${t(entry.labelKey)} ${t(getSettingsSection(entry.section)?.labelKey ?? "")} ${entry.keywords}`.toLowerCase();
      return haystack.includes(q);
    }).slice(0, 8);
  }, [query, t]);

  const open = focused && results.length > 0;

  const select = (entry: SearchEntry) => {
    onNavigate(entry);
    setQuery("");
    setFocused(false);
  };

  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => window.setTimeout(() => setFocused(false), 120)}
        placeholder={t("settings2.searchPlaceholder")}
        aria-label={t("settings2.searchPlaceholder")}
        className="h-10 w-full rounded-xl border border-border/60 bg-background/50 pl-9 pr-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:bg-background/80"
      />
      {query && (
        <button
          type="button"
          aria-label={t("settings2.clearSearch")}
          onClick={() => setQuery("")}
          className="absolute right-2.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-border/60 bg-popover/95 p-1 shadow-2xl backdrop-blur-xl">
          {results.map((entry) => (
            <button
              key={`${entry.section}:${entry.anchor ?? "root"}`}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(entry)}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-foreground/[0.05]"
            >
              <span className="min-w-0 flex-1 truncate">{t(entry.labelKey)}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {t(getSettingsSection(entry.section)?.labelKey ?? "")}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
