import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Blend,
  Clock,
  Dices,
  Globe,
  Languages,
  Monitor,
  Moon,
  Palette,
  PanelTop,
  PlayCircle,
  RotateCcw,
  Send,
  Shuffle,
  Star,
  Sun,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TransitionPreview } from "@/components/TransitionPreview";
import { PublishButton } from "@/components/PublishButton";
import { LANGUAGES } from "@/i18n/languages";
import { HEADER_BEHAVIORS, type HeaderBehavior } from "@/lib/headerBehavior";
import { PUBLISH_BUTTON_STYLES, type PublishButtonStyle } from "@/lib/publishButtonStyle";
import { TRANSITION_STYLES, isPerfLite, supportsViewTransitions, type TransitionStyle } from "@/lib/viewTransitions";
import { MR_RANDOM_COUNT_OPTIONS } from "@/lib/mrRandom";
import {
  CUSTOM_THEMES_EVENT,
  THEME_COLLECTIONS_EVENT,
  THEME_GROUP_LABEL_KEYS,
  THEME_GROUP_ORDER,
  getAllThemes,
  getFavorites,
  prefersDarkSystem,
  resolveTheme,
  toggleFavorite,
  type ThemeDef,
  type ThemeGroup,
  type ThemeModePref,
} from "@/theme";
import { OptionCard, Segmented, SETTING_BLOCK_CHROME, SettingBlock, SettingGroup, SettingRow } from "./SettingRow";
import { handleNavArrowKeys } from "./navKeyboard";
import { ThemeBuilder } from "./ThemeBuilder";
import type { AppearanceSettings } from "./useAppearanceSettings";
import { cn } from "@/lib/utils";

/* ── Local data ──────────────────────────────────────────────────────────── */

/**
 * A miniature of the real UI painted with the theme's own tokens. The tokens
 * are set as scoped CSS variables on the wrapper, so every Tailwind colour
 * inside (`bg-background`, `bg-card`, `text-foreground`, …) resolves to that
 * theme — no hand-drawn gradient. Single-mode themes render in their mode.
 */
const ThemeSwatch = ({ theme, dark }: { theme: ThemeDef; dark: boolean }) => {
  const preferred = dark ? "dark" : "light";
  const mode = theme.supports.includes(preferred) ? preferred : theme.supports[0];
  const tokens = theme.tokens[mode];
  if (!tokens) return null;
  const vars: Record<string, string> = { ...tokens, "--radius": theme.radius };
  return (
    <span className="block overflow-hidden rounded-xl border border-border" style={vars as CSSProperties}>
      <span className="flex h-[72px] flex-col justify-center gap-1.5 bg-background px-2.5">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-primary" />
          <span className="h-1.5 w-10 rounded-full bg-foreground/80" />
          <span className="ml-auto h-3 w-7 rounded-[calc(var(--radius)*0.7)] bg-primary/25" />
        </span>
        <span className="rounded-[var(--radius)] border border-border bg-card px-2 py-1.5">
          <span className="block h-1.5 w-16 rounded-full bg-foreground/70" />
          <span className="mt-1 block h-1.5 w-10 rounded-full bg-muted-foreground" />
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1 w-6 rounded-full bg-link/70" />
          <span className="h-1 w-4 rounded-full bg-success/70" />
          <span className="h-1 w-4 rounded-full bg-warning/70" />
        </span>
      </span>
    </span>
  );
};

const MODE_OPTIONS: Array<{ value: ThemeModePref; labelKey: string; icon: typeof Sun }> = [
  { value: "light", labelKey: "settings2.modeLight", icon: Sun },
  { value: "dark", labelKey: "settings2.modeDark", icon: Moon },
  { value: "system", labelKey: "settings2.modeSystem", icon: Monitor },
];

/** Favourites, kept in sync across tabs and with the picker. */
const useThemeFavorites = () => {
  const [favorites, setFavorites] = useState<string[]>(() => getFavorites());

  useEffect(() => {
    const sync = () => setFavorites(getFavorites());
    window.addEventListener(THEME_COLLECTIONS_EVENT, sync);
    return () => window.removeEventListener(THEME_COLLECTIONS_EVENT, sync);
  }, []);

  const toggle = useCallback((id: string) => setFavorites(toggleFavorite(id)), []);

  return { favorites, toggleFavorite: toggle };
};

interface ThemeItemSections {
  key: string;
  label: string;
  ids: string[];
}

const buildThemeSections = (
  themes: ThemeDef[],
  favorites: string[],
  labelFavorites: string,
  labelGroup: (group: ThemeGroup) => string,
): ThemeItemSections[] => {
  const sections: ThemeItemSections[] = [];
  if (favorites.length) sections.push({ key: "favorites", label: labelFavorites, ids: favorites });
  for (const group of THEME_GROUP_ORDER) {
    const ids = themes.filter((theme) => theme.group === group).map((theme) => theme.id);
    if (ids.length) sections.push({ key: group, label: labelGroup(group), ids });
  }
  return sections;
};

const HEADER_KEYS: Record<HeaderBehavior, { label: string; desc: string }> = {
  fixed: { label: "settings2.headerFixed", desc: "settings2.headerFixedDesc" },
  "auto-hide": { label: "settings2.headerAutoHide", desc: "settings2.headerAutoHideDesc" },
};

const TRANSITION_KEYS: Record<TransitionStyle, { label: string; desc: string }> = {
  fade: { label: "settings2.transFade", desc: "settings2.transFadeDesc" },
  "view-transition": { label: "settings2.transView", desc: "settings2.transViewDesc" },
  rise: { label: "settings2.transRise", desc: "settings2.transRiseDesc" },
  slide: { label: "settings2.transSlide", desc: "settings2.transSlideDesc" },
  none: { label: "settings2.transNone", desc: "settings2.transNoneDesc" },
};

const PUBLISH_KEYS: Record<PublishButtonStyle, { label: string; desc: string }> = {
  "gradient-pill": { label: "settings2.pubGradient", desc: "settings2.pubGradientDesc" },
  "send-circle": { label: "settings2.pubCircle", desc: "settings2.pubCircleDesc" },
  "text-link": { label: "settings2.pubText", desc: "settings2.pubTextDesc" },
  "neon-pill": { label: "settings2.pubNeon", desc: "settings2.pubNeonDesc" },
  "icon-pill": { label: "settings2.pubIcon", desc: "settings2.pubIconDesc" },
};

/* ── Section ─────────────────────────────────────────────────────────────── */

interface AppearanceSectionProps {
  appearance: AppearanceSettings;
}

export const AppearanceSection = ({ appearance }: AppearanceSectionProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    colorTheme, modePref, timeAuto, customFont, publishStyle, headerBehavior,
    transitionStyle, mrRandomCount, autoplayMode, language,
    setColorTheme, setModePref, setTimeAuto, randomTheme, setFont, setPublishStyle,
    setHeaderBehavior, setTransitionStyle, setMrRandomCount, setAutoplayMode, setLanguage, resetAppearance,
  } = appearance;

  const { favorites, toggleFavorite: onToggleFavorite } = useThemeFavorites();
  const [allThemes, setAllThemes] = useState<ThemeDef[]>(() => getAllThemes());

  // Swatches (and the builder preview) follow the chosen mode button — not the
  // current theme's resolved mode — so a single-mode theme can't force every
  // preview into its own mode.
  const previewDark = modePref === "dark" ? true : modePref === "light" ? false : prefersDarkSystem();

  useEffect(() => {
    const sync = () => setAllThemes(getAllThemes());
    window.addEventListener(CUSTOM_THEMES_EVENT, sync);
    return () => window.removeEventListener(CUSTOM_THEMES_EVENT, sync);
  }, []);

  const sections = buildThemeSections(
    allThemes,
    favorites,
    t("settings2.themeFavorites"),
    (group) => t(THEME_GROUP_LABEL_KEYS[group]),
  );

  const renderThemeCard = (id: string) => {
    const theme = resolveTheme(id);
    if (!theme) return null;
    const favorite = favorites.includes(id);
    const title = theme.custom ? theme.name || t("settings2.builderUntitled") : t(`settings.${theme.nameKey}`);
    const description = theme.custom
      ? t("settings2.builderCustomDesc")
      : theme.descriptionKey
        ? t(`settings.${theme.descriptionKey}`)
        : undefined;
    return (
      <OptionCard
        key={theme.id}
        selected={colorTheme === theme.id}
        title={title}
        description={description}
        onClick={() => setColorTheme(theme.id)}
        action={
          <button
            type="button"
            aria-label={favorite ? t("settings2.themeFavoriteRemove") : t("settings2.themeFavoriteAdd")}
            aria-pressed={favorite}
            onClick={(event) => {
              event.stopPropagation();
              onToggleFavorite(theme.id);
            }}
            className={cn(
              "grid h-5 w-5 shrink-0 place-items-center transition-colors",
              favorite ? "text-yellow-400" : "text-foreground/30 hover:text-foreground/70",
            )}
          >
            <Star className={cn("h-4 w-4", favorite && "fill-current")} />
          </button>
        }
      >
        <ThemeSwatch theme={theme} dark={previewDark} />
      </OptionCard>
    );
  };

  const rowClass = SETTING_BLOCK_CHROME;

  return (
    <div className="space-y-5">
      {/* ── Оформление ─────────────────────────────────────────────────── */}
      <SettingGroup divided={false}>
        <SettingRow
          className={rowClass}
          id="set-mode"
          icon={Moon}
          title={t("settings.darkMode")}
          description={t("settings2.darkModeDesc")}
        >
          <Segmented
            aria-label={t("settings.darkMode")}
            value={modePref}
            onChange={setModePref}
            options={MODE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey), icon: option.icon }))}
          />
        </SettingRow>

        {resolveTheme(colorTheme).supports.length === 1 && (
          <p className="px-4 pb-1 text-xs text-muted-foreground sm:px-5">
            {t("settings2.themeSingleModeHint")}
          </p>
        )}

        <div id="set-theme" className={cn(SETTING_BLOCK_CHROME, "scroll-mt-28 px-4 py-4 sm:px-5")}>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-muted-foreground" />
              <div>
                <h3 className="text-sm font-semibold">{t("settings.themes")}</h3>
                <p className="text-xs text-muted-foreground">{t("settings.themesDescription")}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="shrink-0 gap-2" onClick={randomTheme}>
              <Shuffle className="h-4 w-4" />
              {t("settings2.themeRandom")}
            </Button>
          </div>
          <div className="space-y-5">
            {sections.map((section) => (
              <div key={section.key} className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {section.label}
                </p>
                <div className="grid gap-3 sm:grid-cols-2" onKeyDown={handleNavArrowKeys}>
                  {section.ids.map(renderThemeCard)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <SettingRow
          className={rowClass}
          id="set-time-auto"
          icon={Clock}
          title={t("settings2.themeTimeAuto")}
          description={t("settings2.themeTimeAutoDesc")}
        >
          <Switch checked={timeAuto} onCheckedChange={setTimeAuto} aria-label={t("settings2.themeTimeAuto")} />
        </SettingRow>

        <ThemeBuilder
          colorTheme={colorTheme}
          modePref={modePref}
          isDarkMode={previewDark}
          setColorTheme={setColorTheme}
        />
      </SettingGroup>

      {/* ── Шрифт ──────────────────────────────────────────────────────── */}
      <SettingGroup divided={false}>
        <SettingBlock id="set-font" title={t("settings.font")} description={t("settings2.fontDesc")} icon={Type}>
          <Input
            value={customFont}
            onChange={(event) => setFont(event.target.value)}
            placeholder={t("settings.googleFontPlaceholder")}
            aria-label={t("settings.googleFont")}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {t("settings.googleFontHint")}{" "}
            <a href="https://fonts.google.com/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              Google Fonts
            </a>
            . {t("settings.googleFontEmptyHint")}
          </p>
          <div className="mt-3 rounded-xl border border-border/50 bg-background/40 px-3 py-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("settings2.fontSampleLabel")}</p>
            <p className="mt-1 text-lg leading-snug">{t("settings2.fontSample")}</p>
          </div>
        </SettingBlock>
      </SettingGroup>

      {/* ── Язык и переводы ────────────────────────────────────────────── */}
      <SettingGroup divided={false}>
        <SettingRow
          className={rowClass}
          id="set-language"
          icon={Globe}
          title={t("settings.language")}
          description={t("settings.languageDescription")}
        >
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger className="w-[180px]" aria-label={t("settings.language")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((item) => (
                <SelectItem key={item.code} value={item.code}>
                  <span className="inline-flex items-center gap-2">
                    <span>{item.flag}</span>
                    <span>{item.nativeName}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>

        <SettingRow
          className={rowClass}
          icon={Languages}
          title={t("settings.translations")}
          description={t("settings.translationsDescription")}
          onClick={() => navigate("/translate")}
        />
      </SettingGroup>

      {/* ── Медиа ──────────────────────────────────────────────────────── */}
      <SettingGroup divided={false}>
        <SettingRow
          className={rowClass}
          id="set-autoplay"
          icon={PlayCircle}
          title={t("settings.autoplayMedia")}
          description={t("settings.autoplayMediaDescription")}
        >
          <Segmented
            aria-label={t("settings.autoplayMedia")}
            value={autoplayMode}
            onChange={setAutoplayMode}
            options={[
              { value: "always", label: t("settings.autoplayAlways") },
              { value: "wifi", label: t("settings.autoplayWifi") },
              { value: "never", label: t("settings.autoplayNever") },
            ]}
          />
        </SettingRow>
      </SettingGroup>

      {/* ── Интерфейс ──────────────────────────────────────────────────── */}
      <SettingGroup divided={false}>
        {/* Хедер */}
        <SettingBlock id="set-header" title={t("settings2.headerBehavior")} description={t("settings2.headerBehaviorDesc")} icon={PanelTop}>
          <div className="grid gap-3 sm:grid-cols-2" onKeyDown={handleNavArrowKeys}>
            {HEADER_BEHAVIORS.map((behavior) => (
              <OptionCard
                key={behavior.id}
                selected={headerBehavior === behavior.id}
                title={t(HEADER_KEYS[behavior.id].label)}
                description={t(HEADER_KEYS[behavior.id].desc)}
                onClick={() => setHeaderBehavior(behavior.id)}
              >
                <span className="block h-14 overflow-hidden rounded-xl border border-border/50 bg-background/40 p-1.5">
                  <span
                    className={cn(
                      "flex items-center justify-between rounded-md border border-border/50 bg-primary/25 px-2 py-1 transition-all duration-300",
                      behavior.id === "auto-hide" && "-translate-y-3 opacity-40",
                    )}
                  >
                    <span className="h-1.5 w-8 rounded-full bg-foreground/40" />
                    <span className="h-1.5 w-1.5 rounded-full bg-foreground/40" />
                  </span>
                  <span className="mt-2 block space-y-1.5 px-1">
                    <span className="block h-1.5 w-3/4 rounded-full bg-foreground/15" />
                    <span className="block h-1.5 w-1/2 rounded-full bg-foreground/15" />
                  </span>
                </span>
              </OptionCard>
            ))}
          </div>
        </SettingBlock>

        {/* Переходы */}
        <SettingBlock id="set-transitions" title={t("settings2.transitions")} description={t("settings2.transitionsDesc")} icon={Blend}>
          <div className="grid gap-3 sm:grid-cols-2" onKeyDown={handleNavArrowKeys}>
            {TRANSITION_STYLES.map((style) => (
              <OptionCard
                key={style.id}
                selected={transitionStyle === style.id}
                title={t(TRANSITION_KEYS[style.id].label)}
                description={t(TRANSITION_KEYS[style.id].desc)}
                onClick={() => setTransitionStyle(style.id)}
              />
            ))}
          </div>
          <div className="mt-3">
            <TransitionPreview style={transitionStyle} />
          </div>
          {!supportsViewTransitions() && (
            <p className="mt-2 text-xs text-muted-foreground">{t("settings2.transitionsUnsupported")}</p>
          )}
          {isPerfLite() && <p className="mt-1 text-xs text-muted-foreground">{t("settings2.transitionsPerfLite")}</p>}
        </SettingBlock>

        {/* Mr. рандомность */}
        <SettingBlock id="set-mrrandom" title={t("settings2.mrRandom")} description={t("settings2.mrRandomDesc")} icon={Dices}>
          <Segmented
            aria-label={t("settings2.mrRandom")}
            value={mrRandomCount}
            onChange={setMrRandomCount}
            options={MR_RANDOM_COUNT_OPTIONS.map((count) => ({ value: count, label: String(count) }))}
          />
        </SettingBlock>

        {/* Кнопка публикации */}
        <SettingBlock id="set-publish" title={t("settings2.publishButton")} description={t("settings2.publishButtonDesc")} icon={Send}>
          <div className="grid gap-3 sm:grid-cols-2" onKeyDown={handleNavArrowKeys}>
            {PUBLISH_BUTTON_STYLES.map((style) => (
              <OptionCard
                key={style.id}
                selected={publishStyle === style.id}
                title={t(PUBLISH_KEYS[style.id].label)}
                description={t(PUBLISH_KEYS[style.id].desc)}
                onClick={() => setPublishStyle(style.id)}
              >
                <span className="flex min-h-[52px] items-center justify-center rounded-xl border border-border/50 bg-background/40 p-2">
                  <PublishButton style={style.id} onClick={() => {}} />
                </span>
              </OptionCard>
            ))}
          </div>
        </SettingBlock>
      </SettingGroup>

      {/* ── Сброс ──────────────────────────────────────────────────────── */}
      <SettingGroup divided={false}>
        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20">
              <RotateCcw className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold">{t("settings2.resetTitle")}</h3>
              <p className="text-xs text-muted-foreground">{t("settings2.resetDesc")}</p>
            </div>
          </div>
          <Button variant="outline" className="shrink-0 gap-2" onClick={resetAppearance}>
            <RotateCcw className="h-4 w-4" />
            {t("settings2.resetAction")}
          </Button>
        </div>
      </SettingGroup>
    </div>
  );
};
