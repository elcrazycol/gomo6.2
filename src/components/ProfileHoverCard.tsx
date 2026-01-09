import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { User } from "lucide-react";

interface ProfileHoverCardProps {
  userId: string;
  children: React.ReactNode;
}

export const ProfileHoverCard = ({ userId, children }: ProfileHoverCardProps) => {
  const [showCard, setShowCard] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

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
        }
      };
      loadProfile();
    }
  }, [showCard, userId]);

  if (!showCard || !profile) {
    return (
      <div
        onMouseEnter={() => setShowCard(true)}
        onMouseLeave={() => setShowCard(false)}
        className="relative"
      >
        {children}
      </div>
    );
  }

  return (
    <div
      onMouseEnter={() => setShowCard(true)}
      onMouseLeave={() => setShowCard(false)}
      className="relative"
    >
      {children}

      {/* Hover Card */}
      <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 z-50">
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
              <div className="font-semibold truncate">
                {profile.username}
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

          {/* Stats */}
          <div className="flex gap-4 mt-3 pt-3 border-t border-border">
            <div className="text-center">
              <div className="text-sm font-semibold">{profile.thread_count || 0}</div>
              <div className="text-xs text-muted-foreground">Тредов</div>
            </div>
            <div className="text-center">
              <div className="text-sm font-semibold">{profile.post_count || 0}</div>
              <div className="text-xs text-muted-foreground">Постов</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};