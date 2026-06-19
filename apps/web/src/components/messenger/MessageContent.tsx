import { memo, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Users, MessageSquare, ArrowRight, Gift, User } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { api } from "@/integrations/api/compat";
import { parseMessageLinks, type LinkSegment } from "./MessageLinks";
import { storageUrl } from "@/utils/storage";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

// ─── Invite preview ──────────────────────────────────────────────────────────

interface InviteData {
  board_id: string;
  board_name: string;
  expired: boolean;
  maxed_out: boolean;
}

function InvitePreview({ slug, code }: { slug: string; code: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["msg-invite", code],
    queryFn: async (): Promise<InviteData | null> => {
      const res = await fetch(`/api/v1/invites/${code}`);
      if (!res.ok) return null;
      const json = await res.json();
      return json.data ?? null;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    retry: false,
  });

  if (isLoading) return <div className="msg-link-panel-loading" />;
  if (error || !data || data.expired || data.maxed_out) return null;

  return (
    <div className="msg-link-panel">
      <div className="msg-link-panel-header">
        <Users size={13} />
        <span>Приглашение в G-саб</span>
      </div>
      <div className="msg-link-panel-title">{data.board_name}</div>
      <Link to={`/g/${slug}/join/${code}`} className="msg-link-panel-action">
        Вступить <ArrowRight size={13} />
      </Link>
    </div>
  );
}

// ─── Thread preview ──────────────────────────────────────────────────────────

interface ThreadData {
  id: string;
  title: string;
  post_count: number;
  boards: { name: string; slug: string; is_gomosub: boolean } | null;
}

function ThreadPreview({ slug, threadId }: { slug: string; threadId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["msg-thread", threadId],
    queryFn: async (): Promise<ThreadData | null> => {
      const { data: rows } = await api
        .from("threads")
        .select("id, title, post_count, boards(name, slug, is_gomosub)")
        .eq("id", threadId)
        .limit(1);
      return rows?.[0] ?? null;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    retry: false,
  });

  if (isLoading) return <div className="msg-link-panel-loading" />;
  if (error || !data) return null;

  const board = data.boards;
  const isGomo = board?.is_gomosub;
  const threadPath = isGomo
    ? `/g/${board?.slug ?? slug}/thread/${threadId}`
    : `/${board?.slug ?? slug}/thread/${threadId}`;

  return (
    <div className="msg-link-panel">
      <div className="msg-link-panel-header">
        <MessageSquare size={13} />
        {board && <span>{isGomo ? "g/" : "/"}{board.slug}</span>}
      </div>
      <Link to={threadPath} className="msg-link-panel-title hover:underline">
        {data.title}
      </Link>
      <div className="msg-link-panel-meta">
        {data.post_count} {data.post_count === 1 ? "сообщение" : data.post_count < 5 ? "сообщения" : "сообщений"}
      </div>
    </div>
  );
}

// ─── Profile preview ─────────────────────────────────────────────────────────

interface ProfileData {
  username: string;
  is_anonymous: boolean;
  avatar_url: string | null;
}

function ProfilePreview({ userId }: { userId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["msg-profile", userId],
    queryFn: async (): Promise<ProfileData | null> => {
      const { data: row } = await api
        .from("profiles")
        .select("username, is_anonymous, avatar_url")
        .eq("id", userId)
        .single();
      return row ?? null;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    retry: false,
  });

  if (isLoading) return <div className="msg-link-panel-loading" />;
  if (error || !data || data.is_anonymous) return null;

  const avatarSrc = storageUrl("post-images", data.avatar_url);

  return (
    <div className="msg-link-panel">
      <Link to={`/profile/${userId}`} className="msg-link-panel-profile hover:underline">
        <div className="msg-link-panel-avatar">
          {avatarSrc ? (
            <img src={avatarSrc} alt={data.username} />
          ) : (
            <span>{data.username[0]?.toUpperCase()}</span>
          )}
        </div>
        <div className="msg-link-panel-title">@{data.username}</div>
      </Link>
    </div>
  );
}

// ─── Board preview ───────────────────────────────────────────────────────────

interface BoardData {
  id: string;
  name: string;
  description: string | null;
  is_gomosub: boolean;
}

function BoardPreview({ slug }: { slug: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["msg-board", slug],
    queryFn: async (): Promise<BoardData | null> => {
      const { data: rows } = await api
        .from("boards")
        .select("id, name, description, is_gomosub")
        .eq("slug", slug)
        .limit(1);
      return rows?.[0] ?? null;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    retry: false,
  });

  if (isLoading) return <div className="msg-link-panel-loading" />;
  if (error || !data) return null;

  const link = data.is_gomosub ? `/g/${slug}` : `/${slug}`;

  return (
    <div className="msg-link-panel">
      <Link to={link} className="msg-link-panel-title hover:underline">
        {data.is_gomosub ? "g/" : "/"}{slug}
      </Link>
      {data.name !== slug && (
        <div className="msg-link-panel-meta">{data.name}</div>
      )}
    </div>
  );
}

// ─── Link segment renderer ───────────────────────────────────────────────────

const LinkSegmentView = memo(function LinkSegmentView({ segment }: { segment: LinkSegment }) {
  if (segment.type !== "link") return null;

  const { url, linkType, params } = segment;

  if (linkType === "external") {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="msg-link">
        {url.length > 60 ? url.slice(0, 57) + "..." : url}
      </a>
    );
  }

  return (
    <span className="flex flex-col w-full min-w-0">
      {linkType === "invite" && <InvitePreview slug={params.slug} code={params.code} />}
      {linkType === "thread" && <ThreadPreview slug={params.slug} threadId={params.threadId} />}
      {linkType === "profile" && <ProfilePreview userId={params.userId} />}
      {linkType === "board" && <BoardPreview slug={params.slug} />}
    </span>
  );
});

// ─── Gift message (exported for ChatView) ────────────────────────────────────

export interface GiftMessageData {
  giftId: string;
  giftName: string;
  imageUrl: string;
}

export function parseGiftContent(content: string): GiftMessageData | null {
  const match = content.match(/^__GIFT__:(.+?):(.+?):(.*)$/);
  if (!match) return null;
  return { giftId: match[1], giftName: match[2], imageUrl: match[3] };
}

interface GiftDetailItem {
  id: string;
  gift_id: string;
  sender_id?: string;
  recipient_id: string;
  message?: string;
  is_anonymous: boolean;
  created_at: string;
  gift_name?: string;
  gift_image_url?: string;
  gift_price?: number;
  sender_username?: string;
  sender_avatar_url?: string;
}

const formatDropsLabel = (value: number) => {
  const abs = Math.abs(value);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return "капля";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "капли";
  return "капель";
};

const giftImageUrl = (url?: string) => {
  if (!url) return null;
  return storageUrl("post-images", url) || url;
};

export function GiftDetailDialog({ giftId, recipientId, open, onOpenChange }: { giftId: string; recipientId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: gift } = useQuery({
    queryKey: ["msg-gift-detail", giftId, recipientId],
    queryFn: async (): Promise<GiftDetailItem | null> => {
      const res = await fetch(`/api/v1/user_gifts?recipient_id=eq.${recipientId}&limit=50`);
      if (!res.ok) return null;
      const json = await res.json();
      const items = json.data || [];
      return items.find((g: GiftDetailItem) => g.gift_id === giftId) ?? items[0] ?? null;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    enabled: open && !!recipientId,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        {gift && (
          <>
            <div className="w-full aspect-square bg-muted flex items-center justify-center">
              {giftImageUrl(gift.gift_image_url) ? (
                <img
                  src={giftImageUrl(gift.gift_image_url)!}
                  alt={gift.gift_name || "Подарок"}
                  className="w-full h-full object-cover"
                />
              ) : (
                <Gift className="w-16 h-16 text-muted-foreground" />
              )}
            </div>
            <div className="p-4 space-y-3">
              {!gift.is_anonymous && gift.sender_id ? (
                <ProfileHoverCard userId={gift.sender_id}>
                  <a
                    href={`/profile/${gift.sender_id}`}
                    onClick={(e) => e.preventDefault()}
                    className="flex items-center gap-2.5 group/sender"
                  >
                    <div className="w-8 h-8 rounded-full bg-muted overflow-hidden flex-shrink-0 border border-border">
                      {giftImageUrl(gift.sender_avatar_url) ? (
                        <img src={giftImageUrl(gift.sender_avatar_url)!} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <User className="w-4 h-4 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <span className="text-sm font-medium group-hover/sender:text-primary transition-colors">
                      {gift.sender_username || "пользователь"}
                    </span>
                  </a>
                </ProfileHoverCard>
              ) : (
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-muted overflow-hidden flex-shrink-0 border border-border flex items-center justify-center">
                    <User className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <span className="text-sm text-muted-foreground">Аноним</span>
                </div>
              )}
              {gift.gift_price != null && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Стоимость:</span>
                  <span className="text-sm font-medium">
                    {gift.gift_price} {formatDropsLabel(gift.gift_price)}
                  </span>
                </div>
              )}
              {gift.message && (
                <div className="pt-2 border-t border-border">
                  <p className="text-sm text-muted-foreground">Сообщение:</p>
                  <p className="text-sm mt-1">{gift.message}</p>
                </div>
              )}
              <p className="text-xs text-muted-foreground pt-1">
                {formatDistanceToNow(new Date(gift.created_at), { addSuffix: true, locale: ru })}
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

interface MessageContentProps {
  content: string;
}

export const MessageContent = memo(function MessageContent({ content }: MessageContentProps) {
  const segments = useMemo(() => parseMessageLinks(content), [content]);

  const hasLinks = segments.some((s) => s.type === "link");
  if (!hasLinks) {
    return <p className="whitespace-pre-wrap break-words">{content}</p>;
  }

  return (
    <div className="whitespace-pre-wrap break-words">
      {segments.map((segment, i) => {
        if (segment.type === "text") {
          return <span key={i}>{segment.content}</span>;
        }
        return <LinkSegmentView key={i} segment={segment} />;
      })}
    </div>
  );
});
