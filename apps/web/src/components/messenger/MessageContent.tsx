import { memo, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Users, MessageSquare, ArrowRight, FileText, Image as ImageIcon, Mic, Video } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { api } from "@/integrations/api/compat";
import { parseMessageLinks, type LinkSegment } from "./MessageLinks";
import { storageUrl } from "@/utils/storage";
import { GiftDetailPanel } from "@/components/GiftDetailPanel";
import type { Attachment } from "./types";

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
    const safeUrl = /^https?:\/\//i.test(url) ? url : "#";
    return (
      <a href={safeUrl} target="_blank" rel="noopener noreferrer" className="msg-link">
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
  is_upgraded: boolean;
  is_gift_upgradable?: boolean;
  gift_layer_image_url?: string;
  background_layer_image_url?: string;
  symbol_layer_image_url?: string;
  gift_layer_rarity?: number;
  background_layer_rarity?: number;
  symbol_layer_rarity?: number;
}

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
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        {gift && (
          <GiftDetailPanel
            isUpgraded={gift.is_upgraded}
            isUpgradable={gift.is_gift_upgradable}
            giftLayerImageUrl={gift.gift_layer_image_url}
            backgroundLayerImageUrl={gift.background_layer_image_url}
            symbolLayerImageUrl={gift.symbol_layer_image_url}
            giftLayerRarity={gift.gift_layer_rarity}
            backgroundLayerRarity={gift.background_layer_rarity}
            symbolLayerRarity={gift.symbol_layer_rarity}
            giftImageUrl={giftImageUrl(gift.gift_image_url)}
            giftName={gift.gift_name}
            senderId={gift.sender_id}
            senderUsername={gift.sender_username}
            senderAvatarUrl={giftImageUrl(gift.sender_avatar_url)}
            isAnonymous={gift.is_anonymous}
            price={gift.gift_price}
            message={gift.message}
            createdAt={gift.created_at}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

interface MessageContentProps {
  content: string;
  attachments?: Attachment[];
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getAttachmentIcon(type: Attachment["type"]) {
  switch (type) {
    case "image": return <ImageIcon size={16} />;
    case "video": return <Video size={16} />;
    case "audio": return <Mic size={16} />;
    default: return <FileText size={16} />;
  }
}

function AttachmentView({ attachment }: { attachment: Attachment }) {
  const url = storageUrl("uploads", attachment.url);

  if (attachment.type === "image" && url) {
    return (
      <div className="msg-attachment-image">
        <img src={url} alt={attachment.name} loading="lazy" />
      </div>
    );
  }

  if (attachment.type === "video" && url) {
    return (
      <div className="msg-attachment-image">
        <video src={url} controls preload="metadata" />
      </div>
    );
  }

  if (attachment.type === "audio" && url) {
    return (
      <div style={{ marginTop: 4 }}>
        <audio src={url} controls preload="metadata" style={{ maxWidth: 240 }} />
      </div>
    );
  }

  return (
    <a href={url || "#"} target="_blank" rel="noopener noreferrer" className="msg-attachment-file">
      <span className="msg-attachment-file-icon">{getAttachmentIcon(attachment.type)}</span>
      <div className="msg-attachment-file-info">
        <div className="msg-attachment-file-name">{attachment.name}</div>
        <div className="msg-attachment-file-size">{formatFileSize(attachment.size)}</div>
      </div>
    </a>
  );
}

export const MessageContent = memo(function MessageContent({ content, attachments }: MessageContentProps) {
  const segments = useMemo(() => parseMessageLinks(content), [content]);

  const hasLinks = segments.some((s) => s.type === "link");
  const hasAttachments = attachments && attachments.length > 0;

  if (!hasLinks && !hasAttachments) {
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
      {hasAttachments && (
        <div className="msg-attachments">
          {attachments!.map((att, i) => (
            <AttachmentView key={att.id || i} attachment={att} />
          ))}
        </div>
      )}
    </div>
  );
});
