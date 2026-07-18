import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { processVisibilityTags, VisibilityResult } from "@/utils/contentVisibility";
import { MentionLink } from "./MentionLink";
import { renderBbCode } from "@/utils/bbcodePlugins";
import { RichContentRenderer } from "./RichContentRenderer";
import { useUserColor } from "@/hooks/useUserColor";

interface ProcessedContentProps {
  content: string;
  contentJson?: unknown;
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
  contentJson,
  currentUserId,
  isAdmin,
  currentUsername,
  currentUserColor,
  postAuthorId,
  authorUsername,
  showHiddenIndicators = true
}: ProcessedContentProps) => {
  const { data: authorColor = "" } = useUserColor(postAuthorId || undefined);
  const [visibilityResult, setVisibilityResult] = useState<VisibilityResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(true);
  const [visibleUsernames, setVisibleUsernames] = useState<string[]>([]);
  const [hiddenUsernames, setHiddenUsernames] = useState<string[]>([]);

  useEffect(() => {
    const processContent = async () => {
      setIsProcessing(true);
      try {
        // If authorUsername is not provided, try to get it
        let finalAuthorUsername = authorUsername;
        if (!finalAuthorUsername && postAuthorId) {
          const { data } = await api
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
          const { data: profiles } = await api
            .from('profiles')
            .select('username')
            .in('id', result.visibleForUsers);
          
          if (profiles) {
            const usernames = profiles.map((p: Record<string, unknown>) => p.username as string).filter(Boolean);
            setVisibleUsernames(usernames);
          }
        }

        if (result.hiddenForUsers && result.hiddenForUsers.length > 0) {
          const { data: profiles } = await api
            .from('profiles')
            .select('username')
            .in('id', result.hiddenForUsers);
          
          if (profiles) {
            const usernames = profiles.map((p: Record<string, unknown>) => p.username as string).filter(Boolean);
            setHiddenUsernames(usernames);
          }
        }
      } catch (error) {
        console.error('Error processing visibility tags:', error);
        setVisibilityResult({
          processedContent: content,
          isHidden: false,
          hasHiddenParts: false
        });
      }
      setIsProcessing(false);
    };

    processContent();
  }, [content, currentUserId, isAdmin, currentUsername, postAuthorId, authorUsername]);

  const renderContent = (text: string) => {
    if (contentJson) {
      const richResult = <RichContentRenderer contentJson={contentJson} />;
      if (richResult) return richResult;
    }

    const elements: React.ReactNode[] = [];
    let key = 0;

    // Process hidden content markers, dude links, me links
    const specialMarkersRegex = /(__HIDDEN_CONTENT_(?:seeusers|nousers|adm)_[^_]+__|__DUDE_LINK__|__ME_LINK__(.*?)__)/g;
    const parts: Array<{ type: 'text' | 'marker'; content: string; match?: RegExpMatchArray }> = [];
    let lastIndex = 0;
    let match: RegExpMatchArray | null;

    while ((match = specialMarkersRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: text.substring(lastIndex, match.index) });
      }
      parts.push({ type: 'marker', content: match[0], match });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      parts.push({ type: 'text', content: text.substring(lastIndex) });
    }

    // Render each part
    for (const part of parts) {
      if (part.type === 'marker' && part.match) {
        const marker = part.match[0];
        
        // Check for dude links (current user)
        if (marker === '__DUDE_LINK__') {
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

          elements.push(
            <Link
              key={`dude-${key++}`}
              to={`/profile/${currentUserId || ''}`}
              className={`font-bold hover:underline ${currentUserColor ? colorClasses[currentUserColor] : "text-quote"}`}
            >
              {currentUsername || 'Ты'}
            </Link>
          );
          continue;
        }

        // Check for me links (post author)
        const meMatch = marker.match(/^__ME_LINK__(.*?)__$/);
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

          elements.push(
            <Link
              key={`me-${key++}`}
              to={`/profile/${postAuthorId || ''}`}
              className={`font-bold hover:underline ${authorColor ? colorClasses[authorColor] : "text-quote"}`}
            >
              {text || (authorUsername || 'Автор')}
            </Link>
          );
          continue;
        }

        // Check for hidden content markers
        const hiddenMatch = marker.match(/^__HIDDEN_CONTENT_(seeusers|nousers|adm)_([^_]+)__/);
        if (hiddenMatch) {
          const hiddenReason = hiddenMatch[1] as 'seeusers' | 'nousers' | 'adm';
          const usernames = hiddenMatch[2].split(',').filter(u => u.trim());

          if (hiddenReason === 'seeusers') {
            elements.push(
              <span
                key={`hidden-${key++}`}
                className="inline-block bg-muted/80 text-muted-foreground text-xs px-2 py-1 rounded border mx-1"
              >
                Скрытый контент для{' '}
                {usernames.map((username, idx) => (
                  <span key={`${username}-${idx}`}>
                    <MentionLink username={username} />
                    {idx < usernames.length - 1 && ', '}
                  </span>
                ))}
              </span>
            );
          } else if (hiddenReason === 'nousers') {
            elements.push(
              <span
                key={`hidden-${key++}`}
                className="inline-block bg-muted/80 text-muted-foreground text-xs px-2 py-1 rounded border mx-1"
              >
                Скрытый контент от:{' '}
                {usernames.map((username, idx) => (
                  <span key={`${username}-${idx}`}>
                    <MentionLink username={username} />
                    {idx < usernames.length - 1 && ', '}
                  </span>
                ))}
              </span>
            );
          } else if (hiddenReason === 'adm') {
            elements.push(
              <span
                key={`hidden-${key++}`}
                className="inline-block bg-muted/80 text-muted-foreground text-xs px-2 py-1 rounded border mx-1"
              >
                Скрытый контент
              </span>
            );
          }
          continue;
        }
      } else if (part.type === 'text' && part.content) {
        // Use @bbob/react to render BB code
        const rendered = renderBbCode(part.content, {
          currentUserId,
          currentUsername,
          currentUserColor,
          postAuthorId,
          authorUsername,
          authorColor,
          keyPrefix: `bb-${key++}`
        });
        
        if (rendered) {
          elements.push(
            <span key={`bb-${key++}`} className="contents">
              {rendered}
            </span>
          );
        }
      }
    }

    return elements.length > 0 ? elements : null;
  };

  if (isProcessing) {
    return <span className="text-muted-foreground">Загрузка...</span>;
  }

  if (!visibilityResult) {
    return <div className="whitespace-pre-wrap text-sm sm:text-base break-words">{renderContent(content)}</div>;
  }

  // If processed content is empty (completely hidden)
  if (!visibilityResult.processedContent || visibilityResult.processedContent.trim() === '') {
    // Only show "Скрытый контент" when there's an actual visibility restriction
    if (visibilityResult.hiddenReason) {
      if (visibilityResult.hiddenReason === 'seeusers' && visibleUsernames.length > 0) {
        return (
          <span className="text-muted-foreground italic">
            Скрытый контент для{' '}
            {visibleUsernames.map((username, idx) => (
              <span key={`${username}-${idx}`}>
                <MentionLink username={username} />
                {idx < visibleUsernames.length - 1 && ', '}
              </span>
            ))}
          </span>
        );
      } else if (visibilityResult.hiddenReason === 'nousers' && hiddenUsernames.length > 0) {
        return (
          <span className="text-muted-foreground italic">
            Скрытый контент от:{' '}
            {hiddenUsernames.map((username, idx) => (
              <span key={`${username}-${idx}`}>
                <MentionLink username={username} />
                {idx < hiddenUsernames.length - 1 && ', '}
              </span>
            ))}
          </span>
        );
      } else {
        return <span className="text-muted-foreground italic">Скрытый контент</span>;
      }
    }
    // No hidden reason and empty plain text — try rich content rendering
    if (contentJson) {
      return <RichContentRenderer contentJson={contentJson} />;
    }
    if (content.trim()) {
      return <div className="whitespace-pre-wrap text-sm sm:text-base break-words">{renderContent(content)}</div>;
    }
    return <span className="text-muted-foreground italic">Пустой комментарий</span>;
  }


  // Show processed content
  return <>{renderContent(visibilityResult.processedContent)}</>;
};
