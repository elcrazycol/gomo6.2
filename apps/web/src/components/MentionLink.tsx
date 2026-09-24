import { useState, useEffect } from "react";
import { api } from "@/integrations/api/compat";
import { Link } from "react-router-dom";
import { User } from "lucide-react";
import { storageUrl } from "@/utils/storage";
import { UserAvatar } from "@/components/UserAvatar";

interface MentionLinkProps {
  username: string;
}

// Global cache for user mentions
const userCache = new Map<string, { exists: boolean; data?: unknown; avatarUrl?: string | null }>();

export const MentionLink = ({ username }: MentionLinkProps) => {
  const [userExists, setUserExists] = useState<boolean | null>(null);
  const [userData, setUserData] = useState<unknown>(null);
  const [userId, setUserId] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    // Check cache first
    if (userCache.has(username)) {
      const cached = userCache.get(username)!;
      setUserExists(cached.exists);
      setUserData(cached.data);
      setUserId((cached.data as { id?: string })?.id || "");
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
          setUserId(data.id);
          const resolvedAvatar = storageUrl("post-images", data.avatar_url);
          setAvatarUrl(resolvedAvatar);
          userCache.set(username, { exists: true, data, avatarUrl: resolvedAvatar });
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
    return (        <Link
        to={`/profile/${(userData as { id: string }).id}`}
        className={`inline-flex items-center gap-1.5 h-6 px-2 py-0.5 text-xs font-medium bg-muted/50 hover:bg-primary/10 hover:text-primary border border-border/40 hover:border-primary/30 transition-all duration-200 cursor-pointer rounded-md group`}
        title={`Профиль пользователя ${username}`}
      >
        <UserAvatar
          src={avatarUrl}
          userId={userId}
          alt={`${username} avatar`}
          className="w-3.5 h-3.5 flex-shrink-0"
          fallback={
            <User className="w-2 h-2 text-muted-foreground group-hover:text-primary transition-colors" />
          }
        />		<span className={`text-link font-medium truncate max-w-20`}>
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