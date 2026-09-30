import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { ExternalLink, Loader2, ScrollText } from "lucide-react";
import { toast } from "sonner";

import { apiClient } from "@/integrations/api/client";
import { useModeratorGate } from "@/hooks/useModeratorGate";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { safeDate } from "@/utils/safeDate";

interface ActionItem {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  link?: string;
  reason_code?: string | null;
  note?: string | null;
  moderator: string;
  created_at?: string;
}

interface ActionsPage {
  items: ActionItem[];
  total: number;
  limit: number;
  offset: number;
}

const ACTION_LABELS: Record<string, string> = {
  resolve: "Жалоба решена",
  reject: "Жалоба отклонена",
  resolve_target: "Жалобы объекта закрыты",
  delete_content: "Контент удалён",
  note: "Заметка",
  note_deleted: "Заметка удалена",
  sanction_warn: "Предупреждение",
  sanction_mute: "Запрет писать",
  sanction_ban: "Блокировка",
  unsanction: "Санкция снята",
};

const TARGET_LABELS: Record<string, string> = {
  wall_post: "запись стены",
  wall_comment: "коммент стены",
  thread: "запись в сабе",
  post: "комментарий",
  user: "пользователь",
  gomosub: "саб",
};

const PAGE = 50;

/**
 * Moderation audit log (route /moderation/audit): the append-only
 * moderation_actions table — who did what, when, on which target, and why.
 */
const ModerationAudit = () => {
  const { canReadModeration } = useModeratorGate();

  const [items, setItems] = useState<ActionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("all");
  const [targetType, setTargetType] = useState("all");

  const load = useCallback(
    async (nextOffset: number, append: boolean) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: String(PAGE), offset: String(nextOffset) });
        if (action !== "all") params.set("action", action);
        if (targetType !== "all") params.set("target_type", targetType);
        const { data, error } = await apiClient.rawRequest<ActionsPage>(`/api/v1/moderation/actions?${params}`);
        if (error) throw error;
        const payload = (data ?? { items: [], total: 0, limit: PAGE, offset: nextOffset }) as ActionsPage;
        setItems((prev) => (append ? [...prev, ...(payload.items ?? [])] : payload.items ?? []));
        setTotal(payload.total ?? 0);
        setOffset(nextOffset);
      } catch {
        toast.error("Не удалось загрузить журнал");
      } finally {
        setLoading(false);
      }
    },
    [action, targetType],
  );

  useEffect(() => {
    if (!canReadModeration) return;
    load(0, false);
  }, [canReadModeration, load]);

  if (!canReadModeration) return null;

  return (
    <div className="bg-background min-h-screen">
      <main className="mx-auto max-w-3xl p-4 pb-16">
        <div className="mb-4">
          <Link to="/moderation" className="text-sm text-muted-foreground transition-colors hover:text-primary">
            ← Модерация
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold">
            <ScrollText className="h-5 w-5 text-primary" />
            Журнал действий
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading && items.length === 0 ? "Загружаем…" : `${total} записей`}
          </p>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="w-[210px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все действия</SelectItem>
              {Object.entries(ACTION_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={targetType} onValueChange={setTargetType}>
            <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все объекты</SelectItem>
              {Object.entries(TARGET_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading && items.length === 0 ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg border border-border/60 bg-muted/40" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-12 text-center text-muted-foreground">
            Записей нет
          </p>
        ) : (
          <>
            <ol className="space-y-2">
              {items.map((a) => (
                <li key={a.id} className="rounded-lg border border-border/60 bg-surface px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <Link to={`/moderation/actions/${a.id}`} className="font-medium hover:text-primary hover:underline">
                      {ACTION_LABELS[a.action] ?? a.action}
                    </Link>
                    <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                      {TARGET_LABELS[a.target_type] ?? a.target_type}
                    </span>
                    {a.link && (
                      <a
                        href={a.link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" /> открыть
                      </a>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {a.created_at ? format(safeDate(a.created_at), "dd.MM.yyyy HH:mm") : ""}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    модератор: {a.moderator || "—"}
                    {a.reason_code ? ` · код: ${a.reason_code}` : ""}
                  </div>
                  {a.note && <p className="mt-1 whitespace-pre-wrap break-words text-sm">{a.note}</p>}
                </li>
              ))}
            </ol>
            {items.length < total && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => load(offset + PAGE, true)}
                disabled={loading}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Показать ещё"}
              </Button>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default ModerationAudit;
