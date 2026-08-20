import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Image as ImageIcon, Mic, Video } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { storageUrl, giftImageUrl } from "@/utils/storage";
import {
  getAttachmentAspectRatio,
  getAttachmentDisplayStyle,
  parseImageMeta,
  rememberMeasuredAttachmentRatio,
  thumbHashToPlaceholderDataUrl,
  useAuthenticatedAttachmentUrl,
} from "./attachmentMedia";
import { MessengerLightbox } from "./MessengerLightbox";
import { MessageMediaMosaic } from "./MessageMediaMosaic";
import { chunkAttachments } from "./attachmentAlbum";
import { GiftDetailPanel } from "@/components/GiftDetailPanel";
import { MessengerRichText } from "./MessengerRichText";
import { ShareCard } from "@/components/share/ShareCard";
import { parseShareToken } from "@/components/share/share";
import type { Attachment } from "./types";

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

// Sender avatars live in the public post-images bucket — NOT the gift-layers
// bucket that gift images/upgrade layers use.
const avatarUrl = (url?: string) => {
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
            senderAvatarUrl={avatarUrl(gift.sender_avatar_url)}
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
  const [aspectRatio, setAspectRatio] = useState(() => getAttachmentAspectRatio(attachment));
  // Placeholder: instant ThumbHash for new attachments, inline LQIP data URL
  // for legacy ones, nothing otherwise (legacy placeholder box covers it).
  const placeholder = useMemo(
    () => thumbHashToPlaceholderDataUrl(meta.thumb_hash) ?? meta.lqip ?? null,
    [meta.thumb_hash, meta.lqip],
  );
  // Reserved box: sized once from the ratio — never reflows when the keyboard
  // or URL bar changes the visual viewport (the old width formula depended on
  // viewportHeight and resized every photo on mobile while typing).
  const displayStyle = useMemo(
    () => getAttachmentDisplayStyle(aspectRatio, { maxWidth: fitToViewport ? 640 : 420 }),
    [aspectRatio, fitToViewport],
  );
  const isVisual = attachment.type === "image" || attachment.type === "video";

  useEffect(() => {
    const observer = meta.preview_key && typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(([entry]) => setIsNearViewport(entry.isIntersecting), { rootMargin: "320px" })
      : null;
    if (imageRef.current && observer) observer.observe(imageRef.current);
    return () => observer?.disconnect();
  }, [meta.preview_key]);

  const rememberMeasuredRatio = (ratio: number) => {
    if (ratio <= 0 || !Number.isFinite(ratio)) return;
    setAspectRatio(ratio);
    rememberMeasuredAttachmentRatio(attachment, ratio);
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
        style={displayStyle}
        aria-busy={!url}
      >
        {attachment.type === "image" ? (
          <button type="button" className="msg-attachment-open" onClick={() => setLightboxOpen(true)} aria-label={`Открыть ${attachment.name}`}>
            {placeholder && <img className="msg-attachment-lqip" src={placeholder} alt="" aria-hidden="true" />}
            {url && <img className="msg-attachment-preview" src={url} alt={attachment.name} loading="lazy" decoding="async" fetchPriority="low" onLoad={(event) => { setIsPreviewReady(true); handleImageLoad(event); }} style={{ objectFit: "contain" }} />}
            {!url && placeholder && <span className="msg-attachment-loading-shimmer" aria-hidden="true" />}
            {!url && !placeholder && <span className="msg-attachment-legacy-placeholder" aria-hidden="true">Открыть фото</span>}
          </button>
        ) : (
          url && <video src={url} controls preload="metadata" onLoadedMetadata={(event) => { setIsPreviewReady(true); handleVideoMetadata(event); }} style={{ objectFit: "contain" }} />
        )}
        {lightboxOpen && (
          <MessengerLightbox attachments={[attachment]} initialIndex={0} onClose={() => setLightboxOpen(false)} />
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
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const hasAttachments = attachments && attachments.length > 0;
  // Anything beyond plain text needs the BBCode/link renderer: emoji tokens,
  // formatting tags, or bare URLs.
  const hasLinks = /https?:\/\//.test(content);
  const hasRichText = /\[(?:b|i|u|s|spoiler|blur|col|size|url|e)[\]:=]/i.test(content) || hasLinks;
  // Shared posts arrive as a content token; they render as a rich card
  // instead of the raw token text.
  const share = parseShareToken(content);
  const visualAttachments = useMemo(
    () => attachments?.filter((attachment) => attachment.type === "image" || attachment.type === "video") ?? [],
    [attachments],
  );
  const mediaBatches = useMemo(() => chunkAttachments(visualAttachments), [visualAttachments]);
  // Link previews must sit in the text stack below the media, never inside a
  // flush image bubble — formatting alone does not break the media layout.
  const isMediaMessage = !hasQuotedMessage
    && !hasLinks
    && visualAttachments.length > 0
    && visualAttachments.length === attachments?.length;

  if (share) {
    return (
      <div className="message-content message-content-stack">
        <ShareCard target={share} />
      </div>
    );
  }

  if (!hasRichText && !hasAttachments) {
    return <p className="message-content message-content-text whitespace-pre-wrap break-words">{content}</p>;
  }

  const renderedText = <MessengerRichText text={content} />;

  if (isMediaMessage) {
    return (
      <>
        <div className={`message-content message-content-media${content.trim() ? " has-caption" : ""}`}>
          {visualAttachments.length === 1 ? (
            <div className="msg-attachments">
              <AttachmentView attachment={visualAttachments[0]} fitToViewport />
            </div>
          ) : (
            <div className="msg-media-mosaic-stack">
              {mediaBatches.map((batch, batchIndex) => {
                const offset = batchIndex * 6;
                return (
                  <MessageMediaMosaic
                    key={`${batch[0]?.id ?? batch[0]?.url ?? "batch"}-${batchIndex}`}
                    attachments={batch}
                    onOpen={(index) => setLightboxIndex(offset + index)}
                  />
                );
              })}
            </div>
          )}
          {content.trim() && <div className="message-media-caption">{renderedText}</div>}
        </div>
        {lightboxIndex !== null && (
          <MessengerLightbox
            attachments={visualAttachments}
            initialIndex={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
          />
        )}
      </>
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
