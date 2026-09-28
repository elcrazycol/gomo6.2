import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import i18n from "@/i18n";
import { api } from "@/integrations/api/compat";

/**
 * Privacy settings, backed by `privacy_settings` (one row per user).
 *
 * Unlike appearance (localStorage, applies instantly), privacy lives in the
 * database and is saved explicitly: this hook keeps the last *saved* row and a
 * *draft* the UI edits, so the section can show "unsaved changes" and a Save
 * button. localStorage is deliberately NOT used any more — the old page kept a
 * localStorage copy as a second source of truth and merged it over the row,
 * which meant a stale local value silently shadowed the database (and the two
 * could never be reconciled). Polling every 30s is gone too.
 *
 * `stats_visibility` is included in the write payload — the old page dropped it
 * (and every column not listed in its hand-written `dbData`), so the
 * per-metric stat toggles never reached the server. The payload is derived from
 * a single key list, so a new column cannot be forgotten again.
 */

export interface PrivacySettings {
  show_online_status: boolean;
  show_profile_wall: boolean;
  allow_wall_posts_from_others: boolean;
  show_profile_stats: boolean;
  show_detailed_stats: boolean;
  remove_image_metadata: boolean;
  stats_visibility: Record<string, boolean>;
  private_profile: boolean;
  private_hide_avatar: boolean;
  private_hide_wall: boolean;
  private_hide_threads: boolean;
  private_hide_stats: boolean;
  private_hide_friends: boolean;
  private_hide_gifts: boolean;
  private_hide_achievements: boolean;
}

/** Boolean columns written to the row, in one place (see the module note). */
const BOOLEAN_KEYS = [
  "show_online_status",
  "show_profile_wall",
  "allow_wall_posts_from_others",
  "show_profile_stats",
  "show_detailed_stats",
  "remove_image_metadata",
  "private_profile",
  "private_hide_avatar",
  "private_hide_wall",
  "private_hide_threads",
  "private_hide_stats",
  "private_hide_friends",
  "private_hide_gifts",
  "private_hide_achievements",
] as const satisfies readonly (keyof PrivacySettings)[];

type PrivacyBooleanKey = (typeof BOOLEAN_KEYS)[number];

/** Per-metric visibility toggles under "detailed stats", in display order. */
export const STAT_VISIBILITY_KEYS = [
  "garma",
  "posts",
  "threads",
  "postLikes",
  "threadLikes",
  "replies",
  "time",
] as const;

export type StatVisibilityKey = (typeof STAT_VISIBILITY_KEYS)[number];

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  show_online_status: true,
  show_profile_wall: true,
  allow_wall_posts_from_others: true,
  show_profile_stats: false,
  show_detailed_stats: false,
  // The DB column defaults to false, but the image pipeline falls back to
  // "strip metadata" when no row exists — keep the privacy-safe default.
  remove_image_metadata: true,
  stats_visibility: Object.fromEntries(STAT_VISIBILITY_KEYS.map((key) => [key, false])),
  private_profile: false,
  // Matches the server's COALESCE defaults (privacy.SettingsFlagColumns).
  private_hide_avatar: false,
  private_hide_wall: false,
  private_hide_threads: true,
  private_hide_stats: false,
  private_hide_friends: true,
  private_hide_gifts: true,
  private_hide_achievements: true,
};

const parseStatsVisibility = (raw: unknown): Record<string, boolean> => {
  let source: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") source = parsed as Record<string, unknown>;
    } catch {
      source = {};
    }
  } else if (raw && typeof raw === "object") {
    source = raw as Record<string, unknown>;
  }
  return Object.fromEntries(STAT_VISIBILITY_KEYS.map((key) => [key, source[key] === true]));
};

const normalize = (row: Record<string, unknown> | undefined): PrivacySettings => {
  if (!row) return DEFAULT_PRIVACY_SETTINGS;
  const next = { ...DEFAULT_PRIVACY_SETTINGS, stats_visibility: parseStatsVisibility(row.stats_visibility) };
  for (const key of BOOLEAN_KEYS) {
    const value = row[key];
    if (typeof value === "boolean") next[key] = value;
  }
  return next;
};

const toDbPayload = (settings: PrivacySettings): Record<string, unknown> => {
  const payload: Record<string, unknown> = {};
  for (const key of BOOLEAN_KEYS) payload[key] = settings[key];
  payload.stats_visibility = Object.fromEntries(
    STAT_VISIBILITY_KEYS.map((key) => [key, settings.stats_visibility[key] === true]),
  );
  return payload;
};

const authHeaders = async (): Promise<Record<string, string>> => {
  const token = (await api.auth.getSession()).data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const usePrivacySettings = (userId?: string | null) => {
  const [saved, setSaved] = useState<PrivacySettings>(DEFAULT_PRIVACY_SETTINGS);
  const [draft, setDraft] = useState<PrivacySettings>(DEFAULT_PRIVACY_SETTINGS);
  const [loading, setLoading] = useState(Boolean(userId));
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/privacy_settings?user_id=eq.${userId}`, {
        headers: await authHeaders(),
      });
      const json = (await res.json()) as { data?: Record<string, unknown>[] };
      const row = json.data?.[0];
      let next = normalize(row);

      // No row yet (fresh account): create one so the flags the public
      // /users/:id/privacy endpoint serves match what the UI shows.
      if (!row) {
        const created = await fetch("/api/v1/privacy_settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify({ user_id: userId, ...toDbPayload(next) }),
        });
        if (created.ok) {
          const createdJson = (await created.json()) as { data?: Record<string, unknown> };
          next = normalize(createdJson.data);
        }
      }

      setSaved(next);
      setDraft(next);
    } catch (error) {
      console.error("Failed to load privacy settings", error);
      toast.error(i18n.t("settings2.privacyLoadError"));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const setBoolean = useCallback((key: PrivacyBooleanKey, value: boolean) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const setStatVisibility = useCallback((key: StatVisibilityKey, value: boolean) => {
    setDraft((prev) => ({ ...prev, stats_visibility: { ...prev.stats_visibility, [key]: value } }));
  }, []);

  const changedKeys = useMemo(() => {
    const changed: string[] = [];
    for (const key of BOOLEAN_KEYS) {
      if (draft[key] !== saved[key]) changed.push(key);
    }
    for (const key of STAT_VISIBILITY_KEYS) {
      if ((draft.stats_visibility[key] ?? false) !== (saved.stats_visibility[key] ?? false)) {
        changed.push(`stats:${key}`);
      }
    }
    return changed;
  }, [draft, saved]);

  const dirty = changedKeys.length > 0;

  const save = useCallback(async () => {
    if (!userId || !dirty) return;
    setSaving(true);
    try {
      const payload = toDbPayload(draft);
      const headers = { "Content-Type": "application/json", ...(await authHeaders()) };
      let res = await fetch(`/api/v1/privacy_settings?user_id=eq.${userId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(payload),
      });
      // No row to update → create it (same upsert the old page did, minus the
      // silent localStorage fallback that hid failures).
      if (!res.ok) {
        res = await fetch("/api/v1/privacy_settings", {
          method: "POST",
          headers,
          body: JSON.stringify({ user_id: userId, ...payload }),
        });
      }
      if (!res.ok) throw new Error(await res.text());

      setSaved(draft);
      toast.success(i18n.t("settings2.privacySaved"));
    } catch (error) {
      console.error("Failed to save privacy settings", error);
      toast.error(i18n.t("settings2.privacySaveError"));
    } finally {
      setSaving(false);
    }
  }, [dirty, draft, userId]);

  /**
   * Restore defaults in the draft. Deliberately does not hit the server — the
   * user reviews the result and commits with Save, so a misclick cannot
   * silently reopen a profile.
   */
  const reset = useCallback(() => {
    setDraft(DEFAULT_PRIVACY_SETTINGS);
    toast.message(i18n.t("settings2.privacyResetHint"));
  }, []);

  return {
    settings: draft,
    loading,
    saving,
    dirty,
    changedCount: changedKeys.length,
    setBoolean,
    setStatVisibility,
    save,
    reset,
    reload: load,
  };
};

export type PrivacySettingsController = ReturnType<typeof usePrivacySettings>;
