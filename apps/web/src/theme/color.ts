/**
 * Colour math for the theme system: OKLCH ↔ sRGB conversion plus WCAG and
 * APCA contrast. OKLCH is used everywhere because its L axis is perceptual, so
 * nudging lightness to hit a contrast target changes perceived brightness
 * evenly and leaves hue/chroma intent intact.
 */

export interface Oklch {
  /** Perceptual lightness, 0..1. */
  L: number;
  /** Chroma, 0..~0.4 (sRGB gamut is smaller). */
  C: number;
  /** Hue angle in degrees, 0..360. */
  H: number;
}

export interface Rgb {
  /** sRGB channels in the 0..255 range. */
  r: number;
  g: number;
  b: number;
}

/** Parse a bare OKLCH triplet ("0.627 0.131 145.2") into numbers. */
export const parseOklch = (value: string): Oklch | null => {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const [L, C, H] = parts.map(Number);
  if (!Number.isFinite(L) || !Number.isFinite(C) || !Number.isFinite(H)) return null;
  return { L, C, H };
};

/** Serialize an OKLCH colour as a bare triplet for a CSS custom property. */
export const formatOklch = ({ L, C, H }: Oklch): string => {
  const l = Number(L.toFixed(4));
  const c = Number(Math.max(0, C).toFixed(4));
  const h = c < 0.0005 ? 0 : Number(H.toFixed(2));
  return `${l} ${c} ${h}`;
};

const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const linearToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

/** OKLCH → sRGB (0..255), clamped to gamut. */
export const oklchToRgb = ({ L, C, H }: Oklch): Rgb => {
  const hr = (H * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(linearToSrgb(v) * 255)));
  return { r: clamp(r), g: clamp(g), b: clamp(bl) };
};

/** sRGB (0..255) → OKLCH. */
export const rgbToOklch = ({ r, g, b }: Rgb): Oklch => {
  const lr = srgbToLinear(r / 255);
  const lg = srgbToLinear(g / 255);
  const lb = srgbToLinear(b / 255);
  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const C = Math.sqrt(a * a + bb * bb);
  let H = (Math.atan2(bb, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L, C, H };
};

/** OKLCH → full CSS colour string, e.g. for previews and canvas. */
export const oklchCss = (c: Oklch, alpha?: number): string =>
  alpha == null ? `oklch(${formatOklch(c)})` : `oklch(${formatOklch(c)} / ${alpha})`;

/** HSL (h 0..360, s 0..100, l 0..100) → OKLCH. */
export const hslToOklch = (h: number, s: number, l: number): Oklch => {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = ln - c / 2;
  return rgbToOklch({ r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255 });
};

/** WCAG 2.x relative luminance from a colour. */
export const relativeLuminance = (c: Oklch): number => {
  const { r, g, b } = oklchToRgb(c);
  return 0.2126 * srgbToLinear(r / 255) + 0.7152 * srgbToLinear(g / 255) + 0.0722 * srgbToLinear(b / 255);
};

/** WCAG 2.x contrast ratio (1..21). AA needs ≥ 4.5 for normal text, 3 for large. */
export const wcagContrast = (a: Oklch, b: Oklch): number => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
};

/** APCA-W3 (0.1.9) lightness contrast as an Lc value, roughly -108..106.
 *  Informational: WCAG remains the hard gate, APCA tells us whether a passing
 *  pair actually *looks* clean or just technically clears the bar. */
export const apcaContrast = (text: Oklch, bg: Oklch): number => {
  const yText = relativeLuminance(text);
  const yBg = relativeLuminance(bg);
  const blkThrs = 0.022;
  const blkClmp = 1.414;
  const deltaYmin = 0.0005;
  const loClip = 0.1;
  const normBG = 0.56;
  const normTXT = 0.57;
  const revTXT = 0.62;
  const revBG = 0.65;
  const scaleBoW = 1.14;
  const scaleWoB = 1.14;
  const loBoWoffset = 0.027;
  const loWoBoffset = 0.027;

  const clamp = (y: number) => (y > blkThrs ? y : y + Math.pow(blkThrs - y, blkClmp));
  const t = clamp(yText);
  const g = clamp(yBg);
  if (Math.abs(g - t) < deltaYmin) return 0;

  let contrast = g > t
    ? (Math.pow(g, normBG) - Math.pow(t, normTXT)) * scaleBoW
    : (Math.pow(g, revBG) - Math.pow(t, revTXT)) * scaleWoB;

  if (contrast > 0) {
    if (contrast < loClip) return 0;
    if (contrast > loBoWoffset) contrast = (contrast - loBoWoffset) * 100;
    else return 0;
    return contrast;
  }
  const abs = -contrast;
  if (abs < loClip) return 0;
  if (abs > loWoBoffset) return -((abs - loWoBoffset) * 100);
  return 0;
};

/** WCAG text thresholds. */
export const AA_NORMAL = 4.5;
export const AA_LARGE = 3;
