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
} from "../src/theme/derive";

/* ── Theme catalogue ─────────────────────────────────────────────────────── */

type Group = "calm" | "pastel" | "vivid" | "mineral" | "neon" | "retro" | "a11y" | "dark";
type Mode = "light" | "dark";
type FontKind = "sans" | "serif" | "mono" | "rounded";
type Texture = "none" | "scanlines" | "grid" | "dots";

interface Character {
  radius: string;
  font?: FontKind;
  texture?: Texture;
}

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
  modes: Mode[];
}

const SEED_THEMES: SeedTheme[] = [
  // Pastel
  { id: "blush", group: "pastel", nameKey: "themeBlush", seed: { L: 0.72, C: 0.11, H: 355 }, style: "pastel", modes: ["light", "dark"], radius: "1.25rem", font: "rounded" },
  { id: "sage", group: "pastel", nameKey: "themeSage", seed: { L: 0.72, C: 0.09, H: 150 }, style: "pastel", modes: ["light", "dark"], radius: "1.25rem", font: "rounded" },
  { id: "sky", group: "pastel", nameKey: "themeSky", seed: { L: 0.72, C: 0.1, H: 235 }, style: "pastel", modes: ["light", "dark"], radius: "1.25rem", font: "rounded" },
  { id: "peach", group: "pastel", nameKey: "themePeach", seed: { L: 0.76, C: 0.12, H: 55 }, style: "pastel", modes: ["light", "dark"], radius: "1.25rem", font: "rounded" },
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
    const { strings, raw } = compile(seed.id, deriveSeedTokens(seed.seed, mode, seed.style), mode);
    theme.modes[mode] = strings;
    theme.raw[mode] = raw;
  }
  emitted.push(theme);
}

/* ── Emit ────────────────────────────────────────────────────────────────── */

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

for (const theme of emitted) {
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
out.push('  group: "calm" | "pastel" | "vivid" | "mineral" | "neon" | "retro" | "a11y" | "dark";');
out.push("  nameKey: string;");
out.push("  radius: string;");
out.push('  font?: "sans" | "serif" | "mono" | "rounded";');
out.push('  texture?: "none" | "scanlines" | "grid" | "dots";');
out.push("}");
out.push("");
out.push("export const THEME_META: Record<string, ThemeMeta> = {");
for (const theme of emitted) {
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

for (const theme of emitted) {
  css.push(`[data-theme="${theme.id}"] { --radius: ${theme.radius}; }`);
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

process.stderr.write(`\nThemes: ${emitted.length} (legacy ${THEME_IDS.length}, new ${SEED_THEMES.length})\n`);
process.stderr.write(`AA adjustments: ${adjustments.length}\n`);
process.stderr.write(`Failures below AA: ${failures.length}\n`);
for (const line of failures) process.stderr.write(`  ${line}\n`);
process.stderr.write(`\nWrote:\n  ${registryPath}\n  ${cssPath}\n`);

