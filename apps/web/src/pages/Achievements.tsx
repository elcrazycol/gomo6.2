import { useEffect, useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PentagramLoader } from "@/components/PentagramLoader";
import { AchievementCard, type AchievementData, type AchievementLevel } from "@/components/AchievementCard";
import { getCached } from "@/integrations/api/queryCache";
import { Search, X, Trophy, Lock, ArrowLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Categories mirror the catalog's Category enum (backend achievements package).
const CATEGORIES: Record<string, { key: string; icon: string }> = {
  content: { key: "content", icon: "💬" },
  community: { key: "community", icon: "🌐" },
  retention: { key: "retention", icon: "📅" },
  profile: { key: "profile", icon: "👤" },
  integrations: { key: "integrations", icon: "🎵" },
  gifts: { key: "gifts", icon: "🎁" },
  secret: { key: "secret", icon: "✨" },
};

const RARITY_ORDER: Record<string, number> = {
  legendary: 5,
  epic: 4,
  rare: 3,
  uncommon: 2,
  common: 1,
};

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
  const [loading, setLoading] = useState(true);
  const [allAchievements, setAllAchievements] = useState<AchievementData[]>([]);
  const [profile, setProfile] = useState<{ username: string; avatar_url?: string | null; id: string } | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [showLocked, setShowLocked] = useState(true);
  const [showSecret, setShowSecret] = useState(true);

  useEffect(() => {
    if (!userId) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const loadData = async () => {
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
  };

  // Localized display name for search: the catalog stores i18n keys, so the
  // raw name/description fields are keys, not text the user sees.
  const localizeLevel = (a: AchievementData): { name: string; description: string } => {
    const lvl = a.level && a.level > 0 && a.levels && a.levels[a.level - 1]
      ? a.levels[a.level - 1]
      : a.levels && a.levels.length > 0
      ? a.levels[0]
      : undefined;
    const name = lvl?.name_key
      ? t(lvl.name_key)
      : lvl?.name || (a.title ? t(a.title) : a.name);
    const description = lvl?.description_key
      ? t(lvl.description_key)
      : lvl?.description || a.description;
    return { name, description };
  };

  const filtered = useMemo(() => {
    let list = allAchievements;

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((a) => {
        const { name, description } = localizeLevel(a);
        return (
          name.toLowerCase().includes(q) ||
          description.toLowerCase().includes(q)
        );
      });
    }

    if (categoryFilter) {
      list = list.filter((a) => a.category === categoryFilter);
    }

    if (!showLocked) {
      list = list.filter((a) => !a.locked);
    }

    // Secret filter: when off, hide hidden achievements
    const filteredList = list.filter((a) => {
      if (a.hidden && !showSecret) return false;
      return true;
    });

    // Sort: unlocked first, then by rarity (desc), then by sort_order
    return filteredList.sort((a, b) => {
      if (!a.locked && b.locked) return -1;
      if (a.locked && !b.locked) return 1;
      return (RARITY_ORDER[b.rarity || "common"] || 0) - (RARITY_ORDER[a.rarity || "common"] || 0);
    });
  }, [allAchievements, search, categoryFilter, showLocked, showSecret, t]);

  const stats = useMemo(() => {
    const total = allAchievements.length;
    const unlocked = allAchievements.filter((a) => !a.locked).length;
    return { total, unlocked };
  }, [allAchievements]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  return (
    <main className="max-w-5xl mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="space-y-3">
        {/* Back link */}
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
              {t("achievements.opened", { unlocked: stats.unlocked, total: stats.total })}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${(stats.unlocked / Math.max(stats.total, 1)) * 100}%` }}
          />
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={t("achievements.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              aria-label={t("achievements.clearSearch")}
              className="absolute right-3 top-1/2 -translate-y-1/2"
            >
              <X className="w-4 h-4 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>

        {/* Category chips */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCategoryFilter(null)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
              !categoryFilter
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            {t("achievements.all")}
          </button>
          {Object.entries(CATEGORIES).map(([key, cat]) => (
            <button
              key={key}
              onClick={() => setCategoryFilter(categoryFilter === key ? null : key)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                categoryFilter === key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
            >
              {cat.icon} {t(`achievements.category.${cat.key}`)}
            </button>
          ))}
        </div>

        {/* Toggle options */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showLocked}
              onChange={(e) => setShowLocked(e.target.checked)}
              className="rounded border-muted-foreground/30"
            />
            <Lock className="w-3.5 h-3.5" />
            <span>{t("achievements.showLocked")}</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showSecret}
              onChange={(e) => setShowSecret(e.target.checked)}
              className="rounded border-muted-foreground/30"
            />
            <span>{t("achievements.showSecrets")}</span>
          </label>
        </div>
      </div>

      {/* Achievement grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Trophy className="w-16 h-16 mx-auto mb-4 opacity-20" />
          <p className="text-sm">{t("achievements.nothingFound")}</p>
        </div>
      ) : (
        <>
          {/* Unlocked section */}
          {filtered.some((a) => !a.locked) && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                {t("achievements.unlockedSection")} ({filtered.filter((a) => !a.locked).length})
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filtered
                  .filter((a) => !a.locked)
                  .map((ach) => (
                    <AchievementCard key={ach.id} achievement={ach} />
                  ))}
              </div>
            </section>
          )}

          {/* Locked section */}
          {filtered.some((a) => a.locked) && showLocked && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                {t("achievements.lockedSection")} ({filtered.filter((a) => a.locked).length})
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filtered
                  .filter((a) => a.locked)
                  .map((ach) => (
                    <AchievementCard key={ach.id} achievement={ach} />
                  ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
