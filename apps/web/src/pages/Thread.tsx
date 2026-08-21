import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/integrations/api/compat";
import { invalidateByPrefix } from "@/integrations/api/queryCache";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useThread, useThreadSubscription } from "@/hooks/queries";
import { formatDistanceToNow } from "date-fns";
import { useDateLocale } from "@/i18n/dateLocale";
import { useTranslation } from "react-i18next";
import { safeDate } from "@/utils/safeDate";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { UserBadge } from "@/components/UserBadge";
import { AlertTriangle, Bell, BellOff, ChevronLeft } from "lucide-react";
import { UserMenu } from "@/components/UserMenu";
import { Poll } from "@/components/Poll";
import type { Poll as PollData } from "@/components/Poll";
import { storageUrl } from "@/utils/storage";
import { getContentTagLabel, getFormatTagLabel, getAtmosphereTagLabel } from "@/constants/tags";
import { parseAttachments } from "@/components/ThreadAttachments";
import { ProcessedContent } from "@/components/ProcessedContent";
import { PentagramLoader } from "@/components/PentagramLoader";
import { LikeButton } from "@/components/LikeButton";
import { getCurrentUserMeta } from "@/utils/currentUserMeta";
import { GomoRichEditor } from "@/components/GomoRichEditor";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Thread as ThreadModel } from "@/types/forum";
import { WallAttachments } from "@/components/WallAttachments";
import { ActionButton } from "@/components/WallActionButton";
import { ShareSheet } from "@/components/share/ShareSheet";
import { ThreadCommentTree } from "@/components/thread/ThreadCommentTree";
import type { AttachmentMeta } from "@/types/forum";

interface ThreadWithExtras extends ThreadModel {
  content_json?: unknown;
  ephemeral_type?: string;
  ephemeral_value?: number;
  custom_message?: string;
  username?: string;
  display_name?: string | null;
  nickname_emoji_id?: string | null;
  avatar_url?: string;
  tags?: { content?: string; format?: string; atmosphere?: string; flag?: string };
}

// Record a thread visit at most once per browser session. The backend upsert
// is idempotent, but writing on EVERY mount/back-navigation is needless DB
// load — one write per unique thread per session is enough.
const recordedVisits = new Set<string>();

const legacyImageUrls = (thread: ThreadWithExtras): string[] =>
  Array.isArray(thread.image_urls) && thread.image_urls.length > 0
    ? thread.image_urls
    : thread.image_url
      ? [thread.image_url]
      : [];

const buildAttachments = (thread: ThreadWithExtras): AttachmentMeta[] => {
  const parsed = parseAttachments(thread.attachments);
  if (parsed.length > 0) {
    const known = new Set(
      parsed.filter((att) => att.type === "image").map((att) => att.url),
    );
    const extra = legacyImageUrls(thread)
      .filter((url) => !known.has(url))
      .map((url) => ({
        url,
        type: "image" as const,
        mime: "image/*",
        name: "image",
        size: 0,
      }));
    return [...parsed, ...extra];
  }
  return legacyImageUrls(thread).map((url) => ({
    url,
    type: "image" as const,
    mime: "image/*",
    name: "image",
    size: 0,
  }));
};

const Thread = () => {
  const { slug, threadId, channelSlug } = useParams();
  const dateLocale = useDateLocale();
  const { t } = useTranslation();
  const location = useLocation();
  const isGomoRoute = location.pathname.startsWith("/g/");
  const pathPrefix = isGomoRoute ? "/g" : "";
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: thread, isLoading: threadLoading, isError: threadError } = useThread(threadId);

  const [user, setUser] = useState<{ id: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");
  const [pollData, setPollData] = useState<PollData | null>(null);
  const [postCount, setPostCount] = useState(0);

  // Thread-level editing / reporting.
  const [editingThread, setEditingThread] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editContentJson, setEditContentJson] = useState<unknown>(null);
  const [reportingThread, setReportingThread] = useState(false);
  const [reportReason, setReportReason] = useState("");

  // Attachment gallery for the thread card.
  const [galleryItems, setGalleryItems] = useState<LightboxItem[] | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);

  const { data: isSubscribed = false } = useThreadSubscription(threadId, user?.id);

  // Sync the visible post count with the loaded thread + live changes.
  useEffect(() => {
    if (typeof thread?.post_count === "number") setPostCount(thread.post_count);
  }, [thread?.post_count]);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await api.auth.getSession();
      setUser(session?.user ?? null);
      if (session?.user) {
        const meta = await getCurrentUserMeta(session.user.id);
        setIsAdmin(meta.roles.includes("admin"));
        setCurrentUserUsername(meta.username);
        setCurrentUserColor(meta.color);
      }
    };
    checkAuth();

    const { data: { subscription } } = api.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  // Load poll data + record a visit when the thread is loaded.
  useEffect(() => {
    if (!thread?.id || !threadId) return;

    const loadPollData = async () => {
      try {
        const token = (await api.auth.getSession()).data.session?.access_token;
        const headers = token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : undefined;

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

        if (user && thread && token && !recordedVisits.has(thread.id)) {
          try {
            const hasCustomMessage = (thread as ThreadWithExtras).custom_message && (thread as ThreadWithExtras).custom_message.trim().length > 0;
            const visitRes = await fetch("/api/v1/thread_custom_message_visits", {
              method: "POST",
              headers,
              body: JSON.stringify({
                user_id: user.id,
                thread_id: thread.id,
                has_custom_message: hasCustomMessage,
              }),
            });
            if (visitRes.ok) recordedVisits.add(thread.id);
          } catch (error) {
            console.error("Thread visit tracking unavailable:", error);
          }
        }
      } catch (error) {
        console.error("Error loading poll data:", error);
      }
    };

    loadPollData();
  }, [thread, threadId, user]);

  const toggleSubscription = async () => {
    if (!user) {
      toast.error(t("auth.needLogin"));
      return;
    }
    const token = (await api.auth.getSession()).data.session?.access_token;
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    if (isSubscribed) {
      const res = await fetch(`/api/v1/thread_subscriptions?user_id=eq.${user.id}&thread_id=eq.${threadId}`, {
        method: "DELETE",
        headers,
      });
      if (res.ok) toast.success(t("thread.unsubscribed"));
    } else {
      const res = await fetch("/api/v1/thread_subscriptions", {
        method: "POST",
        headers,
        body: JSON.stringify({ user_id: user.id, thread_id: threadId }),
      });
      if (res.ok) toast.success(t("thread.subscribed"));
    }
  };

  const authHeaders = async (): Promise<Record<string, string>> => {
    const { data: { session } } = await api.auth.getSession();
    return {
      "Content-Type": "application/json",
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    };
  };

  const handleEditThread = async () => {
    if (!editContent.trim() || !threadId) return;
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/v1/threads?id=eq.${threadId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ content: editContent.trim(), content_json: editContentJson }),
      });
      if (!res.ok) throw new Error("Не удалось сохранить изменения");
      toast.success(t("thread.postEdited"));
      setEditingThread(false);
      setEditContent("");
      setEditContentJson(null);
      queryClient.invalidateQueries({ queryKey: ["thread", threadId] });
      invalidateByPrefix("/api/v1/threads");
    } catch {
      toast.error(t("thread.postEditError"));
    }
  };

  const handleDeleteThread = async () => {
    if (!threadId) return;
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/v1/threads?id=eq.${threadId}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) throw new Error("Не удалось удалить запись");
      toast.success(t("thread.threadDeleted"));
      invalidateByPrefix("/api/v1/threads");
      invalidateByPrefix("/api/v1/boards");
      navigate(`${pathPrefix}/${slug}${channelSlug ? `/c/${channelSlug}` : ""}`);
    } catch {
      toast.error(t("thread.threadDeleteError"));
    }
  };

  const handleReportThread = async () => {
    if (!user) {
      toast.error(t("thread.needLoginToReport"));
      return;
    }
    if (!reportReason.trim()) {
      toast.error(t("thread.reportReasonRequired"));
      return;
    }
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/v1/reports", {
        method: "POST",
        headers,
        body: JSON.stringify({
          reporter_id: user.id,
          reported_post_id: null,
          reported_thread_id: threadId,
          reason: reportReason.trim(),
        }),
      });
      if (!res.ok) throw new Error("Не удалось отправить жалобу");
      toast.success(t("thread.reportSent"));
      setReportReason("");
      setReportingThread(false);
    } catch {
      toast.error(t("thread.reportSendError"));
    }
  };

  const threadPath = `${pathPrefix}/${slug}${channelSlug ? `/c/${channelSlug}` : ""}`;

  // Hooks must run before the early returns below.
  const tx = thread as ThreadWithExtras | null;
  const attachments = useMemo(() => (tx ? buildAttachments(tx) : []), [tx]);

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
        <p className="text-muted-foreground text-lg">{t("thread.threadNotFound")}</p>
        <Link to="/" className="text-primary hover:underline text-sm">{t("thread.goHome")}</Link>
      </div>
    );
  }

  const canPost = user && (!thread.boards?.is_rules_board || isAdmin);
  const isOwner = user && thread.user_id === user.id;
  const authorName = tx.display_name || tx.username || t("common.anonymous");
  const authorAvatar = tx.avatar_url ? storageUrl("post-images", tx.avatar_url) || undefined : undefined;

  return (
    <>
      <main className="max-w-5xl mx-auto p-2 sm:p-4 pb-24 sm:pb-28">
        <div className="mb-4 flex justify-between items-center">
          <button
            type="button"
            onClick={() => {
              if (window.history.length > 1) {
                navigate(-1);
              } else {
                navigate(threadPath, { replace: true });
              }
            }}
            className="inline-flex items-center gap-1 text-primary hover:text-primary/80 font-medium text-sm transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            {t("common.back")}
          </button>
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

        {/* Thread card — wall style */}
        <div className="overflow-clip border border-border/70 shadow-none bg-background rounded-xl mb-4">
          <div className="space-y-4 p-3 sm:p-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                {authorAvatar ? (
                  <img
                    src={authorAvatar}
                    alt={authorName}
                    className="w-10 h-10 rounded-full border border-border/70 bg-muted object-cover shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                    {authorName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <UserBadge
                      userId={thread.user_id}
                      username={authorName}
                      displayName={tx.display_name}
                      emojiId={tx.nickname_emoji_id}
                      isAnonymous={false}
                      disableLink={false}
                      stopPropagationOnClick
                    />
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(safeDate(thread.created_at), {
                        locale: dateLocale,
                        addSuffix: true,
                      })}
                    </span>
                    {channelSlug && (
                      <Link
                        to={threadPath}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 border border-primary/20 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
                      >
                        # {channelSlug}
                      </Link>
                    )}
                    <Link
                      to={threadPath}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-primary"
                    >
                      в {isGomoRoute ? "g/" : ""}{slug}/
                    </Link>
                  </div>
                </div>
              </div>

              {/* Own-thread actions */}
              {isOwner && (
                <div className="flex shrink-0 items-center gap-1">
                  <UserMenu
                    type="thread"
                    onEdit={() => {
                      setEditingThread(true);
                      setEditContent(tx.content);
                      setEditContentJson(tx.content_json ?? null);
                    }}
                    onDelete={handleDeleteThread}
                    onReport={() => setReportingThread(true)}
                  />
                </div>
              )}
            </div>

            {/* Title */}
            <h1 className="break-words text-xl sm:text-2xl font-bold leading-snug">{thread.title}</h1>

            {/* Tags / ephemeral */}
            {tx.tags && (
              <div className="flex flex-wrap gap-1.5">
                {tx.ephemeral_type && (
                  <span className="inline-block px-2 py-0.5 text-xs bg-orange-500/10 text-orange-700 rounded-full border border-orange-500/20">
                    {tx.ephemeral_type === "time"
                      ? t("thread.ephemeralHours", { count: tx.ephemeral_value })
                      : t("thread.ephemeralPosts", { count: tx.ephemeral_value })}
                  </span>
                )}
                {tx.tags.content && (
                  <span className="inline-block px-2 py-0.5 text-xs bg-blue-500/10 text-blue-600 rounded-full border border-blue-500/20">
                    {getContentTagLabel(tx.tags.content)}
                  </span>
                )}
                {tx.tags.format && (
                  <span className="inline-block px-2 py-0.5 text-xs bg-green-500/10 text-green-600 rounded-full border border-green-500/20">
                    {getFormatTagLabel(tx.tags.format)}
                  </span>
                )}
                {tx.tags.atmosphere && (
                  <span className="inline-block px-2 py-0.5 text-xs bg-purple-500/10 text-purple-600 rounded-full border border-purple-500/20">
                    {getAtmosphereTagLabel(tx.tags.atmosphere)}
                  </span>
                )}
                {tx.tags.flag === "night" && (
                  <span className="inline-block px-2 py-0.5 text-xs bg-blue-500/10 text-blue-600 rounded-full border border-blue-500/20">
                    Ночной
                  </span>
                )}
              </div>
            )}

            {/* Content / edit */}
            {editingThread ? (
              <div className="space-y-2">
                <GomoRichEditor
                  contentJson={editContentJson}
                  legacyContent={editContent}
                  onChange={({ json, text }) => {
                    setEditContentJson(json);
                    setEditContent(text);
                  }}
                  onSubmit={handleEditThread}
                  placeholder={t("thread.messagePlaceholder")}
                  minHeightClassName="min-h-[120px]"
                />
                <div className="flex gap-2">
                  <Button onClick={handleEditThread} size="sm">{t("common.save")}</Button>
                  <Button
                    onClick={() => {
                      setEditingThread(false);
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
              <div className="break-words text-[14px] leading-6 sm:text-[15px] sm:leading-7">
                <ProcessedContent
                  content={thread.content}
                  contentJson={tx.content_json}
                  currentUserId={user?.id || null}
                  isAdmin={isAdmin}
                  currentUsername={currentUserUsername}
                  currentUserColor={currentUserColor}
                  postAuthorId={thread.user_id}
                  authorUsername={tx.username}
                />
              </div>
            )}

            {/* Attachments */}
            {attachments.length > 0 && (
              <WallAttachments
                attachments={attachments}
                galleryKey={`thread-${thread.id}`}
                onImageClick={(items, idx) => {
                  setGalleryItems(items);
                  setGalleryIndex(idx);
                }}
              />
            )}

            {/* Poll */}
            {pollData && (
              <Poll
                poll={pollData}
                threadId={threadId!}
                currentUserId={user?.id || null}
                isPageLoading={false}
              />
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
              <LikeButton
                postId={thread.id}
                currentUserId={user?.id || null}
                postAuthorId={thread.user_id}
                isThread
              />
              <ActionButton
                icon={<span className="h-4 w-4 flex items-center justify-center text-sm font-semibold">💬</span>}
                label="Ответы"
                count={postCount}
                onClick={() => {
                  document.querySelector("[data-thread-comments]")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              />
              <ActionButton
                icon={<span className="h-4 w-4 flex items-center justify-center">🔗</span>}
                label="Поделиться"
                showLabel={false}
                disabled={!user}
                onClick={() => setShareOpen(true)}
              />
              {!isOwner && user && (
                <ActionButton
                  icon={<AlertTriangle className="h-4 w-4" />}
                  label="Пожаловаться"
                  showLabel={false}
                  onClick={() => setReportingThread(true)}
                />
              )}
            </div>
          </div>
        </div>

        {/* Comments — wall-style tree */}
        <div data-thread-comments>
          <ThreadCommentTree
            threadId={threadId!}
            currentUserId={canPost ? user?.id ?? null : null}
            onPostCountChange={(delta) => setPostCount((prev) => Math.max(0, prev + delta))}
          />
        </div>
      </main>

      {/* Report thread dialog */}
      <Dialog open={reportingThread} onOpenChange={(open) => !open && setReportingThread(false)}>
        <DialogContent className="bg-background border-border">
          <DialogHeader>
            <DialogTitle>{t("thread.reportThread")}</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder={t("thread.reportReasonPlaceholder")}
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            rows={3}
          />
          <Button onClick={handleReportThread}>Отправить жалобу</Button>
        </DialogContent>
      </Dialog>

      {/* Attachment lightbox */}
      {!!galleryItems && (
        <Lightbox
          items={galleryItems}
          initialIndex={galleryIndex}
          onClose={() => setGalleryItems(null)}
        />
      )}

      <ShareSheet
        open={shareOpen}
        onOpenChange={setShareOpen}
        target={{ type: "thread", id: thread.id }}
        url={`${window.location.origin}${threadPath}/thread/${thread.id}`}
        title={thread.title || "Запись"}
      />
    </>
  );
};

export default Thread;
