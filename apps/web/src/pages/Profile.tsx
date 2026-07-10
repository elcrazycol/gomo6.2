import { useEffect, useState, useRef, useCallback } from "react";
import React from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { storageUrl, uploadFile } from "@/utils/storage";
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
import { Camera, Edit2, LogOut, User, Settings, Hammer, Trash2, Pin, Trophy, Gift, MessageSquare, Lock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { safeDate } from "@/utils/safeDate";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { getProfileCustomization, parseCssToStyle, type ProfileCustomization } from "@/utils/profileCustomization";
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
import { Users } from "lucide-react";

interface Profile {
  id: string;
  username: string;
  display_name?: string | null;
  bio: string | null;
  bio_json?: unknown;
  is_anonymous: boolean;
  thread_count: number;
  post_count: number;
  garma: number;
  drops: number;
  thread_likes_received_count: number;
  created_at: string;
  avatar_url?: string | null;
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
        Друзья ({friendCount})
      </span>
    </button>
  );
};

const Profile = () => {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [achievements, setAchievements] = useState<AchievementData[]>([]);
  const [pinnedAchievements, setPinnedAchievements] = useState<AchievementData[]>([]);
  const [regularAchievements, setRegularAchievements] = useState<AchievementData[]>([]);
  const [likesReceived, setLikesReceived] = useState(0);
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
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");
  const [pageLoading, setPageLoading] = useState(true);
  const [showUsernameDialog, setShowUsernameDialog] = useState(false);
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [customization, setCustomization] = useState<ProfileCustomization | null>(null);
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [showLastSeen, setShowLastSeen] = useState(true);
  const [showOnlineStatus, setShowOnlineStatus] = useState(true);
  const [showProfileWall, setShowProfileWall] = useState(true);
  const [allowWallPostsFromOthers, setAllowWallPostsFromOthers] = useState(true);
  const [newPassword, setNewPassword] = useState("");
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
  const [privateHideAvatar, setPrivateHideAvatar] = useState(true);
  const [privateHideWall, setPrivateHideWall] = useState(true);
  const [privateHideThreads, setPrivateHideThreads] = useState(true);
  const [privateHideStats, setPrivateHideStats] = useState(true);
  const [privateHideFriends, setPrivateHideFriends] = useState(true);
  const [privateHideGifts, setPrivateHideGifts] = useState(true);
  const [privateHideAchievements, setPrivateHideAchievements] = useState(true);
  const [isMutualFriend, setIsMutualFriend] = useState<boolean | null>(null);
  const [privacyChecked, setPrivacyChecked] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await api.auth.getUser();
      setCurrentUser(user);
      
      if (user) {
        const token = (await api.auth.getSession()).data.session?.access_token;
        const headers = { 'Authorization': `Bearer ${token}` };

        // Load roles
        const rolesRes = await fetch(`/api/v1/user_roles?user_id=eq.${user.id}`, { headers });
        const rolesResult = await rolesRes.json();
        const roles = rolesResult.data;
        setIsModerator(roles?.some((r: { role: string }) => r.role === 'moderator' || r.role === 'admin') || false);

        // Load current user profile and color
        const profileRes = await fetch(`/api/v1/profiles?id=eq.${user.id}`, { headers });
        const profileResult = await profileRes.json();
        const profile = profileResult.data?.[0];

        if (profile) {
          setCurrentUserUsername(profile.username);
        }

        // Load current user color
        const achRes = await fetch(`/api/v1/user_achievements?user_id=eq.${user.id}`, { headers });
        const achResult = await achRes.json();
        const achievements = achResult.data;

        if (achievements) {
          const colorRewards = achievements
            .filter((a: { achievements?: { reward_type: string; reward_value: string } | undefined }) => a.achievements?.reward_type === "username_color")
            .map((a: { achievements?: { reward_type: string; reward_value: string } }) => a.achievements!.reward_value);

          const priority = ['purple', 'gold', 'orange', 'red', 'blue', 'green', 'yellow', 'cyan'];
          for (const p of priority) {
            if (colorRewards.includes(p)) {
              setCurrentUserColor(p);
              break;
            }
          }
        }
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

  // Load gift catalog
  useEffect(() => {
    const loadCatalog = async () => {
      try {
        const res = await fetch("/api/v1/gift_catalog");
        const result = await res.json();
        setGiftCatalog(result.data || []);
      } catch { /* ignore */ }
    };
    loadCatalog();
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
        } finally {
          setPageLoading(false);
        }
      };
      loadAll();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  // Realtime status polling for profile
  useEffect(() => {
    if (!userId) return;
    // Poll profile status every 10 seconds
    const pollStatus = async () => {
      try {
        const res = await fetch(`/api/v1/profiles?id=eq.${userId}`);
        const result = await res.json();
        const updated = result.data?.[0];
        if (updated) {
          setIsOnline(updated.is_online || false);
          setLastSeen(updated.last_seen_at || null);
        }
      } catch { /* ignore polling errors */ }
    };
    pollStatus();
    const interval = setInterval(pollStatus, 10000);
    return () => clearInterval(interval);
  }, [userId]);

  // Update online status for current user
  useOnlineStatus(currentUser?.id);

  const loadProfile = useCallback(async () => {
    const sessionAuth = await api.auth.getSession();
    const token = sessionAuth.data.session?.access_token;
    const headers: Record<string, string> | undefined = token ? { 'Authorization': `Bearer ${token}` } : undefined;

    const profileRes = await fetch(`/api/v1/profiles?id=eq.${userId}`);
    const profileResult = await profileRes.json();
    const data = profileResult.data?.[0];

    if (data) {
      // Load thread likes count (protected RPC)
      let threadLikesCount = 0;
      if (token) {
        try {
          const tlr = await fetch(`/api/rpc/get_user_thread_likes_received_count?user_uuid=${encodeURIComponent(userId!)}`, { headers });
          const tlrResult = await tlr.json();
          threadLikesCount = (tlrResult.data as number) || 0;
        } catch { /* ignore */ }
      }

      setProfile({
        ...data,
        bio_json: (data as { bio_json?: unknown }).bio_json ?? undefined,
        garma: data.garma ?? 0,
        drops: data.drops ?? 0,
        thread_likes_received_count: threadLikesCount
      });
      setUsername(data.username);
      setBio(data.bio || "");
      setBioJson((data as { bio_json?: unknown }).bio_json || null);
      setBioEditorResetKey((prev) => prev + 1);
      setIsAnonymous(data.is_anonymous);
      setAvatarUrl(data.avatar_url);
      setLastSeen(data.last_seen_at);
      setIsOnline(data.is_online || false);

      // Load privacy settings for online status, wall and stats
      const privacyRes = await fetch(`/api/v1/privacy_settings?user_id=eq.${userId}`);
      const privacyResult = await privacyRes.json();
      const privacyData = privacyResult.data?.[0];

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
        setPrivateHideAvatar(privacyData.private_hide_avatar ?? true);
        setPrivateHideWall(privacyData.private_hide_wall ?? true);
        setPrivateHideThreads(privacyData.private_hide_threads ?? true);
        setPrivateHideStats(privacyData.private_hide_stats ?? true);
        setPrivateHideFriends(privacyData.private_hide_friends ?? true);
        setPrivateHideGifts(privacyData.private_hide_gifts ?? true);
        setPrivateHideAchievements(privacyData.private_hide_achievements ?? true);
      }

      // Check friendship status for private profile
      // Use session user (localCurrentUser) instead of React state currentUser
      // to avoid race condition where currentUser is not yet set.
      const localCurrentUser = sessionAuth.data.session?.user;
      if (localCurrentUser?.id && localCurrentUser.id !== userId) {
        try {
          const friendRes = await fetch(`/api/v1/friends/status/${userId}`, { headers });
          const friendResult = await friendRes.json();
          setIsMutualFriend(friendResult.data?.status === 'friends');
        } catch {
          setIsMutualFriend(false);
        }
      } else {
        setIsMutualFriend(localCurrentUser?.id === userId ? true : false);
      }
      setPrivacyChecked(true);

      // Load customization
      const custom = await getProfileCustomization(userId!);
      setCustomization(custom);

      // Load likes received count (protected RPC)
      if (token) {
        try {
          const lr = await fetch(`/api/rpc/get_user_likes_received_count?user_uuid=${encodeURIComponent(userId!)}`, { headers });
          const lrResult = await lr.json();
          setLikesReceived((lrResult.data as number) || 0);
        } catch { /* ignore */ }
      }
    }
  }, [userId]);

  // Set default tab based on wall visibility
  useEffect(() => {
    const isNonFriendOnPriv = privateProfile && privacyChecked && currentUser?.id !== userId && isMutualFriend === false;
    const wallVisible = showProfileWall && (!isNonFriendOnPriv || !privateHideWall);
    if (wallVisible) {
      setActiveTab('wall');
    } else {
      setActiveTab('achievements');
    }
  }, [showProfileWall, privateProfile, privacyChecked, currentUser?.id, userId, isMutualFriend, privateHideWall]);

  const loadAvatarHistory = async () => {
    if (!userId) return [];

    try {
      const token = (await api.auth.getSession()).data.session?.access_token;
      const headers = token ? { 'Authorization': `Bearer ${token}` } : undefined;

      const res = await fetch('/api/rpc/get_avatar_history', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_uuid: userId }),
      });
      const result = await res.json();

      if (!res.ok) throw new Error(result.error || 'Failed to load avatar history');

      const data = result.data ?? result;
      setAvatarHistory((data || []) as AvatarHistoryItem[]);
      return (data || []) as AvatarHistoryItem[];
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
      toast.error('Ошибка загрузки тредов');
    } finally {
      setThreadsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (activeTab === 'threads' && userThreads.length === 0) {
      loadUserThreads();
    }
  }, [activeTab, userId, userThreads.length, loadUserThreads]);

  const toggleAchievementPin = async (achievementId: string) => {
    try {
      const token = (await api.auth.getSession()).data.session?.access_token;
      const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

      const res = await fetch('/api/rpc/toggle_achievement_pin', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          _user_id: userId,
          _achievement_id: achievementId
        }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to toggle pin');

      // Reload achievements to reflect changes
      await loadAchievements();
    } catch (error) {
      console.error('Error toggling achievement pin:', error);
    }
  };

  const loadAchievements = async () => {
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
      toast.error("Ошибка сохранения профиля");
      return;
    }

    // Смена пароля, если поле заполнено
    if (newPassword) {
      const { error: passwordError } = await api.auth.updateUser({
        password: newPassword,
      });

      if (passwordError) {
        toast.error("Ошибка смены пароля");
        return;
      } else {
        toast.success("Пароль успешно изменён");
        setNewPassword("");
      }
    }

    toast.success("Профиль обновлен");
    setIsEditing(false);
    loadProfile();
  };

  const handleLogout = async () => {
    await api.auth.signOut();
    toast.success("Вышли");
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setCropImage(event.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCropConfirm = async (croppedImageData?: string) => {
    if (!userId) return;

    // Show loader immediately and close crop dialog
    setCropImage(null);
    setAvatarUploading(true);

    try {
      let blob: Blob;

      if (croppedImageData) {
        // Use cropped image from AvatarCropper
        const response = await fetch(croppedImageData);
        blob = await response.blob();
      } else if (cropImage) {
        // Fallback: convert current cropImage to blob
        const response = await fetch(cropImage);
        blob = await response.blob();
      } else {
        setAvatarUploading(false);
        return;
      }

      const croppedFile = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
      const fileName = `${userId}/avatar_${Date.now()}.jpg`;

      await uploadFile('post-images', fileName, croppedFile);

      const token = (await api.auth.getSession()).data.session?.access_token;
      const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

      const updateRes = await        fetch(`/api/v1/profiles/${encodeURIComponent(userId!)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ avatar_url: fileName }),
      });

      if (!updateRes.ok) {
        setAvatarUploading(false);
        console.error('Update error:', await updateRes.text());
        toast.error('Ошибка обновления профиля');
        return;
      }

      setAvatarUrl(fileName);
      setAvatarUploading(false);
      toast.success("Аватар обновлен");

      // Reload avatar history
      await loadAvatarHistory();
    } catch (error) {
      setAvatarUploading(false);
      toast.error("Ошибка обработки изображения");
      console.error(error);
    }
  };

  const handleDeleteAvatar = async (avatarId: string) => {
    if (!currentUser || currentUser.id !== userId) return;

    try {
      const token = (await api.auth.getSession()).data.session?.access_token;
      const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

      const res = await fetch('/api/rpc/delete_avatar_from_history', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          avatar_id: avatarId,
          requesting_user_id: currentUser.id
        }),
      });
      const result = await res.json();

      if (!res.ok) throw new Error(result.error || 'Failed to delete avatar');

      if (result.data) {
        toast.success("Аватар удален");

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

        // Close gallery if no more avatars
        const historyRes = await fetch('/api/rpc/get_avatar_history', {
          method: 'POST',
          headers,
          body: JSON.stringify({ user_uuid: userId }),
        });
        const historyDataResult = await historyRes.json();
        const historyData = historyDataResult.data ?? historyDataResult;

        if (!historyData || (historyData as AvatarHistoryItem[]).length === 0) {
          setShowAvatarGallery(false);
        }
      } else {
        toast.error("Не удалось удалить аватар");
      }
    } catch (error) {
      console.error('Error deleting avatar:', error);
      toast.error("Ошибка удаления аватара");
    }
  };

  const handleAvatarClick = () => {
    if (avatarHistory.length > 0) {
      setAvatarGalleryIndex(0);
      setShowAvatarGallery(true);
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
      
      // Reload profile to show updated bio with processed tags
      await loadProfile();
      
      toast.success("Изменения сохранены");
    } catch (error) {
      toast.error("Ошибка сохранения изменений");
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
      toast.error("Введите юзернейм");
      return;
    }
    if (!/^[a-zA-Z0-9]+$/.test(newUsername)) {
      toast.error("Юзернейм может содержать только буквы латиницы и цифры (a-z, A-Z, 0-9)");
      return;
    }
    if (newUsername.length < 3 || newUsername.length > 20) {
      toast.error("Юзернейм должен быть от 3 до 20 символов");
      return;
    }
    if (newUsername !== confirmUsername) {
      toast.error("Юзернеймы не совпадают");
      return;
    }
    if (newUsername === profile?.username) {
      toast.error("Юзернейм не изменился");
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
        toast.error(result.error || "Ошибка изменения юзернейма");
        return;
      }

      toast.success("Юзернейм изменён");
      setProfile(prev => prev ? { ...prev, username: newUsername } : null);
      setUsername(newUsername);
      setShowUsernameDialog(false);
      setNewUsername("");
      setConfirmUsername("");
    } catch (error) {
      toast.error("Ошибка изменения юзернейма");
      console.error(error);
    }
  };

  // Don't show fullscreen loader for pageLoading - let content loader handle it
  if (!profile) {
    return (
      <div className="bg-background flex items-center justify-center min-h-screen">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  const isOwnProfile = currentUser?.id === userId;
  const isPrivate = privateProfile && privacyChecked;
  const friendshipLoaded = isMutualFriend !== null;
  const isNonFriendOnPrivate = isPrivate && !isOwnProfile && isMutualFriend === false;
  const showPrivateBanner = isNonFriendOnPrivate;

  const canViewSection = (hidden: boolean) => {
    if (!isNonFriendOnPrivate) return true;
    return !hidden;
  };

  return (
    <main className="max-w-2xl mx-auto p-4">
        {pageLoading && (
          <div className="flex items-center justify-center py-20">
            <PentagramLoader size="lg" />
          </div>
        )}
        {!pageLoading && (
          <div className="space-y-6">
          {/* Private profile banner */}
          {showPrivateBanner && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-primary">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
                <span>Приватный профиль — контент скрыт от не-друзей</span>
              </div>
              {!isOwnProfile && currentUser && (
                <FriendButton userId={userId!} isOwnProfile={false} />
              )}
            </div>
          )}

          {/* Loading state while friendship check is in progress */}
          {privacyChecked && !friendshipLoaded && (
            <div className="flex items-center justify-center py-8">
              <PentagramLoader size="lg" />
            </div>
          )}

          {/* Profile content */}
          {friendshipLoaded && (<>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 sm:gap-4">
              {/* Avatar */}
              {canViewSection(privateHideAvatar) && (
              <div className="relative">
                <div
                  className="w-14 h-14 sm:w-20 sm:h-20 rounded-full bg-muted flex items-center justify-center overflow-hidden cursor-pointer hover:opacity-80 transition-opacity"
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
                    <Input
                      value={newDisplayName || profile.display_name || profile.username}
                      onChange={(e) => setNewDisplayName(e.target.value)}
                      className="text-2xl font-bold h-auto p-0 border-none bg-transparent"
                      placeholder="Имя отображения"
                    />
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <h1 
                        className="text-xl sm:text-2xl font-bold"
                        style={customization?.username_css ? parseCssToStyle(customization.username_css) : {}}
                      >
                        {profile.display_name?.trim() || profile.username}
                      </h1>
                      {customization?.username_icon_svg && (
                        <span
                          className="inline-flex items-center justify-center"
                          dangerouslySetInnerHTML={{ __html: customization.username_icon_svg }}
                          style={{
                            fill: customization.username_icon_fill || undefined,
                            stroke: customization.username_icon_stroke || undefined,
                            width: '1em',
                            height: '1em',
                            maxHeight: '20px',
                            maxWidth: '20px',
                          }}
                        />
                      )}
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
                <div className="flex items-center gap-2 gap-y-0.5 flex-wrap">
                  <button
                    type="button"
                    className={`text-sm text-muted-foreground ${isOwnProfile ? 'hover:text-primary cursor-pointer transition-colors' : ''}`}
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
                  <span className="hidden sm:inline">Написать</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      const { startE2EChat } = await import("@/services/e2e/e2eManager");
                      const { conversationId, needsOtherUserKeys } = await startE2EChat(userId!);
                      if (needsOtherUserKeys) {
                        alert("E2E чат создан. Чтобы обмениваться зашифрованными сообщениями, собеседник должен также открыть E2E чат из вашего профиля.");
                      }
                      navigate(`/messages?conversation=${conversationId}`);
                    } catch (err) {
                      alert((err as Error).message || "Не удалось начать E2E чат");
                    }
                  }}
                  className="h-8 w-8 sm:w-auto p-0 sm:px-3 rounded-full sm:rounded-md transition-colors text-xs sm:text-sm gap-1.5 border-green-500/30 text-green-600 hover:bg-green-500/10"
                >
                  <Lock className="w-4 h-4" />
                  <span className="hidden sm:inline">E2E Чат</span>
                </Button>
              </div>
            )}
          </div>

          {isEditing ? (
            <div className="space-y-4">
              <div>
                <Label>О себе</Label>
                <GomoRichEditor
                  resetKey={bioEditorResetKey}
                  contentJson={bioJson}
                  legacyContent={bio}
                  onChange={({ json, text }) => {
                    setBioJson(json);
                    setBio(text);
                  }}
                  placeholder="Расскажите о себе..."
                  minHeightClassName="min-h-[120px]"
                />
              </div>


              {/* Avatar Crop Dialog */}
              <Dialog open={!!cropImage} onOpenChange={() => setCropImage(null)}>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Кадрирование аватара</DialogTitle>
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
              {/** stats visibility logic */}
              {(() => {
                const isOwn = currentUser?.id === userId;
                const summaryAllowed = isOwn || (showProfileStats && canViewSection(privateHideStats));
                if (!summaryAllowed) return null;
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 p-3 sm:p-4 bg-post-header border border-border">
                    <button
                      type="button"
                      onClick={() => navigate(`/stats?metric=threads&user=${userId}`)}
                      className="text-left"
                    >
                      <p className="text-xs sm:text-sm text-muted-foreground">Тредов</p>
                      <p className="text-xl sm:text-2xl font-bold">{profile.thread_count}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/stats?metric=posts&user=${userId}`)}
                      className="text-left"
                    >
                      <p className="text-xs sm:text-sm text-muted-foreground">Постов</p>
                      <p className="text-xl sm:text-2xl font-bold">{profile.post_count}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/stats?metric=postLikes&user=${userId}`)}
                      className="text-left"
                    >
                      <p className="text-xs sm:text-sm text-muted-foreground">Лайков</p>
                      <p className="text-xl sm:text-2xl font-bold">{likesReceived}/{profile.thread_likes_received_count}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/stats?metric=garma&user=${userId}`)}
                      className="text-left"
                    >
                      <p className="text-xs sm:text-sm text-muted-foreground">Гарма</p>
                      <p className="text-xl sm:text-2xl font-bold">{profile.garma}</p>
                    </button>
                  </div>
                );
              })()}

              {profile.bio && !isNonFriendOnPrivate && (
                <div className="text-sm">
                  <ProcessedContent content={profile.bio} contentJson={(profile as { bio_json?: unknown }).bio_json} currentUserId={currentUser?.id || null} isAdmin={isModerator} currentUsername={currentUserUsername} currentUserColor={currentUserColor} postAuthorId={profile.id} authorUsername={profile.username} />
                </div>
              )}

              {/* Spotify Now Playing */}
              {!isNonFriendOnPrivate && (
                <SpotifyNowPlaying userId={userId!} />
              )}

              {/* Profile Tabs — hidden entirely for non-friends on private profiles */}
              {!showPrivateBanner && (
              <div className="border-b border-border overflow-x-auto">
                <div className="flex gap-0 min-w-max">
                  {showProfileWall && canViewSection(privateHideWall) && (
                    <button
                      onClick={() => setActiveTab('wall')}
                      className={`px-4 sm:px-6 py-2.5 sm:py-3 text-xs sm:text-sm font-medium transition-colors relative ${
                        activeTab === 'wall'
                          ? 'text-primary border-b-2 border-primary'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Стена
                    </button>
                  )}
                  {canViewSection(privateHideAchievements) && (
                  <button
                    onClick={() => setActiveTab('achievements')}
                    className={`px-4 sm:px-6 py-2.5 sm:py-3 text-xs sm:text-sm font-medium transition-colors relative ${
                      activeTab === 'achievements'
                        ? 'text-primary border-b-2 border-primary'
                        : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Достижения ({achievements.length})
                    </button>
                  )}
                    {showThreadsTab && canViewSection(privateHideThreads) && (
                    <button
                      onClick={() => setActiveTab('threads')}
                      className={`px-4 sm:px-6 py-2.5 sm:py-3 text-xs sm:text-sm font-medium transition-colors relative ${
                        activeTab === 'threads'
                          ? 'text-primary border-b-2 border-primary'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Треды
                    </button>
                  )}
                  {canViewSection(privateHideGifts) && (
                  <button
                    onClick={() => setActiveTab('gifts')}
                    className={`px-4 sm:px-6 py-2.5 sm:py-3 text-xs sm:text-sm font-medium transition-colors relative ${
                      activeTab === 'gifts'
                        ? 'text-primary border-b-2 border-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span className="flex items-center gap-1">
                      <Gift className="w-3.5 h-3.5" />
                      Подарки ({giftCount})
                    </span>
                  </button>
                  )}
                  {canViewSection(privateHideFriends) && (
                  <FriendsTabButton
                    activeTab={activeTab}
                    onClick={() => setActiveTab('friends')}
                    userId={userId!}
                  />
                  )}
                </div>
              </div>
              )}

            </div>
          )}

          {/* Tab Content — hidden entirely for non-friends on private profiles */}
          {!showPrivateBanner && (<>
          {activeTab === 'wall' && (
          <div>
              <ProfileWall
                profileUserId={userId!}
                currentUserId={currentUser?.id || null}
                currentUsername={currentUserUsername}
                canPost={currentUser?.id === userId || allowWallPostsFromOthers}
                showWall={showProfileWall}
              />
            </div>
          )}

          {activeTab === 'achievements' && (
            <div>
            {achievements.length === 0 ? (
              <p className="text-muted-foreground">Достижений пока нет</p>
            ) : (
              <div className="space-y-6">
                {/* Pinned achievements */}
                {pinnedAchievements.length > 0 && (
                  <div className={isEditing ? "" : "mb-8"}>
                    {isEditing && (
                      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                        <Pin className="w-4 h-4" />
                        Закрепленные ({pinnedAchievements.length}/4)
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
                      <h3 className="text-lg font-semibold mb-3">Все достижения</h3>
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

          {activeTab === 'threads' && (
            <div>
              <h2 className="text-xl font-bold mb-4">Треды ({userThreads.length})</h2>
              {threadsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <PentagramLoader size="lg" />
                </div>
              ) : userThreads.length === 0 ? (
                <p className="text-muted-foreground">У пользователя пока нет тредов</p>
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

          {activeTab === 'gifts' && (
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

          {activeTab === 'friends' && (
            <div>
              {isOwnProfile && <FriendRequestsList />}
              <FriendsList userId={userId} />
            </div>
          )}
          </>)}
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
              <DialogTitle>Изменить юзернейм</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Ваш юзернейм — это то, по чему вас ищут. Только латинские буквы и цифры (a-z, A-Z, 0-9). Чувствителен к регистру.
            </p>
            <div className="space-y-3 mt-2">
              <div>
                <Label htmlFor="new-username">Новый юзернейм</Label>
                <Input
                  id="new-username"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="newuser"
                  maxLength={20}
                />
              </div>
              <div>
                <Label htmlFor="confirm-username">Повторите юзернейм</Label>
                <Input
                  id="confirm-username"
                  value={confirmUsername}
                  onChange={(e) => setConfirmUsername(e.target.value)}
                  placeholder="newuser"
                  maxLength={20}
                />
              </div>
              {newUsername && !/^[a-zA-Z0-9]+$/.test(newUsername) && (
                <p className="text-xs text-destructive">Только латинские буквы и цифры</p>
              )}
              {newUsername && newUsername === confirmUsername && newUsername !== profile?.username && (
                <p className="text-xs text-green-500">Юзернеймы совпадают</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowUsernameDialog(false); setNewUsername(""); setConfirmUsername(""); }}>
                Отмена
              </Button>
              <Button
                onClick={handleUsernameChange}
                disabled={!newUsername.trim() || newUsername !== confirmUsername || newUsername === profile?.username || !/^[a-zA-Z0-9]+$/.test(newUsername)}
              >
                Сохранить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
  );
};

export default Profile;
