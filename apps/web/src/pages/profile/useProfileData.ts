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
  userThreads: any[];
  profileLikesMap: Map<string, { count: number; isLiked: boolean }>;
  threadsLoading: boolean;
  avatarHistory: AvatarHistoryItem[];
  showAvatarGallery: boolean;
  avatarGalleryIndex: number;
  giftCatalog: GiftCatalogItem[];
  giftCount: number;
  giftCountLoaded: boolean;
  loadUserThreads: () => Promise<void>;
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

  // ── Achievements & awards ──────────────────────────────────────────────────
  // Auto milestones (`user_achievements`) and hand-granted awards (`user_awards`)
  // are both heavy payloads, so they load lazily when the achievements tab is
  // first opened. The hook fetches them in parallel and merges the milestones
  // and awards into one rarest-first trophy list.
  const { trophies, loaded: trophiesLoaded } = useTrophies(userId, {
    enabled: activeTab === "achievements",
  });

  // ── User threads + likes ───────────────────────────────────────────────────
  const [userThreads, setUserThreads] = useState<any[]>([]);
  const [profileLikesMap, setProfileLikesMap] = useState<Map<string, { count: number; isLiked: boolean }>>(new Map());
  const [threadsLoading, setThreadsLoading] = useState(false);

  const loadUserThreads = useCallback(async () => {
    if (!userId) return;

    setThreadsLoading(true);
    try {
      // Fetch threads
      const threadsRes = await fetch(`/api/v1/threads?user_id=eq.${userId}&order=created_at.desc&limit=20`);
      const threadsResult = await threadsRes.json();
      const threadsData = threadsResult.data || [];

      if (threadsData.length === 0) {
        setUserThreads([]);
        return;
      }

      // Get profiles for all threads
      const userIds = [...new Set(threadsData.map((t: { user_id: string }) => t.user_id).filter(Boolean))];
      const profilesMap: Record<string, unknown> = {};
      if (userIds.length > 0) {
        const profilesRes = await fetch(`/api/v1/profiles?id=in.(${userIds.join(',')})`);
        const profilesResult = await profilesRes.json();
        (profilesResult.data || []).forEach((p: { id: string }) => { profilesMap[p.id] = p; });
      }

      // Get post counts for threads
      const threadIds = threadsData.map((t: { id: string }) => t.id);
      const postCountMap: Record<string, number> = {};
      if (threadIds.length > 0) {
        const postsRes = await fetch(`/api/v1/posts?thread_id=in.(${threadIds.join(',')})`);
        const postsResult = await postsRes.json();
        (postsResult.data || []).forEach((p: { thread_id: string }) => {
          postCountMap[p.thread_id] = (postCountMap[p.thread_id] || 0) + 1;
        });
      }

      // Combine data
      const threadsWithData = threadsData.map((thread: { id: string; user_id: string; [key: string]: unknown }) => ({
        ...thread,
        profiles: profilesMap[thread.user_id] || null,
        post_count: postCountMap[thread.id] || 0
      }));

      setUserThreads(threadsWithData);

      // Batch fetch likes for all user threads
      if (threadIds.length > 0) {
        try {
          const likesResp = await fetch(`/api/rpc/get_thread_likes_batch?thread_ids=${threadIds.join(",")}&user_uuid=${currentUser?.id || ""}`);
          const likesResult = await likesResp.json();
          if (likesResult.data && Array.isArray(likesResult.data)) {
            const newMap = new Map<string, { count: number; isLiked: boolean }>();
            for (const item of likesResult.data) {
              newMap.set(item.thread_id, { count: item.count, isLiked: item.is_liked });
            }
            setProfileLikesMap(newMap);
          }
        } catch { /* ignore */ }
      }
    } catch (error) {
      console.error('Error loading user threads:', error);
      toast.error(t("profile.threadsLoadError"));
    } finally {
      setThreadsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, t]);

  useEffect(() => {
    if (activeTab === 'threads' && userThreads.length === 0) {
      loadUserThreads();
    }
  }, [activeTab, userId, userThreads.length, loadUserThreads]);

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
    userThreads,
    profileLikesMap,
    threadsLoading,
    avatarHistory,
    showAvatarGallery,
    avatarGalleryIndex,
    giftCatalog,
    giftCount,
    giftCountLoaded,
    loadUserThreads,
    loadAvatarHistory,
    openAvatarGallery,
    closeAvatarGallery,
    deleteAvatar,
    incrementGiftCount: () => setGiftCount((c) => c + 1),
  };
}