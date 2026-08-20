import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Hash, ImageIcon, MessageSquare } from "lucide-react";
import { api } from "@/integrations/api/compat";
import { storageUrl } from "@/utils/storage";
import { messengerPlainPreview } from "@/components/messenger/messengerRichTextUtils";
import type { ShareTarget } from "./share";

// ─── Entity shapes (mirror what the feed/wall pages select) ─────────────────

interface ShareCardThread {
  id: string;
  title: string | null;
  content: string | null;
  image_url?: string | null;
  image_urls?: string[] | null;
  attachments?: unknown;
  boards?: { name: string; slug: string; is_gomosub: boolean } | null;
  profiles?: {
    username: string;
    display_name?: string | null;
    nickname_emoji_id?: string | null;
    is_anonymous: boolean;
    avatar_url?: string | null;
  } | null;
}

interface ShareCardWallPost {
  id: string;
  user_id: string;
  author_id?: string;
  title?: string | null;
  content?: string | null;
  image_url?: string | null;
  attachments?: unknown;
  author?: {
    username: string;
    display_name?: string | null;
    is_anonymous: boolean;
    avatar_url?: string | null;
  } | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function firstImageFromAttachments(attachments: unknown): string | null {
  if (!Array.isArray(attachments)) return null;
  const first = attachments.find(
    (att): att is { type?: string; url?: string } =>
      typeof att === "object" && att !== null && (att as { type?: string }).type === "image",
  );
  return first?.url ?? null;
}

/** Resolve a stored key/path through the same bucket mapping WallAttachments uses. */
function resolveImageUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return storageUrl("content", raw) || raw;
}

// ─── The card ───────────────────────────────────────────────────────────────

interface ShareCardProps {
  target: ShareTarget;
}

/**
 * Renders a shared thread / wall post inside a messenger bubble (X-style
 * quote card). The card fetches the entity by id — the recipient only ever
 * sees what the API allows them to (RLS), and deleted/inaccessible posts fall
 * back to a muted placeholder instead of breaking the message.
 *
 * Sizing contract with the virtualizer: the card uses a fixed-height 16:9
 * thumbnail (object-cover) and clamped text lines, so its rendered height is
 * deterministic — MessageList estimates it with a constant before the entity
 * is fetched, and the measured height matches it almost exactly.
 */
export const ShareCard = ({ target }: ShareCardProps) => {
  const navigate = useNavigate();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["share-card", target.type, target.id],
    queryFn: async (): Promise<{ thread?: ShareCardThread; wall?: ShareCardWallPost } | null> => {
      if (target.type === "thread") {
        const { data: rows } = await api
          .from("threads")
          .select(
            "id, title, content, image_url, image_urls, attachments, boards(name, slug, is_gomosub), profiles(username, display_name, nickname_emoji_id, is_anonymous, avatar_url)",
          )
          .eq("id", target.id)
          .limit(1);
        const thread = rows?.[0] as ShareCardThread | undefined;
        return thread ? { thread } : null;
      }
      const { data: rows } = await api
        .from("profile_wall_posts")
        .select(
          "id, user_id, author_id, title, content, image_url, attachments, author:profiles!author_id(username, display_name, is_anonymous, avatar_url)",
        )
        .eq("id", target.id)
        .limit(1);
      const wall = rows?.[0] as ShareCardWallPost | undefined;
      return wall ? { wall } : null;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    retry: false,
  });

  const card = useMemo(() => {
    const thread = data?.thread;
    const wall = data?.wall;
    if (!thread && !wall) return null;

    const author = thread
      ? thread.profiles
      : wall!.author;
    const title = thread?.title || wall?.title || "";
    const content = thread?.content || wall?.content || "";
    const snippet = messengerPlainPreview(content, 220);
    const rawImage = thread
      ? firstImageFromAttachments(thread.attachments)
        ?? thread.image_urls?.[0] ?? thread.image_url
      : firstImageFromAttachments(wall!.attachments) ?? wall!.image_url;
    const image = resolveImageUrl(rawImage);

    const board = thread?.boards;
    const boardLabel = thread
      ? `${board?.is_gomosub ? "g/" : "/"}${board?.slug ?? "b"}`
      : null;

    const url = thread
      ? `${board?.is_gomosub ? "/g" : ""}/${board?.slug ?? "b"}/thread/${thread.id}`
      : `/profile/${wall!.user_id}/wall/${wall!.id}`;

    return { author, title, snippet, image, boardLabel, url, isThread: Boolean(thread) };
  }, [data]);

  if (!card) {
    // Loading skeleton or unresolvable share: keep a fixed-height placeholder
    // so the virtualizer's estimate holds while the entity is fetched.
    const unavailable = !isLoading && (isError || !data);
    return (
      <button
        type="button"
        className={`msg-share-card msg-share-card-muted${isLoading ? " is-loading" : ""}`}
        aria-busy={isLoading}
        disabled={!isLoading}
      >
        <span className="msg-share-card-icon">
          {target.type === "thread" ? <Hash size={14} /> : <MessageSquare size={14} />}
        </span>
        <span className="msg-share-card-label">
          {isLoading ? "Загрузка…" : unavailable ? "Запись недоступна" : "Поделился записью"}
        </span>
      </button>
    );
  }

  const displayName = card.author?.display_name || card.author?.username || "";
  const avatarUrl = storageUrl("post-images", card.author?.avatar_url ?? null);

  return (
    <button
      type="button"
      className="msg-share-card"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigate(card.url);
      }}
    >
      <div className="msg-share-card-head">
        <span className="msg-share-card-icon">
          {card.isThread ? <Hash size={14} /> : <MessageSquare size={14} />}
        </span>
        <span className="msg-share-card-label">
          {card.isThread ? "Тред" : "Запись со стены"}
          {card.boardLabel ? ` · ${card.boardLabel}` : ""}
        </span>
        <ArrowUpRight size={14} className="msg-share-card-arrow" />
      </div>

      {card.author && (
        <div className="msg-share-card-author">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="msg-share-card-avatar" loading="lazy" />
          ) : (
            <span className="msg-share-card-avatar msg-share-card-avatar-fallback">
              {((card.author?.username || "?")[0] || "?").toUpperCase()}
            </span>
          )}
          <span className="msg-share-card-username">
            {card.author.is_anonymous ? "Аноним" : `@${displayName}`}
          </span>
        </div>
      )}

      {card.title && <div className="msg-share-card-title line-clamp-2">{card.title}</div>}
      {card.snippet && <div className="msg-share-card-text line-clamp-3">{card.snippet}</div>}

      {card.image ? (
        <div className="msg-share-card-image">
          <img src={card.image} alt="" loading="lazy" decoding="async" />
        </div>
      ) : (
        <div className="msg-share-card-image msg-share-card-image-empty">
          <ImageIcon size={18} />
        </div>
      )}
    </button>
  );
};
