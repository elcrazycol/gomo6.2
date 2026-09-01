import { lazy, Suspense, useLayoutEffect, useRef, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronDown, Gift, LayoutGrid, MessageSquareText, Pin, Plus, Trophy, Users, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PentagramLoader } from "@/components/PentagramLoader";
import { ProfileWall } from "@/components/ProfileWall";
import { ProfileAlbumView } from "@/components/ProfileAlbumView";
import { useFriendsStore } from "@/stores/friendsStore";
import { useProfileAlbums } from "./useProfileAlbums";
import type { AchievementData } from "@/components/AchievementCard";
import type { GiftCatalogItem } from "@/components/GiftCard";
import type { Profile } from "./types";

// Heavy interaction-only components — split into separate chunks so the
// profile page's initial JS is small on mobile. Loaded on first use (dialogs,
// non-default tabs) instead of on every visit.
const AchievementCard = lazy(() => import("@/components/AchievementCard").then((m) => ({ default: m.AchievementCard })));
const GiftsTab = lazy(() => import("@/components/GiftsTab").then((m) => ({ default: m.GiftsTab })));
const FriendsList = lazy(() => import("@/components/FriendsList").then((m) => ({ default: m.FriendsList })));
const FriendRequestsList = lazy(() => import("@/components/FriendRequestsList").then((m) => ({ default: m.FriendRequestsList })));
const ThreadCard = lazy(() => import("@/components/ThreadCard").then((m) => ({ default: m.ThreadCard })));

export type ProfileTab = "wall" | "achievements" | "threads" | "gifts" | "friends";

export interface ProfileTabsProps {
  activeTab: ProfileTab;
  onTabChange: (tab: ProfileTab) => void;
  userId: string;
  profile: Profile;
  isOwnProfile: boolean;
  isEditing: boolean;
  currentUser: { id: string } | null;
  currentUsername: string;
  currentUserColor: string;
  // Section visibility — derived by the page from the owner's privacy flags.
  wallTabVisible: boolean;
  showThreadsTab: boolean;
  canViewAchievements: boolean;
  canViewThreads: boolean;
  canViewGifts: boolean;
  canViewFriends: boolean;
  // Wall props
  showProfileWall: boolean;
  allowWallPostsFromOthers: boolean;
  wallHiddenFromViewer: boolean;
  privateProfile: boolean;
  wallRefreshKey: number;
  wallCreateOpen: boolean;
  onWallCreateOpenChange: (open: boolean) => void;
  // Achievements
  achievements: AchievementData[];
  pinnedAchievements: AchievementData[];
  achievementsLoaded: boolean;
  onTogglePin: (achievementId: string) => void;
  // Threads
  userThreads: any[];
  profileLikesMap: Map<string, { count: number; isLiked: boolean }>;
  threadsLoading: boolean;
  // Gifts
  giftCatalog: GiftCatalogItem[];
  giftCount: number;
  giftCountLoaded: boolean;
  onGiftSent: () => void;
}

interface TabDef {
  key: ProfileTab;
  icon: LucideIcon;
  label: string;
  count?: string;
}

/** Animated tab button: every tab is an icon; the active one expands to show
 * icon + label. The active strip (shared layoutId) slides between tabs along
 * the bottom edge and the label width animates open — delayed so the text
 * unfolds after the strip lands — then collapses when switching away. */
const TabButton = ({ tab, active, onClick }: { tab: TabDef; active: boolean; onClick: () => void }) => {
  const Icon = tab.icon;
  return (
    <motion.button
      onClick={onClick}
      className={`relative flex items-center gap-1.5 rounded-lg px-2.5 sm:px-3 py-2 text-xs sm:text-sm font-medium transition-colors ${
        active ? "text-primary" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {active && (
        <motion.span
          layoutId="profile-tabs-indicator"
          className="absolute bottom-0 left-2 right-2 h-[2.5px] rounded-full bg-gradient-to-r from-primary to-accent"
          transition={{ type: "spring", stiffness: 450, damping: 36 }}
        />
      )}
      <Icon className="relative z-10 h-4 w-4 shrink-0" />
      <motion.span
        initial={false}
        animate={{ width: active ? "auto" : 0, opacity: active ? 1 : 0 }}
        transition={{ duration: 0.22, ease: "easeOut", delay: active ? 0.16 : 0 }}
        className="relative z-10 overflow-hidden whitespace-nowrap"
      >
        {tab.label}
        {tab.count}
      </motion.span>
    </motion.button>
  );
};

/** Wall tab: icon + label + the album chevron fused into one unit. The active
 * strip runs under the whole unit (label + chevron) so they read as one tab,
 * but the chevron is its own button with its own click handler — toggling the
 * album row never switches the tab. The chevron only appears while the wall
 * tab is active and there is something to reveal (albums or an owner who can
 * create them). */
const WallTabButton = ({
  active,
  label,
  onTabClick,
  showChevron,
  chevronOpen,
  onChevronClick,
  chevronTitle,
}: {
  active: boolean;
  label: string;
  onTabClick: () => void;
  showChevron: boolean;
  chevronOpen: boolean;
  onChevronClick: () => void;
  chevronTitle: string;
}) => {
  const Icon = LayoutGrid;
  return (
    <div
      className={`relative flex items-center rounded-lg text-xs sm:text-sm font-medium transition-colors ${
        active ? "text-primary" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <button
        onClick={onTabClick}
        className="flex items-center gap-1.5 py-2 pl-2.5 sm:pl-3 pr-1"
      >
        <Icon className="relative z-10 h-4 w-4 shrink-0" />
        <motion.span
          initial={false}
          animate={{ width: active ? "auto" : 0, opacity: active ? 1 : 0 }}
          transition={{ duration: 0.22, ease: "easeOut", delay: active ? 0.16 : 0 }}
          className="relative z-10 overflow-hidden whitespace-nowrap"
        >
          {label}
        </motion.span>
      </button>
      <motion.span
        initial={false}
        animate={{ width: active && showChevron ? "auto" : 0, opacity: active && showChevron ? 1 : 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="relative z-10 overflow-hidden"
      >
        <button
          onClick={onChevronClick}
          className={`flex items-center py-2 pr-2.5 pl-0.5 transition-colors ${
            chevronOpen ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
          title={chevronTitle}
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${chevronOpen ? "rotate-180" : ""}`}
          />
        </button>
      </motion.span>
      {active && (
        <motion.span
          layoutId="profile-tabs-indicator"
          className="absolute bottom-0 left-2 right-2 h-[2.5px] rounded-full bg-gradient-to-r from-primary to-accent"
          transition={{ type: "spring", stiffness: 450, damping: 36 }}
        />
      )}
    </div>
  );
};

// Friends tab button with count
const FriendsTabButton = ({ activeTab, onClick, userId }: { activeTab: string; onClick: () => void; userId: string }) => {
  const { profileFriends, fetchProfileFriends } = useFriendsStore();
  const { t } = useTranslation();
  const [friendCount, setFriendCount] = useState(0);
  const [friendsLoaded, setFriendsLoaded] = useState(false);

  // The friends list is only needed when the friends tab is opened — don't
  // fetch it (with every avatar) on every profile visit just for a count.
  useEffect(() => {
    if (activeTab !== 'friends' || friendsLoaded) return;
    setFriendsLoaded(true);
    fetchProfileFriends(userId);
  }, [activeTab, friendsLoaded, fetchProfileFriends, userId]);

  useEffect(() => {
    setFriendCount(profileFriends.length);
  }, [profileFriends]);

  return (
    <TabButton
      tab={{ key: "friends", icon: Users, label: t("profile.friends"), count: ` (${friendCount})` }}
      active={activeTab === 'friends'}
      onClick={onClick}
    />
  );
};

/** Profile tabs bar + active tab body. Visibility follows the owner's privacy
 * settings; for non-friends on a private profile the wall tab always stays
 * (it explains that the wall is hidden) while the rest follow the per-section
 * hide toggles. */
export function ProfileTabs({
  activeTab,
  onTabChange,
  userId,
  profile,
  isOwnProfile,
  isEditing,
  currentUser,
  currentUsername,
  currentUserColor,
  wallTabVisible,
  showThreadsTab,
  canViewAchievements,
  canViewThreads,
  canViewGifts,
  canViewFriends,
  showProfileWall,
  allowWallPostsFromOthers,
  wallHiddenFromViewer,
  privateProfile,
  wallRefreshKey,
  wallCreateOpen,
  onWallCreateOpenChange,
  achievements,
  pinnedAchievements,
  achievementsLoaded,
  onTogglePin,
  userThreads,
  profileLikesMap,
  threadsLoading,
  giftCatalog,
  giftCount,
  giftCountLoaded,
  onGiftSent,
}: ProfileTabsProps) {
  const { t } = useTranslation();

  // Switching tabs swaps the content node, which changes the document height.
  // If the new tab is shorter than the scroll position, the browser clamps
  // scrollY downward and the page visibly jumps toward the top mid-switch.
  // Instead of fighting the clamp afterwards, the outgoing tab's height is
  // captured at click time and held as a minimum height on the incoming tab,
  // so the document never shrinks and scrollY never moves: the bar stays
  // pinned and the new content simply appears beneath it.
  const tabBodyRef = useRef<HTMLDivElement | null>(null);
  const [preservedMinHeight, setPreservedMinHeight] = useState(0);

  const preserveBodyHeight = () => {
    const el = tabBodyRef.current;
    if (el) setPreservedMinHeight(el.offsetHeight);
  };

  const switchTab = (tab: ProfileTab) => {
    if (tab !== activeTab) {
      preserveBodyHeight();
      onTabChange(tab);
    }
  };

  // ── Profile albums (wall tab) ────────────────────────────────────────────
  // Albums are collections of wall posts; visibility follows the wall. The
  // albums list loads when the wall tab is open; management is owner-only.
  const {
    albums,
    loadAlbums,
    createAlbum,
    renameAlbum,
    deleteAlbum,
    addPosts,
    removePost,
  } = useProfileAlbums(userId, activeTab === "wall" && wallTabVisible);
  const [albumsOpen, setAlbumsOpen] = useState(false);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [creatingAlbum, setCreatingAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState("");

  const showAlbumsRow = activeTab === "wall" && wallTabVisible && (albumsOpen || selectedAlbumId !== null);

  // The chevron next to «Стена» toggles the album row; closing it also resets
  // the selection back to «Все» so the wall view never hides the selector.
  const toggleAlbumsRow = () => {
    if (albumsOpen || selectedAlbumId !== null) {
      preserveBodyHeight();
      setAlbumsOpen(false);
      setSelectedAlbumId(null);
    } else {
      setAlbumsOpen(true);
    }
  };

  const submitCreateAlbum = async () => {
    const name = newAlbumName.trim();
    if (!name) {
      toast.error(t("profile.albumNameRequired"));
      return;
    }
    try {
      const created = await createAlbum(name);
      setNewAlbumName("");
      setCreatingAlbum(false);
      setAlbumsOpen(true);
      if (created) setSelectedAlbumId(created.id);
      toast.success(t("profile.albumCreated"));
    } catch (error) {
      console.error("Error creating album:", error);
      toast.error(t("profile.albumCreateError"));
    }
  };

  const handleRenameAlbum = async (albumId: string, name: string) => {
    await renameAlbum(albumId, name);
  };

  const handleDeleteAlbum = async (albumId: string) => {
    await deleteAlbum(albumId);
    if (selectedAlbumId === albumId) setSelectedAlbumId(null);
  };

  // Tell AppLayout to pause its hide/show header logic while swapped content
  // settles: Chrome synthesizes a scroll clamp when the page shrinks, which
  // reads as "scrolled up" and pops the header back in — dragging the sticky
  // tab bar off the top of the viewport right when the user is switching.
  useLayoutEffect(() => {
    window.dispatchEvent(new Event("gomo6:profile-content-switch"));
  }, [activeTab, selectedAlbumId]);

  // Minimalist row items — same visual language as the tabs above: icon +
  // label, active one tinted with the primary color, no pills/borders.
  const albumRowClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
      active ? "text-primary" : "text-muted-foreground hover:text-foreground"
    }`;

  const selectedAlbum = selectedAlbumId ? albums.find((a) => a.id === selectedAlbumId) || null : null;

  return (
    <>
      {/* Sticky bar: pins under the app header and follows its hide/show slide
          (offset comes from --app-header-pad, kept in sync by AppLayout). */}
      {/* Solid background (no backdrop-blur): a blur layer on a sticky element
          gets dropped by Chrome when a Radix portal (dropdown/dialog) mounts,
          which made the whole tab bar vanish. The solid fill also keeps posts
          from showing through the stuck bar. */}
      <div
        className="sticky z-30 border-b border-border overflow-x-auto bg-background"
        style={{ top: "var(--app-header-pad, 0px)" }}
      >
        <div className="flex gap-1 min-w-max px-1.5 py-1">
          {wallTabVisible && (
            <WallTabButton
              active={activeTab === 'wall'}
              label={t("profile.wall")}
              onTabClick={() => switchTab('wall')}
              showChevron={activeTab === 'wall' && (albums.length > 0 || isOwnProfile)}
              chevronOpen={albumsOpen || selectedAlbumId !== null}
              onChevronClick={toggleAlbumsRow}
              chevronTitle={t("profile.albums")}
            />
          )}
          {canViewAchievements && (
            <TabButton
              tab={{
                key: "achievements",
                icon: Trophy,
                label: t("profile.achievements"),
                count: achievementsLoaded ? ` (${achievements.length})` : undefined,
              }}
              active={activeTab === 'achievements'}
              onClick={() => switchTab('achievements')}
            />
          )}
          {showThreadsTab && canViewThreads && (
            <TabButton
              tab={{ key: "threads", icon: MessageSquareText, label: t("profile.threads") }}
              active={activeTab === 'threads'}
              onClick={() => switchTab('threads')}
            />
          )}
          {canViewGifts && (
            <TabButton
              tab={{
                key: "gifts",
                icon: Gift,
                label: t("profile.gifts"),
                count: giftCountLoaded ? ` (${giftCount})` : undefined,
              }}
              active={activeTab === 'gifts'}
              onClick={() => switchTab('gifts')}
            />
          )}
          {canViewFriends && (
            <FriendsTabButton
              activeTab={activeTab}
              onClick={() => switchTab('friends')}
              userId={userId}
            />
          )}
        </div>

        {/* Album row: «Все» + album chips + create. Drops below the tab
            buttons inside the sticky bar when opened. */}
        {showAlbumsRow && (
          <div className="flex flex-wrap items-center gap-0.5 border-t border-border/60 px-1 pb-1.5 pt-0.5">
            <button
              onClick={() => {
                preserveBodyHeight();
                setSelectedAlbumId(null);
              }}
              className={albumRowClass(selectedAlbumId === null)}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              {t("profile.allPosts")}
            </button>
            {albums.map((album) => (
              <button
                key={album.id}
                onClick={() => {
                  preserveBodyHeight();
                  setSelectedAlbumId(album.id);
                }}
                className={albumRowClass(selectedAlbumId === album.id)}
              >
                <span className="max-w-40 truncate">{album.name}</span>
              </button>
            ))}
            {isOwnProfile && !creatingAlbum && (
              <button
                onClick={() => setCreatingAlbum(true)}
                className="inline-flex items-center rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:text-primary"
                title={t("profile.createAlbum")}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Create-album dialog — modal so it works on phones too (full-width
          sheet instead of the cramped inline input row). */}
      <Dialog open={creatingAlbum} onOpenChange={setCreatingAlbum}>
        <DialogContent className="gap-5 overflow-hidden rounded-2xl border-border/70 bg-card p-5 shadow-2xl sm:max-w-md sm:p-6">
          <DialogHeader className="text-left">
            <DialogTitle className="text-base">{t("profile.createAlbum")}</DialogTitle>
            <DialogDescription>
              {t("profile.albumCreateHint")}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitCreateAlbum();
            }}
            className="space-y-5"
          >
            <input
              autoFocus
              value={newAlbumName}
              onChange={(e) => setNewAlbumName(e.target.value)}
              placeholder={t("profile.albumNamePlaceholder")}
              maxLength={80}
              className="h-12 w-full rounded-xl border border-border/60 bg-muted/30 px-4 text-sm outline-none transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground/70 focus:border-primary/50 focus:bg-background focus:ring-4 focus:ring-primary/10"
            />
            <DialogFooter className="gap-2 sm:gap-2.5">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setCreatingAlbum(false);
                  setNewAlbumName("");
                }}
                className="rounded-lg px-5 hover:bg-muted"
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                className="rounded-lg px-6 shadow-sm"
              >
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Tab Content — one always-mounted wrapper so the outgoing tab's
          height can be held on the incoming one during a switch
          (preserveBodyHeight). The page never shrinks, the browser never
          clamps the scroll, and neither the scroll position nor the pinned
          tab bar moves: the new content simply appears beneath the bar. An
          open album shows the album view instead of the full wall. */}
      <div
        ref={tabBodyRef}
        className="min-h-[calc(100dvh-7rem)]"
        style={preservedMinHeight > 0 ? { minHeight: preservedMinHeight } : undefined}
      >
        {activeTab === 'wall' && wallTabVisible && (
          <div>
          {selectedAlbum ? (
            <ProfileAlbumView
              album={selectedAlbum}
              profileUserId={userId}
              currentUserId={currentUser?.id || null}
              currentUsername={currentUsername}
              currentUserColor={currentUserColor}
              isOwnProfile={isOwnProfile}
              onAddPosts={(postIds) => addPosts(selectedAlbum.id, postIds)}
              onRemovePost={(postId) => removePost(selectedAlbum.id, postId)}
              onRenameAlbum={(name) => handleRenameAlbum(selectedAlbum.id, name)}
              onDeleteAlbum={() => handleDeleteAlbum(selectedAlbum.id)}
              onAlbumPostsChanged={loadAlbums}
            />
          ) : (
            <ProfileWall
              profileUserId={userId}
              currentUserId={currentUser?.id || null}
              currentUsername={currentUsername}
              canPost={currentUser?.id === userId || allowWallPostsFromOthers}
              showWall={showProfileWall}
              refreshKey={wallRefreshKey}
              wallHidden={wallHiddenFromViewer}
              privateProfile={privateProfile}
              createOpen={wallCreateOpen}
              onCreateOpenChange={onWallCreateOpenChange}
            />
          )}
        </div>
      )}

      {activeTab === 'achievements' && canViewAchievements && (
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
                      {t("profile.pinned")} ({pinnedAchievements.length}/6)
                    </h3>
                  )}
                  <div className="grid grid-cols-3 gap-x-4 gap-y-6">
                    {pinnedAchievements.map((achievement) => (
                      <Suspense key={achievement.id} fallback={<div className="h-12 animate-pulse rounded bg-muted" />}>
                        <AchievementCard
                          achievement={achievement}
                          onTogglePin={onTogglePin}
                          isEditing={isEditing}
                          compact
                        />
                      </Suspense>
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
                  {t("achievements.allAchievements")}
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

      {activeTab === 'threads' && showThreadsTab && canViewThreads && (
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
                  <Suspense key={thread.id} fallback={<div className="h-32 animate-pulse rounded-lg bg-muted" />}>
                    <ThreadCard
                      thread={thread}
                      currentUserId={currentUser?.id || null}
                      currentUsername={currentUsername}
                      currentUserColor={currentUserColor}
                      showPreview={true}
                      initialLikesCount={likes?.count ?? 0}
                      initialUserLiked={likes?.isLiked ?? false}
                    />
                  </Suspense>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'gifts' && canViewGifts && (
        <div>
          <Suspense fallback={<div className="flex justify-center py-8"><PentagramLoader size="lg" /></div>}>
            <GiftsTab
              userId={userId}
              isOwnProfile={isOwnProfile}
              giftCatalog={giftCatalog}
              recipientUsername={profile.username}
              onGiftSent={onGiftSent}
            />
          </Suspense>
        </div>
      )}

      {activeTab === 'friends' && canViewFriends && (
        <div>
          <Suspense fallback={<div className="flex justify-center py-8"><PentagramLoader size="lg" /></div>}>
            {isOwnProfile && <FriendRequestsList />}
            <FriendsList userId={userId} />
          </Suspense>
        </div>
      )}
      </div>
    </>
  );
}