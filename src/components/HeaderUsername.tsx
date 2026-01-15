import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ProfileHoverCard } from "./ProfileHoverCard";
import { getProfileCustomization, parseCssToStyle } from "@/utils/profileCustomization";
import { AdminBadge } from "./AdminBadge";

interface HeaderUsernameProps {
  userId: string;
  className?: string;
}

export const HeaderUsername = ({ userId, className = "" }: HeaderUsernameProps) => {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [customization, setCustomization] = useState<any>(null);
  const [color, setColor] = useState("");

  useEffect(() => {
    const loadData = async () => {
      // Load profile
      const { data: profile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", userId)
        .single();

      if (profile) {
        setUsername(profile.username);
      }

      // Load achievements for fallback color
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
            setColor(p);
            break;
          }
        }
      }

      // Load customization
      const custom = await getProfileCustomization(userId);
      setCustomization(custom);
    };

    loadData();
  }, [userId]);

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

  const usernameStyle = customization?.username_css 
    ? parseCssToStyle(customization.username_css)
    : {};

  const usernameClassName = customization?.username_css
    ? `text-sm sm:text-base drop-shadow-[0_0_1px_rgba(255,255,255,0.8)]`
    : `text-sm sm:text-base drop-shadow-[0_0_1px_rgba(255,255,255,0.8)] ${color ? colorClasses[color] : 'text-quote'}`;

  return (
    <ProfileHoverCard userId={userId}>
      <span
        className={`inline-flex items-center gap-1 cursor-pointer group ${className}`}
        onClick={() => navigate(`/profile/${userId}`)}
        style={{ userSelect: 'none' }}
      >
        <span className={`${usernameClassName} relative inline-block transition-transform duration-200 group-hover:translate-x-0.5`} style={usernameStyle}>
          {username || 'Профиль'}
          <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
        </span>
        {customization?.username_icon_svg && (
          <span
            className="inline-flex items-center justify-center transition-transform duration-200 group-hover:translate-x-0.5"
            dangerouslySetInnerHTML={{ __html: customization.username_icon_svg }}
            style={{
              fill: customization.username_icon_fill || undefined,
              stroke: customization.username_icon_stroke || undefined,
              width: '1em',
              height: '1em',
              maxHeight: '20px',
              maxWidth: '20px',
              maxWidth: '1.5em',
            }}
          />
        )}
        <div className="transition-transform duration-200 group-hover:translate-x-0.5">
          <AdminBadge userId={userId} />
        </div>
      </span>
    </ProfileHoverCard>
  );
};
