import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "@/integrations/api/compat";
import { useLoadingBarStore } from "@/stores/loadingBarStore";
import { getGiftCatalog } from "@/utils/currentUserMeta";
import { dispatchProfileCacheInvalidate } from "@/utils/profileCustomization";
import { useAvatarOverrideStore } from "@/stores/avatarOverrideStore";
import type { AchievementData } from "@/components/AchievementCard";
import type { GiftCatalogItem } from "@/components/GiftCard";
import { mapUserAchievementRaw } from "./utils";
import type { AvatarHistoryItem, UserAchievementRaw } from "./types";

const PINNED_ACHIEVEMENTS_LIMIT = 6;

export interface UseProfileDataParams {
  userId: string | undefined;
  /** Active profile tab — drives the lazy loading of tab-scoped data. */
  activeTab: string;
  /** Session user id; guards avatar-history deletion and the thread-likes batch. */
  currentUser: { id: string } | null;
  /** Page-side setter kept in sync when an avatar-history delete changes the
   * current avatar. */
  onAvatarUrlChange: (url: string | null) => void;
}

export interface UseProfileDataResult {
  achievements: AchievementData[];
  pinnedAchievements: AchievementData[];
  achievementsLoaded: boolean;
  avatarHistory: AvatarHistoryItem[];
  showAvatarGallery: boolean;
  avatarGalleryIndex: number;
  giftCatalog: GiftCatalogItem[];
  giftCount: number;
  giftCountLoaded: boolean;
  loadPinnedAchievements: () => Promise<void>;
  loadAchievements: () => Promise<void>;
  toggleAchievementPin: (achievementId: string) => Promise<void>;
  loadAvatarHistory: () => Promise<AvatarHistoryItem[]>;
  openAvatarGallery: () => Promise<void>;
  closeAvatarGallery: () => void;
  deleteAvatar: (avatarId: string) => Promise<void>;
  /** Bumps the gifts-tab count (called after a gift is sent). */
  incrementGiftCount: () => void;
}

/**
 * Tab-scoped profile data: achievements (pinned on mount, full list when the
 * achievements tab is first opened), user threads with like counts, avatar
 * history + gallery, and the gift catalog/count. Everything is loaded lazily
 * so the first paint only fetches the profile row + the pinned achievements.
 */
export function useProfileData({
  userId,
  activeTab,
  currentUser,
  onAvatarUrlChange,
}: UseProfileDataParams): UseProfileDataResult {
  const { t } = useTranslation();

  // ── Achievements ───────────────────────────────────────────────────────────
  const [achievements, setAchievements] = useState<AchievementData[]>([]);
  const [pinnedAchievements, setPinnedAchievements] = useState<AchievementData[]>([]);
  const [achievementsLoaded, setAchievementsLoaded] = useState(false);

  // Pinned achievements (max 6) render on the wall tab, but the full list is a
  // heavy payload (every level/description/icon embedded) — fetch only the
  // pinned rows on mount and defer the full list to the achievements tab.
  const loadPinnedAchievements = useCallback(async () => {
    // The caller passes the resolved UUID, which is empty until the profile row
    // arrives — an empty id would be a pointless 400.
    if (!userId) return;
    try {
      const achRes = await fetch(`/api/v1/user_achievements?user_id=eq.${userId}&order=is_pinned.desc&order=pinned_order.asc&order=current_level.desc&order=unlocked_at.desc&limit=${PINNED_ACHIEVEMENTS_LIMIT}`);
      const achResult = await achRes.json();
      const data = achResult.data || [];
      if (Array.isArray(data)) {
        setPinnedAchievements(data.filter((ua: UserAchievementRaw) => ua.is_pinned).map(mapUserAchievementRaw));
      }
    } catch {
      // Ignore — the wall just renders without the pinned section.
    }
  }, [userId]);

  const loadAchievements = useCallback(async () => {
    if (!userId) return;
    const { begin, end } = useLoadingBarStore.getState();
    begin();
    try {
      const achRes = await fetch(`/api/v1/user_achievements?user_id=eq.${userId}&order=is_pinned.desc&order=pinned_order.asc&order=current_level.desc&order=unlocked_at.desc`);
      const achResult = await achRes.json();
      const data = achResult.data || [];

      if (data) {
        const processedAchievements: AchievementData[] = data.map(mapUserAchievementRaw);
        setPinnedAchievements(processedAchievements.filter((a) => a.is_pinned));
        setAchievements(processedAchievements);
      }
    } catch (error) {
      // Guests or transient failures must never surface as unhandled
      // rejections — the profile page just renders without achievements.
      console.error('Error loading achievements:', error);
    } finally {
      end();
      setAchievementsLoaded(true);
    }
  }, [userId]);

  // Achievements are a heavy payload and the wall is the landing tab — fetch
  // them only when the achievements tab is first opened.
  useEffect(() => {
    if (activeTab === 'achievements' && !achievementsLoaded) {
      loadAchievements();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, achievementsLoaded]);

  const toggleAchievementPin = useCallback(async (achievementId: string) => {
    try {
      const { error } = await api.rpc('toggle_achievement_pin', {
        _user_id: userId,
        _achievement_id: achievementId,
      });
      if (error) throw new Error(error.message || 'Failed to toggle pin');

      // Reload achievements to reflect changes.
      await loadAchievements();
    } catch (error) {
      console.error('Error toggling achievement pin:', error);
    }
  }, [userId, loadAchievements]);

  // ── Threads ────────────────────────────────────────────────────────────────
  // The «Записи» tab owns its own paging (ProfileThreadsTab); it is not part of
  // this hook anymore.

  // Switching profiles must not show the previous user's achievements while the
  // next one loads — reset the loaded flag so the tab gates on its own fetch.
  useEffect(() => {
    setAchievements([]);
    setPinnedAchievements([]);
    setAchievementsLoaded(false);
  }, [userId]);

  // ── Avatar history + gallery ───────────────────────────────────────────────
  const [avatarHistory, setAvatarHistory] = useState<AvatarHistoryItem[]>([]);
  const [showAvatarGallery, setShowAvatarGallery] = useState(false);
  const [avatarGalleryIndex, setAvatarGalleryIndex] = useState(0);

  const loadAvatarHistory = useCallback(async (): Promise<AvatarHistoryItem[]> => {
    if (!userId) return [];

    try {
      const { data, error } = await api.rpc('get_avatar_history', { user_uuid: userId });
      if (error) throw new Error(error.message || 'Failed to load avatar history');

      const avatars = (data || []) as AvatarHistoryItem[];
      setAvatarHistory(avatars);
      return avatars;
    } catch (error) {
      console.error('Error loading avatar history:', error);
      return [];
    }
  }, [userId]);

  // Avatar history is only needed for the gallery — fetch it lazily on the
  // first click instead of on every profile visit.
  const openAvatarGallery = useCallback(async () => {
    let history = avatarHistory;
    if (history.length === 0) {
      history = await loadAvatarHistory();
    }
    if (history.length > 0) {
      setAvatarGalleryIndex(0);
      setShowAvatarGallery(true);
    }
  }, [avatarHistory, loadAvatarHistory]);

  const closeAvatarGallery = useCallback(() => {
    setShowAvatarGallery(false);
  }, []);

  const deleteAvatar = useCallback(async (avatarId: string) => {
    if (!currentUser || currentUser.id !== userId) return;

    try {
      const { data, error } = await api.rpc('delete_avatar_from_history', {
        avatar_id: avatarId,
        requesting_user_id: currentUser.id,
      });
      if (error) throw new Error(error.message || 'Failed to delete avatar');

      if (data) {
        toast.success(t("profile.avatarDeleted"));
        // Deleting the current avatar may change profile.avatar_url.
        dispatchProfileCacheInvalidate();

        // Reload history
        const historyResult = await loadAvatarHistory();

        // Update avatar URL from history — find the current one.
        if (historyResult.length > 0) {
          const currentAvatar = historyResult.find((a) => a.is_current) ?? historyResult[0];
          onAvatarUrlChange(currentAvatar.avatar_url);
          // The deleted avatar may have been the session-wide override — keep
          // every surface pinned to the avatar that is current now.
          if (userId) {
            useAvatarOverrideStore.getState().setAvatarOverride(userId, {
              url: currentAvatar.avatar_url,
              animated: currentAvatar.is_animated,
            });
          }
        } else {
          onAvatarUrlChange(null);
          if (userId) useAvatarOverrideStore.getState().clearAvatarOverride(userId);
        }

        // Close gallery if no more avatars.
        if (historyResult.length === 0) {
          setShowAvatarGallery(false);
        }
      } else {
        toast.error(t("profile.avatarDeleteError"));
      }
    } catch (error) {
      console.error('Error deleting avatar:', error);
      toast.error(t("profile.avatarDeleteError"));
    }
  }, [userId, currentUser, t, loadAvatarHistory, onAvatarUrlChange]);

  // ── Gift catalog + count ───────────────────────────────────────────────────
  const [giftCatalog, setGiftCatalog] = useState<GiftCatalogItem[]>([]);
  const [giftCount, setGiftCount] = useState(0);
  const [giftCountLoaded, setGiftCountLoaded] = useState(false);

  // Only used by the gifts tab — load them when it is first opened instead of
  // on every profile visit.
  useEffect(() => {
    if (activeTab !== 'gifts' || giftCountLoaded) return;
    setGiftCountLoaded(true);
    getGiftCatalog()
      .then(setGiftCatalog)
      .catch(() => { /* ignore */ });
    const loadCount = async () => {
      try {
        const res = await fetch(`/api/v1/user_gifts?recipient_id=eq.${userId}&limit=0`);
        const result = await res.json();
        setGiftCount(result.count ?? 0);
      } catch { /* ignore */ }
    };
    loadCount();
  }, [activeTab, giftCountLoaded, userId]);

  return {
    achievements,
    pinnedAchievements,
    achievementsLoaded,
    avatarHistory,
    showAvatarGallery,
    avatarGalleryIndex,
    giftCatalog,
    giftCount,
    giftCountLoaded,
    loadPinnedAchievements,
    loadAchievements,
    toggleAchievementPin,
    loadAvatarHistory,
    openAvatarGallery,
    closeAvatarGallery,
    deleteAvatar,
    incrementGiftCount: () => setGiftCount((c) => c + 1),
  };
}