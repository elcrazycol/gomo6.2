import { lazy, Suspense, useRef } from "react";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion, type Variants } from "motion/react";
import { Camera, Edit2, MessageSquare, Plus, Smile, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminBadge } from "@/components/AdminBadge";
import { FriendButton } from "@/components/FriendButton";
import { PostActionsMenu } from "@/components/PostActionsMenu";
import { AvatarUploadProgress } from "@/components/AvatarUploadProgress";
import { NicknameEmoji } from "@/components/NicknameEmoji";
import { OnlineStatus } from "@/components/OnlineStatus";
import { UserAvatar } from "@/components/UserAvatar";
import { StoryRing } from "@/components/stories/StoryRing";
import { parseCssToStyle, type ProfileCustomization } from "@/utils/profileCustomization";
import {
  hoverLift,
  morphOrigin,
  morphTransition,
  morphVariants,
  pressFeedback,
  springFor,
  CASCADE_VARIANTS,
} from "@/lib/motion";
import type { AvatarDragHandlers, Profile } from "./types";

// Heavy interaction-only component — split into a separate chunk so the
// profile page's initial JS is small on mobile. Loaded on first use (edit
// mode) instead of on every visit.
const EmojiPicker = lazy(() => import("@/components/EmojiPicker").then((m) => ({ default: m.EmojiPicker })));

export interface ProfileHeaderProps {
  profile: Profile;
  isOwnProfile: boolean;
  isEditing: boolean;
  /** canViewSection(privateHideAvatar) — computed by the page. */
  avatarVisible: boolean;
  avatarUrl: string | null;
  avatarUploading: boolean;
  /** Avatar upload progress, 0..100 (drives the ring loader). */
  avatarUploadPercent: number;
  isAvatarDragging: boolean;
  avatarDragHandlers: AvatarDragHandlers;
  /** Display-name editing field (shown next to the emoji picker in edit mode). */
  newDisplayName: string;
  onNewDisplayNameChange: (value: string) => void;
  customization: ProfileCustomization | null;
  nicknameEmojiId: string | null;
  showOnlineStatus: boolean;
  currentUser: { id: string } | null;
  onAvatarClick: () => void;
  onAvatarUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onNicknameEmojiSelect: (sel: { emojiId: string }) => void;
  onNicknameEmojiRemove: () => void;
  /** isEditing ? save-and-exit : start editing. */
  onEditClick: () => void;
  onUsernameClick: () => void;
  onOpenMessages: () => void;
  /** Forum layout: the avatar and the write/subscribe actions live in the side panel. */
  forumMode?: boolean;
  /** Live stories of this profile → the avatar gets a segmented ring. */
  storyCount?: number;
  storyReadCount?: number;
  storyCloseFriends?: boolean;
  /** Opens the story viewer at the first unread slide. */
  onOpenStories?: () => void;
  /** Opens the composer (own profile, no live story). */
  onAddStory?: () => void;
  /** The avatar circle — the page uses it as the origin of the
      avatar → gallery morph (see components/profile/AvatarMorph). */
  avatarRef?: (el: HTMLElement | null) => void;
  /** A morph is in flight: the avatar's own furniture (the add-story badge) gets
      out of the way instead of sitting on top of the flying photo. */
  avatarMorphing?: boolean;
}

/** Header row (avatar + identity + actions) — rendered inside the active
 * background variant (banner strip / card / frosted panel / plain). */
export function ProfileHeader({
  profile,
  isOwnProfile,
  isEditing,
  avatarVisible,
  avatarUrl,
  avatarUploading,
  avatarUploadPercent,
  isAvatarDragging,
  avatarDragHandlers,
  newDisplayName,
  onNewDisplayNameChange,
  customization,
  nicknameEmojiId,
  showOnlineStatus,
  currentUser,
  onAvatarClick,
  onAvatarUpload,
  onNicknameEmojiSelect,
  onNicknameEmojiRemove,
  onEditClick,
  onUsernameClick,
  onOpenMessages,
  forumMode = false,
  storyCount = 0,
  storyReadCount = 0,
  storyCloseFriends = false,
  onOpenStories,
  onAddStory,
  avatarRef,
  avatarMorphing = false,
}: ProfileHeaderProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const nicknameEmojiButtonRef = useRef<HTMLDivElement>(null);

  // Header blocks arrive as one rapid cascade: the avatar first, then the
  // identity, then the actions. Each block is a dimensional morph anchored to
  // its own corner, never a bare fade.
  const item: Variants = morphVariants(0.88);
  const itemTransition = morphTransition(reduceMotion);

  return (
    <motion.div
      initial={reduceMotion ? false : "hidden"}
      animate="show"
      variants={CASCADE_VARIANTS}
      className="flex items-center justify-between gap-2 sm:gap-3"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
        {/* Avatar */}
        {avatarVisible && !forumMode && (
          <motion.div
            variants={item}
            transition={itemTransition}
            style={morphOrigin({ x: 0 })}
          >
          <StoryRing total={storyCount} read={storyReadCount} closeFriends={storyCloseFriends}>
            <div className="relative">
              <motion.div
                {...(isOwnProfile && isEditing ? avatarDragHandlers : {})}
                {...hoverLift(reduceMotion, 1.03)}
                {...pressFeedback(reduceMotion, 0.95)}
                transition={springFor("snappy", reduceMotion)}
                className={`w-14 h-14 sm:w-20 sm:h-20 rounded-full bg-muted flex items-center justify-center overflow-hidden cursor-pointer ${
                  isOwnProfile && isEditing && isAvatarDragging
                    ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                    : ""
                }`}
                animate={{ scale: isOwnProfile && isEditing && isAvatarDragging ? 1.05 : 1 }}
                ref={avatarRef}
                onClick={() => {
                  // Tapping the avatar opens the story when there is one to
                  // watch — the photo itself stays reachable from the menu.
                  if (storyCount > 0 && onOpenStories) onOpenStories();
                  else onAvatarClick();
                }}
              >
                <UserAvatar src={avatarUrl} userId={profile.id} alt="Avatar" className="w-full h-full" />
              </motion.div>
              {avatarUploading && <AvatarUploadProgress percent={avatarUploadPercent} />}
              {isOwnProfile && isEditing && (
                <label className="absolute -bottom-1 -right-1 w-8 h-8 bg-primary rounded-full flex items-center justify-center cursor-pointer hover:bg-primary/80 transition-colors">
                  <Camera className="w-4 h-4 text-primary-foreground" />
                  <input
                    type="file"
                    accept="image/*,video/*"
                    onChange={onAvatarUpload}
                    className="hidden"
                  />
                </label>
              )}
              {isOwnProfile && !isEditing && onAddStory && (
                <motion.button
                  type="button"
                  onClick={onAddStory}
                  aria-label={t("stories.addYourStory")}
                  title={t("stories.addYourStory")}
                  {...hoverLift(reduceMotion, 1.08)}
                  {...pressFeedback(reduceMotion, 0.9)}
                  // Leaves on a spring before the photo lifts (it belongs to the
                  // avatar, not to the photo) and springs back when it lands.
                  animate={{
                    scale: avatarMorphing ? 0.2 : 1,
                    opacity: avatarMorphing ? 0 : 1,
                  }}
                  transition={springFor("pop", reduceMotion)}
                  className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full border-2 border-background bg-primary text-primary-foreground"
                  style={{ pointerEvents: avatarMorphing ? "none" : undefined }}
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={3} />
                </motion.button>
              )}
            </div>
          </StoryRing>
          </motion.div>
        )}

        {/* User Info */}
        <motion.div
          variants={item}
          transition={itemTransition}
          style={morphOrigin({ x: 0 })}
          className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            {isEditing && isOwnProfile ? (
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Input
                  value={newDisplayName || profile.display_name || profile.username}
                  onChange={(e) => onNewDisplayNameChange(e.target.value)}
                  className="text-2xl font-bold h-auto p-0 border-none bg-transparent flex-1 min-w-0"
                  placeholder={t("auth.displayName")}
                />
                <Suspense fallback={null}>
                  <EmojiPicker
                    closeOnSelect
                    onEmojiSelect={onNicknameEmojiSelect}
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
                </Suspense>
                {nicknameEmojiId && (
                  <button
                    type="button"
                    title={t("profile.removeEmoji")}
                    onClick={onNicknameEmojiRemove}
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
                  style={customization?.username_css ? parseCssToStyle(customization.username_css) : undefined}
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
                <AdminBadge userId={profile.id} />
                {profile.is_service && (
                  <span
                    className="px-2 py-1 rounded text-xs font-medium ml-2 bg-primary/10 text-primary"
                    title={t("profile.serviceNoMessages")}
                  >
                    {t("profile.serviceBadge")}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 gap-y-0.5 flex-wrap">
            <button
              type="button"
              className={`text-sm text-muted-foreground ${isOwnProfile ? 'hover:text-primary cursor-pointer transition-colors' : ''}`}
              onClick={isOwnProfile ? onUsernameClick : undefined}
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
        </motion.div>
      </div>

      {/* Edit Button (own profile). In forum mode editing lives in the side panel. */}
      {isOwnProfile && !forumMode && (
        <motion.div
          variants={item}
          transition={itemTransition}
          style={morphOrigin({ x: 1 })}
          {...pressFeedback(reduceMotion)}
          className="shrink-0"
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-xl text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
            onClick={onEditClick}
          >
            {isEditing ? (
              <span className="text-lg leading-none text-green-500">✓</span>
            ) : (
              <Edit2 className="h-4 w-4" />
            )}
          </Button>
        </motion.div>
      )}

      {/* Message + subscribe + actions (other profiles). In forum mode the whole
          cluster moves to the side panel. */}
      {!isOwnProfile && currentUser && !forumMode && !profile.is_service && (
        <motion.div
          variants={item}
          transition={itemTransition}
          style={morphOrigin({ x: 1 })}
          className="flex shrink-0 items-center gap-1.5 sm:gap-2"
        >
          <motion.div {...pressFeedback(reduceMotion)}>
            <Button
              variant="default"
              size="sm"
              onClick={onOpenMessages}
              className="h-9 w-9 gap-1.5 rounded-xl px-0 text-sm font-medium shadow-sm outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 sm:w-auto sm:px-4"
              title={t("profile.write")}
            >
              <MessageSquare className="h-4 w-4" />
              <span className="hidden sm:inline">{t("profile.write")}</span>
            </Button>
          </motion.div>
          <FriendButton userId={profile.id} isOwnProfile={isOwnProfile} />
          <PostActionsMenu
            targetType="user"
            targetId={profile.id}
            reportLabel="Пожаловаться на пользователя"
            reportTargetLabel="на пользователя"
            triggerTitle="Действия"
            triggerClassName="rounded-xl border border-border/60 bg-background/85 backdrop-blur-md hover:bg-background"
          />
        </motion.div>
      )}
    </motion.div>
  );
}
