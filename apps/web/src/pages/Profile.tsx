import { useEffect, useState, useRef, useCallback } from "react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { storageUrl, uploadFile } from "@/utils/storage";
import { apiErrorMessage } from "@/utils/apiErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { HeaderUsername } from "@/components/HeaderUsername";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PentagramLoader } from "@/components/PentagramLoader";
import { ProfileSkeleton } from "@/components/skeletons/ContentSkeletons";
import { Camera, Edit2, LogOut, User, Settings, Hammer, Trash2, Pin, Trophy, Gift, MessageSquare, Smile, X, ImagePlus, Palette, Plus } from "lucide-react";
import { safeDate } from "@/utils/safeDate";
import { useFileDrop } from "@/hooks/useFileDrop";
import { useUserRealtimeStatus } from "@/hooks/useRealtimeStatus";
import { getProfileCustomization, parseCssToStyle, dispatchProfileCacheInvalidate, type ProfileCustomization } from "@/utils/profileCustomization";
import { normalizeProfileBackgroundVariant, type ProfileBackgroundVariant } from "@/utils/profileBackground";
import { isValidThemeTokens, applyProfileThemeTokens } from "@/utils/profileTheme";
import { EmojiPicker } from "@/components/EmojiPicker";
import { NicknameEmoji } from "@/components/NicknameEmoji";
import { AdminBadge } from "@/components/AdminBadge";
import { ProfileWall } from "@/components/ProfileWall";
import { ThreadCard } from "@/components/ThreadCard";
import { AvatarCropper } from "@/components/AvatarCropper";
import { GomoRichEditor } from "@/components/GomoRichEditor";
import { ProcessedContent } from "@/components/ProcessedContent";
import { OnlineStatus } from "@/components/OnlineStatus";
import { AvatarGallery } from "@/components/AvatarGallery";
import { AchievementCard, type AchievementData, type AchievementLevel } from "@/components/AchievementCard";
import { GiftsTab } from "@/components/GiftsTab";
import { FriendButton } from "@/components/FriendButton";
import { FriendsList } from "@/components/FriendsList";
import { FriendRequestsList } from "@/components/FriendRequestsList";
import { useFriendsStore } from "@/stores/friendsStore";
import { SpotifyNowPlaying } from "@/components/SpotifyNowPlaying";
import type { GiftCatalogItem } from "@/components/GiftCard";
import { getCurrentUserMeta, getGiftCatalog } from "@/utils/currentUserMeta";
import { formatCompactNumber } from "@/utils/formatNumber";
import { Users } from "lucide-react";

interface Profile {
  id: string;
  username: string;
  display_name?: string | null;
  nickname_emoji_id?: string | null;
  bio: string | null;
  bio_json?: unknown;
  is_anonymous: boolean;
  thread_count: number;
  post_count: number;
  wall_post_count: number;
  comment_count: number;
  likes_received_count: number;
  views_received_count: number;
  garma: number;
  drops: number;
  created_at: string;
  avatar_url?: string | null;
  background_url?: string | null;
  background_variant?: string;
  theme_enabled?: boolean;
  theme_tokens?: Record<string, string> | null;
  account_number?: number | null;
  is_online?: boolean;
  last_seen?: string | null;
}

interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  unlocked_at: string;
  level?: number;
  is_pinned?: boolean;
  pinned_order?: number;
}

interface UserAchievementRaw {
  current_level?: number;
  level?: number;
  unlocked_at?: string;
  is_pinned?: boolean;
  pinned_order?: number;
  progress_current?: number;
  achievements?: {
    id: string;
    group_key?: string;
    title?: string;
    name: string;
    description: string;
    icon?: string;
    category?: string;
    rarity?: string;
    achievement_type?: string;
    hidden?: boolean;
    reward_type?: string;
    reward_value?: string;
    levels?: AchievementLevel[];
  };
}

interface AvatarHistoryItem {
  id: string;
  avatar_url: string;
  is_current: boolean;
}


const formatGarmaLabel = (value: number) => {
  const abs = Math.abs(value);
  const mod10 = abs % 10;
  const mod100 = abs % 100;

  if (mod10 === 1 && mod100 !== 11) return "gарма";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "gармы";
  return "gарм";
};

// Friends tab button with count
const FriendsTabButton = ({ activeTab, onClick, userId }: { activeTab: string; onClick: () => void; userId: string }) => {
  const { profileFriends, fetchProfileFriends } = useFriendsStore();
  const { t } = useTranslation();
  const [friendCount, setFriendCount] = useState(0);

  useEffect(() => {
    fetchProfileFriends(userId);
  }, [fetchProfileFriends, userId]);

  useEffect(() => {
    setFriendCount(profileFriends.length);
  }, [profileFriends]);

  return (
    <button
      onClick={onClick}
      className={`px-4 sm:px-6 py-2.5 sm:py-3 text-xs sm:text-sm font-medium transition-colors relative ${
        activeTab === 'friends'
          ? 'text-primary border-b-2 border-primary'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <span className="flex items-center gap-1">
        <Users className="w-3.5 h-3.5" />
        {t("profile.friends")} ({friendCount})
      </span>
    </button>
  );
};

const Profile = () => {
  const { t } = useTranslation();
  const { userId } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [achievements, setAchievements] = useState<AchievementData[]>([]);
  const [pinnedAchievements, setPinnedAchievements] = useState<AchievementData[]>([]);
  const [regularAchievements, setRegularAchievements] = useState<AchievementData[]>([]);
  const [currentUser, setCurrentUser] = useState<{ id: string } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [bioJson, setBioJson] = useState<unknown>(null);
  const [bioEditorResetKey, setBioEditorResetKey] = useState(0);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [confirmUsername, setConfirmUsername] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [backgroundUploading, setBackgroundUploading] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");
  const [pageLoading, setPageLoading] = useState(true);
  const [showUsernameDialog, setShowUsernameDialog] = useState(false);
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [customization, setCustomization] = useState<ProfileCustomization | null>(null);
  const [nicknameEmojiId, setNicknameEmojiId] = useState<string | null>(null);
  const nicknameEmojiButtonRef = useRef<HTMLDivElement>(null);
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [showLastSeen, setShowLastSeen] = useState(true);
  const [showOnlineStatus, setShowOnlineStatus] = useState(true);
  const [showProfileWall, setShowProfileWall] = useState(true);
  const [wallRefreshKey, setWallRefreshKey] = useState(0);
  // The create-post form is opened from a floating button that stays on screen
  // on every profile tab; this state drives the form inside ProfileWall.
  const [wallCreateOpen, setWallCreateOpen] = useState(false);
  const [allowWallPostsFromOthers, setAllowWallPostsFromOthers] = useState(true);
  const [activeTab, setActiveTab] = useState<'wall' | 'achievements' | 'threads' | 'gifts' | 'friends'>('achievements');
  const [showThreadsTab, setShowThreadsTab] = useState(true);
  const [showProfileStats, setShowProfileStats] = useState(false);
  const [showDetailedStats, setShowDetailedStats] = useState(false);
  const [statsVisibility, setStatsVisibility] = useState<Record<string, boolean>>({
    garma: false,
    posts: false,
    threads: false,
    postLikes: false,
    threadLikes: false,
    replies: false,
    time: false,
  });
  const [userThreads, setUserThreads] = useState<any[]>([]);
  const [profileLikesMap, setProfileLikesMap] = useState<Map<string, { count: number; isLiked: boolean }>>(new Map());
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [avatarHistory, setAvatarHistory] = useState<AvatarHistoryItem[]>([]);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [showAvatarGallery, setShowAvatarGallery] = useState(false);
  const [avatarGalleryIndex, setAvatarGalleryIndex] = useState(0);
  const [giftCatalog, setGiftCatalog] = useState<GiftCatalogItem[]>([]);
  const [giftCount, setGiftCount] = useState(0);
  const [privateProfile, setPrivateProfile] = useState(false);
  // H3 (security audit): hide toggles default to FALSE, matching the new DB
  // defaults (migrations 082/083) — a missing value means "visible", not
  // "hidden", for public profiles.
  const [privateHideAvatar, setPrivateHideAvatar] = useState(false);
  const [privateHideWall, setPrivateHideWall] = useState(false);
  const [privateHideThreads, setPrivateHideThreads] = useState(true);
  const [privateHideStats, setPrivateHideStats] = useState(false);
  const [privateHideFriends, setPrivateHideFriends] = useState(true);
  const [privateHideGifts, setPrivateHideGifts] = useState(true);
  const [privateHideAchievements, setPrivateHideAchievements] = useState(true);
  const [isMutualFriend, setIsMutualFriend] = useState<boolean | null>(null);
  const [privacyChecked, setPrivacyChecked] = useState(false);
  // Effective profile-background display variant — the OWNER's choice, set in
  // the profile studio (profile_customization.background_variant). There is no
  // per-viewer preference anymore.
  const [bgVariant, setBgVariant] = useState<ProfileBackgroundVariant>(() => normalizeProfileBackgroundVariant(undefined));

  // Resolve the effective variant from the owner's stored choice.
  useEffect(() => {
    setBgVariant(normalizeProfileBackgroundVariant(profile?.background_variant));
  }, [profile?.background_variant]);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await api.auth.getUser();
      setCurrentUser(user);
      
      if (user) {
        // Roles + nickname color + username via a TTL-cached single batched
        // call — every page used to fire these 3 fetches independently.
        const meta = await getCurrentUserMeta(user.id);
        setIsModerator(meta.roles.some((r) => r === 'moderator' || r === 'admin'));
        setCurrentUserUsername(meta.username);
        setCurrentUserColor(meta.color);
      }
    };
    checkAuth();

    const { data: { subscription } } = api.auth.onAuthStateChange(
      (_event: unknown, session: { user: { id: string } | null } | null) => {
        setCurrentUser(session?.user ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);



  // Owner's auto-theme (Settings → custom profile): while viewing a profile
  // whose owner enabled it, apply their theme tokens to the page root so the
  // header, buttons and cards match their background/avatar. Cleanup restores
  // the viewer's own theme when leaving the profile.
  useEffect(() => {
    const tokens = profile?.theme_tokens;
    if (!profile?.theme_enabled || !tokens || !isValidThemeTokens(tokens)) return;
    const cleanup = applyProfileThemeTokens(tokens);
    return cleanup;
  }, [profile?.theme_enabled, profile?.theme_tokens]);

  // Load gift catalog (TTL-cached — public data that rarely changes)
  useEffect(() => {
    let cancelled = false;
    getGiftCatalog()
      .then((items) => {
        if (!cancelled) setGiftCatalog(items);
      })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, []);

  // Load gift count for profile
  useEffect(() => {
    if (!userId) return;
    const loadCount = async () => {
      try {
        const res = await fetch(`/api/v1/user_gifts?recipient_id=eq.${userId}&limit=0`);
        const result = await res.json();
        setGiftCount(result.count ?? 0);
      } catch { /* ignore */ }
    };
    loadCount();
  }, [userId]);

  useEffect(() => {
    if (userId) {
      const loadAll = async () => {
        setPageLoading(true);
        try {
          await Promise.all([loadProfile(), loadAchievements(), loadAvatarHistory()]);
        } catch (error) {
          console.error('Error loading profile data:', error);
        } finally {
          setPageLoading(false);
        }
      };
      loadAll();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  // Live online status via WebSocket presence — the previous 10s HTTP polling
  // fired 6 requests/min per open profile page for the same data.
  const realtimeStatus = useUserRealtimeStatus(userId);
  useEffect(() => {
    if (!realtimeStatus) return;
    setIsOnline(realtimeStatus.is_online);
    if (realtimeStatus.last_seen) setLastSeen(realtimeStatus.last_seen);
  }, [realtimeStatus]);

  const loadProfile = useCallback(async () => {
    const sessionAuth = await api.auth.getSession();
    const token = sessionAuth.data.session?.access_token;
    const headers: Record<string, string> | undefined = token ? { 'Authorization': `Bearer ${token}` } : undefined;

    const profileRes = await fetch(`/api/v1/profiles?id=eq.${userId}`);
    const profileResult = await profileRes.json();
    const data = profileResult.data?.[0];

    if (data) {
      setProfile({
        ...data,
        bio_json: (data as { bio_json?: unknown }).bio_json ?? undefined,
        garma: data.garma ?? 0,
        drops: data.drops ?? 0,
        wall_post_count: data.wall_post_count ?? 0,
        comment_count: data.comment_count ?? 0,
        likes_received_count: data.likes_received_count ?? 0,
        views_received_count: data.views_received_count ?? 0,
      });
      setUsername(data.username);
      setBio(data.bio || "");
      setBioJson((data as { bio_json?: unknown }).bio_json || null);
      setBioEditorResetKey((prev) => prev + 1);
      setIsAnonymous(data.is_anonymous);
      setAvatarUrl(data.avatar_url);
      setLastSeen(data.last_seen_at);
      setIsOnline(data.is_online || false);

      // Load privacy settings for online status, wall and stats. The generic
      // /privacy_settings endpoint is viewer-scoped (returns only the caller's
      // own row), so for a foreign profile it would come back empty and the
      // profile would look public. The public /users/:id/privacy endpoint
      // returns the owner's visibility flags (private_profile + private_hide_*)
      // — the same rules the server enforces on content.
      const localSessionUser = sessionAuth.data.session?.user;
      const privacyData = localSessionUser?.id === userId
        ? (await (await fetch(`/api/v1/privacy_settings?user_id=eq.${userId}`)).json()).data?.[0]
        : (await (await fetch(`/api/v1/users/${userId}/privacy`)).json()).data;

      if (privacyData) {
        setShowLastSeen(privacyData.show_last_seen ?? true);
        setShowOnlineStatus(privacyData.show_online_status ?? true);
        setShowProfileWall(privacyData.show_profile_wall ?? true);
        setAllowWallPostsFromOthers(privacyData.allow_wall_posts_from_others ?? true);
        setShowThreadsTab(privacyData.show_threads_tab ?? true);
        setShowProfileStats(privacyData.show_profile_stats ?? false);
        setShowDetailedStats(privacyData.show_detailed_stats ?? false);
        setStatsVisibility({
          garma: false,
          posts: false,
          threads: false,
          postLikes: false,
          threadLikes: false,
          replies: false,
          time: false,
          ...(privacyData.stats_visibility || {}),
        });
        setPrivateProfile(privacyData.private_profile ?? false);
        setPrivateHideAvatar(privacyData.private_hide_avatar ?? false);
        setPrivateHideWall(privacyData.private_hide_wall ?? false);
        setPrivateHideThreads(privacyData.private_hide_threads ?? true);
        setPrivateHideStats(privacyData.private_hide_stats ?? false);
        setPrivateHideFriends(privacyData.private_hide_friends ?? true);
        setPrivateHideGifts(privacyData.private_hide_gifts ?? true);
        setPrivateHideAchievements(privacyData.private_hide_achievements ?? true);
      }

      // Check friendship status for private profile
      // Use session user (localSessionUser) instead of React state currentUser
      // to avoid race condition where currentUser is not yet set.
      if (localSessionUser?.id && localSessionUser.id !== userId) {
        try {
          const friendRes = await fetch(`/api/v1/friends/status/${userId}`, { headers });
          const friendResult = await friendRes.json();
          setIsMutualFriend(friendResult.data?.status === 'friends');
        } catch {
          setIsMutualFriend(false);
        }
      } else {
        setIsMutualFriend(localSessionUser?.id === userId ? true : false);
      }
      setPrivacyChecked(true);

      // Load customization (the nickname emoji lives on the user profile, not
      // in profile_customization — the latter is read-scoped to the viewer).
      const custom = await getProfileCustomization(userId!);
      setCustomization(custom);
      setNicknameEmojiId((data as { nickname_emoji_id?: string | null }).nickname_emoji_id || null);

    }
  }, [userId]);

  // ── Profile privacy helpers ────────────────────────────────────────────────
  // Mirror the server-side rules (profileWallFinishSelectQuery and the per-
  // section CanViewUser* checks) so the client hides exactly what the backend
  // refuses to serve.
  const isOwnProfile = currentUser?.id === userId;
  const isPrivate = privateProfile && privacyChecked;
  const isNonFriendOnPrivate = isPrivate && !isOwnProfile && isMutualFriend === false;
  const friendshipLoaded = isMutualFriend !== null;
  // A wall is hidden from the viewer when they are neither the owner nor a
  // mutual friend AND (the profile is private OR the owner hid the wall).
  const wallHiddenFromViewer = !isOwnProfile && isMutualFriend === false && (privateProfile || privateHideWall);

  const canViewSection = (hidden: boolean) => {
    if (!isNonFriendOnPrivate) return true;
    return !hidden;
  };

  // The wall tab is available to every viewer while the wall is enabled: for
  // non-friends on a private profile it renders the "wall is hidden" notice
  // instead of content.
  const wallTabVisible = showProfileWall && (isNonFriendOnPrivate || canViewSection(privateHideWall));

  // The floating "Написать на стене" button is shown when this viewer may
  // actually leave a post: logged in, allowed on this wall, and the wall is
  // visible (not hidden server-side, not disabled, not in edit mode).
  const canPostOnWall = !!currentUser && (currentUser.id === userId || allowWallPostsFromOthers) && showProfileWall && !wallHiddenFromViewer && !isEditing;

  const handleWallCreateClick = () => {
    if (activeTab !== 'wall') {
      // Coming from another tab: jump to the wall and open the composer.
      setActiveTab('wall');
      setWallCreateOpen(true);
    } else {
      setWallCreateOpen((prev) => !prev);
    }
  };

  // Set default tab based on wall visibility. The wall tab is available to
  // every viewer while showProfileWall is on (for non-friends on a private
  // profile it shows the "wall is hidden" notice instead of content), so it
  // is the natural landing tab.
  useEffect(() => {
    setActiveTab(showProfileWall ? 'wall' : 'achievements');
  }, [showProfileWall]);

  const loadAvatarHistory = async () => {
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
  };

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
  }, [userId, t]);

  useEffect(() => {
    if (activeTab === 'threads' && userThreads.length === 0) {
      loadUserThreads();
    }
  }, [activeTab, userId, userThreads.length, loadUserThreads]);

  const toggleAchievementPin = async (achievementId: string) => {
    try {
      const { error } = await api.rpc('toggle_achievement_pin', {
        _user_id: userId,
        _achievement_id: achievementId,
      });
      if (error) throw new Error(error.message || 'Failed to toggle pin');

      // Reload achievements to reflect changes
      await loadAchievements();
    } catch (error) {
      console.error('Error toggling achievement pin:', error);
    }
  };

  const loadAchievements = async () => {
    try {
      const achRes = await fetch(`/api/v1/user_achievements?user_id=eq.${userId}&order=is_pinned.desc&order=pinned_order.asc&order=current_level.desc&order=unlocked_at.desc`);
      const achResult = await achRes.json();
      const data = achResult.data || [];

      if (data) {
        // Map to AchievementData format using DB data
        const processedAchievements: AchievementData[] = data.map((ua: UserAchievementRaw) => {
          const a = ua.achievements ?? ({} as NonNullable<UserAchievementRaw["achievements"]>);
          const currentLevel = ua.current_level ?? ua.level ?? 0;
          const levels = a.levels || [];
          const levelDef = currentLevel > 0 && levels.length >= currentLevel ? levels[currentLevel - 1] : null;

          return {
            id: a.id || "",
            group_key: a.group_key,
            title: a.title,
            name: levelDef?.name || a.name || "—",
            description: levelDef?.description || a.description || "",
            icon: a.icon || "sparkles",
            category: a.category || "",
            rarity: levelDef?.rarity || a.rarity || "common",
            level: currentLevel,
            current_level: currentLevel,
            maxLevel: levels.length || 1,
            max_level: levels.length || 1,
            is_pinned: ua.is_pinned || false,
            pinned_order: ua.pinned_order || null,
            unlocked_at: ua.unlocked_at,
            progress_current: ua.progress_current || 0,
            achievement_type: a.achievement_type || "one_time",
            reward_type: levelDef?.reward_type || a.reward_type || undefined,
            reward_value: levelDef?.reward_value || a.reward_value || undefined,
            hidden: a.hidden || false,
            levels: levels,
          } as AchievementData;
        });

        // Split into pinned and regular
        const pinned = processedAchievements.filter(a => a.is_pinned);
        const regular = processedAchievements.filter(a => !a.is_pinned);

        setPinnedAchievements(pinned);
        setRegularAchievements(regular);
        setAchievements(processedAchievements);
      }
    } catch (error) {
      // Guests or transient failures must never surface as unhandled
      // rejections — the profile page just renders without achievements.
      console.error('Error loading achievements:', error);
    }
  };

  const handleSave = async () => {
    if (!currentUser || currentUser.id !== userId) return;

    const token = (await api.auth.getSession()).data.session?.access_token;
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Сохраняем профиль
    const profileRes = await        fetch(`/api/v1/profiles/${encodeURIComponent(userId!)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        username,
        bio,
        bio_json: bioJson,
        is_anonymous: isAnonymous,
      }),
    });

    if (!profileRes.ok) {
      toast.error(t("profile.saveError"));
      return;
    }

    // Смена пароля выполняется в разделе «Настройки → Аккаунт» (Settings.tsx),
    // где пользователь подтверждает текущий пароль (current_password).
    toast.success(t("profile.updated"));
    setIsEditing(false);
    // Username/bio/avatar caches must not serve the old values for 5 minutes.
    dispatchProfileCacheInvalidate();
    loadProfile();
  };

  const handleLogout = async () => {
    await api.auth.signOut();
    toast.success(t("auth.logoutSuccess"));
  };

  const readAvatarFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setCropImage(event.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    readAvatarFile(file);
  };

  // Drag & drop an image straight onto the avatar (edit mode only).
  const { isDragging: isAvatarDragging, dragHandlers: avatarDragHandlers } = useFileDrop(
    useCallback((files: File[]) => {
      const file = files[0];
      if (file && !!currentUser?.id && currentUser.id === userId && isEditing) {
        readAvatarFile(file);
      }
    }, [currentUser, userId, isEditing, readAvatarFile]),
  );

  const handleCropConfirm = async (croppedImage?: Blob) => {
    if (!userId) return;

    // Show loader immediately and close crop dialog
    setCropImage(null);
    setAvatarUploading(true);

    try {
      if (!croppedImage) {
        setAvatarUploading(false);
        return;
      }

      // AvatarCropper returns a Blob directly. Do not fetch a data: URL:
      // CSP correctly blocks data: in connect-src, and no network request
      // is needed for an image already in memory.
      const blob = croppedImage;

      const croppedFile = new File([blob], 'avatar.png', { type: 'image/png' });
      const fileName = `${userId}/avatar_${Date.now()}.png`;

      const uploaded = await uploadFile('post-images', fileName, croppedFile);

      const token = (await api.auth.getSession()).data.session?.access_token;
      const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

      const updateRes = await        fetch(`/api/v1/profiles/${encodeURIComponent(userId!)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ avatar_url: uploaded.path }),
      });

      if (!updateRes.ok) {
        setAvatarUploading(false);
        console.error('Update error:', await updateRes.text());
        toast.error(t("profile.updateError"));
        return;
      }

      setAvatarUrl(uploaded.path);
      setAvatarUploading(false);
      toast.success(t("profile.avatarUpdated"));
      // Header/profile caches hold the old avatar_url — reset them now.
      dispatchProfileCacheInvalidate();

      // Reload avatar history
      await loadAvatarHistory();
    } catch (error) {
      setAvatarUploading(false);
      toast.error(t("profile.imageProcessError"));
      console.error(error);
    }
  };

  const handleDeleteAvatar = async (avatarId: string) => {
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

        // Update avatar URL from history - find the current one
        if (historyResult && (historyResult as AvatarHistoryItem[]).length > 0) {
          const currentAvatar = (historyResult as AvatarHistoryItem[]).find((a: AvatarHistoryItem) => a.is_current);
          if (currentAvatar) {
            setAvatarUrl(currentAvatar.avatar_url);
          } else if ((historyResult as AvatarHistoryItem[]).length > 0) {
            // If no current avatar marked, use the most recent one
            setAvatarUrl((historyResult as AvatarHistoryItem[])[0].avatar_url);
          } else {
            setAvatarUrl(null);
          }
        } else {
          setAvatarUrl(null);
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
  };

  const handleAvatarClick = () => {
    if (avatarHistory.length > 0) {
      setAvatarGalleryIndex(0);
      setShowAvatarGallery(true);
    }
  };

  // ── Profile background (avatar + background) ──
  const handleBackgroundUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId || !currentUser || currentUser.id !== userId) return;
    setBackgroundUploading(true);
    try {
      const fileName = `${userId}/background_${Date.now()}.png`;
      const uploaded = await uploadFile("post-images", fileName, file);

      // Auto-theme: regenerate the theme tokens from the new background so
      // the owner's theme always matches their latest image. The dominant
      // variant is picked by default (the studio will let the owner choose
      // among the 5 generated palettes later). Kept as a best effort — a
      // failed extraction simply leaves the previous tokens.
      let themeTokens: Record<string, string> | null = null;
      try {
        const { generateThemeVariants } = await import("@/utils/profileTheme");
        const variants = await generateThemeVariants(file);
        themeTokens = variants.find((v) => v.id === "dominant")?.tokens ?? variants[0]?.tokens ?? null;
      } catch {
        // ignore — theme stays as-is when the image cannot be decoded
      }

      const { error } = await api.from("profile_customization").upsert({
        user_id: userId,
        background_url: uploaded.path,
        ...(themeTokens ? { theme_tokens: themeTokens } : {}),
      });
      if (error) throw error;

      setProfile((prev) => (prev ? { ...prev, background_url: uploaded.path, theme_tokens: themeTokens ?? prev.theme_tokens } : prev));
      // Profile caches (hover cards, header, own page) hold the old value.
      dispatchProfileCacheInvalidate();
      toast.success(t("profile.bgUpdated"));
    } catch (error) {
      toast.error(t("profile.bgLoadError"));
      console.error(error);
    } finally {
      setBackgroundUploading(false);
      e.target.value = "";
    }
  };

  // Toggle whether viewers see the owner's auto-theme on the profile page.
  const handleThemeEnabledToggle = async (enabled: boolean) => {
    if (!userId || !currentUser || currentUser.id !== userId) return;
    try {
      const { error } = await api.from("profile_customization").upsert({
        user_id: userId,
        theme_enabled: enabled,
      });
      if (error) throw error;
      setProfile((prev) => (prev ? { ...prev, theme_enabled: enabled } : prev));
      dispatchProfileCacheInvalidate();
      toast.success(enabled ? t("profile.themeEnabled") : t("profile.themeDisabled"));
    } catch (error) {
      toast.error(t("profile.themeSaveError"));
      console.error(error);
    }
  };

  const handleBackgroundRemove = async () => {
    if (!userId || !currentUser || currentUser.id !== userId) return;
    try {
      const { error } = await api.from("profile_customization").upsert({
        user_id: userId,
        background_url: null,
      });
      if (error) throw error;

      setProfile((prev) => (prev ? { ...prev, background_url: null } : prev));
      dispatchProfileCacheInvalidate();
      toast.success(t("profile.bgRemoved"));
    } catch (error) {
      toast.error(t("profile.bgRemoveError"));
      console.error(error);
    }
  };


  // ── Nickname emoji (custom emoji shown right of the display name) ──
  const handleNicknameEmojiSelect = async (sel: { emojiId: string }) => {
    if (!currentUser || currentUser.id !== userId) return;
    try {
      const token = (await api.auth.getSession()).data.session?.access_token;
      const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
      const res = await fetch(`/api/v1/profiles/${encodeURIComponent(userId!)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ nickname_emoji_id: sel.emojiId }),
      });
      if (!res.ok) throw new Error('Failed to save nickname emoji');

      setNicknameEmojiId(sel.emojiId);
      // The emoji is stored on the user, not in profile_customization — but the
      // profile object is cached everywhere, so refresh local caches too
      // (dispatchProfileCacheInvalidate clears the customization cache AND
      // notifies ProfileCacheContext + currentUserMeta).
      dispatchProfileCacheInvalidate();
      // The wall embeds the author's emoji in each post, so refetch it.
      setWallRefreshKey(k => k + 1);
      toast.success(t("profile.emojiSaved"));
    } catch (error) {
      toast.error(t("profile.emojiSaveError"));
      console.error(error);
    }
  };

  const handleNicknameEmojiRemove = async () => {
    if (!currentUser || currentUser.id !== userId) return;
    try {
      const token = (await api.auth.getSession()).data.session?.access_token;
      const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
      const res = await fetch(`/api/v1/profiles/${encodeURIComponent(userId!)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ nickname_emoji_id: "" }),
      });
      if (!res.ok) throw new Error('Failed to remove nickname emoji');

      setNicknameEmojiId(null);
      dispatchProfileCacheInvalidate();
      // The wall embeds the author's emoji in each post, so refetch it.
      setWallRefreshKey(k => k + 1);
      toast.success(t("profile.emojiRemoved"));
    } catch (error) {
      toast.error(t("profile.emojiRemoveError"));
      console.error(error);
    }
  };

  const handleSaveAndExit = async () => {
    try {
      const token = (await api.auth.getSession()).data.session?.access_token;
      const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

      const prevBioJson = profile?.bio_json ?? null;
      const bioJsonChanged =
        JSON.stringify(bioJson ?? null) !== JSON.stringify(prevBioJson);
      if (userId && profile && (bio !== profile.bio || bioJsonChanged)) {
        const bioRes = await        fetch(`/api/v1/profiles/${encodeURIComponent(userId!)}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ bio, bio_json: bioJson }),
        });
        if (!bioRes.ok) throw new Error('Failed to save bio');
      }

      // Save display_name changes
      if (userId && profile && newDisplayName.trim() && newDisplayName !== (profile.display_name || profile.username)) {
        const displayNameRes = await        fetch(`/api/v1/profiles/${encodeURIComponent(userId!)}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ display_name: newDisplayName.trim() }),
        });
        if (!displayNameRes.ok) throw new Error('Failed to save display name');

        setProfile(prev => prev ? { ...prev, display_name: newDisplayName.trim() } : null);
      }

      // Save anonymity setting
      if (userId && profile && isAnonymous !== profile.is_anonymous) {
        const anonRes = await        fetch(`/api/v1/profiles/${encodeURIComponent(userId!)}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ is_anonymous: isAnonymous }),
        });
        if (!anonRes.ok) throw new Error('Failed to save anonymity');
      }

      setIsEditing(false);
      setNewDisplayName("");
      setNewUsername("");
      
      // Bio/display_name/anonymity changed — reset all profile caches.
      dispatchProfileCacheInvalidate();
      
      // Reload profile to show updated bio with processed tags
      await loadProfile();
      
      toast.success(t("profile.changesSaved"));
    } catch (error) {
      toast.error(t("profile.changesSaveError"));
      console.error(error);
    }
  };

  const startEditing = () => {
    if (!profile) return;
    setNewDisplayName(profile.display_name || profile.username);
    setNewUsername(profile.username);
    setBio(profile.bio || "");
    setBioJson(profile.bio_json ?? null);
    setBioEditorResetKey((prev) => prev + 1);
    setIsAnonymous(profile.is_anonymous);
    setIsEditing(true);
  };

  const handleUsernameChange = async () => {
    if (!newUsername.trim()) {
      toast.error(t("profile.enterUsername"));
      return;
    }
    if (!/^[a-zA-Z0-9]+$/.test(newUsername)) {
      toast.error(t("error.username_chars"));
      return;
    }
    if (newUsername.length < 3 || newUsername.length > 20) {
      toast.error(t("error.username_length"));
      return;
    }
    if (newUsername !== confirmUsername) {
      toast.error(t("profile.usernamesMismatch"));
      return;
    }
    if (newUsername === profile?.username) {
      toast.error(t("profile.usernameUnchanged"));
      return;
    }

    try {
      const token = (await api.auth.getSession()).data.session?.access_token;
      const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

      const res = await fetch(`/api/v1/profiles/${encodeURIComponent(userId!)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ username: newUsername }),
      });

      const result = await res.json();
      if (!res.ok) {
        toast.error(
          apiErrorMessage(
            { code: result.code, params: result.params, message: result.error },
            t,
            "error.generic"
          )
        );
        return;
      }

      toast.success(t("profile.usernameChanged"));
      setProfile(prev => prev ? { ...prev, username: newUsername } : null);
      setUsername(newUsername);
      // Header/currentUserMeta caches keyed by the OLD username must reset.
      dispatchProfileCacheInvalidate();
      setShowUsernameDialog(false);
      setNewUsername("");
      setConfirmUsername("");
    } catch (error) {
      toast.error(t("profile.usernameChangeError"));
      console.error(error);
    }
  };

  // ── Derived profile-background values ────────────────────────────────────
  // The owner uploads one image (background_url storage key); every viewer
  // picks how it is displayed (Settings → Внешний вид → «Отображение фонов»).
  const profileBackgroundUrl = profile?.background_url ?? null;
  const bgUrl = profileBackgroundUrl ? storageUrl("post-images", profileBackgroundUrl) || profileBackgroundUrl : null;
  // The "card" variant folds the header + stats into one card over the image.
  const cardVariantActive = bgVariant === 'card' && !!bgUrl && !isEditing;

  // Header row (avatar + identity + actions) — rendered inside the active
  // background variant (banner strip / card / frosted panel / plain). Built
  // only when the profile is loaded (the skeleton renders before that).
  const headerRow = profile ? (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3 sm:gap-4">
        {/* Avatar */}
        {canViewSection(privateHideAvatar) && (
        <div className="relative">
          <div
            {...(isOwnProfile && isEditing ? avatarDragHandlers : {})}
            className={`w-14 h-14 sm:w-20 sm:h-20 rounded-full bg-muted flex items-center justify-center overflow-hidden cursor-pointer hover:opacity-80 transition-all duration-150 ${
              isOwnProfile && isEditing && isAvatarDragging
                ? "ring-2 ring-primary ring-offset-2 ring-offset-background scale-105"
                : ""
            }`}
            onClick={handleAvatarClick}
          >
            {avatarUploading ? (
              <div className="w-full h-full flex items-center justify-center">
                <PentagramLoader size="sm" />
              </div>
            ) : avatarUrl ? (
              <img
                src={storageUrl("post-images", avatarUrl) || avatarUrl}
                alt="Avatar"
                className="w-full h-full object-cover"
              />
            ) : (
              <User className="w-10 h-10 text-muted-foreground" />
            )}
          </div>
          {isOwnProfile && isEditing && (
            <label className="absolute -bottom-1 -right-1 w-8 h-8 bg-primary rounded-full flex items-center justify-center cursor-pointer hover:bg-primary/80 transition-colors">
              <Camera className="w-4 h-4 text-primary-foreground" />
              <input
                type="file"
                accept="image/*"
                onChange={handleAvatarUpload}
                className="hidden"
              />
            </label>
          )}
        </div>
        )}

        {/* User Info */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            {isEditing && isOwnProfile ? (
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Input
                  value={newDisplayName || profile.display_name || profile.username}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  className="text-2xl font-bold h-auto p-0 border-none bg-transparent flex-1 min-w-0"
                  placeholder={t("auth.displayName")}
                />
                <EmojiPicker
                  closeOnSelect
                  onEmojiSelect={handleNicknameEmojiSelect}
                  triggerRef={nicknameEmojiButtonRef}
                >
                  <button
                    type="button"
                    title={nicknameEmojiId ? t("profile.changeEmoji") : t("profile.chooseEmoji")}
                    className="h-9 w-9 shrink-0 rounded-full border border-border bg-muted/50 hover:bg-muted hover:border-primary/40 hover:text-primary transition-colors flex items-center justify-center overflow-hidden"
                  >
                    {nicknameEmojiId ? (
                      <NicknameEmoji emojiId={nicknameEmojiId} className="h-5 w-5" />
                    ) : (
                      <Smile className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                </EmojiPicker>
                {nicknameEmojiId && (
                  <button
                    type="button"
                    title={t("profile.removeEmoji")}
                    onClick={handleNicknameEmojiRemove}
                    className="h-9 w-9 shrink-0 rounded-full border border-border bg-muted/50 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40 transition-colors flex items-center justify-center"
                  >
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <h1 
                  className="text-xl sm:text-2xl font-bold"
                  style={{
                    ...(customization?.username_css ? parseCssToStyle(customization.username_css) : {}),
                    // Over the banner strip the name may kiss the image edge —
                    // a light halo keeps it readable on busy backgrounds.
                    ...(bgUrl && bgVariant === 'banner' ? { textShadow: '0 1px 3px rgba(255,255,255,0.75)' } : {}),
                  }}
                >
                  {profile.display_name?.trim() || profile.username}
                </h1>
                {(nicknameEmojiId || profile.nickname_emoji_id) && <NicknameEmoji emojiId={nicknameEmojiId || profile.nickname_emoji_id} />}
                {customization?.profile_badge_text && (
                  <span
                    className="px-2 py-1 rounded text-xs font-medium ml-2"
                    style={customization.profile_badge_css ? parseCssToStyle(customization.profile_badge_css) : {}}
                  >
                    {customization.profile_badge_text}
                  </span>
                )}
                <AdminBadge userId={userId!} />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 gap-y-0.5 flex-wrap">                  <button
                    type="button"
                    className={`text-sm text-muted-foreground ${isOwnProfile ? 'hover:text-primary cursor-pointer transition-colors' : ''} ${bgUrl && bgVariant === 'banner' ? '[text-shadow:0_1px_2px_rgba(255,255,255,0.7)]' : ''}`}
                    onClick={isOwnProfile ? () => setShowUsernameDialog(true) : undefined}
                    disabled={!isOwnProfile}
                  >
                    @{profile.username}
                  </button>
            {showOnlineStatus && (
              <>
                <span className="text-muted-foreground">·</span>
                <OnlineStatus
                  userId={profile.id}
                  isOnline={profile.is_online}
                  lastSeen={profile.last_seen}
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Edit Button */}
      {isOwnProfile && (
        <Button
          variant="ghost"
          size="sm"
          className="p-1 h-8 w-8 hover:bg-primary/10 hover:text-primary transition-colors"
          onClick={isEditing ? handleSaveAndExit : startEditing}
        >
          {isEditing ? (
            <span className="text-green-500 text-lg">✓</span>
          ) : (
            <Edit2 className="w-4 h-4" />
          )}
        </Button>
      )}

      {/* Write Button and Friend Button for other users */}
      {!isOwnProfile && currentUser && (
        <div className="flex gap-2">
          <FriendButton userId={userId!} isOwnProfile={isOwnProfile} />
          <Button
            variant="default"
            size="sm"
            onClick={() => navigate(`/messages?user=${userId}`)}
            className="h-8 w-8 sm:w-auto p-0 sm:px-3 rounded-full sm:rounded-md transition-colors text-xs sm:text-sm gap-1.5"
          >
            <MessageSquare className="w-4 h-4" />
            <span className="hidden sm:inline">{t("profile.write")}</span>
          </Button>
        </div>
      )}
    </div>
  ) : null;

  // Stats summary — rendered inside the "card" background variant or standalone.
  const statsBlock = profile ? (() => {
    const isOwn = currentUser?.id === userId;
    const summaryAllowed = isOwn || (showProfileStats && canViewSection(privateHideStats));
    if (!summaryAllowed) return null;
    return (
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 sm:gap-4 p-3 sm:p-4 bg-post-header border border-border">
        <button
          type="button"
          onClick={() => navigate(`/stats?metric=posts&user=${userId}`)}
          className="text-left"
        >
          <p className="text-xs sm:text-sm text-muted-foreground">{t("profile.posts")}</p>
          <p className="text-xl sm:text-2xl font-bold">{(profile.thread_count ?? 0) + (profile.wall_post_count ?? 0)}</p>
        </button>
        <button
          type="button"
          onClick={() => navigate(`/stats?metric=comments&user=${userId}`)}
          className="text-left"
        >
          <p className="text-xs sm:text-sm text-muted-foreground">{t("profile.comments")}</p>
          <p className="text-xl sm:text-2xl font-bold">{profile.comment_count ?? 0}</p>
        </button>
        <button
          type="button"
          onClick={() => navigate(`/stats?metric=likes&user=${userId}`)}
          className="text-left"
        >
          <p className="text-xs sm:text-sm text-muted-foreground">{t("profile.likes")}</p>
          <p className="text-xl sm:text-2xl font-bold">{profile.likes_received_count ?? 0}</p>
        </button>
        {/* Total unique views across the author's wall posts —
            clicks open the wall, where each post shows its own
            counter. */}
        <button
          type="button"
          onClick={() => setActiveTab('wall')}
          className="text-left"
        >
          <p className="text-xs sm:text-sm text-muted-foreground">{t("profile.views")}</p>
          <p className="text-xl sm:text-2xl font-bold">{formatCompactNumber(profile.views_received_count ?? 0)}</p>
        </button>
        <button
          type="button"
          onClick={() => navigate(`/stats?metric=garma&user=${userId}`)}
          className="text-left"
        >
          <p className="text-xs sm:text-sm text-muted-foreground">{t("profile.karma")}</p>
          <p className="text-xl sm:text-2xl font-bold">{profile.garma}</p>
        </button>
      </div>
    );
  })() : null;

  const showSkeleton = !profile || pageLoading;

  return (
    <main className="max-w-2xl mx-auto p-4 isolate">
        {/* Full-page profile background (viewer variant: page / page_dim) */}
        {bgUrl && (bgVariant === 'page' || bgVariant === 'page_dim') && (
          <>
            <div
              className="fixed inset-0 -z-10 bg-cover bg-center"
              style={{ backgroundImage: `url("${bgUrl}")` }}
              aria-hidden="true"
            />
            {bgVariant === 'page_dim' && (
              <div className="fixed inset-0 -z-10 bg-black/40" aria-hidden="true" />
            )}
          </>
        )}
        {showSkeleton && <ProfileSkeleton />}
        {!showSkeleton && (
          <div className="space-y-6 animate-in fade-in duration-300">
          {/* Loading state while friendship check is in progress */}
          {privacyChecked && !friendshipLoaded && (
            <div className="flex items-center justify-center py-8">
              <PentagramLoader size="lg" />
            </div>
          )}

          {/* Profile content */}
          {friendshipLoaded && (<>
          {cardVariantActive ? (
            <div className="relative overflow-hidden">
              <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${bgUrl}")` }} />
              <div className="absolute inset-0 bg-black/25" />
              <div className="relative z-10 space-y-4 p-4 sm:p-5">
                {headerRow}
                {statsBlock}
              </div>
            </div>
          ) : isEditing || (bgUrl && (bgVariant === 'banner' || bgVariant === 'card')) ? (
            <div className="relative overflow-hidden">
              <div className={`h-24 sm:h-28 w-full ${bgUrl ? "bg-cover bg-center" : "bg-muted/60"}`} style={bgUrl ? { backgroundImage: `url("${bgUrl}")` } : undefined}>
                {bgUrl && !isEditing && <div className="absolute inset-x-0 top-0 h-24 sm:h-28 bg-gradient-to-b from-black/45 via-black/20 to-transparent" />}
                {isOwnProfile && isEditing && (
                  <div className="absolute top-2 right-2 flex gap-2">
                    <label className="flex items-center gap-1.5 h-8 px-3 rounded-full bg-background/85 backdrop-blur cursor-pointer hover:bg-background transition-colors text-xs font-medium">
                      <ImagePlus className="w-4 h-4" />
                      {bgUrl ? t("profile.replaceBg") : t("profile.addBg")}
                      <input type="file" accept="image/*" onChange={handleBackgroundUpload} className="hidden" />
                    </label>
                    {bgUrl && (
                      <button
                        type="button"
                        onClick={handleBackgroundRemove}
                        className="h-8 w-8 rounded-full bg-background/85 backdrop-blur flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground transition-colors"
                        title={t("profile.removeBg")}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
                {backgroundUploading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/40">
                    <PentagramLoader size="sm" />
                  </div>
                )}
              </div>
              <div className="relative -mt-8 sm:-mt-10 px-4">
                {headerRow}
              </div>
            </div>
          ) : bgUrl && (bgVariant === 'page' || bgVariant === 'page_dim') ? (
            headerRow
          ) : (
            headerRow
          )}

          {isEditing ? (
            <div className="space-y-4">
              {/* Auto-theme toggle: when on, viewers see this profile in the
                  owner's theme (generated from the background/avatar). */}
              {isOwnProfile && (
                <div className="flex items-center justify-between rounded-lg border border-border bg-background/60 px-3 py-2.5">
                  <div>
                    <Label htmlFor="profile-theme-toggle" className="text-sm font-semibold">
                      Тема профиля
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Показывать посетителям тему, сгенерированную из фона и аватара
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="profile-theme-toggle"
                      checked={!!profile?.theme_enabled}
                      onCheckedChange={handleThemeEnabledToggle}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 shrink-0"
                      onClick={() => navigate("/settings/prof-studio")}
                    >
                      <Palette className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{t("profile.studio")}</span>
                      <span className="sm:hidden">{t("profile.studio")}</span>
                    </Button>
                  </div>
                </div>
              )}
              <div>
                <Label>{t("profile.about")}</Label>
                <GomoRichEditor
                  resetKey={bioEditorResetKey}
                  contentJson={bioJson}
                  legacyContent={bio}
                  onChange={({ json, text }) => {
                    setBioJson(json);
                    setBio(text);
                  }}
                  placeholder={t("profile.aboutPlaceholder")}
                  minHeightClassName="min-h-[120px]"
                />
              </div>


              {/* Avatar Crop Dialog */}
              <Dialog open={!!cropImage} onOpenChange={() => setCropImage(null)}>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>{t("profile.avatarCrop")}</DialogTitle>
                  </DialogHeader>
                  {cropImage && (
                    <AvatarCropper
                      imageSrc={cropImage}
                      onCropComplete={async (croppedImage) => {
                        await handleCropConfirm(croppedImage);
                      }}
                      onCancel={() => setCropImage(null)}
                    />
                  )}
                </DialogContent>
              </Dialog>




            </div>
          ) : (
            <div className="space-y-4">
              {/** stats visibility logic — moved to the statsBlock const; the
                  "card" background variant renders it inside the card. */}
              {cardVariantActive ? null : statsBlock}

              {profile.bio && !isNonFriendOnPrivate && (
                <div className="text-sm">
                  <ProcessedContent content={profile.bio} contentJson={(profile as { bio_json?: unknown }).bio_json} currentUserId={currentUser?.id || null} isAdmin={isModerator} currentUsername={currentUserUsername} currentUserColor={currentUserColor} postAuthorId={profile.id} authorUsername={profile.username} />
                </div>
              )}

              {/* Spotify Now Playing */}
              {!isNonFriendOnPrivate && (
                <SpotifyNowPlaying userId={userId!} />
              )}

              {/* Profile Tabs — visibility follows the owner's privacy settings.
                  For non-friends on a private profile the wall tab always stays
                  (it explains that the wall is hidden) while the rest follow the
                  per-section hide toggles. */}
              <div className="border-b border-border overflow-x-auto">
                <div className="flex gap-0 min-w-max">
                  {wallTabVisible && (
                    <button
                      onClick={() => { setActiveTab('wall'); setWallCreateOpen(false); }}
                      className={`px-4 sm:px-6 py-2.5 sm:py-3 text-xs sm:text-sm font-medium transition-colors relative ${
                        activeTab === 'wall'
                          ? 'text-primary border-b-2 border-primary'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {t("profile.wall")}
                    </button>
                  )}
                  {canViewSection(privateHideAchievements) && (
                  <button
                    onClick={() => { setActiveTab('achievements'); setWallCreateOpen(false); }}
                    className={`px-4 sm:px-6 py-2.5 sm:py-3 text-xs sm:text-sm font-medium transition-colors relative ${
                      activeTab === 'achievements'
                        ? 'text-primary border-b-2 border-primary'
                        : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {t("profile.achievements")} ({achievements.length})
                    </button>
                  )}
                    {showThreadsTab && canViewSection(privateHideThreads) && (
                    <button
                      onClick={() => { setActiveTab('threads'); setWallCreateOpen(false); }}
                      className={`px-4 sm:px-6 py-2.5 sm:py-3 text-xs sm:text-sm font-medium transition-colors relative ${
                        activeTab === 'threads'
                          ? 'text-primary border-b-2 border-primary'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {t("profile.threads")}
                    </button>
                  )}
                  {canViewSection(privateHideGifts) && (
                  <button
                    onClick={() => { setActiveTab('gifts'); setWallCreateOpen(false); }}
                    className={`px-4 sm:px-6 py-2.5 sm:py-3 text-xs sm:text-sm font-medium transition-colors relative ${
                      activeTab === 'gifts'
                        ? 'text-primary border-b-2 border-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span className="flex items-center gap-1">
                      <Gift className="w-3.5 h-3.5" />
                      {t("profile.gifts")} ({giftCount})
                    </span>
                  </button>
                  )}
                  {canViewSection(privateHideFriends) && (
                  <FriendsTabButton
                    activeTab={activeTab}
                    onClick={() => { setActiveTab('friends'); setWallCreateOpen(false); }}
                    userId={userId!}
                  />
                  )}
                </div>
              </div>

            </div>
          )}

          {/* Tab Content — the wall renders a "private profile" notice when it
              is hidden server-side; other tabs render only when their section
              is visible to this viewer. */}
          <>
          {activeTab === 'wall' && wallTabVisible && (
          <div>
              <ProfileWall
                profileUserId={userId!}
                currentUserId={currentUser?.id || null}
                currentUsername={currentUserUsername}
                canPost={currentUser?.id === userId || allowWallPostsFromOthers}
                showWall={showProfileWall}
                refreshKey={wallRefreshKey}
                wallHidden={wallHiddenFromViewer}
                privateProfile={privateProfile}
                createOpen={wallCreateOpen}
                onCreateOpenChange={setWallCreateOpen}
              />
            </div>
          )}

          {activeTab === 'achievements' && canViewSection(privateHideAchievements) && (
            <div>
            {achievements.length === 0 ? (
              <p className="text-muted-foreground">{t("profile.noAchievements")}</p>
            ) : (
              <div className="space-y-6">
                {/* Pinned achievements */}
                {pinnedAchievements.length > 0 && (
                  <div className={isEditing ? "" : "mb-8"}>
                    {isEditing && (
                      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                        <Pin className="w-4 h-4" />
                        {t("profile.pinned")} ({pinnedAchievements.length}/4)
                      </h3>
                    )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {pinnedAchievements.map((achievement) => (
                        <AchievementCard
                    key={achievement.id}
                          achievement={achievement}
                          onTogglePin={toggleAchievementPin}
                          isEditing={isEditing}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Regular achievements */}
                {regularAchievements.length > 0 && (
                  <div>
                    {isEditing && pinnedAchievements.length > 0 && (
                      <h3 className="text-lg font-semibold mb-3">{t("profile.allAchievements")}</h3>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {regularAchievements.slice(0, 4).map((achievement) => (
                        <AchievementCard
                          key={achievement.id}
                          achievement={achievement}
                          onTogglePin={toggleAchievementPin}
                          isEditing={isEditing}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Link to full achievements page */}
                <div className="pt-2">
                  <Link
                    to={`/achievements/${userId}`}
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors group/link"
                  >
                    <Trophy className="w-4 h-4 group-hover/link:text-amber-400 transition-colors" />
                    Все достижения
                    <span className="text-xs text-muted-foreground/50">
                      ({achievements.length})
                    </span>
                    <span className="ml-1 group-hover/link:translate-x-0.5 transition-transform">→</span>
                  </Link>
                </div>
              </div>
            )}
          </div>
          )}

          {activeTab === 'threads' && showThreadsTab && canViewSection(privateHideThreads) && (
            <div>
              <h2 className="text-xl font-bold mb-4">{t("profile.threads")} ({userThreads.length})</h2>
              {threadsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <PentagramLoader size="lg" />
                </div>
              ) : userThreads.length === 0 ? (
                <p className="text-muted-foreground">{t("profile.noThreads")}</p>
              ) : (
                <div className="space-y-4">
                  {userThreads.map((thread) => {
                    const likes = profileLikesMap.get(thread.id);
                    return (
                      <ThreadCard
                        key={thread.id}
                        thread={thread}
                        currentUserId={currentUser?.id || null}
                        currentUsername={currentUserUsername}
                        currentUserColor={currentUserColor}
                        showPreview={true}
                        initialLikesCount={likes?.count ?? 0}
                        initialUserLiked={likes?.isLiked ?? false}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'gifts' && canViewSection(privateHideGifts) && (
            <div>
              <GiftsTab
                userId={userId!}
                isOwnProfile={isOwnProfile}
                giftCatalog={giftCatalog}
                recipientUsername={profile.username}
                onGiftSent={() => {
                  setGiftCount((c) => c + 1);
                  loadProfile();
                }}
              />
            </div>
          )}

          {activeTab === 'friends' && canViewSection(privateHideFriends) && (
            <div>
              {isOwnProfile && <FriendRequestsList />}
              <FriendsList userId={userId} />
            </div>
          )}
          </>
          </>)}
        </div>
        )}

        {/* Avatar Gallery */}
        {showAvatarGallery && avatarHistory.length > 0 && (
          <AvatarGallery
            avatars={avatarHistory.map(ah => ({
              id: ah.id,
              url: storageUrl("post-images", ah.avatar_url) || ah.avatar_url,
              is_current: ah.is_current
            }))}
            initialIndex={avatarGalleryIndex}
            onClose={() => setShowAvatarGallery(false)}
            onDelete={isOwnProfile ? handleDeleteAvatar : undefined}
            canDelete={isOwnProfile}
          />
        )}

        {/* Username Change Dialog */}
        <Dialog open={showUsernameDialog} onOpenChange={setShowUsernameDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("profile.changeUsername")}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {t("profile.usernameDescription")}
            </p>
            <div className="space-y-3 mt-2">
              <div>
                <Label htmlFor="new-username">{t("profile.newUsername")}</Label>
                <Input
                  id="new-username"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="newuser"
                  maxLength={20}
                />
              </div>
              <div>
                <Label htmlFor="confirm-username">{t("profile.repeatUsername")}</Label>
                <Input
                  id="confirm-username"
                  value={confirmUsername}
                  onChange={(e) => setConfirmUsername(e.target.value)}
                  placeholder="newuser"
                  maxLength={20}
                />
              </div>
              {newUsername && !/^[a-zA-Z0-9]+$/.test(newUsername) && (
                <p className="text-xs text-destructive">{t("profile.latinOnly")}</p>
              )}
              {newUsername && newUsername === confirmUsername && newUsername !== profile?.username && (
                <p className="text-xs text-green-500">{t("profile.usernamesMatch")}</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowUsernameDialog(false); setNewUsername(""); setConfirmUsername(""); }}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleUsernameChange}
                disabled={!newUsername.trim() || newUsername !== confirmUsername || newUsername === profile?.username || !/^[a-zA-Z0-9]+$/.test(newUsername)}
              >
                {t("common.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Floating "Написать на стене" button — always on screen (fixed
            bottom-right), so a post can be created from any profile tab. */}
        {canPostOnWall && (
          <Button
            variant="default"
            size="icon"
            onClick={handleWallCreateClick}
            className="fixed bottom-24 right-6 z-40 h-12 w-12 rounded-2xl shadow-lg"
            title={wallCreateOpen ? "Скрыть форму" : "Написать на стене"}
          >
            <Plus className={`h-5 w-5 transition-transform duration-300 ease-out ${wallCreateOpen ? "rotate-45" : "rotate-0"}`} />
          </Button>
        )}
      </main>
  );
};

export default Profile;
