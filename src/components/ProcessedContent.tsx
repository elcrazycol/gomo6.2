import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { processVisibilityTags, VisibilityResult } from "@/utils/contentVisibility";
import { MentionLink } from "./MentionLink";
import { LinkButton } from "./LinkButton";
import { SpoilerText } from "@/components/SpoilerText";
import { EmojiInline } from "@/components/EmojiInline";

interface ProcessedContentProps {
  content: string;
  currentUserId: string | null;
  isAdmin: boolean;
  currentUsername: string;
  currentUserColor?: string;
  postAuthorId?: string | null;
  authorUsername?: string;
  showHiddenIndicators?: boolean; // Whether to show indicators for hidden parts
}

export const ProcessedContent = ({
  content,
  currentUserId,
  isAdmin,
  currentUsername,
  currentUserColor,
  postAuthorId,
  authorUsername,
  showHiddenIndicators = true
}: ProcessedContentProps) => {
  const [visibilityResult, setVisibilityResult] = useState<VisibilityResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(true);
  const [visibleUsernames, setVisibleUsernames] = useState<string[]>([]);
  const [hiddenUsernames, setHiddenUsernames] = useState<string[]>([]);
  const [authorColor, setAuthorColor] = useState<string>("");

  useEffect(() => {
    const processContent = async () => {
      setIsProcessing(true);
      try {
        // If authorUsername is not provided, try to get it
        let finalAuthorUsername = authorUsername;
        if (!finalAuthorUsername && postAuthorId) {
          const { data } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', postAuthorId)
            .single();
          finalAuthorUsername = data?.username;
        }

        const result = await processVisibilityTags(content, {
          currentUserId,
          isAdmin,
          currentUsername,
          postAuthorId,
          authorUsername: finalAuthorUsername
        });

        setVisibilityResult(result);

        // Load usernames for display
        if (result.visibleForUsers && result.visibleForUsers.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('username')
            .in('id', result.visibleForUsers);
          
          if (profiles) {
            const usernames = profiles.map(p => p.username).filter(Boolean);
            setVisibleUsernames(usernames);
          }
        }

        if (result.hiddenForUsers && result.hiddenForUsers.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('username')
            .in('id', result.hiddenForUsers);
          
          if (profiles) {
            const usernames = profiles.map(p => p.username).filter(Boolean);
            setHiddenUsernames(usernames);
          }
        }
      } catch (error) {
        console.error('Error processing visibility tags:', error);
        setVisibilityResult({
          processedContent: content,
          isHidden: false
        });
      }
      setIsProcessing(false);
    };

    processContent();
  }, [content, currentUserId, isAdmin, currentUsername, postAuthorId]);

  // Load author color
  useEffect(() => {
    if (!postAuthorId) return;

    const loadAuthorColor = async () => {
      const { data } = await supabase
        .from("user_achievements")
        .select(`
          achievement_id,
          achievements (
            reward_type,
            reward_value
          )
        `)
        .eq("user_id", postAuthorId);

      if (data) {
        // Get the highest priority color
        const colorRewards = data
          .filter((a: any) => a.achievements?.reward_type === "username_color")
          .map((a: any) => a.achievements.reward_value);

        const priority = ['purple', 'gold', 'orange', 'red', 'blue', 'green', 'yellow', 'cyan'];
        for (const p of priority) {
          if (colorRewards.includes(p)) {
            setAuthorColor(p);
            break;
          }
        }
      }
    };

    loadAuthorColor();
  }, [postAuthorId]);

  const renderContent = (text: string) => {
    const elements: React.ReactNode[] = [];
    let currentIndex = 0;
    let key = 0;

    // Process spoilers first
    const spoilerRegex = /\|\|(.*?)\|\|/g;
    let match;
    let lastIndex = 0;

    const processTextSegment = (segment: string) => {
      // Split by all formatting including hidden markers, dude links, me links, and emojis
      const regex = new RegExp(`(__HIDDEN_CONTENT_(?:seeusers|nousers|adm)_[^_]+__|__DUDE_LINK__|__ME_LINK__.*?__|:[^:\\s]+:|\\*\\*.*?\\*\\*|\\*.*?\\*|@[^\\s]+|https?://[^\\s]+)`, 'g');
      const parts = segment.split(regex);
      return parts.map((part, i) => {
        // Check for dude links (current user)
        if (part === '__DUDE_LINK__') {
          const colorClasses: Record<string, string> = {
            purple: 'text-purple-500 font-bold',
            gold: 'text-yellow-500 font-bold',
            orange: 'text-orange-500 font-bold',
            red: 'text-red-500 font-bold',
            blue: 'text-blue-500 font-bold',
            green: 'text-green-500 font-bold',
            yellow: 'text-yellow-400 font-bold',
            cyan: 'text-cyan-500 font-bold',
          };

          return (
            <Link
              key={`${key++}-dude-${i}`}
              to={`/profile/${currentUserId || ''}`}
              className={`font-bold hover:underline ${currentUserColor ? colorClasses[currentUserColor] : "text-quote"}`}
            >
              {currentUsername || 'Ты'}
            </Link>
          );
        }

        // Check for me links (post author)
        const meMatch = part.match(/^__ME_LINK__(.*?)__$/);
        if (meMatch) {
          const text = meMatch[1];
          const colorClasses: Record<string, string> = {
            purple: 'text-purple-500 font-bold',
            gold: 'text-yellow-500 font-bold',
            orange: 'text-orange-500 font-bold',
            red: 'text-red-500 font-bold',
            blue: 'text-blue-500 font-bold',
            green: 'text-green-500 font-bold',
            yellow: 'text-yellow-400 font-bold',
            cyan: 'text-cyan-500 font-bold',
          };

          return (
            <Link
              key={`${key++}-me-${i}`}
              to={`/profile/${postAuthorId || ''}`}
              className={`font-bold hover:underline ${authorColor ? colorClasses[authorColor] : "text-quote"}`}
            >
              {text || (authorUsername || 'Автор')}
            </Link>
          );
        }

        // Check for hidden content markers
        const hiddenMatch = part.match(/^__HIDDEN_CONTENT_(seeusers|nousers|adm)_([^_]+)__/);
        if (hiddenMatch) {
          const hiddenReason = hiddenMatch[1] as 'seeusers' | 'nousers' | 'adm';
          const usernames = hiddenMatch[2].split(',').filter(u => u.trim());

          if (hiddenReason === 'seeusers') {
            return (
              <span
                key={`${key++}-hidden-${i}`}
                className="inline-block bg-muted/80 text-muted-foreground text-xs px-2 py-1 rounded border mx-1"
              >
                Скрытый контент для{' '}
                {usernames.map((username, idx) => (
                  <span key={username}>
                    <MentionLink username={username} />
                    {idx < usernames.length - 1 && ', '}
                  </span>
                ))}
              </span>
            );
          } else if (hiddenReason === 'nousers') {
            return (
              <span
                key={`${key++}-hidden-${i}`}
                className="inline-block bg-muted/80 text-muted-foreground text-xs px-2 py-1 rounded border mx-1"
              >
                Скрытый контент от:{' '}
                {usernames.map((username, idx) => (
                  <span key={username}>
                    <MentionLink username={username} />
                    {idx < usernames.length - 1 && ', '}
                  </span>
                ))}
              </span>
            );
          } else if (hiddenReason === 'adm') {
            return (
              <span
                key={`${key++}-hidden-${i}`}
                className="inline-block bg-muted/80 text-muted-foreground text-xs px-2 py-1 rounded border mx-1"
              >
                Скрытый контент
              </span>
            );
          }
        }

        // Process other formatting
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={`${key++}-bold-${i}`} className="font-bold">
              {part.slice(2, -2)}
            </strong>
          );
        } else if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
          return (
            <em key={`${key++}-italic-${i}`} className="italic">
              {part.slice(1, -1)}
            </em>
          );
        } else if (part.startsWith('@')) {
          const username = part.substring(1);
          return (
            <MentionLink key={`${key++}-mention-${i}`} username={username} />
          );
        } else if (part.match(/^https?:\/\/[^\s]+$/)) {
          return (
            <LinkButton key={`${key++}-link-${i}`} url={part} />
          );
        } else if (part.startsWith(':') && part.endsWith(':') && part.length > 2) {
          // Emoji code like :smile:
          const emojiCode = part.slice(1, -1); // Remove colons
          return (
            <EmojiInline key={`${key++}-emoji-${i}`} code={emojiCode} />
          );
        }
        return part;
      }).flat();
    };

    while ((match = spoilerRegex.exec(text)) !== null) {
      // Add text before spoiler
      if (match.index > lastIndex) {
        elements.push(...processTextSegment(text.substring(lastIndex, match.index)));
      }

      // Add spoiler
      const spoilerContent = match[1];
      elements.push(
        <SpoilerText key={`spoiler-${key++}`} content={spoilerContent} />
      );

      lastIndex = spoilerRegex.lastIndex;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      elements.push(...processTextSegment(text.substring(lastIndex)));
    }

    return elements;
  };

  if (isProcessing) {
    return <span className="text-muted-foreground">Загрузка...</span>;
  }

  if (!visibilityResult) {
    return <div className="whitespace-pre-wrap text-sm sm:text-base break-words">{renderContent(content)}</div>;
  }

  // If processed content is empty (completely hidden)
  if (!visibilityResult.processedContent || visibilityResult.processedContent.trim() === '') {
    if (visibilityResult.hiddenReason === 'seeusers' && visibleUsernames.length > 0) {
      // Content visible only for specific users
      return (
        <span className="text-muted-foreground italic">
          Скрытый контент для{' '}
          {visibleUsernames.map((username, idx) => (
            <span key={username}>
              <MentionLink username={username} />
              {idx < visibleUsernames.length - 1 && ', '}
            </span>
          ))}
        </span>
      );
    } else if (visibilityResult.hiddenReason === 'nousers' && hiddenUsernames.length > 0) {
      // Content hidden from specific users
      return (
        <span className="text-muted-foreground italic">
          Скрытый контент от:{' '}
          {hiddenUsernames.map((username, idx) => (
            <span key={username}>
              <MentionLink username={username} />
              {idx < hiddenUsernames.length - 1 && ', '}
            </span>
          ))}
        </span>
      );
    } else if (visibilityResult.hiddenReason === 'adm') {
      return <span className="text-muted-foreground italic">Скрытый контент</span>;
    } else {
      return <span className="text-muted-foreground italic">Скрытый контент</span>;
    }
  }


  // Show processed content
  return <>{renderContent(visibilityResult.processedContent)}</>;
};