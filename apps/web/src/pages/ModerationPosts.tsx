import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { useDateLocale } from "@/i18n/dateLocale";
import {
  CheckCheck, ChevronDown, ChevronRight, ExternalLink, Flag, Loader2, Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { apiClient } from "@/integrations/api/client";
import { useModeratorGate } from "@/hooks/useModeratorGate";
import { wsService } from "@/services/websocket";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { REPORT_CATEGORIES } from "@/components/moderation/ReportDialog";
import { safeDate } from "@/utils/safeDate";
import { cn } from "@/lib/utils";

interface QueueReport {
  id: string;
  target_type: string;
  target_id: string;
  reporter_id: string;
  reporter: { username: string; display_name?: string | null; avatar_url?: string | null };
  category: string;
  reason: string;
  status: "open" | "resolved" | "rejected";
  source?: string;
  reason_code?: string | null;
  resolution_note?: string | null;
  created_at: string;
}

interface QueueTarget {
  type: string;
  id: string;
  exists: boolean;
  title?: string;
  content?: string;
  author_username?: string;
  author_id?: string;
  created_at?: string;
  link?: string;
}

interface QueueGroup {
  target: QueueTarget;
  reports: QueueReport[];
  open_count: number;
  total_count: number;
  last_at?: string;
}

interface QueuePage {
  items: QueueGroup[];
  total: number;
  limit: number;
  offset: number;
}

const TARGET_LABELS: Record<string, string> = {
  wall_post: "Запись на стене",
  wall_comment: "Комментарий на стене",
  thread: "Запись в сабе",
  post: "Комментарий",
  user: "Пользователь",
  gomosub: "Саб",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Открытые жалобы",
  resolved: "Оставленные",
  rejected: "Отклонённые",
  all: "Все",
};

// Target types with a moderator delete path.
const DELETE_ENDPOINT: Record<string, (id: string) => { url: string; method: string }> = {
  wall_post: (id) => ({ url: `/api/v1/moderation/posts/${id}`, method: "DELETE" }),
  thread: (id) => ({ url: `/api/v1/threads?id=eq.${encodeURIComponent(id)}`, method: "DELETE" }),
  post: (id) => ({ url: `/api/v1/posts?id=eq.${encodeURIComponent(id)}`, method: "DELETE" }),
};

const categoryLabel = (value: string): string =>
  REPORT_CATEGORIES.find((c) => c.value === value)?.label ?? value;

const plural = (n: number, one: string, few: string, many: string): string =>
  n === 1 ? one : n < 5 ? few : many;

/** Report categories of a group with their open counts, most frequent first. */
const categoryCounts = (reports: QueueReport[]): { label: string; count: number }[] => {
  const map = new Map<string, number>();
  reports.filter((r) => r.status === "open").forEach((r) => map.set(r.category, (map.get(r.category) || 0) + 1));
  return [...map.entries()]
    .map(([category, count]) => ({ label: categoryLabel(category), count }))
    .sort((a, b) => b.count - a.count);
};

/**
 * Moderation queue — the single moderation screen (route /moderation).
 *
 * Each card is one reported target: what it is, who wrote it, the content
 * itself with a link to open it, the report categories and every report behind
 * an expander. Two decisive actions only:
 *
 *   Оставить  — close the reports without touching the content;
 *   Удалить   — remove the content (when a moderator delete path exists).
 *
 * Fresh reports arrive over the "moderation" WebSocket room.
 */
const ModerationPosts = () => {
  const { isModerator, canReadModeration } = useModeratorGate();
  const dateLocale = useDateLocale();

  const [page, setPage] = useState<QueuePage>({ items: [], total: 0, limit: 50, offset: 0 });
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("open");
  const [targetType, setTargetType] = useState("all");
  const [category, setCategory] = useState("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QueueGroup | null>(null);

  const loadQueue = useCallback(async (nextOffset = 0, append = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status, limit: "50", offset: String(nextOffset) });
      if (targetType !== "all") params.set("target_type", targetType);
      if (category !== "all") params.set("category", category);
      const { data, error } = await apiClient.rawRequest<QueuePage>(`/api/v1/moderation/reports?${params}`);
      if (error) throw error;
      const payload = (data ?? { items: [], total: 0, limit: 50, offset: 0 }) as QueuePage;
      const fresh = Array.isArray(payload.items) ? payload.items : [];
      setPage((prev) => ({ ...payload, items: append ? [...prev.items, ...fresh] : fresh }));
    } catch (err) {
      console.error("Error loading moderation queue:", err);
      toast.error("Ошибка загрузки жалоб");
    } finally {
      setLoading(false);
    }
  }, [status, targetType, category]);

  useEffect(() => {
    if (!canReadModeration) return;
    loadQueue();
  }, [canReadModeration, loadQueue]);

  useEffect(() => {
    if (!canReadModeration) return;
    wsService.subscribe("moderation");
    const unsubscribe = wsService.on("new_report", () => loadQueue());
    return () => {
      unsubscribe();
      wsService.unsubscribe("moderation");
    };
  }, [canReadModeration, loadQueue]);

  const totals = useMemo(
    () => ({
      open: page.items.reduce((sum, g) => sum + g.open_count, 0),
      targets: page.total,
    }),
    [page],
  );

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // "Оставить": close every open report on the target, keep the content.
  const dismissReports = async (group: QueueGroup) => {
    const key = `${group.target.type}:${group.target.id}`;
    setBusy(key);
    try {
      await apiClient.rawRequest(
        `/api/v1/moderation/targets/${group.target.type}/${group.target.id}/resolve`,
        { method: "POST" },
      );
      toast.success("Жалобы закрыты, контент оставлен");
      await loadQueue();
    } catch (err) {
      toast.error((err as Error)?.message || "Не удалось закрыть жалобы");
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { type, id } = deleteTarget.target;
    const endpoint = DELETE_ENDPOINT[type];
    if (!endpoint) return;
    const key = `${type}:${id}`;
    setBusy(key);
    try {
      const { url, method } = endpoint(id);
      await apiClient.rawRequest(url, { method });
      toast.success("Контент удалён");
      setDeleteTarget(null);
      await loadQueue();
    } catch (err) {
      toast.error((err as Error)?.message || "Не удалось удалить контент");
    } finally {
      setBusy(null);
    }
  };

  if (!canReadModeration) return null;

  return (
    <div className="bg-background min-h-screen">
      <main className="mx-auto max-w-3xl p-4 pb-16">
        <header className="mb-5">
          <Link to="/moderation" className="text-sm text-muted-foreground transition-colors hover:text-primary">
            ← Модерация
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold">
            <Flag className="h-5 w-5 text-primary" />
            Жалобы
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading
              ? "Загружаем…"
              : totals.open === 0
                ? "Открытых жалоб нет"
                : `${totals.open} ${plural(totals.open, "открытая жалоба", "открытые жалобы", "открытых жалоб")} на ${totals.targets} ${plural(totals.targets, "объект", "объекта", "объектов")}`}
          </p>
        </header>

        <div className="mb-4 flex flex-wrap gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={targetType} onValueChange={setTargetType}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все типы</SelectItem>
              {Object.entries(TARGET_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все категории</SelectItem>
              {REPORT_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-xl border border-border/60 bg-muted/40" />
            ))}
          </div>
        ) : page.items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-14 text-center text-muted-foreground">
            <CheckCheck className="mx-auto mb-2 h-6 w-6 opacity-60" />
            Очередь пуста
          </div>
        ) : (
          <div className="space-y-3">
            {page.items.map((group) => {
              const key = `${group.target.type}:${group.target.id}`;
              const isExpanded = expanded.has(key);
              const isBusy = busy === key;
              const cats = categoryCounts(group.reports);
              const canDelete = !!DELETE_ENDPOINT[group.target.type] && group.target.exists;

              return (
                <article key={key} className="overflow-hidden rounded-xl border border-border/70 bg-surface">
                  {/* Header: what it is, who wrote it, when */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/50 px-4 py-2.5 text-sm">
                    <span className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {TARGET_LABELS[group.target.type] ?? group.target.type}
                    </span>
                    {group.target.author_username && (
                      group.target.author_id ? (
                        <a
                          href={`/moderation/users/${group.target.author_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium hover:text-primary hover:underline"
                        >
                          {group.target.author_username}
                        </a>
                      ) : (
                        <span className="font-medium">{group.target.author_username}</span>
                      )
                    )}
                    {group.last_at && (
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(safeDate(group.last_at), { locale: dateLocale, addSuffix: true })}
                      </span>
                    )}
                    <span
                      className={cn(
                        "ml-auto shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium",
                        group.open_count > 0
                          ? "border-orange-500/30 bg-orange-500/10 text-orange-600"
                          : "border-border/60 bg-muted/40 text-muted-foreground",
                      )}
                    >
                      {group.open_count} {plural(group.open_count, "жалоба", "жалобы", "жалоб")}
                    </span>
                  </div>

                  {/* The content itself */}
                  <div className="px-4 py-3">
                    {!group.target.exists ? (
                      <p className="text-sm text-muted-foreground">Контент уже удалён.</p>
                    ) : (
                      <>
                        {group.target.title?.trim() && (
                          <p className="mb-1 font-semibold break-words">{group.target.title}</p>
                        )}
                        {group.target.content?.trim() ? (
                          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-sm">
                            {group.target.content}
                          </p>
                        ) : (
                          <p className="text-sm text-muted-foreground">Без текста</p>
                        )}
                      </>
                    )}

                    {cats.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {cats.map((c) => (
                          <span
                            key={c.label}
                            className="rounded-full border border-orange-500/20 bg-orange-500/5 px-2 py-0.5 text-[11px] text-orange-700 dark:text-orange-400"
                          >
                            {c.label} ×{c.count}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2 border-t border-border/50 px-4 py-2.5">
                    {group.reports[0] && (
                      <Link
                        to={`/moderation/reports/${group.reports[0].id}`}
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      >
                        <Flag className="h-4 w-4" />
                        Жалоба
                      </Link>
                    )}
                    {group.target.link ? (
                      <a
                        href={group.target.link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-primary"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Открыть
                      </a>
                    ) : (
                      <span className="text-sm text-muted-foreground/60">Открыть недоступно</span>
                    )}

                    <button
                      type="button"
                      onClick={() => toggleExpanded(key)}
                      aria-expanded={isExpanded}
                      className="ml-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      Жалобы ({group.reports.length})
                    </button>

                    {isModerator && (
                    <div className="ml-auto flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => dismissReports(group)}
                        disabled={isBusy || group.open_count === 0}
                        title="Закрыть жалобы, ничего не меняя"
                      >
                        {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
                        Оставить
                      </Button>
                      {canDelete && (
                        <Button
                          variant="destructive"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => setDeleteTarget(group)}
                          disabled={isBusy}
                        >
                          <Trash2 className="h-4 w-4" />
                          Удалить
                        </Button>
                      )}
                    </div>
                    )}
                  </div>

                  {/* Every report behind the expander */}
                  {isExpanded && (
                    <div className="space-y-2 border-t border-border/50 bg-muted/10 px-4 py-3">
                      {group.reports.map((report) => (
                        <div
                          key={report.id}
                          className={cn(
                            "rounded-lg border border-border/50 bg-background/60 p-2.5",
                            report.status !== "open" && "opacity-60",
                          )}
                        >
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                            <span className="font-medium">
                              {report.source === "system" ? "система" : report.reporter.username}
                            </span>
                            <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                              {categoryLabel(report.category)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(safeDate(report.created_at), { locale: dateLocale, addSuffix: true })}
                            </span>
                            {report.status === "resolved" && (
                              <span className="text-[11px] text-green-600">оставлена</span>
                            )}
                            {report.status === "rejected" && (
                              <span className="text-[11px] text-muted-foreground">отклонена</span>
                            )}
                          </div>
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                            {report.reason}
                          </p>
                          {report.resolution_note && (
                            <p className="mt-1 text-xs text-muted-foreground">Заметка: {report.resolution_note}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
            {page.items.length < page.total && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadQueue(page.items.length, true)}
                disabled={loading}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : `Показать ещё (${page.total - page.items.length})`}
              </Button>
            )}
          </div>
        )}
      </main>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Удалить контент?</DialogTitle>
            <DialogDescription>
              {deleteTarget && `${TARGET_LABELS[deleteTarget.target.type] ?? deleteTarget.target.type} будет удалён безвозвратно вместе с жалобами и связанными данными.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Отмена</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={busy !== null} className="gap-1.5">
              {busy === `${deleteTarget?.target.type}:${deleteTarget?.target.id}` ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <><Trash2 className="h-4 w-4" />Удалить</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ModerationPosts;
