// Minimal runtime feature flags.
//
// There is deliberately no backend/config infrastructure: flags are a compiled
// default plus an optional per-browser override, so the team can enable a
// feature on production (or reproduce a bug) without a deploy by setting
// `localStorage["gomo6:flags"] = {"wallInlineMedia": true}` in devtools.
//
// The override map is merged over the defaults on every read, so flipping a
// flag in devtools takes effect on the next render/refresh — no cache to bust.
// For a server-driven runtime config later, replace `readOverrides`; callers
// (isFeatureEnabled) do not change.

/** Compiled defaults. A flag must default to `false` (off) until it is ready. */
export const DEFAULT_FEATURE_FLAGS = {
  /**
   * Inline media blocks (photo/video/audio/file) placed directly inside the
   * wall post document instead of a gallery rendered under the text.
   *
   * Consumed by the wall composer (P1) and by the render policy in the wall
   * cards: when off, a post's attachments keep rendering as the legacy bottom
   * gallery even if its document happens to contain media nodes (kill-switch).
   */
  wallInlineMedia: false,
} as const;

export type FeatureFlags = typeof DEFAULT_FEATURE_FLAGS;
export type FeatureFlagName = keyof FeatureFlags;

/** localStorage key holding the JSON override map. */
export const FEATURE_FLAGS_STORAGE_KEY = "gomo6:flags";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Read the override map from localStorage. Never throws (private mode, quota). */
const readOverrides = (): Partial<FeatureFlags> => {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(FEATURE_FLAGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return isPlainObject(parsed) ? (parsed as Partial<FeatureFlags>) : {};
  } catch {
    return {};
  }
};

/**
 * The effective flags: compiled defaults merged with the localStorage override.
 * Only known flags are read, so a stray key in the override map is ignored.
 */
export const getFeatureFlags = (): FeatureFlags => {
  const overrides = readOverrides();
  const result = { ...DEFAULT_FEATURE_FLAGS } as FeatureFlags;
  for (const name of Object.keys(DEFAULT_FEATURE_FLAGS) as FeatureFlagName[]) {
    const override = overrides[name];
    if (typeof override === "boolean") {
      (result as Record<FeatureFlagName, boolean>)[name] = override;
    }
  }
  return result;
};

export const isFeatureEnabled = (flag: FeatureFlagName): boolean => getFeatureFlags()[flag];

/** Persist a single override (used by tooling / tests; safe in the browser). */
export const setFeatureFlagOverride = (flag: FeatureFlagName, value: boolean): void => {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  const overrides = { ...readOverrides(), [flag]: value };
  try {
    window.localStorage.setItem(FEATURE_FLAGS_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Storage unavailable — the compiled default still applies.
  }
};

export const clearFeatureFlagOverrides = (): void => {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  try {
    window.localStorage.removeItem(FEATURE_FLAGS_STORAGE_KEY);
  } catch {
    // ignore
  }
};
