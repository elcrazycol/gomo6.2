import { useEffect, useState, memo } from "react";
import { useNavigate } from "react-router-dom";
import { ProfileHoverCard } from "./ProfileHoverCard";
import { parseCssToStyle } from "@/utils/profileCustomization";
import { AdminBadge } from "./AdminBadge";
import { NicknameEmoji } from "./NicknameEmoji";
import { useProfileCache } from "@/contexts/ProfileCacheContext";

interface CachedProfile {
  username: string;
  display_name?: string | null;
  nickname_emoji_id?: string | null;
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
        className={`inline-flex items-center gap-1 cursor-pointer group ${className}`}
        onClick={() => navigate(`/profile/${userId}`)}
        style={{ userSelect: 'none' }}
      >
        <span className={`${usernameClassName} relative inline-block transition-transform duration-200 group-hover:translate-x-0.5`} style={usernameStyle}>
          {profileData.display_name?.trim() || profileData.username || 'Профиль'}
          <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
        </span>
        {profileData.nickname_emoji_id && (
          <NicknameEmoji
            emojiId={profileData.nickname_emoji_id}
            className="transition-transform duration-200 group-hover:translate-x-0.5"
          />
        )}
        <div className="transition-transform duration-200 group-hover:translate-x-0.5">
          <AdminBadge userId={userId} />
        </div>
      </span>
    </ProfileHoverCard>
  );
});

HeaderUsername.displayName = 'HeaderUsername';
