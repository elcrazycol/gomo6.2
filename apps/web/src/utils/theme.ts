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

const THEME_VARIABLE_NAMES = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--destructive-foreground",
  "--border",
  "--input",
  "--ring",
  "--board-header",
  "--board-header-foreground",
  "--thread-hover",
  "--post-header",
  "--quote-text",
  "--link-text",
  "--link",
] as const;

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
  const body = document.body;
  const themeClass = dark ? `theme-${color}-dark` : `theme-${color}`;

  html.classList.remove(
    ...THEME_IDS.flatMap((themeId) => [`theme-${themeId}`, `theme-${themeId}-dark`]),
  );
  body?.classList.remove(
    ...THEME_IDS.flatMap((themeId) => [`theme-${themeId}`, `theme-${themeId}-dark`]),
  );

  html.classList.add(themeClass);
  body?.classList.add(themeClass);
  html.dataset.theme = color;
  html.dataset.mode = dark ? "dark" : "light";

  if (body) {
    const probe = document.createElement("div");
    probe.className = themeClass;
    probe.style.position = "fixed";
    probe.style.pointerEvents = "none";
    probe.style.opacity = "0";
    probe.style.inset = "0";
    body.appendChild(probe);

    const computed = getComputedStyle(probe);
    THEME_VARIABLE_NAMES.forEach((variableName) => {
      const value = computed.getPropertyValue(variableName).trim();
      if (value) {
        html.style.setProperty(variableName, value);
      } else {
        html.style.removeProperty(variableName);
      }
    });

    body.removeChild(probe);
  }

  syncSharedAppearanceCookies();
};

export const getStoredTheme = (): { colorTheme: ColorTheme; isDarkMode: boolean } => {
  const rawColor = localStorage.getItem("color-theme") as ColorTheme | null;
  const colorTheme = THEME_IDS.includes(rawColor as ColorTheme) ? (rawColor as ColorTheme) : DEFAULT_THEME;
  const rawDarkMode = localStorage.getItem("dark-mode");
  const isDarkMode = rawDarkMode === null ? DEFAULT_DARK_MODE : rawDarkMode === "true";

  return { colorTheme, isDarkMode };
};
