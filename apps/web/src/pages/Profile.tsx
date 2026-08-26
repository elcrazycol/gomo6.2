import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "@/integrations/api/compat";
import { getCached } from "@/integrations/api/queryCache";
import { storageUrl } from "@/utils/storage";
import { Button } from "@/components/ui/button";
import { PentagramLoader } from "@/components/PentagramLoader";
import { ProfileSkeleton } from "@/components/skeletons/ContentSkeletons";
import { ProcessedContent } from "@/components/ProcessedContent";
import { SpotifyNowPlaying } from "@/components/SpotifyNowPlaying";
import { useUserRealtimeStatus } from "@/hooks/useRealtimeStatus";
import { getProfileCustomization, type ProfileCustomization } from "@/utils/profileCustomization";
import { normalizeProfileBackgroundVariant, type ProfileBackgroundVariant } from "@/utils/profileBackground";
import { isValidThemeTokens, applyProfileThemeTokens } from "@/utils/profileTheme";
import { getCurrentUserMeta } from "@/utils/currentUserMeta";
import { useProfileData } from "./profile/useProfileData";
import { useProfileEditing } from "./profile/useProfileEditing";
import { ProfileHeader } from "./profile/ProfileHeader";
import { ProfileStats } from "./profile/ProfileStats";
import { ProfileEditPanel } from "./profile/ProfileEditPanel";
import { ProfileTabs, type ProfileTab } from "./profile/ProfileTabs";
import { UsernameDialog, AvatarGalleryDialog } from "./profile/ProfileDialogs";
import type { Profile, ProfilePrivacyData } from "./profile/types";

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

  const [profile, setProfile] = useState<Profile | null>(null);
  const [currentUser, setCurrentUser] = useState<{ id: string } | null>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");
  const [pageLoading, setPageLoading] = useState(true);
  // Do not flash the full-page skeleton during a fast back navigation. It is
  // useful for a genuinely slow first load, but a short delayed threshold
  // keeps cached/already loaded profiles visually continuous.
  const [showLoadingSkeleton, setShowLoadingSkeleton] = useState(false);
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

  useEffect(() => {
    if (!profile || pageLoading) {
      const timeoutId = window.setTimeout(() => setShowLoadingSkeleton(true), 250);
      return () => window.clearTimeout(timeoutId);
    }

    setShowLoadingSkeleton(false);
  }, [pageLoading, profile]);

  const loadProfile = useCallback(async () => {
    const sessionAuth = await api.auth.getSession();
    const token = sessionAuth.data.session?.access_token;
    const headers: Record<string, string> | undefined = token ? { 'Authorization': `Bearer ${token}` } : undefined;
    const localSessionUser = sessionAuth.data.session?.user;
    const isOwnProfileBySession = localSessionUser?.id === userId;

    // The profile row, privacy flags, friendship status and customization are
    // all independent reads — run them in parallel instead of one after
    // another (previously 4 sequential round trips on a mobile network before
    // the header could render). Only the session lookup above stays
    // sequential, and it is local (no network round trip).
    //
    // The profile row is served through the TTL cache (viewer-scoped key) so
    // back-navigation within the TTL renders the header instantly instead of
    // re-fetching the same row.
    const [profileData, privacyRes, friendshipRes, customization] = await Promise.all([
      getCached<Profile | null>(
        `profile-page:${isOwnProfileBySession ? "owner" : "viewer"}:${userId}`,
        async () => {
          const res = await fetch(`/api/v1/profiles?id=eq.${userId}`);
          const json = await res.json();
          return (json.data?.[0] as Profile | undefined) ?? null;
        },
        { ttlMs: 60_000 }
      ),
      // The generic /privacy_settings endpoint is viewer-scoped (returns only
      // the caller's own row), so a foreign profile must use the public
      // /users/:id/privacy endpoint — the same rules the server enforces on
      // content (private_profile + private_hide_*).
      isOwnProfileBySession
        ? fetch(`/api/v1/privacy_settings?user_id=eq.${userId}`)
        : fetch(`/api/v1/users/${userId}/privacy`),
      // Guests cannot read a foreign user's friend status (protected endpoint)
      // and the owner is always a friend — skip the request in both cases.
      !isOwnProfileBySession && localSessionUser?.id
        ? fetch(`/api/v1/friends/status/${userId}`, { headers }).catch(() => null)
        : Promise.resolve(null),
      getProfileCustomization(userId!),
    ]);

    const data = profileData;

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
  const realtimeStatus = useUserRealtimeStatus(userId);
  useEffect(() => {
    if (!realtimeStatus) return;
    setIsOnline(realtimeStatus.is_online);
    if (realtimeStatus.last_seen) setLastSeen(realtimeStatus.last_seen);
  }, [realtimeStatus]);

  // Tab-scoped data (achievements, threads, avatar gallery, gifts) + edit-mode
  // state. Both hooks own their domains; they touch page state only through
  // the callbacks below.
  const data = useProfileData({
    userId,
    activeTab,
    currentUser,
    onAvatarUrlChange: setAvatarUrl,
  });

  const editing = useProfileEditing({
    userId,
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
  const isOwnProfile = currentUser?.id === userId;
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
  const canPostOnWall = !!currentUser && (currentUser.id === userId || allowWallPostsFromOthers) && showProfileWall && !wallHiddenFromViewer && !editing.isEditing;

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
        setPageLoading(true);
        try {
          // Only the profile row + privacy/friendship/customization are needed
          // for the first paint. Pinned achievements (wall tab) come with a
          // cheap limit-4 fetch; the full achievement list, avatar history,
          // gift counts and friends lists load lazily when their tab/action
          // is first used.
          await Promise.all([loadProfile(), data.loadPinnedAchievements()]);
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

  const statsSummaryAllowed = (() => {
    const isOwn = currentUser?.id === userId;
    return isOwn || (showProfileStats && canViewSection(privateHideStats));
  })();

  // The skeleton hides as soon as the profile row is loaded — the remaining
  // parallel reads (privacy, friendship, achievements, avatar history) fill
  // the already-painted page in place instead of blocking the first paint.
  const showSkeleton = showLoadingSkeleton && !profile;

  const headerElement = profile ? (
    <ProfileHeader
      profile={profile}
      isOwnProfile={isOwnProfile}
      isEditing={editing.isEditing}
      avatarVisible={canViewSection(privateHideAvatar)}
      avatarUrl={avatarUrl}
      avatarUploading={editing.avatarUploading}
      isAvatarDragging={editing.isAvatarDragging}
      avatarDragHandlers={editing.avatarDragHandlers}
      newDisplayName={editing.newDisplayName}
      onNewDisplayNameChange={editing.setNewDisplayName}
      bgUrl={bgUrl}
      bgVariant={bgVariant}
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
      onOpenMessages={() => navigate(`/messages?user=${userId}`)}
    />
  ) : null;

  return (
    <main
      className="max-w-2xl mx-auto p-4 isolate"
    >
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
        {!showSkeleton && profile && (
          <div className="space-y-6 animate-in fade-in duration-300">
          {/* Profile content — painted as soon as the profile row is loaded.
              The privacy/friendship flags arrive in parallel and the derived
              guards (wallHiddenFromViewer, canViewSection) self-correct when
              they land, so a public profile never waits on them. Private
              content is already stripped server-side, so nothing sensitive
              flashes for a non-friend on a private profile. */}
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
              <ProfileTabs
                activeTab={activeTab}
                onTabChange={(tab) => { setActiveTab(tab); setWallCreateOpen(false); }}
                userId={userId!}
                profile={profile}
                isOwnProfile={isOwnProfile}
                isEditing={editing.isEditing}
                currentUser={currentUser}
                currentUsername={currentUserUsername}
                currentUserColor={currentUserColor}
                wallTabVisible={wallTabVisible}
                showThreadsTab={showThreadsTab}
                canViewAchievements={canViewSection(privateHideAchievements)}
                canViewThreads={canViewSection(privateHideThreads)}
                canViewGifts={canViewSection(privateHideGifts)}
                canViewFriends={canViewSection(privateHideFriends)}
                showProfileWall={showProfileWall}
                allowWallPostsFromOthers={allowWallPostsFromOthers}
                wallHiddenFromViewer={wallHiddenFromViewer}
                privateProfile={privateProfile}
                wallRefreshKey={wallRefreshKey}
                wallCreateOpen={wallCreateOpen}
                onWallCreateOpenChange={setWallCreateOpen}
                achievements={data.achievements}
                pinnedAchievements={data.pinnedAchievements}
                achievementsLoaded={data.achievementsLoaded}
                onTogglePin={data.toggleAchievementPin}
                userThreads={data.userThreads}
                profileLikesMap={data.profileLikesMap}
                threadsLoading={data.threadsLoading}
                giftCatalog={data.giftCatalog}
                giftCount={data.giftCount}
                giftCountLoaded={data.giftCountLoaded}
                onGiftSent={() => {
                  data.incrementGiftCount();
                  loadProfile();
                }}
              />
            </div>
          )}
          </>
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