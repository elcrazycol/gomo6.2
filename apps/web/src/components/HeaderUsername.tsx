import { useEffect, useState, memo } from "react";
import { useNavigate } from "react-router-dom";
import { ProfileHoverCard } from "./ProfileHoverCard";
import { parseCssToStyle } from "@/utils/profileCustomization";
import { AdminBadge } from "./AdminBadge";
import { NicknameEmoji } from "./NicknameEmoji";
import { useProfileCache } from "@/contexts/ProfileCacheContext";
import { profileUrl } from "@/utils/entityUrl";
import { warmRouteIntent } from "@/lib/routeChunks";

interface CachedProfile {
  username: string;
  display_name?: string | null;
  nickname_emoji_id?: string | null;
  public_id?: number | null;
  color?: string;
  customization?: {
    username_css?: string;
  };
}

interface HeaderUsernameProps {
  userId: string;
  className?: string;
}

export const HeaderUsername = memo(({ userId, className = "" }: HeaderUsernameProps) => {
  const navigate = useNavigate();
  const { getProfile, loadProfile } = useProfileCache();
  const [profileData, setProfileData] = useState<CachedProfile | undefined>(() => getProfile(userId) as CachedProfile | undefined);

  useEffect(() => {
    const cached = getProfile(userId);
    if (cached) {
      setProfileData(cached);
      return;
    }

    loadProfile(userId).then((data: unknown) => setProfileData(data as CachedProfile | undefined));
  }, [userId, getProfile, loadProfile]);

  if (!profileData) {
    return null;
  }	const usernameStyle = profileData.customization?.username_css
    ? parseCssToStyle(profileData.customization.username_css)
    : {};

  // Neutral, like every other nickname: inherits the header's foreground colour
  // (dark on light glass, light on dark glass) instead of the theme's quote
  // accent + white halo.
  const usernameClassName = `text-sm sm:text-base`;

  return (
    <ProfileHoverCard userId={userId} showDrops>
      <span
        className={`inline-flex items-center gap-1 cursor-pointer ${className}`}
        onClick={() => {
          const to = profileUrl({ id: userId, public_id: profileData.public_id });
          // A span, not a link — no hover intent to warm from.
          warmRouteIntent(to);
          navigate(to);
        }}
        style={{ userSelect: 'none' }}
      >
        <span className={`${usernameClassName} inline-block hover:text-foreground`} style={usernameStyle}>
          {profileData.display_name?.trim() || profileData.username || 'Профиль'}
        </span>
        {profileData.nickname_emoji_id && (
          <NicknameEmoji
            emojiId={profileData.nickname_emoji_id}
            className="inline-flex items-center"
          />
        )}
        <span className="inline-flex items-center">
          <AdminBadge userId={userId} />
        </span>
      </span>
    </ProfileHoverCard>
  );
});

HeaderUsername.displayName = 'HeaderUsername';
