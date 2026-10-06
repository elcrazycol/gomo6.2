import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "@/integrations/api/compat";
import { storageUrl } from "@/utils/storage";
import { Button } from "@/components/ui/button";
import { PentagramLoader } from "@/components/PentagramLoader";
import { useLoadingBarStore } from "@/stores/loadingBarStore";
import { transitionEnterClass } from "@/lib/viewTransitions";
import { useTransitionStyle } from "@/hooks/useTransitionStyle";
import { ProcessedContent } from "@/components/ProcessedContent";
import { SpotifyNowPlaying } from "@/components/SpotifyNowPlaying";
import { useUserRealtimeStatus } from "@/hooks/useRealtimeStatus";
import { getProfileCustomization, type ProfileCustomization } from "@/utils/profileCustomization";
import { normalizeProfileBackgroundVariant, type ProfileBackgroundVariant } from "@/utils/profileBackground";
import { isValidThemeTokens, applyProfileThemeTokens } from "@/utils/profileTheme";
import { getCurrentUserMeta } from "@/utils/currentUserMeta";
import { useProfileData } from "./profile/useProfileData";
import { warmProfilePageRow } from "@/routes/data/profileData";
import { useProfileEditing } from "./profile/useProfileEditing";
import { ProfileHeader } from "./profile/ProfileHeader";
import { ProfileStats } from "./profile/ProfileStats";
import { ProfileEditPanel } from "./profile/ProfileEditPanel";
import { ProfileTabs, type ProfileTab } from "./profile/ProfileTabs";
import { UsernameDialog, AvatarGalleryDialog } from "./profile/ProfileDialogs";
import type { Profile, ProfilePrivacyData } from "./profile/types";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ForumProfilePanel } from "./profile/ForumProfilePanel";
import { ForumProfileEdgeToggle, type ForumSide } from "./profile/ForumProfileEdgeToggle";
import { DEFAULT_FORUM_SIDE, PROFILE_VIEW_MODE_EVENT, getProfileViewMode } from "@/lib/profileViewMode";

/** Whether the viewport is wide enough for the desktop-only forum layout. */
const isDesktopViewport = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(min-width: 1024px)").matches;

/**
 * Profile page — orchestration shell. The loaded row + privacy flags and the
 * viewer guards live here; rendering is delegated to presentational components
 * (ProfileHeader/ProfileStats/ProfileEditPanel/ProfileTabs/ProfileDialogs) and
 * domain state to useProfileData (achievements/threads/avatars/gifts) and
 * useProfileEditing (edit mode, avatar/background/theme/username flows).
 */
const Profile = () => {
  const { t } = useTranslation();
  const { userId } = useParams();
  const navigate = useNavigate();
  const transitionStyle = useTransitionStyle();
  const prefersReducedMotion = useReducedMotion();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [currentUser, setCurrentUser] = useState<{ id: string } | null>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");
  const [customization, setCustomization] = useState<ProfileCustomization | null>(null);
  const [nicknameEmojiId, setNicknameEmojiId] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
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
  const [activeTab, setActiveTab] = useState<ProfileTab>('achievements');
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
  // Forum layout ("unfolded" profile). Session-only — resets on navigation and
  // is never persisted. `forumSide` is the side that hosts the panel and is kept
  // while it animates out so the exit keeps its direction/order; `panelVisible`
  // drives the AnimatePresence presence; `forumLayout` keeps the wide
  // two-column layout until the exit animation finishes, so the container and
  // content never snap shut mid-animation.
  const [forumSide, setForumSide] = useState<ForumSide | null>(null);
  const [panelVisible, setPanelVisible] = useState(false);
  const [forumLayout, setForumLayout] = useState(false);

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

  const loadProfile = useCallback(async () => {
    const sessionAuth = await api.auth.getSession();
    const token = sessionAuth.data.session?.access_token;
    const headers: Record<string, string> | undefined = token ? { 'Authorization': `Bearer ${token}` } : undefined;
    const localSessionUser = sessionAuth.data.session?.user;

    // The route parameter is a public number on new links and a UUID on old
    // ones, so the profile row is resolved FIRST: the privacy, friendship,
    // customization and realtime reads below all need the canonical UUID, and
    // the owner check can only be made once the row is known. Shared with the
    // route preloader (viewer-scoped key + SWR window), so back-navigation
    // within the stale window paints the header instantly and revalidates in
    // the background.
    const profileData = await warmProfilePageRow(localSessionUser?.id, userId ?? "");

    const data = profileData;

    // Paint the row the moment it is known — the route preloader usually has it
    // cached already, so this lands immediately after the swap. Privacy,
    // friendship and customization then fill in as they arrive; nothing
    // sensitive flashes (private content is stripped server-side and the derived
    // guards self-correct).
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
      setAvatarUrl(data.avatar_url);
      setLastSeen(data.last_seen_at);
      setIsOnline(data.is_online || false);
    }

    const profileId = data?.id ?? "";
    const isOwnProfileBySession = !!localSessionUser?.id && localSessionUser.id === profileId;

    // The three dependent reads stay parallel with each other.
    let privacyRes: Response | null = null;
    let friendshipRes: Response | null = null;
    let customization: Awaited<ReturnType<typeof getProfileCustomization>> | null = null;
    if (profileId) {
      [privacyRes, friendshipRes, customization] = await Promise.all([
        // The generic /privacy_settings endpoint is viewer-scoped (returns only
        // the caller's own row), so a foreign profile must use the public
        // /users/:id/privacy endpoint — the same rules the server enforces on
        // content (private_profile + private_hide_*).
        isOwnProfileBySession
          ? fetch(`/api/v1/privacy_settings?user_id=eq.${profileId}`)
          : fetch(`/api/v1/users/${profileId}/privacy`),
        // Guests cannot read a foreign user's friend status (protected endpoint)
        // and the owner is always a friend — skip the request in both cases.
        !isOwnProfileBySession && localSessionUser?.id
          ? fetch(`/api/v1/friends/status/${profileId}`, { headers }).catch(() => null)
          : Promise.resolve(null),
        getProfileCustomization(profileId),
      ]);
    }

    if (data) {
      // Privacy flags for online status, wall and stats. Parsed from the two
      // response shapes: the owner's row comes back as an array, the foreign
      // endpoint returns an object.
      let privacyData: ProfilePrivacyData | null = null;
      if (privacyRes) {
        try {
          const privacyJson = await privacyRes.json();
          privacyData = isOwnProfileBySession
            ? ((privacyJson.data?.[0] ?? null) as ProfilePrivacyData | null)
            : ((privacyJson.data ?? null) as ProfilePrivacyData | null);
        } catch {
          privacyData = null;
        }
      }

      if (privacyData) {
        setShowLastSeen(privacyData.show_last_seen ?? true);
        setShowOnlineStatus(privacyData.show_online_status ?? true);
        setShowProfileWall(privacyData.show_profile_wall ?? true);
        setAllowWallPostsFromOthers(privacyData.allow_wall_posts_from_others ?? true);
        setShowThreadsTab(privacyData.show_threads_tab ?? true);
        setShowProfileStats(privacyData.show_profile_stats ?? true);
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

      // Friendship status for the private-profile guards. Use the session user
      // (localSessionUser) instead of React state currentUser to avoid a race
      // where currentUser is not yet set. The owner is always a friend; guests
      // get "not a friend" without a doomed 401 request.
      if (isOwnProfileBySession) {
        setIsMutualFriend(true);
      } else if (localSessionUser?.id && friendshipRes) {
        try {
          const friendResult = await friendshipRes.json();
          setIsMutualFriend(friendResult.data?.status === 'friends');
        } catch {
          setIsMutualFriend(false);
        }
      } else {
        setIsMutualFriend(false);
      }
      setPrivacyChecked(true);

      // Customization is already fetched in parallel above (the nickname emoji
      // lives on the user profile, not in profile_customization — the latter
      // is read-scoped to the viewer).
      setCustomization(customization);
      setNicknameEmojiId((data as { nickname_emoji_id?: string | null }).nickname_emoji_id || null);

    }
  }, [userId]);

  // Live online status via WebSocket presence — the previous 10s HTTP polling
  // fired 6 requests/min per open profile page for the same data.
  // Everything downstream of the route parameter needs the canonical UUID: the
  // realtime presence room, the tab-scoped queries (user_id=eq.<uuid>), the
  // owner checks and the messenger deep link. The parameter itself may be a
  // public number, so the resolved row id is what gets passed around.
  const resolvedUserId = profile?.id ?? "";

  const realtimeStatus = useUserRealtimeStatus(resolvedUserId || undefined);
  useEffect(() => {
    if (!realtimeStatus) return;
    setIsOnline(realtimeStatus.is_online);
    if (realtimeStatus.last_seen) setLastSeen(realtimeStatus.last_seen);
  }, [realtimeStatus]);

  // Tab-scoped data (achievements, threads, avatar gallery, gifts) + edit-mode
  // state. Both hooks own their domains; they touch page state only through
  // the callbacks below.
  const data = useProfileData({
    userId: resolvedUserId,
    activeTab,
    currentUser,
    onAvatarUrlChange: setAvatarUrl,
  });

  const editing = useProfileEditing({
    userId: resolvedUserId,
    profile,
    currentUser,
    onProfileUpdate: setProfile,
    onAvatarUrlChange: setAvatarUrl,
    onNicknameEmojiChange: (emojiId) => {
      setNicknameEmojiId(emojiId || null);
      // The wall embeds the author's emoji in each post, so refetch it.
      setWallRefreshKey((k) => k + 1);
    },
    onReload: loadProfile,
    loadAvatarHistory: data.loadAvatarHistory,
  });

  // ── Profile privacy helpers ────────────────────────────────────────────────
  // Mirror the server-side rules (profileWallFinishSelectQuery and the per-
  // section CanViewUser* checks) so the client hides exactly what the backend
  // refuses to serve.
  const isOwnProfile = !!resolvedUserId && currentUser?.id === resolvedUserId;
  const isPrivate = privateProfile && privacyChecked;
  const isNonFriendOnPrivate = isPrivate && !isOwnProfile && isMutualFriend === false;
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
  const canPostOnWall = !!currentUser && (currentUser.id === resolvedUserId || allowWallPostsFromOthers) && showProfileWall && !wallHiddenFromViewer && !editing.isEditing;

  // ── Forum layout ─────────────────────────────────────────────────────────
  // An alternate profile layout: the avatar, write/subscribe actions and the
  // social graph move into a side column on the side whose edge strip was
  // pressed, while the rest of the profile reflows around it. The viewer's
  // default (Settings → Appearance: social or forum) decides how a profile
  // opens; manual toggling is per-visit and the layout closes while editing.
  const forumMode = forumLayout;
  const showForumToggle = !!profile && !!currentUser && !editing.isEditing;
  const panelVisibleRef = useRef(false);

  useEffect(() => {
    panelVisibleRef.current = panelVisible;
  }, [panelVisible]);

  const resetForum = useCallback(() => {
    setPanelVisible(false);
    setForumLayout(false);
    setForumSide(null);
  }, []);

  const openForum = useCallback((side: ForumSide = DEFAULT_FORUM_SIDE) => {
    setForumSide(side);
    setPanelVisible(true);
    setForumLayout(true);
  }, []);

  // Apply the default profile view — on profile open and live if the choice
  // changes from Settings. Guests and narrow viewports fall back to the social
  // layout: the forum layout is desktop-only and needs a signed-in viewer for
  // its actions to mean anything.
  const applyForumPreference = useCallback(() => {
    if (!currentUser || editing.isEditing) {
      resetForum();
      return;
    }
    if (getProfileViewMode() === "forum" && isDesktopViewport()) {
      openForum();
    } else {
      resetForum();
    }
  }, [currentUser, editing.isEditing, resetForum, openForum]);

  // Re-apply once per profile (the route param changes), as soon as the viewer
  // is known; a ref stops unrelated re-renders from reopening a manual close.
  const appliedViewForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentUser || editing.isEditing) {
      resetForum();
      return;
    }
    if (appliedViewForRef.current === userId) return;
    appliedViewForRef.current = userId ?? null;
    applyForumPreference();
  }, [userId, currentUser, editing.isEditing, applyForumPreference, resetForum]);

  useEffect(() => {
    const sync = () => applyForumPreference();
    window.addEventListener(PROFILE_VIEW_MODE_EVENT, sync);
    return () => window.removeEventListener(PROFILE_VIEW_MODE_EVENT, sync);
  }, [applyForumPreference]);

  const toggleForumSide = useCallback((side: ForumSide) => {
    if (panelVisible && forumSide === side) {
      // Close: hide the panel to start the exit animation. The wide layout is
      // kept until it completes (handleForumExitComplete), so nothing snaps.
      setPanelVisible(false);
      return;
    }
    setForumSide(side);
    setPanelVisible(true);
    setForumLayout(true);
  }, [panelVisible, forumSide]);

  const handleForumExitComplete = useCallback(() => {
    // Reopening during the exit cancels it; only collapse the layout when the
    // panel really stayed hidden.
    if (panelVisibleRef.current) return;
    setForumLayout(false);
    setForumSide(null);
  }, []);

  // The floating «Написать на стене» button is anchored to the content column.
  // In forum mode the column shifts to one side, so its distance from the
  // viewport edge is recomputed for the wider, two-column container.
  const fabRight = !forumMode
    ? "max(1rem, calc(50vw - 388px))"
    : forumSide === "left"
      ? "max(1rem, calc(50vw - 512px))"
      : "max(1rem, calc(50vw - 304px))";

  // Edge controls live in the gutters beside the content column. The whole
  // gutter (up to a cap) is a hover target; the arrow sits a fixed gap from the
  // content. The column is wider (max-w-5xl) when the forum panel is open.
  const forumToggleGutter = `clamp(0px, calc(50vw - ${forumMode ? "512px" : "336px"}), 40rem)`;
  const forumToggleGap = "48px";

  // Set default tab based on wall visibility. The wall tab is available to
  // every viewer while showProfileWall is on (for non-friends on a private
  // profile it shows the "wall is hidden" notice instead of content), so it
  // is the natural landing tab.
  useEffect(() => {
    setActiveTab(showProfileWall ? 'wall' : 'achievements');
  }, [showProfileWall]);

  useEffect(() => {
    if (userId) {
      const loadAll = async () => {
        const { begin, end } = useLoadingBarStore.getState();
        begin();
        try {
          // Only the profile row + privacy/friendship/customization are needed
          // for the first paint. The trophy list, avatar history, gift counts
          // and friends lists load lazily when their tab/action is first used.
          // No skeleton/spinner — the header loading bar is the only indicator
          // and the profile paints once it has loaded.
          await loadProfile();
        } catch (error) {
          console.error('Error loading profile data:', error);
        } finally {
          end();
        }
      };
      loadAll();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const handleWallCreateClick = () => {
    if (activeTab !== 'wall') {
      // Coming from another tab: jump to the wall and open the composer.
      setActiveTab('wall');
      setWallCreateOpen(true);
    } else {
      setWallCreateOpen((prev) => !prev);
    }
  };

  // ── Derived profile-background values ────────────────────────────────────
  // The owner uploads one image (background_url storage key); every viewer
  // picks how it is displayed (Settings → Внешний вид → «Отображение фонов»).
  const profileBackgroundUrl = profile?.background_url ?? null;
  const bgUrl = profileBackgroundUrl ? storageUrl("post-images", profileBackgroundUrl) || profileBackgroundUrl : null;
  // The "card" variant folds the header + stats into one card over the image.
  const cardVariantActive = bgVariant === 'card' && !!bgUrl && !editing.isEditing;

  // Forum layout styling — the main column becomes a stack of the same panels
  // as the side column; the owner's background is rendered as a blurred
  // full-page backdrop behind the whole profile (see below).
  const forumPanel = "surface-panel rounded-xl border border-border/60 shadow-sm";

  const statsSummaryAllowed = (() => {
    const isOwn = !!resolvedUserId && currentUser?.id === resolvedUserId;
    return isOwn || (showProfileStats && canViewSection(privateHideStats));
  })();

  // The profile paints as soon as its row is loaded (the header loading bar
  // covers the wait); the parallel reads (privacy, friendship, achievements,
  // avatar history) fill the already-painted page in place.

  const headerElement = profile ? (
    <ProfileHeader
      profile={profile}
      isOwnProfile={isOwnProfile}
      isEditing={editing.isEditing}
      avatarVisible={canViewSection(privateHideAvatar)}
      avatarUrl={avatarUrl}
      avatarUploading={editing.avatarUploading}
      avatarUploadPercent={editing.avatarUploadPercent}
      isAvatarDragging={editing.isAvatarDragging}
      avatarDragHandlers={editing.avatarDragHandlers}
      newDisplayName={editing.newDisplayName}
      onNewDisplayNameChange={editing.setNewDisplayName}
      customization={customization}
      nicknameEmojiId={nicknameEmojiId}
      showOnlineStatus={showOnlineStatus}
      currentUser={currentUser}
      onAvatarClick={data.openAvatarGallery}
      onAvatarUpload={editing.handleAvatarUpload}
      onNicknameEmojiSelect={editing.handleNicknameEmojiSelect}
      onNicknameEmojiRemove={editing.handleNicknameEmojiRemove}
      onEditClick={editing.isEditing ? editing.handleSaveAndExit : editing.startEditing}
      onUsernameClick={() => editing.setShowUsernameDialog(true)}
      onOpenMessages={() => navigate(`/messages?user=${resolvedUserId}`)}
      forumMode={forumMode}
    />
  ) : null;

  // Shared tab bar + active tab body. Defined once so the forum and social
  // layouts can place it differently. In the forum layout the bar is always its
  // own panel, while the body is only panel-wrapped for tabs whose content is a
  // plain list (subscribers) — the wall/threads/achievements/gifts tabs already
  // render their own cards, so wrapping them would double up.
  const profileTabsElement = (
    <ProfileTabs
      activeTab={activeTab}
      onTabChange={(tab) => { setActiveTab(tab); setWallCreateOpen(false); }}
      userId={resolvedUserId}
      profile={profile}
      isOwnProfile={isOwnProfile}
      isEditing={editing.isEditing}
      panel={forumMode}
      contentPanel={forumMode && activeTab === "subscribers"}
      currentUser={currentUser}
      currentUsername={currentUserUsername}
      currentUserColor={currentUserColor}
      wallTabVisible={wallTabVisible}
      showThreadsTab={showThreadsTab}
      canViewAchievements={canViewSection(privateHideAchievements)}
      canViewThreads={canViewSection(privateHideThreads)}
      canViewGifts={canViewSection(privateHideGifts)}
      canViewSubscriptions={canViewSection(privateHideFriends)}
      showProfileWall={showProfileWall}
      allowWallPostsFromOthers={allowWallPostsFromOthers}
      wallHiddenFromViewer={wallHiddenFromViewer}
      privateProfile={privateProfile}
      wallRefreshKey={wallRefreshKey}
      wallCreateOpen={wallCreateOpen}
      onWallCreateOpenChange={setWallCreateOpen}
      trophies={data.trophies}
      trophiesLoaded={data.trophiesLoaded}
      giftCatalog={data.giftCatalog}
      giftCount={data.giftCount}
      giftCountLoaded={data.giftCountLoaded}
      onGiftSent={() => {
        data.incrementGiftCount();
        loadProfile();
      }}
    />
  );

  return (
    <main
      className={`mx-auto p-4 isolate overflow-x-clip transition-[max-width] ${
        panelVisible
          ? "duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
          : "duration-[260ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
      } ${panelVisible ? "max-w-5xl" : "max-w-2xl"}`}
    >
        {/* Full-page profile background. In forum mode the owner's background
            is a soft, blurred backdrop behind the whole layout; otherwise the
            viewer picks the sharp page/page_dim treatment. */}
        {bgUrl && (forumMode ? (
          <>
            <div
              className="fixed inset-0 -z-10 scale-110 bg-cover bg-center opacity-60 blur-2xl"
              style={{ backgroundImage: `url("${bgUrl}")` }}
              aria-hidden="true"
            />
            <div className="fixed inset-0 -z-10 bg-background/70" aria-hidden="true" />
          </>
        ) : (bgVariant === 'page' || bgVariant === 'page_dim') ? (
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
        ) : null)}
        {profile && (
          <div className={transitionEnterClass(transitionStyle)}>
          {/* Two-column forum layout: when a side is active, the relocated
              profile panel is rendered as a first-class column and the rest of
              the profile reflows beside it. The AnimatePresence stays mounted
              so the panel can animate both in and out. */}
          <div className="flex items-start">
            <AnimatePresence initial={false} onExitComplete={handleForumExitComplete}>
              {panelVisible && (
                <motion.aside
                  key="forum-panel"
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 260 }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={
                    prefersReducedMotion
                      ? { duration: 0.15, ease: "easeOut" }
                      : panelVisible
                        // Expand — soft, decelerating tail.
                        ? { duration: 0.4, ease: [0.22, 1, 0.36, 1] }
                        // Collapse — shorter and with a livelier tail so the
                        // panel does not crawl into place.
                        : { duration: 0.24, ease: [0.4, 0, 0.2, 1] }
                  }
                  className={`hidden shrink-0 self-stretch overflow-clip lg:block ${
                    forumSide === "left" ? "order-1" : "order-2"
                  }`}
                >
                  {/* The gutter is part of the animated footprint (panel 240px +
                      20px gap) so it collapses in the same motion instead of
                      popping away when the panel unmounts. The inner box keeps
                      its full width while the column animates, so the panel
                      never squishes — the aside just clips it. */}
                  <div className={`h-full w-[260px] ${forumSide === "left" ? "pr-5" : "pl-5"}`}>
                    <div className="sticky top-[calc(var(--app-header-pad,0px)+1rem)]">
                      <ForumProfilePanel
                        profile={profile}
                        isOwnProfile={isOwnProfile}
                        avatarVisible={canViewSection(privateHideAvatar)}
                        avatarUrl={avatarUrl}
                        currentUser={currentUser}
                        canViewSubscriptions={canViewSection(privateHideFriends)}
                        onAvatarClick={data.openAvatarGallery}
                        onOpenMessages={() => navigate(`/messages?user=${resolvedUserId}`)}
                        onEditClick={editing.isEditing ? editing.handleSaveAndExit : editing.startEditing}
                      />
                    </div>
                  </div>
                </motion.aside>
              )}
            </AnimatePresence>
            <div className={`relative min-w-0 flex-1 ${forumSide === "left" ? "order-2" : "order-1"}`}>
          {/* Profile content — painted as soon as the profile row is loaded.
              The privacy/friendship flags arrive in parallel and the derived
              guards (wallHiddenFromViewer, canViewSection) self-correct when
              they land, so a public profile never waits on them. Private
              content is already stripped server-side, so nothing sensitive
              flashes for a non-friend on a private profile. */}
          {/* Crossfade between the forum and social variants of the content, so
              the panel styling does not blink out the instant the mode flips.
              `wait` keeps one variant mounted at a time (no double wall). */}
          <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={forumMode ? "forum" : "social"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: prefersReducedMotion ? 0 : 0.14, ease: "easeOut" } }}
            transition={{
              // Entering the social layout (forum → profile) is the tail of the
              // collapse — keep it quick; expanding back into the forum stays
              // soft.
              duration: prefersReducedMotion ? 0 : forumMode ? 0.2 : 0.12,
              ease: forumMode ? "easeInOut" : "easeOut",
            }}
            className={forumMode ? "space-y-3" : "space-y-6"}
          >
          {forumMode ? (
            <>
              {/* Identity panel — identity, stats and bio together. */}
              <section className={`${forumPanel} p-4`}>
                <div className="space-y-3">
                  {headerElement}
                  <ProfileStats profile={profile} show={statsSummaryAllowed} onOpenWall={() => setActiveTab('wall')} />
                  {profile.bio && !isNonFriendOnPrivate && (
                    <div className="border-t border-border/50 pt-3 text-sm">
                      <ProcessedContent content={profile.bio} contentJson={(profile as { bio_json?: unknown }).bio_json} currentUserId={currentUser?.id || null} isAdmin={isModerator} currentUsername={currentUserUsername} currentUserColor={currentUserColor} postAuthorId={profile.id} postAuthorPublicId={profile.public_id} authorUsername={profile.username} />
                    </div>
                  )}
                </div>
              </section>

              {/* Spotify Now Playing — renders its own card only while playing. */}
              {!isNonFriendOnPrivate && (
                <SpotifyNowPlaying userId={resolvedUserId} />
              )}

              {/* Tabs — the bar is always its own panel; the body gets a panel
                  for every tab except the wall, where each post is a panel. */}
              {profileTabsElement}
            </>
          ) : (
          <>
          {cardVariantActive ? (
            <div className="relative overflow-hidden">
              <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${bgUrl}")` }} />
              <div className="absolute inset-0 bg-black/25" />
              <div className="relative z-10 space-y-4 p-4 sm:p-5">
                {headerElement}
                <ProfileStats profile={profile} show={statsSummaryAllowed} onOpenWall={() => setActiveTab('wall')} />
              </div>
            </div>
          ) : editing.isEditing || (bgUrl && (bgVariant === 'banner' || bgVariant === 'card')) ? (
            <div className="relative overflow-hidden">
              <div className={`h-24 sm:h-28 w-full ${bgUrl ? "bg-cover bg-center" : "bg-muted/60"}`} style={bgUrl ? { backgroundImage: `url("${bgUrl}")` } : undefined}>
                {bgUrl && !editing.isEditing && <div className="absolute inset-x-0 top-0 h-24 sm:h-28 bg-gradient-to-b from-black/45 via-black/20 to-transparent" />}
                {/* Legibility scrim where the identity block overlaps the strip.
                    The previous approach faked contrast with a white halo on the
                    text itself, which (with a gradient nickname's transparent
                    text fill) painted a blurred white copy over the letters and
                    made every nickname look washed out. Darkening the image
                    behind the text works for light and custom-coloured names
                    alike without touching the glyphs. Same box as the strip so
                    "top-0" also means "bottom of the banner"; the dark stops sit
                    only in the band the avatar/name cover, leaving the image
                    visible above them. */}
                {bgUrl && !editing.isEditing && (
                  <div
                    className="pointer-events-none absolute inset-x-0 top-0 h-24 sm:h-28"
                    style={{ backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.35) 24%, transparent 58%)' }}
                    aria-hidden="true"
                  />
                )}
                {isOwnProfile && editing.isEditing && (
                  <div className="absolute top-2 right-2 flex gap-2">
                    <label className="flex items-center gap-1.5 h-8 px-3 rounded-full bg-background/85 backdrop-blur cursor-pointer hover:bg-background transition-colors text-xs font-medium">
                      <ImagePlus className="w-4 h-4" />
                      {bgUrl ? t("profile.replaceBg") : t("profile.addBg")}
                      <input type="file" accept="image/*" onChange={editing.handleBackgroundUpload} className="hidden" />
                    </label>
                    {bgUrl && (
                      <button
                        type="button"
                        onClick={editing.handleBackgroundRemove}
                        className="h-8 w-8 rounded-full bg-background/85 backdrop-blur flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground transition-colors"
                        title={t("profile.removeBg")}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
                {editing.backgroundUploading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/40">
                    <PentagramLoader size="sm" />
                  </div>
                )}
              </div>
              <div className="relative -mt-8 sm:-mt-10 px-4">
                {headerElement}
              </div>
            </div>
          ) : (
            headerElement
          )}

          {editing.isEditing ? (
            <ProfileEditPanel
              isOwnProfile={isOwnProfile}
              profile={profile}
              bio={editing.bio}
              bioJson={editing.bioJson}
              bioEditorResetKey={editing.bioEditorResetKey}
              cropImage={editing.cropImage}
              onBioChange={editing.onBioChange}
              onCropCancel={() => editing.setCropImage(null)}
              onCropComplete={editing.handleCropConfirm}
              onThemeToggle={editing.handleThemeEnabledToggle}
            />
          ) : (
            <div className="space-y-4">
              {/** stats visibility logic — moved to the ProfileStats component; the
                  "card" background variant renders it inside the card. */}
              {cardVariantActive ? null : (
                <ProfileStats profile={profile} show={statsSummaryAllowed} onOpenWall={() => setActiveTab('wall')} />
              )}

              {profile.bio && !isNonFriendOnPrivate && (
                <div className="text-sm">
                  <ProcessedContent content={profile.bio} contentJson={(profile as { bio_json?: unknown }).bio_json} currentUserId={currentUser?.id || null} isAdmin={isModerator} currentUsername={currentUserUsername} currentUserColor={currentUserColor} postAuthorId={profile.id} postAuthorPublicId={profile.public_id} authorUsername={profile.username} />
                </div>
              )}

              {/* Spotify Now Playing */}
              {!isNonFriendOnPrivate && (
                <SpotifyNowPlaying userId={resolvedUserId} />
              )}

              {/* Profile Tabs — visibility follows the owner's privacy settings.
                  For non-friends on a private profile the wall tab always stays
                  (it explains that the wall is hidden) while the rest follow the
                  per-section hide toggles. */}
              {profileTabsElement}
            </div>
          )}
          </>
          )}
          </motion.div>
          </AnimatePresence>
            </div>
          </div>
          </div>
        )}

        {/* Avatar Gallery */}
        {data.showAvatarGallery && (
          <AvatarGalleryDialog
            avatars={data.avatarHistory}
            initialIndex={data.avatarGalleryIndex}
            canDelete={isOwnProfile}
            onClose={data.closeAvatarGallery}
            onDelete={data.deleteAvatar}
          />
        )}

        {/* Username Change Dialog */}
        <UsernameDialog
          open={editing.showUsernameDialog}
          newUsername={editing.newUsername}
          confirmUsername={editing.confirmUsername}
          profileUsername={profile?.username}
          onOpenChange={editing.setShowUsernameDialog}
          onNewUsernameChange={editing.setNewUsername}
          onConfirmUsernameChange={editing.setConfirmUsername}
          onCancel={editing.closeUsernameDialog}
          onSave={editing.handleUsernameChange}
        />

        {/* Floating "Написать на стене" button — always on screen so a post can
            be created from any profile tab. Anchored to the right edge of the
            content column (which shifts when the forum panel is open); on
            narrow screens it falls back to a normal corner FAB. */}
        {canPostOnWall && (
          <Button
            variant="default"
            size="icon"
            onClick={handleWallCreateClick}
            className="fixed z-40 h-12 w-12 rounded-2xl shadow-lg"
            style={{
              // `right` is the distance from the viewport's right edge, so a
              // LARGER constant moves the button further right.
              right: fabRight,
              bottom: "calc(1.5rem + env(safe-area-inset-bottom))",
            }}
            title={wallCreateOpen ? "Скрыть форму" : "Написать на стене"}
          >
            <Plus className={`h-5 w-5 transition-transform duration-300 ease-out ${wallCreateOpen ? "rotate-45" : "rotate-0"}`} />
          </Button>
        )}

        {/* Edge controls that unfold the profile into the forum layout. Desktop
            only — hidden under `lg`, where there is no hover and no room for a
            second column. The same side closes; the opposite side moves the
            panel across. */}
        {showForumToggle && (
          <>
            <ForumProfileEdgeToggle
              side="left"
              active={forumSide === "left"}
              onToggle={toggleForumSide}
              gutterWidth={forumToggleGutter}
              gap={forumToggleGap}
            />
            <ForumProfileEdgeToggle
              side="right"
              active={forumSide === "right"}
              onToggle={toggleForumSide}
              gutterWidth={forumToggleGutter}
              gap={forumToggleGap}
            />
          </>
        )}
      </main>
  );
};

export default Profile;