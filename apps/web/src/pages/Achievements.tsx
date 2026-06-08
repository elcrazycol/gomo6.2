import { useEffect, useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { storageUrl } from "@/utils/storage";
import { PentagramLoader } from "@/components/PentagramLoader";
import { AchievementCard, type AchievementData } from "@/components/AchievementCard";
import { Search, Filter, X, Trophy, Crown, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const CATEGORIES: Record<string, { label: string; icon: string }> = {
  posting: { label: "Посты", icon: "✍️" },
  threads: { label: "Треды", icon: "🧵" },
  likes_received: { label: "Лайки", icon: "⭐" },
  likes_given: { label: "Щедрость", icon: "💚" },
  time: { label: "Время", icon: "⏱️" },
  profile: { label: "Профиль", icon: "👤" },
  images: { label: "Изображения", icon: "📸" },
  wall: { label: "Стена", icon: "📌" },
  secret: { label: "Секретные", icon: "🥷" },
};

const RARITY_ORDER: Record<string, number> = {
  legendary: 5,
  epic: 4,
  rare: 3,
  uncommon: 2,
  common: 1,
};

export default function Achievements() {
  const { userId } = useParams();
  const [loading, setLoading] = useState(true);
  const [userAchievements, setUserAchievements] = useState<AchievementData[]>([]);
  const [allAchievements, setAllAchievements] = useState<AchievementData[]>([]);
  const [profile, setProfile] = useState<{ username: string; avatar_url?: string | null; id: string } | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [rarityFilter, setRarityFilter] = useState<string | null>(null);
  const [showLocked, setShowLocked] = useState(true);
  const [showSecret, setShowSecret] = useState(false);

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
      const unlocked = (achResult.data || []).map((ua: any) => {
        const a = ua.achievements || {};
        return {
          id: a.id || ua.achievement_id,
          name: a.name || "—",
          description: a.description || "",
          icon: a.icon || "🏆",
          category: a.category || "",
          rarity: a.rarity || "common",
          level: ua.level || 1,
          is_pinned: ua.is_pinned || false,
          pinned_order: ua.pinned_order,
          unlocked_at: ua.unlocked_at,
          hidden: a.hidden || false,
          progress_current: ua.progress_current || 0,
          progress_target: ua.progress_target || 0,
          achievement_type: a.achievement_type || "one_time",
          reward_type: a.reward_type || null,
          reward_value: a.reward_value || null,
        } as AchievementData;
      });

      setUserAchievements(unlocked);

      // Load all available achievements from the API
      const allRes = await fetch(`/api/v1/achievements?order=sort_order.asc`);
      const allResult = await allRes.json();
      const allAchs = (allResult.data || []).map((a: any) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        icon: a.icon || "🏆",
        category: a.category || "",
        rarity: a.rarity || "common",
        achievement_type: a.achievement_type || "one_time",
        hidden: a.hidden || false,
        reward_type: a.reward_type || null,
        reward_value: a.reward_value || null,
        locked: true,
        level: 1,
      } as AchievementData));

      // Merge user data with all achievements (use local `unlocked` not state to avoid race)
      const merged = allAchs.map((a: AchievementData) => {
        const found = unlocked.find((ua: AchievementData) => ua.id === a.id);
        if (found) {
          return { ...a, ...found, locked: false };
        }
        return a;
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

    if (!showSecret) {
      list = list.filter((a) => !a.hidden);
    }

    // Sort: unlocked first, then by rarity, then by sort_order
    return list.sort((a, b) => {
      if (!a.locked && b.locked) return -1;
      if (a.locked && !b.locked) return 1;
      return (RARITY_ORDER[b.rarity || "common"] || 0) - (RARITY_ORDER[a.rarity || "common"] || 0);
    });
  }, [allAchievements, search, categoryFilter, rarityFilter, showLocked, showSecret]);

  const stats = useMemo(() => {
    const total = allAchievements.length;
    const unlocked = allAchievements.filter((a) => !a.locked).length;
    const legendary = allAchievements.filter((a) => !a.locked && a.rarity === "legendary").length;
    const pinned = allAchievements.filter((a) => a.is_pinned).length;
    return { total, unlocked, legendary, pinned };
  }, [allAchievements]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  return (
    <main className="max-w-4xl mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Trophy className="w-8 h-8 text-amber-400" />
          <div>
            <h1 className="text-2xl font-bold">
              Достижения {profile && `— ${profile.username}`}
            </h1>
            <p className="text-sm text-muted-foreground">
              {stats.unlocked} из {stats.total} открыто
              {stats.legendary > 0 && ` · ${stats.legendary} легендарных`}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-2 bg-muted rounded-full overflow-hidden">
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
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setCategoryFilter(null)}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-medium transition-all",
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
                "px-3 py-1 rounded-full text-xs font-medium transition-all",
                categoryFilter === key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
            >
              {cat.icon} {cat.label}
            </button>
          ))}
        </div>

        {/* Toggle options */}
        <div className="flex items-center gap-4 text-xs">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showLocked}
              onChange={(e) => setShowLocked(e.target.checked)}
              className="rounded border-muted-foreground/30"
            />
            <span className="text-muted-foreground">Показать закрытые</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showSecret}
              onChange={(e) => setShowSecret(e.target.checked)}
              className="rounded border-muted-foreground/30"
            />
            <span className="text-muted-foreground">Секретные</span>
          </label>
        </div>
      </div>

      {/* Achievement grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Trophy className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Ничего не найдено</p>
        </div>
      ) : (
        <>
          {/* Unlocked section */}
          {filtered.some((a) => !a.locked) && (
            <section>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Crown className="w-5 h-5 text-amber-400" />
                Открытые
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
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2 text-muted-foreground">
                <Lock className="w-5 h-5" />
                Закрытые
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

