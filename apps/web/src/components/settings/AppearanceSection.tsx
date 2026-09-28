import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Blend,
  Dices,
  Globe,
  Languages,
  Moon,
  Palette,
  PanelTop,
  PlayCircle,
  RotateCcw,
  Send,
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
import type { ColorTheme } from "@/utils/theme";
import { OptionCard, Segmented, SETTING_BLOCK_CHROME, SettingBlock, SettingGroup, SettingRow } from "./SettingRow";
import { handleNavArrowKeys } from "./navKeyboard";
import type { AppearanceSettings } from "./useAppearanceSettings";
import { cn } from "@/lib/utils";

/* ── Local data ──────────────────────────────────────────────────────────── */

const THEME_OPTIONS: Array<{ id: ColorTheme; nameKey: string; accent: string; preview: string }> = [
  { id: "graphite", nameKey: "themeGraphite", accent: "#0078D7", preview: "linear-gradient(135deg, #1E1E1E 0%, #2D2D2D 50%, #3C3C3C 100%)" },
  { id: "lavender", nameKey: "themeLavender", accent: "#C6A9FF", preview: "linear-gradient(135deg, #1A1625 0%, #2D2440 55%, #B0FFE6 130%)" },
  { id: "volcanic", nameKey: "themeVolcanic", accent: "#FF4D00", preview: "linear-gradient(135deg, #1F1F1F 0%, #2A2422 50%, #FF4D00 140%)" },
  { id: "mint", nameKey: "themeMint", accent: "#00FFA3", preview: "linear-gradient(135deg, #F0FFF4 0%, #E6FFF1 55%, #F5FF7A 120%)" },
  { id: "glitch", nameKey: "themeGlitch", accent: "#00FFFF", preview: "linear-gradient(135deg, #121212 0%, #1D1D1D 50%, #2A1030 100%)" },
  { id: "acid", nameKey: "themeAcid", accent: "#39FF14", preview: "linear-gradient(135deg, #000000 0%, #081507 45%, #FF10F0 130%)" },
  { id: "void", nameKey: "themeVoid", accent: "#FFFFFF", preview: "linear-gradient(135deg, #000000 0%, #101010 45%, #4A4A4A 100%)" },
  { id: "cannabis", nameKey: "themeCannabis", accent: "#3FA34D", preview: "linear-gradient(135deg, #1E2A1E 0%, #315C31 100%)" },
  { id: "pink", nameKey: "themePink", accent: "#FF4FA3", preview: "linear-gradient(135deg, #2A1722 0%, #7C2B5B 100%)" },
  { id: "blue", nameKey: "themeBlue", accent: "#4D7CFE", preview: "linear-gradient(135deg, #172033 0%, #27496D 100%)" },
  { id: "blood", nameKey: "themeBlood", accent: "#D62839", preview: "linear-gradient(135deg, #2A1113 0%, #701B26 100%)" },
  { id: "pumpkin", nameKey: "themePumpkin", accent: "#FF8A00", preview: "linear-gradient(135deg, #2B190C 0%, #8C4A0F 100%)" },
];

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
    colorTheme, isDarkMode, customFont, publishStyle, headerBehavior,
    transitionStyle, mrRandomCount, autoplayMode, language,
    setColorTheme, setDarkMode, setFont, setPublishStyle,
    setHeaderBehavior, setTransitionStyle, setMrRandomCount, setAutoplayMode, setLanguage, resetAppearance,
  } = appearance;

  const rowClass = SETTING_BLOCK_CHROME;

  return (
    <div className="space-y-5">
      {/* ── Оформление ─────────────────────────────────────────────────── */}
      <SettingGroup divided={false}>
        <SettingRow
          className={rowClass}
          icon={Moon}
          title={t("settings.darkMode")}
          description={t("settings2.darkModeDesc")}
        >
          <Switch checked={isDarkMode} onCheckedChange={setDarkMode} aria-label={t("settings.darkMode")} />
        </SettingRow>

        <div id="set-theme" className={cn(SETTING_BLOCK_CHROME, "scroll-mt-28 px-4 py-4 sm:px-5")}>
          <div className="mb-3 flex items-center gap-2">
            <Palette className="h-4 w-4 text-muted-foreground" />
            <div>
              <h3 className="text-sm font-semibold">{t("settings.themes")}</h3>
              <p className="text-xs text-muted-foreground">{t("settings.themesDescription")}</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2" onKeyDown={handleNavArrowKeys}>
            {THEME_OPTIONS.map((theme) => (
              <OptionCard
                key={theme.id}
                selected={colorTheme === theme.id}
                title={t(`settings.${theme.nameKey}`)}
                onClick={() => setColorTheme(theme.id)}
              >
                <span
                  className="flex h-16 items-end justify-between gap-2 rounded-xl border border-white/10 p-3"
                  style={{ background: theme.preview }}
                >
                  <span className="space-y-1.5">
                    <span className="block h-2 w-16 rounded-full bg-white/80" />
                    <span className="block h-2 w-10 rounded-full bg-white/50" />
                  </span>
                  <span
                    className="block h-7 w-7 rounded-lg border border-white/20"
                    style={{ backgroundColor: theme.accent, boxShadow: `0 0 18px ${theme.accent}55` }}
                  />
                </span>
              </OptionCard>
            ))}
          </div>
        </div>
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
