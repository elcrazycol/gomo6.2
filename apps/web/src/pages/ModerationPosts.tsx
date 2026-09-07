import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { useDateLocale } from "@/i18n/dateLocale";
import {
  CheckCheck, ChevronDown, ChevronRight, Flag, Loader2, MessageSquareWarning, Shield, Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { apiClient } from "@/integrations/api/client";
import { useModeratorGate } from "@/hooks/useModeratorGate";
import { wsService } from "@/services/websocket";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { UserBadge } from "@/components/UserBadge";
import { ProcessedContent } from "@/components/ProcessedContent";
import { WallAttachments } from "@/components/WallAttachments";
import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import { REPORT_CATEGORIES } from "@/components/moderation/ReportDialog";
import {
  type WallPost,
  normalizeAttachments,
  normalizeWallPostRecord,
  getWallPostPath,
} from "@/utils/wallNormalizers";
import { safeDate } from "@/utils/safeDate";
import { cn } from "@/lib/utils";

interface QueueReport {
  id: string;
  post_id: string;
  reporter_id: string;
  reporter: {
    username: string;
    display_name?: string | null;
    avatar_url?: string | null;
  };
  category: string;
  reason: string;
  status: "open" | "resolved";
  created_at: string;
}

interface ReportGroup {
  post: Record<string, unknown>;
  reports: QueueReport[];
  report_count: number;
  open_count: number;
}

const categoryLabel = (value: string): string =>
  REPORT_CATEGORIES.find((c) => c.value === value)?.label ?? value;

/**
 * Moderation queue for wall-post reports: every post with at least one open
 * report, grouped under ONE entry per post (expandable to see each report),
 * sorted server-side by open report count so the most-reported content sits on
 * top. Fresh reports land here in realtime via the "moderation" WebSocket
 * room (new_report event) — no manual refresh needed.
 */
const ModerationPosts = () => {
  const { isModerator, currentUserUsername, currentUserColor } = useModeratorGate();
  const dateLocale = useDateLocale();

  const [groups, setGroups] = useState<ReportGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null); // postId being resolved/deleted
  const [deleteTarget, setDeleteTarget] = useState<ReportGroup | null>(null);
  const [galleryItems, setGalleryItems] = useState<LightboxItem[] | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);

  const loadGroups = useCallback(async () => {
    try {
      const { data, error } = await apiClient.rawRequest<ReportGroup[]>("/api/v1/moderation/reports");
      if (error) throw error;
      // The generic ApiResponse types data as T | T[], so narrow explicitly.
      setGroups((Array.isArray(data) ? data : [data]).filter(Boolean) as ReportGroup[]);
    } catch (err) {
      console.error("Error loading moderation queue:", err);
      toast.error("Ошибка загрузки жалоб");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isModerator) return;
    loadGroups();
  }, [isModerator, loadGroups]);

  // Realtime: a fresh report anywhere lands in the queue immediately.
  useEffect(() => {
    if (!isModerator) return;
    wsService.subscribe("moderation");
    const unsubscribe = wsService.on("new_report", () => {
      loadGroups();
    });
    return () => {
      unsubscribe();
      wsService.unsubscribe("moderation");
    };
  }, [isModerator, loadGroups]);

  const totalOpen = useMemo(() => groups.reduce((sum, g) => sum + g.open_count, 0), [groups]);

  const toggleExpanded = (postId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });
  };

  const handleResolve = async (group: ReportGroup) => {
    setBusy(group.post.id as string);
    try {
      await apiClient.rawRequest(`/api/v1/moderation/posts/${group.post.id}/resolve`, {
        method: "POST",
      });
      toast.success("Жалобы решены — пост остаётся на стене");
      await loadGroups();
    } catch (err) {
      toast.error((err as Error)?.message || "Не удалось обработать жалобы");
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const postId = deleteTarget.post.id as string;
    setBusy(postId);
    try {
      await apiClient.rawRequest(`/api/v1/moderation/posts/${postId}`, {
        method: "DELETE",
      });
      toast.success("Пост удалён");
      setDeleteTarget(null);
      await loadGroups();
    } catch (err) {
      toast.error((err as Error)?.message || "Не удалось удалить пост");
    } finally {
      setBusy(null);
    }
  };

  if (!isModerator) return null;

  return (
    <div className="bg-background min-h-screen">
      <main className="mx-auto max-w-3xl p-4">
        <div className="mb-6">
          <Link
            to="/moderation"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-primary"
          >
            ← Модерация
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <MessageSquareWarning className="h-6 w-6 text-primary" />
            Жалобы на записи
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading
              ? "Загружаем очередь…"
              : totalOpen === 0
                ? "Всё чисто — открытых жалоб нет"
                : `${totalOpen} ${totalOpen === 1 ? "открытая жалоба" : totalOpen < 5 ? "открытые жалобы" : "открытых жалоб"} · чем больше жалоб на запись, тем выше она в списке`}
          </p>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-xl border border-border/60 bg-muted/40" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-6 py-16 text-center">
            <Shield className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-lg font-medium">Очередь пуста</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Новые жалобы появятся здесь автоматически.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => {
              const post = normalizeWallPostRecord(group.post, currentUserUsername) as WallPost;
              const attachments = normalizeAttachments(post);
              const openReports = group.reports.filter((r) => r.status === "open");
              const isExpanded = expanded.has(post.id);
              const isBusy = busy === post.id;

              return (
                <div key={post.id} className="overflow-clip rounded-xl border border-border/70 bg-card shadow-none">
                  {/* Post preview */}
                  <div className="p-3 sm:p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-start gap-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <UserBadge
                              userId={post.author_id}
                              username={post.author.username}
                              displayName={post.author.display_name}
                              emojiId={post.author.nickname_emoji_id}
                              isAnonymous={post.author.is_anonymous}
                              disableLink={false}
                              stopPropagationOnClick
                            />
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(safeDate(post.created_at), {
                                locale: dateLocale,
                                addSuffix: true,
                              })}
                            </span>
                          </div>
                        </div>
                        {/* Open-report count badge */}
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
                            openReports.length > 0
                              ? "border-orange-500/30 bg-orange-500/10 text-orange-600"
                              : "border-border/60 bg-muted/40 text-muted-foreground",
                          )}
                        >
                          <Flag className="h-3 w-3" />
                          {openReports.length} {openReports.length === 1 ? "жалоба" : openReports.length < 5 ? "жалобы" : "жалоб"}
                        </span>
                      </div>
                    </div>

                    {post.content?.trim() && (
                      <div className="mt-3 break-words text-[14px] leading-6 sm:text-[15px] sm:leading-7">
                        <ProcessedContent
                          content={(post.content as string) || ""}
                          contentJson={post.content_json}
                          currentUserId={null}
                          isAdmin={false}
                          currentUsername={currentUserUsername}
                          currentUserColor={currentUserColor}
                          postAuthorId={post.author_id}
                          authorUsername={post.author.username}
                          showHiddenIndicators={false}
                        />
                      </div>
                    )}

                    {attachments.length > 0 && (
                      <div className="mt-3">
                        <WallAttachments
                          attachments={attachments}
                          galleryKey={`moderation-${post.id}`}
                          onImageClick={(items, idx) => {
                            setGalleryItems(items);
                            setGalleryIndex(idx);
                          }}
                        />
                      </div>
                    )}

                    {/* Actions row */}
                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleExpanded(post.id)}
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? (
                          <ChevronDown className="mr-1.5 h-4 w-4" />
                        ) : (
                          <ChevronRight className="mr-1.5 h-4 w-4" />
                        )}
                        {isExpanded
                          ? "Свернуть жалобы"
                          : `Жалобы (${group.reports.length})`}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        asChild
                      >
                        <Link
                          to={getWallPostPath(post.user_id, post.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Открыть запись
                        </Link>
                      </Button>
                      <div className="ml-auto flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleResolve(group)}
                          disabled={isBusy || openReports.length === 0}
                        >
                          {isBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCheck className="mr-1.5 h-4 w-4" />}
                          Решить
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setDeleteTarget(group)}
                          disabled={isBusy}
                        >
                          <Trash2 className="mr-1.5 h-4 w-4" />
                          Удалить пост
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Expandable report list */}
                  {isExpanded && (
                    <div className="space-y-2 border-t border-border/60 bg-muted/20 p-3 sm:p-4">
                      {group.reports.map((report) => (
                        <div
                          key={report.id}
                          className={cn(
                            "rounded-lg border border-border/60 bg-background p-3",
                            report.status === "resolved" && "opacity-60",
                          )}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <UserBadge
                              userId={report.reporter_id}
                              username={report.reporter.username}
                              displayName={report.reporter.display_name}
                              disableLink={false}
                              stopPropagationOnClick
                            />
                            <span
                              className={cn(
                                "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                                report.category === "other"
                                  ? "border-border/60 bg-muted/40 text-muted-foreground"
                                  : "border-primary/25 bg-primary/5 text-primary",
                              )}
                            >
                              {categoryLabel(report.category)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(safeDate(report.created_at), {
                                locale: dateLocale,
                                addSuffix: true,
                              })}
                            </span>
                            {report.status === "resolved" && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[11px] text-green-600">
                                <CheckCheck className="h-3 w-3" />
                                Решена
                              </span>
                            )}
                          </div>
                          <p className="mt-2 whitespace-pre-wrap break-words text-sm">{report.reason}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {galleryItems && (
        <Lightbox
          items={galleryItems}
          initialIndex={galleryIndex}
          onClose={() => setGalleryItems(null)}
        />
      )}

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Удалить запись?</DialogTitle>
            <DialogDescription>
              Запись будет удалена безвозвратно вместе со всеми жалобами,
              комментариями и лайками. Восстановить её будет невозможно.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={busy !== null}>
              {busy === deleteTarget?.post.id ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Удаляем
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  Удалить
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ModerationPosts;