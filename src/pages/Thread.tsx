import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { ImageGallery } from "@/components/ImageGallery";
import { UserBadge } from "@/components/UserBadge";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { HeaderUsername } from "@/components/HeaderUsername";
import { AlertTriangle, Reply, Bell, BellOff, Send, Settings, Eye, EyeOff } from "lucide-react";
import { ModeratorMenu } from "@/components/ModeratorMenu";
import { UserMenu } from "@/components/UserMenu";
import { Input } from "@/components/ui/input";
import { Poll } from "@/components/Poll";

// Tag label helper functions
const getContentTagLabel = (value: string) => {
  const labels: Record<string, string> = {
    anime: 'Аниме',
    games: 'Игры',
    music: 'Музыка',
    movies: 'Фильмы',
    comics: 'Комиксы',
    humor: 'Юмор',
    literature: 'Литература',
    stories: 'Истории'
  };
  return labels[value] || value;
};

const getFormatTagLabel = (value: string) => {
  const labels: Record<string, string> = {
    shitpost: 'Щитпост',
    discussion: 'Обсуждение',
    question: 'Вопрос',
    confession: 'Признание',
    story: 'Рассказ',
    guide: 'Гайд'
  };
  return labels[value] || value;
};

const getAtmosphereTagLabel = (value: string) => {
  const labels: Record<string, string> = {
    serious: 'Серьёзно',
    irony: 'Ирония',
    vent: 'Выплеск',
    doom: 'Тьма'
  };
  return labels[value] || value;
};
import { InlineFormattingToolbar } from "@/components/InlineFormattingToolbar";
import { Maximize2, Minimize2 } from "lucide-react";
import { MentionLink } from "@/components/MentionLink";
import { LinkButton } from "@/components/LinkButton";
import { EmojiInline } from "@/components/EmojiInline";
import { CensorBlur } from "@/components/CensorBlur";
import { UserMentions } from "@/components/UserMentions";
import { ProcessedContent } from "@/components/ProcessedContent";
import { SpoilerText } from "@/components/SpoilerText";
import { EmojiPicker } from "@/components/EmojiPicker";
import { renderBbCode } from "@/utils/bbcodePlugins";
import { PentagramLoader } from "@/components/PentagramLoader";
import { LikeButton } from "@/components/LikeButton";
import { ScrollToBottomButton } from "@/components/ScrollToBottomButton";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/RichTextEditor";
import { getUserPrivacySettings } from "@/lib/imageProcessing";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AttachmentUpload } from "@/components/AttachmentUpload";
import { AttachmentMeta } from "@/utils/mediaUpload";
import type { Thread as ThreadModel, Post as PostModel, UserProfileLite } from "@/types/forum";
import { FileAudio2, FileVideo2, FileText, Image as ImageIcon, SkipBack, SkipForward, Play, Pause } from "lucide-react";
import { MediaPlayer } from "@/components/MediaPlayer";

const parseAttachments = (raw: unknown): AttachmentMeta[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as AttachmentMeta[];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const renderAttachments = (
  attachments: AttachmentMeta[] | undefined | null,
  onImageClick?: (urls: string[], index: number) => void,
  playlistKey?: string
) => {
  if (!attachments || attachments.length === 0) return null;
  const imageUrls = attachments.filter(att => att.type === "image").map(att => att.url);
  const hasManyImages = imageUrls.length > 1;

  return (
    <div className="space-y-3 mt-2">
      {hasManyImages && (
        <div className="flex flex-wrap gap-2 mb-1">
          {imageUrls.map((url, idx) => (
            <div
              key={idx}
              className="w-20 h-20 sm:w-24 sm:h-24 border border-border rounded-md overflow-hidden bg-muted/40 cursor-pointer"
              onClick={() => onImageClick?.(imageUrls, idx)}
            >
              <img src={url} alt={`img-${idx}`} className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}

      {attachments.map((att, idx) => {
        if (att.type === "image" && hasManyImages) return null; // already rendered grid

        if (att.type === "image") {
          const imageIndex = imageUrls.indexOf(att.url);
          return (
            <figure key={idx} className="w-full">
              <img
                src={att.url}
                alt={att.name || `img-${idx}`}
                className="w-full max-h-[70vh] object-contain rounded-lg border border-border bg-muted/30 cursor-pointer"
                onClick={() => onImageClick?.(imageUrls, imageIndex)}
              />
            </figure>
          );
        }
        if (att.type === "video") {
          return (
            <div key={idx} className="flex justify-start pb-3">
              <MediaPlayer
                kind="video"
                poster={att.poster}
                sources={[{ src: att.url, type: att.mime || "video/webm" }]}
                className="max-w-xl sm:max-w-2xl"
              />
            </div>
          );
        }
        if (att.type === "audio") {
          return (
            <div key={idx} className="flex justify-start pb-3">
              <MediaPlayer
                kind="audio"
                sources={[{ src: att.url, type: att.mime || "audio/ogg" }]}
                className="max-w-md"
                playerId={`audio-${att.url}`}
                title={att.name || "Аудио"}
                playlistId={playlistKey}
                playlistIndex={idx}
              />
            </div>
          );
        }
        return (
          <a
            key={idx}
            href={att.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-sm text-primary underline"
          >
            <FileText className="w-4 h-4" />
            <span className="truncate">{att.name || att.url}</span>
            <span className="text-xs text-muted-foreground">{(att.size / 1024 / 1024).toFixed(1)} МБ</span>
          </a>
        );
      })}
    </div>
  );
};

const Thread = () => {
  const { slug, threadId } = useParams();
  const navigate = useNavigate();
  const [thread, setThread] = useState<ThreadModel | null>(null);
  const [posts, setPosts] = useState<PostModel[]>([]);
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");
  const [content, setContent] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [isPrivateMessage, setIsPrivateMessage] = useState(false);
  const [privateRecipientId, setPrivateRecipientId] = useState<string | null>(null);
  const [showImagePreview, setShowImagePreview] = useState(false);
  const [showAttachmentsPreview, setShowAttachmentsPreview] = useState(false);
  const [uploadSuccessMessage, setUploadSuccessMessage] = useState<string | null>(null);
  const [isInputPanelVisible, setIsInputPanelVisible] = useState(true);
  const [isInputPanelCollapsed, setIsInputPanelCollapsed] = useState(false);
  const [isExpandedView, setIsExpandedView] = useState(false);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [pulsingPostId, setPulsingPostId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportingPost, setReportingPost] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [banUserId, setBanUserId] = useState<string | null>(null);
  const [banReason, setBanReason] = useState("");
  const [banDays, setBanDays] = useState("7");
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [showGallery, setShowGallery] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [removeMetadata, setRemoveMetadata] = useState(true);
  const [senderDisplayType, setSenderDisplayType] = useState<'classic' | 'modern'>(() => {
    return (localStorage.getItem('sender-display-type') as any) || 'classic';
  });
  const [pollData, setPollData] = useState<any>(null);
  const shouldStickBottomRef = useRef(false);
  const SCROLL_STICKY_THRESHOLD = 240;

  // Simple BBCode renderer for preview
  const renderPreviewContent = (text: string): React.ReactNode[] => {
    if (!text) return [];

    // Process ||spoiler|| format first (simple inline spoilers)
    let processedText = text;
    const elements: React.ReactNode[] = [];
    let key = 0;

    const spoilerRegex = /\|\|(.*?)\|\|/g;
    let match: RegExpExecArray | null;
    let lastIndex = 0;
    const textSegments: Array<{ type: 'text' | 'spoiler'; content: string }> = [];

    while ((match = spoilerRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        textSegments.push({ type: 'text', content: text.substring(lastIndex, match.index) });
      }
      textSegments.push({ type: 'spoiler', content: match[1] });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      textSegments.push({ type: 'text', content: text.substring(lastIndex) });
    }

    // Render each segment
    for (const segment of textSegments) {
      if (segment.type === 'spoiler') {
        elements.push(
          <span key={`spoiler-${key++}`} className="bg-muted px-1 rounded cursor-pointer hover:bg-muted/80 select-none" title="Спойлер">
            {segment.content}
                    </span>
                  );
      } else {
        // Use @bbob/react for BB code rendering
        const rendered = renderBbCode(segment.content, { keyPrefix: `preview-${key++}` });
        if (rendered) {
          elements.push(rendered);
            }
          }
        }

    return elements;
  };
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<RichTextEditorHandle>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const isNearBottom = useCallback(() => {
    const scrollEl = document.scrollingElement || document.documentElement;
    const distance = scrollEl.scrollHeight - (scrollEl.scrollTop + window.innerHeight);
    return distance <= SCROLL_STICKY_THRESHOLD;
  }, [SCROLL_STICKY_THRESHOLD]);

  const scrollToBottomSmooth = useCallback(() => {
    const scrollEl = document.scrollingElement || document.documentElement;
    window.scrollTo({ top: scrollEl.scrollHeight, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const handleUploadSuccess = (event: CustomEvent) => {
      setUploadSuccessMessage(`Загружено ${event.detail.count} фото`);
      setTimeout(() => setUploadSuccessMessage(null), 3000);
    };

    document.addEventListener('showUploadSuccess', handleUploadSuccess as EventListener);

    return () => {
      document.removeEventListener('showUploadSuccess', handleUploadSuccess as EventListener);
    };
  }, []);

  // Listen for sender display type changes
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'sender-display-type') {
        setSenderDisplayType((e.newValue as 'classic' | 'modern') || 'classic');
      }
    };

    window.addEventListener('storage', handleStorageChange);

    // Also check for changes within the same tab
    const checkDisplayType = () => {
      const current = localStorage.getItem('sender-display-type') as 'classic' | 'modern';
      if (current && current !== senderDisplayType) {
        setSenderDisplayType(current || 'classic');
      }
    };

    // Check periodically for changes within the same tab
    const interval = setInterval(checkDisplayType, 1000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, [senderDisplayType]);

  // Load user's privacy settings
  useEffect(() => {
    const loadPrivacySettings = async () => {
      if (user?.id) {
        const settings = await getUserPrivacySettings(user.id);
        setRemoveMetadata(settings.remove_image_metadata);
      }
    };

    loadPrivacySettings();
  }, [user]);

  // Prevent body scroll when image preview is open
  useEffect(() => {
    if (showImagePreview) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [showImagePreview]);

  // Handle input panel hide/show on mobile scroll
  useEffect(() => {
    // Set initial scroll position
    setLastScrollY(window.scrollY);

    let ticking = false;

    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          const currentScrollY = window.scrollY;

          // Only hide/show on mobile and when not in image preview
          if (window.innerWidth < 768 && !showImagePreview) {
            // Check if there's content in the input
            const hasContent = content.trim().length > 0 || attachments.length > 0;

            // Auto-show when reaching bottom of page
            const isNearBottom = window.innerHeight + currentScrollY >= document.body.scrollHeight - 100;

            if (isNearBottom) {
              setIsInputPanelVisible(true);
            } else if (!hasContent) {
              // Only hide if no content and scrolling down
              if (currentScrollY > lastScrollY && currentScrollY > 100) {
                setIsInputPanelVisible(false);
              } else if (currentScrollY < lastScrollY) {
                setIsInputPanelVisible(true);
              }
            }
            // If has content, always keep visible
          }

          setLastScrollY(currentScrollY);
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [lastScrollY, showImagePreview, content, attachments]);

  useOnlineStatus(user?.id);

  // Keep legacy imageUrls state in sync with attachments (used by existing preview/gallery code)
  useEffect(() => {
    const imgs = attachments.filter(att => att.type === "image").map(att => att.url);
    setImageUrls(imgs);
  }, [attachments]);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user ?? null);
      
      if (session?.user) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", session.user.id);
        
        setIsAdmin(roles?.some(r => r.role === 'admin') || false);
        setIsModerator(roles?.some(r => r.role === 'moderator' || r.role === 'admin') || false);

        // Load current user profile and color
        const { data: profile } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", session.user.id)
          .single();

        if (profile) {
          setCurrentUserUsername(profile.username);
        }

        // Load current user color
        const { data: achievements } = await supabase
          .from("user_achievements")
          .select(`
            achievement_id,
            achievements (
              reward_type,
              reward_value
            )
          `)
          .eq("user_id", session.user.id);

        if (achievements) {
          const colorRewards = achievements
            .filter((a: any) => a.achievements?.reward_type === "username_color")
            .map((a: any) => a.achievements.reward_value);

          const priority = ['purple', 'gold', 'orange', 'red', 'blue', 'green', 'yellow', 'cyan'];
          for (const p of priority) {
            if (colorRewards.includes(p)) {
              setCurrentUserColor(p);
              break;
            }
          }
        }
      }
    };
    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // Track mobile/desktop mode
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const checkSubscription = useCallback(async () => {
    if (!user || !threadId) return;
    
    const { data } = await supabase
      .from("thread_subscriptions")
      .select("id")
      .eq("user_id", user.id)
      .eq("thread_id", threadId)
      .maybeSingle();
    
    setIsSubscribed(!!data);
  }, [threadId, user]);

  const toggleSubscription = async () => {
    if (!user) {
      toast.error("Нужно войти");
      return;
    }

    if (isSubscribed) {
      const { error } = await supabase
        .from("thread_subscriptions")
        .delete()
        .eq("user_id", user.id)
        .eq("thread_id", threadId);
      
      if (!error) {
        setIsSubscribed(false);
        toast.success("Отписались от уведомлений");
      }
    } else {
      const { error } = await supabase
        .from("thread_subscriptions")
        .insert({ user_id: user.id, thread_id: threadId });
      
      if (!error) {
        setIsSubscribed(true);
        toast.success("Подписались на уведомления");
      }
    }
  };

  useEffect(() => {
    // Set up realtime subscription for new posts
    const channel = supabase
      .channel(`thread-${threadId}-posts`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'posts',
          filter: `thread_id=eq.${threadId}`,
        },
        () => {
          loadPosts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [threadId]);

  const loadThread = useCallback(async () => {
    const { data: threadData } = await supabase
      .from("threads")
      .select("*, custom_message")
      .eq("id", threadId)
      .single();

    if (threadData) {
      const { data: board } = await supabase
        .from("boards")
        .select("slug, name, is_rules_board")
        .eq("id", threadData.board_id)
        .single();

      const { data: profile } = await supabase
        .from("profiles")
        .select("username, is_anonymous, avatar_url")
        .eq("id", threadData.user_id!)
        .maybeSingle();

      const attachments = parseAttachments(threadData.attachments);
      const imageUrlsFromAttachments = attachments
        .filter(att => att.type === "image")
        .map(att => att.url);

      setThread({
        ...threadData,
        boards: board!,
        profiles: profile,
        attachments,
        image_urls: threadData.image_urls || imageUrlsFromAttachments,
      });

      // Load poll data if exists
      const { data: poll } = await supabase
        .from('polls')
        .select('*')
        .eq('thread_id', threadData.id)
        .maybeSingle();

      if (poll) {
        // Get user votes for this poll
        let userVotes: string[] = [];
        if (user?.id) {
          const { data: userVote } = await supabase
            .from('poll_votes')
            .select('option_ids')
            .eq('poll_id', poll.id)
            .eq('user_id', user.id)
            .maybeSingle();

          userVotes = userVote?.option_ids || [];
        }

        // Set poll data without results (they will be loaded in Poll component)
        const pollData = {
          ...poll,
          user_votes: userVotes
        };

        setPollData(pollData);
      }

      // Track thread visit for achievements
      if (user) {
        const hasCustomMessage = threadData.custom_message && threadData.custom_message.trim().length > 0;
        await supabase
          .from('thread_custom_message_visits')
          .upsert({
            user_id: user.id,
            thread_id: threadData.id,
            has_custom_message: hasCustomMessage
          }, {
            onConflict: 'user_id,thread_id'
          });
      }
    }
  }, [navigate, slug, threadId, user]);

  const normalizePost = useCallback(async (post: any): Promise<PostModel> => {
    const { data: profile } = await supabase
      .from("profiles")
      .select("username, is_anonymous, avatar_url, id")
      .eq("id", post.user_id!)
      .maybeSingle();

    const attachments = parseAttachments(post.attachments);

    let imageUrls: string[] = [];
    if (Array.isArray(post.image_urls)) {
      imageUrls = post.image_urls;
    } else if (typeof post.image_urls === "string") {
      try {
        imageUrls = JSON.parse(post.image_urls);
      } catch {
        imageUrls = [];
      }
    } else if (attachments.length > 0) {
      imageUrls = attachments.filter(att => att.type === "image").map(att => att.url);
    } else if (post.image_url) {
      imageUrls = [post.image_url];
    }

    return {
      ...post,
      profiles: profile as UserProfileLite | null,
      imageUrls,
      attachments,
    } as PostModel;
  }, []);

  const fetchPostWithProfile = useCallback(async (postId: string) => {
    const { data: postData, error } = await supabase
      .from("posts")
      .select("*")
      .eq("id", postId)
      .single();
    if (error || !postData) return null;
    return normalizePost(postData);
  }, [normalizePost]);

  const mergePostIntoList = useCallback((list: PostModel[], post: PostModel) => {
    const idx = list.findIndex(p => p.id === post.id);
    const next = idx >= 0 ? [...list.slice(0, idx), post, ...list.slice(idx + 1)] : [...list, post];
    next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    return next;
  }, []);

  const handleAIReply = useCallback(async (triggerPost: any) => {
    try {
      // Get the post that was replied to (this is the prompt)
      const { data: promptPost } = await supabase
        .from("posts")
        .select("content")
        .eq("id", triggerPost.reply_to)
        .single();

      if (!promptPost) return;

      console.log('[AI] Triggering AI reply to:', promptPost.content);
      
      // Show notification that AI is processing
      toast.info("🤖 AI генерирует ответ...", {
        duration: 3000,
      });

      // Call AI edge function
      const { error } = await supabase.functions.invoke('ai-reply', {
        body: {
          threadId: threadId,
          replyToId: triggerPost.reply_to,
          promptContent: promptPost.content
        }
      });

      if (error) {
        console.error('[AI] Error calling AI function:', error);
        toast.error("❌ Ошибка AI");
      } else {
        toast.success("✅ AI ответил");
      }
    } catch (error) {
      console.error('[AI] Error in handleAIReply:', error);
      toast.error("❌ Ошибка AI");
    }
  }, [threadId]);

  const loadPosts = useCallback(async () => {
    const { data: postsData } = await supabase
      .from("posts")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    if (postsData) {
      const postsWithProfiles = await Promise.all(postsData.map(normalizePost));
      setPosts(postsWithProfiles);

      if (postsData.length > 0) {
        const latestPost = postsData[postsData.length - 1];
        if (latestPost.content.includes('@AI') && latestPost.reply_to) {
          await handleAIReply(latestPost);
        }
      }
    }
  }, [handleAIReply, normalizePost, threadId]);

  useEffect(() => {
    const loadAll = async () => {
      setPageLoading(true);
      await Promise.all([
        loadThread(),
        loadPosts(),
        checkSubscription(),
      ]);
      setPageLoading(false);
    };
    loadAll();
  }, [threadId, user, loadPosts, loadThread, checkSubscription]);

  // Keep view anchored when мы уже у низа или запланировали при отправке своего поста
  useEffect(() => {
    if (posts.length === 0) return;
    if (shouldStickBottomRef.current || isNearBottom()) {
      requestAnimationFrame(scrollToBottomSmooth);
      shouldStickBottomRef.current = false;
    }
  }, [posts, isNearBottom, scrollToBottomSmooth]);

  // Realtime subscription for posts changes (single channel, local merge)
  useEffect(() => {
    if (!threadId) return;

    const channel = supabase
      .channel(`posts-${threadId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'posts',
          filter: `thread_id=eq.${threadId}`,
        },
        async (payload) => {
          const shouldStick = shouldStickBottomRef.current || isNearBottom();

          if (payload.eventType === 'INSERT') {
            const fresh = await fetchPostWithProfile(payload.new.id);
            if (fresh) {
              setPosts((current) => mergePostIntoList(current, fresh));
              if (shouldStick) scrollToBottomSmooth();
            }
          } else if (payload.eventType === 'UPDATE') {
            const fresh = await fetchPostWithProfile(payload.new.id);
            if (fresh) {
              setPosts((current) => mergePostIntoList(current, fresh));
            }
          } else if (payload.eventType === 'DELETE') {
            setPosts((currentPosts) => currentPosts.filter(post => post.id !== payload.old.id));
          }

          shouldStickBottomRef.current = false;
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchPostWithProfile, isNearBottom, mergePostIntoList, scrollToBottomSmooth, threadId]);

  const handleSubmitPost = async (e?: React.FormEvent) => {
    e?.preventDefault();

    if (!user) {
      toast.error("Нужно войти для ответа");
      navigate("/auth");
      return;
    }

    if (!content.trim()) {
      toast.error("Напишите что-нибудь");
      return;
    }

    // Check if only admin can post (rules board)
    if (thread?.boards.is_rules_board && !isAdmin) {
      toast.error("Только администраторы могут писать на этой доске");
      return;
    }

    setLoading(true);
    try {
      shouldStickBottomRef.current = isNearBottom();
      // Convert array to JSON for storage, or use first image for backward compatibility
      const imageUrlsFromAttachments = attachments
        .filter(att => att.type === "image")
        .map(att => att.url);
      const imageUrlForDb = imageUrlsFromAttachments[0] || null;
      const imageUrlsJson = imageUrlsFromAttachments.length > 0 ? imageUrlsFromAttachments : null;

      const { error } = await supabase.from("posts").insert({
        thread_id: threadId,
        user_id: user.id,
        content: content.trim(),
        image_url: imageUrlForDb, // Keep for backward compatibility
        image_urls: imageUrlsJson, // New field for multiple images
        attachments: attachments.length > 0 ? attachments : null,
        reply_to: replyingTo,
        is_private: isPrivateMessage,
        private_recipient_id: isPrivateMessage ? privateRecipientId : null,
      });

      if (error) {
        toast.error("Ошибка отправки");
        return;
      }

      setContent("");
      setImageUrls([]);
      setAttachments([]);
      setReplyingTo(null);
      setIsPrivateMessage(false);
      setPrivateRecipientId(null);
    } catch (err) {
      console.error("handleSubmitPost failed:", err);
      toast.error("Ошибка отправки");
    } finally {
      setLoading(false);
    }
  };

  const handleReport = async (postId: string | null, isThread: boolean) => {
    if (!user) {
      toast.error("Нужно войти для отправки жалоб");
      return;
    }

    if (!reportReason.trim()) {
      toast.error("Укажите причину жалобы");
      return;
    }

    const { error } = await supabase.from("reports").insert({
      reporter_id: user.id,
      reported_post_id: isThread ? null : postId,
      reported_thread_id: isThread ? threadId : null,
      reason: reportReason.trim(),
    });

    if (error) {
      toast.error("Ошибка отправки жалобы");
    } else {
      toast.success("Жалоба отправлена");
      setReportReason("");
      setReportingPost(null);
    }
  };

  const handleNowPlayingControl = (direction: 'prev' | 'next' | 'toggle') => {
    if (!nowPlaying) return;
    const keys = Array.from(audioMapRef.current.keys());
    const currentIndex = keys.findIndex(k => k === nowPlaying.key);
    if (currentIndex === -1) return;

    const playKey = (key: string) => {
      const entry = audioMapRef.current.get(key);
      if (!entry?.inst) return;
      try {
        entry.inst.play();
        setNowPlaying({ key, title: entry.title, instance: entry.inst });
      } catch (e) {
        console.error(e);
      }
    };

    if (direction === 'toggle') {
      const entry = audioMapRef.current.get(nowPlaying.key);
      if (!entry?.inst) return;
      if (entry.inst.playing) entry.inst.pause();
      else entry.inst.play();
      return;
    }

    let nextIdx = currentIndex;
    if (direction === 'next') nextIdx = (currentIndex + 1) % keys.length;
    if (direction === 'prev') nextIdx = (currentIndex - 1 + keys.length) % keys.length;
    playKey(keys[nextIdx]);
  };

  const handleDeletePost = async (postId: string) => {
    const { error } = await supabase
      .from("posts")
      .delete()
      .eq("id", postId);
    
    if (error) {
      toast.error("Ошибка удаления поста");
    } else {
      toast.success("Пост удален");
      loadPosts();
    }
  };

  const handleDeleteThread = async () => {
    const { error } = await supabase
      .from("threads")
      .delete()
      .eq("id", threadId);
    
    if (error) {
      toast.error("Ошибка удаления треда");
    } else {
      toast.success("Тред удален");
      navigate(`/${slug}`);
    }
  };

  const handleEditPost = async () => {
    if (!editContent.trim() || !editingPostId) return;

    const { error } = await supabase
      .from("posts")
      .update({ content: editContent.trim() })
      .eq("id", editingPostId);
    
    if (error) {
      toast.error("Ошибка изменения поста");
    } else {
      toast.success("Пост изменен");
      setEditingPostId(null);
      setEditContent("");
      loadPosts();
    }
  };

  const handleBanUser = async (isPermanent: boolean) => {
    if (!banReason.trim() || !banUserId) return;

    const expiresAt = isPermanent 
      ? null 
      : new Date(Date.now() + parseInt(banDays) * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await supabase
      .from("user_bans")
      .insert({
        user_id: banUserId,
        banned_by: user.id,
        reason: banReason.trim(),
        expires_at: expiresAt,
        is_permanent: isPermanent,
      });

    if (error) {
      toast.error("Ошибка выдачи бана");
    } else {
      toast.success(isPermanent ? "Пользователь забанен навсегда" : `Пользователь забанен на ${banDays} дней`);
      setBanUserId(null);
      setBanReason("");
    }
  };

  const handleFormatText = (prefix: string, suffix: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = content.substring(start, end);
    const newText =
      content.substring(0, start) +
      prefix +
      selectedText +
      suffix +
      content.substring(end);

    setContent(newText);

    // Restore cursor position after formatting
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, end + prefix.length);
    }, 0);
  };

  const handleEmojiSelect = (emojiCode: string) => {
    // Insert into editor at caret. emojiCode is already like :name:
    editorRef.current?.insertText(emojiCode);
  };

  const renderContent = (text: string) => {
    const elements: React.ReactNode[] = [];
    let currentIndex = 0;
    let key = 0;

    // Process spoilers first
    const spoilerRegex = /\|\|(.*?)\|\|/g;
    let match;
    let lastIndex = 0;

    const processTextSegment = (segment: string) => {
      // Process bold, italic, mentions, URLs and emojis
      return segment.split(/(\*\*.*?\*\*|\*.*?\*|@\w+|https?:\/\/[^\s]+|:[^:\s]+:)/g).map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={`${key++}-${i}`} className="font-bold">
              {part.slice(2, -2)}
            </strong>
          );
        } else if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
          return (
            <em key={`${key++}-${i}`} className="italic">
              {part.slice(1, -1)}
            </em>
          );
        } else if (part.startsWith('@')) {
          const username = part.substring(1); // Remove @ symbol
          return (
            <MentionLink key={`${key++}-${i}`} username={username} />
          );
        } else if (part.match(/^https?:\/\/[^\s]+$/)) {
          return (
            <LinkButton key={`${key++}-${i}`} url={part} />
          );
        } else if (part.startsWith(':') && part.endsWith(':') && part.length > 2) {
          // Emoji code like :smile:
          const emojiCode = part.slice(1, -1); // Remove colons
          return (
            <EmojiInline key={`${key++}-${i}`} code={emojiCode} />
          );
        }
        return part;
      });
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

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Вышли");
  };

  // Don't show fullscreen loader for pageLoading - let content loader handle it
  if (!thread) {
    return (
      <div className="bg-background flex items-center justify-center min-h-screen">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  const canPost = user && (!thread.boards.is_rules_board || isAdmin);

  return (
    <>
    <main className="max-w-5xl mx-auto p-2 sm:p-4 pb-24 sm:pb-28">
        <div className="relative">
        {pageLoading && (
            <div className="absolute inset-0 bg-card/90 backdrop-blur-sm flex items-center justify-center z-10 rounded-lg">
            <PentagramLoader size="lg" />
          </div>
        )}
            <div className="mb-4 flex justify-between items-center">
          <Link to={`/${slug}`} className="text-primary hover:text-primary/80 font-medium text-sm transition-colors">
            ← Назад к доске
          </Link>
          {user && (
            <Button
              variant="outline"
              size="sm"
              onClick={toggleSubscription}
              className="hover:bg-primary/10 hover:text-primary hover:border-primary/50 transition-colors"
            >
              {isSubscribed ? (
                <>
                  <BellOff className="h-4 w-4 mr-2" />
                  Отключить уведомления
                </>
              ) : (
                <>
                  <Bell className="h-4 w-4 mr-2" />
                  Уведомлять о новых постах
                </>
              )}
            </Button>
          )}
        </div>

        <div className="border border-border bg-card p-3 sm:p-4 mb-4">
          <div className="flex justify-between items-start mb-2 gap-2">
            <h1 className="text-xl sm:text-2xl font-bold break-words flex-1">{thread.title}</h1>
            <div className="flex gap-1 flex-shrink-0">
              <LikeButton
                postId={thread.id}
                currentUserId={user?.id || null}
                postAuthorId={thread.user_id}
                isThread={true}
              />
              {isModerator && thread.user_id && (
                <ModeratorMenu
                  type="thread"
                  onDelete={handleDeleteThread}
                  onBan={() => setBanUserId(thread.user_id!)}
                />
              )}
              {user && (
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="hover:bg-white/20 hover:text-white transition-colors">
                      <AlertTriangle className="h-4 w-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-background border-border">
                    <DialogHeader>
                      <DialogTitle>Пожаловаться на тред</DialogTitle>
                    </DialogHeader>
                    <Textarea
                      placeholder="Причина жалобы..."
                      value={reportReason}
                      onChange={(e) => setReportReason(e.target.value)}
                      rows={3}
                    />
                    <Button onClick={() => handleReport(null, true)}>
                      Отправить жалобу
                    </Button>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </div>
          
          <div className="bg-post-header p-2 sm:p-3 border border-border">
            <div className="text-xs text-muted-foreground mb-2 flex-wrap">
              {senderDisplayType === 'modern' ? (
                <div className="flex items-start gap-2">
                  <img
                    src={thread.profiles?.avatar_url || '/placeholder.svg'}
                    alt="Avatar"
                    className="w-12 h-12 rounded-full object-cover border border-border"
                  />
                  <div>
                    <UserBadge
                      userId={thread.user_id}
                      username={thread.profiles?.username || "Аноним"}
                      isAnonymous={thread.profiles?.is_anonymous}
                      showOutline={false}
                    />
                    <div className="text-muted-foreground">
                      {formatDistanceToNow(new Date(thread.created_at), {
                        locale: ru,
                        addSuffix: true,
                      })}
                    </div>
                    <div className="font-mono text-primary text-[10px]">#{thread.id.slice(0, 8)}</div>
                  </div>
                </div>
              ) : (
                <>
                  <span className="font-mono text-primary">#{thread.id.slice(0, 8)}</span>
                  {" · "}
                  <UserBadge
                    userId={thread.user_id}
                    username={thread.profiles?.username || "Аноним"}
                    isAnonymous={thread.profiles?.is_anonymous}
                    showOutline={false}
                  />
                  {" · "}
                  {formatDistanceToNow(new Date(thread.created_at), {
                    locale: ru,
                    addSuffix: true,
                  })}
                </>
              )}
            </div>
            {(((thread as any).image_urls || (thread as any).imageUrls) && ((thread as any).image_urls || (thread as any).imageUrls).length > 0) && (
              <div className="mb-2 flex flex-wrap gap-2">
                {((thread as any).image_urls || (thread as any).imageUrls).map((img: string, idx: number) => (
                  <img
                    key={idx}
                    src={img}
                    alt={`Thread image ${idx + 1}`}
                    className="max-w-32 max-h-32 border border-border cursor-pointer rounded"
                    onClick={() => {
                      setGalleryImages((thread as any).image_urls || (thread as any).imageUrls);
                      setGalleryIndex(idx);
                      setShowGallery(true);
                    }}
                  />
                ))}
              </div>
            )}
  {renderAttachments((thread as any).attachments, (urls, idx) => {
    setGalleryImages(urls);
    setGalleryIndex(idx);
    setShowGallery(true);
  }, thread?.id || threadId || slug || "thread")}

            <p className="whitespace-pre-wrap text-sm sm:text-base break-words">
              <ProcessedContent
                content={thread.content}
                currentUserId={user?.id || null}
                isAdmin={isAdmin}
                currentUsername={currentUserUsername}
                currentUserColor={currentUserColor}
                postAuthorId={thread.user_id}
                authorUsername={thread.profiles?.username}
              />
            </p>

            {/* Thread tags */}
            {((thread as any).tags) && (
              <div className="flex flex-wrap gap-1 mt-3">
                {/* Ephemeral indicator */}
                {(thread as any).ephemeral_type && (
                  <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-800 rounded-full border border-orange-200">
                    {(thread as any).ephemeral_type === 'time'
                      ? `${(thread as any).ephemeral_value}ч`
                      : `${(thread as any).ephemeral_value}сообщ.`
                    }
                  </span>
                )}

                {/* Ephemeral tag */}
                {(thread as any).ephemeral_type && (
                  <button
                    onClick={() => navigate('/b?flag=ephemeral')}
                    className="inline-block px-2 py-0.5 text-xs bg-orange-500/10 text-orange-700 rounded-full
                             hover:bg-orange-500/20 hover:text-orange-800 transition-colors duration-200
                             border border-orange-500/20 hover:border-orange-500/40"
                  >
                    Временный
                  </button>
                )}

                {/* Content tag */}
                {(thread as any).tags.content && (
                  <button
                    onClick={() => navigate(`/b?content=${(thread as any).tags.content}`)}
                    className="inline-block px-2 py-0.5 text-xs bg-blue-500/10 text-blue-600 rounded-full
                             hover:bg-blue-500/20 hover:text-blue-700 transition-colors duration-200
                             border border-blue-500/20 hover:border-blue-500/40"
                  >
                    {getContentTagLabel((thread as any).tags.content)}
                  </button>
                )}

                {/* Format tag */}
                {(thread as any).tags.format && (
                  <button
                    onClick={() => navigate(`/b?format=${(thread as any).tags.format}`)}
                    className="inline-block px-2 py-0.5 text-xs bg-green-500/10 text-green-600 rounded-full
                             hover:bg-green-500/20 hover:text-green-700 transition-colors duration-200
                             border border-green-500/20 hover:border-green-500/40"
                  >
                    {getFormatTagLabel((thread as any).tags.format)}
                  </button>
                )}

                {/* Atmosphere tag */}
                {(thread as any).tags.atmosphere && (
                  <button
                    onClick={() => navigate(`/b?atmosphere=${(thread as any).tags.atmosphere}`)}
                    className="inline-block px-2 py-0.5 text-xs bg-purple-500/10 text-purple-600 rounded-full
                             hover:bg-purple-500/20 hover:text-purple-700 transition-colors duration-200
                             border border-purple-500/20 hover:border-purple-500/40"
                  >
                    {getAtmosphereTagLabel((thread as any).tags.atmosphere)}
                  </button>
                )}

                {/* Night tag */}
                {(thread as any).tags.flag === 'night' && (
                  <span className="inline-block px-2 py-0.5 text-xs bg-blue-500/10 text-blue-600 rounded-full border border-blue-500/20">
                    Ночной
                  </span>
                )}
              </div>
            )}

          </div>
          </div>
        </div>

        <div className="space-y-4 mb-4 relative">
          {pageLoading && (
            <div className="absolute inset-0 bg-card/90 backdrop-blur-sm flex items-center justify-center z-10 rounded-lg">
              <PentagramLoader size="lg" />
            </div>
          )}

          {/* Poll */}
          {pollData && (
            <Poll
              poll={pollData}
              threadId={threadId}
              currentUserId={user?.id || null}
              isPageLoading={pageLoading}
            />
          )}

          {posts.map((post) => (
            <div
              key={post.id}
              id={`post-${post.id}`}
              className={`bg-post-header p-2 sm:p-3 border border-border transition-all duration-500 ${
                pulsingPostId === post.id ? 'ring-1 ring-primary/60' : ''
              }`}
            >
              <div className="flex justify-between items-start gap-2">
                <div className="text-xs text-muted-foreground mb-2 flex-wrap flex-1">
                  {senderDisplayType === 'modern' ? (
                    <div className="flex items-start gap-2">
                      <img
                        src={post.profiles?.avatar_url || '/placeholder.svg'}
                        alt="Avatar"
                        className="w-12 h-12 rounded-full object-cover border border-border"
                      />
                      <div>
                        <UserBadge
                          userId={post.user_id}
                          username={post.profiles?.username || "Аноним"}
                          isAnonymous={post.profiles?.is_anonymous}
                          showOutline={false}
                        />
                        <div className="text-muted-foreground">
                          {formatDistanceToNow(new Date(post.created_at), {
                            locale: ru,
                            addSuffix: true,
                          })}
                        </div>
                        <div className="font-mono text-primary text-[10px]">#{post.id.slice(0, 8)}</div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="font-mono text-primary">#{post.id.slice(0, 8)}</span>
                      {" · "}
                      <UserBadge
                        userId={post.user_id}
                        username={post.profiles?.username || "Аноним"}
                        isAnonymous={post.profiles?.is_anonymous}
                        showOutline={false}
                      />
                      {" · "}
                      {formatDistanceToNow(new Date(post.created_at), {
                        locale: ru,
                        addSuffix: true,
                      })}
                    </>
                  )}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {user && post.user_id === user.id && (
                    <UserMenu
                      type="post"
                      onEdit={() => {
                        setEditingPostId(post.id);
                        setEditContent(post.content);
                      }}
                      onDelete={() => handleDeletePost(post.id)}
                      onReport={() => setReportingPost(post.id)}
                    />
                  )}
                  {isModerator && post.user_id && post.user_id !== user?.id && (
                    <ModeratorMenu
                      type="post"
                      onDelete={() => handleDeletePost(post.id)}
                      onEdit={() => {
                        setEditingPostId(post.id);
                        setEditContent(post.content);
                      }}
                      onBan={() => setBanUserId(post.user_id!)}
                    />
                  )}
                  {user && post.user_id !== user.id && !isModerator && (
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="hover:bg-primary/10 hover:text-primary transition-colors"
                          onClick={() => setReportingPost(post.id)}
                        >
                          <AlertTriangle className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="bg-background border-border">
                        <DialogHeader>
                          <DialogTitle>Пожаловаться на пост</DialogTitle>
                        </DialogHeader>
                        <Textarea
                          placeholder="Причина жалобы..."
                          value={reportReason}
                          onChange={(e) => setReportReason(e.target.value)}
                          rows={3}
                        />
                        <Button onClick={() => handleReport(post.id, false)}>
                          Отправить жалобу
                        </Button>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
              </div>
              {post.reply_to && (
                <a
                  href={`#post-${post.reply_to}`}
                  className="text-xs hover:text-primary/80 font-medium hover:underline block mb-1 transition-colors cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    setPulsingPostId(post.reply_to);
                    setTimeout(() => setPulsingPostId(null), 800);
                    const element = document.getElementById(`post-${post.reply_to}`);
                    if (element) {
                      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                  }}
                >
                  <span className="text-primary mr-1">→</span>Ответ на #{post.reply_to.slice(0, 8)}
                </a>
              )}
              {renderAttachments(((post as any).attachments && (post as any).attachments.length > 0)
                ? (post as any).attachments
                : ((post as any).imageUrls || []).map((url: string) => ({ url, type: "image", mime: "image/*", name: url, size: 0 })), (urls, idx) => {
                setGalleryImages(urls);
                setGalleryIndex(idx);
                setShowGallery(true);
              }, thread?.id || threadId || slug || "thread")}
              {editingPostId === post.id ? (
                <div className="space-y-2">
                  <Textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={4}
                    className="text-sm"
                  />
                  <div className="flex gap-2">
                    <Button onClick={handleEditPost} size="sm">Сохранить</Button>
                    <Button 
                      onClick={() => {
                        setEditingPostId(null);
                        setEditContent("");
                      }} 
                      variant="secondary" 
                      size="sm"
                    >
                      Отмена
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-sm sm:text-base break-words">
                  {post.is_private && user?.id !== post.user_id && user?.id !== post.private_recipient_id ? (
                    <span className="text-muted-foreground italic">Скрытый контент</span>
                  ) : (
                    <ProcessedContent
                      content={post.content}
                      currentUserId={user?.id || null}
                      isAdmin={isAdmin}
                      currentUsername={currentUserUsername}
                      currentUserColor={currentUserColor}
                      postAuthorId={post.user_id}
                      authorUsername={post.profiles?.username}
                    />
                  )}
                </p>
              )}

              {/* Нижний блок с действиями */}
              <div className="flex justify-end items-center gap-1">
                {user && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="hover:bg-primary/10 hover:text-primary transition-colors h-6 w-6 p-0"
                    onClick={() => {
                      setReplyingTo(post.id);
                      setPrivateRecipientId(post.user_id);
                      setIsInputPanelVisible(true);
                      // Focus textarea after a short delay to ensure panel is visible
                      setTimeout(() => {
                        textareaRef.current?.focus();
                      }, 300);
                    }}
                  >
                    <Reply className="h-4 w-4" />
                  </Button>
                )}
                <LikeButton
                  postId={post.id}
                  currentUserId={user?.id || null}
                  postAuthorId={post.user_id}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Ban user dialog */}
        <Dialog open={!!banUserId} onOpenChange={(open) => !open && setBanUserId(null)}>
          <DialogContent className="bg-background border-border">
            <DialogHeader>
              <DialogTitle>Забанить пользователя</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Textarea
                placeholder="Причина бана..."
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                rows={3}
              />
              <Input
                type="number"
                placeholder="Дней"
                value={banDays}
                onChange={(e) => setBanDays(e.target.value)}
                min="1"
              />
              <div className="flex gap-2 flex-wrap">
                <Button 
                  onClick={() => handleBanUser(false)}
                  variant="destructive"
                  size="sm"
                >
                  Забанить на {banDays} дней
                </Button>
                <Button 
                  onClick={() => handleBanUser(true)}
                  variant="destructive"
                  size="sm"
                >
                  Забанить навсегда
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {canPost ? (
          <div className={`fixed bottom-2 sm:bottom-6 left-0 right-0 z-50 px-4 max-w-full overflow-hidden transition-transform duration-300 ease-in-out ${
            isInputPanelVisible ? 'translate-y-0' : 'translate-y-full'
          }`}>
            <div className="max-w-2xl mx-auto">
              {uploadSuccessMessage && (
                <div className="mb-2 p-3 bg-background/40 backdrop-blur-sm border border-border/30 rounded-2xl text-sm text-foreground font-medium text-center">
                  {uploadSuccessMessage}
                </div>
              )}

              {/* Превью вложений над формой */}
              {(attachments.length > 0 || imageUrls.length > 0) && !isExpandedView && (
                <div className="mb-3 bg-card/70 border border-border/50 rounded-xl p-3">
                  <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                    {imageUrls.map((url, idx) => (
                      <div
                        key={url}
                        className="group relative w-16 h-16 sm:w-20 sm:h-20 rounded-lg border border-border bg-muted/60 overflow-hidden flex items-center justify-center cursor-pointer"
                        onClick={() => {
                          setGalleryImages(imageUrls);
                          setGalleryIndex(idx);
                          setShowGallery(true);
                        }}
                      >
                        <img src={url} alt={`preview-${idx}`} className="max-h-full max-w-full object-cover" />
                        <button
                          className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 text-white text-[10px] opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAttachments((prev) => prev.filter((att) => att.type !== 'image' || att.url !== url));
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {attachments
                      .filter((att) => att.type !== "image")
                      .map((att, idx) => {
                        const kind = (att.mime || att.type || "").split("/")[0] || att.type || "file";
                        const label = (att.name || att.url || "").split(".").pop()?.slice(0, 4) || kind.slice(0, 4);
                        return (
                          <div
                            key={`${att.url}-${idx}`}
                            className="group relative w-16 h-16 sm:w-20 sm:h-20 rounded-lg border border-border bg-muted/60 flex flex-col items-center justify-center gap-1 overflow-hidden"
                            title={att.name || att.url}
                          >
                            <span className="text-[10px] uppercase tracking-wide text-foreground/60 bg-background/60 px-2 py-1 rounded-full">
                              {label}
                            </span>
                            <span className="text-[10px] text-center px-1 truncate w-full text-muted-foreground">
                              {att.name || att.url}
                            </span>
                            <button
                              className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 text-white text-[10px] opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition"
                              onClick={(e) => {
                                e.stopPropagation();
                                setAttachments((prev) => prev.filter((_, i) => i !== idx));
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Mini panel for collapsed state */}
              {isInputPanelCollapsed && (
                <div className="mx-auto max-w-xs">
                  <div className="bg-background/60 backdrop-blur-md border border-border/40 rounded-2xl shadow-xl p-2 flex justify-center">
                    <button
                      type="button"
                      onClick={() => setIsInputPanelCollapsed(false)}
                      className="w-8 h-8 rounded-full bg-background/80 hover:bg-background border border-border/50 flex items-center justify-center transition-colors"
                    >
                      <span className="text-sm">
                        ^
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* Full panel for expanded state */}
              {!isInputPanelCollapsed && (
                <div className="max-w-2xl mx-auto relative">
                  {/* Collapse button - only on desktop */}
                  <button
                    type="button"
                    onClick={() => setIsInputPanelCollapsed(true)}
                    className="hidden sm:flex absolute top-2 right-2 z-10 w-8 h-8 rounded-full bg-background/80 hover:bg-background border border-border/50 items-center justify-center transition-colors"
                  >
                    <span className="text-sm transform rotate-180">
                      ^
                    </span>
                  </button>

                  <form
                    onSubmit={handleSubmitPost}
                    className={`bg-background/60 backdrop-blur-md border border-border/40 rounded-2xl shadow-xl transition-all duration-300 ${
                      isExpandedView
                        ? isMobile
                          ? 'p-4 space-y-3 max-h-[80vh] overflow-y-auto'
                          : 'p-6 space-y-4'
                        : 'p-4 space-y-3'
                    }`}
                  >
                {/* Header with reply info */}
                {replyingTo && (
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Ответ на #{replyingTo.slice(0, 8)}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setReplyingTo(null)}
                        className="h-6 w-6 p-0 text-xs"
                    >
                      ✕
                    </Button>
                    </div>
                  </div>
                )}

                {isExpandedView && (
                  <div className="space-y-3 sm:space-y-4">
                    {/* Header with preview toggle */}
                    <div className="flex items-center justify-between pb-2 border-b border-border/50">
                      <label className="text-xs sm:text-sm font-medium">Предпросмотр</label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs shrink-0"
                        onClick={() => setIsExpandedView(false)}
                        title="Скрыть предпросмотр"
                      >
                        <Minimize2 className="h-3 w-3 mr-1" />
                        <span className="hidden sm:inline">Скрыть</span>
                      </Button>
                    </div>
                    
                    {/* Formatting toolbar - only in preview mode */}
                    <div>
                      <InlineFormattingToolbar editorRef={editorRef} />
                    </div>
                    
                    {/* Preview */}
                    <div className="bg-card border border-border rounded-lg p-2 sm:p-3 min-h-[150px] sm:min-h-[200px] max-h-[250px] sm:max-h-[300px] overflow-y-auto">
                      <div className="text-xs sm:text-sm break-words">
                          {content ? (
                            renderPreviewContent(content)
                          ) : (
                            <span className="text-muted-foreground">Начните писать сообщение...</span>
                          )}
                        </div>
                        {imageUrls.length > 0 && (
                          <div className="mt-3 grid grid-cols-3 gap-2">
                            {imageUrls.map((url, index) => (
                              <img
                                key={index}
                                src={url}
                                alt={`Preview ${index + 1}`}
                                className="w-full h-16 object-cover rounded border border-border"
                              />
                            ))}
                          </div>
                        )}
                      </div>
                  </div>
                )}

                <div className={`flex gap-1.5 sm:gap-2 ${isExpandedView ? 'items-start' : 'items-end'}`}>
                  {!isExpandedView && (
                    <>
                      <div className="flex flex-col gap-1.5 sm:gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                          className="h-8 w-8 sm:h-10 sm:w-10 rounded-xl shrink-0"
                          onClick={() => setIsExpandedView(true)}
                          title="Показать предпросмотр"
                  >
                          <Maximize2 className="h-4 w-4 sm:h-5 sm:w-5" />
                  </Button>
                        <AttachmentUpload value={attachments} onChange={setAttachments} maxFiles={8} />
                      </div>
                    </>
                  )}
                  <div
                    className="flex-1 min-w-0"
                    onFocusCapture={() => setIsInputPanelVisible(true)}
                  >
                    <RichTextEditor
                      ref={editorRef}
                      value={content}
                      onChange={setContent}
                      onSubmit={() => handleSubmitPost()}
                      placeholder="Напишите сообщение…"
                      className={`text-sm sm:text-base ${isExpandedView ? 'min-h-[200px] sm:min-h-[300px]' : 'min-h-[60px] sm:min-h-[80px]'}`}
                    />
                  </div>
                  <UserMentions
                    content={content}
                    onContentChange={setContent}
                    onUserSelect={() => {}}
                    textareaRef={textareaRef}
                    getContent={() => editorRef.current?.getValue() ?? content}
                    setContent={(v) => setContent(v)}
                    getCursorPos={() => editorRef.current?.getSelectionStart() ?? 0}
                    getCursorRect={() => editorRef.current?.getCursorRect() ?? null}
                    getEditorEl={() => editorRef.current?.getElement() ?? null}
                    focusInput={() => editorRef.current?.focus()}
                    setCursorPos={(pos) => editorRef.current?.setSelectionStart(pos)}
                  />
                  <EmojiPicker
                    onEmojiSelect={handleEmojiSelect}
                    triggerRef={emojiButtonRef}
                  >
                    <Button
                      ref={emojiButtonRef}
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 sm:h-10 sm:w-10 rounded-xl shrink-0 hover:bg-primary/10"
                      title="Эмодзи"
                    >
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-muted-foreground"
                      >
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
                        <line x1="9" y1="9" x2="9.01" y2="9"></line>
                        <line x1="15" y1="9" x2="15.01" y2="9"></line>
                      </svg>
                    </Button>
                  </EmojiPicker>
                  {replyingTo && (
                    <Button
                      type="button"
                      variant={isPrivateMessage ? "default" : "ghost"}
                      size="icon"
                      className="h-8 w-8 sm:h-10 sm:w-10 rounded-xl shrink-0"
                      onClick={() => setIsPrivateMessage(!isPrivateMessage)}
                      title={isPrivateMessage ? "Отправить как обычное сообщение" : "Отправить как скрытое сообщение"}
                    >
                      {isPrivateMessage ? <EyeOff className="h-4 w-4 sm:h-5 sm:w-5" /> : <Eye className="h-4 w-4 sm:h-5 sm:w-5" />}
                    </Button>
                  )}
                  <Button
                    type="submit"
                    disabled={loading || (!content.trim() && attachments.length === 0)}
                    size="icon"
                    className="h-8 w-8 sm:h-10 sm:w-10 rounded-xl shrink-0"
                  >
                    <Send className="h-4 w-4 sm:h-5 sm:w-5" />
                  </Button>
                </div>
              </form>
                </div>
              )}

              {/* Image Preview Modal */}
              {showImagePreview && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm">
                  <div className="fixed bottom-0 left-0 right-0 bg-background border-t border-border rounded-t-2xl max-h-[80vh] overflow-hidden">
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold">
                          Приложенные фото ({imageUrls.length})
                        </h3>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowImagePreview(false)}
                        >
                          ✕
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[55vh] overflow-y-auto">
                        {imageUrls.map((url, index) => (
                          <div key={index} className="relative rounded-lg border border-border bg-muted/40 aspect-square flex items-center justify-center overflow-hidden">
                            <img
                              src={url}
                              alt={`Фото ${index + 1}`}
                              className="max-h-full max-w-full object-contain"
                              onClick={() => {
                                setGalleryImages(imageUrls);
                                setGalleryIndex(index);
                                setShowGallery(true);
                              }}
                            />
                            <Button
                              variant="destructive"
                              size="sm"
                              className="absolute top-1 right-1 h-6 w-6 p-0"
                              onClick={() => {
                                setAttachments(prev => prev.filter(att => att.type !== "image" || att.url !== imageUrls[index]));
                              }}
                            >
                              ✕
                            </Button>
                            <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full">
                              {index + 1}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="flex gap-2 mt-4">
                        <Button
                          onClick={() => setShowImagePreview(false)}
                          className="flex-1"
                        >
                          Готово
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {showAttachmentsPreview && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm">
                  <div className="fixed bottom-0 left-0 right-0 bg-background border-t border-border rounded-t-2xl max-h-[70vh] overflow-hidden">
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold">Приложения ({attachments.length})</h3>
                        <Button variant="ghost" size="sm" onClick={() => setShowAttachmentsPreview(false)}>✕</Button>
                      </div>
                      <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                        {attachments
                          .filter((att) => att.type !== "image")
                          .map((att, idx) => (
                            <div key={idx} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 bg-card/80">
                              <div className="flex items-center gap-2 text-sm">
                                <span className="font-medium truncate max-w-[220px] sm:max-w-[340px]">{att.name || att.url}</span>
                                <span className="text-xs text-muted-foreground">{att.mime}</span>
                              </div>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}>
                                ✕
                              </Button>
                            </div>
                          ))}
                        {attachments.filter((att) => att.type !== "image").length === 0 && <div className="text-sm text-muted-foreground">Нет файлов</div>}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : user ? (
          <div className={`fixed bottom-2 sm:bottom-6 left-0 right-0 z-50 px-4 max-w-full overflow-hidden transition-transform duration-300 ease-in-out ${
            isInputPanelVisible ? 'translate-y-0' : 'translate-y-full'
          }`}>
            <div className="max-w-2xl mx-auto bg-background/60 backdrop-blur-md border border-border/40 rounded-2xl shadow-xl p-4 text-center text-muted-foreground">
              На этой доске могут писать только администраторы
            </div>
          </div>
        ) : (
          <div className={`fixed bottom-2 sm:bottom-6 left-0 right-0 z-50 px-4 max-w-full overflow-hidden transition-transform duration-300 ease-in-out ${
            isInputPanelVisible ? 'translate-y-0' : 'translate-y-full'
          }`}>
            <div className="max-w-2xl mx-auto bg-background/60 backdrop-blur-md border border-border/40 rounded-2xl shadow-xl p-4 text-center">
              <p className="text-sm text-muted-foreground mb-2">Войдите, чтобы ответить</p>
              <Button onClick={() => navigate("/auth")} size="sm">Войти</Button>
            </div>
          </div>
        )}

            {/* Scroll to bottom button */}
            {(!isMobile || !isInputPanelVisible) && (
              <ScrollToBottomButton />
        )}
      </main>

      {/* Image Gallery */}
      {showGallery && (
        <ImageGallery
          images={galleryImages}
          initialIndex={galleryIndex}
          onClose={() => setShowGallery(false)}
          onEditImage={(idx, dataUrl) => {
            setImageUrls((prev) => prev.map((u, i) => (i === idx ? dataUrl : u)));
            setAttachments((prev) => {
              let imgIdx = -1;
              return prev.map((att) => {
                if (att.type === "image") {
                  imgIdx += 1;
                  if (imgIdx === idx) {
                    return { ...att, url: dataUrl };
                  }
                }
                return att;
              });
            });
          }}
        />
      )}
    </>
  );
};

export default Thread;
