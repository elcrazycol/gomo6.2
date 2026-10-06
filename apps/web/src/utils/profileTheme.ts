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

import { formatOklch, hslToOklch, oklchToRgb, parseOklch } from "@/theme/color";
import { THEME_TOKEN_NAMES } from "@/theme/tokens";
import { SEMANTIC_TOKENS } from "@/theme/derive";

export type ThemeTokenMap = Record<string, string>;

// The token surface is shared with the app theme registry — a profile theme
// may override exactly the same variables the app itself uses.
const THEME_TOKEN_KEYS = THEME_TOKEN_NAMES;

export type Hsl = { h: number; s: number; l: number };

/** One generated palette candidate, for the studio picker. */
export interface ThemeVariant {
  id: string;
  name: string;
  color: Hsl;
  tokens: ThemeTokenMap;
}

const tok = (h: number, s: number, l: number): string => formatOklch(hslToOklch(h, s, l));

/**
 * Fixed status colours (destructive/success/warning/info), identical to the app
 * theme registry. A profile theme carries the full token surface, but overlaying
 * these changes nothing visually because every app theme uses the same values.
 */
const withSemanticTokens = (tokens: ThemeTokenMap, dark: boolean): ThemeTokenMap => {
  const mode = dark ? "dark" : "light";
  const out: ThemeTokenMap = { ...tokens };
  for (const [key, val] of Object.entries(SEMANTIC_TOKENS)) {
    out[key] = formatOklch(val[mode]);
  }
  return out;
};

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
    return withSemanticTokens({
      "--background": tok(h, n ? 3 : 20, 9),
      "--foreground": tok(h, n ? 4 : 8, 90),
      "--card": tok(h, n ? 2 : 18, 11),
      "--card-foreground": tok(h, n ? 4 : 8, 90),
      "--popover": tok(h, n ? 2 : 18, 11),
      "--popover-foreground": tok(h, n ? 4 : 8, 90),
      "--primary": tok(h, accentSat, clamp(c.l, 42, 62)),
      "--primary-foreground": "1 0 0",
      "--secondary": tok(h, n ? 3 : 14, 16),
      "--secondary-foreground": tok(h, n ? 4 : 8, 90),
      "--muted": tok(h, n ? 3 : 14, 15),
      "--muted-foreground": tok(h, n ? 3 : 6, 62),
      "--accent": tok(h, n ? 3 : 18, 18),
      "--accent-foreground": tok(h, n ? 4 : 8, 90),
      "--border": tok(h, n ? 3 : 15, 19),
      "--input": tok(h, n ? 3 : 15, 19),
      "--ring": tok(h, accentSat, clamp(c.l, 42, 62)),
      "--board-header": tok(h, accentSat, clamp(c.l, 32, 50)),
      "--board-header-foreground": "1 0 0",
      "--thread-hover": tok(h, n ? 3 : 14, 15),
      "--post-header": tok(h, n ? 3 : 14, 12),
      "--quote-text": tok(h, n ? 4 : 100, 40),
      "--link-text": tok(h, accentSat, 60),
      "--link": tok(h, accentSat, 60),
    }, true);
  }
  return withSemanticTokens({
    "--background": tok(h, n ? 3 : 22, 95),
    "--foreground": tok(h, n ? 4 : 10, 15),
    "--card": tok(h, n ? 2 : 18, 98),
    "--card-foreground": tok(h, n ? 4 : 10, 15),
    "--popover": tok(h, n ? 2 : 18, 98),
    "--popover-foreground": tok(h, n ? 4 : 10, 15),
    "--primary": tok(h, accentSat, clamp(c.l, 40, 55)),
    "--primary-foreground": "1 0 0",
    "--secondary": tok(h, n ? 3 : 20, 86),
    "--secondary-foreground": tok(h, n ? 4 : 10, 15),
    "--muted": tok(h, n ? 3 : 20, 90),
    "--muted-foreground": tok(h, n ? 3 : 6, 42),
    "--accent": tok(h, n ? 3 : 20, 86),
    "--accent-foreground": tok(h, n ? 4 : 10, 15),
    "--border": tok(h, n ? 3 : 20, 80),
    "--input": tok(h, n ? 3 : 20, 80),
    "--ring": tok(h, accentSat, clamp(c.l, 40, 55)),
    "--board-header": tok(h, accentSat, clamp(c.l, 30, 45)),
    "--board-header-foreground": "1 0 0",
    "--thread-hover": tok(h, n ? 3 : 18, 88),
    "--post-header": tok(h, n ? 3 : 18, 92),
    "--quote-text": tok(h, n ? 4 : 100, 25),
    "--link-text": tok(h, accentSat, 40),
    "--link": tok(h, accentSat, 40),
  }, false);
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
 * Normalize a stored token to the app's bare-OKLCH format. Legacy rows hold
 * HSL triplets ("120 60% 35%") from before the OKLCH migration; those are
 * converted on apply so an owner never has to re-generate their theme.
 */
export const normalizeTokenValue = (value: string): string | null => {
  const trimmed = value.trim();
  if (trimmed.includes("%")) {
    const m = trimmed.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
    if (!m) return null;
    return formatOklch(hslToOklch(Number(m[1]), Number(m[2]), Number(m[3])));
  }
  const parsed = parseOklch(trimmed);
  return parsed ? formatOklch(parsed) : null;
};

/**
 * Complete a profile token map so the whole profile renders in the owner's
 * theme — including tokens the map never carried.
 *
 * Old profiles stored only a handful of tokens (background / card / foreground
 * / primary / accent). Applying just those left every other token —
 * `--border`, `--card-foreground`, `--muted`, `--popover`, … — at the
 * *viewer's* theme values. When the viewer's mode was the opposite of the
 * profile theme's, that painted light borders and dark text on the dark wall
 * cards (or the reverse on a light profile). The gaps are now filled from a
 * full palette derived from the profile background, so the viewer's own theme
 * can no longer bleed through. Owner-provided tokens always win.
 */
export const completeThemeTokens = (tokens: ThemeTokenMap): ThemeTokenMap => {
  const provided: ThemeTokenMap = {};
  for (const key of THEME_TOKEN_KEYS) {
    const raw = tokens[key];
    if (raw == null || raw === "") continue;
    const value = normalizeTokenValue(raw);
    if (value) provided[key] = value;
  }
  const out: ThemeTokenMap = { ...provided };

  // The background is the profile's dominant surface, so its hue and lightness
  // decide the mode (dark/light) and tint of every derived structural token.
  const anchor = parseOklch(
    provided["--background"] ?? provided["--card"] ?? provided["--foreground"] ?? "",
  );
  if (anchor) {
    const { r, g, b } = oklchToRgb(anchor);
    const hsl = rgbToHsl(r, g, b);
    const derived = buildThemeTokens(hsl, hsl.s < GRAY_SAT_THRESHOLD ? "neutral" : "color");
    for (const key of THEME_TOKEN_KEYS) {
      if (!(key in out)) out[key] = derived[key];
    }
  }
  return out;
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
  const complete = completeThemeTokens(tokens);
  for (const key of THEME_TOKEN_KEYS) {
    const value = complete[key];
    if (!value) continue;
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
