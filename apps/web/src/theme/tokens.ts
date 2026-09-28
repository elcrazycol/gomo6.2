/**
 * Canonical theme token surface.
 *
 * Every token is a bare OKLCH triplet ("L C H", e.g. "0.627 0.131 145.2") so
 * Tailwind can compose it as `oklch(var(--token) / <alpha-value>)` and raw CSS
 * can do `oklch(var(--token) / 0.6)`. Values are produced by the theme registry
 * (src/theme/registry.ts) — nothing else may define them.
 */

export const THEME_TOKEN_NAMES = [
  // base surfaces
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  // brand / actions
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--accent",
  "--accent-foreground",
  // status
  "--destructive",
  "--destructive-foreground",
  "--success",
  "--success-foreground",
  "--warning",
  "--warning-foreground",
  "--info",
  "--info-foreground",
  // structure
  "--muted",
  "--muted-foreground",
  "--border",
  "--input",
  "--ring",
  // app-specific surfaces
  "--board-header",
  "--board-header-foreground",
  "--thread-hover",
  "--post-header",
  "--quote-text",
  "--link-text",
  "--link",
] as const;

export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number];

export type ThemeTokens = Record<ThemeTokenName, string>;

/** Fast membership test used by sanitizers and the theme builder. */
export const isThemeTokenName = (value: string): value is ThemeTokenName =>
  (THEME_TOKEN_NAMES as readonly string[]).includes(value);
