/**
 * Custom Google font — shared by App boot, Settings and the server sync so the
 * font follows the user across devices exactly like the theme does.
 */
export const CUSTOM_FONT_KEY = "custom_font";
export const FONT_CHANGED_EVENT = "gomo6:custom-font";

const removeGoogleFontLink = () => {
  document.querySelectorAll("link[data-google-font]").forEach((link) => link.remove());
};

export const getStoredCustomFont = (): string => {
  try {
    return localStorage.getItem(CUSTOM_FONT_KEY) || "";
  } catch {
    return "";
  }
};

/** Apply (or clear) a Google Font across the document. */
export const applyCustomFont = (fontName: string): void => {
  removeGoogleFontLink();
  if (!fontName.trim()) {
    document.documentElement.style.removeProperty("--font-family");
    document.body.style.fontFamily = "";
    return;
  }
  const link = document.createElement("link");
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:wght@400;500;600;700&display=swap`;
  link.rel = "stylesheet";
  link.setAttribute("data-google-font", "true");
  document.head.appendChild(link);

  const fontFamily = `"${fontName}", system-ui, -apple-system, sans-serif`;
  document.documentElement.style.setProperty("--font-family", fontFamily);
  document.body.style.fontFamily = fontFamily;
};

/** Persist and apply a font, notifying listeners (used by server sync). */
export const storeCustomFont = (fontName: string): void => {
  try {
    if (fontName.trim()) localStorage.setItem(CUSTOM_FONT_KEY, fontName);
    else localStorage.removeItem(CUSTOM_FONT_KEY);
  } catch {
    /* storage unavailable */
  }
  applyCustomFont(fontName);
  window.dispatchEvent(new CustomEvent(FONT_CHANGED_EVENT));
};
