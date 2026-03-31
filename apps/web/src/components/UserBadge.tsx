import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { ProfileHoverCard } from "./ProfileHoverCard";
import { getProfileCustomization, parseCssToStyle, type ProfileCustomization } from "@/utils/profileCustomization";
import { AdminBadge } from "./AdminBadge";

interface UserBadgeProps {
  userId: string | null;
  username: string;
  isAnonymous?: boolean;
  showOutline?: boolean;
  disableLink?: boolean;
  disableHoverCard?: boolean;
  stopPropagationOnClick?: boolean;
}

export const UserBadge = ({
  userId,
  username,
  isAnonymous,
  showOutline = true,
  disableLink = false,
  disableHoverCard = false,
  stopPropagationOnClick = false,
}: UserBadgeProps) => {
  const [color, setColor] = useState<string>("");
  const [customization, setCustomization] = useState<ProfileCustomization | null>(null);

  useEffect(() => {
    if (!userId || isAnonymous) return;

    const loadData = async () => {
      // Load achievements for fallback color
      const { data } = await supabase
        .from("user_achievements")
        .select(`
          achievement_id,
          achievements (
            reward_type,
            reward_value
          )
        `)
        .eq("user_id", userId);

      if (data) {
        const colorRewards = data
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
  }, [userId, isAnonymous]);

  const textSizeClass = showOutline ? "text-base" : "text-xs sm:text-sm";
  const outlineClass = showOutline ? "drop-shadow-[0_0_1px_rgba(255,255,255,0.8)]" : "";

  if (isAnonymous || !userId) {
    return <span className={`font-bold text-quote ${textSizeClass} ${outlineClass}`}>Аноним</span>;
  }

  const colorClasses: Record<string, string> = {
    purple: `text-purple-500 font-bold ${textSizeClass} ${outlineClass}`,
    gold: `text-yellow-500 font-bold ${textSizeClass} ${outlineClass}`,
    orange: `text-orange-500 font-bold ${textSizeClass} ${outlineClass}`,
    red: `text-red-500 font-bold ${textSizeClass} ${outlineClass}`,
    blue: `text-blue-500 font-bold ${textSizeClass} ${outlineClass}`,
    green: `text-green-500 font-bold ${textSizeClass} ${outlineClass}`,
    yellow: `text-yellow-400 font-bold ${textSizeClass} ${outlineClass}`,
    cyan: `text-cyan-500 font-bold ${textSizeClass} ${outlineClass}`,
  };

  // Apply customization CSS if available
  const usernameStyle = customization?.username_css 
    ? parseCssToStyle(customization.username_css)
    : {};

  const badgeStyle = customization?.profile_badge_css
    ? parseCssToStyle(customization.profile_badge_css)
    : {};

  const usernameClassName = customization?.username_css
    ? `font-bold hover:underline ${textSizeClass}`
    : `font-bold hover:underline ${textSizeClass} ${outlineClass} ${color ? colorClasses[color] : "text-quote"}`;

  const usernameContent = (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1 overflow-hidden">
      <span className={usernameClassName} style={usernameStyle}>
        {username}
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
              maxHeight: '20px',
              maxWidth: '20px',
          }}
        />
      )}
      {customization?.profile_badge_text && (
        <span
          className="px-2 py-0.5 rounded text-xs font-medium ml-1"
          style={badgeStyle}
        >
          {customization.profile_badge_text}
        </span>
      )}
      {userId && <AdminBadge userId={userId} />}
    </span>
  );

  if (disableLink) {
    return (
      <ProfileHoverCard userId={userId} disabled={disableHoverCard}>
        {usernameContent}
      </ProfileHoverCard>
    );
  }

  return (
    <ProfileHoverCard userId={userId} disabled={disableHoverCard}>
      <Link
        to={`/profile/${userId}`}
        className="inline-flex max-w-full min-w-0 items-center gap-1 overflow-hidden"
        onClick={stopPropagationOnClick ? (event) => event.stopPropagation() : undefined}
      >
        {usernameContent}
      </Link>
    </ProfileHoverCard>
  );
};
