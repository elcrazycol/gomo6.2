import { useState, useEffect } from "react";
import { api } from "@/integrations/api/compat";
import { Link } from "react-router-dom";
import { User } from "lucide-react";
import { storageUrl } from "@/utils/storage";

interface MentionLinkProps {
  username: string;
}

// Global cache for user mentions
const userCache = new Map<string, { exists: boolean; data?: unknown; color?: string; avatarUrl?: string | null }>();

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
  const [userData, setUserData] = useState<unknown>(null);
  const [color, setColor] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    // Check cache first
    if (userCache.has(username)) {
      const cached = userCache.get(username)!;
      setUserExists(cached.exists);
      setUserData(cached.data);
      setColor(cached.color || "");
      setAvatarUrl(storageUrl("post-images", cached.avatarUrl ?? null));
      return;
    }

    const checkUserExists = async () => {
      try {
        const { data, error } = await api
          .from('profiles')
          .select('id, username, is_anonymous, avatar_url')
          .eq('username', username)
          .single();

        if (error || !data) {
          setUserExists(false);
          userCache.set(username, { exists: false });
        } else {
          setUserExists(true);
          setUserData(data);
          const resolvedAvatar = storageUrl("post-images", data.avatar_url);
          setAvatarUrl(resolvedAvatar);

          // Load color from achievements
          const { data: achievements } = await api
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
              .filter((a: Record<string, unknown>) => (a.achievements as Record<string, unknown>)?.reward_type === "username_color")
              .map((a: Record<string, unknown>) => (a.achievements as Record<string, unknown>).reward_value);

            const priority = ['purple', 'gold', 'orange', 'red', 'blue', 'green', 'yellow', 'cyan'];
            for (const p of priority) {
              if (colorRewards.includes(p)) {
                userColor = p;
                break;
              }
            }
          }

          setColor(userColor);
          userCache.set(username, { exists: true, data, color: userColor, avatarUrl: resolvedAvatar });
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
      <span className="inline-flex items-center gap-1.5 h-6 px-2 py-0.5 text-xs font-medium bg-muted/30 border border-border/30 rounded-md">
        <div className="w-3.5 h-3.5 rounded-full bg-muted flex items-center justify-center animate-pulse">
          <User className="w-2 h-2 text-muted-foreground" />
        </div>
        <span className="text-muted-foreground truncate max-w-20">
          {username}
        </span>
      </span>
    );
  }

  if (userExists && userData) {
    const colorClass = color ? getColorClass(color) : "text-link";
    return (        <Link
        to={`/profile/${(userData as { id: string }).id}`}
        className={`inline-flex items-center gap-1.5 h-6 px-2 py-0.5 text-xs font-medium bg-muted/50 hover:bg-primary/10 hover:text-primary border border-border/40 hover:border-primary/30 transition-all duration-200 cursor-pointer rounded-md group`}
        title={`Профиль пользователя ${username}`}
      >
        <div className="w-3.5 h-3.5 rounded-full overflow-hidden flex-shrink-0 bg-muted">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={`${username} avatar`}
              className="w-full h-full object-cover"
              onError={(e) => {
                // Fallback to icon if image fails to load
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                const parent = target.parentElement;
                if (parent) {
                  parent.innerHTML = '<svg class="w-2 h-2 text-muted-foreground group-hover:text-primary transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>';
                }
              }}
            />
          ) : (
            <User className="w-2 h-2 text-muted-foreground group-hover:text-primary transition-colors" />
          )}
        </div>
        <span className={`${colorClass} font-medium truncate max-w-20`}>
          {username}
        </span>
      </Link>
    );
  }

  // User doesn't exist, show as disabled panel
  return (
    <span className="inline-flex items-center gap-1.5 h-6 px-2 py-0.5 text-xs font-medium bg-muted/20 border border-border/20 rounded-md opacity-60">
      <div className="w-3.5 h-3.5 rounded-full bg-muted/40 flex items-center justify-center">
        <User className="w-2 h-2 text-muted-foreground/60" />
      </div>
      <span className="text-muted-foreground truncate max-w-20">
        {username}
      </span>
    </span>
  );
};