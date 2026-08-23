import { useCallback, useEffect, useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PentagramLoader } from "@/components/PentagramLoader";
import { AchievementCard, type AchievementData, type AchievementLevel } from "@/components/AchievementCard";
import { getCached, invalidateByPrefix } from "@/integrations/api/queryCache";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/integrations/api/compat";
import { Trophy, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface AchievementRow {
  id: string;
  group_key?: string;
  title?: string;
  name: string;
  description: string;
  icon?: string;
  category: string;
  rarity?: string;
  achievement_type?: string;
  hidden?: boolean;
  sort_order?: number;
  levels?: AchievementLevel[];
}

export default function Achievements() {
  const { t } = useTranslation();
  const { userId } = useParams();
  const { user: currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [allAchievements, setAllAchievements] = useState<AchievementData[]>([]);
  const [profile, setProfile] = useState<{ username: string; avatar_url?: string | null; id: string } | null>(null);

  const isOwnProfile = currentUser?.id === userId;

  useEffect(() => {
    if (!userId) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [profileData, unlockedRows, catalogRows] = await Promise.all([
        getCached<{ username: string; avatar_url?: string | null; id: string } | null>(
          `achievements-page:profile:${userId}`,
          async () => {
            const res = await fetch(`/api/v1/profiles?id=eq.${userId}`);
            const json = await res.json();
            return json.data?.[0] ?? null;
          },
          { ttlMs: 60_000 }
        ),
        getCached<Record<string, unknown>[]>(
          `achievements-page:user:${userId}`,
          async () => {
            const res = await fetch(`/api/v1/user_achievements?user_id=eq.${userId}`);
            const json = await res.json();
            return json.data || [];
          },
          // Short TTL: unlocks arrive via WS, which dispatches
          // profile-cache:invalidate → clearQueryCache, so the page refreshes
          // immediately on unlock even with a longer TTL.
          { ttlMs: 30_000 }
        ),
        getCached<AchievementRow[]>(
          "achievements-page:catalog",
          async () => {
            const res = await fetch(`/api/v1/achievements?order=sort_order.asc`);
            const text = await res.text();
            try {
              const json = JSON.parse(text);
              return json.data || [];
            } catch {
              console.error("Failed to parse achievements catalog:", text.slice(0, 200));
              return [];
            }
          },
          // The catalog only changes on deploy (Sync mirrors it at startup),
          // so a long TTL is safe and saves requests.
          { ttlMs: 5 * 60_000 }
        ),
      ]);

      setProfile(profileData);

      // Build map of achievement_id → user progress
      const unlockedMap = new Map<string, Record<string, unknown>>();
      for (const ua of unlockedRows) {
        const a = (ua.achievements as Record<string, unknown>) || {};
        unlockedMap.set((a.id as string) || (ua.achievement_id as string), ua);
      }

      const merged: AchievementData[] = (catalogRows || []).map((a: AchievementRow) => {
        const ua = unlockedMap.get(a.id);
        const levels = a.levels || [];
        const currentLevel = (ua?.current_level as number) ?? (ua?.level as number) ?? 0;
        const levelDef = currentLevel > 0 && levels.length >= currentLevel ? levels[currentLevel - 1] : null;
        const maxLevel = levels.length || 1;

        if (ua) {
          return {
            id: a.id,
            group_key: a.group_key,
            title: a.title || a.name,
            name: a.name || "—",
            description: a.description || "",
            icon: a.icon || "sparkles",
            category: a.category || "",
            rarity: levelDef?.rarity || a.rarity || "common",
            level: currentLevel,
            current_level: currentLevel,
            maxLevel: maxLevel,
            max_level: maxLevel,
            is_pinned: ua.is_pinned || false,
            pinned_order: ua.pinned_order as number | undefined,
            unlocked_at: ua.unlocked_at as string | undefined,
            progress_current: ua.progress_current as number | undefined,
            achievement_type: a.achievement_type || "one_time",
            hidden: a.hidden || false,
            locked: false,
            levels: levels,
          } as AchievementData;
        }

        // Locked: show first level info
        const firstLevel = levels.length > 0 ? levels[0] : null;
        return {
          id: a.id,
          group_key: a.group_key,
          title: a.title || a.name,
          name: a.name || "—",
          description: a.description || "",
          icon: a.icon || "sparkles",
          category: a.category || "",
          rarity: firstLevel?.rarity || a.rarity || "common",
          level: 0,
          current_level: 0,
          maxLevel: maxLevel,
          max_level: maxLevel,
          locked: true,
          hidden: a.hidden || false,
          progress_current: 0,
          achievement_type: a.achievement_type || "one_time",
          levels: levels,
        } as AchievementData;
      });

      setAllAchievements(merged);
    } catch (error) {
      console.error("Error loading achievements:", error);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const togglePin = async (achievementId: string) => {
    // Optimistic flip: update the local state immediately so the pin button
    // responds without reloading the page.
    setAllAchievements((prev) =>
      prev.map((a) => (a.id === achievementId ? { ...a, is_pinned: !a.is_pinned } : a))
    );
    try {
      const { error } = await api.rpc("toggle_achievement_pin", {
        _user_id: userId,
        _achievement_id: achievementId,
      });
      if (error) throw new Error(error.message || "Failed to toggle pin");
      // Drop the cached user rows so a later visit doesn't resurrect the
      // stale pin state, and refresh the header counter quietly.
      invalidateByPrefix(`achievements-page:user:${userId}`);
      // Re-fetch silently (no loading spinner) to reconcile with the server.
      try {
        const res = await fetch(`/api/v1/user_achievements?user_id=eq.${userId}`);
        const json = await res.json();
        const rows = (json.data || []) as Record<string, unknown>[];
        const pinned = new Set(
          rows.filter((ua) => ua.is_pinned).map((ua) => (ua.achievements as Record<string, unknown>)?.id as string)
        );
        setAllAchievements((prev) => prev.map((a) => ({ ...a, is_pinned: pinned.has(a.id) })));
      } catch {
        // Optimistic state already applied — ignore reconcile errors.
      }
    } catch (error) {
      // Roll back the optimistic flip on failure.
      setAllAchievements((prev) =>
        prev.map((a) => (a.id === achievementId ? { ...a, is_pinned: !a.is_pinned } : a))
      );
      console.error("Error toggling achievement pin:", error);
    }
  };

  // Visible achievements: locked secrets stay hidden until unlocked.
  const visible = useMemo(() => {
    return allAchievements
      .filter((a) => !(a.hidden && a.locked))
      .sort((a, b) => {
        if (!a.locked && b.locked) return -1;
        if (a.locked && !b.locked) return 1;
        return 0;
      });
  }, [allAchievements]);

  const unlocked = visible.filter((a) => !a.locked);
  const locked = visible.filter((a) => a.locked);
  const pinnedCount = allAchievements.filter((a) => a.is_pinned).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  return (
    <main className="max-w-3xl mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <Link
          to={`/profile/${userId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {profile ? t("achievements.backToProfile", { username: profile.username }) : t("achievements.back")}
        </Link>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
            <Trophy className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">
              {t("achievements.title")} {profile && `— ${profile.username}`}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("achievements.opened", { unlocked: unlocked.length, total: visible.length })}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${(unlocked.length / Math.max(visible.length, 1)) * 100}%` }}
          />
        </div>
      </div>

      {/* Pinned hint (own profile) */}
      {isOwnProfile && pinnedCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("achievements.pinnedCount", { count: pinnedCount })}
        </p>
      )}

      {/* Achievement grid: unlocked, then locked */}
      {unlocked.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            {t("achievements.unlockedSection")} ({unlocked.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {unlocked.map((ach) => (
              <AchievementCard
                key={ach.id}
                achievement={ach}
                onTogglePin={isOwnProfile ? togglePin : undefined}
                isEditing={isOwnProfile}
              />
            ))}
          </div>
        </section>
      )}

      {locked.length > 0 && (
        <section>
          <h2 className={cn(
            "text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3",
            unlocked.length > 0 && "pt-4"
          )}>
            {t("achievements.lockedSection")} ({locked.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {locked.map((ach) => (
              <AchievementCard
                key={ach.id}
                achievement={ach}
                onTogglePin={isOwnProfile ? togglePin : undefined}
                isEditing={isOwnProfile}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
