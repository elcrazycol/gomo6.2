/**
 * Profile auto-theme.
 *
 * The profile owner can enable a theme generated from their background +
 * avatar. The image is downscaled to a tiny canvas, dominant colors are
 * extracted, and a full set of CSS-variable tokens (same shape as the app's
 * theme.ts) is produced. While a viewer is on the owner's profile page the
 * tokens are applied to the page root (header + buttons + cards) and removed
 * again when leaving — the viewer keeps their own theme everywhere else.
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

type Hsl = { h: number; s: number; l: number };

const hsl = (h: number, s: number, l: number): string => `${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%`;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Convert an rgb [r,g,b] (0-255) tuple to an HSL object. */
const rgbToHsl = (r: number, g: number, b: number): Hsl => {
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

/**
 * Extract a dominant color from an image. Pixels are bucketed by hue and
 * weighted by saturation * distance-from-gray so the most "colorful" region
 * of the image drives the theme. Falls back to a neutral hue for
 * monochrome images.
 */
export const extractPaletteFromImage = async (image: Blob): Promise<Hsl> => {
  const url = URL.createObjectURL(image);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image decode failed"));
      el.src = url;
    });

    // Downscale to at most 48px on the long edge — plenty of samples, cheap.
    const scale = Math.min(1, 48 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const hgt = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = hgt;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { h: 150, s: 45, l: 40 };
    ctx.drawImage(img, 0, 0, w, hgt);

    const { data } = ctx.getImageData(0, 0, w, hgt);
    // Bucket pixels by hue (24 buckets), weighted by saturation * distance
    // from gray — white/black/gray pixels don't steer the theme.
    const buckets = new Array<{ sum: number; count: number }>(24).fill(null).map(() => ({ sum: 0, count: 0 }));
    let totalWeight = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a < 128) continue;
      const c = rgbToHsl(r, g, b);
      const weight = c.s * (1 - Math.abs(c.l - 50) / 100);
      if (weight <= 2) continue;
      const bucket = Math.min(23, Math.floor(c.h / 15));
      buckets[bucket].sum += c.h * weight;
      buckets[bucket].count += weight;
      totalWeight += weight;
    }
    if (totalWeight < 4) return { h: 150, s: 45, l: 40 };

    let best = buckets[0];
    for (const b of buckets) if (b.count > best.count) best = b;
    const hue = best.sum / best.count;

    // Saturation / lightness of the theme follow the image's own character.
    let satSum = 0;
    let lightSum = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const c = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      satSum += c.s;
      lightSum += c.l;
      n++;
    }
    const avgSat = n ? satSum / n : 40;
    const avgLight = n ? lightSum / n : 50;
    return { h: hue, s: clamp(avgSat, 25, 80), l: clamp(avgLight, 30, 70) };
  } finally {
    URL.revokeObjectURL(url);
  }
};

/**
 * Build the full theme token map from a dominant color. Dark vs light follows
 * the image's average brightness — a dark photo yields a dark profile theme.
 */
export const buildThemeTokens = (c: Hsl): ThemeTokenMap => {
  const h = c.h;
  const dark = c.l < 45;
  if (dark) {
    return {
      "--background": hsl(h, 20, 9),
      "--foreground": hsl(h, 12, 90),
      "--card": hsl(h, 18, 11),
      "--card-foreground": hsl(h, 12, 90),
      "--popover": hsl(h, 18, 11),
      "--popover-foreground": hsl(h, 12, 90),
      "--primary": hsl(h, clamp(c.s, 45, 85), clamp(c.l, 42, 62)),
      "--primary-foreground": "0 0% 100%",
      "--secondary": hsl(h, 14, 16),
      "--secondary-foreground": hsl(h, 12, 90),
      "--muted": hsl(h, 14, 15),
      "--muted-foreground": hsl(h, 10, 62),
      "--accent": hsl(h, 18, 18),
      "--accent-foreground": hsl(h, 12, 90),
      "--border": hsl(h, 15, 19),
      "--input": hsl(h, 15, 19),
      "--ring": hsl(h, clamp(c.s, 45, 85), clamp(c.l, 42, 62)),
      "--board-header": hsl(h, clamp(c.s, 45, 85), clamp(c.l, 32, 50)),
      "--board-header-foreground": "0 0% 100%",
      "--thread-hover": hsl(h, 14, 15),
      "--post-header": hsl(h, 14, 12),
      "--quote-text": hsl(h, 100, 40),
      "--link-text": hsl(h, clamp(c.s, 45, 85), 60),
      "--link": hsl(h, clamp(c.s, 45, 85), 60),
    };
  }
  return {
    "--background": hsl(h, 22, 95),
    "--foreground": hsl(h, 15, 15),
    "--card": hsl(h, 18, 98),
    "--card-foreground": hsl(h, 15, 15),
    "--popover": hsl(h, 18, 98),
    "--popover-foreground": hsl(h, 15, 15),
    "--primary": hsl(h, clamp(c.s, 45, 85), clamp(c.l, 40, 55)),
    "--primary-foreground": "0 0% 100%",
    "--secondary": hsl(h, 20, 86),
    "--secondary-foreground": hsl(h, 15, 15),
    "--muted": hsl(h, 20, 90),
    "--muted-foreground": hsl(h, 10, 42),
    "--accent": hsl(h, 20, 86),
    "--accent-foreground": hsl(h, 15, 15),
    "--border": hsl(h, 20, 80),
    "--input": hsl(h, 20, 80),
    "--ring": hsl(h, clamp(c.s, 45, 85), clamp(c.l, 40, 55)),
    "--board-header": hsl(h, clamp(c.s, 45, 85), clamp(c.l, 30, 45)),
    "--board-header-foreground": "0 0% 100%",
    "--thread-hover": hsl(h, 18, 88),
    "--post-header": hsl(h, 18, 92),
    "--quote-text": hsl(h, 100, 25),
    "--link-text": hsl(h, clamp(c.s, 45, 85), 40),
    "--link": hsl(h, clamp(c.s, 45, 85), 40),
  };
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
