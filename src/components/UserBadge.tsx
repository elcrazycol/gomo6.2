import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { ProfileHoverCard } from "./ProfileHoverCard";

interface UserBadgeProps {
  userId: string | null;
  username: string;
  isAnonymous?: boolean;
}

export const UserBadge = ({ userId, username, isAnonymous }: UserBadgeProps) => {
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

  if (isAnonymous || !userId) {
    return <span className="font-bold text-quote">Аноним</span>;
  }

  const colorClasses: Record<string, string> = {
    purple: "text-purple-500 font-bold",
    gold: "text-yellow-500 font-bold",
    orange: "text-orange-500 font-bold",
    red: "text-red-500 font-bold",
    blue: "text-blue-500 font-bold",
    green: "text-green-500 font-bold",
    yellow: "text-yellow-400 font-bold",
    cyan: "text-cyan-500 font-bold",
  };

  return (
    <ProfileHoverCard userId={userId}>
      <Link
        to={`/profile/${userId}`}
        className={`font-bold hover:underline ${color ? colorClasses[color] : "text-quote"}`}
      >
        {username}
      </Link>
    </ProfileHoverCard>
  );
};
