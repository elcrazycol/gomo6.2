import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Gift, LayoutGrid, MessageSquareText, Pin, Trophy, Users, type LucideIcon } from "lucide-react";
import { PentagramLoader } from "@/components/PentagramLoader";
import { ProfileWall } from "@/components/ProfileWall";
import { useFriendsStore } from "@/stores/friendsStore";
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

  return (
    <>
      {/* Sticky bar: pins under the app header and follows its hide/show slide
          (offset comes from --app-header-pad, kept in sync by AppLayout). */}
      <div
        className="sticky z-30 border-b border-border overflow-x-auto bg-background/95 backdrop-blur-md"
        style={{ top: "var(--app-header-pad, 0px)" }}
      >
        <div className="flex gap-1 min-w-max px-1.5 py-1">
          {wallTabVisible && (
            <TabButton
              tab={{ key: "wall", icon: LayoutGrid, label: t("profile.wall") }}
              active={activeTab === 'wall'}
              onClick={() => onTabChange('wall')}
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
              onClick={() => onTabChange('achievements')}
            />
          )}
          {showThreadsTab && canViewThreads && (
            <TabButton
              tab={{ key: "threads", icon: MessageSquareText, label: t("profile.threads") }}
              active={activeTab === 'threads'}
              onClick={() => onTabChange('threads')}
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
              onClick={() => onTabChange('gifts')}
            />
          )}
          {canViewFriends && (
            <FriendsTabButton
              activeTab={activeTab}
              onClick={() => onTabChange('friends')}
              userId={userId}
            />
          )}
        </div>
      </div>

      {/* Tab Content — the wall renders a "private profile" notice when it
          is hidden server-side; other tabs render only when their section
          is visible to this viewer. */}
      {activeTab === 'wall' && wallTabVisible && (
        <div>
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
    </>
  );
}