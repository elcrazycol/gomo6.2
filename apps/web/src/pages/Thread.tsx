import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/integrations/api/compat";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useThread, usePosts, useThreadSubscription } from "@/hooks/queries";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { safeDate } from "@/utils/safeDate";
import { ImageGallery } from "@/components/ImageGallery";
import { UserBadge } from "@/components/UserBadge";
import { AlertTriangle, Reply, Bell, BellOff, Send, Eye, EyeOff } from "lucide-react";
import { ModeratorMenu } from "@/components/ModeratorMenu";
import { UserMenu } from "@/components/UserMenu";
import { Input } from "@/components/ui/input";
import { Poll } from "@/components/Poll";
import type { Poll as PollData } from "@/components/Poll";
import { storageUrl } from "@/utils/storage";
import { wsService } from "@/services/websocket";
import { getContentTagLabel, getFormatTagLabel, getAtmosphereTagLabel } from "@/constants/tags";
import { renderAttachments } from "@/components/ThreadAttachments";
import { Maximize2, Minimize2 } from "lucide-react";
import { ProcessedContent } from "@/components/ProcessedContent";
import { EmojiPicker } from "@/components/EmojiPicker";
import { PentagramLoader } from "@/components/PentagramLoader";
import { LikeButton } from "@/components/LikeButton";
import { ScrollToBottomButton } from "@/components/ScrollToBottomButton";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { GomoRichEditor, type GomoRichEditorHandle } from "@/components/GomoRichEditor";
import { getUserPrivacySettings } from "@/lib/imageProcessing";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ThreadAttachmentUpload } from "@/components/ThreadAttachmentUpload";
import { AttachmentMeta } from "@/utils/mediaUpload";
import type { Thread as ThreadModel, Post as PostModel, UserProfileLite } from "@/types/forum";

interface ThreadWithExtras extends ThreadModel {
  content_json?: unknown;
  ephemeral_type?: string;
  ephemeral_value?: number;
  username?: string;
  avatar_url?: string;
  tags?: { content?: string; format?: string; atmosphere?: string; flag?: string };
}

interface PostWithExtras extends PostModel {
  content_json?: unknown;
  username?: string;
  avatar_url?: string;
}
const Thread = () => {
  const { slug, threadId } = useParams();
  const location = useLocation();
  const isGomoRoute = location.pathname.startsWith("/g/");
  const pathPrefix = isGomoRoute ? "/g" : "";
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: thread, isLoading: threadLoading, isError: threadError } = useThread(threadId);
  const [postOffset, setPostOffset] = useState(0);
  const [allPosts, setAllPosts] = useState<PostWithExtras[]>([]);
  const [hasMorePosts, setHasMorePosts] = useState(true);
  const postsPerPage = 50;

  // Use isFetching for pagination (not isLoading) to avoid full-page flash.
  // placeholderData keeps previous page visible while next page loads.
  const { data: postsPage = [], isFetching: postsFetching, isError: postsError, error: postsQueryError } = usePosts(threadId, { limit: postsPerPage, offset: postOffset }, {
    placeholderData: (prev: PostWithExtras[] | undefined) => prev,
  });

  // Track initial loading separately (true only when no data has ever loaded)
  const postsInitialLoading = postsFetching && allPosts.length === 0;

  // Sync first page into allPosts
  useEffect(() => {
    if (!postsFetching && postOffset === 0) {
      if (postsPage.length > 0) {
        setAllPosts(postsPage as PostWithExtras[]);
        setHasMorePosts(postsPage.length >= postsPerPage);
      } else {
        setHasMorePosts(false);
      }
    }
  }, [postsPage, postsFetching, postOffset, postsPerPage]);

  // Append additional pages (load more)
  const prevPostOffset = useRef(postOffset);
  useEffect(() => {
    if (postOffset > 0 && !postsFetching) {
      if (postsPage.length > 0) {
        setAllPosts(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          const newPosts = (postsPage as PostWithExtras[]).filter(p => !existingIds.has(p.id));
          if (newPosts.length === 0) {
            setHasMorePosts(false);
            return prev;
          }
          return [...prev, ...newPosts];
        });
        setHasMorePosts(postsPage.length >= postsPerPage);
      } else {
        setHasMorePosts(false);
      }
    }
    prevPostOffset.current = postOffset;
  }, [postsPage, postsFetching, postOffset, postsPerPage]);

  // Reset pagination when thread changes
  useEffect(() => {
    setPostOffset(0);
    setAllPosts([]);
    setHasMorePosts(true);
  }, [threadId]);

  const posts = allPosts;
  const postsContainerRef = useRef<HTMLDivElement>(null);
  const postsSentinelRef = useRef<HTMLDivElement>(null);

  const [user, setUser] = useState<{ id: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserAvatar, setCurrentUserAvatar] = useState<string | null>(null);
  const [currentUserColor, setCurrentUserColor] = useState("");
  const [content, setContent] = useState("");
  const [contentJson, setContentJson] = useState<unknown>(null);
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

  // Use React Query hook for subscription status
  const { data: isSubscribed = false } = useThreadSubscription(threadId, user?.id);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editContentJson, setEditContentJson] = useState<unknown>(null);
  const [banUserId, setBanUserId] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [isClearing, setIsClearing] = useState(false);
  const [pendingPostId, setPendingPostId] = useState<string | null>(null);
  const [banReason, setBanReason] = useState("");
  const [banDays, setBanDays] = useState("7");
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [galleryEditable, setGalleryEditable] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [showGallery, setShowGallery] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [removeMetadata, setRemoveMetadata] = useState(true);
  const [senderDisplayType, setSenderDisplayType] = useState<'classic' | 'modern'>(() => {
    return (localStorage.getItem('sender-display-type') as 'classic' | 'modern') || 'classic';
  });
  const [pollData, setPollData] = useState<{ id: string; user_votes: string[]; [key: string]: unknown } | null>(null);
  const shouldStickBottomRef = useRef(false);
  const SCROLL_STICKY_THRESHOLD = 240;

  const editorRef = useRef<GomoRichEditorHandle>(null);
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

    const interval = setInterval(() => {
      const current = localStorage.getItem('sender-display-type') as 'classic' | 'modern';
      if (current && current !== senderDisplayType) {
        setSenderDisplayType(current || 'classic');
      }
    }, 1000);

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
        setRemoveMetadata((settings as { remove_image_metadata: boolean }).remove_image_metadata);
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
    setLastScrollY(window.scrollY);

    let ticking = false;

    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          const currentScrollY = window.scrollY;

          if (window.innerWidth < 768 && !showImagePreview) {
            const hasContent = content.trim().length > 0 || attachments.length > 0;
            const nearBottom = window.innerHeight + currentScrollY >= document.body.scrollHeight - 100;

            if (nearBottom) {
              setIsInputPanelVisible(true);
            } else if (!hasContent) {
              if (currentScrollY > lastScrollY && currentScrollY > 100) {
                setIsInputPanelVisible(false);
              } else if (currentScrollY < lastScrollY) {
                setIsInputPanelVisible(true);
              }
            }
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

  // Keep legacy imageUrls state in sync with attachments
  useEffect(() => {
    const imgs = attachments
      .filter((att) => att.type === "image")
      .map((att) => storageUrl("content", att.url) || att.url);
    setImageUrls(imgs);
  }, [attachments]);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await api.auth.getSession();
      setUser(session?.user ?? null);
      
      if (session?.user) {
        const token = session.access_token;
        const headers = { 'Authorization': `Bearer ${token}` };

        const rolesRes = await fetch(`/api/v1/user_roles?user_id=eq.${session.user.id}`, { headers });
        const rolesResult = await rolesRes.json();
        const roles = rolesResult.data;
        setIsAdmin(roles?.some((r: { role: string }) => r.role === 'admin') || false);
        setIsModerator(roles?.some((r: { role: string }) => r.role === 'moderator' || r.role === 'admin') || false);

        const profileRes = await fetch(`/api/v1/profiles?id=eq.${session.user.id}`, { headers });
        const profileResult = await profileRes.json();
        const profile = profileResult.data?.[0];

        if (profile) {
          setCurrentUserUsername(profile.username);
          setCurrentUserAvatar(profile.avatar_url || null);
        }

        const achRes = await fetch(`/api/v1/user_achievements?user_id=eq.${session.user.id}`, { headers });
        const achResult = await achRes.json();
        const achievements = achResult.data;

        if (achievements) {
          const colorRewards = achievements
            .filter((a: { achievements?: { reward_type: string; reward_value: string } }) => a.achievements?.reward_type === "username_color")
            .map((a: { achievements: { reward_value: string } }) => a.achievements.reward_value);

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

    const { data: { subscription } } = api.auth.onAuthStateChange((_event: unknown, session: { user: { id: string } | null } | null) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // WebSocket realtime subscription for new posts from other users.
  // Own posts are handled by optimistic append in handleSubmitPost.
  useEffect(() => {
    if (!threadId) return;

    wsService.subscribeToThread(threadId);

    const unsub = wsService.on('new_post', async (message) => {
      const data = message.data;
      if (!data || data.thread_id !== threadId) return;
      // Skip own posts (already added optimistically)
      if (user && data.user_id === user.id) return;

      try {
        const res = await fetch(`/api/v1/posts?id=eq.${data.id}`);
        const result = await res.json();
        const postData = result?.data?.[0];
        if (!postData) return;

        setAllPosts(current => {
          if (current.some(p => p.id === postData.id)) return current;

          const newPost: PostWithExtras = {
            ...postData,
            username: postData.profiles?.username,
            avatar_url: postData.profiles?.avatar_url,
          };

          if (isNearBottom()) {
            setTimeout(scrollToBottomSmooth, 100);
          }

          return [...current, newPost];
        });
      } catch {
        console.error('[WS] Failed to fetch new post:', err);
      }
    });

    return () => {
      unsub();
      wsService.unsubscribe(threadId);
    };
  }, [threadId, user, isNearBottom, scrollToBottomSmooth]);

  const toggleSubscription = async () => {
    if (!user) {
      toast.error("Нужно войти");
      return;
    }

    const token = (await api.auth.getSession()).data.session?.access_token;
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    if (isSubscribed) {
      const res = await fetch(`/api/v1/thread_subscriptions?user_id=eq.${user.id}&thread_id=eq.${threadId}`, {
        method: 'DELETE',
        headers,
      });

      if (res.ok) {
        toast.success("Отписались от уведомлений");
      }
    } else {
      const res = await fetch('/api/v1/thread_subscriptions', {
        method: 'POST',
        headers,
        body: JSON.stringify({ user_id: user.id, thread_id: threadId }),
      });

      if (res.ok) {
        toast.success("Подписались на уведомления");
      }
    }
  };

  // Load poll data when thread is loaded
  useEffect(() => {
    if (!thread?.id || !threadId) return;

    const loadPollData = async () => {
      const token = (await api.auth.getSession()).data.session?.access_token;
      const headers = token ? { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } : undefined;

      const pollRes = await fetch(`/api/v1/polls?thread_id=eq.${threadId}`);
      const pollResult = await pollRes.json();
      const poll = pollResult.data?.[0];

      if (poll) {
        let userVotes: string[] = [];
        if (user?.id && token) {
          const voteRes = await fetch(`/api/v1/poll_votes?poll_id=eq.${poll.id}&user_id=eq.${user.id}`, { headers });
          const voteResult = await voteRes.json();
          const userVote = voteResult.data?.[0];

          userVotes = userVote?.option_ids || [];
        }

        setPollData({ ...poll, user_votes: userVotes });
      }

      if (user && thread && token) {
        try {
          const hasCustomMessage = (thread as ThreadWithExtras).custom_message && ((thread as ThreadWithExtras).custom_message ?? "").trim().length > 0;
          await fetch('/api/v1/thread_custom_message_visits', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              user_id: user.id,
              thread_id: thread.id,
              has_custom_message: hasCustomMessage
            }),
          });
        } catch {
          console.error("Thread visit tracking unavailable:", error);
        }
      }
    };

    loadPollData();
  }, [thread, threadId, user]);

  // Keep view anchored when near bottom or after own post
  useEffect(() => {
    if (posts.length === 0) return;
    if (shouldStickBottomRef.current || isNearBottom()) {
      requestAnimationFrame(scrollToBottomSmooth);
      shouldStickBottomRef.current = false;
    }
  }, [posts, isNearBottom, scrollToBottomSmooth]);

  // Infinite scroll for posts — IntersectionObserver on sentinel
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMorePosts && !postsFetching) {
          setPostOffset(prev => prev + postsPerPage);
        }
      },
      { threshold: 0.1, rootMargin: '200px' }
    );

    if (postsSentinelRef.current) {
      observer.observe(postsSentinelRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [hasMorePosts, postsFetching, postsPerPage]);

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

    if (thread?.boards?.is_rules_board && !isAdmin) {
      toast.error("Только администраторы могут писать на этой доске");
      return;
    }

    setLoading(true);
    try {
      shouldStickBottomRef.current = isNearBottom();
      const imageUrlsFromAttachments = attachments
        .filter(att => att.type === "image")
        .map(att => att.url);
      const imageUrlsJson = imageUrlsFromAttachments.length > 0 ? imageUrlsFromAttachments : null;
      
      const response = await fetch('/api/rpc/create_post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await api.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({
          thread_id: threadId,
          content: content.trim(),
          content_json: contentJson,
          image_urls: imageUrlsJson,
          attachments: attachments.length > 0 ? attachments : null,
          reply_to: replyingTo,
          is_private: isPrivateMessage,
          private_recipient_id: isPrivateMessage ? privateRecipientId : null,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Ошибка отправки');
      }

      const result = await response.json();
      const newPost = result.data;

      // Optimistically append the new post — no full reset, no flash
      if (newPost && newPost.id) {
        const optimisticPost: PostWithExtras = {
          ...newPost,
          username: currentUserUsername || 'Аноним',
          avatar_url: currentUserAvatar || undefined,
        };
        setAllPosts(prev => [...prev, optimisticPost]);
      }

      // Background cache invalidation (no reset — placeholderData keeps old data visible)
      queryClient.invalidateQueries({ queryKey: ['posts', threadId] });
      queryClient.invalidateQueries({ queryKey: ['thread', threadId] });

      // Auto-scroll to bottom after own post
      if (shouldStickBottomRef.current) {
        requestAnimationFrame(scrollToBottomSmooth);
      }
      shouldStickBottomRef.current = false;

      setIsClearing(true);
      setResetKey(prev => prev + 1);
      
      setContentJson(null);
      setContent("");
      setImageUrls([]);
      setAttachments([]);
      setReplyingTo(null);
      setIsPrivateMessage(false);
      setPrivateRecipientId(null);
      
      setTimeout(() => {
        setIsClearing(false);
      }, 100);
    } catch {
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

    const token = (await api.auth.getSession()).data.session?.access_token;
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    const res = await fetch('/api/v1/reports', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        reporter_id: user.id,
        reported_post_id: isThread ? null : postId,
        reported_thread_id: isThread ? threadId : null,
        reason: reportReason.trim(),
      }),
    });

    if (!res.ok) {
      toast.error("Ошибка отправки жалобы");
    } else {
      toast.success("Жалоба отправлена");
      setReportReason("");
      setReportingPost(null);
    }
  };

  const handleDeletePost = async (postId: string) => {
    const token = (await api.auth.getSession()).data.session?.access_token;
    const headers = { 'Authorization': `Bearer ${token}` };

    const res = await fetch(`/api/v1/posts?id=eq.${postId}`, {
      method: 'DELETE',
      headers,
    });

    if (!res.ok) {
      toast.error("Ошибка удаления поста");
    } else {
      toast.success("Пост удален");
      // Remove from local state immediately for instant feedback
      setAllPosts(prev => prev.filter(p => p.id !== postId));
      queryClient.invalidateQueries({ queryKey: ['posts', threadId] });
    }
  };

  const handleDeleteThread = async () => {
    const token = (await api.auth.getSession()).data.session?.access_token;
    const headers = { 'Authorization': `Bearer ${token}` };

    const res = await fetch(`/api/v1/threads?id=eq.${threadId}`, {
      method: 'DELETE',
      headers,
    });
    
    if (!res.ok) {
      toast.error("Ошибка удаления треда");
    } else {
      toast.success("Тред удален");
      navigate(`${pathPrefix}/${slug}`);
    }
  };

  const handleEditPost = async () => {
    if (!editContent.trim() || !editingPostId) return;

    const token = (await api.auth.getSession()).data.session?.access_token;
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    const isOpeningPost = thread && editingPostId === thread.id;
    const table = isOpeningPost ? 'threads' : 'posts';
    const res = await fetch(`/api/v1/${table}?id=eq.${editingPostId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ content: editContent.trim(), content_json: editContentJson }),
    });

    if (!res.ok) {
      toast.error("Ошибка изменения поста");
    } else {
      toast.success("Пост изменен");
      setEditingPostId(null);
      setEditContent("");
      setEditContentJson(null);
      queryClient.invalidateQueries({ queryKey: ['posts', threadId] });
      queryClient.invalidateQueries({ queryKey: ['thread', threadId] });
    }
  };

  const handleBanUser = async (isPermanent: boolean) => {
    if (!banReason.trim() || !banUserId) return;

    const token = (await api.auth.getSession()).data.session?.access_token;
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    const expiresAt = isPermanent 
      ? null 
      : new Date(Date.now() + parseInt(banDays) * 24 * 60 * 60 * 1000).toISOString();

    const res = await fetch('/api/v1/user_bans', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        user_id: banUserId,
        banned_by: user?.id ?? "",
        reason: banReason.trim(),
        expires_at: expiresAt,
        is_permanent: isPermanent,
      }),
    });

    if (!res.ok) {
      toast.error("Ошибка выдачи бана");
    } else {
      toast.success(isPermanent ? "Пользователь забанен навсегда" : `Пользователь забанен на ${banDays} дней`);
      setBanUserId(null);
      setBanReason("");
    }
  };

  const handleEmojiSelect = (emojiCode: string) => {
    editorRef.current?.insertText(emojiCode);
  };

  const handleLogout = async () => {
    await api.auth.signOut();
    toast.success("Вышли");
  };

  // Show fullscreen loader only during the very first load (no thread data yet)
  if (threadLoading) {
    return (
      <div className="bg-background flex items-center justify-center min-h-screen">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  if (threadError || !thread) {
    return (
      <div className="bg-background flex items-center justify-center min-h-screen flex-col gap-4">
        <p className="text-muted-foreground text-lg">Тред не найден</p>
        <Link to="/" className="text-primary hover:underline text-sm">На главную</Link>
      </div>
    );
  }

  const canPost = user && (!thread.boards?.is_rules_board || isAdmin);

  // Helper to render a single post card
  const renderPostCard = (post: PostWithExtras) => (
    <>
      <div className="flex justify-between items-start gap-2">
        <div className="text-xs text-muted-foreground mb-2 flex-wrap flex-1">
          {senderDisplayType === 'modern' ? (
            <div className="flex items-start gap-2">
              <img
                src={storageUrl("post-images", post.avatar_url) || '/placeholder.svg'}
                alt="Avatar"
                className="w-12 h-12 rounded-full object-cover border border-border"
              />
              <div>
                <UserBadge
                  userId={post.user_id}
                  username={post.username || "Аноним"}
                  isAnonymous={false}
                  showOutline={false}
                  isThreadOpener={post.user_id === thread?.user_id}
                />
                <div className="text-muted-foreground">
                  {post.created_at ? formatDistanceToNow(new Date(post.created_at), {
                    locale: ru,
                    addSuffix: true,
                  }) : 'только что'}
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
                username={post.username || "Аноним"}
                isAnonymous={false}
                showOutline={false}
              />
              {" · "}
              {post.created_at ? formatDistanceToNow(new Date(post.created_at), {
                locale: ru,
                addSuffix: true,
              }) : 'только что'}
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
                setEditContentJson(post.content_json ?? null);
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
                setEditContentJson(post.content_json ?? null);
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
            setPulsingPostId(post.reply_to ?? null);
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
      {renderAttachments(post.attachments || [], (urls, idx) => {
        setGalleryEditable(false);
        setGalleryImages(urls);
        setGalleryIndex(idx);
        setShowGallery(true);
      }, `post-${post.id}`)}
      {editingPostId === post.id ? (
        <div className="space-y-2">
          <GomoRichEditor
            key={resetKey}
            contentJson={post.content_json}
            legacyContent={post.content}
            onChange={({ json, text }) => {
              setEditContentJson(json);
              setEditContent(text);
            }}
            onSubmit={() => handleEditPost()}
            placeholder="Напишите сообщение…"
            minHeightClassName="min-h-[120px]"
          />
          <div className="flex gap-2">
            <Button onClick={handleEditPost} size="sm">Сохранить</Button>
            <Button
              onClick={() => {
                setEditingPostId(null);
                setEditContent("");
                setEditContentJson(null);
              }}
              variant="secondary"
              size="sm"
            >
              Отмена
            </Button>
          </div>
        </div>
      ) : (
        <div className="text-sm sm:text-base break-words leading-6 sm:leading-7">
          {post.is_private && user?.id !== post.user_id && user?.id !== post.private_recipient_id ? (
            <span className="text-muted-foreground italic">Скрытый контент</span>
          ) : (
            <>
              <ProcessedContent
                content={post.content}
                contentJson={post.content_json}
                currentUserId={user?.id || null}
                isAdmin={isAdmin}
                currentUsername={currentUserUsername}
                currentUserColor={currentUserColor}
                postAuthorId={post.user_id}
                authorUsername={post.username}
              />
            </>
          )}
        </div>
      )}
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
              setTimeout(() => {
                editorRef.current?.focus();
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
    </>
  );

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
          <Link to={`${pathPrefix}/${slug}`} className="text-primary hover:text-primary/80 font-medium text-sm transition-colors">
            {thread.boards?.is_gomosub ? "← Назад к "+"/g/"+thread.boards?.slug : "← Назад к доске"}
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
              {user && thread.user_id === user.id && (
                <UserMenu
                  type="thread"
                  onEdit={() => {
                    setEditingPostId(thread.id);
                    setEditContent(thread.content);
                    setEditContentJson((thread as ThreadWithExtras).content_json);
                  }}
                  onDelete={() => handleDeleteThread()}
                  onReport={() => setReportingPost(thread.id)}
                />
              )}
              {isModerator && thread.user_id && thread.user_id !== user?.id && (
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
                    src={storageUrl("post-images", (thread as ThreadWithExtras).avatar_url) || '/placeholder.svg'}
                    alt="Avatar"
                    className="w-12 h-12 rounded-full object-cover border border-border"
                  />
                  <div>
                    <UserBadge
                      userId={thread.user_id}
                    username={(thread as ThreadWithExtras).username || "Аноним"}
                    isAnonymous={false}
                    showOutline={false}
                    isThreadOpener={true}
                    />
                    <div className="text-muted-foreground">
                      {formatDistanceToNow(safeDate(thread.created_at), {
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
                    username={(thread as ThreadWithExtras).username || "Аноним"}
                    isAnonymous={false}
                    showOutline={false}
                  />
                  {" · "}
                  {formatDistanceToNow(safeDate(thread.created_at), {
                    locale: ru,
                    addSuffix: true,
                  })}
                </>
              )}
            </div>
            {renderAttachments((thread as ThreadWithExtras).attachments, (urls, idx) => {
              setGalleryEditable(false);
              setGalleryImages(urls);
              setGalleryIndex(idx);
              setShowGallery(true);
            }, thread?.id || threadId || slug || "thread")}

            {editingPostId === thread.id ? (
              <div className="space-y-2">
                <GomoRichEditor
                  key={resetKey}
                  contentJson={(thread as ThreadWithExtras).content_json}
                  legacyContent={thread.content}
                  onChange={({ json, text }) => {
                    setEditContentJson(json);
                    setEditContent(text);
                  }}
                  onSubmit={() => handleEditPost()}
                  placeholder="Напишите сообщение…"
                  minHeightClassName="min-h-[120px]"
                />
                <div className="flex gap-2">
                  <Button onClick={handleEditPost} size="sm">Сохранить</Button>
                  <Button 
                    onClick={() => {
                      setEditingPostId(null);
                      setEditContent("");
                      setEditContentJson(null);
                    }} 
                    variant="outline" 
                    size="sm"
                  >
                    Отмена
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-sm sm:text-base break-words leading-6 sm:leading-7">
                <ProcessedContent
                  content={thread.content}
                  contentJson={(thread as ThreadWithExtras).content_json}
                  currentUserId={user?.id || null}
                  isAdmin={isAdmin}
                  currentUsername={currentUserUsername}
                  currentUserColor={currentUserColor}
                  postAuthorId={thread.user_id}                        authorUsername={(thread as ThreadWithExtras).username}
                />
              </div>
            )}

            {/* Thread tags */}
            {(thread as ThreadWithExtras).tags && (
              <div className="flex flex-wrap gap-1 mt-3">
                {(thread as ThreadWithExtras).ephemeral_type && (
                  <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-800 rounded-full border border-orange-200">
                    {(thread as ThreadWithExtras).ephemeral_type === 'time'
                      ? `${(thread as ThreadWithExtras).ephemeral_value}ч`
                      : `${(thread as ThreadWithExtras).ephemeral_value}сообщ.`
                    }
                  </span>
                )}
                {(thread as ThreadWithExtras).ephemeral_type && (
                  <button
                    onClick={() => navigate('/b?flag=ephemeral')}
                    className="inline-block px-2 py-0.5 text-xs bg-orange-500/10 text-orange-700 rounded-full
                             hover:bg-orange-500/20 hover:text-orange-800 transition-colors duration-200
                             border border-orange-500/20 hover:border-orange-500/40"
                  >
                    Временный
                  </button>
                )}
                {(thread as ThreadWithExtras).tags!.content && (
                  <button
                    onClick={() => navigate(`/b?content=${(thread as ThreadWithExtras).tags!.content}`)}
                    className="inline-block px-2 py-0.5 text-xs bg-blue-500/10 text-blue-600 rounded-full
                             hover:bg-blue-500/20 hover:text-blue-700 transition-colors duration-200
                             border border-blue-500/20 hover:border-blue-500/40"
                  >
                    {getContentTagLabel((thread as ThreadWithExtras).tags!.content!)}
                  </button>
                )}
                {(thread as ThreadWithExtras).tags!.format && (
                  <button
                    onClick={() => navigate(`/b?format=${(thread as ThreadWithExtras).tags!.format}`)}
                    className="inline-block px-2 py-0.5 text-xs bg-green-500/10 text-green-600 rounded-full
                             hover:bg-green-500/20 hover:text-green-700 transition-colors duration-200
                             border border-green-500/20 hover:border-green-500/40"
                  >
                    {getFormatTagLabel((thread as ThreadWithExtras).tags!.format!)}
                  </button>
                )}
                {(thread as ThreadWithExtras).tags!.atmosphere && (
                  <button
                    onClick={() => navigate(`/b?atmosphere=${(thread as ThreadWithExtras).tags!.atmosphere}`)}
                    className="inline-block px-2 py-0.5 text-xs bg-purple-500/10 text-purple-600 rounded-full
                             hover:bg-purple-500/20 hover:text-purple-700 transition-colors duration-200
                             border border-purple-500/20 hover:border-purple-500/40"
                  >
                    {getAtmosphereTagLabel((thread as ThreadWithExtras).tags!.atmosphere!)}
                  </button>
                )}
                {(thread as ThreadWithExtras).tags!.flag === 'night' && (
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
          {/* Posts error state */}
          {postsError && allPosts.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-lg">Не удалось загрузить посты</p>
              <p className="text-sm mt-1">{(postsQueryError as Error)?.message || 'Попробуйте позже'}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => {
                  queryClient.invalidateQueries({ queryKey: ['posts', threadId] });
                }}
              >
                Повторить
              </Button>
            </div>
          )}

          {/* Inline loader during initial posts loading */}
          {postsInitialLoading && (
            <div className="flex justify-center py-8">
              <PentagramLoader size="md" />
            </div>
          )}

          {/* Poll */}
          {pollData && (<Poll
                  poll={pollData as unknown as PollData}
                  threadId={threadId!}
              currentUserId={user?.id || null}
              isPageLoading={pageLoading}
            />
          )}

          {/* Posts — direct rendering for all thread sizes */}
          <div ref={postsContainerRef} className="space-y-4">
            {posts.map((post) => (
              <div
                key={`${post.id}-${post.created_at}`}
                id={`post-${post.id}`}
                style={{ contentVisibility: "auto", containIntrinsicSize: "auto 160px" }}
                className={`bg-post-header p-2 sm:p-3 border border-border transition-all duration-500 ${
                  pulsingPostId === post.id ? 'ring-1 ring-primary/60' : ''
                }`}
              >
                {renderPostCard(post)}
              </div>
            ))}
            {/* Infinite scroll sentinel for posts */}
            <div ref={postsSentinelRef} className="py-4">
              {postsFetching && !postsInitialLoading && (
                <div className="flex justify-center py-4">
                  <PentagramLoader size="md" />
                </div>
              )}
              {!hasMorePosts && posts.length > 0 && postsError === false && (
                <div className="text-center text-muted-foreground py-2 text-sm">
                  Все посты загружены
                </div>
              )}
            </div>
          </div>
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

              {attachments.length > 0 && !isExpandedView && (
                <div className="mb-3 bg-card/70 border border-border/50 rounded-xl p-3">
                  <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                    {attachments.filter((att) => att.type === "image").map((att, idx) => (
                      <div
                        key={att.url}
                        className="group relative w-16 h-16 sm:w-20 sm:h-20 rounded-lg border border-border bg-muted/60 overflow-hidden flex items-center justify-center cursor-pointer"
                        onClick={() => {
                          const imageUrls = attachments
                            .filter((att) => att.type === "image")
                            .map((att) => storageUrl("content", att.url) || att.url);
                          setGalleryEditable(true);
                          setGalleryImages(imageUrls);
                          setGalleryIndex(idx);
                          setShowGallery(true);
                        }}
                      >
                        <img src={storageUrl("content", att.url) || att.url} alt={`preview-${idx}`} className="max-h-full max-w-full object-cover" />
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
                    ))}
                    {attachments
                      .filter((att) => att.type !== "image")
                      .map((att) => {
                        const kind = (att.mime || att.type || "").split("/")[0] || att.type || "file";
                        const label = (att.name || att.url || "").split(".").pop()?.slice(0, 4) || kind.slice(0, 4);
                        return (
                          <div
                            key={att.url}
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
                                setAttachments((prev) => prev.filter((a) => a !== att));
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

              {!isInputPanelCollapsed && (
                <div className="max-w-2xl mx-auto relative">
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
                    className={`bg-background/60 backdrop-blur-md border border-border/40 rounded-2xl shadow-xl transition-all duration-300 relative ${
                      isExpandedView
                        ? isMobile
                          ? 'p-4 space-y-3 max-h-[80vh] overflow-y-auto'
                          : 'p-6 space-y-4'
                        : 'p-4 space-y-3'
                    }`}
                  >
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

                <div className={`flex gap-1.5 sm:gap-2 ${isExpandedView ? 'items-start' : 'items-end'} relative`}>
                  {isExpandedView && (
                    <div className="flex flex-col gap-1.5 sm:gap-2 shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 sm:h-10 sm:w-10 rounded-xl shrink-0"
                        onClick={() => setIsExpandedView(false)}
                        title="Свернуть редактор"
                      >
                        <Minimize2 className="h-4 w-4 sm:h-5 sm:w-5" />
                      </Button>
                      <ThreadAttachmentUpload value={attachments} onChange={setAttachments} maxFiles={8} />
                    </div>
                  )}
                  {!isExpandedView && (
                    <>
                      <div className="flex flex-col gap-1.5 sm:gap-2 shrink-0">
                        <Button
                          type="button"
                    variant="ghost"
                    size="icon"
                          className="h-8 w-8 sm:h-10 sm:w-10 rounded-xl shrink-0"
                          onClick={() => setIsExpandedView(true)}
                          title="Развернуть редактор"
                        >
                          <Maximize2 className="h-4 w-4 sm:h-5 sm:w-5" />
                        </Button>
                        <ThreadAttachmentUpload value={attachments} onChange={setAttachments} maxFiles={8} />
                      </div>
                    </>
                  )}
                  <div
                    className="flex-1 min-w-0"
                    onFocusCapture={() => setIsInputPanelVisible(true)}
                  >
                    <GomoRichEditor
                      ref={editorRef}
                      key={resetKey}
                      contentJson={contentJson}
                      legacyContent={content}
                      onChange={({ json, text }) => {
        setContentJson(json);
        setContent(text);
      }}
                      onSubmit={() => handleSubmitPost()}
                      placeholder="Напишите сообщение…"
                      minHeightClassName={isExpandedView ? 'min-h-[200px] sm:min-h-[300px]' : 'min-h-[60px] sm:min-h-[80px]'}
                    />
                  </div>
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

              {showImagePreview && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm">
                  <div className="fixed bottom-0 left-0 right-0 bg-background border-t border-border rounded-t-2xl max-h-[80vh] overflow-hidden">
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold">
                          Приложенные фото ({attachments.filter(att => att.type === 'image').length})
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
                        {attachments.filter((att) => att.type === "image").map((att, index) => (
                          <div key={att.url} className="relative rounded-lg border border-border bg-muted/40 aspect-square flex items-center justify-center overflow-hidden">
                            <img
                              src={storageUrl("content", att.url) || att.url}
                              alt={`Фото ${index + 1}`}
                              className="max-h-full max-w-full object-contain"
                              onClick={() => {
                                const imageUrls = attachments
                                  .filter((att) => att.type === "image")
                                  .map((att) => storageUrl("content", att.url) || att.url);
                                setGalleryEditable(true);
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
                                setAttachments(prev => prev.filter((a) => a !== att));
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

            {(!isMobile || !isInputPanelVisible) && (
              <ScrollToBottomButton />
        )}
      </main>

      {showGallery && (
        <ImageGallery
          images={galleryImages}
          initialIndex={galleryIndex}
          onClose={() => setShowGallery(false)}
          onEditImage={
            galleryEditable
              ? (idx, dataUrl) => {
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
                }
              : undefined
          }
        />
      )}
    </>
  );
};

export default Thread;
