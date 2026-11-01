import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useParams, useNavigate, useSearchParams, Navigate, useLocation } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { NavigationLink } from "@/components/NavigationLink";
import { api } from "@/integrations/api/compat";
import { apiClient } from "@/integrations/api/client";
import { invalidateByPrefix, peekCached } from "@/integrations/api/queryCache";
import { getMyGomosubMembership, invalidateGomosubMembership } from "@/utils/gomosubMembership";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHandle, DrawerTitle } from "@/components/ui/drawer";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useDateLocale } from "@/i18n/dateLocale";
import { useTranslation } from "react-i18next";
import { safeDate } from "@/utils/safeDate";
import { storageUrl } from "@/utils/storage";
import { CONTENT_TAGS, FORMAT_TAGS, ATMOSPHERE_TAGS, FLAG_TAGS } from "@/constants/tags";
import { UserBadge } from "@/components/UserBadge";
import { AgeVerification } from "@/components/AgeVerification";
import { Filter, X, MessageCircle, ArrowUpRight, BookOpenText, Users, Plus, Search, ChevronLeft, ChevronRight, Hash, Lock, Settings } from "lucide-react";
import { useSessionTime } from "@/hooks/useSessionTime";
import { useProfileInvalidation } from "@/hooks/useProfileInvalidation";
import { getCurrentUserMeta } from "@/utils/currentUserMeta";
import { Skeleton } from "@/components/ui/skeleton";
import { ThreadFeedSkeleton } from "@/components/skeletons/ContentSkeletons";
import { renderPreviewContent } from "@/utils/emojiUtils.tsx";
import { renderTags } from "@/components/ThreadCard";
import { LikeButton } from "@/components/LikeButton";
import { GomoThreadCard } from "@/components/GomoThreadCard";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { ChannelChat } from "@/components/ChannelChat";
import { BoardStoriesBar } from "@/components/stories/BoardStoriesBar";
import { wsService } from "@/services/websocket";
import { entityParam } from "@/utils/entityUrl";
import {
  boardBySlugUrl,
  loadBoardBySlug,
  loadBoardChannels,
  type BoardRow as Board,
  type ChannelRow as Channel,
} from "@/routes/data/boardData";
import { getDirectoryMemberCount } from "@/routes/data/gomosubData";
import { SPRING, EASE_OUT_EXPO, morphTransition, springFor, streamRowVariants, travelDirection } from "@/lib/motion";
import { RecedeOnScroll } from "@/components/profile/RecedeOnScroll";
import { GomoSubHeader } from "@/components/gomosub/GomoSubHeader";
import { GomoSubChannelBar } from "@/components/gomosub/GomoSubChannelBar";
import { GomoSubChannelsList } from "@/components/gomosub/GomoSubChannelsList";
import { GomoSubMemberList } from "@/components/gomosub/GomoSubMemberList";
import { groupChannels, type CategoryLike } from "@/components/gomosub/groupChannels";
import { useGomoSubUnread } from "@/hooks/useGomoSubUnread";

// Mobile channel sheet grab zone: bottom-left corner of the screen.
// Used both for the swipe-up-to-open and swipe-down-to-close.
const EDGE_ZONE_HEIGHT = 100;
const EDGE_ZONE_WIDTH = 0.3;

// Board/Channel shapes now live in `@/routes/data/boardData` (imported above),
// so the page and the route preloader cannot drift.

interface Thread {
  id: string;
  public_id?: number | null;
  /** Public number of the author, for /profile/<n> links. */
  user_public_id?: number | null;
  title: string;
  content: string;
  content_json?: unknown;
  image_url: string | null;
  image_urls?: string[] | null;
  attachments?: unknown;
  created_at: string;
  updated_at: string;
  post_count: number;
  user_id: string | null;
  channel_id?: string | null;
  tags?: Record<string, unknown>; // Thread tags object
  profiles: {
    username: string;
    public_id?: number | null;
    display_name?: string | null;
    nickname_emoji_id?: string | null;
    is_anonymous: boolean;
    avatar_url?: string | null;
  } | null;
  latest_post?: {
    content: string;
    created_at: string;
    is_private: boolean;
    user_id: string | null;
    profiles: {
      username: string;
      display_name?: string | null;
      nickname_emoji_id?: string | null;
      is_anonymous: boolean;
      avatar_url?: string | null;
    } | null;
  };
}

// Function to check if content contains visibility tags
const hasVisibilityTags = (content: string): boolean => {
  return content.includes('[seeusers=') || content.includes('[nousers=') || content.includes('[adm]');
};

const Board = () => {
  const { slug, channelSlug } = useParams();
  const dateLocale = useDateLocale();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const isGomoRoute = location.pathname.startsWith("/g/");
  const pathPrefix = isGomoRoute ? "/g" : "";
  // Paint a warm board row on the very first render (the route preloader
  // usually warmed it) instead of flashing a full-screen loader.
  const [board, setBoard] = useState<Board | null>(
    () => (slug ? peekCached<Board>(boardBySlugUrl(slug)) ?? null : null),
  );
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadsCursor, setThreadsCursor] = useState<string | null>(null);
  const [hasMoreThreads, setHasMoreThreads] = useState(true);
  const [loadingMoreThreads, setLoadingMoreThreads] = useState(false);
  const threadsSentinelRef = useRef<HTMLDivElement>(null);
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [authResolved, setAuthResolved] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [threadsLoading, setThreadsLoading] = useState(false);
  // True only after the thread list actually returned for this board. The
  // «Записей пока нет» empty state is gated on it: an intermediate commit
  // (threads=[] while the fetch is still spinning up) must never paint the
  // empty state — that was one of the entry races.
  const [threadsSettled, setThreadsSettled] = useState(false);
  const [showAgeVerification, setShowAgeVerification] = useState(false);
  const [ageVerified, setAgeVerified] = useState(false);
  const [searchParams] = useSearchParams();
  const [showFilters, setShowFilters] = useState(false);
  const [showRulesDialog, setShowRulesDialog] = useState(false);
  const [hasAcceptedRules, setHasAcceptedRules] = useState(false);
  const [rulesConfirmed, setRulesConfirmed] = useState(false);
  const [checkingRules, setCheckingRules] = useState(false);
  const [isJoined, setIsJoined] = useState(false);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [privateAccessDenied, setPrivateAccessDenied] = useState(false);
  const [membershipLoading, setMembershipLoading] = useState(false);
  
  // Channels state
  const [channels, setChannels] = useState<Channel[]>([]);
  const [categories, setCategories] = useState<CategoryLike[]>([]);
  const [roster, setRoster] = useState<{ members: { user_id: string; username: string; role_ids: string[]; timed_out: boolean; is_owner: boolean }[]; roles: { id: string; name: string; color: string; position: number; is_everyone?: boolean }[] } | null>(null);
  const [showMembers, setShowMembers] = useState(true);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [channelsLoaded, setChannelsLoaded] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileChannelsOpen, setMobileChannelsOpen] = useState(false);
  const [mobileShowMembers, setMobileShowMembers] = useState(false);
  // Tracks the channel sheet snap point (0.4 = compact, 1 = full screen) so we
  // can show a close button only when the sheet is fully expanded.
  const [channelSheetSnapPoint, setChannelSheetSnapPoint] = useState<number>(0.4);
  // Channel search shared by the desktop sidebar and the mobile sheet.
  const [channelQuery, setChannelQuery] = useState("");
  // Directional travel between channels (+1 forward / -1 back in list order)
  // so the content slides the way you moved, Discord-style.
  const [travelDir, setTravelDir] = useState<1 | -1>(1);
  const prevActiveChannelRef = useRef<string | null>(null);
  // Timers for the sheet close animation (vaul slides it out over 0.5s): the
  // scroll lock and the snap point must outlive the animation, otherwise the
  // background flashes and the sheet jumps back to 40% while closing.
  const scrollLockReleaseTimer = useRef<number | null>(null);
  const snapResetTimer = useRef<number | null>(null);
  const edgeSwipeStart = useRef<{ x: number; y: number } | null>(null);
  const [boardPermissions, setBoardPermissions] = useState<Record<string, boolean>>({});
  const [isBoardOwner, setIsBoardOwner] = useState(false);
  // Gallery lightbox for attachment previews (mirrors Index/Wall pattern).
  const [galleryItems, setGalleryItems] = useState<LightboxItem[] | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [currentUsername, setCurrentUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");
  
  useSessionTime(user?.id);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { session } } = await api.auth.getSession();
        const sessionUser = session?.user ?? null;
        setUser(sessionUser);

        if (sessionUser) {
          // Roles via a TTL-cached batched call instead of a fetch on every mount.
          const meta = await getCurrentUserMeta(sessionUser.id);
          setIsModerator(meta.roles.some((r) => r === 'moderator' || r === 'admin'));
          setCurrentUsername(meta.username);
          setCurrentUserColor(meta.color);
        }
    } finally {
      setAuthResolved(true);
    }
    };
    checkAuth();

    const { data: { subscription } } = api.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
        setAuthResolved(true);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // Load channels for gomosub boards (plus their categories, Discord-style).
  const loadChannels = useCallback(async (boardId: string, ownerId: string | null): Promise<string | null> => {
    try {
      const [channelsDataRaw, categoriesRes] = await Promise.all([
        loadBoardChannels(boardId),
        fetch(`/api/v1/channel_categories?board_id=eq.${boardId}&order=sort_order.asc`).then((r) => r.json()).catch(() => null),
      ]);
      let channelsData = channelsDataRaw;
      setCategories(((categoriesRes?.data || []) as CategoryLike[]));

      // Filter channels using the v2 permission model: owners and
      // administrators see everything; members see a private channel only
      // with a view_channel grant (or the legacy can_read) on any of their
      // roles; outsiders only through an explicit overwrite. An explicit
      // view deny hides the channel even when it is public.
      const isOwner = user?.id && ownerId && user.id === ownerId;
      if (!isOwner && channelsData.length > 0) {
        if (!user?.id) {
          channelsData = channelsData.filter((ch) => !ch.is_private);
        } else {
          const allChannelIds = channelsData.map((ch) => ch.id);
          const [membership, rolesRes, grantsRes, permissionsRes] = await Promise.all([
            getMyGomosubMembership(boardId, user.id),
            fetch(`/api/v1/gomosub_roles?board_id=eq.${boardId}`).then((r) => r.json()).catch(() => null),
            fetch(`/api/v1/gomosub_member_roles?board_id=eq.${boardId}&user_id=eq.${user.id}`).then((r) => r.json()).catch(() => null),
            fetch(`/api/v1/channel_permissions?channel_id=in.(${allChannelIds.join(",")})`).then((r) => r.json()).catch(() => null),
          ]);
          const roles = ((rolesRes?.data || []) as { id: string; permissions: unknown; is_everyone?: boolean }[]);
          const parsePerms = (v: unknown): Record<string, boolean> => {
            if (typeof v === "string") {
              try { return JSON.parse(v) as Record<string, boolean>; } catch { return {}; }
            }
            return (v as Record<string, boolean>) || {};
          };
          const grants = ((grantsRes?.data || []) as { role_id: string }[]).map((g) => g.role_id);
          if (membership?.role_id) grants.push(membership.role_id);
          const myRoleIds = new Set(grants);
          const isMember = membership !== null;
          if (isMember) {
            const everyone = roles.find((r) => r.is_everyone);
            if (everyone) myRoleIds.add(everyone.id);
          }
          const isAdmin = roles.some((r) => myRoleIds.has(r.id) && parsePerms(r.permissions).administrator);
          if (!isAdmin) {
            const overwrites = ((permissionsRes?.data || []) as {
              channel_id: string; role_id: string;
              allow?: unknown; deny?: unknown; can_read?: boolean;
            }[]);
            const denied = (channelId: string) =>
              overwrites.some((p) => {
                if (p.channel_id !== channelId || !myRoleIds.has(p.role_id)) return false;
                return parsePerms(p.deny).view_channel === true;
              });
            const granted = (channelId: string) =>
              overwrites.some((p) => {
                if (p.channel_id !== channelId || !myRoleIds.has(p.role_id)) return false;
                const allow = parsePerms(p.allow);
                const deny = parsePerms(p.deny);
                if (deny.view_channel) return false;
                if (allow.view_channel) return true;
                return p.can_read === true;
              });
            // Server-wide view grant (usually from @everyone): members need
            // it to see public channels (Discord lockdown rule).
            const serverView = roles.some((r) => myRoleIds.has(r.id) && parsePerms(r.permissions).view_channel === true);
            channelsData = channelsData.filter((ch) => {
              // Explicit deny hides the channel from everyone but owners/admins.
              if (denied(ch.id)) return false;
              if (!ch.is_private) {
                // Outsiders preview public channels; members need the view grant.
                return !isMember || serverView || granted(ch.id);
              }
              // Private channels stay members-visible; overwrites add outsiders.
              return isMember || granted(ch.id);
            });
          }
        }
      }

      setChannels(channelsData);

      let resolvedChannelId: string | null = null;
      if (channelSlug) {
        const foundChannel = channelsData.find((ch) => ch.slug === channelSlug);
        resolvedChannelId = foundChannel?.id || null;
      }
      setActiveChannelId(resolvedChannelId);
      setChannelsLoaded(true);
      return resolvedChannelId;
    } catch {
      setChannels([]);
      setChannelsLoaded(true);
      return null;
    }
  }, [channelSlug, user?.id]);

  const loadThreads = useCallback(async (boardId: string, isLoadMore = false, channelId?: string | null) => {
    const thisFetchId = ++fetchIdRef.current;
    if (isLoadMore) {
      setLoadingMoreThreads(true);
    }

    const contentFilter = searchParams.get('content');
    const formatFilter = searchParams.get('format');
    const atmosphereFilter = searchParams.get('atmosphere');
    const flagFilter = searchParams.get('flag');
    const oldTagFilter = searchParams.get('tag');

    // Build URL with cursor-based pagination
    let threadsUrl = `/api/v1/threads?board_id=eq.${boardId}`;
    // Filter by channel if active. Bare slug = «Общий»: no channel filter at
    // all, so the community feed shows every record, from every channel.
    const effectiveChannelId = channelId !== undefined ? channelId : null;
    if (effectiveChannelId) {
      threadsUrl += `&channel_id=eq.${effectiveChannelId}`;
    }
    threadsUrl += `&order=updated_at.desc&limit=${isLoadMore ? 21 : 20}`;
    if (isLoadMore && threadsCursor) {
      threadsUrl += `&cursor=${encodeURIComponent(threadsCursor)}`;
    }

    // Fetch threads from Go backend — include auth token for gomosub private channel access
    const fetchHeaders: Record<string, string> = {};
    if (isGomoRoute) {
      const { data: { session } } = await api.auth.getSession();
      if (session?.access_token) {
        fetchHeaders['Authorization'] = `Bearer ${session.access_token}`;
      }
    }
    const threadsResponse = await fetch(threadsUrl, { headers: fetchHeaders });
    const threadsResult = await threadsResponse.json();
    let threadsData: Record<string, unknown>[] = (threadsResult.data || []) as Record<string, unknown>[];
    const nextCursor = threadsResult.next_cursor || null;

    // Detect hasMore by fetching limit+1
    const hasMoreData = threadsData.length > 20;
    if (hasMoreData) {
      threadsData = threadsData.slice(0, 20);
    }

    if (thisFetchId !== fetchIdRef.current) {
      if (isLoadMore) setLoadingMoreThreads(false);
      return;
    }
    setThreadsCursor(nextCursor);
    setHasMoreThreads(hasMoreData && nextCursor !== null);

    // Client-side tag filtering (Go backend doesn't support JSON ->> operators)
    if (!isGomoRoute && threadsData.length) {
      const hasTagFilter = contentFilter || formatFilter || atmosphereFilter || flagFilter;
      if (hasTagFilter) {
        threadsData = threadsData.filter((t: Record<string, unknown>) => {
          let tags: Record<string, unknown> = {};
          const rawTags = t.tags;
          if (rawTags) {
            try { tags = typeof rawTags === 'string' ? JSON.parse(rawTags) : rawTags as Record<string, unknown>; } catch { /* ignore JSON parse errors */ }
          }
          if (contentFilter && tags.content !== contentFilter) return false;
          if (formatFilter && tags.format !== formatFilter) return false;
          if (atmosphereFilter && tags.atmosphere !== atmosphereFilter) return false;
          if (flagFilter && tags.flag !== flagFilter) return false;
          return true;
        });
      } else if (oldTagFilter) {
        threadsData = threadsData.filter((t: Record<string, unknown>) => {
          let tags: Record<string, unknown> = {};
          const rawTags = t.tags;
          if (rawTags) {
            try { tags = typeof rawTags === 'string' ? JSON.parse(rawTags) : rawTags as Record<string, unknown>; } catch { /* ignore JSON parse errors */ }
          }
          return tags.content === oldTagFilter;
        });
      }
    }

    if (!threadsData.length) {
      if (isLoadMore) {
        if (thisFetchId === fetchIdRef.current) setHasMoreThreads(false);
      } else {
        if (thisFetchId === fetchIdRef.current) setThreads([]);
      }
      if (thisFetchId === fetchIdRef.current) setLoadingMoreThreads(false);
      return;
    }

    // Collect all user IDs for batch profile fetch
    const userIds = new Set<string>();
    threadsData.forEach((t: Record<string, unknown>) => { if (t.user_id) userIds.add(t.user_id as string); });

    // Batch fetch latest post for ALL threads in ONE request (N+1 fix)
    const threadIds = threadsData.map((t: Record<string, unknown>) => t.id as string).join(',');
    const postsResponse = await fetch(`/api/v1/posts?thread_id=in.(${threadIds})&latest=true`);
    const postsResult = await postsResponse.json();
    const allLatestPosts: Record<string, unknown>[] = (postsResult.data || []) as Record<string, unknown>[];

    // Collect post author IDs
    allLatestPosts.forEach((p: Record<string, unknown>) => { if (p.user_id) userIds.add(p.user_id as string); });

    // Batch fetch all profiles (for is_anonymous + username)
    const profilesMap = new Map<string, { id: string; username: string; display_name?: string | null; nickname_emoji_id?: string | null; is_anonymous: boolean; avatar_url?: string | null }>();
    const userIdArray = [...userIds];
    if (userIdArray.length > 0) {
      const profilesResponse = await fetch(`/api/v1/profiles?id=in.(${userIdArray.join(',')})`);
      const profilesResult = await profilesResponse.json();
      (profilesResult.data || []).forEach((p: { id: string; username: string; display_name?: string | null; nickname_emoji_id?: string | null; is_anonymous: boolean; avatar_url?: string | null }) => profilesMap.set(p.id, p));
    }

    // Build result with profiles and latest posts
    const postsByThread = new Map<string, Record<string, unknown>[]>();
    allLatestPosts.forEach((p: Record<string, unknown>) => {
      const tid = p.thread_id as string;
      if (!postsByThread.has(tid)) postsByThread.set(tid, []);
      postsByThread.get(tid)!.push(p);
    });

    const threadsWithData = threadsData.map((thread: Record<string, unknown>) => {
      const profile = profilesMap.get(thread.user_id as string);
      const posts = postsByThread.get(thread.id as string) || [];
      const post = posts[0] as Record<string, unknown> | undefined;
      const postProfile = post ? profilesMap.get(post.user_id as string) : null;

      return {
        ...thread,
        profiles: profile ? { username: profile.username, display_name: profile.display_name, nickname_emoji_id: profile.nickname_emoji_id, is_anonymous: profile.is_anonymous, avatar_url: profile.avatar_url } : null,
        latest_post: post ? {
          content: post.content,
          created_at: post.created_at,
          is_private: post.is_private,
          user_id: post.user_id,
          profiles: postProfile ? { username: postProfile.username, display_name: postProfile.display_name, nickname_emoji_id: postProfile.nickname_emoji_id, is_anonymous: postProfile.is_anonymous, avatar_url: postProfile.avatar_url } : null,
        } : undefined,
      };
    });

    // Discard stale responses from cancelled channel switches
    if (thisFetchId !== fetchIdRef.current) {
      if (isLoadMore) setLoadingMoreThreads(false);
      return;
    }

    if (isLoadMore) {
      setThreads(prev => [...prev, ...(threadsWithData as Thread[])]);
    } else {
      setThreads(threadsWithData as Thread[]);
    }
    setLoadingMoreThreads(false);
  }, [searchParams, isGomoRoute, threadsCursor, channelSlug]);

  // Refs for stable callback access inside effects (breaks dependency cycle)
  const loadChannelsRef = useRef(loadChannels);
  loadChannelsRef.current = loadChannels;
  const loadThreadsRef = useRef(loadThreads);
  loadThreadsRef.current = loadThreads;
  const loadRosterRef = useRef<() => Promise<void>>(async () => {});
  const activeChannelIdRef = useRef(activeChannelId);
  activeChannelIdRef.current = activeChannelId;
  // Tracks which board the loaded thread list belongs to, so a channel switch
  // can keep the old list on screen instead of flashing empty content.
  const prevBoardIdRef = useRef<string | null>(null);
  const fetchIdRef = useRef(0);

  // Sync activeChannelId from URL channelSlug when channels are loaded
  useEffect(() => {
    if (!channels.length) return;
    if (!channelSlug) {
      setActiveChannelId(null);
      return;
    }
    const found = channels.find(ch => ch.slug === channelSlug);
    setActiveChannelId(found?.id || null);
  }, [channelSlug, channels]);
  useEffect(() => {
    const loadBoard = async () => {
      if (isGomoRoute && !authResolved) {
        setCheckingRules(true);
        return;
      }

      setPageLoading(true);
      // Show a warm row for this slug if we have one (SWR), otherwise clear.
      setBoard(slug ? peekCached<Board>(boardBySlugUrl(slug)) ?? null : null);
      setThreadsSettled(false);
      setThreads([]);
      setThreadsCursor(null);
      setHasMoreThreads(true);
      setShowRulesDialog(false);
      setHasAcceptedRules(!isGomoRoute);
      setCheckingRules(isGomoRoute);
      // Reset channels when board changes (not on channel switch)
      setChannels([]);
      setActiveChannelId(null);

      const boardData = await loadBoardBySlug(slug);

      if (boardData) {
        setRulesConfirmed(false);

        if (boardData.is_gomosub && boardData.rules_markdown?.trim()) {
          setCheckingRules(true);
          const rulesVersion = boardData.rules_updated_at || "v1";
          let accepted = false;

          if (user?.id) {
            try {
              const acceptanceResponse = await fetch(`/api/v1/gomosub_rules_acceptance?user_id=eq.${user.id}&board_id=eq.${boardData.id}`);
              if (acceptanceResponse.ok) {
                const acceptanceResult = await acceptanceResponse.json();
                const acceptance = acceptanceResult.data?.[0];

                if (acceptance?.accepted_at) {
                  accepted = !boardData.rules_updated_at || new Date(acceptance.accepted_at) >= new Date(boardData.rules_updated_at);
                }
              }
            } catch {
              // Non-JSON/network failure — fall through, the rules dialog will show.
            }
          } else {
            const storedVersion = localStorage.getItem(`gomosub-rules:${boardData.id}`);
            accepted = storedVersion === rulesVersion;
          }

          setHasAcceptedRules(accepted);
          setShowRulesDialog(!accepted);
          setCheckingRules(false);
        } else {
          setHasAcceptedRules(true);
          setShowRulesDialog(false);
          setCheckingRules(false);
        }

        setBoard(boardData);

        // Compact-header member count through the shared (warm) directory
        // cache — one request total, works for guests too.
        if (boardData.is_gomosub) {
          setMemberCount(null);
          getDirectoryMemberCount(boardData.id).then((count) => {
            if (count != null) setMemberCount(count);
          });
        }

        // Load user's permissions for gomosub management
        if (boardData.is_gomosub && user?.id) {
          try {
            const { data: { session } } = await api.auth.getSession();
            if (session?.access_token) {
              const permRes = await fetch(`/api/rpc/get_board_user_permissions?_board_id=${boardData.id}`, {
                headers: { Authorization: `Bearer ${session.access_token}` }
              });
              const permData = await permRes.json();
              if (permData.data) {
                setIsBoardOwner(permData.data.is_owner || false);
                setBoardPermissions(permData.data.permissions || {});
              }
            }
          } catch { /* ignore permission errors */ }
        }

        // Private gomosub access control
        if (boardData.is_gomosub && boardData.visibility === "private") {
          const isOwner = user?.id && boardData.owner_id === user.id;
          let isMember = false;
          if (!isOwner && user?.id) {
            isMember = (await getMyGomosubMembership(boardData.id, user.id)) !== null;
          }
          if (!isOwner && !isMember) {
            setPrivateAccessDenied(true);
            setPageLoading(false);
            setCheckingRules(false);
            return;
          }
        }

        if (boardData.is_gomosub) {
          await loadChannelsRef.current(boardData.id, boardData.owner_id);
        }

        if (boardData.slug === 'd') {
          const verified = sessionStorage.getItem('age_verified_d');
          if (!verified) {
            setShowAgeVerification(true);
            setPageLoading(false);			} else {
				setAgeVerified(true);
				setPageLoading(false);
			}
        } else {
          setPageLoading(false);
        }
      } else {
        setCheckingRules(false);
        setPageLoading(false);
      }
    };

    loadBoard();
  }, [slug, user, isGomoRoute, authResolved]);

  // gomosub entry lands on the bare slug = «Общий» feed — ALL board records,
  // from every channel. No auto-redirect, no channel-less filter trick: both
  // produced "empty until you click a channel" confusion (see history).

  // Thread load: runs when board is ready and channelSlug/board.id changes
  // This is SEPARATE from board load so switching channels is instant
  useEffect(() => {
    if (!board) return;
    if (board.slug === 'd' && !ageVerified && !isGomoRoute) return;
    // Wait for a gomosub board's channels to settle before the first fetch
    // (avoids a double fetch when the channel list arrives mid-flight).
    if (isGomoRoute && channels.length === 0) return;
    // Bare server URL has no union feed anymore: it redirects to the first
    // visible channel (or renders the no-channels empty state).
    if (isGomoRoute && !channelSlug) return;

    // Telegram-style channel switch: the previous list STAYS on screen until
    // the new one arrives (loadThreads replaces it in place). Clearing here
    // flashed an empty feed on every channel tap. Only a genuine board
    // change (different sub, cold entry) gets a real skeleton.
    const boardChanged = prevBoardIdRef.current !== board.id;
    prevBoardIdRef.current = board.id;
    if (boardChanged) {
      setThreadsSettled(false);
      setThreads([]);
      setThreadsCursor(null);
      setHasMoreThreads(true);
    } else {
      setThreadsCursor(null);
      setHasMoreThreads(true);
    }

    // Resolve channel ID directly from URL slug (not from async state)
    const resolvedChannelId = isGomoRoute && channelSlug
      ? channels.find(ch => ch.slug === channelSlug)?.id || null
      : null;

    const loadChannelThreads = async () => {
      setThreadsLoading(true);
      await loadThreadsRef.current(board.id, false, resolvedChannelId);
      setThreadsSettled(true);
      setThreadsLoading(false);
    };
    loadChannelThreads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.id, channelSlug, ageVerified, isGomoRoute, channels]);

  // Reload the thread list when the current user edits their profile: the
  // nickname emoji is embedded in the thread payload and would otherwise stay
  // stale until the next navigation.
  useProfileInvalidation(() => {
    if (!board) return;
    if (board.slug === 'd' && !ageVerified && !isGomoRoute) return;
    const resolvedChannelId = isGomoRoute && channelSlug
      ? channels.find(ch => ch.slug === channelSlug)?.id || null
      : null;
    loadThreadsRef.current(board.id, false, resolvedChannelId);
  });

  // Membership is resolved asynchronously per board; until the response lands
  // the join button renders a stable ghost, not a wrong "Вступить".
  const [membershipKnown, setMembershipKnown] = useState(false);

  const refreshMyMembership = useCallback(async () => {
    const needsFetch = Boolean(board?.is_gomosub && user?.id);
    // Ghost-button state ONLY while a real fetch is in flight; guests and
    // non-gomosub boards know "not joined" immediately.
    setMembershipKnown(!needsFetch);
    if (!board?.is_gomosub) {
      setIsJoined(false);
      return;
    }
    if (!user?.id) {
      setIsJoined(false);
      return;
    }

    if (board?.id && user?.id) invalidateGomosubMembership(board.id, user.id);
    const membership = board?.id && user?.id ? await getMyGomosubMembership(board.id, user.id) : null;
    setIsJoined(membership !== null);
    setMembershipKnown(true);
  }, [board?.id, board?.is_gomosub, user?.id]);

  useEffect(() => {
    refreshMyMembership();
  }, [refreshMyMembership]);

  // Real-time WebSocket subscription — replaces 30s polling
  useEffect(() => {
    if (!board) return;
    const room = `board_${board.id}`;
    wsService.subscribe(room);

    const unsub = wsService.on('new_thread', (message) => {
      const data = message.data as { board_id?: string } | undefined;
      // Only reload if the new thread belongs to this board
      if (data?.board_id === board.id) {
        loadThreadsRef.current(board.id, false, activeChannelIdRef.current);
      }
    });

    // Roster changes (join/leave/kick/ban/timeout/role grant) refetch the
    // member rail live; events about the viewer also refresh join state so
    // a kick/ban flips the join button without reload.
    const unsubMembers = wsService.on('gomosub_member_changed', (message) => {
      const data = message.data as { board_id?: string; user_id?: string } | undefined;
      if (data?.board_id !== board.id) return;
      if (data?.user_id && data.user_id === user?.id) {
        refreshMyMembership();
      }
      loadRosterRef.current();
    });

    return () => {
      unsub();
      unsubMembers();
      wsService.unsubscribe(room);
    };
  }, [board, user?.id, refreshMyMembership]);

  // Infinite scroll for threads — IntersectionObserver on sentinel
  useEffect(() => {
    if (pageLoading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreThreads && !loadingMoreThreads && board) {
          loadThreadsRef.current(board.id, true, activeChannelIdRef.current);
        }
      },
      { threshold: 0.1, rootMargin: '200px' }
    );

    if (threadsSentinelRef.current) {
      observer.observe(threadsSentinelRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [hasMoreThreads, loadingMoreThreads, board, pageLoading]);

  // Group channels: uncategorized first, then structured categories in
  // order, then legacy free-text buckets (groupChannels helper, tested).
  const channelCategories = useMemo(() => {
    if (!channels.length) return [] as { category: string; channels: Channel[] }[];
    return groupChannels(channels, categories).map((g) => ({ category: g.label, channels: g.channels }));
  }, [channels, categories]);

  // gomosub header tags (from the board row's gomosub_tags array)
  const gomosubTags = useMemo(() => {
    const tags = board?.gomosub_tags;
    return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0) : [];
  }, [board?.gomosub_tags]);

  const activeChannelSlug = useMemo(() => {    if (!activeChannelId) return null;
    return channels.find((ch) => ch.id === activeChannelId)?.slug || null;
  }, [activeChannelId, channels]);

  const activeChannelName = useMemo(() => {
    if (!activeChannelId) return null;
    return channels.find((ch) => ch.id === activeChannelId)?.name || null;
  }, [activeChannelId, channels]);

  // Text channels render a Discord-style chat instead of the thread list.
  const isTextChannel = useMemo(() => {
    if (!activeChannelId) return false;
    return channels.find((ch) => ch.id === activeChannelId)?.kind === "text";
  }, [activeChannelId, channels]);

  const activeChannelPrivate = useMemo(() => {
    if (!activeChannelId) return false;
    return Boolean(channels.find((ch) => ch.id === activeChannelId)?.is_private);
  }, [activeChannelId, channels]);

  const activeChannelKind = useMemo(() => {
    if (!activeChannelId) return undefined;
    return channels.find((ch) => ch.id === activeChannelId)?.kind;
  }, [activeChannelId, channels]);

  const activeChannelTopic = useMemo(() => {
    if (!activeChannelId) return null;
    return channels.find((ch) => ch.id === activeChannelId)?.description ?? null;
  }, [activeChannelId, channels]);

  // Direction of travel between channels in list order — the content slides
  // the way you moved (ProfileTabs pattern).
  useEffect(() => {
    const prev = prevActiveChannelRef.current;
    if (prev && activeChannelId && prev !== activeChannelId) {
      const order = channelCategories.flatMap((g) => g.channels);
      const from = order.findIndex((c) => c.id === prev);
      const to = order.findIndex((c) => c.id === activeChannelId);
      if (from !== -1 && to !== -1 && from !== to) setTravelDir(travelDirection(from, to));
    }
    prevActiveChannelRef.current = activeChannelId;
  }, [activeChannelId, channelCategories]);

  // While a text channel is open, request chrome-less full-bleed mode from
  // AppLayout (the site header is dropped — Discord-style) via the same
  // body-class + event contract the messenger mobile chat uses.
  useEffect(() => {
    if (!isTextChannel) return;
    document.body.classList.add("app-surface-active");
    window.dispatchEvent(new Event("gomo6:app-surface"));
    return () => {
      document.body.classList.remove("app-surface-active");
      window.dispatchEvent(new Event("gomo6:app-surface"));
    };
  }, [isTextChannel]);

  // Mobile: swipe up from the bottom edge to open the channel sheet. Listens
  // on document (not <main>) so gestures that start below the content area
  // still count, and only while the sheet is closed.
  //
  // The touchmove listener is non-passive and calls preventDefault from the
  // VERY FIRST move of an edge gesture: iOS will not stop a scroll that has
  // already started (preventDefault on later touchmoves is ignored once the
  // pan recognizer claims the gesture), so the bottom-edge gesture must never
  // start scrolling the feed — otherwise the sheet opens mid-scroll and the
  // posts behind keep sliding. The grab zone is the bottom 80px of the LEFT
  // HALF of the screen: the right half keeps normal feed scrolling, so the
  // sheet gesture doesn't eat the whole bottom bar.
  useEffect(() => {
    if (mobileChannelsOpen) return;
    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      if (window.innerHeight - touch.clientY <= EDGE_ZONE_HEIGHT && touch.clientX < window.innerWidth * EDGE_ZONE_WIDTH) {
        edgeSwipeStart.current = { x: touch.clientX, y: touch.clientY };
      } else {
        edgeSwipeStart.current = null;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!edgeSwipeStart.current) return;
      // Stop the browser from starting (or continuing) this scroll.
      e.preventDefault();
      const touch = e.touches[0];
      if (touch && touch.clientY - edgeSwipeStart.current.y < -48) {
        setMobileChannelsOpen(true);
        edgeSwipeStart.current = null;
      }
    };
    const onTouchEnd = () => {
      edgeSwipeStart.current = null;
    };
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove, { capture: true } as EventListenerOptions);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [mobileChannelsOpen]);

  // Lock the page scroll the INSTANT the sheet starts opening — vaul's own
  // scroll lock engages with a delay (it's disabled while dragging / just
  // released), so during the slide-up animation the feed behind can still
  // scroll. overflow:hidden on html+body stops it on Android; iOS ignores
  // overflow:hidden on the body, so touchmoves that start OUTSIDE the drawer
  // are prevented outright (touches inside the dialog — the channel list and
  // the drag handle — keep working).
  useEffect(() => {
    if (!mobileChannelsOpen) return;
    // A previous close may have scheduled a delayed scroll-lock release;
    // cancel it so reopening mid-animation doesn't unlock the page under the
    // still-open sheet.
    if (scrollLockReleaseTimer.current !== null) {
      window.clearTimeout(scrollLockReleaseTimer.current);
      scrollLockReleaseTimer.current = null;
    }
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    const prevOverscroll = document.documentElement.style.overscrollBehavior;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";

    const onTouchMove = (e: TouchEvent) => {
      // Outside the drawer: never let a touch scroll the feed behind.
      e.preventDefault();
    };
    document.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });

    return () => {
      // Keep the page scroll-locked until vaul's 0.5s close animation ends.
      // Restoring overflow mid-animation re-paints the feed underneath and
      // shows a one-frame flash.
      scrollLockReleaseTimer.current = window.setTimeout(() => {
        scrollLockReleaseTimer.current = null;
        document.documentElement.style.overflow = prevHtmlOverflow;
        document.body.style.overflow = prevBodyOverflow;
        document.documentElement.style.overscrollBehavior = prevOverscroll;
      }, 500);
      document.removeEventListener("touchmove", onTouchMove, { capture: true } as EventListenerOptions);
    };
  }, [mobileChannelsOpen]);

  // Leaving the page (or unmounting in tests): cancel pending close-animation
  // timers and release the scroll lock right away — no 0.5s hangover.
  useEffect(() => {
    return () => {
      if (scrollLockReleaseTimer.current !== null) {
        window.clearTimeout(scrollLockReleaseTimer.current);
        scrollLockReleaseTimer.current = null;
      }
      if (snapResetTimer.current !== null) {
        window.clearTimeout(snapResetTimer.current);
        snapResetTimer.current = null;
      }
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      document.documentElement.style.overscrollBehavior = "";
    };
  }, []);

  const { unread, markSeen } = useGomoSubUnread(user?.id ?? null, board?.id ?? null, channels);

  // Discord-like roster for the member rail (members + owner only; the RPC
  // enforces it, failures simply hide the rail).
  const loadRoster = useCallback(async () => {
    if (!isGomoRoute || !board?.id || !user?.id) {
      setRoster(null);
      return;
    }
    try {
      const { data: { session } } = await api.auth.getSession();
      const r = await fetch(`/api/rpc/gomosub_members?_board_id=${board.id}`, {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      const d = await r.json();
      if (r.ok && d?.success) setRoster(d.data);
      else setRoster(null);
    } catch {
      // Roster is best-effort — the page works without it.
    }
  }, [isGomoRoute, board?.id, user?.id]);

  useEffect(() => {
    if (!isJoined) {
      setRoster(null);
      return;
    }
    loadRoster();
  }, [isJoined, loadRoster]);
  loadRosterRef.current = loadRoster;

  // Per-row entrance motion needs the reduced-motion gate (no parent cascade
  // anymore — see the thread list below).
  const prefersReducedMotion = useReducedMotion();

  // Opened a channel → its unread dot clears at once.
  useEffect(() => {
    if (!isGomoRoute) return;
    markSeen(activeChannelId);
  }, [isGomoRoute, activeChannelId, markSeen]);

  // The channel drawer (mobile sheet) and the desktop sidebar share GomoSubChannelsList.
  const renderChannelList = (onSelect: () => void, query?: string) => (
    <GomoSubChannelsList
      boardSlug={slug ?? ""}
      groups={channelCategories}
      activeChannelSlug={activeChannelSlug}
      onNavigate={onSelect}
      unread={unread}
      query={query}
    />
  );

  const canCreateThread = user && (!board?.is_rules_board || isModerator);
  const hasSecondaryActions = isGomoRoute || (!isGomoRoute && (searchParams.get('content') || searchParams.get('format') || searchParams.get('atmosphere') || searchParams.get('flag')));

  // If the dynamic route caught the legacy gomosubs path, bounce to the dedicated page
  if (slug === "gomosubs") {
    return <Navigate to="/g" replace />;
  }

  // No "Общий" anymore: a bare server URL opens the first visible channel,
  // exactly like a Discord server opens its default channel. Channel-less
  // servers fall through to the empty state rendered in the content area.
  const firstVisibleChannel = channelCategories.flatMap((g) => g.channels)[0] ?? null;
  if (isGomoRoute && !channelSlug && board && channelsLoaded && firstVisibleChannel) {
    return <Navigate to={`/g/${slug}/c/${firstVisibleChannel.slug}`} replace />;
  }

  const renderContent = (text: string) => {
    return renderPreviewContent(text, 'board');
  };

  const handleAgeConfirm = async () => {
    sessionStorage.setItem('age_verified_d', 'true');
    setShowAgeVerification(false);
    setAgeVerified(true);		if (board) {
			loadThreadsRef.current(board.id);
		}
  };

  const handleAgeDecline = () => {
    navigate('/');
  };

  const rulesUpdatedLabel = board?.rules_updated_at
    ? formatDistanceToNow(safeDate(board.rules_updated_at), { addSuffix: true, locale: dateLocale })
    : null;

  const handleAcceptRules = async () => {
    if (!board?.is_gomosub || !board.rules_markdown?.trim()) {
      setShowRulesDialog(false);
      return;
    }

    if (!rulesConfirmed) {
      toast.error(t("board.rulesConfirmRequired"));
      return;
    }

    const rulesVersion = board.rules_updated_at || "v1";

    if (user?.id) {
      const token = apiClient.getToken();
      const csrf = apiClient.getCSRFToken();
      const response = await fetch('/api/v1/gomosub_rules_acceptance', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        },
        body: JSON.stringify({
          user_id: user.id,
          board_id: board.id,
          accepted_at: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        // Non-JSON error bodies (e.g. 404/500 from a missing route) must not
        // crash the dialog on JSON.parse.
        toast.error(t("board.rulesSaveError"));
        return;
      }
      const result = await response.json();

      if (!result.success) {
        toast.error(t("board.rulesSaveError"));
        return;
      }
    } else {
      localStorage.setItem(`gomosub-rules:${board.id}`, rulesVersion);
    }

    setHasAcceptedRules(true);
    setShowRulesDialog(false);
    toast.success(t("board.rulesAccepted"));
  };

  const handleToggleJoin = async () => {
    if (!board?.is_gomosub) return;
    if (!user?.id) {
      toast.error(t("board.joinRequiresLogin"));
      navigate("/auth");
      return;
    }
    if (membershipLoading) return;

    if (board.rules_markdown?.trim() && !hasAcceptedRules) {
      setShowRulesDialog(true);
      toast.error(t("board.joinRequiresRules"));
      return;
    }

    setMembershipLoading(true);
    const authHeaders: Record<string, string> = {};
    const token = apiClient.getToken();
    const csrf = apiClient.getCSRFToken();
    if (token) authHeaders['Authorization'] = `Bearer ${token}`;
    if (csrf) authHeaders['X-CSRF-Token'] = csrf;

    if (isJoined) {
      const response = await fetch(`/api/v1/gomosub_memberships?board_id=eq.${board.id}&user_id=eq.${user.id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: authHeaders,
      });
      const result = await response.json();

      setMembershipLoading(false);
      if (!result.success) {
        toast.error(t("board.leaveError"));
        return;
      }
      setIsJoined(false);
      toast.success(t("board.left"));
      if (memberCount != null) setMemberCount(Math.max(0, memberCount - 1));
      // Raw write bypasses query-builder — drop memberships/boards GET cache.
      invalidateByPrefix('/api/v1/gomosub_memberships');
      invalidateByPrefix('/api/v1/boards');
      invalidateGomosubMembership(board.id, user.id);
      return;
    }

    const response = await fetch('/api/v1/gomosub_memberships', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ board_id: board.id, user_id: user.id }),
    });
    const result = await response.json();

    setMembershipLoading(false);
    if (!result.success) {
      toast.error(t("board.joinError"));
      return;
    }
    setIsJoined(true);
    toast.success(t("board.joined"));
    // Raw write bypasses query-builder — drop memberships/boards GET cache.
    invalidateByPrefix('/api/v1/gomosub_memberships');
    invalidateByPrefix('/api/v1/boards');
    invalidateGomosubMembership(board.id, user.id);
  };

  // Cold board (no cached row, e.g. a deep link with no intent prefetch):
  // a shaped thread-list skeleton in the standard board container — same
  // geometry the list takes — so content fades in without reflow.
  if (!board) {
    return (
      <main className="max-w-5xl mx-auto p-2 sm:p-4 md:p-5 flex-1">
        <ThreadFeedSkeleton count={3} />
      </main>
    );
  }

  if (privateAccessDenied) {
    return (
      <main className="max-w-md mx-auto p-6 pt-20 text-center space-y-4">
        <Lock className="w-14 h-14 text-muted-foreground mx-auto" />
        <h1 className="text-xl font-bold">{t("board.privateSub")}</h1>
        <p className="text-sm text-muted-foreground">
          Этот g-саб доступен только по пригласительной ссылке.
          Попроси владельца поделиться ссылкой-приглашением.
        </p>
        <Button variant="outline" onClick={() => navigate("/g")}>
          К списку g-сабов
        </Button>
      </main>
    );
  }
  
  if (board.slug === 'd' && !ageVerified && !isGomoRoute) {
    return (
      <AgeVerification 
        open={showAgeVerification}
        onConfirm={handleAgeConfirm}
        onDecline={handleAgeDecline}
      />
    );
  }

  // Layout target must be known on the FIRST paint: a gomosub board will
  // always draw the channels sidebar, so it takes the wide container before
  // the channel list arrives (no max-w reflow on entry).
  const hasChannels = isGomoRoute && (channels.length > 0 || Boolean(board?.is_gomosub));

  return (
    <>
    {/* Text channels go Discord-style: full-bleed chat, no board header card.
        The chat lives INSIDE main (AppLayout sizes it to --app-vh via
        surface in normal document flow — nothing is fixed or resized and the
        WINDOW scrolls the whole chat, so iOS pans it up natively when the
        composer is focused (maximally native keyboard, no fight). */}
    <main className={`${isTextChannel ? "max-w-none" : hasChannels ? "max-w-6xl" : "max-w-5xl"} ${isTextChannel ? "" : "p-2 sm:p-4 md:p-5"} mx-auto flex-1 relative flex flex-col`}>
        {/* Board header — always full width (dropped for text channels: the
            Discord-style channel bar above the chat carries name + actions) */}
        {!isTextChannel && (<div className="mb-3 sm:mb-4 space-y-3">
          {board.is_gomosub ? (
            <RecedeOnScroll exitAt={0.75} leadPx={120}>
              <GomoSubHeader
                board={board}
                tags={gomosubTags}
                viewerId={user?.id ?? null}
                isJoined={isJoined}
                membershipPending={!membershipKnown}
                memberCount={memberCount}
                membershipLoading={membershipLoading}
                checkingRules={checkingRules}
                onToggleJoin={handleToggleJoin}
                joinLabel={t("board.join")}
                joinedLabel={t("board.member")}
                shareTitle={t("board.share")}
              />
            </RecedeOnScroll>
          ) : (
            <div className="text-center">
              <p className="text-sm sm:text-base text-muted-foreground">{board.description}</p>
            </div>
          )}

          {board.is_gomosub && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={springFor("soft", prefersReducedMotion)}
            >
              <BoardStoriesBar
                boardId={board.id}
                boardName={board.name}
                avatarUrl={board.gomosub_avatar_url}
                canPost={Boolean(isBoardOwner || boardPermissions.can_post_stories)}
              />
            </motion.div>
          )}

          {!isGomoRoute && (
          <>
          {/* Mobile Filters Button */}
          <div className="md:hidden mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 mx-auto"
            >
              <Filter className="w-4 h-4" />
              Фильтры
              {(searchParams.get('content') || searchParams.get('format') || searchParams.get('atmosphere') || searchParams.get('flag')) && (
                <Badge variant="secondary" className="ml-1">
                  {[searchParams.get('content'), searchParams.get('format'), searchParams.get('atmosphere'), searchParams.get('flag')].filter(Boolean).length}
                </Badge>
              )}
            </Button>

            {showFilters && (
              <Card className="mt-3 p-4 mx-auto max-w-md">
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium">{t("board.filters")}</h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowFilters(false)}
                      className="h-6 w-6 p-0"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>

                  {/* Content filters */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-2 block">{t("board.topic")}</label>
                    <div className="flex flex-wrap gap-1">
                      {CONTENT_TAGS.map(tag => (
                        <button
                          key={tag.value}
                          onClick={() => {
                            const params = new URLSearchParams(searchParams);
                            if (params.get('content') === tag.value) {
                              params.delete('content');
                            } else {
                              params.set('content', tag.value);
                            }
                            navigate(`?${params.toString()}`);
                          }}
                          className={`px-2 py-1 text-xs rounded border transition-colors ${
                            searchParams.get('content') === tag.value
                              ? 'bg-blue-500/20 text-blue-700 border-blue-500/40'
                              : 'bg-background hover:bg-blue-500/10 border-border hover:border-blue-500/30'
                          }`}
                        >
                          {tag.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Format filters */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-2 block">{t("board.format")}</label>
                    <div className="flex flex-wrap gap-1">
                      {FORMAT_TAGS.map(tag => (
                        <button
                          key={tag.value}
                          onClick={() => {
                            const params = new URLSearchParams(searchParams);
                            if (params.get('format') === tag.value) {
                              params.delete('format');
                            } else {
                              params.set('format', tag.value);
                            }
                            navigate(`?${params.toString()}`);
                          }}
                          className={`px-2 py-1 text-xs rounded border transition-colors ${
                            searchParams.get('format') === tag.value
                              ? 'bg-green-500/20 text-green-700 border-green-500/40'
                              : 'bg-background hover:bg-green-500/10 border-border hover:border-green-500/30'
                          }`}
                        >
                          {tag.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Atmosphere filters */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-2 block">{t("board.atmosphere")}</label>
                    <div className="flex flex-wrap gap-1">
                      {ATMOSPHERE_TAGS.map(tag => (
                        <button
                          key={tag.value}
                          onClick={() => {
                            const params = new URLSearchParams(searchParams);
                            if (params.get('atmosphere') === tag.value) {
                              params.delete('atmosphere');
                            } else {
                              params.set('atmosphere', tag.value);
                            }
                            navigate(`?${params.toString()}`);
                          }}
                          className={`px-2 py-1 text-xs rounded border transition-colors ${
                            searchParams.get('atmosphere') === tag.value
                              ? 'bg-purple-500/20 text-purple-700 border-purple-500/40'
                              : 'bg-background hover:bg-purple-500/10 border-border hover:border-purple-500/30'
                          }`}
                        >
                          {tag.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Flag filters */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-2 block">{t("board.type")}</label>
                    <div className="flex flex-wrap gap-1">
                      {FLAG_TAGS.map(tag => (
                        <button
                          key={tag.value}
                          onClick={() => {
                            const params = new URLSearchParams(searchParams);
                            if (params.get('flag') === tag.value) {
                              params.delete('flag');
                            } else {
                              params.set('flag', tag.value);
                            }
                            navigate(`?${params.toString()}`);
                          }}
                          className={`px-2 py-1 text-xs rounded border transition-colors ${
                            searchParams.get('flag') === tag.value
                              ? 'bg-orange-500/20 text-orange-700 border-orange-500/40'
                              : 'bg-background hover:bg-orange-500/10 border-border hover:border-orange-500/30'
                          }`}
                        >
                          {tag.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            )}
          </div>

          {/* Desktop filters - keep original style */}
          <div className="hidden md:block mt-3">
            <div className="flex flex-wrap justify-center gap-1 max-w-4xl mx-auto">
              {/* Content filters */}
              <div className="flex flex-wrap gap-1">
                <span className="text-xs text-muted-foreground self-center mr-1">{t("board.topic")}</span>
                {CONTENT_TAGS.map(tag => (
                  <button
                    key={tag.value}
                    onClick={() => {
                      const params = new URLSearchParams(searchParams);
                      if (params.get('content') === tag.value) {
                        params.delete('content');
                      } else {
                        params.set('content', tag.value);
                      }
                      navigate(`?${params.toString()}`);
                    }}
                    className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                      searchParams.get('content') === tag.value
                        ? 'bg-blue-500/20 text-blue-700 border-blue-500/40'
                        : 'bg-background hover:bg-blue-500/10 border-border hover:border-blue-500/30'
                    }`}
                  >
                    {tag.label}
                  </button>
                ))}
              </div>

              {/* Format filters */}
              <div className="flex flex-wrap gap-1">
                <span className="text-xs text-muted-foreground self-center mr-1">{t("board.format")}</span>
                {FORMAT_TAGS.map(tag => (
                  <button
                    key={tag.value}
                    onClick={() => {
                      const params = new URLSearchParams(searchParams);
                      if (params.get('format') === tag.value) {
                        params.delete('format');
                      } else {
                        params.set('format', tag.value);
                      }
                      navigate(`?${params.toString()}`);
                    }}
                    className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                      searchParams.get('format') === tag.value
                        ? 'bg-green-500/20 text-green-700 border-green-500/40'
                        : 'bg-background hover:bg-green-500/10 border-border hover:border-green-500/30'
                    }`}
                  >
                    {tag.label}
                  </button>
                ))}
              </div>

              {/* Atmosphere filters */}
              <div className="flex flex-wrap gap-1">
                <span className="text-xs text-muted-foreground self-center mr-1">{t("board.atmosphere")}</span>
                {ATMOSPHERE_TAGS.map(tag => (
                  <button
                    key={tag.value}
                    onClick={() => {
                      const params = new URLSearchParams(searchParams);
                      if (params.get('atmosphere') === tag.value) {
                        params.delete('atmosphere');
                      } else {
                        params.set('atmosphere', tag.value);
                      }
                      navigate(`?${params.toString()}`);
                    }}
                    className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                      searchParams.get('atmosphere') === tag.value
                        ? 'bg-purple-500/20 text-purple-700 border-purple-500/40'
                        : 'bg-background hover:bg-purple-500/10 border-border hover:border-purple-500/30'
                    }`}
                  >
                    {tag.label}
                  </button>
                ))}
              </div>

              {/* Flag filters */}
              <div className="flex flex-wrap gap-1">
                <span className="text-xs text-muted-foreground self-center mr-1">{t("board.type")}</span>
                {FLAG_TAGS.map(tag => (
                  <button
                    key={tag.value}
                    onClick={() => {
                      const params = new URLSearchParams(searchParams);
                      if (params.get('flag') === tag.value) {
                        params.delete('flag');
                      } else {
                        params.set('flag', tag.value);
                      }
                        navigate(`?${params.toString()}`);
                    }}
                    className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                      searchParams.get('flag') === tag.value
                        ? 'bg-orange-500/20 text-orange-700 border-orange-500/40'
                        : 'bg-background hover:bg-orange-500/10 border-border hover:border-orange-500/30'
                    }`}
                  >
                    {tag.label}
                  </button>
                ))}
              </div>
        </div>
        </div>{/* end flex container */}
          {(searchParams.get('content') || searchParams.get('format') || searchParams.get('atmosphere') || searchParams.get('flag') || searchParams.get('tag')) && (
            <div className="mt-2 flex items-center justify-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">{t("board.filter")}</span>

              {searchParams.get('content') && (
                <span className="inline-block px-2 py-0.5 text-xs bg-blue-500/10 text-blue-600 rounded-full border border-blue-500/20">
                  {searchParams.get('content') === 'anime' && t("tags.content_anime")}
                  {searchParams.get('content') === 'games' && t("tags.content_games")}
                  {searchParams.get('content') === 'music' && t("tags.content_music")}
                  {searchParams.get('content') === 'movies' && t("tags.content_movies")}
                  {searchParams.get('content') === 'comics' && t("tags.content_comics")}
                  {searchParams.get('content') === 'humor' && t("tags.content_humor")}
                  {searchParams.get('content') === 'literature' && t("tags.content_literature")}
                  {searchParams.get('content') === 'stories' && t("tags.content_stories")}
                </span>
              )}

              {searchParams.get('format') && (
                <span className="inline-block px-2 py-0.5 text-xs bg-green-500/10 text-green-600 rounded-full border border-green-500/20">
                  {searchParams.get('format') === 'shitpost' && t("tags.format_shitpost")}
                  {searchParams.get('format') === 'discussion' && t("tags.format_discussion")}
                  {searchParams.get('format') === 'question' && t("tags.format_question")}
                  {searchParams.get('format') === 'confession' && t("tags.format_confession")}
                  {searchParams.get('format') === 'story' && t("tags.format_story")}
                  {searchParams.get('format') === 'guide' && t("tags.format_guide")}
                </span>
              )}

              {searchParams.get('atmosphere') && (
                <span className="inline-block px-2 py-0.5 text-xs bg-purple-500/10 text-purple-600 rounded-full border border-purple-500/20">
                  {searchParams.get('atmosphere') === 'serious' && t("tags.atmosphere_serious")}
                  {searchParams.get('atmosphere') === 'irony' && t("tags.atmosphere_irony")}
                  {searchParams.get('atmosphere') === 'vent' && t("tags.atmosphere_vent")}
                  {searchParams.get('atmosphere') === 'doom' && t("tags.atmosphere_doom")}
                </span>
              )}

              {searchParams.get('flag') && searchParams.get('flag') !== 'normal' && (
                <span className="inline-block px-2 py-0.5 text-xs bg-orange-500/10 text-orange-600 rounded-full border border-orange-500/20">
                  {searchParams.get('flag') === 'ephemeral' && t("tags.flag_ephemeral")}
                  {searchParams.get('flag') === 'night' && t("tags.flag_night")}
                </span>
              )}

              {/* Backward compatibility for old tag system */}
              {searchParams.get('tag') && !searchParams.get('content') && (
                <span className="inline-block px-2 py-0.5 text-xs bg-primary/10 text-primary rounded-full border border-primary/20">
                  {searchParams.get('tag') === 'anime' && '🎬 Аниме'}
                  {searchParams.get('tag') === 'games' && '🎮 Игры'}
                  {searchParams.get('tag') === 'music' && '🎵 Музыка'}
                  {searchParams.get('tag') === 'sports' && '⚽ Спорт'}
                  {searchParams.get('tag') === 'movies' && '🎥 Фильмы'}
                  {searchParams.get('tag') === 'comics' && '📚 Комиксы'}
                  {searchParams.get('tag') === 'humor' && '😂 Юмор'}
                  {searchParams.get('tag') === 'literature' && '📖 Литература'}
                  {searchParams.get('tag') === 'stories' && '📝 Истории'}
                </span>
              )}

              <button
                onClick={() => navigate(`/${board.slug}`)}
                className="text-xs text-muted-foreground hover:text-primary transition-colors underline"
              >
                Сбросить
              </button>
            </div>
          )}
          </>
          )}
        </div>) }

        {/* Content area — with sidebar for gomosub, plain otherwise */}
        {hasChannels ? (
          <>
          <div
            className={`flex gap-0 ${isTextChannel ? "w-full" : "flex-1 min-h-0 -mx-2 sm:-mx-4 md:-mx-5"}`}
          >
            <motion.aside
              initial={false}
              animate={{
                width: sidebarCollapsed ? 0 : 240,
                opacity: sidebarCollapsed ? 0 : 1,
              }}
              transition={springFor("soft", prefersReducedMotion)}
              className="hidden md:block shrink-0 z-20 sticky top-2 self-start overflow-hidden"
            >
              <div className="mx-2 w-[224px] rounded-2xl border border-border/50 bg-surface/60 backdrop-blur-md shadow-sm flex flex-col max-h-[calc(100dvh-1.5rem)] overflow-hidden">
                {/* Sidebar header with collapse button */}
                <div className="flex items-center justify-between px-3 pt-3 pb-2">
                  <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest select-none">{t("board.channels")}</h3>
                  <button
                    onClick={() => setSidebarCollapsed(true)}
                    className="w-5 h-5 rounded-md flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50 active:scale-90 transition"
                    title={t("board.hideChannels")}
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                </div>
                {/* Channel search — filters the list below */}
                <div className="px-3 pb-2">
                  <div className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-muted/50 border border-transparent focus-within:border-primary/40 transition-colors">
                    <Search className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60" />
                    <input
                      value={channelQuery}
                      onChange={(e) => setChannelQuery(e.target.value)}
                      placeholder="Поиск каналов"
                      aria-label="Поиск каналов"
                      className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
                    />
                    {channelQuery && (
                      <button
                        onClick={() => setChannelQuery("")}
                        aria-label="Очистить поиск"
                        className="shrink-0 text-muted-foreground/60 hover:text-foreground active:scale-90 transition"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                {/* Channel list — scrollable (fills the card inside the chat surface) */}
                <div className="overflow-y-auto px-3 pb-3 flex-1 min-h-0">

                {renderChannelList(() => {}, channelQuery)}
                
                {/* Quick actions at bottom of sidebar */}
                <div className="mt-3 pt-3 border-t border-border/40 px-2 space-y-1">
                  {board.rules_markdown?.trim() && (
                    <button
                      onClick={() => setShowRulesDialog(true)}
                      disabled={checkingRules}
                      className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                    >
                      <BookOpenText className="w-3.5 h-3.5 shrink-0" />
                      <span>{t("board.rules")}</span>
                    </button>
                  )}
                  {user?.id && (isBoardOwner || boardPermissions.can_manage_channels || boardPermissions.can_manage_roles || boardPermissions.can_manage_members) && (
                    <NavigationLink
                      to={`/g/${slug}/settings`}
                      className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                    >
                      <Settings className="w-3.5 h-3.5 shrink-0" />
                      <span>{t("board.settings")}</span>
                    </NavigationLink>
                  )}
                  {roster && (
                    <button
                      onClick={() => setShowMembers((v) => !v)}
                      className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                      title="Показать или скрыть участников"
                    >
                      <Users className="w-3.5 h-3.5 shrink-0" />
                      <span>Участники · {roster.members.length}</span>
                    </button>
                  )}
                </div>
                </div>
              </div>
            </motion.aside>
            
            {/* Expand button — only visible when sidebar is collapsed */}
            {sidebarCollapsed && (
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="hidden md:flex shrink-0 sticky top-4 self-start ml-2 w-7 h-7 rounded-lg border border-border/50 bg-card/85 backdrop-blur-md shadow-md hover:shadow-lg hover:bg-surface items-center justify-center text-muted-foreground hover:text-foreground transition-all z-20"
                title={t("board.showChannels")}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
            
            {/* Content area — scrolls independently. The unified channel bar
                above stays pinned while the page (window) scrolls. */}
            <div className={`min-w-0 flex flex-col flex-1 ${isTextChannel ? "" : "p-2 sm:p-4 md:p-5"}`}>
              <GomoSubChannelBar
                channelKey={activeChannelId ?? "none"}
                direction={travelDir}
                channelName={activeChannelName || activeChannelSlug || ""}
                channelTopic={activeChannelTopic}
                isPrivate={activeChannelPrivate}
                kind={activeChannelKind}
                boardSlug={slug ?? ""}
                onOpenChannels={() => setMobileChannelsOpen(true)}
                channelsTitle={t("board.channels")}
                generalLabel={t("board.general")}
                membersCount={roster ? roster.members.length : null}
                membersActive={showMembers}
                onToggleMembers={() => setShowMembers((v) => !v)}
                onShare={() => {
                  const url = `${window.location.origin}/g/${board.slug}`;
                  navigator.clipboard.writeText(url).then(() => {
                    toast.success(t("board.linkCopied"));
                  }).catch(() => {
                    toast.error(t("board.linkCopyError"));
                  });
                }}
                shareTitle={t("board.share")}
                joinVisible
                isJoined={isJoined}
                joinDisabled={membershipLoading || checkingRules}
                onToggleJoin={handleToggleJoin}
                joinLabel={t("board.join")}
                memberLabel={t("board.member")}
                canCreate={Boolean(canCreateThread && !isTextChannel)}
                onCreate={() =>
                  navigate(
                    isGomoRoute
                      ? activeChannelSlug
                        ? `/g/${slug}/c/${activeChannelSlug}/create`
                        : `/g/${slug}/create`
                      : `/create?board=${slug}`,
                    { state: { backgroundLocation: location } }
                  )
                }
                createLabel={t("board.createThread")}
                hasRules={Boolean(board.rules_markdown?.trim())}
                onOpenRules={() => setShowRulesDialog(true)}
                canManage={Boolean(user?.id && (isBoardOwner || boardPermissions.can_manage_channels || boardPermissions.can_manage_roles || boardPermissions.can_manage_members))}
                onOpenSettings={() => navigate(`/g/${slug}/settings`)}
              />

              <motion.div
                key={activeChannelId ?? "all"}
                initial={prefersReducedMotion ? false : { opacity: 0, x: travelDir * 14 }}
                animate={{ opacity: 1, x: 0 }}
                transition={prefersReducedMotion ? { duration: 0 } : { ...SPRING.standard, opacity: { duration: 0.16, ease: EASE_OUT_EXPO } }}
                className={`relative flex-1 ${isTextChannel ? "flex flex-col min-h-0" : "space-y-2"}`}>
                {/* Text channels replace the thread list with a Discord-style chat */}
                {isTextChannel && activeChannelId ? (
                  <ChannelChat
                    channelId={activeChannelId}
                    channelName={activeChannelName || activeChannelSlug || undefined}
                    currentUserId={user?.id ?? null}
                    canPost={Boolean(user?.id && isJoined)}
                    canDeleteOthers={Boolean(isBoardOwner || boardPermissions.can_delete_threads)}
                  />
                ) : isGomoRoute && !channelSlug && channelsLoaded && channelCategories.length === 0 ? (
                <div className="rounded-2xl border border-border/60 bg-surface p-8 text-center space-y-3">
                  <Hash className="w-8 h-8 mx-auto text-muted-foreground/50" />
                  {channels.length === 0 ? (
                    <div>
                      <div className="font-semibold">В сообществе пока нет каналов</div>
                      <p className="text-sm text-muted-foreground mt-1">Записи живут в каналах — создай первый в настройках.</p>
                    </div>
                  ) : (
                    <div>
                      <div className="font-semibold">Нет доступных каналов</div>
                      <p className="text-sm text-muted-foreground mt-1">У твоих ролей нет прав на просмотр каналов этого сообщества.</p>
                    </div>
                  )}
                  {channels.length === 0 && (isBoardOwner || boardPermissions.can_manage_channels) && (
                    <Button size="sm" className="rounded-lg" onClick={() => navigate(`/g/${slug}/settings`)}>К настройкам</Button>
                  )}
                </div>
                ) : (
                <>
                {/* Thread content — same as non-gomosub version below.
                    Warm entry shows NOTHING while loading: no fake-post
                    skeleton, no loading pills, no mid-flight empty state.
                    The list simply appears (cascade) when ready. */}
                {pageLoading ? null : (
                  <>
                {!isTextChannel && (
                  <div className={isTextChannel ? undefined : "space-y-2"}>
                    {threads.map((thread, index) => {
                      const card = (
                        <GomoThreadCard
                          thread={thread}
                          currentUserId={user?.id ?? null}
                          currentUsername={currentUsername}
                          currentUserColor={currentUserColor}
                          boardPath={`${pathPrefix}/${slug}${channelSlug ? `/c/${channelSlug}` : ""}`}
                          sourceLabel={activeChannelName || board?.name || undefined}
                          onImageClick={(items, idx) => {
                            setGalleryItems(items);
                            setGalleryIndex(idx);
                          }}
                        />
                      );
                      // Per-row entrance: self-driven initial/animate, NOT variant
                      // propagation from a parent. A re-render (channel load race,
                      // WS update) between mount and animation used to swallow the
                      // parent's "show" and leave rows permanently opacity-0 —
                      // that was the invisible-records bug on gomosub channels.
                      if (index < 6 && !prefersReducedMotion) {
                        return (
                          <motion.div
                            key={thread.id}
                            data-motion="cascade-row"
                            variants={streamRowVariants(index)}
                            initial="hidden"
                            animate="show"
                          >
                            {card}
                          </motion.div>
                        );
                      }
                      return <div key={thread.id}>{card}</div>;
                    })}
                  </div>
                )}
                  </>
                )}
                </>
                )}
              </motion.div>

              {!isTextChannel && threads.length === 0 && threadsSettled && !pageLoading && !threadsLoading && (
                <div className="text-center text-muted-foreground p-8">
                  Записей пока нет. Будьте первым!
                </div>
              )}

              <div ref={threadsSentinelRef} className={isTextChannel ? "hidden" : "py-4"}>
                {loadingMoreThreads && (
                  <div className="flex justify-center">
                    <Skeleton className="h-5 w-28 rounded-full" />
                  </div>
                )}
                {!hasMoreThreads && threads.length > 0 && (
                  <div className="text-center text-muted-foreground py-2 text-sm">
                    Все записи загружены
                  </div>
                )}
              </div>
            </div>

            {/* Member roster rail — Discord-like right column. */}
            <AnimatePresence initial={false}>
            {roster && showMembers && (
              <motion.aside
                key="roster"
                initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.97, x: 12 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, x: 12 }}
                transition={morphTransition(prefersReducedMotion)}
                style={{ transformOrigin: "100% 0%" }}
                className="hidden xl:block w-60 shrink-0 sticky top-2 self-start"
              >
                <div className="rounded-2xl border border-border/50 bg-surface/60 backdrop-blur-md shadow-sm max-h-[calc(100dvh-1.5rem)] overflow-y-auto p-2">
                  <GomoSubMemberList roles={roster.roles} members={roster.members} />
                </div>
              </motion.aside>
            )}
            </AnimatePresence>
          </div>

          {/* Mobile channel sheet — Discord-style server drawer as a bottom
              sheet: server header, channel search, sectioned channels with
              unread dots, members and quick actions. Picking a channel
              navigates and closes the sheet; the drawer must be full-height
              (h-full) for vaul's snap-point transform math to work. */}
          <Drawer
            open={mobileChannelsOpen}
            onOpenChange={(open) => {
              setMobileChannelsOpen(open);
              if (open) {
                // Reopening — cancel any pending snap-point reset so the sheet
                // doesn't jump to 40% mid-open.
                if (snapResetTimer.current !== null) {
                  window.clearTimeout(snapResetTimer.current);
                  snapResetTimer.current = null;
                }
              } else if (snapResetTimer.current === null) {
                // Reset after the close animation, so the sheet slides down
                // from its current snap point instead of snapping back to 40%
                // mid-animation (a visible blink). The search resets too so a
                // filtered sheet never reopens filtered.
                setChannelQuery("");
                snapResetTimer.current = window.setTimeout(() => {
                  snapResetTimer.current = null;
                  setChannelSheetSnapPoint(0.4);
                }, 500);
              }
            }}
            snapPoints={[0.4, 1]}
            activeSnapPoint={channelSheetSnapPoint}
            setActiveSnapPoint={(sp) => setChannelSheetSnapPoint(sp as number)}
            shouldScaleBackground={false}
            handleOnly
          >
            <DrawerContent showDefaultHandle={false} className="rounded-t-2xl mt-0 flex h-full flex-col">
              {/* Drag handle — thin pill. vaul's default handle is a fat
                  full-width bar; inline styles neutralize it. */}
              <DrawerHandle
                style={{ background: "transparent", height: "auto" }}
                className={`w-full shrink-0 flex justify-center cursor-grab active:cursor-grabbing touch-none ${
                  channelSheetSnapPoint === 1
                    ? // Full screen: the sheet's top edge touches the viewport
                      // top, so push the handle below the status bar / notch.
                      "pt-[calc(env(safe-area-inset-top)+1.25rem)] pb-1.5"
                    : "pt-2 pb-1.5"
                }`}
              >
                <div className="h-1 w-10 rounded-full bg-muted-foreground/25" />
              </DrawerHandle>
              <DrawerTitle className="sr-only">{t("board.channels")}</DrawerTitle>
              {/* Board header */}
              <div className="px-4 py-3 border-b border-border/60 flex items-center gap-3 shrink-0">
                <div className="w-12 h-12 rounded-lg bg-muted overflow-hidden flex items-center justify-center text-lg font-bold text-muted-foreground shrink-0">
                  {board.gomosub_avatar_url ? (
                    <img
                      src={storageUrl("post-images", board.gomosub_avatar_url) || board.gomosub_avatar_url}
                      alt={board.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span>{(board.name?.[0] || "g").toUpperCase()}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-primary truncate">g/{board.slug}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {board.name}
                    {memberCount != null && ` · ${memberCount}`}
                  </div>
                </div>
                {/* Full sheet: close button. Compact sheet: a + to write a
                    post in the active channel (or general) without leaving
                    the picker. */}
                {channelSheetSnapPoint === 1 ? (
                  <button
                    onClick={() => setMobileChannelsOpen(false)}
                    aria-label={t("common.close")}
                    className="ml-auto shrink-0 p-2 -mr-2 rounded-full text-muted-foreground hover:bg-muted/70 hover:text-foreground active:scale-95 transition"
                  >
                    <X className="w-5 h-5" />
                  </button>
                ) : canCreateThread ? (
                  <button
                    onClick={() => {
                      setMobileChannelsOpen(false);
                      navigate(activeChannelSlug ? `/g/${slug}/c/${activeChannelSlug}/create` : `/g/${slug}/create`, {
                        state: { backgroundLocation: location },
                      });
                    }}
                    aria-label={t("board.createThread")}
                    className="ml-auto shrink-0 p-2 -mr-2 rounded-full text-primary hover:bg-primary/10 active:scale-95 transition"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                ) : null}
              </div>
              {/* Channel search — same filter as the desktop sidebar */}
              <div className="px-4 pt-2 shrink-0">
                <div className="flex items-center gap-1.5 h-9 px-2.5 rounded-lg bg-muted/50 border border-transparent focus-within:border-primary/40 transition-colors">
                  <Search className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60" />
                  <input
                    value={channelQuery}
                    onChange={(e) => setChannelQuery(e.target.value)}
                    placeholder="Поиск каналов"
                    aria-label="Поиск каналов"
                    className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
                  />
                  {channelQuery && (
                    <button
                      onClick={() => setChannelQuery("")}
                      aria-label="Очистить поиск"
                      className="shrink-0 text-muted-foreground/60 hover:text-foreground active:scale-90 transition"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {/* Channel list */}
              <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5 min-h-0">
                {/* Picking a channel navigates and closes the sheet (Discord behaviour). */}
                {renderChannelList(() => setMobileChannelsOpen(false), channelQuery)}
                {mobileShowMembers && roster && (
                  <div className="mt-3 pt-3 border-t border-border/40">
                    <GomoSubMemberList roles={roster.roles} members={roster.members} />
                  </div>
                )}
              </div>
              {/* Quick actions */}
              <div className="px-3 py-3 border-t border-border/60 space-y-1 shrink-0">
                {roster && (
                  <button
                    onClick={() => setMobileShowMembers((v) => !v)}
                    className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                  >
                    <Users className="w-4 h-4 shrink-0" />
                    <span>Участники · {roster.members.length}</span>
                  </button>
                )}
                {board.rules_markdown?.trim() && (
                  <button
                    onClick={() => { setMobileChannelsOpen(false); setShowRulesDialog(true); }}
                    disabled={checkingRules}
                    className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                  >
                    <BookOpenText className="w-4 h-4 shrink-0" />
                    <span>{t("board.rules")}</span>
                  </button>
                )}
                {user?.id && (isBoardOwner || boardPermissions.can_manage_channels || boardPermissions.can_manage_roles || boardPermissions.can_manage_members) && (
                  <NavigationLink
                    to={`/g/${slug}/settings`}
                    onClick={() => setMobileChannelsOpen(false)}
                    className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                  >
                    <Settings className="w-4 h-4 shrink-0" />
                    <span>{t("board.settings")}</span>
                  </NavigationLink>
                )}
              </div>
            </DrawerContent>
          </Drawer>
          </>
        ) : (
          <>
            <div className="mb-3 sm:mb-4">
              <div className="flex items-center gap-2 sm:flex-row sm:items-center sm:justify-between">
                {canCreateThread && (
                  <Button
                    onClick={() =>
                      navigate(
                        isGomoRoute
                          ? activeChannelSlug
                            ? `/g/${slug}/c/${activeChannelSlug}/create`
                            : `/g/${slug}/create`
                          : `/create?board=${slug}`,
                        { state: { backgroundLocation: location } }
                      )
                    }
                    className="h-8 w-8 p-0 rounded-lg sm:h-10 sm:w-auto sm:px-4 sm:text-sm"
                  >
                    <Plus className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">{t("board.createThread")}</span>
                  </Button>
                )}
                {hasSecondaryActions && (
                  <div className="flex items-center gap-2 ml-auto">
                    {isGomoRoute && board.rules_markdown?.trim() && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowRulesDialog(true)}
                        className="h-8 px-3 text-xs sm:h-9 sm:text-sm rounded-lg border-primary/35 text-primary hover:bg-primary/10"
                        disabled={checkingRules}
                      >
                        <BookOpenText className="w-3.5 h-3.5 mr-1.5" />
                        Правила
                      </Button>
                    )}
                    {isGomoRoute && user?.id && (isBoardOwner || boardPermissions.can_manage_channels || boardPermissions.can_manage_roles || boardPermissions.can_manage_members) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/g/${slug}/settings`)}
                        className="h-8 px-3 text-xs sm:h-9 sm:text-sm rounded-lg border-primary/35 text-primary hover:bg-primary/10"
                      >
                        Настройки
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>


        <div className="space-y-2 relative">
          {pageLoading ? null : (
            <>
                    {threads.map((thread) => (
                      isGomoRoute ? (
                <Card key={thread.id} className="border-border/70 bg-card/95 p-0 overflow-hidden hover:border-primary/35 transition-colors rounded-xl">
                  <div className="p-3 sm:p-5">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <UserBadge
                          userId={thread.user_id}
                          userPublicId={thread.user_public_id}
                          username={thread.profiles?.username || t("common.anonymous")}
                          isAnonymous={thread.profiles?.is_anonymous}
                          disableLink={true}
                          className="text-sm"
                        />
                        <span>
                          {formatDistanceToNow(safeDate(thread.created_at), {
                            locale: dateLocale,
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                      <div className="h-px bg-border/35" />

                      <NavigationLink
                        to={`${pathPrefix}/${slug}${channelSlug ? `/c/${channelSlug}` : ""}/thread/${entityParam(thread)}`}
                        className="block group/title"
                      >
                        <h3 className="font-bold text-lg sm:text-[1.35rem] leading-tight break-words group-hover/title:text-primary transition-colors">
                          {thread.title}
                        </h3>
                      </NavigationLink>

                      {Array.isArray(thread.tags?.gomosub_tags) && thread.tags.gomosub_tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {thread.tags.gomosub_tags.map((tag: string) => (
                            <span
                              key={`${thread.id}-g-${tag}`}
                              className="inline-block px-2 py-0.5 text-xs bg-primary/10 text-primary rounded-full border border-primary/20"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="relative">
                        <div
                          className={`text-sm sm:text-base text-foreground/90 whitespace-pre-wrap break-words leading-relaxed ${thread.content.length > 900 ? "max-h-72 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]" : ""}`}
                        >
                          {hasVisibilityTags(thread.content)
                            ? t("board.openThreadToView")
                            : renderContent(thread.content)}
                        </div>
                        {thread.content.length > 900 && (
                          <NavigationLink
                            to={`${pathPrefix}/${slug}${channelSlug ? `/c/${channelSlug}` : ""}/thread/${entityParam(thread)}`}
                            className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80 mt-2"
                          >
                            Читать полностью
                            <ArrowUpRight className="w-4 h-4" />
                          </NavigationLink>
                        )}
                      </div>

                      {thread.image_url && (
                        <NavigationLink to={`${pathPrefix}/${slug}${channelSlug ? `/c/${channelSlug}` : ""}/thread/${entityParam(thread)}`} className="block pt-1">
                          <img
                            src={storageUrl("content", thread.image_url) || thread.image_url}
                            alt="Thread"
                            className="max-w-[220px] sm:max-w-[280px] max-h-40 sm:max-h-48 object-cover rounded-md"
                          />
                        </NavigationLink>
                      )}

                      <div className="h-px bg-border/35 mt-1" />
                      <div className="pt-2 flex items-center justify-between text-sm text-muted-foreground">
                        <LikeButton
                          postId={thread.id}
                          currentUserId={user?.id ?? null}
                          postAuthorId={thread.user_id}
                          isThread={true}
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => navigate(`${pathPrefix}/${slug}${channelSlug ? `/c/${channelSlug}` : ""}/thread/${entityParam(thread)}`)}
                          className="h-9 rounded-full px-3 gap-2"
                        >
                          <MessageCircle className="w-4 h-4" />
                          {thread.post_count > 0 ? thread.post_count : 0}
                        </Button>
                      </div>

                      {thread.latest_post?.content && (
                        <div className="rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
                          <span className="font-medium">{t("board.lastComment")}</span>{" "}
                          {thread.latest_post.content.slice(0, 120)}
                          {thread.latest_post.content.length > 120 && "..."}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ) : (
                <NavigationLink
                  key={thread.id}
                  to={`${pathPrefix}/${slug}/thread/${entityParam(thread)}`}
                  className="block border border-border bg-surface p-2 sm:p-3 hover:bg-thread-hover transition-all duration-200 group"
                >
                  {/* Mobile Layout */}
                  <div className="md:hidden">
                    <div className="space-y-3">
                      {/* User info and time */}
                      <div className="flex items-center justify-between">
                        <UserBadge
                          userId={thread.user_id}
                          userPublicId={thread.user_public_id}
                          username={thread.profiles?.username || t("common.anonymous")}
                          displayName={thread.profiles?.display_name}
                          emojiId={thread.profiles?.nickname_emoji_id}
                          isAnonymous={thread.profiles?.is_anonymous}
                          disableLink={true}
                          className="text-sm"
                        />
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(safeDate(thread.created_at), {
                            locale: dateLocale,
                            addSuffix: true,
                          })}
                        </span>
                      </div>

                      {/* Thread Title */}
                      <h3 className="font-bold text-lg break-words">
                        {thread.title}
                      </h3>

                      {/* Tags */}
                      <div>
                        {renderTags(thread.tags as Record<string, string>, 'mobile')}
                      </div>

                      {/* Thread Content Preview */}
                      <div className="text-sm text-muted-foreground line-clamp-3 break-words">
                        {hasVisibilityTags(thread.content) ? t("board.openThreadToView") : (
                          <>
                            {renderContent(thread.content.substring(0, 200))}
                            {thread.content.length > 200 && '...'}
                          </>
                        )}
                      </div>

                      {/* Thread Image - Large and prominent at bottom */}
                      {thread.image_url && (
                        <div className="w-full">
                          <img
                            src={storageUrl("content", thread.image_url) || thread.image_url}
                            alt="Thread"
                            className="w-full h-48 object-cover border border-border rounded-lg"
                          />
                        </div>
                      )}

                      {/* Reply count */}
                      <div className="flex justify-end">
                        <span className="text-xs text-muted-foreground">
                          {thread.post_count > 0
                            ? t("board.replies", { count: thread.post_count })
                            : t("board.noReplies")}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Desktop Layout */}
                  <div className="hidden md:block">
                    <div className="flex gap-4">
                      {/* Thread Image */}
                      <div className="flex-shrink-0">
                        {thread.image_url ? (
                          <img
                            src={storageUrl("content", thread.image_url) || thread.image_url}
                            alt="Thread"
                            className="w-24 h-24 object-cover border border-border rounded-lg"
                          />
                        ) : (
                          <div className="w-24 h-24 bg-muted border border-border rounded-lg flex items-center justify-center">
                            <span className="text-xs text-muted-foreground">{t("board.noPhoto")}</span>
                          </div>
                        )}
                      </div>

                      {/* Thread Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between mb-2">
                          <h3 className="font-bold text-lg break-words pr-4 transition-transform duration-200 group-hover:translate-x-0.5">
                            {thread.title}
                          </h3>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-sm text-muted-foreground">
                              {thread.post_count > 0
                                ? t("board.replies", { count: thread.post_count })
                                : t("board.noReplies")}
                            </span>
                        <UserBadge
                          userId={thread.user_id}
                          userPublicId={thread.user_public_id}
                          username={thread.profiles?.username || t("common.anonymous")}
                          displayName={thread.profiles?.display_name}
                          emojiId={thread.profiles?.nickname_emoji_id}
                          isAnonymous={thread.profiles?.is_anonymous}
                          disableLink={true}
                          className="text-sm"
                        />
                          </div>
                        </div>

                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-sm text-muted-foreground">
                            {formatDistanceToNow(safeDate(thread.created_at), {
                              locale: dateLocale,
                              addSuffix: true,
                            })}
                          </span>
                          <div className="flex-1">
                            {renderTags(thread.tags as Record<string, string>, 'inline')}
                          </div>
                        </div>

                        <p className="text-sm text-muted-foreground line-clamp-2 break-words">
                          {hasVisibilityTags(thread.content) ? t("board.openThreadToView") : (
                            <>
                              {renderContent(thread.content.substring(0, 300))}
                              {thread.content.length > 300 && '...'}
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                </NavigationLink>
              )
            ))}
            </>
          )}
        </div>

        {threads.length === 0 && threadsSettled && !pageLoading && !threadsLoading && (
          <div className="text-center text-muted-foreground p-8">
            Записей пока нет. Будьте первым!
          </div>
        )}

        {/* Infinite scroll sentinel for threads */}
        <div ref={threadsSentinelRef} className="py-4">
          {loadingMoreThreads && (
            <div className="flex justify-center">
              <Skeleton className="h-5 w-28 rounded-full" />
            </div>
          )}
          {!hasMoreThreads && threads.length > 0 && (
            <div className="text-center text-muted-foreground py-2 text-sm">
              Все записи загружены
            </div>
          )}
        </div>
      </>
        )}

        {board.is_gomosub && board.rules_markdown?.trim() && (
          <Dialog
            open={showRulesDialog}
            onOpenChange={(open) => {
              if (hasAcceptedRules) {
                setShowRulesDialog(open);
              } else if (open) {
                setShowRulesDialog(true);
              }
            }}
          >
            <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <BookOpenText className="w-5 h-5 text-primary" />
                  Правила g/{board.slug}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {rulesUpdatedLabel && (
                  <p className="text-xs text-muted-foreground">Обновлены {rulesUpdatedLabel}</p>
                )}
                <div className="max-h-[46vh] overflow-y-auto rounded-md border border-border/70 bg-muted/30 p-3">
                  <div className="prose prose-sm max-w-none">
                    {renderContent(board.rules_markdown)}
                  </div>
                </div>
                {!hasAcceptedRules && (
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="g-rules-accepted"
                      checked={rulesConfirmed}
                      onCheckedChange={(checked) => setRulesConfirmed(Boolean(checked))}
                    />
                    <label htmlFor="g-rules-accepted" className="text-sm text-muted-foreground cursor-pointer">
                      Я прочитал правила и согласен соблюдать их
                    </label>
                  </div>
                )}
                <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
                  {!hasAcceptedRules && (
                    <Button variant="outline" onClick={() => navigate("/g")}>
                      {t("board.backToSubs")}
                    </Button>
                  )}
                  <Button onClick={hasAcceptedRules ? () => setShowRulesDialog(false) : handleAcceptRules}>
                    {hasAcceptedRules ? t("common.close") : t("board.acceptRules")}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </main>

      {/* Attachment lightbox (from WallAttachments in GomoThreadCard) */}
      {!!galleryItems && (
        <Lightbox
          items={galleryItems}
          initialIndex={galleryIndex}
          onClose={() => setGalleryItems(null)}
        />
      )}
    </>
  );
};

export default Board;
