import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useLocation, useNavigationType } from "react-router-dom";
import { ImagePlus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "@/integrations/api/compat";
import { storageUrl } from "@/utils/storage";
import { Button } from "@/components/ui/button";
import { PentagramLoader } from "@/components/PentagramLoader";
import { useLoadingBarStore } from "@/stores/loadingBarStore";
import { ContentEnter } from "@/components/motion/ContentEnter";
import { ProcessedContent } from "@/components/ProcessedContent";
import { SpotifyNowPlaying } from "@/components/SpotifyNowPlaying";
import { useUserRealtimeStatus } from "@/hooks/useRealtimeStatus";
import { getProfileCustomization, type ProfileCustomization } from "@/utils/profileCustomization";
import { normalizeProfileBackgroundVariant, type ProfileBackgroundVariant } from "@/utils/profileBackground";
import { isValidThemeTokens, applyProfileThemeTokens } from "@/utils/profileTheme";
import { getCurrentUserMeta } from "@/utils/currentUserMeta";
import { useFriendsStore } from "@/stores/friendsStore";
import { useProfileData } from "./profile/useProfileData";
import { warmProfilePageRow, peekWarmedProfilePageRow } from "@/routes/data/profileData";
import { useProfileEditing } from "./profile/useProfileEditing";
import { ProfileHeader } from "./profile/ProfileHeader";
import { ProfileStats } from "./profile/ProfileStats";
import { ProfileEditPanel } from "./profile/ProfileEditPanel";
import { ProfileTabs, type ProfileTab } from "./profile/ProfileTabs";
import { ProfilePinnedThreads } from "./profile/ProfilePinnedThreads";
import { useOwnerStories } from "@/components/stories/useOwnerStories";
import { useStoriesStore } from "@/stores/storiesStore";
import { hasUnreadCloseFriends } from "@/types/stories";
import { UsernameDialog, AvatarGalleryDialog } from "./profile/ProfileDialogs";
import type { Profile, ProfilePrivacyData } from "./profile/types";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ProfileSkeleton } from "@/components/skeletons/ContentSkeletons";
import {
  EASE_OUT_EXPO,
  morphOrigin,
  morphTransition,
  springFor,
} from "@/lib/motion";
import { AvatarMorph } from "@/components/profile/AvatarMorph";
import { CreateFab } from "@/components/CreateFab";
import { isAnimatedAvatarUrl } from "@/components/UserAvatar";
import { SeededPattern } from "@/components/SeededPattern";
import { RecedeOnScroll } from "@/components/profile/RecedeOnScroll";
import { toViewportRect, type ViewportRect } from "@/utils/domRect";
import { readProfileAvatarOrigin } from "@/utils/profileAvatarTransition";
import { ForumProfilePanel } from "./profile/ForumProfilePanel";
import { DEFAULT_FORUM_SIDE, PROFILE_VIEW_MODE_EVENT, getProfileViewMode, type ForumSide } from "@/lib/profileViewMode";

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
  const location = useLocation();
  const navigationType = useNavigationType();
  const prefersReducedMotion = useReducedMotion();
  const profileAvatarOrigin = useMemo(
    () => navigationType === "PUSH" ? readProfileAvatarOrigin(location.state) : null,
    [location.state, navigationType],
  );

  // The route preloader warmed this profile's row under the same viewer-scoped
  // key the page reads (App keeps the previous screen until it resolves — see
  // AppRoutes), so it is usually already cached at mount. Peek it
  // SYNCHRONOUSLY so the header belongs to the very first painted frame.
  // Without this the page first committed an empty shell — page background
  // only — and on iOS/PWA (several frames of jank follow the swap) everything
  // then popped in un-animated, with the wall cascade trailing behind it. The
  // prewarmed values are safe to show: private content is stripped
  // server-side, and the privacy/friendship guards below self-correct when
  // their reads arrive. A missed peek degrades to loadProfile's own flow.
  const peekWarmRow = () => peekWarmedProfilePageRow(userId ?? "");
  const [profile, setProfile] = useState<Profile | null>(() => peekWarmRow());
  const [avatarUrl, setAvatarUrl] = useState<string | null>(() => peekWarmRow()?.avatar_url ?? null);
  const [lastSeen, setLastSeen] = useState<string | null>(() => peekWarmRow()?.last_seen_at ?? null);
  const [isOnline, setIsOnline] = useState<boolean>(() => peekWarmRow()?.is_online || false);
  // A route parameter can resolve to nothing (deleted account, or an old public
  // number that was reissued). Without this flag the page rendered an empty
  // <main> forever — a link to a dead profile used to look like a broken site.
  const [notFound, setNotFound] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ id: string } | null>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");
  const [customization, setCustomization] = useState<ProfileCustomization | null>(null);
  const [nicknameEmojiId, setNicknameEmojiId] = useState<string | null>(null);
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

  // First paint vs. later transitions. `AnimatePresence initial={false}` would
  // reach EVERY nested motion element through PresenceContext — not just its
  // direct child — and silently suppress the entrance of the header, stats and
  // cards until the subtree remounts (that is why the wall only started
  // cascading after one visit to edit mode). So the presence wrapper stays
  // neutral and the direct children opt out on their own first mount instead.
  const didPaintRef = useRef(false);
  useEffect(() => {
    didPaintRef.current = true;
  }, []);

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

    setNotFound(!data);

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

    // The two dependent reads stay parallel with each other. Friendship status
    // is NOT fetched here: it lives in the shared friends store (the same
    // source the FriendButton reads), so the page and the button share one
    // request and the guards below follow later button actions without reload.
    let privacyRes: Response | null = null;
    let customization: Awaited<ReturnType<typeof getProfileCustomization>> | null = null;
    if (profileId) {
      [privacyRes, customization] = await Promise.all([
        // The generic /privacy_settings endpoint is viewer-scoped (returns only
        // the caller's own row), so a foreign profile must use the public
        // /users/:id/privacy endpoint — the same rules the server enforces on
        // content (private_profile + private_hide_*).
        isOwnProfileBySession
          ? fetch(`/api/v1/privacy_settings?user_id=eq.${profileId}`)
          : fetch(`/api/v1/users/${profileId}/privacy`),
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
      // where currentUser is not yet set. The value is resolved through the
      // shared friends store (deduped with the FriendButton); the reactive
      // subscription below then keeps the guards in sync with later actions.
      // Guests cannot read a foreign user's friend status (protected endpoint)
      // and the owner is always a friend — no request in both cases.
      if (isOwnProfileBySession) {
        setIsMutualFriend(true);
      } else if (localSessionUser?.id) {
        setIsMutualFriend(null);
        void useFriendsStore.getState().checkStatus(profileId).then((s) => {
          setIsMutualFriend(s === "friends");
        });
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

  // Live friendship status for the private-profile guards below. The store is
  // the single source (loadProfile resolves through it too), so befriending
  // via the FriendButton updates the guards without a page reload.
  const liveFriendStatus = useFriendsStore((s) =>
    resolvedUserId ? s.friendStatusMap[resolvedUserId]?.status : undefined,
  );

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

  useEffect(() => {
    if (liveFriendStatus === undefined || !resolvedUserId || isOwnProfile) return;
    setIsMutualFriend(liveFriendStatus === "friends");
  }, [liveFriendStatus, resolvedUserId, isOwnProfile]);
  // ── Stories ───────────────────────────────────────────────────────────────
  // One read per profile visit feeds both the avatar ring and the viewer; the
  // store keeps the slide list, so marking a slide viewed shrinks the ring
  // immediately.
  const { stories: profileStories } = useOwnerStories("user", resolvedUserId || null);
  const openStoryViewer = useStoriesStore((state) => state.openViewer);
  const openStoryComposer = useStoriesStore((state) => state.openComposer);
  const storyCount = profileStories.length;
  const storyReadCount = profileStories.filter((story) => story.is_viewed).length;
  const storyCloseFriends = hasUnreadCloseFriends(profileStories);
  const openProfileStories = () => {
    const firstUnread = profileStories.find((story) => !story.is_viewed) ?? profileStories[0];
    if (!firstUnread) return;
    openStoryViewer({
      ownerType: "user",
      ownerId: resolvedUserId,
      storyId: firstUnread.id,
      origin: "profile",
    });
  };
  const addProfileStory = () => {
    if (!currentUser?.id) return;
    openStoryComposer({
      ownerType: "user",
      ownerId: currentUser.id,
      ownerName: profile?.display_name || currentUserUsername || "",
    });
  };

  // ── Avatar → gallery: one image, one spring ──────────────────────────────
  // The avatar grows into the full-screen photo and back as a single flying
  // element (components/profile/AvatarMorph) instead of a View Transition: the
  // browser can only cross-fade two snapshots, which dissolves a circle into a
  // square rather than opening a window.
  //
  // `avatarOriginRef` is whichever avatar is on screen — the header circle or the
  // forum panel's square cover.
  const avatarOriginRef = useRef<HTMLElement | null>(null);
  const setAvatarOrigin = useCallback((el: HTMLElement | null) => {
    avatarOriginRef.current = el;
  }, []);

  // The photo URL the header already displays — the morph flies the same object
  // the gallery opens on, so there is no swap of source mid-flight.
  const avatarSrc = avatarUrl ? storageUrl("post-images", avatarUrl) ?? avatarUrl : null;

  // `landed` is the handover step: the flight is over and the gallery's own photo
  // and chrome may appear, while the clone is still exactly on top of them. It
  // fades itself out a moment later, so nothing ever pops over the image.
  const [avatarMorph, setAvatarMorph] = useState<{
    direction: "open" | "close";
    src: string;
    from: ViewportRect;
    to?: ViewportRect;
    landed?: boolean;
  } | null>(null);
  const [profileEntryMorph, setProfileEntryMorph] = useState<{
    src: string;
    from: ViewportRect;
    to: ViewportRect;
  } | null>(null);
  const entryMorphStartedForRef = useRef<string | null>(null);

  const openAvatarGallery = () => {
    if (avatarMorph) return;
    const from = toViewportRect(avatarOriginRef.current?.getBoundingClientRect());
    if (!from || !avatarSrc || prefersReducedMotion) {
      void data.openAvatarGallery();
      return;
    }
    // The kit photo has to be decoded before the gallery mounts: without an
    // intrinsic size the <img> has no box, and the morph would have nothing to
    // land on (it would fall back to the plain open).
    const preload = new Image();
    preload.src = avatarSrc;
    const decoded = typeof preload.decode === "function" ? preload.decode().catch(() => undefined) : Promise.resolve();
    void decoded.then(() => {
      void data.openAvatarGallery();
      setAvatarMorph({ direction: "open", src: avatarSrc, from });
    });
  };

  const closeAvatarGallery = () => {
    if (avatarMorph) return;
    const from = toViewportRect(
      document.querySelector<HTMLElement>(".msg-lightbox-slide[data-active] .msg-lightbox-media")?.getBoundingClientRect(),
    );
    const to = toViewportRect(avatarOriginRef.current?.getBoundingClientRect());
    if (!from || !to || !avatarSrc || prefersReducedMotion) {
      data.closeAvatarGallery();
      return;
    }
    setAvatarMorph({ direction: "close", src: avatarSrc, from, to });
  };

  // What the viewer should be doing right now. Opening: step aside until the
  // flight lands, then let the photo and chrome come in under the clone. Closing:
  // keep fading out the whole time — dropping the class on landing would let the
  // dark backdrop flash back for the ~140 ms the clone spends dissolving.
  const galleryMorph: "open" | "close" | null = !avatarMorph
    ? null
    : avatarMorph.direction === "close"
      ? "close"
      : avatarMorph.landed
        ? null
        : "open";

  // The flight landed: opening reveals the photo + chrome under the clone;
  // closing has nothing to reveal (the viewer is already on its way out).
  const landAvatarMorph = () => {
    setAvatarMorph((current) => (current ? { ...current, landed: true } : current));
  };

  // The avatar's own furniture (the add-story badge) leaves for the flight and
  // comes back the moment it lands — waiting for the last frame of the handover
  // is what made it feel like it arrived late.
  const avatarFurnitureHidden = !!avatarMorph && !avatarMorph.landed;

  // The clone is gone. Closing: the photo is back on the avatar, so the viewer
  // can go away for real.
  const finishAvatarMorph = () => {
    setAvatarMorph((current) => {
      if (current?.direction === "close") data.closeAvatarGallery();
      return null;
    });
  };

  const isPrivate = privateProfile && privacyChecked;  const isNonFriendOnPrivate = isPrivate && !isOwnProfile && isMutualFriend === false;
  // A wall is hidden from the viewer when they are neither the owner nor a
  // mutual friend AND (the profile is private OR the owner hid the wall).
  const wallHiddenFromViewer = !isOwnProfile && isMutualFriend === false && (privateProfile || privateHideWall);

  // Per-section visibility for a non-owner, non-friend viewer: the owner's
  // private_hide_* toggles apply on private AND public profiles alike
  // (mirroring the server, which strips the fields in both cases). The owner
  // and mutual friends always see everything; while the friendship check is
  // still pending (null) sections stay visible and self-correct when it
  // lands — stripped content renders as a placeholder, never as a leak.
  const canViewSection = (hidden: boolean) => {
    if (isOwnProfile || isMutualFriend !== false) return true;
    return !hidden;
  };

  // A profile opened from the chat keeps the same avatar pixels in flight from
  // the chat header to the profile header. Wait until privacy is resolved, the
  // real avatar is mounted and the source image is decoded, so the flight has
  // two measured endpoints and never starts blank or reveals a hidden avatar.
  useLayoutEffect(() => {
    if (
      !profileAvatarOrigin ||
      prefersReducedMotion ||
      !profile?.id ||
      !avatarSrc ||
      isAnimatedAvatarUrl(profileAvatarOrigin.src) ||
      isAnimatedAvatarUrl(avatarSrc) ||
      !privacyChecked ||
      (isNonFriendOnPrivate && privateHideAvatar) ||
      entryMorphStartedForRef.current === location.key
    ) return;

    const to = toViewportRect(avatarOriginRef.current?.getBoundingClientRect());
    if (!to) return;

    let cancelled = false;
    const image = new Image();
    image.src = profileAvatarOrigin.src;
    const decoded = typeof image.decode === "function"
      ? image.decode().catch(() => undefined)
      : Promise.resolve();
    void decoded.then(() => {
      if (cancelled) return;
      entryMorphStartedForRef.current = location.key;
      setProfileEntryMorph({
        src: profileAvatarOrigin.src,
        from: profileAvatarOrigin.from,
        to,
      });
    });

    return () => { cancelled = true; };
  }, [
    profileAvatarOrigin,
    prefersReducedMotion,
    profile?.id,
    avatarSrc,
    privateHideAvatar,
    privacyChecked,
    isNonFriendOnPrivate,
    location.key,
  ]);

  const finishProfileEntryMorph = useCallback(() => {
    setProfileEntryMorph(null);
  }, []);

  const canViewThreads = canViewSection(privateHideThreads);
  const threadsVisible = showThreadsTab && canViewThreads;

  // The wall tab is available to every viewer while the wall is enabled: for
  // non-friends on a private profile it renders the "wall is hidden" notice
  // instead of content.
  const wallTabVisible = showProfileWall && (isNonFriendOnPrivate || canViewSection(privateHideWall));

  // «Всё» combines the owner's threads and their wall, so it is offered (and is
  // the landing tab) only when at least one of those surfaces actually carries
  // content for this viewer. A wall that is visible merely as a "hidden" notice
  // must not open an empty stream, so it does not count here.
  const wallContentVisible = wallTabVisible && !wallHiddenFromViewer;
  const allTabVisible = threadsVisible || wallContentVisible;

  // The floating "Написать на стене" button is shown when this viewer may
  // actually leave a post: logged in, allowed on this wall, and the wall is
  // visible (not hidden server-side, not disabled, not in edit mode).
  const canPostOnWall = !!currentUser && (currentUser.id === resolvedUserId || allowWallPostsFromOthers) && showProfileWall && !wallHiddenFromViewer && !editing.isEditing;

  // ── Forum layout ─────────────────────────────────────────────────────────
  // An alternate profile layout: the avatar, write/subscribe actions and the
  // social graph move into a side column, while the rest of the profile reflows
  // around it. There are no in-page controls — the viewer's «Вид профилей по
  // умолчанию» (Settings → Appearance: social or forum) is the only switch, and
  // the profile follows it live. The panel always opens on the left; the layout
  // closes while editing.
  const forumMode = forumLayout;
  const panelVisibleRef = useRef(false);

  useEffect(() => {
    panelVisibleRef.current = panelVisible;
  }, [panelVisible]);

  const resetForum = useCallback(() => {
    setPanelVisible(false);
    setForumLayout(false);
    setForumSide(null);
  }, []);

  const openForum = useCallback(() => {
    setForumSide(DEFAULT_FORUM_SIDE);
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

  // Set default tab. «Всё» is the natural landing surface when it is visible
  // (it is the owner's whole stream); otherwise fall back to the wall, then to
  // achievements for a profile that exposes neither threads nor a wall.
  useEffect(() => {
    setActiveTab(allTabVisible ? 'all' : showProfileWall ? 'wall' : 'achievements');
  }, [allTabVisible, showProfileWall]);

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
  // Generative banner seed: the profile identity. When the owner has no
  // uploaded background, avatar + banner render the same pattern field.
  const bannerSeedKey = profile?.id ?? resolvedUserId ?? "anon";
  const showBannerStrip =
    editing.isEditing || bgVariant === "banner" || bgVariant === "card";
  // The "card" variant folds the header + stats into one card over the image.
  const cardVariantActive = bgVariant === 'card' && !!bgUrl && !editing.isEditing;

  // Forum layout styling — the main column becomes a stack of the same panels
  // as the side column; the owner's background is rendered as a blurred
  // full-page backdrop behind the whole profile (see below).
  const forumPanel = "surface-panel rounded-xl border border-border/60 shadow-sm";

  const statsSummaryAllowed = (() => {
    return isOwnProfile || (showProfileStats && canViewSection(privateHideStats));
  })();

  // The profile paints as soon as its row is loaded (the header loading bar
  // covers the wait); the parallel reads (privacy, friendship, achievements,
  // avatar history) fill the already-painted page in place.
  // Cold (no warmed row, e.g. a deep link with no intent prefetch): a shaped
  // header skeleton holds the layout — same geometry the real header takes —
  // so the row fades in without reflow instead of popping over bare
  // background.

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
      onAvatarClick={openAvatarGallery}
      avatarRef={setAvatarOrigin}
      avatarMorphing={avatarFurnitureHidden}
      onAvatarUpload={editing.handleAvatarUpload}
      onNicknameEmojiSelect={editing.handleNicknameEmojiSelect}
      onNicknameEmojiRemove={editing.handleNicknameEmojiRemove}
      onEditClick={editing.isEditing ? editing.handleSaveAndExit : editing.startEditing}
      onUsernameClick={() => editing.setShowUsernameDialog(true)}
      onOpenMessages={() => navigate(`/messages?user=${resolvedUserId}`)}
      forumMode={forumMode}
      storyCount={storyCount}
      storyReadCount={storyReadCount}
      storyCloseFriends={storyCloseFriends}
      onOpenStories={openProfileStories}
      onAddStory={addProfileStory}
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
      allTabVisible={allTabVisible}
      wallTabVisible={wallTabVisible}
      showThreadsTab={showThreadsTab}
      canViewAchievements={canViewSection(privateHideAchievements)}
      canViewThreads={canViewThreads}
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
      onGiftSent={() => {
        data.incrementGiftCount();
        loadProfile();
      }}
    />
  );

  return (
    <motion.main
      initial={false}
      animate={{ maxWidth: panelVisible ? 1024 : 672 }}
      transition={springFor("soft", prefersReducedMotion)}
      className="mx-auto p-4 isolate overflow-x-clip"
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
        {!profile && !notFound && (
          <ContentEnter data-testid="profile-skeleton">
            <ProfileSkeleton />
          </ContentEnter>
        )}
        {!profile && notFound && (
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springFor("standard", prefersReducedMotion)}
            className="mt-16 flex flex-col items-center gap-3 text-center"
          >
            <h1 className="text-xl font-bold">{t("profile.notFoundTitle")}</h1>
            <p className="max-w-sm text-sm text-muted-foreground">{t("profile.notFoundHint")}</p>
            <Button variant="secondary" className="mt-2" onClick={() => navigate("/")}>
              {t("common.goHome")}
            </Button>
          </motion.div>
        )}
        {profile && (
          <ContentEnter>
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
                  transition={{
                    // Expand and collapse run on the same physics — a spring
                    // that carries its velocity, so reopening mid-collapse
                    // continues from the current width instead of restarting.
                    // Collapse is the stiffer of the two: the panel is leaving,
                    // there is nothing to wait for.
                    ...springFor(panelVisible ? "soft" : "snappy", prefersReducedMotion),
                    opacity: { duration: prefersReducedMotion ? 0 : 0.18 },
                  }}
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
                        onAvatarClick={openAvatarGallery}
                        avatarRef={setAvatarOrigin}
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
          <AnimatePresence mode="wait">
          <motion.div
            key={forumMode ? "forum" : "social"}
            initial={didPaintRef.current ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: prefersReducedMotion ? 0 : 0.14, ease: EASE_OUT_EXPO } }}
            transition={{
              // Entering the social layout (forum → profile) is the tail of the
              // collapse — keep it quick; expanding back into the forum stays
              // soft. Opacity only, so a short expo curve, never a spatial ease.
              duration: prefersReducedMotion ? 0 : forumMode ? 0.2 : 0.12,
              ease: EASE_OUT_EXPO,
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

              {/* «Закреплённые темы» — up to 3 curated threads, between the
                  identity panel and the tabs (issue #518). */}
              <ProfilePinnedThreads
                userId={resolvedUserId}
                isOwner={isOwnProfile}
                currentUserId={currentUser?.id ?? null}
              />

              {/* Tabs — the bar is always its own panel; the body gets a panel
                  for every tab except the wall, where each post is a panel. */}
              {profileTabsElement}
            </>
          ) : (
          <>
          <RecedeOnScroll>
          {cardVariantActive ? (
            <div className="relative overflow-hidden">
              <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${bgUrl}")` }} />
              <div className="absolute inset-0 bg-black/25" />
              <div className="relative z-10 space-y-4 p-4 sm:p-5">
                {headerElement}
                <ProfileStats profile={profile} show={statsSummaryAllowed} onOpenWall={() => setActiveTab('wall')} />
              </div>
            </div>
          ) : showBannerStrip ? (
            <div className="relative overflow-hidden">
              <div className={`h-24 sm:h-28 w-full ${bgUrl ? "bg-cover bg-center" : ""}`} style={bgUrl ? { backgroundImage: `url("${bgUrl}")` } : undefined}>
                {!bgUrl && (
                  <SeededPattern
                    seedKey={bannerSeedKey}
                    className="absolute inset-0 h-full w-full"
                  />
                )}
                {bgUrl && !editing.isEditing && <div className="absolute inset-x-0 top-0 h-24 sm:h-28 bg-gradient-to-b from-black/45 via-black/20 to-transparent" aria-hidden="true" />}
                {/* Legibility scrim over photo or generative pattern alike. */}
                {!editing.isEditing && (
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
              {/* Generative banner is always dark art: flip the identity block
                  to light text so it stays readable in light themes.
                  Uploaded photos keep the viewer's own theme. */}
              <div className={`relative -mt-8 sm:-mt-10 px-4 pb-1.5${bgUrl ? "" : " seeded-scope-dark-text"}`}>
                {headerElement}
              </div>
            </div>
          ) : (
            headerElement
          )}
          </RecedeOnScroll>

          <AnimatePresence mode="wait">
          {editing.isEditing ? (
            <motion.div
              key="edit"
              initial={didPaintRef.current && !prefersReducedMotion ? { opacity: 0, scale: 0.94 } : false}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={morphTransition(prefersReducedMotion)}
              style={morphOrigin({ y: 0 })}
            >
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
            </motion.div>
          ) : (
            <motion.div
              key="view"
              initial={didPaintRef.current && !prefersReducedMotion ? { opacity: 0, scale: 0.94 } : false}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={morphTransition(prefersReducedMotion)}
              style={morphOrigin({ y: 0 })}
              className="space-y-4"
            >
              {/** stats visibility logic — moved to the ProfileStats component; the
                  "card" background variant renders it inside the card. */}
              {!cardVariantActive && statsSummaryAllowed && (
                <RecedeOnScroll intensity={0.85}>
                  <ProfileStats profile={profile} show onOpenWall={() => setActiveTab('wall')} />
                </RecedeOnScroll>
              )}

              {profile.bio && !isNonFriendOnPrivate && (
                <RecedeOnScroll intensity={0.85} className="text-sm">
                  <ProcessedContent content={profile.bio} contentJson={(profile as { bio_json?: unknown }).bio_json} currentUserId={currentUser?.id || null} isAdmin={isModerator} currentUsername={currentUserUsername} currentUserColor={currentUserColor} postAuthorId={profile.id} postAuthorPublicId={profile.public_id} authorUsername={profile.username} />
                </RecedeOnScroll>
              )}

              {/* Spotify Now Playing */}
              {!isNonFriendOnPrivate && (
                <SpotifyNowPlaying userId={resolvedUserId} />
              )}

              {/* «Закреплённые темы» — up to 3 curated threads, between the
                  identity panel and the tabs (issue #518). Hidden while
                  editing, together with the tabs it precedes. The block itself
                  applies RecedeOnScroll, so a profile with no pins renders no
                  wrapper at all. */}
              <ProfilePinnedThreads
                userId={resolvedUserId}
                isOwner={isOwnProfile}
                currentUserId={currentUser?.id ?? null}
              />

              {/* Profile Tabs — visibility follows the owner's privacy settings.
                  For non-friends on a private profile the wall tab always stays
                  (it explains that the wall is hidden) while the rest follow the
                  per-section hide toggles. */}
              {profileTabsElement}
            </motion.div>
          )}
          </AnimatePresence>
          </>
          )}
          </motion.div>
          </AnimatePresence>
            </div>
          </div>
          </ContentEnter>
        )}

        {/* Avatar Gallery */}
        {data.showAvatarGallery && (
          <AvatarGalleryDialog
            avatars={data.avatarHistory}
            initialIndex={data.avatarGalleryIndex}
            canDelete={isOwnProfile}
            morph={galleryMorph}
            onClose={closeAvatarGallery}
            onDelete={data.deleteAvatar}
          />
        )}

        {/* The flying avatar — mounted only while a morph runs, above everything. */}
        {avatarMorph && (
          <AvatarMorph
            src={avatarMorph.src}
            direction={avatarMorph.direction}
            from={avatarMorph.from}
            to={avatarMorph.to}
            onLanded={landAvatarMorph}
            onDone={finishAvatarMorph}
          />
        )}

        {/* The avatar that led here flies into the profile header. Ordinary
            profile links and direct visits never mount this element. */}
        {profileEntryMorph && (
          <AvatarMorph
            src={profileEntryMorph.src}
            direction="open"
            from={profileEntryMorph.from}
            to={profileEntryMorph.to}
            onLanded={() => {}}
            onDone={finishProfileEntryMorph}
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
          <CreateFab
            onClick={handleWallCreateClick}
            label={wallCreateOpen ? "Скрыть форму" : "Написать на стене"}
            active={wallCreateOpen}
            right={fabRight}
          />
        )}
      </motion.main>
  );
};

export default Profile;
