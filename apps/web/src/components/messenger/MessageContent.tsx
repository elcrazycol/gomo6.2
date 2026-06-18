import { memo, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Users, MessageSquare, ArrowRight } from "lucide-react";
import { api } from "@/integrations/api/compat";
import { parseMessageLinks, type LinkSegment } from "./MessageLinks";
import { storageUrl } from "@/utils/storage";

// ─── Preview card skeleton ───────────────────────────────────────────────────

const PreviewSkeleton = () => (
  <div className="msg-link-skeleton" />
);

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

  if (isLoading) return <PreviewSkeleton />;
  if (error || !data || data.expired || data.maxed_out) return null;

  return (
    <div className="msg-link-preview">
      <div className="flex items-center gap-2 mb-1">
        <Users size={14} className="text-muted-foreground shrink-0" />
        <span className="msg-link-preview-subtitle">Приглашение в G-саб</span>
      </div>
      <div className="msg-link-preview-title">{data.board_name}</div>
      <Link to={`/g/${slug}/join/${code}`} className="msg-link-preview-btn">
        Вступить <ArrowRight size={14} />
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

  if (isLoading) return <PreviewSkeleton />;
  if (error || !data) return null;

  const board = data.boards;
  const isGomo = board?.is_gomosub;
  const threadPath = isGomo
    ? `/g/${board?.slug ?? slug}/thread/${threadId}`
    : `/${board?.slug ?? slug}/thread/${threadId}`;

  return (
    <div className="msg-link-preview">
      <div className="flex items-center gap-2 mb-1">
        <MessageSquare size={14} className="text-muted-foreground shrink-0" />
        {board && (
          <span className="msg-link-preview-subtitle">
            {isGomo ? "g/" : "/"}{board.slug}
          </span>
        )}
      </div>
      <Link to={threadPath} className="msg-link-preview-title block hover:underline">
        {data.title}
      </Link>
      <div className="msg-link-preview-subtitle mt-1">
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

  if (isLoading) return <PreviewSkeleton />;
  if (error || !data || data.is_anonymous) return null;

  const avatarSrc = storageUrl("post-images", data.avatar_url);

  return (
    <div className="msg-link-preview">
      <Link to={`/profile/${userId}`} className="flex items-center gap-3 hover:underline">
        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
          {avatarSrc ? (
            <img src={avatarSrc} alt={data.username} className="w-full h-full object-cover" />
          ) : (
            <span className="text-sm font-bold text-muted-foreground">{data.username[0]?.toUpperCase()}</span>
          )}
        </div>
        <div>
          <div className="msg-link-preview-title">@{data.username}</div>
          <div className="msg-link-preview-subtitle">Профиль пользователя</div>
        </div>
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

  if (isLoading) return <PreviewSkeleton />;
  if (error || !data) return null;

  const link = data.is_gomosub ? `/g/${slug}` : `/${slug}`;

  return (
    <div className="msg-link-preview">
      <Link to={link} className="hover:underline">
        <div className="msg-link-preview-title">{data.is_gomosub ? "g/" : "/"}{slug}</div>
      </Link>
      {data.name !== slug && (
        <div className="msg-link-preview-subtitle mt-0.5">{data.name}</div>
      )}
      {data.description && (
        <div className="msg-link-preview-subtitle mt-1 line-clamp-2">{data.description}</div>
      )}
    </div>
  );
}

// ─── Link segment renderer ───────────────────────────────────────────────────

const LinkSegmentView = memo(function LinkSegmentView({ segment }: { segment: LinkSegment }) {
  if (segment.type !== "link") return null;

  const { url, linkType, params } = segment;

  // External links — plain <a> tag
  if (linkType === "external") {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="msg-link">
        {url.length > 60 ? url.slice(0, 57) + "..." : url}
      </a>
    );
  }

  // Internal link text (clickable) + optional preview card below
  return (
    <span className="inline-flex flex-col">
      {linkType === "invite" && (
        <>
          <a href={url} target="_blank" rel="noopener noreferrer" className="msg-link">
            Приглашение: /g/{params.slug}/join/{params.code}
          </a>
          <InvitePreview slug={params.slug} code={params.code} />
        </>
      )}
      {linkType === "thread" && (
        <>
          <a href={url} target="_blank" rel="noopener noreferrer" className="msg-link">
            Тред: {params.slug}/thread/{params.threadId.slice(0, 8)}...
          </a>
          <ThreadPreview slug={params.slug} threadId={params.threadId} />
        </>
      )}
      {linkType === "profile" && (
        <>
          <a href={url} target="_blank" rel="noopener noreferrer" className="msg-link">
            Профиль: {params.userId.slice(0, 8)}...
          </a>
          <ProfilePreview userId={params.userId} />
        </>
      )}
      {linkType === "board" && (
        <>
          <a href={url} target="_blank" rel="noopener noreferrer" className="msg-link">
            /{params.slug}
          </a>
          <BoardPreview slug={params.slug} />
        </>
      )}
    </span>
  );
});

// ─── Main component ──────────────────────────────────────────────────────────

interface MessageContentProps {
  content: string;
}

export const MessageContent = memo(function MessageContent({ content }: MessageContentProps) {
  const segments = useMemo(() => parseMessageLinks(content), [content]);

  // Fast path: no links at all — render as plain text
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
