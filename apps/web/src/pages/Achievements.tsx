import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { storageUrl } from "@/utils/storage";
import { PentagramLoader } from "@/components/PentagramLoader";
import { AchievementCard, type AchievementData, type AchievementLevel } from "@/components/AchievementCard";
import { Search, X, Trophy, Crown, Lock, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const CATEGORIES: Record<string, { label: string; icon: string }> = {
  posting: { label: "Посты", icon: "💬" },
  threads: { label: "Треды", icon: "🧵" },
  likes_received: { label: "Признание", icon: "❤️" },
  likes_given: { label: "Щедрость", icon: "👍" },
  images: { label: "Галерея", icon: "🖼️" },
  profile: { label: "Профиль", icon: "👤" },
  secret: { label: "Секретные", icon: "✨" },
};

const RARITY_ORDER: Record<string, number> = {
  legendary: 5,
  epic: 4,
  rare: 3,
  uncommon: 2,
  common: 1,
};

const RARITY_LABELS: Record<string, string> = {
  legendary: "Легендарные",
  epic: "Эпические",
  rare: "Редкие",
  uncommon: "Необычные",
  common: "Обычные",
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
  reward_type?: string;
  reward_value?: string;
  levels?: AchievementLevel[];
}

export default function Achievements() {
  const { userId } = useParams();
  const [loading, setLoading] = useState(true);
  const [allAchievements, setAllAchievements] = useState<AchievementData[]>([]);
  const [profile, setProfile] = useState<{ username: string; avatar_url?: string | null; id: string } | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [showLocked, setShowLocked] = useState(true);
  const [showSecret, setShowSecret] = useState(true);
  const [rarityFilter, setRarityFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    loadData();
  }, [userId]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load profile
      const profileRes = await fetch(`/api/v1/profiles?id=eq.${userId}`);
      const profileResult = await profileRes.json();
      setProfile(profileResult.data?.[0] || null);

      // Load user's unlocked achievements
      const achRes = await fetch(`/api/v1/user_achievements?user_id=eq.${userId}`);
      const achResult = await achRes.json();
      const unlockedRaw = achResult.data || [];

      // Build map of achievement_id → user data
      const unlockedMap = new Map<string, Record<string, unknown>>();
      for (const ua of unlockedRaw) {
        const a = ua.achievements || {};
        unlockedMap.set(a.id || ua.achievement_id, {
          ...ua,
          achievements: a,
        });
      }

      // Load all available achievements
      const allRes = await fetch(`/api/v1/achievements?order=sort_order.asc`);
      const allText = await allRes.text();
      let allAchs: AchievementRow[] = [];
      try {
        const allResult = JSON.parse(allText);
        allAchs = allResult.data || [];
      } catch {
        console.error("Failed to parse achievements JSON, response:", allText.slice(0, 200));
      }

      // Merge
      const merged: AchievementData[] = allAchs.map((a: AchievementRow) => {
        const ua = unlockedMap.get(a.id);
        const levels = a.levels || [];
        const currentLevel = ua?.current_level ?? ua?.level ?? 0;
        const levelDef = currentLevel > 0 && levels.length >= currentLevel ? levels[currentLevel - 1] : null;
        const isProgressive = a.achievement_type === "progressive" || levels.length > 1;
        const maxLevel = levels.length || 1;

        if (ua) {
          return {
            id: a.id,
            group_key: a.group_key,
            title: a.title,
            name: levelDef?.name || a.name || "—",
            description: levelDef?.description || a.description || "",
            icon: a.icon || "sparkles",
            category: a.category || "",
            rarity: levelDef?.rarity || a.rarity || "common",
            level: currentLevel,
            current_level: currentLevel,
            maxLevel: maxLevel,
            max_level: maxLevel,
            is_pinned: ua.is_pinned || false,
            pinned_order: ua.pinned_order,
            unlocked_at: ua.unlocked_at,
            progress_current: ua.progress_current || 0,
            achievement_type: a.achievement_type || "one_time",
            reward_type: levelDef?.reward_type || a.reward_type || undefined,
            reward_value: levelDef?.reward_value || a.reward_value || undefined,
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
          title: a.title,
          name: firstLevel?.name || a.name || "—",
          description: firstLevel?.description || a.description || "",
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

  const filtered = useMemo(() => {
    let list = allAchievements;

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q)
      );
    }

    if (categoryFilter) {
      list = list.filter((a) => a.category === categoryFilter);
    }

    if (rarityFilter) {
      list = list.filter((a) => a.rarity === rarityFilter);
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
  }, [allAchievements, search, categoryFilter, rarityFilter, showLocked, showSecret]);

  const stats = useMemo(() => {
    const total = allAchievements.length;
    const unlocked = allAchievements.filter((a) => !a.locked).length;
    const legendary = allAchievements.filter((a) => !a.locked && a.rarity === "legendary").length;
    const epic = allAchievements.filter((a) => !a.locked && a.rarity === "epic").length;
    return { total, unlocked, legendary, epic };
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
          {profile ? `Профиль ${profile.username}` : "Назад"}
        </Link>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-400/20">
            <Trophy className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">
              Достижения {profile && `— ${profile.username}`}
            </h1>
            <p className="text-sm text-muted-foreground">
              {stats.unlocked} из {stats.total} открыто
              {stats.legendary > 0 && (
                <span className="text-amber-400"> · {stats.legendary} легендарных</span>
              )}
              {stats.epic > 0 && (
                <span className="text-purple-400"> · {stats.epic} эпических</span>
              )}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-2.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-amber-400 via-orange-500 to-pink-500 rounded-full transition-all duration-1000 ease-out"
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
            placeholder="Поиск достижений..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
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
            Все
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
              {cat.label}
            </button>
          ))}
        </div>

        {/* Toggle options */}
        <div className="flex items-center gap-4 text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showLocked}
              onChange={(e) => setShowLocked(e.target.checked)}
              className="rounded border-muted-foreground/30"
            />
            <Lock className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Закрытые</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showSecret}
              onChange={(e) => setShowSecret(e.target.checked)}
              className="rounded border-muted-foreground/30"
            />
            {showSecret ? (
              <Eye className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />
            )}
            <span className={showSecret ? "text-amber-400" : "text-muted-foreground"}>
              Секретные
            </span>
          </label>
        </div>
      </div>

      {/* Achievement grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Trophy className="w-16 h-16 mx-auto mb-4 opacity-20" />
          <p className="text-sm">Ничего не найдено</p>
        </div>
      ) : (
        <>
          {/* Unlocked section */}
          {filtered.some((a) => !a.locked) && (
            <section>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Crown className="w-5 h-5 text-amber-400" />
                Открытые
                <span className="text-sm font-normal text-muted-foreground">
                  ({filtered.filter((a) => !a.locked).length})
                </span>
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
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-muted-foreground">
                <Lock className="w-5 h-5" />
                Закрытые
                <span className="text-sm font-normal">
                  ({filtered.filter((a) => a.locked).length})
                </span>
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
