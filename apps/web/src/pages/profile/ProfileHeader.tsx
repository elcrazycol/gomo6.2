import { lazy, Suspense, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Camera, Edit2, MessageSquare, Smile, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminBadge } from "@/components/AdminBadge";
import { FriendButton } from "@/components/FriendButton";
import { NicknameEmoji } from "@/components/NicknameEmoji";
import { OnlineStatus } from "@/components/OnlineStatus";
import { PentagramLoader } from "@/components/PentagramLoader";
import { storageUrl } from "@/utils/storage";
import { parseCssToStyle, type ProfileCustomization } from "@/utils/profileCustomization";
import type { ProfileBackgroundVariant } from "@/utils/profileBackground";
import type { Profile } from "./types";

// Heavy interaction-only component — split into a separate chunk so the
// profile page's initial JS is small on mobile. Loaded on first use (edit
// mode) instead of on every visit.
const EmojiPicker = lazy(() => import("@/components/EmojiPicker").then((m) => ({ default: m.EmojiPicker })));

export interface AvatarDragHandlers {
  onDragEnter: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}

export interface ProfileHeaderProps {
  profile: Profile;
  isOwnProfile: boolean;
  isEditing: boolean;
  /** canViewSection(privateHideAvatar) — computed by the page. */
  avatarVisible: boolean;
  avatarUrl: string | null;
  avatarUploading: boolean;
  isAvatarDragging: boolean;
  avatarDragHandlers: AvatarDragHandlers;
  /** Display-name editing field (shown next to the emoji picker in edit mode). */
  newDisplayName: string;
  onNewDisplayNameChange: (value: string) => void;
  bgUrl: string | null;
  bgVariant: ProfileBackgroundVariant;
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
  isAvatarDragging,
  avatarDragHandlers,
  newDisplayName,
  onNewDisplayNameChange,
  bgUrl,
  bgVariant,
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
}: ProfileHeaderProps) {
  const { t } = useTranslation();
  const nicknameEmojiButtonRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3 sm:gap-4">
        {/* Avatar */}
        {avatarVisible && (
          <div className="relative">
            <div
              {...(isOwnProfile && isEditing ? avatarDragHandlers : {})}
              className={`w-14 h-14 sm:w-20 sm:h-20 rounded-full bg-muted flex items-center justify-center overflow-hidden cursor-pointer hover:opacity-80 transition-all duration-150 ${
                isOwnProfile && isEditing && isAvatarDragging
                  ? "ring-2 ring-primary ring-offset-2 ring-offset-background scale-105"
                  : ""
              }`}
              onClick={onAvatarClick}
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
                  onChange={onAvatarUpload}
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
                <AdminBadge userId={profile.id} />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 gap-y-0.5 flex-wrap">
            <button
              type="button"
              className={`text-sm text-muted-foreground ${isOwnProfile ? 'hover:text-primary cursor-pointer transition-colors' : ''} ${bgUrl && bgVariant === 'banner' ? '[text-shadow:0_1px_2px_rgba(255,255,255,0.7)]' : ''}`}
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
        </div>
      </div>

      {/* Edit Button */}
      {isOwnProfile && (
        <Button
          variant="ghost"
          size="sm"
          className="p-1 h-8 w-8 hover:bg-primary/10 hover:text-primary transition-colors"
          onClick={onEditClick}
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
          <FriendButton userId={profile.id} isOwnProfile={isOwnProfile} />
          <Button
            variant="default"
            size="sm"
            onClick={onOpenMessages}
            className="h-8 w-8 sm:w-auto p-0 sm:px-3 rounded-full sm:rounded-md transition-colors text-xs sm:text-sm gap-1.5"
          >
            <MessageSquare className="w-4 h-4" />
            <span className="hidden sm:inline">{t("profile.write")}</span>
          </Button>
        </div>
      )}
    </div>
  );
}