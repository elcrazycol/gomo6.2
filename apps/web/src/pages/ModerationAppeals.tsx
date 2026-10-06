import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { Check, Loader2, Scale, X } from "lucide-react";
import { toast } from "sonner";

import { apiClient } from "@/integrations/api/client";
import { useModeratorGate } from "@/hooks/useModeratorGate";
import { wsService } from "@/services/websocket";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useDateLocale } from "@/i18n/dateLocale";
import { safeDate } from "@/utils/safeDate";

interface AppealItem {
  id: string;
  sanction_id: string;
  user_id: string;
  username: string;
  body: string;
  status: "open" | "accepted" | "rejected";
  sanction_kind: string;
  sanction_reason: string;
  decision_note?: string | null;
  decided_by?: string;
  created_at?: string;
}

const KIND_LABELS: Record<string, string> = {
  warn: "Предупреждение",
  mute: "Запрет писать",
  ban: "Блокировка",
};

/**
 * Sanction appeals queue (route /moderation/appeals). Accepting an appeal lifts
 * the sanction automatically; both decisions notify the user.
 */
const ModerationAppeals = () => {
  const { isModerator, canReadModeration } = useModeratorGate();
  const dateLocale = useDateLocale();

  const [items, setItems] = useState<AppealItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [decision, setDecision] = useState<{ appeal: AppealItem; accept: boolean } | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await apiClient.rawRequest<{ items: AppealItem[] }>(
        "/api/v1/moderation/appeals?status=open",
      );
      if (error) throw error;
      setItems((data as { items: AppealItem[] })?.items ?? []);
    } catch {
      toast.error("Не удалось загрузить апелляции");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canReadModeration) return;
    load();
  }, [canReadModeration, load]);

  // Realtime: a fresh appeal lands in the queue without a manual refresh.
  useEffect(() => {
    if (!canReadModeration) return;
    wsService.subscribe("moderation");
    const unsubscribe = wsService.on("new_appeal", () => load());
    return () => {
      unsubscribe();
      wsService.unsubscribe("moderation");
    };
  }, [canReadModeration, load]);

  const decide = async () => {
    if (!decision) return;
    const { appeal, accept } = decision;
    setBusy(appeal.id);
    try {
      await apiClient.rawRequest(`/api/v1/moderation/appeals/${appeal.id}/${accept ? "accept" : "reject"}`, {
        method: "POST",
        body: JSON.stringify({ note }),
      });
      toast.success(accept ? "Апелляция принята, санкция снята" : "Апелляция отклонена");
      setDecision(null);
      setNote("");
      await load();
    } catch (err) {
      toast.error((err as Error)?.message || "Не удалось обработать апелляцию");
    } finally {
      setBusy(null);
    }
  };

  if (!canReadModeration) return null;

  return (
    <div className="bg-background min-h-screen">
      <main className="mx-auto max-w-3xl p-4 pb-16">
        <div className="mb-4">
          <Link to="/moderation" className="text-sm text-muted-foreground transition-colors hover:text-primary">
            ← Модерация
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold">
            <Scale className="h-5 w-5 text-primary" />
            Апелляции
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading ? "Загружаем…" : items.length === 0 ? "Открытых апелляций нет" : `${items.length} на рассмотрении`}
          </p>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-border/60 bg-muted/40" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-12 text-center text-muted-foreground">
            Апелляций нет
          </p>
        ) : (
          <div className="space-y-3">
            {items.map((a) => (
              <article key={a.id} className="rounded-xl border border-border/70 bg-surface p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {KIND_LABELS[a.sanction_kind] ?? a.sanction_kind}
                  </span>
                  <Link to={`/moderation/users/${a.user_id}`} className="font-medium hover:text-primary hover:underline">
                    {a.username}
                  </Link>
                  {a.created_at && (
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(safeDate(a.created_at), { locale: dateLocale, addSuffix: true })}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Санкция: {a.sanction_reason}
                </p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm">{a.body}</p>

                {isModerator && (
                  <div className="mt-3 flex gap-2 border-t border-border/50 pt-3">
                    <Button
                      size="sm"
                      className="gap-1.5"
                      onClick={() => { setDecision({ appeal: a, accept: true }); setNote(""); }}
                      disabled={busy === a.id}
                    >
                      <Check className="h-4 w-4" /> Принять и снять
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => { setDecision({ appeal: a, accept: false }); setNote(""); }}
                      disabled={busy === a.id}
                    >
                      <X className="h-4 w-4" /> Отклонить
                    </Button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </main>

      <Dialog open={!!decision} onOpenChange={(open) => !open && setDecision(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{decision?.accept ? "Принять апелляцию?" : "Отклонить апелляцию?"}</DialogTitle>
            <DialogDescription>
              {decision?.accept
                ? "Санкция будет снята, пользователь получит уведомление."
                : "Санкция останется в силе, пользователь получит уведомление."}
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 1000))}
            placeholder="Комментарий для пользователя (необязательно)"
            rows={3}
            className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDecision(null)}>Отмена</Button>
            <Button variant={decision?.accept ? "default" : "destructive"} onClick={decide} disabled={busy !== null}>
              {busy === decision?.appeal.id ? <Loader2 className="h-4 w-4 animate-spin" /> : decision?.accept ? "Принять" : "Отклонить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ModerationAppeals;
