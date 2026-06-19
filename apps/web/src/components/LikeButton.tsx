import { useState, useEffect, memo } from "react";
import { Heart } from "lucide-react";
import { api } from "@/integrations/api/compat";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { MentionLink } from "./MentionLink";
import { UserBadge } from "./UserBadge";
import { useLikesCache } from "@/contexts/LikesCacheContext";

interface LikeButtonProps {
  postId: string;
  currentUserId: string | null;
  postAuthorId?: string | null;
  onLikeChange?: (liked: boolean, count: number) => void;
  isThread?: boolean; // New prop to distinguish between posts and threads
}

export const LikeButton = memo(({ postId, currentUserId, postAuthorId, onLikeChange, isThread = false }: LikeButtonProps) => {
  const { getLikeData, loadLikeData, updateLikeData } = useLikesCache();
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [recentLikers, setRecentLikers] = useState<{ username: string; display_name?: string | null; id: string; avatar_url?: string | null; is_anonymous?: boolean }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);

  // Load initial like status and count
  useEffect(() => {
    const loadData = async () => {
      // Check cache first
      const cached = getLikeData(postId, isThread);
      if (cached) {
        setIsLiked(cached.isLiked);
        setLikesCount(cached.count);
        return;
      }

      // Load from API
      const data = await loadLikeData(postId, currentUserId, isThread);
      setIsLiked(data.isLiked);
      setLikesCount(data.count);
    };

    loadData();
  }, [postId, currentUserId, isThread, getLikeData, loadLikeData]);

  // Load recent likers when tooltip opens
  useEffect(() => {
    const loadRecentLikers = async () => {
      if (!tooltipOpen || likesCount === 0) return;

      try {
        const likersFunction = isThread ? 'get_recent_thread_likers' : 'get_recent_post_likers';
        const { data: likers } = await api.rpc(likersFunction, {
          [isThread ? 'thread_uuid' : 'post_uuid']: postId,
          limit_count: 3
        });
        setRecentLikers((likers as { username: string; id: string; avatar_url?: string | null; is_anonymous?: boolean }[]) || []);
      } catch (error) {
        console.error('Error loading recent likers:', error);
      }
    };

    loadRecentLikers();
  }, [tooltipOpen, postId, likesCount, isThread]);

  const checkAchievements = async (userId: string, achievementType: string) => {
    try {
      let count = 0;

      if (achievementType === 'likes_given') {
        const countFunction = isThread ? 'get_user_thread_likes_given_count' : 'get_user_likes_given_count';
        const { data } = await api.rpc(countFunction, { user_uuid: userId });
        count = (data as number) || 0;
      } else if (achievementType === 'likes_received') {
        const countFunction = isThread ? 'get_user_thread_likes_received_count' : 'get_user_likes_received_count';
        const { data } = await api.rpc(countFunction, { user_uuid: userId });
        count = (data as number) || 0;
      }

      // Determine achievement level based on count
      let level = 0;
      if (count >= 1000) level = 8;
      else if (count >= 500) level = 7;
      else if (count >= 250) level = 6;
      else if (count >= 100) level = 5;
      else if (count >= 75) level = 4;
      else if (count >= 50) level = 3;
      else if (count >= 25) level = 2;
      else if (count >= 10) level = 1;

      if (level > 0) {
        // Award achievement using the RPC function
        await api.rpc('award_achievement_with_level', {
          _user_id: userId,
          _achievement_type: achievementType,
          _level: level
        });
      }
    } catch (error) {
      console.error('Error checking achievements:', error);
    }
  };

  const handleLikeToggle = async () => {
    if (!currentUserId || isLoading) return;

    // Prevent liking your own posts/threads
    if (postAuthorId && currentUserId === postAuthorId) return;

    setIsLoading(true);
    try {
      if (isLiked) {
        // Remove like
        const { error } = await api
          .from(isThread ? 'thread_likes' : 'post_likes')
          .delete()
          .eq(isThread ? 'thread_id' : 'post_id', postId)
          .eq('user_id', currentUserId);

        if (!error) {
          setIsLiked(false);
          const newCount = Math.max(0, likesCount - 1);
          setLikesCount(newCount);
          updateLikeData(postId, isThread, false, newCount);
          onLikeChange?.(false, newCount);

          // Re-check achievements after removing like
          await checkAchievements(currentUserId, 'likes_given');
          if (postAuthorId && postAuthorId !== currentUserId) {
            await checkAchievements(postAuthorId, 'likes_received');
          }
        }
      } else {
        // Add like
        const { error } = await api
          .from(isThread ? 'thread_likes' : 'post_likes')
          .insert({
            [isThread ? 'thread_id' : 'post_id']: postId,
            user_id: currentUserId
          });

        if (!error) {
          setIsLiked(true);
          const newCount = likesCount + 1;
          setLikesCount(newCount);
          updateLikeData(postId, isThread, true, newCount);
          onLikeChange?.(true, newCount);

          // Check achievements after adding like
          await checkAchievements(currentUserId, 'likes_given');
          if (postAuthorId && postAuthorId !== currentUserId) {
            await checkAchievements(postAuthorId, 'likes_received');
          }
        }
      }
    } catch (error) {
      console.error('Error toggling like:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getTooltipContent = () => {
    if (likesCount === 0) return "Никто ещё не оценил";

    const recentNames = recentLikers.map(liker => liker.username);
    const remainingCount = likesCount - recentLikers.length;

    if (recentLikers.length === 0) {
      return `${likesCount} ${likesCount === 1 ? 'оценил' : 'оценили'}`;
    }

    let content = recentNames.join(', ');
    if (remainingCount > 0) {
      content += ` и ещё ${remainingCount}`;
    }

    return content;
  };

  const isOwnPost = postAuthorId && currentUserId === postAuthorId;

  if (!currentUserId) {
    // Show read-only version for non-authenticated users
    return (
      <TooltipProvider>
        <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen}>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1 text-muted-foreground cursor-help">
              <Heart className="h-4 w-4 fill-muted-foreground/20" />
              {likesCount > 0 && <span className="text-sm">{likesCount}</span>}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>{getTooltipContent()}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLikeToggle}
            disabled={isLoading}
            className={`flex items-center gap-1 h-auto p-1 hover:bg-transparent ${
              isOwnPost
                ? 'text-muted-foreground/50 cursor-not-allowed'
                : isLiked
                ? 'text-red-500'
                : 'text-muted-foreground hover:text-red-500'
            }`}
          >
            <Heart
              className={`h-4 w-4 ${
                isLiked ? 'fill-red-500' : 'fill-transparent'
              } transition-colors ${isOwnPost ? 'opacity-50' : ''}`}
            />
            {likesCount > 0 && (
              <span className="text-sm font-medium">{likesCount}</span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent className="bg-card border border-border">
          <div className="space-y-2">
            <div className="text-muted-foreground text-xs mb-2">
              {likesCount > 3 ? `+${likesCount - 3} других` : `${likesCount} лайков`}
            </div>
            {recentLikers.length > 0 ? (
              <div className="space-y-2">
                {recentLikers.slice(0, 3).map((liker) => (
                  <div key={liker.id} className="flex items-center">
                    <UserBadge
                      userId={liker.id}
                      username={liker.is_anonymous ? "Аноним" : liker.username}
                      displayName={liker.is_anonymous ? undefined : liker.display_name}
                      isAnonymous={liker.is_anonymous}
                      showOutline={false}
                      className="text-xs"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs">{getTooltipContent()}</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

LikeButton.displayName = 'LikeButton';