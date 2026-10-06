import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "@/integrations/api/compat";
import { getGiftCatalog } from "@/utils/currentUserMeta";
import { dispatchProfileCacheInvalidate } from "@/utils/profileCustomization";
import { useAvatarOverrideStore } from "@/stores/avatarOverrideStore";
import { useTrophies } from "@/hooks/useTrophies";
import type { Trophy } from "@/utils/trophies";
import type { GiftCatalogItem } from "@/components/GiftCard";
import type { AvatarHistoryItem } from "./types";

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
  /** Milestones + awards merged into one rarest-first trophy list. */
  trophies: Trophy[];
  /** True once the trophy fetch for the current user has settled. */
  trophiesLoaded: boolean;
  avatarHistory: AvatarHistoryItem[];
  showAvatarGallery: boolean;
  avatarGalleryIndex: number;
  giftCatalog: GiftCatalogItem[];
  giftCount: number;
  giftCountLoaded: boolean;
  loadAvatarHistory: () => Promise<AvatarHistoryItem[]>;
  openAvatarGallery: () => Promise<void>;
  closeAvatarGallery: () => void;
  deleteAvatar: (avatarId: string) => Promise<void>;
  /** Bumps the gifts-tab count (called after a gift is sent). */
  incrementGiftCount: () => void;
}

/**
 * Tab-scoped profile data: trophies (milestones + hand-granted awards, fetched
 * when the achievements tab is first opened), avatar history + gallery, and the
 * gift catalog/count. Everything is loaded lazily so the first paint only
 * fetches the profile row.
 */
export function useProfileData({
  userId,
  activeTab,
  currentUser,
  onAvatarUrlChange,
}: UseProfileDataParams): UseProfileDataResult {
  const { t } = useTranslation();

  // ── Trophies (milestones + hand-granted awards) ─────────────────────────────
  // Both `user_achievements` and `user_awards` are heavy payloads, so they load
  // lazily when the achievements tab is first opened. `useTrophies` fetches
  // them in parallel, merges them into one rarest-first list, and resets itself
  // when the target user changes — so switching profiles never flashes the
  // previous user's trophies.
  const { trophies, loaded: trophiesLoaded } = useTrophies(userId, {
    enabled: activeTab === 'achievements',
  });

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
    trophies,
    trophiesLoaded,
    avatarHistory,
    showAvatarGallery,
    avatarGalleryIndex,
    giftCatalog,
    giftCount,
    giftCountLoaded,
    loadAvatarHistory,
    openAvatarGallery,
    closeAvatarGallery,
    deleteAvatar,
    incrementGiftCount: () => setGiftCount((c) => c + 1),
  };
}