import { useEffect, useState, memo } from "react";
import { useNavigate } from "react-router-dom";
import { ProfileHoverCard } from "./ProfileHoverCard";
import { parseCssToStyle } from "@/utils/profileCustomization";
import { AdminBadge } from "./AdminBadge";
import { useProfileCache } from "@/contexts/ProfileCacheContext";

interface CachedProfile {
  username: string;
  display_name?: string | null;
  color?: string;
  customization?: {
    username_css?: string;
    username_icon_svg?: string;
    username_icon_fill?: string;
    username_icon_stroke?: string;
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
  }

  const colorClasses: Record<string, string> = {
    purple: 'text-purple-500',
    gold: 'text-yellow-500',
    orange: 'text-orange-500',
    red: 'text-red-500',
    blue: 'text-blue-500',
    green: 'text-green-500',
    yellow: 'text-yellow-400',
    cyan: 'text-cyan-500',
  };

  const usernameStyle = profileData.customization?.username_css
    ? parseCssToStyle(profileData.customization.username_css)
    : {};

  const usernameClassName = profileData.customization?.username_css
    ? `text-sm sm:text-base drop-shadow-[0_0_1px_rgba(255,255,255,0.8)]`
    : `text-sm sm:text-base drop-shadow-[0_0_1px_rgba(255,255,255,0.8)] ${profileData.color ? colorClasses[profileData.color] : 'text-quote'}`;

  return (
    <ProfileHoverCard userId={userId}>
      <span
        className={`inline-flex items-center gap-1 cursor-pointer group ${className}`}
        onClick={() => navigate(`/profile/${userId}`)}
        style={{ userSelect: 'none' }}
      >
        <span className={`${usernameClassName} relative inline-block transition-transform duration-200 group-hover:translate-x-0.5`} style={usernameStyle}>
          {profileData.display_name?.trim() || profileData.username || 'Профиль'}
          <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
        </span>
        {profileData.customization?.username_icon_svg && (
          <span
            className="inline-flex items-center justify-center transition-transform duration-200 group-hover:translate-x-0.5"
            dangerouslySetInnerHTML={{ __html: profileData.customization.username_icon_svg }}
            style={{
              fill: profileData.customization.username_icon_fill || undefined,
              stroke: profileData.customization.username_icon_stroke || undefined,
              width: '1em',
              height: '1em',
                maxHeight: '20px',
                maxWidth: '20px',
            }}
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
