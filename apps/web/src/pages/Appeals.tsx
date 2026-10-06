import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { Ban, Gavel, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { apiClient } from "@/integrations/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useDateLocale } from "@/i18n/dateLocale";
import { safeDate } from "@/utils/safeDate";
import { cn } from "@/lib/utils";

interface SanctionItem {
  id: string;
  kind: "warn" | "mute" | "ban";
  reason: string;
  created_at?: string;
  expires_at?: string | null;
  active: boolean;
}

interface AppealItem {
  id: string;
  sanction_id: string;
  sanction_kind: string;
  sanction_reason: string;
  body: string;
  status: "open" | "accepted" | "rejected";
  decision_note?: string | null;
  created_at?: string;
}

const KIND_LABELS: Record<string, string> = {
  warn: "Предупреждение",
  mute: "Запрет писать",
  ban: "Блокировка",
};

const STATUS_LABELS: Record<string, string> = {
  open: "На рассмотрении",
  accepted: "Принята",
  rejected: "Отклонена",
};

const STATUS_STYLES: Record<string, string> = {
  open: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  accepted: "border-green-500/30 bg-green-500/10 text-green-600",
  rejected: "border-border/60 bg-muted/40 text-muted-foreground",
};

/**
 * My sanctions and appeals (route /appeals). A sanctioned user sees what is
 * active, appeals it once, and follows the outcome.
 */
const Appeals = () => {
  const dateLocale = useDateLocale();
  const [sanctions, setSanctions] = useState<SanctionItem[]>([]);
  const [appeals, setAppeals] = useState<AppealItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [appealTarget, setAppealTarget] = useState<SanctionItem | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [s, a] = await Promise.all([
        apiClient.rawRequest<{ items: SanctionItem[] }>("/api/v1/moderation/sanctions/mine"),
        apiClient.rawRequest<{ items: AppealItem[] }>("/api/v1/moderation/appeals/mine"),
      ]);
      setSanctions((s.data as { items: SanctionItem[] })?.items ?? []);
      setAppeals((a.data as { items: AppealItem[] })?.items ?? []);
    } catch {
      toast.error("Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const appealedSanctionIds = new Set(appeals.map((a) => a.sanction_id));

  const submitAppeal = async () => {
    if (!appealTarget) return;
    const text = body.trim();
    if (text.length < 10) {
      toast.error("Опишите причину подробнее");
      return;
    }
    setBusy(true);
    try {
      await apiClient.rawRequest("/api/v1/moderation/appeals", {
        method: "POST",
        body: JSON.stringify({ sanction_id: appealTarget.id, body: text }),
      });
      toast.success("Апелляция отправлена");
      setAppealTarget(null);
      setBody("");
      await load();
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === "appeal_already_exists") toast.error("Вы уже подали апелляцию");
      else if (e.code === "sanction_inactive") toast.error("Санкция уже не действует");
      else toast.error(e.message || "Не удалось отправить апелляцию");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-background min-h-screen">
      <main className="mx-auto max-w-2xl space-y-5 p-4 pb-16">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Gavel className="h-5 w-5 text-primary" />
          Санкции и апелляции
        </h1>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Загружаем…
          </div>
        ) : (
          <>
            <section className="rounded-xl border border-border/70 bg-surface">
              <div className="border-b border-border/50 px-4 py-2.5">
                <h2 className="flex items-center gap-2 font-semibold">
                  <Ban className="h-4 w-4 text-primary" /> Мои санкции
                </h2>
              </div>
              <div className="space-y-2 px-4 py-3">
                {sanctions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Санкций нет.</p>
                ) : (
                  sanctions.map((s) => (
                    <div key={s.id} className="rounded-lg border border-border/50 bg-background/60 p-2.5">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">{KIND_LABELS[s.kind] ?? s.kind}</span>
                        {s.active ? (
                          <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">
                            действует
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">снята/истекла</span>
                        )}
                        {s.created_at && (
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(safeDate(s.created_at), { locale: dateLocale, addSuffix: true })}
                          </span>
                        )}
                        {s.expires_at && (
                          <span className="text-[11px] text-muted-foreground">
                            до {format(safeDate(s.expires_at), "dd.MM.yyyy HH:mm")}
                          </span>
                        )}
                        {s.active && !appealedSanctionIds.has(s.id) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="ml-auto"
                            onClick={() => { setAppealTarget(s); setBody(""); }}
                          >
                            Обжаловать
                          </Button>
                        )}
                        {s.active && appealedSanctionIds.has(s.id) && (
                          <span className="ml-auto text-[11px] text-muted-foreground">апелляция подана</span>
                        )}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{s.reason}</p>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-xl border border-border/70 bg-surface">
              <div className="border-b border-border/50 px-4 py-2.5">
                <h2 className="font-semibold">Мои апелляции</h2>
              </div>
              <div className="space-y-2 px-4 py-3">
                {appeals.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Апелляций нет.</p>
                ) : (
                  appeals.map((a) => (
                    <div key={a.id} className="rounded-lg border border-border/50 bg-background/60 p-2.5">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", STATUS_STYLES[a.status])}>
                          {STATUS_LABELS[a.status] ?? a.status}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {KIND_LABELS[a.sanction_kind] ?? a.sanction_kind}
                          {a.created_at ? ` · ${formatDistanceToNow(safeDate(a.created_at), { locale: dateLocale, addSuffix: true })}` : ""}
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{a.body}</p>
                      {a.decision_note && (
                        <p className="mt-1 text-xs text-muted-foreground">Ответ модератора: {a.decision_note}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        )}

        <p className="text-xs text-muted-foreground">
          Санкции и апелляции касаются только вашего аккаунта. <Link to="/" className="text-primary hover:underline">На главную</Link>
        </p>
      </main>

      <Dialog open={!!appealTarget} onOpenChange={(open) => !open && setAppealTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Обжаловать санкцию</DialogTitle>
            <DialogDescription>
              {appealTarget && `${KIND_LABELS[appealTarget.kind] ?? appealTarget.kind}: ${appealTarget.reason}`}
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 4000))}
            placeholder="Объясните, почему санкция несправедлива…"
            rows={5}
            className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setAppealTarget(null)}>Отмена</Button>
            <Button onClick={submitAppeal} disabled={busy || body.trim().length < 10}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Отправить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Appeals;
