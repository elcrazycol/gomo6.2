import { memo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Users, MessageSquare, ArrowRight } from "lucide-react";
import { api } from "@/integrations/api/compat";
import { storageUrl } from "@/utils/storage";
import type { LinkSegment } from "./MessageLinks";

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

export const LinkSegmentView = memo(function LinkSegmentView({ segment }: { segment: LinkSegment }) {
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

export type { LinkSegment };
