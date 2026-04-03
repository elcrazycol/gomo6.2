import { useEffect, useState, useRef } from "react";
import React from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/api/client_simple";
import { storageUrl } from "@/utils/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { HeaderUsername } from "@/components/HeaderUsername";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Camera, Edit2, LogOut, User, Settings, Pin, PinOff, Hammer } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { getProfileCustomization, parseCssToStyle } from "@/utils/profileCustomization";
import { AdminBadge } from "@/components/AdminBadge";
import { ProfileWall } from "@/components/ProfileWall";
import { ThreadCard } from "@/components/ThreadCard";
import { AvatarCropper } from "@/components/AvatarCropper";
import { GomoRichEditor } from "@/components/GomoRichEditor";
import { ProcessedContent } from "@/components/ProcessedContent";

interface Profile {
  id: string;
  username: string;
  bio: string | null;
  bio_json?: unknown;
  is_anonymous: boolean;
  thread_count: number;
  post_count: number;
  garma: number;
  thread_likes_received_count: number;
  created_at: string;
  avatar_url?: string | null;
  account_number?: number | null;
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

interface AchievementCardProps {
  achievement: Achievement;
  onTogglePin: (achievementId: string) => void;
  isPinned: boolean;
  isEditing: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const formatGarmaLabel = (value: number) => {
  const abs = Math.abs(value);
  const mod10 = abs % 10;
  const mod100 = abs % 100;

  if (mod10 === 1 && mod100 !== 11) return "gарма";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "gармы";
  return "gарм";
};

const AchievementCard: React.FC<AchievementCardProps> = ({ achievement, onTogglePin, isPinned, isEditing }) => {
  // Определяем стиль в зависимости от уровня
  const getAchievementStyle = (level: number) => {
    let baseClasses = "p-3 flex items-start gap-3 relative overflow-hidden";

    if (isEditing) {
      baseClasses += " group";
    }

    if (level >= 10) {
      return `${baseClasses} bg-gradient-to-br from-purple-900/20 to-purple-600/20 border-2 border-purple-400 shadow-lg shadow-purple-400/20`;
    } else if (level >= 8) {
      return `${baseClasses} bg-gradient-to-br from-red-900/20 to-red-600/20 border-2 border-red-400 shadow-lg shadow-red-400/20`;
    } else if (level >= 6) {
      return `${baseClasses} bg-gradient-to-br from-orange-900/20 to-orange-600/20 border-2 border-orange-400 shadow-lg shadow-orange-400/20`;
    } else if (level >= 4) {
      return `${baseClasses} bg-gradient-to-br from-yellow-900/20 to-yellow-600/20 border-2 border-yellow-400 shadow-lg shadow-yellow-400/20`;
    } else if (level >= 2) {
      return `${baseClasses} bg-gradient-to-br from-blue-900/20 to-blue-600/20 border-2 border-blue-400 shadow-lg shadow-blue-400/20`;
    } else {
      return `${baseClasses} bg-post-header border border-border`;
    }
  };

  const getLevelBadge = (level: number) => {
    if (level <= 1) return null;

    const colors = {
      2: "bg-blue-500",
      3: "bg-blue-600",
      4: "bg-yellow-500",
      5: "bg-yellow-600",
      6: "bg-orange-500",
      7: "bg-orange-600",
      8: "bg-red-500",
      9: "bg-red-600",
      10: "bg-purple-500",
    };

    return (
      <div className={`absolute top-2 right-2 ${colors[level as keyof typeof colors] || "bg-gray-500"} text-white text-xs px-2 py-1 rounded-full font-bold`}>
        {level}
      </div>
    );
  };

  return (
    <div className={getAchievementStyle(achievement.level || 1)}>
      {getLevelBadge(achievement.level || 1)}

      {/* Pin button - only visible in edit mode */}
      {isEditing && (
        <button
          onClick={() => onTogglePin(achievement.id)}
          className="absolute bottom-1 right-1 w-7 h-7 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors shadow-md z-20"
          title={isPinned ? "Открепить достижение" : "Закрепить достижение"}
        >
          {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
        </button>
      )}

      <span className="text-3xl relative z-10">{achievement.icon}</span>
      <div className="flex-1 relative z-10">
        <p className="font-bold">{achievement.name}</p>
        <p className="text-xs text-muted-foreground">
          {achievement.description}
        </p>
        <p className="text-xs text-primary mt-1">
          Уровень {achievement.level || 1} • {achievement.unlocked_at ? new Date(achievement.unlocked_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Недавно'}
        </p>
      </div>
    </div>
  );
};

const Profile = () => {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [pinnedAchievements, setPinnedAchievements] = useState<Achievement[]>([]);
  const [regularAchievements, setRegularAchievements] = useState<Achievement[]>([]);
  const [likesReceived, setLikesReceived] = useState(0);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [bioJson, setBioJson] = useState<unknown>(null);
  const [bioEditorResetKey, setBioEditorResetKey] = useState(0);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [confirmUsername, setConfirmUsername] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");
  const [pageLoading, setPageLoading] = useState(true);
  const [showUsernameDialog, setShowUsernameDialog] = useState(false);
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [customization, setCustomization] = useState<any>(null);
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [showLastSeen, setShowLastSeen] = useState(true);
  const [showOnlineStatus, setShowOnlineStatus] = useState(true);
  const [showProfileWall, setShowProfileWall] = useState(true);
  const [allowWallPostsFromOthers, setAllowWallPostsFromOthers] = useState(true);
  const [activeTab, setActiveTab] = useState<'wall' | 'achievements' | 'threads'>('achievements');
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
  const [threadsLoading, setThreadsLoading] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);
      
      if (user) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id);
        
        setIsModerator(roles?.some(r => r.role === 'moderator' || r.role === 'admin') || false);

        // Load current user profile and color
        const { data: profile } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", user.id)
          .single();

        if (profile) {
          setCurrentUserUsername(profile.username);
        }

        // Load current user color
        const { data: achievements } = await supabase
          .from("user_achievements")
          .select(`
            achievement_id,
            achievements (
              reward_type,
              reward_value
            )
          `)
          .eq("user_id", user.id);

        if (achievements) {
          const colorRewards = achievements
            .filter((a: any) => a.achievements?.reward_type === "username_color")
            .map((a: any) => a.achievements.reward_value);

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

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setCurrentUser(session?.user ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (userId) {
      const loadAll = async () => {
        setPageLoading(true);
        try {
          await Promise.all([loadProfile(), loadAchievements()]);
        } finally {
          setPageLoading(false);
        }
      };
      loadAll();
    }
  }, [userId]);

  // Realtime updates for online status of viewed profile
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`profile-status-${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        (payload) => {
          const updated = payload.new as any;
          if (updated) {
            setIsOnline(updated.is_online || false);
            setLastSeen(updated.last_seen_at || null);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // Update online status for current user
  useOnlineStatus(currentUser?.id);

  const loadProfile = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (data) {
      // Load thread likes count
      const { data: threadLikesData } = await supabase.rpc(
        "get_user_thread_likes_received_count",
        { user_uuid: userId }
      );

      setProfile({
        ...data,
        bio_json: (data as any).bio_json ?? undefined,
        garma: data.garma ?? 0,
        thread_likes_received_count: threadLikesData || 0
      });
      setUsername(data.username);
      setBio(data.bio || "");
      setBioJson((data as any).bio_json || null);
      setBioEditorResetKey((prev) => prev + 1);
      setIsAnonymous(data.is_anonymous);
      setAvatarUrl(data.avatar_url);
      setLastSeen(data.last_seen_at);
      setIsOnline(data.is_online || false);

      // Load privacy settings for online status, wall and stats
      const { data: privacyData } = await supabase
        .from("privacy_settings")
        .select("show_last_seen, show_online_status, show_profile_wall, allow_wall_posts_from_others, show_threads_tab, show_profile_stats, show_detailed_stats, stats_visibility")
        .eq("user_id", userId)
        .maybeSingle();

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
      }

      // Load customization
      const custom = await getProfileCustomization(userId);
      setCustomization(custom);

      // Load likes received count
      const { data: likesData } = await supabase.rpc('get_user_likes_received_count', {
        user_uuid: userId
      });
      setLikesReceived(likesData || 0);
    }
  };

  // Set default tab based on wall visibility
  useEffect(() => {
    if (showProfileWall) {
      setActiveTab('wall');
    } else {
      setActiveTab('achievements');
    }
  }, [showProfileWall]);

  const loadUserThreads = async () => {
    if (!userId) return;

    setThreadsLoading(true);
    try {
      const { data: threadsData, error } = await supabase
        .from('threads')
        .select(`
          id,
          title,
          content,
          image_url,
          image_urls,
          created_at,
          updated_at,
          user_id,
          tags,
          ephemeral_type,
          ephemeral_value,
          auto_delete_at,
          boards (
            slug,
            name
          )
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      if (threadsData) {
        // Get profiles for all threads
        const userIds = [...new Set(threadsData.map(t => t.user_id).filter(Boolean))];
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('id, username, is_anonymous, avatar_url')
          .in('id', userIds);

        // Get post counts for threads
        const threadIds = threadsData.map(t => t.id);
        const { data: postCounts } = await supabase
          .from('posts')
          .select('thread_id')
          .in('thread_id', threadIds);

        // Count posts per thread
        const postCountMap = postCounts?.reduce((acc, post) => {
          acc[post.thread_id] = (acc[post.thread_id] || 0) + 1;
          return acc;
        }, {} as Record<string, number>) || {};

        // Combine data
        const threadsWithData = threadsData.map(thread => ({
          ...thread,
          profiles: profilesData?.find(p => p.id === thread.user_id) || null,
          post_count: postCountMap[thread.id] || 0
        }));

        setUserThreads(threadsWithData);
      } else {
        setUserThreads([]);
      }
    } catch (error) {
      console.error('Error loading user threads:', error);
      toast.error('Ошибка загрузки тредов');
    } finally {
      setThreadsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'threads' && userThreads.length === 0) {
      loadUserThreads();
    }
  }, [activeTab, userId]);

  const toggleAchievementPin = async (achievementId: string) => {
    try {
      const { data, error } = await supabase.rpc('toggle_achievement_pin', {
        _user_id: userId,
        _achievement_id: achievementId
      });

      if (error) throw error;

      // Reload achievements to reflect changes
      await loadAchievements();
    } catch (error) {
      console.error('Error toggling achievement pin:', error);
    }
  };

  const loadAchievements = async () => {
    const { data } = await supabase
      .from("user_achievements")
      .select(`
        level,
        is_pinned,
        pinned_order,
        unlocked_at,
        achievements (
          id,
          name,
          description,
          icon,
          category,
          achievement_type
        )
      `)
      .eq("user_id", userId)
      .order("is_pinned", { ascending: false })
      .order("pinned_order", { ascending: true })
      .order("level", { ascending: false })
      .order("unlocked_at", { ascending: false });

    if (data) {
      // Process achievements without grouping by type (show all levels separately)
      const processedAchievements = data.map((ua: any) => {
        const achievement = ua.achievements ?? {};
        let displayName = achievement.name ?? "—";
        let displayDescription = achievement.description ?? "";

        // Achievement processing based on achievement ID and level

        // Customize name and description based on achievement ID (base achievements)
        if (achievement.id === 'time_10min') {
          const timeNames = {
            1: 'Дуралей I',
            2: 'Дуралей II',
            3: 'Дуралей III',
            4: 'Дуралей IV',
            5: 'Дуралей V',
            6: 'Дуралей VI',
            7: 'Дуралей VII',
            8: 'Дуралей VIII',
            9: 'Дуралей IX',
            10: 'Дуралей X'
          };
          const timeDescriptions = {
            1: 'Провёл на сайте 10 минут',
            2: 'Провёл на сайте 30 минут',
            3: 'Провёл на сайте 1 час',
            4: 'Провёл на сайте 5 часов',
            5: 'Провёл на сайте 10 часов',
            6: 'Провёл на сайте 25 часов',
            7: 'Провёл на сайте 50 часов',
            8: 'Провёл на сайте 100 часов',
            9: 'Провёл на сайте 250 часов',
            10: 'Провёл на сайте 500 часов'
          };
          displayName = timeNames[ua.level || 1] || achievement.name;
          displayDescription = timeDescriptions[ua.level || 1] || achievement.description;
        } else if (achievement.id === 'posts_10') {
          const postNames = {
            1: 'Первые 10 сообщений',
            2: 'Первые 100 сообщений',
            3: 'Болтливый',
            4: 'Многословный',
            5: 'Кладезь мудрости',
            6: 'Мастер слова',
            7: 'Легенда форума'
          };
          const postDescriptions = {
            1: 'Написал 10 сообщений',
            2: 'Написал 100 сообщений',
            3: 'Написал 250 сообщений',
            4: 'Написал 500 сообщений',
            5: 'Написал 1000 сообщений',
            6: 'Написал 2500 сообщений',
            7: 'Написал 5000 сообщений'
          };
          displayName = postNames[ua.level || 1] || achievement.name;
          displayDescription = postDescriptions[ua.level || 1] || achievement.description;
        } else if (achievement.id === 'threads_5') {
          const threadNames = {
            1: 'Создатель',
            2: 'Творец',
            3: 'Генератор идей',
            4: 'Архитектор сообщества',
            5: 'Мастер дискуссий',
            6: 'Легенда форума'
          };
          const threadDescriptions = {
            1: 'Создал 5 тредов',
            2: 'Создал 10 тредов',
            3: 'Создал 25 тредов',
            4: 'Создал 50 тредов',
            5: 'Создал 80 тредов',
            6: 'Создал 100 тредов'
          };
          displayName = threadNames[ua.level || 1] || achievement.name;
          displayDescription = threadDescriptions[ua.level || 1] || achievement.description;
        } else if (achievement.id === 'images_1' || achievement.id === 'images_10' || achievement.id === 'images_25' || achievement.id === 'images_50' || achievement.id === 'images_100' || achievement.id === 'images_250' || achievement.id === 'images_500' || achievement.id === 'images_1000') {
          const imageNames = {
            1: 'Фотограф-новичок',
            2: 'Коллекционер',
            3: 'Фотолюбитель',
            4: 'Фотограф',
            5: 'Мастер фотографии',
            6: 'Профессионал',
            7: 'Легенда фотографии',
            8: 'Икона фотографии'
          };
          const imageDescriptions = {
            1: 'Загрузил первое изображение',
            2: 'Загрузил 10 изображений',
            3: 'Загрузил 25 изображений',
            4: 'Загрузил 50 изображений',
            5: 'Загрузил 100 изображений',
            6: 'Загрузил 250 изображений',
            7: 'Загрузил 500 изображений',
            8: 'Загрузил 1000 изображений'
          };
          displayName = imageNames[ua.level || 1] || achievement.name;
          displayDescription = imageDescriptions[ua.level || 1] || achievement.description;
        } else if (achievement.id === 'likes_received_1' || achievement.id === 'likes_received_10' || achievement.id === 'likes_received_25' || achievement.id === 'likes_received_50' || achievement.id === 'likes_received_100' || achievement.id === 'likes_received_250' || achievement.id === 'likes_received_500' || achievement.id === 'likes_received_1000') {
          const likesNames = {
            1: 'Замеченный',
            2: 'Популярный',
            3: 'Уважаемый',
            4: 'Влиятельный',
            5: 'Лидер мнений',
            6: 'Мастер сообщества',
            7: 'Легенда форума',
            8: 'Икона сообщества'
          };
          const likesDescriptions = {
            1: 'Получил свой первый лайк',
            2: 'Получил 10 лайков',
            3: 'Получил 25 лайков',
            4: 'Получил 50 лайков',
            5: 'Получил 100 лайков',
            6: 'Получил 250 лайков',
            7: 'Получил 500 лайков',
            8: 'Получил 1000 лайков'
          };
          displayName = likesNames[ua.level || 1] || achievement.name;
          displayDescription = likesDescriptions[ua.level || 1] || achievement.description;
        }

        return {
          ...achievement,
          name: displayName,
          description: displayDescription,
          level: ua.level || 1,
          unlocked_at: ua.unlocked_at || new Date().toISOString(),
          is_pinned: ua.is_pinned || false,
          pinned_order: ua.pinned_order || null
        };
      });

      // Group achievements by type and keep only the highest level for each type
      // Only group achievements that have achievement_type (time, posts, threads, images, likes_received, likes_given)
      const achievementMap = new Map<string, typeof processedAchievements[0]>();
      const groupedTypes = ['time', 'posts', 'threads', 'images', 'likes_received', 'likes_given'];
      
      processedAchievements.forEach((achievement) => {
        // If achievement has a type that should be grouped, group by type
        // Otherwise, keep as individual achievement
        if (achievement.achievement_type && groupedTypes.includes(achievement.achievement_type)) {
          const key = achievement.achievement_type;
          const existing = achievementMap.get(key);
          
          if (!existing || (achievement.level || 1) > (existing.level || 1)) {
            achievementMap.set(key, achievement);
          }
        } else {
          // For non-grouped achievements, use their ID as key
          achievementMap.set(achievement.id, achievement);
        }
      });
      
      // Convert map back to array
      const groupedAchievements = Array.from(achievementMap.values());

      // Split achievements into pinned and regular
      const pinned = groupedAchievements.filter(a => a.is_pinned);
      const regular = groupedAchievements.filter(a => !a.is_pinned);

      setPinnedAchievements(pinned);
      setRegularAchievements(regular);
      setAchievements(groupedAchievements);
    }
  };

  const handleSave = async () => {
    if (!currentUser || currentUser.id !== userId) return;

    // Сохраняем профиль
    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        username,
        bio,
        bio_json: bioJson,
        is_anonymous: isAnonymous,
      })
      .eq("id", userId);

    if (profileError) {
      toast.error("Ошибка сохранения профиля");
      return;
    }

    // Смена пароля, если поле заполнено
    if (newPassword) {
      const { error: passwordError } = await supabase.auth.updateUser({
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
    await supabase.auth.signOut();
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
        return;
      }

      const croppedFile = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
      const fileName = `${userId}/avatar_${Date.now()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('post-images')
        .upload(fileName, croppedFile);

      if (uploadError) {
        console.error('Upload error:', uploadError);
        toast.error('Ошибка загрузки аватара');
        return;
      }

      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: fileName })
        .eq("id", userId);

      if (error) {
        console.error('Update error:', error);
        toast.error('Ошибка обновления профиля');
        return;
      }

      setAvatarUrl(fileName);
      setCropImage(null);
      toast.success("Аватар обновлен");
    } catch (error) {
      toast.error("Ошибка обработки изображения");
      console.error(error);
    }
  };


  const handleSaveAndExit = async () => {
    try {
      const prevBioJson = profile.bio_json ?? null;
      const bioJsonChanged =
        JSON.stringify(bioJson ?? null) !== JSON.stringify(prevBioJson);
      if (userId && (bio !== profile.bio || bioJsonChanged)) {
        const { error: bioError } = await supabase
          .from("profiles")
          .update({ bio, bio_json: bioJson })
          .eq("id", userId);

        if (bioError) throw bioError;
      }

      // Save username changes
      if (userId && newUsername.trim() && newUsername !== profile.username) {
        const { error: usernameError } = await supabase
          .from("profiles")
          .update({ username: newUsername.trim() })
          .eq("id", userId);

        if (usernameError) throw usernameError;

        setProfile(prev => prev ? { ...prev, username: newUsername.trim() } : null);
      }

      // Save anonymity setting
      if (userId && isAnonymous !== profile.is_anonymous) {
        const { error: anonError } = await supabase
          .from("profiles")
          .update({ is_anonymous: isAnonymous })
          .eq("id", userId);

        if (anonError) throw anonError;
      }

      setIsEditing(false);
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
    setNewUsername(profile.username);
    setBio(profile.bio || "");
    setBioJson(profile.bio_json ?? null);
    setBioEditorResetKey((prev) => prev + 1);
    setIsAnonymous(profile.is_anonymous);
    setIsEditing(true);
  };

  const handleUsernameChange = async () => {
    if (newUsername !== confirmUsername) {
      toast.error("Имена пользователя не совпадают");
      return;
    }

    if (newUsername.length < 3) {
      toast.error("Имя пользователя должно быть не менее 3 символов");
      return;
    }

    try {
      const { error } = await supabase
        .from("profiles")
        .update({ username: newUsername })
        .eq("id", userId);

      if (error) throw error;

      toast.success("Имя пользователя изменено");
      setProfile(prev => prev ? { ...prev, username: newUsername } : null);
      setUsername(newUsername);
      setShowUsernameDialog(false);
      setNewUsername("");
      setConfirmUsername("");
    } catch (error) {
      toast.error("Ошибка изменения имени пользователя");
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

  return (
    <main className="max-w-2xl mx-auto p-4">
        {pageLoading && (
          <div className="flex items-center justify-center py-20">
            <PentagramLoader size="lg" />
          </div>
        )}
        {!pageLoading && (
          <div className="space-y-6">
          {/* Profile Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* Avatar */}
              <div className="relative">
                <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center overflow-hidden">
                  {avatarUrl ? (
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

              {/* User Info */}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  {isEditing && isOwnProfile ? (
                    <Input
                      value={newUsername || profile.username}
                      onChange={(e) => setNewUsername(e.target.value)}
                      className="text-2xl font-bold h-auto p-0 border-none bg-transparent"
                      placeholder="Никнейм"
                    />
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <h1 
                        className="text-2xl font-bold"
                        style={customization?.username_css ? parseCssToStyle(customization.username_css) : {}}
                      >
                        {profile.username}
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
                <div className="flex items-center gap-2">
                  <p className="text-sm text-muted-foreground">
                    ID: {profile.id.slice(0, 8)} {profile.account_number && `(${profile.account_number})`}
                  </p>
                  {showOnlineStatus && isOnline && (
                    <span className="text-xs text-green-500 font-medium">● В сети</span>
                  )}
                  {showLastSeen && !isOnline && lastSeen && (
                    <span className="text-xs text-muted-foreground">
                      Был в сети {formatDistanceToNow(new Date(lastSeen), { locale: ru, addSuffix: true })}
                    </span>
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

            {/* Write Button for other users */}
            {!isOwnProfile && currentUser && (
              <Button
                variant="default"
                size="sm"
                onClick={() => navigate(`/messages?user=${userId}`)}
                className="text-xs sm:text-sm"
              >
                Написать
              </Button>
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
                        setCropImage(null);
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
                const summaryAllowed = isOwn || showProfileStats;
                if (!summaryAllowed) return null;
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-post-header border border-border">
                    <button
                      type="button"
                      onClick={() => navigate(`/stats?metric=threads&user=${userId}`)}
                      className="text-left"
                    >
                      <p className="text-sm text-muted-foreground">Тредов создано</p>
                      <p className="text-2xl font-bold">{profile.thread_count}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/stats?metric=posts&user=${userId}`)}
                      className="text-left"
                    >
                      <p className="text-sm text-muted-foreground">Постов написано</p>
                      <p className="text-2xl font-bold">{profile.post_count}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/stats?metric=postLikes&user=${userId}`)}
                      className="text-left"
                    >
                      <p className="text-sm text-muted-foreground">Лайков</p>
                      <p className="text-2xl font-bold">{likesReceived}/{profile.thread_likes_received_count}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/stats?metric=garma&user=${userId}`)}
                      className="text-left"
                    >
                      <p className="text-sm text-muted-foreground">gармы</p>
                      <p className="text-2xl font-bold">{profile.garma}</p>
                    </button>
                  </div>
                );
              })()}

              {profile.bio && (
                <div className="text-sm">
                  <ProcessedContent content={profile.bio} contentJson={(profile as any).bio_json} currentUserId={currentUser?.id || null} isAdmin={isModerator} currentUsername={currentUserUsername} currentUserColor={currentUserColor} postAuthorId={profile.id} authorUsername={profile.username} />
                </div>
              )}

              {/* Profile Tabs */}
              <div className="border-b border-border">
                <div className="flex gap-0">
                  {showProfileWall && (
                    <button
                      onClick={() => setActiveTab('wall')}
                      className={`px-6 py-3 text-sm font-medium transition-colors relative ${
                        activeTab === 'wall'
                          ? 'text-primary border-b-2 border-primary'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Стена
                    </button>
                  )}
                  <button
                    onClick={() => setActiveTab('achievements')}
                    className={`px-6 py-3 text-sm font-medium transition-colors relative ${
                      activeTab === 'achievements'
                        ? 'text-primary border-b-2 border-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Достижения ({achievements.length})
                  </button>
                  {showThreadsTab && (
                    <button
                      onClick={() => setActiveTab('threads')}
                      className={`px-6 py-3 text-sm font-medium transition-colors relative ${
                        activeTab === 'threads'
                          ? 'text-primary border-b-2 border-primary'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Треды
                    </button>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* Tab Content */}
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
                {/* Закрепленные достижения */}
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
                          isPinned={true}
                          isEditing={isEditing}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Обычные достижения */}
                {regularAchievements.length > 0 && (
                  <div>
                    {isEditing && pinnedAchievements.length > 0 && (
                      <h3 className="text-lg font-semibold mb-3">Все достижения</h3>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {regularAchievements.map((achievement) => (
                        <AchievementCard
                          key={achievement.id}
                          achievement={achievement}
                          onTogglePin={toggleAchievementPin}
                          isPinned={false}
                          isEditing={isEditing}
                        />
                      ))}
                    </div>
                  </div>
                )}
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
                  {userThreads.map((thread) => (
                    <ThreadCard
                      key={thread.id}
                      thread={thread}
                      currentUserId={currentUser?.id || null}
                      currentUsername={currentUserUsername}
                      currentUserColor={currentUserColor}
                      showPreview={true}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        )}
      </main>
  );
};

export default Profile;
