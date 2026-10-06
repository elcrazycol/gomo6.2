/**
 * Theme derivation — the shared maths behind both the generated registry and
 * the in-app theme constructor. Given an anchor colour it produces a full
 * 32-token chart, then tunes every text/surface pair to WCAG AA by moving only
 * OKLCH lightness/chroma (hue is preserved, so colours stay clean).
 *
 * The build script (scripts/gen-theme-registry.mts) imports this same module,
 * so a theme designed in the app and a theme shipped in the registry are
 * produced identically.
 */
import { formatOklch, wcagContrast, type Oklch } from "./color";
import { THEME_TOKEN_NAMES } from "./tokens";

export type SeedStyle = "soft" | "pastel" | "mono";
/** Surface depth ramp for tonal neutrals (light/dark background + card L). */
export type SeedTone = "default" | "paper" | "soft" | "deep";
export type ThemeModeName = "light" | "dark";

const TONES: Record<SeedTone, { lightBg: number; lightCard: number; darkBg: number; darkCard: number }> = {
  default: { lightBg: 0.966, lightCard: 0.994, darkBg: 0.16, darkCard: 0.205 },
  paper: { lightBg: 0.978, lightCard: 1, darkBg: 0.205, darkCard: 0.245 },
  soft: { lightBg: 0.935, lightCard: 0.968, darkBg: 0.19, darkCard: 0.235 },
  deep: { lightBg: 0.885, lightCard: 0.925, darkBg: 0.125, darkCard: 0.165 },
};

export interface SeedColor {
  /** Lightness 0..1. */
  L: number;
  /** Chroma 0..~0.3. */
  C: number;
  /** Hue 0..360. */
  H: number;
}

const rgb = (r: number, g: number, b: number): Oklch => {
  // Local sRGB → OKLCH (255-range), kept here so this module has no colour
  // dependency beyond color.ts's public helpers.
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const lr = lin(r), lg = lin(g), lb = lin(b);
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

/** Fixed status colours. Red/green/amber/blue are intentionally theme-neutral. */
export const SEMANTIC_TOKENS: Record<string, { light: Oklch; dark: Oklch }> = {
  "--destructive": { light: rgb(0.86, 0.15, 0.15), dark: rgb(0.7, 0.19, 0.2) },
  "--destructive-foreground": { light: { L: 1, C: 0, H: 0 }, dark: { L: 1, C: 0, H: 0 } },
  "--success": { light: rgb(0.22, 0.55, 0.32), dark: rgb(0.72, 0.19, 0.55) },
  "--success-foreground": { light: { L: 1, C: 0, H: 0 }, dark: { L: 0.18, C: 0, H: 0 } },
  "--warning": { light: rgb(0.95, 0.65, 0.1), dark: rgb(0.85, 0.68, 0.15) },
  "--warning-foreground": { light: { L: 0.2, C: 0, H: 0 }, dark: { L: 0.2, C: 0, H: 0 } },
  "--info": { light: rgb(0.2, 0.45, 0.85), dark: rgb(0.75, 0.62, 0.95) },
  "--info-foreground": { light: { L: 1, C: 0, H: 0 }, dark: { L: 0.18, C: 0, H: 0 } },
};

/**
 * Text-on-surface pairs that must reach WCAG AA. "text" nudges the text while
 * keeping the page surface intact; "surface" keeps the near-white/near-black
 * foreground and adjusts the brand surface so it doesn't turn muddy.
 */
export const AA_PAIRS: Array<[text: string, surface: string, adjust: "text" | "surface"]> = [
  ["--foreground", "--background", "text"],
  ["--card-foreground", "--card", "text"],
  ["--popover-foreground", "--popover", "text"],
  ["--primary-foreground", "--primary", "surface"],
  ["--secondary-foreground", "--secondary", "surface"],
  ["--accent-foreground", "--accent", "surface"],
  ["--muted-foreground", "--background", "text"],
  ["--destructive-foreground", "--destructive", "surface"],
  ["--success-foreground", "--success", "surface"],
  ["--warning-foreground", "--warning", "surface"],
  ["--info-foreground", "--info", "surface"],
  ["--board-header-foreground", "--board-header", "surface"],
  ["--link", "--background", "text"],
  ["--link-text", "--background", "text"],
  ["--quote-text", "--background", "text"],
];

export const AA_TARGET = 4.6;

/**
 * Move `variable`'s OKLCH L (minimal shift, either direction) until the pair
 * reaches AA. Searching both directions avoids the classic failure where a
 * "darken the text" heuristic pushes a dark colour toward white on a light
 * surface. Hue is always preserved; only L is touched.
 */
export const tuneForAA = (fixed: Oklch, variable: Oklch): Oklch => {
  if (wcagContrast(variable, fixed) >= AA_TARGET) return variable;
  for (let step = 1; step <= 200; step++) {
    const delta = step * 0.005;
    for (const dir of [-1, 1]) {
      const L = Math.min(1, Math.max(0, variable.L + dir * delta));
      if (L === variable.L) continue;
      const candidate: Oklch = { ...variable, L };
      if (wcagContrast(candidate, fixed) >= AA_TARGET) return candidate;
    }
  }
  let best = variable;
  for (let c = 9; c >= 0; c--) {
    const candidate: Oklch = { ...variable, C: (variable.C * c) / 10 };
    best = candidate;
    if (wcagContrast(candidate, fixed) >= AA_TARGET) return candidate;
  }
  return best;
};

/** Add the fixed semantic tokens for a mode. */
export const withSemantic = (tokens: Record<string, Oklch>, mode: ThemeModeName): Record<string, Oklch> => {
  const out = { ...tokens };
  for (const [key, val] of Object.entries(SEMANTIC_TOKENS)) out[key] = { ...val[mode] };
  return out;
};

/**
 * Tune every AA pair and serialize to bare-OKLCH strings. `onAdjust` receives a
 * human-readable note per changed token (used by the generator's report).
 */
export const finalizeTokens = (
  tokens: Record<string, Oklch>,
  onAdjust?: (note: string) => void,
): Record<string, string> => {
  const out: Record<string, Oklch> = { ...tokens };
  for (const [textKey, surfaceKey, adjust] of AA_PAIRS) {
    const fixedKey = adjust === "text" ? surfaceKey : textKey;
    const varKey = adjust === "text" ? textKey : surfaceKey;
    const before = out[varKey];
    const after = tuneForAA(out[fixedKey], before);
    if (Math.abs(after.L - before.L) > 1e-6 || Math.abs(after.C - before.C) > 1e-6) {
      onAdjust?.(`${varKey} (${adjust} for ${fixedKey}): L ${before.L.toFixed(3)}→${after.L.toFixed(3)}`);
      out[varKey] = after;
    }
  }
  const formatted: Record<string, string> = {};
  for (const key of THEME_TOKEN_NAMES) {
    const value = out[key];
    if (value) formatted[key] = formatOklch(value);
  }
  return formatted;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Derive the full base chart (without semantic tokens) from an anchor colour.
 * This is the same chart the registry generator uses for its seeded themes.
 */
export const deriveSeedTokens = (
  seed: SeedColor,
  mode: ThemeModeName,
  style: SeedStyle,
  toneName: SeedTone = "default",
): Record<string, Oklch> => {
  const { H, C: sc } = seed;
  const tone = TONES[toneName] ?? TONES.default;
  const t = (L: number, C: number): Oklch => ({ L, C, H });

  if (style === "mono") {
    return mode === "dark"
      ? {
          "--background": t(0, 0), "--foreground": t(1, 0),
          "--card": t(0.1, 0), "--card-foreground": t(1, 0),
          "--popover": t(0.1, 0), "--popover-foreground": t(1, 0),
          "--primary": t(1, 0), "--primary-foreground": t(0, 0),
          "--secondary": t(0.22, 0), "--secondary-foreground": t(1, 0),
          "--muted": t(0.16, 0), "--muted-foreground": t(0.86, 0),
          "--accent": t(0.25, 0), "--accent-foreground": t(1, 0),
          "--border": t(0.46, 0), "--input": t(0.46, 0), "--ring": t(1, 0),
          "--board-header": t(0.1, 0), "--board-header-foreground": t(1, 0),
          "--thread-hover": t(0.18, 0), "--post-header": t(0.12, 0),
          "--quote-text": t(1, 0), "--link-text": t(0.9, 0), "--link": t(0.9, 0),
        }
      : {
          "--background": t(1, 0), "--foreground": t(0, 0),
          "--card": t(1, 0), "--card-foreground": t(0, 0),
          "--popover": t(1, 0), "--popover-foreground": t(0, 0),
          "--primary": t(0, 0), "--primary-foreground": t(1, 0),
          "--secondary": t(0.86, 0), "--secondary-foreground": t(0, 0),
          "--muted": t(0.92, 0), "--muted-foreground": t(0.24, 0),
          "--accent": t(0.88, 0), "--accent-foreground": t(0, 0),
          "--border": t(0.34, 0), "--input": t(0.34, 0), "--ring": t(0, 0),
          "--board-header": t(0, 0), "--board-header-foreground": t(1, 0),
          "--thread-hover": t(0.93, 0), "--post-header": t(0.95, 0),
          "--quote-text": t(0, 0), "--link-text": t(0, 0), "--link": t(0, 0),
        };
  }

  const pastel = style === "pastel";
  const surfaceC = (k: number, cap: number) => clamp(sc * k, 0, cap);
  const primaryC = pastel ? clamp(sc, 0.05, 0.13) : clamp(sc, 0.08, 0.22);

  if (mode === "light") {
    const bgL = pastel ? 0.976 : tone.lightBg;
    return {
      "--background": t(bgL, surfaceC(pastel ? 0.35 : 0.12, pastel ? 0.028 : 0.014)),
      "--foreground": t(pastel ? 0.3 : 0.24, surfaceC(0.18, 0.02)),
      "--card": t(tone.lightCard, surfaceC(0.1, 0.012)),
      "--card-foreground": t(pastel ? 0.3 : 0.24, surfaceC(0.18, 0.02)),
      "--popover": t(tone.lightCard, surfaceC(0.1, 0.012)),
      "--popover-foreground": t(pastel ? 0.3 : 0.24, surfaceC(0.18, 0.02)),
      "--primary": t(pastel ? 0.72 : 0.55, primaryC),
      "--primary-foreground": t(pastel ? 0.22 : 1, 0),
      "--secondary": t(pastel ? 0.94 : 0.9, surfaceC(0.4, 0.05)),
      "--secondary-foreground": t(pastel ? 0.32 : 0.26, 0),
      "--muted": t(pastel ? 0.955 : 0.94, surfaceC(0.25, 0.035)),
      "--muted-foreground": t(0.5, surfaceC(0.2, 0.03)),
      "--accent": t(pastel ? 0.93 : 0.9, surfaceC(0.5, 0.06)),
      "--accent-foreground": t(0.26, 0),
      "--border": t(pastel ? 0.9 : 0.85, surfaceC(0.35, 0.05)),
      "--input": t(pastel ? 0.9 : 0.85, surfaceC(0.35, 0.05)),
      "--ring": t(pastel ? 0.72 : 0.55, primaryC),
      "--board-header": t(pastel ? 0.66 : 0.4, clamp(sc * 0.8, 0.03, 0.16)),
      "--board-header-foreground": t(pastel ? 0.2 : 1, 0),
      "--thread-hover": t(pastel ? 0.945 : 0.93, surfaceC(0.3, 0.04)),
      "--post-header": t(pastel ? 0.96 : 0.95, surfaceC(0.25, 0.03)),
      "--quote-text": t(0.45, primaryC),
      "--link-text": t(0.5, primaryC),
      "--link": t(0.5, primaryC),
    };
  }

  return {
    "--background": t(tone.darkBg, surfaceC(0.15, 0.018)),
    "--foreground": t(0.93, surfaceC(0.12, 0.016)),
    "--card": t(tone.darkCard, surfaceC(0.12, 0.014)),
    "--card-foreground": t(0.93, surfaceC(0.12, 0.016)),
    "--popover": t(tone.darkCard, surfaceC(0.12, 0.014)),
    "--popover-foreground": t(0.93, surfaceC(0.12, 0.016)),
    "--primary": t(pastel ? 0.79 : 0.66, primaryC),
    "--primary-foreground": t(pastel || primaryC > 0.14 ? 0.18 : 0.16, 0),
    "--secondary": t(0.26, surfaceC(0.3, 0.04)),
    "--secondary-foreground": t(0.93, 0),
    "--muted": t(0.23, surfaceC(0.25, 0.03)),
    "--muted-foreground": t(0.7, surfaceC(0.2, 0.03)),
    "--accent": t(0.29, surfaceC(0.4, 0.05)),
    "--accent-foreground": t(0.93, 0),
    "--border": t(0.31, surfaceC(0.3, 0.045)),
    "--input": t(0.31, surfaceC(0.3, 0.045)),
    "--ring": t(pastel ? 0.79 : 0.66, primaryC),
    "--board-header": t(0.22, clamp(sc * 0.7, 0.03, 0.14)),
    "--board-header-foreground": t(0.93, 0),
    "--thread-hover": t(0.26, surfaceC(0.3, 0.04)),
    "--post-header": t(0.19, surfaceC(0.25, 0.03)),
    "--quote-text": t(0.74, clamp(sc * 0.8, 0.05, 0.2)),
    "--link-text": t(0.72, primaryC),
    "--link": t(0.72, primaryC),
  };
};

/** Full pipeline for a custom theme: derive → semantic → AA-tune → strings. */
export const buildCustomTokens = (
  seed: SeedColor,
  mode: ThemeModeName,
  style: SeedStyle,
): Record<string, string> => finalizeTokens(withSemantic(deriveSeedTokens(seed, mode, style), mode));

const parseToken = (value: string): Oklch | null => {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const [L, C, H] = parts.map(Number);
  if (!Number.isFinite(L) || !Number.isFinite(C) || !Number.isFinite(H)) return null;
  return { L, C, H };
};

/** WCAG ratio between two bare-OKLCH strings, for live contrast feedback. */
export const tokenContrast = (a: string, b: string): number => {
  const pa = parseToken(a);
  const pb = parseToken(b);
  if (!pa || !pb) return 0;
  return wcagContrast(pa, pb);
};

