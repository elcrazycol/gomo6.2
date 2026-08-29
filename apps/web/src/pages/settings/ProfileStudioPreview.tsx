import { User as UserIcon, Camera, Smile, ImagePlus, X } from "lucide-react";
import { parseCssToStyle } from "@/utils/profileCustomization";
import { storageUrl } from "@/utils/storage";
import { NicknameEmoji } from "@/components/NicknameEmoji";
import { OnlineStatus } from "@/components/OnlineStatus";
import { EmojiPicker } from "@/components/EmojiPicker";
import { ActiEye } from "@/components/ActiEye";

export interface StudioStats {
  posts: number;
  comments: number;
  likes: number;
  views: number;
  garma: number;
}

interface ProfileStudioPreviewProps {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  /** Storage key of the background (or absolute URL). */
  backgroundUrl: string | null;
  /** true when a real background is set (affects banner rendering). */
  hasBackground: boolean;
  usernameCss: string;
  badgeText: string;
  badgeCss: string;
  nicknameEmojiId: string | null;
  stats: StudioStats;
  /** Compact mode: header card only, no stats/post — used as the sticky
   *  preview on mobile where vertical space is tight. */
  compact?: boolean;
  /** When provided, the avatar circle becomes a file upload control. */
  onAvatarUpload?: (file: File) => void;
  /** When provided, the banner strip becomes a file upload control. */
  onBackgroundUpload?: (file: File) => void;
  /** When provided, an emoji picker button appears right of the name. */
  onEmojiSelect?: (sel: { emojiId: string }) => void;
  /** When provided (and an emoji is set), a remove button appears too. */
  onEmojiRemove?: () => void;
}

/**
 * Live preview of the profile page as a viewer would see it. Renders the
 * EXACT same structure as the real profile page (Profile.tsx): full-width
 * banner strip with the avatar overlapping it, styled name + nickname emoji +
 * badge, stats row — no rounded floating panels.
 */
export function ProfileStudioPreview({
  username,
  displayName,
  avatarUrl,
  backgroundUrl,
  hasBackground,
  usernameCss,
  badgeText,
  badgeCss,
  nicknameEmojiId,
  stats,
  compact = false,
  onAvatarUpload,
  onBackgroundUpload,
  onEmojiSelect,
  onEmojiRemove,
}: ProfileStudioPreviewProps) {
  const avatarSrc = avatarUrl ? storageUrl("post-images", avatarUrl) || avatarUrl : null;
  const bgSrc = backgroundUrl ? storageUrl("post-images", backgroundUrl) || backgroundUrl : null;
  const usernameStyle = parseCssToStyle(usernameCss);
  const badgeStyle = badgeCss ? parseCssToStyle(badgeCss) : {};

  return (
    <div className="space-y-6">
      {/* ── Profile card: banner strip + overlapping header ─────────────── */}
      <div className="relative overflow-hidden">
        {/* Banner strip */}
        <div
          className={`h-24 sm:h-28 w-full ${hasBackground ? "bg-cover bg-center" : "bg-muted/60"}`}
          style={hasBackground && bgSrc ? { backgroundImage: `url("${bgSrc}")` } : undefined}
        >
          {hasBackground && (
            <div className="absolute inset-x-0 top-0 h-24 sm:h-28 bg-gradient-to-b from-black/45 via-black/20 to-transparent" />
          )}
          {onBackgroundUpload && (
            <label className="absolute top-2 right-2 flex items-center gap-1.5 h-8 px-3 rounded-full bg-background/85 backdrop-blur cursor-pointer hover:bg-background transition-colors text-xs font-medium z-10">
              <ImagePlus className="w-4 h-4" />
              {hasBackground ? "Заменить фон" : "Добавить фон"}
              <input type="file" accept="image/*" onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onBackgroundUpload(f);
                e.target.value = "";
              }} className="hidden" />
            </label>
          )}
        </div>

        {/* Header: avatar overlapping the strip + identity */}
        <div className="relative -mt-8 sm:-mt-10 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 sm:gap-4">
              {/* Avatar — click to replace */}
              <div className="relative shrink-0">
                <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-full bg-muted flex items-center justify-center overflow-hidden cursor-pointer hover:opacity-80 transition-all duration-150">
                  {avatarSrc ? (
                    <img src={avatarSrc} alt="Аватар" className="w-full h-full object-cover" />
                  ) : (
                    <UserIcon className="w-10 h-10 text-muted-foreground" />
                  )}
                </div>
                {onAvatarUpload && (
                  <label className="absolute -bottom-1 -right-1 w-8 h-8 bg-primary rounded-full flex items-center justify-center cursor-pointer hover:bg-primary/80 transition-colors">
                    <Camera className="w-4 h-4 text-primary-foreground" />
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) onAvatarUpload(f);
                        e.target.value = "";
                      }}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              {/* Identity */}
              <div
                className={`flex-1 min-w-0 ${compact ? "rounded-lg bg-background/70 backdrop-blur px-2 py-1 -mx-1" : ""}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <h1
                    className="text-xl sm:text-2xl font-bold truncate"
                    style={usernameStyle}
                  >
                    {displayName || username || "Ваш никнейм"}
                  </h1>
                  {nicknameEmojiId && <NicknameEmoji emojiId={nicknameEmojiId} />}
                  {onEmojiSelect && (
                    <>
                      <EmojiPicker closeOnSelect onEmojiSelect={onEmojiSelect}>
                        <button
                          type="button"
                          title="Выбрать эмодзи для никнейма"
                          className="h-8 w-8 rounded-full border border-border bg-muted/50 hover:bg-muted hover:border-primary/40 hover:text-primary transition-colors flex items-center justify-center overflow-hidden"
                        >
                          {nicknameEmojiId ? (
                            <NicknameEmoji emojiId={nicknameEmojiId} className="h-4 w-4" />
                          ) : (
                            <Smile className="h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                      </EmojiPicker>
                      {nicknameEmojiId && onEmojiRemove && (
                        <button
                          type="button"
                          title="Убрать эмодзи никнейма"
                          onClick={onEmojiRemove}
                          className="h-8 w-8 rounded-full border border-border bg-muted/50 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40 transition-colors flex items-center justify-center"
                        >
                          <X className="h-4 w-4 text-muted-foreground" />
                        </button>
                      )}
                    </>
                  )}
                  {badgeText && (
                    <span className="px-2 py-1 rounded text-xs font-medium" style={badgeStyle}>
                      {badgeText}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-sm text-muted-foreground">@{username}</span>
                  <span className="text-muted-foreground">·</span>
                  <OnlineStatus userId="preview" isOnline />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Stats row (same as the real profile) ───────────────────────── */}
      {!compact && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Stat label="Записей/комментариев" value={`${stats.posts}/${stats.comments}`} />
            <span className="text-muted-foreground/50 select-none">·</span>
            <Stat label="Лайков" value={stats.likes} />
            <span className="text-muted-foreground/50 select-none">·</span>
            <Stat label="Просмотры" value={stats.views} />
            <span className="text-muted-foreground/50 select-none">·</span>
            <Stat label="Гарма" value={stats.garma} />
          </div>
          <ActiEye className="mr-1" />
        </div>
      )}

      {/* ── Sample post ─────────────────────────────────────────────────── */}
      {!compact && (
        <div className="bg-card border border-border p-3 space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
              {avatarSrc ? (
                <img src={avatarSrc} alt="" className="w-full h-full object-cover" />
              ) : (
                <UserIcon className="w-3.5 h-3.5 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <span className="text-xs font-semibold truncate" style={usernameStyle}>
                  {displayName || username}
                </span>
                {nicknameEmojiId && <NicknameEmoji emojiId={nicknameEmojiId} className="h-3 w-3" />}
              </div>
              <p className="text-[10px] text-muted-foreground">Пример поста · только что</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Тут будет выглядеть ваш пост на стене с кастомизацией никнейма
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap rounded px-1 py-0.5">
      <span className="text-sm sm:text-base font-semibold leading-none">{value}</span>
      <span className="text-[11px] sm:text-xs text-muted-foreground leading-none">{label}</span>
    </span>
  );
}
