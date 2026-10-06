import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import {
  Ban, Check, ExternalLink, Flag, Gavel, Loader2, ScrollText, UserCog, X,
} from "lucide-react";
import { toast } from "sonner";

import { apiClient } from "@/integrations/api/client";
import { useModeratorGate } from "@/hooks/useModeratorGate";
import { Button } from "@/components/ui/button";
import { REPORT_CATEGORIES } from "@/components/moderation/ReportDialog";
import { safeDate } from "@/utils/safeDate";
import { useDateLocale } from "@/i18n/dateLocale";
import { cn } from "@/lib/utils";

interface ReportItem {
  id: string;
  target_type: string;
  target_id: string;
  target_link?: string;
  reporter: { username: string };
  category: string;
  reason: string;
  status: "open" | "resolved" | "rejected";
  source?: string;
  reason_code?: string | null;
  resolution_note?: string | null;
  created_at?: string;
}

interface TargetInfo {
  type: string;
  id: string;
  exists: boolean;
  title?: string;
  content?: string;
  author_username?: string;
  author_id?: string;
  link?: string;
}

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

interface SanctionItem {
  id: string;
  kind: string;
  reason: string;
  issued_by?: string;
  created_at?: string;
  expires_at?: string | null;
  revoked_at?: string | null;
  active: boolean;
}

interface AppealItem {
  id: string;
  status: "open" | "accepted" | "rejected";
  body: string;
  decision_note?: string | null;
  created_at?: string;
}

interface ReportDetail {
  report: ReportItem;
  target: TargetInfo;
  actions: ActionItem[];
  sanctions: SanctionItem[];
  appeals: AppealItem[];
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
  appeal_accepted: "Апелляция принята",
  appeal_rejected: "Апелляция отклонена",
};

const TARGET_LABELS: Record<string, string> = {
  wall_post: "Запись на стене",
  wall_comment: "Комментарий на стене",
  thread: "Запись в сабе",
  post: "Комментарий",
  user: "Пользователь",
  gomosub: "Саб",
};

const SANCTION_LABELS: Record<string, string> = {
  warn: "Предупреждение",
  mute: "Запрет писать",
  ban: "Блокировка",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Открыта",
  resolved: "Решена",
  rejected: "Отклонена",
};

const categoryLabel = (v: string) => REPORT_CATEGORIES.find((c) => c.value === v)?.label ?? v;

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border/70 bg-surface">
      <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2.5">
        {icon}
        <h2 className="font-semibold">{title}</h2>
      </div>
      <div className="space-y-2 px-4 py-3">{children}</div>
    </section>
  );
}

/**
 * One report in full (route /moderation/reports/:id): the report, its target,
 * every action taken on the target/author, and the author's sanction + appeal
 * chain — everything on one screen, with the triage controls.
 */
const ModerationReport = () => {
  const { isModerator, canReadModeration } = useModeratorGate();
  const { reportId } = useParams<{ reportId: string }>();
  const dateLocale = useDateLocale();

  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    if (!reportId) return;
    setLoading(true);
    try {
      const { data, error } = await apiClient.rawRequest<ReportDetail>(`/api/v1/moderation/reports/${reportId}`);
      if (error) throw error;
      setDetail((data as ReportDetail) ?? null);
    } catch {
      toast.error("Не удалось загрузить жалобу");
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    if (!canReadModeration) return;
    load();
  }, [canReadModeration, load]);

  const triage = async (decision: "resolve" | "reject") => {
    if (!reportId) return;
    setBusy(decision);
    try {
      await apiClient.rawRequest(`/api/v1/moderation/reports/${reportId}/${decision}`, {
        method: "POST",
        body: JSON.stringify({ note }),
      });
      toast.success(decision === "resolve" ? "Жалоба решена" : "Жалоба отклонена");
      setNote("");
      await load();
    } catch (err) {
      toast.error((err as Error)?.message || "Не удалось обработать жалобу");
    } finally {
      setBusy(null);
    }
  };

  const resolveAll = async () => {
    if (!detail) return;
    setBusy("target");
    try {
      await apiClient.rawRequest(
        `/api/v1/moderation/targets/${detail.target.type}/${detail.target.id}/resolve`,
        { method: "POST", body: JSON.stringify({ note }) },
      );
      toast.success("Все жалобы объекта закрыты");
      setNote("");
      await load();
    } catch (err) {
      toast.error((err as Error)?.message || "Не удалось закрыть жалобы");
    } finally {
      setBusy(null);
    }
  };

  if (!canReadModeration) return null;

  if (loading && !detail) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Загружаем…
        </div>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <Link to="/moderation/reports" className="text-sm text-muted-foreground hover:text-primary">← Очередь</Link>
        <p className="mt-4 text-muted-foreground">Жалоба не найдена</p>
      </div>
    );
  }

  const { report, target, actions, sanctions, appeals } = detail;

  return (
    <div className="bg-background min-h-screen">
      <main className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
        <Link to="/moderation/reports" className="text-sm text-muted-foreground transition-colors hover:text-primary">
          ← Очередь жалоб
        </Link>

        {/* Report */}
        <Section icon={<Flag className="h-4 w-4 text-primary" />} title="Жалоба">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium",
              report.status === "open" ? "border-orange-500/30 bg-orange-500/10 text-orange-600" : "border-border/60 bg-muted/40 text-muted-foreground")}>
              {STATUS_LABELS[report.status] ?? report.status}
            </span>
            <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
              {categoryLabel(report.category)}
            </span>
            <span className="font-medium">
              {report.source === "system" ? "система" : report.reporter.username}
            </span>
            <span className="text-xs text-muted-foreground">
              {report.created_at ? format(safeDate(report.created_at), "dd.MM.yyyy HH:mm") : ""}
            </span>
          </div>
          <p className="whitespace-pre-wrap break-words text-sm">{report.reason}</p>
          {report.resolution_note && (
            <p className="text-xs text-muted-foreground">Заметка модератора: {report.resolution_note}</p>
          )}
        </Section>

        {/* Target */}
        <Section icon={<ExternalLink className="h-4 w-4 text-primary" />} title="Объект жалобы">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
              {TARGET_LABELS[target.type] ?? target.type}
            </span>
            {target.author_id ? (
              <Link to={`/moderation/users/${target.author_id}`} className="font-medium hover:text-primary hover:underline">
                {target.author_username || "автор"}
              </Link>
            ) : (
              target.author_username && <span className="font-medium">{target.author_username}</span>
            )}
            {target.link && (
              <a href={target.link} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <ExternalLink className="h-3 w-3" /> открыть
              </a>
            )}
          </div>
          {target.exists ? (
            <div className="rounded-lg border border-border/50 bg-background/60 p-3">
              {target.title?.trim() && <p className="font-semibold break-words">{target.title}</p>}
              <p className="whitespace-pre-wrap break-words text-sm">{target.content?.trim() || "Без текста"}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Контент уже удалён.</p>
          )}
        </Section>

        {/* Triage */}
        {isModerator && report.status === "open" && (
          <Section icon={<Check className="h-4 w-4 text-primary" />} title="Решение">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 1000))}
              placeholder="Комментарий (необязательно)"
              rows={2}
              className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="gap-1.5" onClick={() => triage("resolve")} disabled={busy !== null}>
                {busy === "resolve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Решить
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => triage("reject")} disabled={busy !== null}>
                <X className="h-4 w-4" /> Отклонить
              </Button>
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={resolveAll} disabled={busy !== null}>
                {busy === "target" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Решить все жалобы объекта
              </Button>
            </div>
          </Section>
        )}

        {/* Action trail */}
        <Section icon={<ScrollText className="h-4 w-4 text-primary" />} title="История действий">
          {actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Действий не было.</p>
          ) : (
            <ol className="space-y-2">
              {actions.map((a) => (
                <li key={a.id} className="rounded-lg border border-border/50 bg-background/60 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <Link to={`/moderation/actions/${a.id}`} className="font-medium hover:text-primary hover:underline">
                      {ACTION_LABELS[a.action] ?? a.action}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {a.moderator ? `@${a.moderator}` : "—"}
                      {a.created_at ? ` · ${format(safeDate(a.created_at), "dd.MM.yyyy HH:mm")}` : ""}
                    </span>
                  </div>
                  {a.note && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{a.note}</p>}
                </li>
              ))}
            </ol>
          )}
        </Section>

        {/* Author sanctions + appeals */}
        {(sanctions.length > 0 || appeals.length > 0) && (
          <Section icon={<Ban className="h-4 w-4 text-primary" />} title="Санкции автора">
            {sanctions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Санкций не было.</p>
            ) : (
              sanctions.map((s) => (
                <div key={s.id} className="rounded-lg border border-border/50 bg-background/60 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{SANCTION_LABELS[s.kind] ?? s.kind}</span>
                    <span className={cn("text-[11px]", s.active ? "text-destructive" : "text-muted-foreground")}>
                      {s.active ? "действует" : "снята/истекла"}
                    </span>
                    {s.issued_by && <span className="text-xs text-muted-foreground">@{s.issued_by}</span>}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{s.reason}</p>
                </div>
              ))
            )}
            {appeals.length > 0 && (
              <div className="mt-2 space-y-2">
                <p className="flex items-center gap-1 text-xs text-muted-foreground"><Gavel className="h-3.5 w-3.5" /> Апелляции</p>
                {appeals.map((a) => (
                  <div key={a.id} className="rounded-lg border border-border/50 bg-background/60 px-3 py-2">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                        {a.status === "open" ? "на рассмотрении" : a.status === "accepted" ? "принята" : "отклонена"}
                      </span>
                      {a.created_at && (
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(safeDate(a.created_at), { locale: dateLocale, addSuffix: true })}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm">{a.body}</p>
                    {a.decision_note && <p className="mt-1 text-xs text-muted-foreground">Ответ: {a.decision_note}</p>}
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {target.author_id && (
          <div className="flex justify-end">
            <Link
              to={`/moderation/users/${target.author_id}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-surface px-4 py-2 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
            >
              <UserCog className="h-4 w-4" /> Карточка автора
            </Link>
          </div>
        )}
      </main>
    </div>
  );
};

export default ModerationReport;
