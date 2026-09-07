import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { useDateLocale } from "@/i18n/dateLocale";
import { CheckCheck, ChevronDown, ChevronRight, Flag, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { apiClient } from "@/integrations/api/client";
import { useModeratorGate } from "@/hooks/useModeratorGate";
import { wsService } from "@/services/websocket";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { REPORT_CATEGORIES } from "@/components/moderation/ReportDialog";
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

const plural = (n: number, one: string, few: string, many: string): string =>
  n === 1 ? one : n < 5 ? few : many;

/**
 * Minimal moderation queue: every post with open reports grouped under one
 * entry, sorted by open report count (most-reported first). Fresh reports
 * arrive in realtime via the "moderation" WebSocket room.
 */
const ModerationPosts = () => {
  const { isModerator } = useModeratorGate();
  const dateLocale = useDateLocale();

  const [groups, setGroups] = useState<ReportGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReportGroup | null>(null);

  const loadGroups = useCallback(async () => {
    try {
      const { data, error } = await apiClient.rawRequest<ReportGroup[]>("/api/v1/moderation/reports");
      if (error) throw error;
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
    const postId = group.post.id as string;
    setBusy(postId);
    try {
      await apiClient.rawRequest(`/api/v1/moderation/posts/${postId}/resolve`, { method: "POST" });
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
      await apiClient.rawRequest(`/api/v1/moderation/posts/${postId}`, { method: "DELETE" });
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
      <main className="mx-auto max-w-2xl p-4">
        <div className="mb-5">
          <Link
            to="/moderation"
            className="text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            ← Модерация
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-bold">
            <Flag className="h-5 w-5 text-primary" />
            Жалобы
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading
              ? "Загружаем…"
              : totalOpen === 0
                ? "Всё чисто — открытых жалоб нет"
                : `${totalOpen} ${plural(totalOpen, "открытая жалоба", "открытые жалобы", "открытых жалоб")} · больше жалоб = выше в списке`}
          </p>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg border border-border/60 bg-muted/40" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-10 text-center text-muted-foreground">
            Очередь пуста. Новые жалобы появятся здесь автоматически.
          </p>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => {
              const post = group.post;
              const postId = post.id as string;
              const content = (post.content as string) ?? "";
              const authorUsername = (post.author as { username?: string } | null)?.username ?? "неизвестный";
              const createdAt = safeDate(post.created_at as string);
              const attachments = (post.attachments as unknown[] | null) ?? [];
              const openReports = group.reports.filter((r) => r.status === "open");
              const isExpanded = expanded.has(postId);
              const isBusy = busy === postId;

              return (
                <div key={postId} className="rounded-lg border border-border/70 bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span className="font-medium">{authorUsername}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(createdAt, { locale: dateLocale, addSuffix: true })}
                        </span>
                      </div>
                      {content.trim() && (
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{content}</p>
                      )}
                      {attachments.length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          + {attachments.length} {plural(attachments.length, "вложение", "вложения", "вложений")}
                        </p>
                      )}
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium",
                        openReports.length > 0
                          ? "border-orange-500/30 bg-orange-500/10 text-orange-600"
                          : "border-border/60 bg-muted/40 text-muted-foreground",
                      )}
                    >
                      {openReports.length} {plural(openReports.length, "жалоба", "жалобы", "жалоб")}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/50 pt-2">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(postId)}
                      aria-expanded={isExpanded}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      Жалобы ({group.reports.length})
                    </button>
                    <div className="ml-auto flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleResolve(group)}
                        disabled={isBusy || openReports.length === 0}
                      >
                        {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
                        Решить
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeleteTarget(group)}
                        disabled={isBusy}
                      >
                        <Trash2 className="h-4 w-4" />
                        Удалить
                      </Button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-2 space-y-2">
                      {group.reports.map((report) => (
                        <div
                          key={report.id}
                          className={cn(
                            "rounded-md border border-border/60 bg-muted/20 p-2.5",
                            report.status === "resolved" && "opacity-60",
                          )}
                        >
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                            <span className="font-medium">{report.reporter.username}</span>
                            <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                              {categoryLabel(report.category)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(safeDate(report.created_at), { locale: dateLocale, addSuffix: true })}
                            </span>
                            {report.status === "resolved" && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-green-600">
                                <CheckCheck className="h-3 w-3" />
                                Решена
                              </span>
                            )}
                          </div>
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm">{report.reason}</p>
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

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Удалить запись?</DialogTitle>
            <DialogDescription>
              Запись будет удалена безвозвратно вместе со всеми жалобами, комментариями и лайками.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={busy !== null}>
              {busy === deleteTarget?.post.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Trash2 className="mr-1.5 h-4 w-4" />
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