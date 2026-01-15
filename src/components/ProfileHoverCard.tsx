import { useState, useEffect, cloneElement } from "react";
import { supabase } from "@/integrations/supabase/client";
import { User } from "lucide-react";
import { getProfileCustomization, parseCssToStyle, type ProfileCustomization } from "@/utils/profileCustomization";

interface ProfileHoverCardProps {
  userId: string;
  children: React.ReactNode;
}

const getColorClass = (color: string): string => {
  const colorClasses: Record<string, string> = {
    purple: "text-purple-500",
    gold: "text-yellow-500",
    orange: "text-orange-500",
    red: "text-red-500",
    blue: "text-blue-500",
    green: "text-green-500",
    yellow: "text-yellow-400",
    cyan: "text-cyan-500",
  };
  return colorClasses[color] || "text-foreground";
};

export const ProfileHoverCard = ({ userId, children }: ProfileHoverCardProps) => {
  const [showCard, setShowCard] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [usernameColor, setUsernameColor] = useState<string>("");
  const [customization, setCustomization] = useState<ProfileCustomization | null>(null);

  useEffect(() => {
    if (showCard && userId) {
      const loadProfile = async () => {
        const { data } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .single();

        if (data) {
          setProfile(data);
          setAvatarUrl(data.avatar_url);

          // Load achievements for color
          const { data: achievements } = await supabase
            .from("user_achievements")
            .select(`
              achievement_id,
              achievements (
                reward_type,
                reward_value
              )
            `)
            .eq("user_id", userId);

          if (achievements) {
            const colorRewards = achievements
              .filter((a: any) => a.achievements?.reward_type === "username_color")
              .map((a: any) => a.achievements.reward_value);

            const priority = ['purple', 'gold', 'orange', 'red', 'blue', 'green', 'yellow', 'cyan'];
            for (const p of priority) {
              if (colorRewards.includes(p)) {
                setUsernameColor(p);
                break;
              }
            }
          }

          // Load customization
          const custom = await getProfileCustomization(userId);
          setCustomization(custom);
        }
      };
      loadProfile();
    }
  }, [showCard, userId]);

  const childrenWithHover = cloneElement(children as React.ReactElement, {
    onMouseEnter: () => setShowCard(true),
    onMouseLeave: () => setShowCard(false),
  });

  if (!showCard || !profile) {
    return (
      <div className="relative">
        {childrenWithHover}
      </div>
    );
  }

  const usernameStyle = customization?.username_css 
    ? parseCssToStyle(customization.username_css)
    : {};

  const badgeStyle = customization?.profile_badge_css
    ? parseCssToStyle(customization.profile_badge_css)
    : {};

  const usernameClassName = customization?.username_css
    ? "font-semibold truncate"
    : `font-semibold truncate ${usernameColor ? getColorClass(usernameColor) : "text-foreground"}`;

  return (
    <div className="relative">
      {childrenWithHover}

      {/* Hover Card */}
      <div className="absolute top-full left-0 mt-1 z-50">
        <div className="bg-background/95 backdrop-blur-md border border-border rounded-lg shadow-lg p-4 min-w-[280px] max-w-[320px]">
          <div className="flex items-start gap-3">
            {/* Avatar */}
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Avatar"
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-6 h-6 text-muted-foreground" />
              )}
            </div>

            {/* User Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1 flex-wrap">
                <span className={usernameClassName} style={usernameStyle}>
                  {profile.username}
                </span>
                {customization?.username_icon_svg && (
                  <span
                    className="inline-flex items-center justify-center"
                    dangerouslySetInnerHTML={{ __html: customization.username_icon_svg }}
                    style={{
                      fill: customization.username_icon_fill || undefined,
                      stroke: customization.username_icon_stroke || undefined,
                      width: '1em',
                      height: '1em',
                    }}
                  />
                )}
                {customization?.profile_badge_text && (
                  <span
                    className="px-1.5 py-0.5 rounded text-xs font-medium"
                    style={badgeStyle}
                  >
                    {customization.profile_badge_text}
                  </span>
                )}
              </div>
              <div className="text-sm text-muted-foreground">
                ID: {profile.id.slice(0, 8)} {profile.account_number && `(${profile.account_number})`}
              </div>
              {profile.bio && (
                <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {profile.bio}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};