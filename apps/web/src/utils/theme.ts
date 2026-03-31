export const THEME_IDS = [
  "cannabis",
  "pink",
  "blue",
  "blood",
  "pumpkin",
  "graphite",
  "lavender",
  "volcanic",
  "mint",
  "glitch",
] as const;

export type ColorTheme = (typeof THEME_IDS)[number];

export const DEFAULT_THEME: ColorTheme = "graphite";
export const DEFAULT_DARK_MODE = true;

export const syncSharedAppearanceCookies = () => {
  const colorTheme = localStorage.getItem("color-theme") || DEFAULT_THEME;
  const darkMode = localStorage.getItem("dark-mode") ?? String(DEFAULT_DARK_MODE);
  const customFont = localStorage.getItem("custom_font") || "";
  const maxAge = 60 * 60 * 24 * 365;

  document.cookie = `gomo6_color_theme=${encodeURIComponent(colorTheme)}; path=/; domain=.gomo6.wtf; max-age=${maxAge}; samesite=lax`;
  document.cookie = `gomo6_dark_mode=${encodeURIComponent(darkMode)}; path=/; domain=.gomo6.wtf; max-age=${maxAge}; samesite=lax`;
  document.cookie = `gomo6_custom_font=${encodeURIComponent(customFont)}; path=/; domain=.gomo6.wtf; max-age=${maxAge}; samesite=lax`;
};

export const applyTheme = (color: ColorTheme, dark: boolean) => {
  const html = document.documentElement;

  html.classList.remove(
    ...THEME_IDS.flatMap((themeId) => [`theme-${themeId}`, `theme-${themeId}-dark`]),
  );

  html.classList.add(dark ? `theme-${color}-dark` : `theme-${color}`);
  syncSharedAppearanceCookies();
};

export const getStoredTheme = (): { colorTheme: ColorTheme; isDarkMode: boolean } => {
  const rawColor = localStorage.getItem("color-theme") as ColorTheme | null;
  const colorTheme = THEME_IDS.includes(rawColor as ColorTheme) ? (rawColor as ColorTheme) : DEFAULT_THEME;
  const rawDarkMode = localStorage.getItem("dark-mode");
  const isDarkMode = rawDarkMode === null ? DEFAULT_DARK_MODE : rawDarkMode === "true";

  return { colorTheme, isDarkMode };
};
