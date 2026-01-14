import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

interface MentionLinkProps {
  username: string;
}

// Global cache for user mentions
const userCache = new Map<string, { exists: boolean; data?: any; color?: string }>();

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
  return colorClasses[color] || "text-link";
};

export const MentionLink = ({ username }: MentionLinkProps) => {
  const [userExists, setUserExists] = useState<boolean | null>(null);
  const [userData, setUserData] = useState<any>(null);
  const [color, setColor] = useState<string>("");

  useEffect(() => {
    // Check cache first
    if (userCache.has(username)) {
      const cached = userCache.get(username)!;
      setUserExists(cached.exists);
      setUserData(cached.data);
      setColor(cached.color || "");
      return;
    }

    const checkUserExists = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, username, is_anonymous')
          .eq('username', username)
          .single();

        if (error || !data) {
          setUserExists(false);
          userCache.set(username, { exists: false });
        } else {
          setUserExists(true);
          setUserData(data);

          // Load color from achievements
          const { data: achievements } = await supabase
            .from("user_achievements")
            .select(`
              achievement_id,
              achievements (
                reward_type,
                reward_value
              )
            `)
            .eq("user_id", data.id);

          let userColor = "";
          if (achievements) {
            const colorRewards = achievements
              .filter((a: any) => a.achievements?.reward_type === "username_color")
              .map((a: any) => a.achievements.reward_value);

            const priority = ['purple', 'gold', 'orange', 'red', 'blue', 'green', 'yellow', 'cyan'];
            for (const p of priority) {
              if (colorRewards.includes(p)) {
                userColor = p;
                break;
              }
            }
          }

          setColor(userColor);
          userCache.set(username, { exists: true, data, color: userColor });
        }
      } catch (error) {
        setUserExists(false);
        userCache.set(username, { exists: false });
      }
    };

    checkUserExists();
  }, [username]);

  if (userExists === null) {
    // Loading state
    return (
      <span className="text-link hover:underline">
        @{username}
      </span>
    );
  }

  if (userExists && userData) {
    const colorClass = color ? getColorClass(color) : "text-link";
    return (
      <Link
        to={`/profile/${userData.id}`}
        className={`${colorClass} hover:underline inline`}
      >
        @{username}
      </Link>
    );
  }

  // User doesn't exist, just show as plain text
  return (
    <span className="text-muted-foreground">
      @{username}
    </span>
  );
};