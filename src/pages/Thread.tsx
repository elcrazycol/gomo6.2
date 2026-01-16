import { useEffect, useState, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { ImageUpload } from "@/components/ImageUpload";
import { ImageGallery } from "@/components/ImageGallery";
import { UserBadge } from "@/components/UserBadge";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { HeaderUsername } from "@/components/HeaderUsername";
import { AlertTriangle, Reply, Bell, BellOff, Send, ImagePlus, Settings, Eye, EyeOff } from "lucide-react";
import { ModeratorMenu } from "@/components/ModeratorMenu";
import { UserMenu } from "@/components/UserMenu";
import { Input } from "@/components/ui/input";
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
import { PentagramLoader } from "@/components/PentagramLoader";
import { Footer } from "@/components/Footer";
import { CookieBanner } from "@/components/CookieBanner";
import { LikeButton } from "@/components/LikeButton";
import { ScrollToBottomButton } from "@/components/ScrollToBottomButton";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/RichTextEditor";
import { compressImageWithMetadataRemoval, getUserPrivacySettings } from "@/lib/imageProcessing";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Thread {
  id: string;
  title: string;
  content: string;
  custom_message?: string | null;
  image_url: string | null;
  image_urls?: string[] | null;
  created_at: string;
  user_id: string | null;
  profiles: {
    username: string;
    is_anonymous: boolean;
    avatar_url?: string | null;
  } | null;
  boards: {
    slug: string;
    name: string;
    is_rules_board: boolean;
  };
}

interface Post {
  id: string;
  content: string;
  image_url: string | null;
  image_urls?: string[] | null;
  created_at: string;
  user_id: string | null;
  reply_to: string | null;
  is_private: boolean;
  private_recipient_id: string | null;
  profiles: {
    username: string;
    is_anonymous: boolean;
    avatar_url?: string | null;
  } | null;
}

const Thread = () => {
  const { slug, threadId } = useParams();
  const navigate = useNavigate();
  const [thread, setThread] = useState<Thread | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");
  const [content, setContent] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [isPrivateMessage, setIsPrivateMessage] = useState(false);
  const [privateRecipientId, setPrivateRecipientId] = useState<string | null>(null);
  const [showImagePreview, setShowImagePreview] = useState(false);
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

  // Simple BBCode renderer for preview
  const renderPreviewContent = (text: string): React.ReactNode[] => {
    if (!text) return [];

    const elements: React.ReactNode[] = [];
    let key = 0;

    // Process spoilers first
    const spoilerRegex = /\|\|(.*?)\|\|/g;
    let match;
    let lastIndex = 0;

    const processTextSegment = (segment: string) => {
      return segment.split(/(\[\/?[a-zA-Z0-9]+(?:=[^\]]*)?\]|:[^:\s]+:|@[^\s]+|https?:\/\/[^\s]+)/g).map((part, i) => {
        // BBCode tags
        if (part.match(/^\[([a-zA-Z0-9]+)(?:=([^\]]*))?\]$/)) {
          const tagMatch = part.match(/^\[([a-zA-Z0-9]+)(?:=([^\]]*))?\]$/);
          if (tagMatch) {
            const [, tagName, param] = tagMatch;
            // Skip opening tags, handle with closing
            return null;
          }
        } else if (part.match(/^\[\/([a-zA-Z0-9]+)\]$/)) {
          const tagMatch = part.match(/^\[\/([a-zA-Z0-9]+)\]$/);
          if (tagMatch) {
            const [, tagName] = tagMatch;
            // Skip closing tags
            return null;
          }
        }

        // Regular content
        if (part.startsWith(':') && part.endsWith(':') && part.length > 2) {
          const emojiCode = part.slice(1, -1);
          return <EmojiInline key={`${key++}-${i}`} code={emojiCode} />;
        } else if (part.startsWith('@')) {
          const username = part.substring(1);
          return <MentionLink key={`${key++}-${i}`} username={username} />;
        } else if (part.match(/^https?:\/\/[^\s]+$/)) {
          return <LinkButton key={`${key++}-${i}`} url={part} />;
        }
        return part;
      }).filter(Boolean);
    };

    // Handle spoilers
    while ((match = spoilerRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        elements.push(...processTextSegment(text.substring(lastIndex, match.index)));
      }

      const spoilerContent = match[1];
      elements.push(
        <span key={key++} className="bg-muted px-1 rounded cursor-pointer hover:bg-muted/80 select-none" title="Спойлер">
          {spoilerContent}
        </span>
      );

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      elements.push(...processTextSegment(text.substring(lastIndex)));
    }

    // Process BBCode tags
    const processBBCode = (input: React.ReactNode[]): React.ReactNode[] => {
      const result: React.ReactNode[] = [];
      let i = 0;

      while (i < input.length) {
        const node = input[i];

        if (typeof node === 'string' && node.match(/^\[([a-zA-Z0-9]+)(?:=([^\]]*))?\]$/)) {
          const tagMatch = node.match(/^\[([a-zA-Z0-9]+)(?:=([^\]]*))?\]$/);
          if (tagMatch) {
            const [, tagName, param] = tagMatch;
            let content = '';
            let nestedLevel = 0;
            let j = i + 1;

            // Find matching closing tag
            while (j < input.length) {
              const nextNode = input[j];
              if (typeof nextNode === 'string' && nextNode.match(new RegExp(`^\\[/\\s*${tagName}\\s*\\]$`))) {
                if (nestedLevel === 0) break;
                nestedLevel--;
              } else if (typeof nextNode === 'string' && nextNode.match(new RegExp(`^\\[\\s*${tagName}(?:=[^\\]]*)?\\]$`))) {
                nestedLevel++;
              } else if (typeof nextNode === 'string') {
                content += nextNode;
              } else {
                content += nextNode; // React element
              }
              j++;
            }

            if (j < input.length) {
              // Found matching closing tag
              const processedContent = processBBCode([content]);

              switch (tagName.toLowerCase()) {
                case 'b':
                  result.push(<strong key={key++}>{processedContent}</strong>);
                  break;
                case 'i':
                  result.push(<em key={key++}>{processedContent}</em>);
                  break;
                case 'u':
                  result.push(<u key={key++}>{processedContent}</u>);
                  break;
                case 's':
                  result.push(<s key={key++}>{processedContent}</s>);
                  break;
                case 'col':
                  result.push(<span key={key++} style={{ color: param || '#000' }}>{processedContent}</span>);
                  break;
                case 'size':
                  const size = Math.min(7, Math.max(1, parseInt(param || '3', 10)));
                  const fontSize = 0.75 + (size - 1) * 0.175;
                  result.push(<span key={key++} style={{ fontSize: `${fontSize}em` }}>{processedContent}</span>);
                  break;
                case 'blur':
                  result.push(<CensorBlur key={key++}>{processedContent}</CensorBlur>);
                  break;
                case 'spoiler':
                  result.push(
                    <span key={key++} className="bg-muted px-1 rounded cursor-pointer hover:bg-muted/80 select-none" title="Спойлер">
                      {processedContent}
                    </span>
                  );
                  break;
                default:
                  result.push(...processedContent);
              }

              i = j + 1; // Skip the closing tag
              continue;
            }
          }
        }

        result.push(node);
        i++;
      }

      return result;
    };

    return processBBCode(elements.length > 0 ? elements : processTextSegment(text));
  };
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<RichTextEditorHandle>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);

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
            const hasContent = content.trim().length > 0 || imageUrls.length > 0;

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
  }, [lastScrollY, showImagePreview, content, imageUrls]);

  useOnlineStatus(user?.id);

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
  }, [threadId, user]);

  // Realtime subscription for posts changes
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
          console.log('Realtime post change:', payload);

          if (payload.eventType === 'INSERT') {
            // New post added - reload posts to get full data with profiles
            loadPosts();
          } else if (payload.eventType === 'UPDATE') {
            // Post updated - update the specific post in state
            setPosts(currentPosts =>
              currentPosts.map(post =>
                post.id === payload.new.id
                  ? { ...post, ...payload.new }
                  : post
              )
            );
          } else if (payload.eventType === 'DELETE') {
            // Post deleted - remove from state
            setPosts(currentPosts =>
              currentPosts.filter(post => post.id !== payload.old.id)
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [threadId]);

  const checkSubscription = async () => {
    if (!user || !threadId) return;
    
    const { data } = await supabase
      .from("thread_subscriptions")
      .select("id")
      .eq("user_id", user.id)
      .eq("thread_id", threadId)
      .maybeSingle();
    
    setIsSubscribed(!!data);
  };

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

  const loadThread = async () => {
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

      setThread({
        ...threadData,
        boards: board!,
        profiles: profile,
      });

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
  };

  const loadPosts = async () => {
    const { data: postsData } = await supabase
      .from("posts")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    if (postsData) {
      const postsWithProfiles = await Promise.all(
        postsData.map(async (post) => {
          const { data: profile } = await supabase
            .from("profiles")
            .select("username, is_anonymous, avatar_url")
            .eq("id", post.user_id!)
            .maybeSingle();
          
          // Parse image_urls if it's a JSON string, or create array from image_url
          let imageUrls: string[] = [];
          if (post.image_urls && Array.isArray(post.image_urls)) {
            imageUrls = post.image_urls;
          } else if (post.image_urls && typeof post.image_urls === 'string') {
            try {
              imageUrls = JSON.parse(post.image_urls);
            } catch {
              imageUrls = [];
            }
          } else if (post.image_url) {
            imageUrls = [post.image_url];
          }
          
          return {
            ...post,
            profiles: profile,
            imageUrls,
          };
        })
      );
      setPosts(postsWithProfiles);
      
      // Check for @AI mentions in new posts
      if (postsData.length > 0) {
        const latestPost = postsData[postsData.length - 1];
        if (latestPost.content.includes('@AI') && latestPost.reply_to) {
          await handleAIReply(latestPost);
        }
      }
    }
  };

  const handleAIReply = async (triggerPost: any) => {
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
  };

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
      // Convert array to JSON for storage, or use first image for backward compatibility
      const imageUrlForDb = imageUrls.length > 0 ? imageUrls[0] : null;
      const imageUrlsJson = imageUrls.length > 0 ? imageUrls : null;

      const { error } = await supabase.from("posts").insert({
        thread_id: threadId,
        user_id: user.id,
        content: content.trim(),
        image_url: imageUrlForDb, // Keep for backward compatibility
        image_urls: imageUrlsJson, // New field for multiple images
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
      setReplyingTo(null);
      setIsPrivateMessage(false);
      setPrivateRecipientId(null);
      loadPosts();
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

  if (pageLoading || !thread) {
    return (
      <div className="bg-background flex items-center justify-center min-h-screen">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  const canPost = user && (!thread.boards.is_rules_board || isAdmin);

  return (
    <div className="bg-background min-h-screen flex flex-col">
      <div className="flex-1 min-h-0">
        <header className="bg-board-header text-board-header-foreground p-2 sm:p-3 border-b border-border">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
          <div className="text-sm sm:text-base flex-1 min-w-0">
            <Link to="/" className="relative text-lg sm:text-xl font-bold group">
              gomo6
              <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
            </Link>
            <span className="mx-1 sm:mx-2 hidden sm:inline">/</span>
            <Link to={`/${slug}`} className="relative hover:underline hidden sm:inline group">
              /{slug}/ - {thread.boards.name}
              <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
            </Link>
          </div>
          <div className="flex gap-1 sm:gap-2 items-center flex-shrink-0">
            <Link to="/settings" className="hidden sm:block">
              <Button variant="ghost" size="sm" className="relative p-2 hover:bg-white/20 hover:text-white transition-colors group">
                <Settings className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
              </Button>
            </Link>
            {user && <NotificationBell userId={user.id} />}
            {user && <ChatIcon userId={user.id} />}
            {user ? (
              <>
                <div className="hidden sm:flex gap-1 sm:gap-2 items-center ml-2">
                  <HeaderUsername userId={user.id} />
                </div>
                <MobileMenu
                  user={user}
                  isModerator={isModerator}
                />
              </>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => navigate("/auth")} className="text-xs sm:text-sm hover:bg-primary hover:text-primary-foreground transition-colors">
                Войти
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-2 sm:p-4 pb-24 sm:pb-28">
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
            {((thread as any).imageUrls && (thread as any).imageUrls.length > 0) && (
              <div className="mb-2 flex flex-wrap gap-2">
                {(thread as any).imageUrls.map((img: string, idx: number) => (
                  <img
                    key={idx}
                    src={img}
                    alt={`Thread image ${idx + 1}`}
                    className="max-w-32 max-h-32 border border-border cursor-pointer rounded"
                    onClick={() => {
                      setGalleryImages((thread as any).imageUrls);
                      setGalleryIndex(idx);
                      setShowGallery(true);
                    }}
                  />
                ))}
              </div>
            )}
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

          </div>
        </div>

        <div className="space-y-4 mb-4">
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
              {(post as any).imageUrls && (post as any).imageUrls.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {(post as any).imageUrls.map((img: string, idx: number) => (
                    <img
                      key={idx}
                      src={img}
                      alt={`Post image ${idx + 1}`}
                      className="max-w-32 max-h-32 border border-border cursor-pointer rounded"
                      onClick={() => {
                        setGalleryImages((post as any).imageUrls);
                        setGalleryIndex(idx);
                        setShowGallery(true);
                      }}
                    />
                  ))}
                </div>
              )}
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
                {replyingTo && (
                  <div className="flex items-center justify-between mb-1 text-xs text-muted-foreground">
                    <span>Ответ на #{replyingTo.slice(0, 8)}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setReplyingTo(null)}
                      className="h-6 text-xs"
                    >
                      ✕
                    </Button>
                  </div>
                )}

                {isExpandedView && (
                  <div className="space-y-4">
                    {/* Preview */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Предпросмотр</label>
                      <div className="bg-card border border-border rounded-lg p-3 min-h-[200px] max-h-[300px] overflow-y-auto">
                        <div className="text-sm break-words">
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


                  </div>
                )}

                {!isExpandedView && <InlineFormattingToolbar editorRef={editorRef} />}

                <div className={`flex gap-2 ${isExpandedView ? 'items-start' : 'items-end'}`}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 rounded-xl shrink-0"
                    onClick={() => setIsExpandedView(!isExpandedView)}
                    title={isExpandedView ? "Свернуть редактор" : "Расширить редактор"}
                  >
                    {isExpandedView ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
                  </Button>

                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={async (e) => {
                        const files = Array.from(e.target.files || []);
                        if (files.length === 0) return;

                        // Compress and upload images with metadata removal
                        const compressImage = async (file: File, maxWidth: number = 1200): Promise<File> => {
                          try {
                            return await compressImageWithMetadataRemoval(file, maxWidth, 0.8, removeMetadata);
                          } catch (error) {
                            console.warn('Advanced compression failed, falling back to basic compression:', error);
                            // Fallback to basic compression
                            return new Promise((resolve, reject) => {
                              const canvas = document.createElement('canvas');
                              const ctx = canvas.getContext('2d');
                              const img = new Image();

                              img.onload = () => {
                                let { width, height } = img;
                                if (width > maxWidth) {
                                  height = (height * maxWidth) / width;
                                  width = maxWidth;
                                }

                                canvas.width = width;
                                canvas.height = height;
                                ctx?.drawImage(img, 0, 0, width, height);

                                canvas.toBlob((blob) => {
                                  if (blob) {
                                    const compressedFile = new File([blob], file.name, {
                                      type: 'image/jpeg',
                                      lastModified: Date.now(),
                                    });
                                    resolve(compressedFile);
                                  } else {
                                    reject(new Error('Failed to compress image'));
                                  }
                                }, 'image/jpeg', 0.8);
                              };

                              img.src = URL.createObjectURL(file);
                            });
                          }
                        };

                        try {
                          const compressedFiles = await Promise.all(
                            files.map(file => compressImage(file).catch(() => file))
                          );

                          const { data: { user } } = await supabase.auth.getUser();
                          if (!user) {
                            toast.error("Нужно войти для загрузки изображений");
                            return;
                          }

                          const uploadPromises = compressedFiles.map(async (file) => {
                            const fileExt = file.name.split('.').pop() || 'jpg';
                            const timestamp = Date.now();
                            const randomStr = Math.random().toString(36).substring(2, 9);
                            const fileName = `${user.id}/${timestamp}_${randomStr}.${fileExt}`;

                            const { error: uploadError } = await supabase.storage
                              .from('post-images')
                              .upload(fileName, file, {
                                cacheControl: '3600',
                                upsert: false
                              });

                            if (uploadError) {
                              console.error('Upload error:', uploadError);
                              throw new Error(uploadError.message || 'Ошибка загрузки файла');
                            }

                            const { data: { publicUrl } } = supabase.storage
                              .from('post-images')
                              .getPublicUrl(fileName);

                            return publicUrl;
                          });

                          const newUrls = await Promise.all(uploadPromises);
                          setImageUrls(prev => [...prev, ...newUrls]);
                          // Show success message above the form instead of toast
                          setTimeout(() => {
                            const event = new CustomEvent('showUploadSuccess', {
                              detail: { count: newUrls.length }
                            });
                            document.dispatchEvent(event);
                          }, 100);
                        } catch (error) {
                          toast.error("Ошибка загрузки фото");
                          console.error(error);
                        }

                        // Reset input
                        e.target.value = '';
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 rounded-xl shrink-0"
                      asChild
                    >
                      <span>
                        <ImagePlus className="h-5 w-5" />
                      </span>
                    </Button>
                  </label>
                  <div className="flex-1">
                    <RichTextEditor
                      ref={editorRef}
                      value={content}
                      onChange={setContent}
                      onSubmit={() => handleSubmitPost()}
                      placeholder="Напишите сообщение…"
                      className={`text-sm sm:text-base ${isExpandedView ? 'min-h-[300px]' : ''}`}
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
                      className="h-10 w-10 rounded-xl shrink-0 hover:bg-primary/10"
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
                  {imageUrls.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 rounded-xl shrink-0"
                      onClick={() => setShowImagePreview(true)}
                    >
                      <span className="text-sm font-bold">{imageUrls.length}</span>
                    </Button>
                  )}
                  {replyingTo && (
                    <Button
                      type="button"
                      variant={isPrivateMessage ? "default" : "ghost"}
                      size="icon"
                      className="h-10 w-10 rounded-xl shrink-0"
                      onClick={() => setIsPrivateMessage(!isPrivateMessage)}
                      title={isPrivateMessage ? "Отправить как обычное сообщение" : "Отправить как скрытое сообщение"}
                    >
                      {isPrivateMessage ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </Button>
                  )}
                  <Button
                    type="submit"
                    disabled={loading || (!content.trim() && imageUrls.length === 0)}
                    size="icon"
                    className="h-10 w-10 rounded-xl shrink-0"
                  >
                    <Send className="h-5 w-5" />
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

                      <div className="grid grid-cols-2 gap-3 max-h-96 overflow-y-auto">
                        {imageUrls.map((url, index) => (
                          <div key={index} className="relative aspect-square">
                            <img
                              src={url}
                              alt={`Фото ${index + 1}`}
                              className="w-full h-full object-cover rounded-lg border border-border"
                            />
                            <Button
                              variant="destructive"
                              size="sm"
                              className="absolute top-1 right-1 h-6 w-6 p-0"
                              onClick={() => {
                                setImageUrls(prev => prev.filter((_, i) => i !== index));
                              }}
                            >
                              ✕
                            </Button>
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
          />
        )}
      </div>

      <div className="mt-auto">
        <Footer />
        <CookieBanner />
      </div>
    </div>
  );
};

export default Thread;
