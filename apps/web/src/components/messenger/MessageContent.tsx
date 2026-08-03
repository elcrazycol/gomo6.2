import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Users, MessageSquare, ArrowRight, FileText, Image as ImageIcon, Mic, Video } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { api } from "@/integrations/api/compat";
import { apiClient } from "@/integrations/api/client";
import { parseMessageLinks, type LinkSegment } from "./MessageLinks";
import { storageUrl } from "@/utils/storage";
import { getAttachmentAspectRatio as getCachedAspectRatio, rememberAttachmentAspectRatio, fallbackAttachmentAspectRatio } from "@/utils/attachmentRatioCache";
import { GiftDetailPanel } from "@/components/GiftDetailPanel";
import { EmojiInline } from "@/components/EmojiInline";
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
  hasQuotedMessage?: boolean;
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

function parseImageMeta(attachment: Attachment): {
  width?: number;
  height?: number;
  preview_key?: string;
  lqip?: string;
} {
  if (!attachment.meta) return {};
  try {
    const parsed = JSON.parse(attachment.meta) as Record<string, unknown>;
    return {
      ...(typeof parsed.width === "number" ? { width: parsed.width } : {}),
      ...(typeof parsed.height === "number" ? { height: parsed.height } : {}),
      ...(typeof parsed.preview_key === "string" ? { preview_key: parsed.preview_key } : {}),
      ...(typeof parsed.lqip === "string" && parsed.lqip.startsWith("data:image/") ? { lqip: parsed.lqip } : {}),
    };
  } catch {
    return {};
  }
}

const decodeImageWithTimeout = async (url: string, timeoutMs = 5000): Promise<void> => {
  const image = new Image();
  image.src = url;
  if (typeof image.decode !== "function") return;

  let timer: number | undefined;
  try {
    await Promise.race([
      image.decode(),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error("Image decode timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
};

function useAuthenticatedAttachmentUrl(attachment: Attachment, requestedKey = attachment.url, enabled = true): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    const controller = new AbortController();
    if (!enabled) {
      setObjectUrl(null);
      return () => controller.abort();
    }

    const sourceUrl = storageUrl("uploads", requestedKey);
    const token = apiClient.getToken();
    if (!sourceUrl || (!token && !apiClient.getCSRFToken())) {
      setObjectUrl(null);
      return () => controller.abort();
    }

    const load = async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let candidateUrl: string | null = null;
        try {
          const response = await fetch(sourceUrl, {
            credentials: "include",
            signal: controller.signal,
            headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          });
          if (!response.ok) throw new Error(`Attachment request failed: ${response.status}`);
          const blob = await response.blob();
          candidateUrl = URL.createObjectURL(blob);

          // Decode before swapping the object URL into the DOM. This prevents
          // a late decode hitch from interrupting scroll and makes the CSS
          // blur-up transition begin only with a renderable preview.
          if (blob.type.startsWith("image/")) {
            await decodeImageWithTimeout(candidateUrl);
          }
          if (cancelled) {
            URL.revokeObjectURL(candidateUrl);
            return;
          }
          createdUrl = candidateUrl;
          setObjectUrl(candidateUrl);
          return;
        } catch (error) {
          if (candidateUrl) URL.revokeObjectURL(candidateUrl);
          lastError = error;
          if (controller.signal.aborted || attempt === 2) break;
          await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
        }
      }
      if (!cancelled && !controller.signal.aborted) {
        setObjectUrl(null);
        console.debug("Attachment preview failed after retries", lastError);
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [attachment.url, requestedKey, enabled]);

  return objectUrl;
}

function getAttachmentAspectRatio(attachment: Attachment): number {
  const parsed = parseImageMeta(attachment);
  if (parsed.width && parsed.height && parsed.width > 0 && parsed.height > 0) {
    return parsed.width / parsed.height;
  }

  // Old photos have no width/height in the payload. Use the remembered ratio
  // from a previous session so the reserved space matches on re-opens.
  const remembered = getCachedAspectRatio(attachment.url);
  if (remembered !== null) return remembered;

  return attachment.type === "video" ? 16 / 9 : 4 / 3;
}

function getAttachmentDisplayWidth(aspectRatio: number, viewportHeight: number): number {
  if (typeof window === "undefined") return Math.min(640, 640 * aspectRatio);
  // Keep very tall photos inside the viewport while retaining their exact
  // proportions. The CSS max-width still lets the chat column shrink this
  // value further on narrow screens.
  const maxHeight = Math.min(viewportHeight * 0.68, 640);
  return Math.min(640, Math.max(1, maxHeight * aspectRatio));
}

function AttachmentView({ attachment, fitToViewport = false }: { attachment: Attachment; fitToViewport?: boolean }) {
  const meta = useMemo(() => parseImageMeta(attachment), [attachment.meta]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [isPreviewReady, setIsPreviewReady] = useState(false);
  const [isNearViewport, setIsNearViewport] = useState(() => typeof IntersectionObserver === "undefined");
  const imageRef = useRef<HTMLDivElement | null>(null);
  // A legacy image may have no derivative metadata. Keep its original out of
  // the message feed; it is fetched only after the lightbox is opened below.
  // Non-image attachments retain their existing direct-preview behavior.
  const previewKey = meta.preview_key || (attachment.type === "image" ? "" : attachment.url);
  const shouldLazyLoadPreview = Boolean(meta.preview_key && (fitToViewport || attachment.type === "image"));
  const previewEnabled = attachment.type === "image"
    ? Boolean(meta.preview_key) && (isNearViewport || !shouldLazyLoadPreview)
    : true;
  const url = useAuthenticatedAttachmentUrl(attachment, previewKey, previewEnabled);
  const originalUrl = useAuthenticatedAttachmentUrl(attachment, attachment.url, lightboxOpen);
  const [aspectRatio, setAspectRatio] = useState(() => getAttachmentAspectRatio(attachment));
  const [viewportHeight, setViewportHeight] = useState(() => typeof window === "undefined" ? 800 : window.innerHeight);
  const isVisual = attachment.type === "image" || attachment.type === "video";

  useEffect(() => {
    const observer = meta.preview_key && typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(([entry]) => setIsNearViewport(entry.isIntersecting), { rootMargin: "320px" })
      : null;
    if (imageRef.current && observer) observer.observe(imageRef.current);

    if (!fitToViewport) return () => observer?.disconnect();
    const handleViewportResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", handleViewportResize, { passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", handleViewportResize);
    };
  }, [fitToViewport, meta.preview_key]);

  const rememberMeasuredRatio = (ratio: number) => {
    if (ratio <= 0 || !Number.isFinite(ratio)) return;
    setAspectRatio(ratio);
    rememberAttachmentAspectRatio(
      attachment.url,
      ratio,
      fallbackAttachmentAspectRatio(attachment.type === "video" ? "video" : "image"),
    );
  };

  const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (naturalWidth > 0 && naturalHeight > 0) {
      rememberMeasuredRatio(naturalWidth / naturalHeight);
    }
  };

  const handleVideoMetadata = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const { videoWidth, videoHeight } = event.currentTarget;
    if (videoWidth > 0 && videoHeight > 0) {
      rememberMeasuredRatio(videoWidth / videoHeight);
    }
  };

  useEffect(() => {
    setIsPreviewReady(false);
  }, [url]);

  if (isVisual) {
    return (
      <div
        ref={imageRef}
        className={`msg-attachment-image${isPreviewReady ? " is-loaded" : " is-loading"}`}
        style={{
          aspectRatio,
          "--attachment-ratio": aspectRatio,
          ...(fitToViewport ? { width: getAttachmentDisplayWidth(aspectRatio, viewportHeight) } : {}),
        } as React.CSSProperties}
        aria-busy={!url}
      >
        {attachment.type === "image" ? (
          <button type="button" className="msg-attachment-open" onClick={() => setLightboxOpen(true)} aria-label={`Открыть ${attachment.name}`}>
            {meta.lqip && <img className="msg-attachment-lqip" src={meta.lqip} alt="" aria-hidden="true" />}
            {url && <img className="msg-attachment-preview" src={url} alt={attachment.name} loading="lazy" decoding="async" fetchPriority="low" onLoad={(event) => { setIsPreviewReady(true); handleImageLoad(event); }} style={{ objectFit: "contain" }} />}
            {!url && meta.lqip && <span className="msg-attachment-loading-shimmer" aria-hidden="true" />}
            {!url && !meta.lqip && <span className="msg-attachment-legacy-placeholder" aria-hidden="true">Открыть фото</span>}
          </button>
        ) : (
          url && <video src={url} controls preload="metadata" onLoadedMetadata={(event) => { setIsPreviewReady(true); handleVideoMetadata(event); }} style={{ objectFit: "contain" }} />
        )}
        {lightboxOpen && (
          <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
            <DialogContent className="msg-lightbox-content">
              {originalUrl ? <img src={originalUrl} alt={attachment.name} className="msg-lightbox-image" decoding="async" fetchPriority="high" /> : <span className="msg-attachment-loading-shimmer" aria-label="Загрузка оригинала" />}
            </DialogContent>
          </Dialog>
        )}
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

export const MessageContent = memo(function MessageContent({ content, attachments, hasQuotedMessage = false }: MessageContentProps) {
  const segments = useMemo(() => parseMessageLinks(content), [content]);

  const hasLinks = segments.some((s) => s.type === "link");
  const hasAttachments = attachments && attachments.length > 0;
  const hasEmojis = /\[e:[^\]]+\]/.test(content);
  const visualAttachments = attachments?.filter((attachment) => attachment.type === "image" || attachment.type === "video") ?? [];
  const isMediaMessage = !hasQuotedMessage
    && !segments.some((segment) => segment.type === "link")
    && visualAttachments.length > 0
    && visualAttachments.length === attachments?.length;

  if (!hasLinks && !hasAttachments && !hasEmojis) {
    return <p className="message-content message-content-text whitespace-pre-wrap break-words">{content}</p>;
  }

  const renderTextWithEmojis = (text: string) => {
    if (!/\[e:[^\]]+\]/.test(text)) return text;
    const regex = /(\[e:[^\]]+\])/g;
    const parts = text.split(regex);
    return parts.map((part, i) => {
      if (part.startsWith("[e:") && part.endsWith("]")) {
        const emojiId = part.slice(3, -1);
        return <EmojiInline key={i} emojiId={emojiId} />;
      }
      return part;
    });
  };

  const renderedText = segments.map((segment, i) => {
    if (segment.type === "text") {
      return <span key={i}>{renderTextWithEmojis(segment.content)}</span>;
    }
    return <LinkSegmentView key={i} segment={segment} />;
  });

  if (isMediaMessage) {
    return (
      <div className={`message-content message-content-media${content.trim() ? " has-caption" : ""}`}>
        <div className={`msg-attachments${visualAttachments.length > 1 ? " is-media-grid" : ""}`}>
          {visualAttachments.map((att, i) => (
            <AttachmentView key={att.id || i} attachment={att} fitToViewport />
          ))}
        </div>
        {content.trim() && <div className="message-media-caption">{renderedText}</div>}
      </div>
    );
  }

  return (
    <div className="message-content message-content-stack whitespace-pre-wrap break-words">
      {renderedText}
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
