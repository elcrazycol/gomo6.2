import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { ProfileHoverCard } from "./ProfileHoverCard";

interface UserBadgeProps {
  userId: string | null;
  username: string;
  isAnonymous?: boolean;
  showOutline?: boolean;
  disableLink?: boolean;
}

export const UserBadge = ({ userId, username, isAnonymous, showOutline = true, disableLink = false }: UserBadgeProps) => {
  const [color, setColor] = useState<string>("");

  useEffect(() => {
    if (!userId || isAnonymous) return;

    const loadAchievements = async () => {
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
        // Get the highest priority color
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
    };

    loadAchievements();
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

  const badgeContent = (
    <span className={`font-bold hover:underline ${textSizeClass} ${outlineClass} ${color ? colorClasses[color] : "text-quote"}`}>
      {username}
    </span>
  );

  if (disableLink) {
    return (
      <ProfileHoverCard userId={userId}>
        {badgeContent}
      </ProfileHoverCard>
    );
  }

  return (
    <ProfileHoverCard userId={userId}>
      <Link
        to={`/profile/${userId}`}
        className={`font-bold hover:underline ${textSizeClass} ${outlineClass} ${color ? colorClasses[color] : "text-quote"}`}
      >
        {username}
      </Link>
    </ProfileHoverCard>
  );
};
