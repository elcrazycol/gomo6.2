/**
 * Theme compiler.
 *
 * Turns the catalogue below into:
 *   - src/theme/registry.data.ts  (OKLCH token map + metadata)
 *   - src/theme/theme.css         (tokens + character as [data-theme] rules)
 *
 * The derivation and AA-tuning live in src/theme/derive.ts, shared with the
 * in-app theme constructor — a theme built in the app and one shipped here are
 * produced by the exact same maths.
 *
 * Run: cd apps/web && npx vite-node scripts/gen-theme-registry.mts
 */
import { themeTokenMap, THEME_IDS, type ColorTheme } from "./legacy-theme-hsl";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hslToOklch, parseOklch, wcagContrast, type Oklch } from "../src/theme/color";
import {
  AA_PAIRS,
  deriveSeedTokens,
  finalizeTokens,
  withSemantic,
  type SeedStyle,
  type SeedTone,
} from "../src/theme/derive";

/* ── Theme catalogue ─────────────────────────────────────────────────────── */

type Group = "calm" | "pastel" | "neutral" | "vivid" | "mineral" | "neon" | "retro" | "a11y" | "dark";
type Mode = "light" | "dark";
type FontKind = "sans" | "serif" | "mono" | "rounded";
type Texture = "none" | "scanlines" | "grid" | "dots";

interface Character {
  radius: string;
  font?: FontKind;
  texture?: Texture;
}

/* ── Surface / material profiles ─────────────────────────────────────────── */

/**
 * A theme's "material": how panels, cards and the header are painted. This is
 * what makes themes feel different beyond hue — glass blurs, flat/outlined stay
 * opaque, neon glows, paper grains, contrast hardens.
 */
type SurfaceProfile = "glass" | "flat" | "outlined" | "elevated" | "neon" | "paper" | "terminal" | "contrast" | "mineral";

interface Surface {
  blur: string;
  saturate: string;
  /** Panel background alpha (1 = opaque). */
  alpha: string;
  /** How much of the card colour is kept vs. mixed with the background. */
  tint: string;
  borderWidth: string;
  borderAlpha: string;
  shadow: string;
  glow: string;
  /** 1 = keep the header's noise grain, 0 = none. */
  grain: string;
  /** Header sheen/streak layers (glass) or none (flat materials). */
  sheen: string;
}

const GLASS_SHEEN =
  "radial-gradient(130% 190% at 14% -55%, hsl(0 0% 100% / 0.18), transparent 58%), linear-gradient(103deg, transparent 38%, hsl(0 0% 100% / 0.06) 49%, transparent 61%), linear-gradient(to bottom, hsl(0 0% 100% / 0.05), hsl(0 0% 0% / 0.06))";

const SURFACE_PRESETS: Record<SurfaceProfile, Surface> = {
  glass: {
    blur: "16px", saturate: "160%", alpha: "0.72", tint: "55%",
    borderWidth: "1px", borderAlpha: "0.7",
    shadow: "0 1px 2px rgb(0 0 0 / 0.08)", glow: "none", grain: "1", sheen: GLASS_SHEEN,
  },
  flat: {
    blur: "0px", saturate: "100%", alpha: "1", tint: "100%",
    borderWidth: "1px", borderAlpha: "0.9",
    shadow: "none", glow: "none", grain: "0", sheen: "none",
  },
  outlined: {
    blur: "0px", saturate: "100%", alpha: "1", tint: "100%",
    borderWidth: "1px", borderAlpha: "1",
    shadow: "none", glow: "none", grain: "0", sheen: "none",
  },
  elevated: {
    blur: "0px", saturate: "100%", alpha: "1", tint: "100%",
    borderWidth: "1px", borderAlpha: "0.6",
    shadow: "0 12px 32px -16px rgb(0 0 0 / 0.45)", glow: "none", grain: "0", sheen: "none",
  },
  neon: {
    blur: "0px", saturate: "100%", alpha: "1", tint: "100%",
    borderWidth: "1px", borderAlpha: "0.8",
    shadow: "none", glow: "0 0 18px oklch(var(--primary) / 0.45)", grain: "0", sheen: "none",
  },
  paper: {
    blur: "0px", saturate: "100%", alpha: "1", tint: "100%",
    borderWidth: "1px", borderAlpha: "1",
    shadow: "none", glow: "none", grain: "1", sheen: "linear-gradient(to bottom, oklch(var(--card) / 0.5), transparent)",
  },
  terminal: {
    blur: "0px", saturate: "100%", alpha: "1", tint: "100%",
    borderWidth: "1px", borderAlpha: "0.9",
    shadow: "none", glow: "0 0 14px oklch(var(--primary) / 0.35)", grain: "0", sheen: "none",
  },
  contrast: {
    blur: "0px", saturate: "100%", alpha: "1", tint: "100%",
    borderWidth: "2px", borderAlpha: "1",
    shadow: "none", glow: "none", grain: "0", sheen: "none",
  },
  mineral: {
    blur: "0px", saturate: "100%", alpha: "1", tint: "96%",
    borderWidth: "1px", borderAlpha: "0.8",
    shadow: "0 12px 30px -14px rgb(0 0 0 / 0.4)", glow: "none", grain: "0",
    sheen: "linear-gradient(120deg, oklch(var(--card) / 0.7), transparent 45%)",
  },
};

const SURFACE_BY_THEME: Record<string, SurfaceProfile> = {
  // Neutral / minimal — flat and outlined, no glass at all.
  graphite: "flat",
  linen: "flat",
  ash: "flat",
  sand: "flat",
  mint: "flat",
  slate: "outlined",
  charcoal: "outlined",
  // Materials.
  glass: "glass",
  obsidian: "mineral",
  terminal: "terminal",
  synthwave: "neon",
  paper: "paper",
  contrast: "contrast",
  contrastLight: "contrast",
  // Colour.
  pink: "glass",
  lavender: "glass",
  cannabis: "elevated",
  volcanic: "outlined",
};

const DEFAULT_SURFACE_PROFILE: SurfaceProfile = "glass";

/**
 * Curated cull: themes removed to keep the set unique. Kept here (not deleted
 * from the catalogue) so the decision is visible in one place; flip an id out
 * of this set to bring a theme back.
 */
const REMOVED_THEME_IDS = new Set<string>([
  "blue", "blood", "pumpkin", "glitch", "acid", "void",
  "sage", "sky", "fog", "blush", "peach",
  "quartz", "jade", "ink", "espresso",
]);

/** Page background layers (fixed). Themes may add a gradient or pattern. */
const BG_IMAGE_BY_THEME: Record<string, string> = {
  glass:
    "radial-gradient(60% 55% at 12% 0%, oklch(var(--primary) / 0.28), transparent 60%), radial-gradient(55% 50% at 88% 8%, oklch(var(--accent) / 0.24), transparent 55%), radial-gradient(70% 60% at 50% 110%, oklch(var(--secondary) / 0.2), transparent 60%)",
  lavender:
    "radial-gradient(70% 55% at 15% 0%, oklch(var(--primary) / 0.18), transparent 60%), radial-gradient(60% 50% at 90% 10%, oklch(var(--accent) / 0.16), transparent 55%)",
  pink: "radial-gradient(70% 55% at 80% 0%, oklch(var(--primary) / 0.14), transparent 62%)",
  cannabis: "radial-gradient(70% 55% at 20% 0%, oklch(var(--primary) / 0.12), transparent 62%)",
  volcanic: "radial-gradient(80% 60% at 50% 115%, oklch(var(--primary) / 0.16), transparent 62%)",
  synthwave:
    "linear-gradient(oklch(var(--primary) / 0.08) 1px, transparent 1px), linear-gradient(90deg, oklch(var(--primary) / 0.08) 1px, transparent 1px)",
  paper:
    "radial-gradient(120% 90% at 20% 0%, oklch(var(--card) / 0.6), transparent 55%), radial-gradient(100% 80% at 100% 100%, oklch(var(--muted) / 0.5), transparent 50%)",
  obsidian:
    "radial-gradient(90% 70% at 85% 0%, oklch(var(--primary) / 0.12), transparent 55%)",
};
const BG_SIZE_BY_THEME: Record<string, string> = { synthwave: "28px 28px" };
const BG_REPEAT_BY_THEME: Record<string, string> = { synthwave: "repeat" };


const DEFAULT_ID: ColorTheme = "graphite";

interface LegacyMeta extends Character {
  group: Group;
  nameKey: string;
}

const LEGACY_META: Record<ColorTheme, LegacyMeta> = {
  graphite: { group: "calm", nameKey: "themeGraphite", radius: "0.25rem" },
  blue: { group: "calm", nameKey: "themeBlue", radius: "0.25rem" },
  lavender: { group: "calm", nameKey: "themeLavender", radius: "1rem", font: "rounded" },
  mint: { group: "calm", nameKey: "themeMint", radius: "0.75rem" },
  volcanic: { group: "calm", nameKey: "themeVolcanic", radius: "0.125rem", texture: "dots" },
  cannabis: { group: "vivid", nameKey: "themeCannabis", radius: "0.5rem" },
  pink: { group: "vivid", nameKey: "themePink", radius: "1rem", font: "rounded" },
  pumpkin: { group: "vivid", nameKey: "themePumpkin", radius: "0.5rem" },
  blood: { group: "vivid", nameKey: "themeBlood", radius: "0.125rem" },
  glitch: { group: "neon", nameKey: "themeGlitch", radius: "0", font: "mono", texture: "scanlines" },
  acid: { group: "neon", nameKey: "themeAcid", radius: "0", font: "mono", texture: "grid" },
  void: { group: "dark", nameKey: "themeVoid", radius: "0.125rem" },
};

interface SeedTheme extends Character {
  id: string;
  group: Group;
  nameKey: string;
  seed: Oklch;
  style: SeedStyle;
  tone?: SeedTone;
  modes: Mode[];
}

const SEED_THEMES: SeedTheme[] = [
  // Material
  { id: "glass", group: "calm", nameKey: "themeGlass", seed: { L: 0.62, C: 0.13, H: 275 }, style: "soft", modes: ["light", "dark"], radius: "1rem" },
  // Pastel
  { id: "blush", group: "pastel", nameKey: "themeBlush", seed: { L: 0.72, C: 0.11, H: 355 }, style: "pastel", modes: ["light", "dark"], radius: "1.25rem", font: "rounded" },
  { id: "sage", group: "pastel", nameKey: "themeSage", seed: { L: 0.72, C: 0.09, H: 150 }, style: "pastel", modes: ["light", "dark"], radius: "1.25rem", font: "rounded" },
  { id: "sky", group: "pastel", nameKey: "themeSky", seed: { L: 0.72, C: 0.1, H: 235 }, style: "pastel", modes: ["light", "dark"], radius: "1.25rem", font: "rounded" },
  { id: "peach", group: "pastel", nameKey: "themePeach", seed: { L: 0.76, C: 0.12, H: 55 }, style: "pastel", modes: ["light", "dark"], radius: "1.25rem", font: "rounded" },
  // Neutral tonal (paper-like minimalism, different depth/temperature)
  { id: "linen", group: "neutral", nameKey: "themeLinen", seed: { L: 0.55, C: 0.02, H: 80 }, style: "soft", tone: "paper", modes: ["light"], radius: "0.125rem" },
  { id: "ash", group: "neutral", nameKey: "themeAsh", seed: { L: 0.6, C: 0, H: 0 }, style: "soft", tone: "default", modes: ["light", "dark"], radius: "0.25rem" },
  { id: "fog", group: "neutral", nameKey: "themeFog", seed: { L: 0.62, C: 0.015, H: 245 }, style: "soft", tone: "default", modes: ["light", "dark"], radius: "0.25rem" },
  { id: "sand", group: "neutral", nameKey: "themeSand", seed: { L: 0.7, C: 0.03, H: 75 }, style: "soft", tone: "soft", modes: ["light", "dark"], radius: "0.25rem" },
  { id: "slate", group: "neutral", nameKey: "themeSlate", seed: { L: 0.6, C: 0.012, H: 255 }, style: "soft", tone: "default", modes: ["light", "dark"], radius: "0.25rem" },
  { id: "charcoal", group: "neutral", nameKey: "themeCharcoal", seed: { L: 0.6, C: 0, H: 0 }, style: "soft", tone: "deep", modes: ["dark"], radius: "0.125rem" },
  { id: "ink", group: "neutral", nameKey: "themeInk", seed: { L: 0.6, C: 0.03, H: 265 }, style: "soft", tone: "deep", modes: ["dark"], radius: "0.25rem" },
  { id: "espresso", group: "neutral", nameKey: "themeEspresso", seed: { L: 0.6, C: 0.03, H: 45 }, style: "soft", tone: "deep", modes: ["dark"], radius: "0.125rem" },
  // Minerals
  { id: "obsidian", group: "mineral", nameKey: "themeObsidian", seed: { L: 0.66, C: 0.15, H: 45 }, style: "soft", modes: ["light", "dark"], radius: "0.125rem", texture: "dots" },
  { id: "quartz", group: "mineral", nameKey: "themeQuartz", seed: { L: 0.7, C: 0.05, H: 70 }, style: "soft", modes: ["light", "dark"], radius: "0.5rem" },
  { id: "jade", group: "mineral", nameKey: "themeJade", seed: { L: 0.6, C: 0.11, H: 165 }, style: "soft", modes: ["light", "dark"], radius: "0.25rem" },
  // Neon
  { id: "synthwave", group: "neon", nameKey: "themeSynthwave", seed: { L: 0.62, C: 0.24, H: 325 }, style: "soft", modes: ["light", "dark"], radius: "0.25rem", texture: "grid" },
  // Retro
  { id: "terminal", group: "retro", nameKey: "themeTerminal", seed: { L: 0.72, C: 0.19, H: 135 }, style: "soft", modes: ["dark"], radius: "0", font: "mono", texture: "scanlines" },
  { id: "paper", group: "retro", nameKey: "themePaper", seed: { L: 0.45, C: 0.09, H: 65 }, style: "soft", modes: ["light"], radius: "0.125rem", font: "serif" },
  // Accessibility
  { id: "contrast", group: "a11y", nameKey: "themeContrast", seed: { L: 0.5, C: 0, H: 0 }, style: "mono", modes: ["dark"], radius: "0" },
  { id: "contrastLight", group: "a11y", nameKey: "themeContrastLight", seed: { L: 0.5, C: 0, H: 0 }, style: "mono", modes: ["light"], radius: "0" },
];

/* ── Build ───────────────────────────────────────────────────────────────── */

const parseHslString = (value: string): Oklch => {
  const m = value.match(/^\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*$/);
  if (!m) throw new Error(`bad hsl: ${value}`);
  return hslToOklch(Number(m[1]), Number(m[2]), Number(m[3]));
};

const adjustments: string[] = [];
const failures: string[] = [];

interface EmittedTheme {
  id: string;
  group: Group;
  nameKey: string;
  radius: string;
  font?: FontKind;
  texture?: Texture;
  /** mode → finalized token strings (and raw Oklch for the :root default). */
  modes: Partial<Record<Mode, Record<string, string>>>;
  raw: Partial<Record<Mode, Record<string, Oklch>>>;
}

const compile = (
  id: string,
  raw: Record<string, Oklch>,
  mode: Mode,
): { strings: Record<string, string>; raw: Record<string, Oklch> } => {
  const withSem = withSemantic(raw, mode);
  const strings = finalizeTokens(withSem, (note) => adjustments.push(`${id}/${mode} ${note}`));
  for (const [textKey, surfaceKey] of AA_PAIRS) {
    const a = parseOklch(strings[textKey]);
    const b = parseOklch(strings[surfaceKey]);
    if (a && b && wcagContrast(a, b) < 4.5) {
      failures.push(`${id}/${mode} ${textKey} on ${surfaceKey} = ${wcagContrast(a, b).toFixed(2)}`);
    }
  }
  return { strings, raw: withSem };
};

const emitted: EmittedTheme[] = [];

for (const id of THEME_IDS) {
  const entry = themeTokenMap[id];
  const theme: EmittedTheme = { id, ...LEGACY_META[id], modes: {}, raw: {} };
  for (const mode of ["light", "dark"] as const) {
    const raw: Record<string, Oklch> = {};
    for (const [key, value] of Object.entries(entry[mode])) raw[key] = parseHslString(value);
    const { strings, raw: finalRaw } = compile(id, raw, mode);
    theme.modes[mode] = strings;
    theme.raw[mode] = finalRaw;
  }
  emitted.push(theme);
}

for (const seed of SEED_THEMES) {
  const theme: EmittedTheme = { id: seed.id, group: seed.group, nameKey: seed.nameKey, radius: seed.radius, font: seed.font, texture: seed.texture, modes: {}, raw: {} };
  for (const mode of seed.modes) {
    const { strings, raw } = compile(seed.id, deriveSeedTokens(seed.seed, mode, seed.style, seed.tone), mode);
    theme.modes[mode] = strings;
    theme.raw[mode] = raw;
  }
  emitted.push(theme);
}

/* ── Emit ────────────────────────────────────────────────────────────────── */

const kept = emitted.filter((theme) => !REMOVED_THEME_IDS.has(theme.id));

const out: string[] = [];
const css: string[] = [];
out.push("// AUTO-GENERATED by scripts/gen-theme-registry.mts — do not edit by hand.");
out.push("// Regenerate after editing the catalogue in the generator.");
out.push("");
out.push('import type { ThemeTokens } from "./tokens";');
out.push("");
out.push("export interface ThemeModeTokens {");
out.push("  light?: ThemeTokens;");
out.push("  dark?: ThemeTokens;");
out.push("}");
out.push("");
out.push("export const THEME_TOKENS: Record<string, ThemeModeTokens> = {");

css.push("/* AUTO-GENERATED by scripts/gen-theme-registry.mts — do not edit by hand. */");
css.push("/* Theme token values as bare OKLCH triplets. Consume with oklch(var(--x)). */");
css.push("");

const tokenBlock = (selector: string, tokens: Record<string, string>) => {
  const parts: string[] = [`${selector} {`];
  for (const [key, value] of Object.entries(tokens)) parts.push(`  ${key}: ${value};`);
  parts.push("}");
  return parts.join("\n");
};

for (const theme of kept) {
  out.push(`  ${theme.id}: {`);
  for (const mode of ["light", "dark"] as const) {
    if (!theme.modes[mode]) continue;
    out.push(`    ${mode}: {`);
    for (const [key, value] of Object.entries(theme.modes[mode]!)) out.push(`      ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
    out.push(`    },`);
    css.push(tokenBlock(`[data-theme="${theme.id}"][data-mode="${mode}"]`, theme.modes[mode]!));
    css.push("");
  }
  out.push(`  },`);
}
out.push("};");
out.push("");
out.push("export interface ThemeMeta {");
out.push('  group: "calm" | "pastel" | "neutral" | "vivid" | "mineral" | "neon" | "retro" | "a11y" | "dark";');
out.push("  nameKey: string;");
out.push("  radius: string;");
out.push('  font?: "sans" | "serif" | "mono" | "rounded";');
out.push('  texture?: "none" | "scanlines" | "grid" | "dots";');
out.push("}");
out.push("");
out.push("export const THEME_META: Record<string, ThemeMeta> = {");
for (const theme of kept) {
  const parts = [`group: ${JSON.stringify(theme.group)}`, `nameKey: ${JSON.stringify(theme.nameKey)}`, `radius: ${JSON.stringify(theme.radius)}`];
  if (theme.font) parts.push(`font: ${JSON.stringify(theme.font)}`);
  if (theme.texture) parts.push(`texture: ${JSON.stringify(theme.texture)}`);
  out.push(`  ${theme.id}: { ${parts.join(", ")} },`);
}
out.push("};");

// ── Character: radius / font / texture, keyed on data-theme ───────────────
const FONT_STACKS: Record<FontKind, string> = {
  sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  rounded: 'ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif',
};
const TEXTURES: Record<Exclude<Texture, "none">, string> = {
  scanlines: "repeating-linear-gradient(to bottom, rgb(0 0 0 / 0.16) 0 1px, transparent 1px 3px)",
  grid: "linear-gradient(rgb(255 255 255 / 0.05) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.05) 1px, transparent 1px)",
  dots: "radial-gradient(rgb(255 255 255 / 0.07) 1px, transparent 1px)",
};

for (const theme of kept) {
  const surface = SURFACE_PRESETS[SURFACE_BY_THEME[theme.id] ?? DEFAULT_SURFACE_PROFILE];
  css.push(`[data-theme="${theme.id}"] {`);
  css.push(`  --radius: ${theme.radius};`);
  css.push(`  --surface-blur: ${surface.blur};`);
  css.push(`  --surface-saturate: ${surface.saturate};`);
  css.push(`  --surface-alpha: ${surface.alpha};`);
  css.push(`  --surface-tint: ${surface.tint};`);
  css.push(`  --surface-border-width: ${surface.borderWidth};`);
  css.push(`  --surface-border-alpha: ${surface.borderAlpha};`);
  css.push(`  --surface-shadow: ${[surface.glow, surface.shadow].filter((s) => s && s !== "none").join(", ") || "none"};`);
  css.push(`  --surface-grain: ${surface.grain};`);
  css.push(`  --surface-sheen: ${surface.sheen};`);
  css.push(`  --bg-image: ${BG_IMAGE_BY_THEME[theme.id] ?? "none"};`);
  css.push(`  --bg-size: ${BG_SIZE_BY_THEME[theme.id] ?? "cover"};`);
  css.push(`  --bg-repeat: ${BG_REPEAT_BY_THEME[theme.id] ?? "no-repeat"};`);
  css.push("}");
  if (theme.font) css.push(`[data-theme="${theme.id}"] body { font-family: ${FONT_STACKS[theme.font]}; }`);
  if (theme.texture && theme.texture !== "none") {
    css.push(`html[data-theme="${theme.id}"]::after {`);
    css.push('  content: "";');
    css.push("  position: fixed;");
    css.push("  inset: 0;");
    css.push("  z-index: 1;");
    css.push("  pointer-events: none;");
    css.push("  opacity: 0.5;");
    css.push(`  background-image: ${TEXTURES[theme.texture]};`);
    if (theme.texture === "grid") css.push("  background-size: 22px 22px;");
    if (theme.texture === "dots") css.push("  background-size: 14px 14px;");
    css.push("}");
  }
  css.push("");
}

// Default (:root) = graphite light, so a page without attributes still renders.
css.unshift(tokenBlock(":root", emitted.find((t) => t.id === DEFAULT_ID)?.modes.light ?? {}), "");
css.unshift("/* Fallback before the pre-boot script sets data-theme/data-mode. */");

const here = dirname(fileURLToPath(import.meta.url));
const registryPath = resolve(here, "../src/theme/registry.data.ts");
const cssPath = resolve(here, "../src/theme/theme.css");
mkdirSync(dirname(registryPath), { recursive: true });
writeFileSync(registryPath, out.join("\n") + "\n");
writeFileSync(cssPath, css.join("\n") + "\n");

process.stderr.write(`\nThemes: ${kept.length} (legacy ${THEME_IDS.length}, new ${SEED_THEMES.length})\n`);
process.stderr.write(`AA adjustments: ${adjustments.length}\n`);
process.stderr.write(`Failures below AA: ${failures.length}\n`);
for (const line of failures) process.stderr.write(`  ${line}\n`);
process.stderr.write(`\nWrote:\n  ${registryPath}\n  ${cssPath}\n`);

