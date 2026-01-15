import { useState, useEffect } from "react";
import { Heart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { MentionLink } from "./MentionLink";

interface LikeButtonProps {
  postId: string;
  currentUserId: string | null;
  postAuthorId?: string | null;
  onLikeChange?: (liked: boolean, count: number) => void;
}

export const LikeButton = ({ postId, currentUserId, postAuthorId, onLikeChange }: LikeButtonProps) => {
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [recentLikers, setRecentLikers] = useState<{ username: string; id: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);

  // Load initial like status and count
  useEffect(() => {
    const loadLikeData = async () => {
      if (!currentUserId) return;

      try {
        // Check if user liked this post
        const { data: hasLiked } = await supabase.rpc('has_user_liked_post', {
          post_uuid: postId,
          user_uuid: currentUserId
        });
        setIsLiked(hasLiked);

        // Get likes count
        const { data: count } = await supabase.rpc('get_post_likes_count', {
          post_uuid: postId
        });
        setLikesCount(count || 0);
      } catch (error) {
        console.error('Error loading like data:', error);
      }
    };

    loadLikeData();
  }, [postId, currentUserId]);

  // Load recent likers when tooltip opens
  useEffect(() => {
    const loadRecentLikers = async () => {
      if (!tooltipOpen || likesCount === 0) return;

      try {
        const { data: likers } = await supabase.rpc('get_recent_post_likers', {
          post_uuid: postId,
          limit_count: 3
        });
        setRecentLikers(likers || []);
      } catch (error) {
        console.error('Error loading recent likers:', error);
      }
    };

    loadRecentLikers();
  }, [tooltipOpen, postId, likesCount]);

  const checkAchievements = async (userId: string, achievementType: string) => {
    try {
      let count = 0;

      if (achievementType === 'likes_given') {
        const { data } = await supabase.rpc('get_user_likes_given_count', { user_uuid: userId });
        count = data || 0;
      } else if (achievementType === 'likes_received') {
        const { data } = await supabase.rpc('get_user_likes_received_count', { user_uuid: userId });
        count = data || 0;
      }

      // Determine achievement level based on count
      let level = 0;
      if (count >= 1000) level = 8;
      else if (count >= 500) level = 7;
      else if (count >= 250) level = 6;
      else if (count >= 100) level = 5;
      else if (count >= 50) level = 4;
      else if (count >= 25) level = 3;
      else if (count >= 10) level = 2;
      else if (count >= 1) level = 1;

      if (level > 0) {
        // Award achievement using the RPC function
        await supabase.rpc('award_achievement_with_level', {
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

    // Prevent liking your own posts
    if (postAuthorId && currentUserId === postAuthorId) return;

    setIsLoading(true);
    try {
      if (isLiked) {
        // Remove like
        const { error } = await supabase
          .from('post_likes')
          .delete()
          .eq('post_id', postId)
          .eq('user_id', currentUserId);

        if (!error) {
          setIsLiked(false);
          setLikesCount(prev => Math.max(0, prev - 1));
          onLikeChange?.(false, Math.max(0, likesCount - 1));

          // Re-check achievements after removing like
          await checkAchievements(currentUserId, 'likes_given');
          if (postAuthorId && postAuthorId !== currentUserId) {
            await checkAchievements(postAuthorId, 'likes_received');
          }
        }
      } else {
        // Add like
        const { error } = await supabase
          .from('post_likes')
          .insert({
            post_id: postId,
            user_id: currentUserId
          });

        if (!error) {
          setIsLiked(true);
          setLikesCount(prev => prev + 1);
          onLikeChange?.(true, likesCount + 1);

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
            disabled={isLoading || isOwnPost}
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
        <TooltipContent>
          <div className="space-y-1">
            {recentLikers.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {recentLikers.map((liker, index) => (
                  <span key={liker.id}>
                    <MentionLink username={liker.username} />
                    {index < recentLikers.length - 1 && ', '}
                  </span>
                ))}
                {likesCount > recentLikers.length && (
                  <span className="text-muted-foreground">
                    {' '}и ещё {likesCount - recentLikers.length}
                  </span>
                )}
              </div>
            ) : (
              <p>{getTooltipContent()}</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};