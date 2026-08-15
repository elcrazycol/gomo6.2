/**
 * Profile auto-theme.
 *
 * The profile owner can enable a theme generated from their background +
 * avatar. The image is downscaled to a tiny canvas, pixel statistics are
 * collected (hue buckets weighted by AREA, plus global saturation/lightness
 * and a gray-pixel share), and several palette variants are derived from
 * them. The studio lets the owner pick one of the generated variants; the
 * chosen tokens (same shape as the app's theme.ts) are stored and applied
 * while a viewer is on the owner's profile page.
 *
 * Dominant color matters: the most common hue in the image drives the theme.
 * If gray/white/black pixels dominate the frame, the theme is neutral
 * (low-saturation), not a random hue.
 */

export type ThemeTokenMap = Record<string, string>;

// Allowed CSS variable names — must match the backend sanitizer allow-list in
// profile_css.go (allowedThemeTokenVars) so nothing extra can be stored.
const THEME_TOKEN_KEYS = [
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

export type Hsl = { h: number; s: number; l: number };

/** One generated palette candidate, for the studio picker. */
export interface ThemeVariant {
  id: string;
  name: string;
  color: Hsl;
  tokens: ThemeTokenMap;
}

const hsl = (h: number, s: number, l: number): string => `${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%`;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Convert an rgb [r,g,b] (0-255) tuple to an HSL object. */
export const rgbToHsl = (r: number, g: number, b: number): Hsl => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s: s * 100, l: l * 100 };
};

// A pixel with saturation below this is considered gray/neutral — it has a
// numeric hue but that hue is meaningless, so it must not steer the theme.
const GRAY_SAT_THRESHOLD = 8;

export interface PixelStats {
  /** Area-weighted hue buckets (24 buckets × 15°). */
  buckets: { sum: number; count: number }[];
  /** Total sampled pixels. */
  total: number;
  /** Share of gray/white/black pixels (0..1). */
  grayShare: number;
  /** Average saturation and lightness over ALL pixels. */
  avgSat: number;
  avgLight: number;
}

/** Collect pixel statistics from raw RGBA data (pure, unit-testable). */
export const collectPixelStats = (data: Uint8ClampedArray): PixelStats => {
  const buckets = new Array<{ sum: number; count: number }>(24).fill(null).map(() => ({ sum: 0, count: 0 }));
  let total = 0;
  let grayCount = 0;
  let satSum = 0;
  let lightSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 128) continue;
    const c = rgbToHsl(r, g, b);
    total++;
    satSum += c.s;
    lightSum += c.l;
    if (c.s < GRAY_SAT_THRESHOLD) {
      grayCount++;
      continue;
    }
    const bucket = Math.min(23, Math.floor(c.h / 15));
    // Area weight: each pixel counts as 1 — the most common hue wins.
    buckets[bucket].sum += c.h;
    buckets[bucket].count += 1;
  }
  return {
    buckets,
    total,
    grayShare: total > 0 ? grayCount / total : 1,
    avgSat: total > 0 ? satSum / total : 40,
    avgLight: total > 0 ? lightSum / total : 50,
  };
};

const dominantHue = (stats: PixelStats): number | null => {
  let best = stats.buckets[0];
  for (const b of stats.buckets) if (b.count > best.count) best = b;
  return best.count > 0 ? best.sum / best.count : null;
};

const averageHue = (stats: PixelStats): number | null => {
  let sum = 0;
  let count = 0;
  for (const b of stats.buckets) {
    sum += b.sum;
    count += b.count;
  }
  return count > 0 ? sum / count : null;
};

// Saturation floors for the primary/ring tokens per variant. Neutral palettes
// get a low floor so a gray photo really yields a gray theme.
const SAT_FLOOR = {
  color: 35,
  neutral: 6,
};

/**
 * Build the full theme token map from a dominant color. Dark vs light follows
 * the image's average brightness — a dark photo yields a dark profile theme.
 * `neutral` (used by the gray variant) keeps saturation low everywhere.
 */
export const buildThemeTokens = (c: Hsl, mode: "color" | "neutral" = "color"): ThemeTokenMap => {
  const h = c.h;
  const dark = c.l < 45;
  const sFloor = mode === "neutral" ? SAT_FLOOR.neutral : SAT_FLOOR.color;
  const sat = (v: number) => clamp(v, sFloor, 85);
  const n = mode === "neutral";
  // In neutral mode EVERY accent is desaturated too — including links and
  // quote text. A gray photo must not produce blue links (hue 220 is blue);
  // at ~5% saturation the hue is imperceptible and gray stays gray.
  const accentSat = n ? 5 : sat(c.s);
  if (dark) {
    return {
      "--background": hsl(h, n ? 3 : 20, 9),
      "--foreground": hsl(h, n ? 4 : 8, 90),
      "--card": hsl(h, n ? 2 : 18, 11),
      "--card-foreground": hsl(h, n ? 4 : 8, 90),
      "--popover": hsl(h, n ? 2 : 18, 11),
      "--popover-foreground": hsl(h, n ? 4 : 8, 90),
      "--primary": hsl(h, accentSat, clamp(c.l, 42, 62)),
      "--primary-foreground": "0 0% 100%",
      "--secondary": hsl(h, n ? 3 : 14, 16),
      "--secondary-foreground": hsl(h, n ? 4 : 8, 90),
      "--muted": hsl(h, n ? 3 : 14, 15),
      "--muted-foreground": hsl(h, n ? 3 : 6, 62),
      "--accent": hsl(h, n ? 3 : 18, 18),
      "--accent-foreground": hsl(h, n ? 4 : 8, 90),
      "--border": hsl(h, n ? 3 : 15, 19),
      "--input": hsl(h, n ? 3 : 15, 19),
      "--ring": hsl(h, accentSat, clamp(c.l, 42, 62)),
      "--board-header": hsl(h, accentSat, clamp(c.l, 32, 50)),
      "--board-header-foreground": "0 0% 100%",
      "--thread-hover": hsl(h, n ? 3 : 14, 15),
      "--post-header": hsl(h, n ? 3 : 14, 12),
      "--quote-text": hsl(h, n ? 4 : 100, 40),
      "--link-text": hsl(h, accentSat, 60),
      "--link": hsl(h, accentSat, 60),
    };
  }
  return {
    "--background": hsl(h, n ? 3 : 22, 95),
    "--foreground": hsl(h, n ? 4 : 10, 15),
    "--card": hsl(h, n ? 2 : 18, 98),
    "--card-foreground": hsl(h, n ? 4 : 10, 15),
    "--popover": hsl(h, n ? 2 : 18, 98),
    "--popover-foreground": hsl(h, n ? 4 : 10, 15),
    "--primary": hsl(h, accentSat, clamp(c.l, 40, 55)),
    "--primary-foreground": "0 0% 100%",
    "--secondary": hsl(h, n ? 3 : 20, 86),
    "--secondary-foreground": hsl(h, n ? 4 : 10, 15),
    "--muted": hsl(h, n ? 3 : 20, 90),
    "--muted-foreground": hsl(h, n ? 3 : 6, 42),
    "--accent": hsl(h, n ? 3 : 20, 86),
    "--accent-foreground": hsl(h, n ? 4 : 10, 15),
    "--border": hsl(h, n ? 3 : 20, 80),
    "--input": hsl(h, n ? 3 : 20, 80),
    "--ring": hsl(h, accentSat, clamp(c.l, 40, 55)),
    "--board-header": hsl(h, accentSat, clamp(c.l, 30, 45)),
    "--board-header-foreground": "0 0% 100%",
    "--thread-hover": hsl(h, n ? 3 : 18, 88),
    "--post-header": hsl(h, n ? 3 : 18, 92),
    "--quote-text": hsl(h, n ? 4 : 100, 25),
    "--link-text": hsl(h, accentSat, 40),
    "--link": hsl(h, accentSat, 40),
  };
};

const decodeImage = (image: Blob): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(image);
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("image decode failed"));
    el.src = url;
  });

const imagePixelData = (img: HTMLImageElement): Uint8ClampedArray | null => {
  const scale = Math.min(1, 48 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const hgt = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = hgt;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, hgt);
  return ctx.getImageData(0, 0, w, hgt).data;
};

/**
 * Derive the 5 palette variants from pixel statistics. Pure function so the
 * studio picker and the tests can drive it with synthetic data.
 */
// Gray-dominant threshold: above this share of neutral pixels the theme is
// treated as monochrome — even the "dominant" variant goes graphite instead
// of picking up the hue of some small colored patch in the frame.
const GRAY_DOMINANT_SHARE = 0.75;

// Graphite hue used for monochrome themes (cool neutral gray).
const GRAPHITE_HUE = 220;

export const deriveVariantsFromStats = (stats: PixelStats): ThemeVariant[] => {
  const dominant = dominantHue(stats);
  const avgHue = averageHue(stats) ?? dominant ?? GRAPHITE_HUE;
  const monochrome = stats.grayShare > GRAY_DOMINANT_SHARE;

  // Saturation to use for color variants: the image's own average, but at
  // least some character unless the image is truly monochrome.
  const colorSat = monochrome
    ? 10 // mostly gray — keep color variants muted
    : clamp(stats.avgSat, 25, 80);

  // Dominant: honors the most common hue by area. When gray dominates the
  // frame, though, the dominant theme is graphite — the few colored pixels
  // don't get to tint the whole profile.
  const baseHue = monochrome ? GRAPHITE_HUE : (dominant ?? avgHue);
  const baseColor: Hsl = { h: baseHue, s: colorSat, l: clamp(stats.avgLight, 30, 70) };
  const vibrantColor: Hsl = { h: monochrome ? GRAPHITE_HUE : (dominant ?? avgHue), s: clamp(colorSat + 10, 45, 85), l: 50 };
  const lightColor: Hsl = { h: baseColor.h, s: clamp(colorSat, 20, 70), l: 70 };
  const darkColor: Hsl = { h: baseColor.h, s: clamp(colorSat, 20, 70), l: 22 };
  const neutralColor: Hsl = { h: GRAPHITE_HUE, s: 3, l: clamp(stats.avgLight, 20, 75) };

  return [
    { id: "dominant", name: "Преобладающий", color: baseColor, tokens: buildThemeTokens(baseColor, monochrome ? "neutral" : "color") },
    { id: "vibrant", name: "Яркий", color: vibrantColor, tokens: buildThemeTokens(vibrantColor, "color") },
    { id: "light", name: "Светлый", color: lightColor, tokens: buildThemeTokens(lightColor, "color") },
    { id: "dark", name: "Тёмный", color: darkColor, tokens: buildThemeTokens(darkColor, "color") },
    { id: "neutral", name: "Нейтральный", color: neutralColor, tokens: buildThemeTokens(neutralColor, "neutral") },
  ];
};

/**
 * Generate 5 palette variants from an image, each with full theme tokens.
 *
 * - dominant: the most common hue by pixel area (gray wins → neutral theme)
 * - vibrant:  the most saturated significant color in the frame
 * - light:    a lighter take on the dominant hue
 * - dark:     a darker take on the dominant hue
 * - neutral:  graphite/gray theme honoring the image's brightness
 */
export const generateThemeVariants = async (image: Blob): Promise<ThemeVariant[]> => {
  const img = await decodeImage(image);
  try {
    const data = imagePixelData(img);
    if (!data) return [];
    return deriveVariantsFromStats(collectPixelStats(data));
  } finally {
    URL.revokeObjectURL(img.src);
  }
};

/** Whether a payload looks like a valid, non-empty profile theme. */
export const isValidThemeTokens = (tokens: unknown): tokens is ThemeTokenMap => {
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) return false;
  const keys = Object.keys(tokens as Record<string, unknown>);
  return keys.some((k) => (THEME_TOKEN_KEYS as readonly string[]).includes(k));
};

/**
 * Apply profile theme tokens to the page root, overriding the viewer's own
 * theme while the profile page is mounted.
 *
 * The app's theme system (theme.ts applyTheme) writes CSS variables inline to
 * BOTH <html> and <body> — body's inline values shadow html's for everything
 * inside it — so profile tokens must be applied to both elements or they are
 * invisible. Returns a cleanup that restores the previous inline values on
 * both (or removes the ones that weren't set before).
 */
export const applyProfileThemeTokens = (tokens: ThemeTokenMap): (() => void) => {
  const root = document.documentElement;
  const body = document.body;
  const prev = new Map<string, { html: string | null; body: string | null }>();
  for (const key of THEME_TOKEN_KEYS) {
    const value = tokens[key];
    if (value == null || value === "") continue;
    prev.set(key, {
      html: root.style.getPropertyValue(key) || null,
      body: body?.style.getPropertyValue(key) || null,
    });
    root.style.setProperty(key, value);
    body?.style.setProperty(key, value);
  }
  return () => {
    for (const [key, before] of prev) {
      if (before.html == null) root.style.removeProperty(key);
      else root.style.setProperty(key, before.html);
      if (body) {
        if (before.body == null) body.style.removeProperty(key);
        else body.style.setProperty(key, before.body);
      }
    }
  };
};
