import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { format } from "date-fns";
import { Ban, ExternalLink, Flag, Loader2, ScrollText } from "lucide-react";
import { toast } from "sonner";

import { apiClient } from "@/integrations/api/client";
import { useModeratorGate } from "@/hooks/useModeratorGate";
import { safeDate } from "@/utils/safeDate";
import { cn } from "@/lib/utils";

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

interface ReportItem {
  id: string;
  category: string;
  reason: string;
  status: string;
  reporter: { username: string };
  source?: string;
}

interface SanctionItem { id: string; kind: string; reason: string; active: boolean }
interface AppealItem { id: string; status: string; body: string; decision_note?: string | null }

interface ActionDetail {
  action: ActionItem;
  target: TargetInfo;
  report: ReportItem | null;
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

/** One audit entry in full (route /moderation/actions/:id). */
const ModerationAction = () => {
  const { canReadModeration } = useModeratorGate();
  const { actionId } = useParams<{ actionId: string }>();
  const [detail, setDetail] = useState<ActionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!canReadModeration || !actionId) return;
    let alive = true;
    setLoading(true);
    apiClient
      .rawRequest<ActionDetail>(`/api/v1/moderation/actions/${actionId}`)
      .then(({ data, error }) => {
        if (error) throw error;
        if (alive) setDetail((data as ActionDetail) ?? null);
      })
      .catch(() => alive && toast.error("Не удалось загрузить действие"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [canReadModeration, actionId]);

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
        <Link to="/moderation/audit" className="text-sm text-muted-foreground hover:text-primary">← Журнал</Link>
        <p className="mt-4 text-muted-foreground">Действие не найдено</p>
      </div>
    );
  }

  const { action, target, report, sanctions, appeals } = detail;

  return (
    <div className="bg-background min-h-screen">
      <main className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
        <Link to="/moderation/audit" className="text-sm text-muted-foreground transition-colors hover:text-primary">
          ← Журнал действий
        </Link>

        <section className="rounded-xl border border-border/70 bg-surface">
          <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2.5">
            <ScrollText className="h-4 w-4 text-primary" />
            <h1 className="font-semibold">{ACTION_LABELS[action.action] ?? action.action}</h1>
          </div>
          <div className="space-y-2 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                {TARGET_LABELS[action.target_type] ?? action.target_type}
              </span>
              <span className="text-muted-foreground">
                модератор: {action.moderator ? `@${action.moderator}` : "—"}
              </span>
              {action.created_at && (
                <span className="text-xs text-muted-foreground">{format(safeDate(action.created_at), "dd.MM.yyyy HH:mm")}</span>
              )}
              {action.link && (
                <a href={action.link} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  <ExternalLink className="h-3 w-3" /> открыть объект
                </a>
              )}
            </div>
            {action.reason_code && <p className="text-xs text-muted-foreground">Код: {action.reason_code}</p>}
            {action.note && <p className="whitespace-pre-wrap break-words">{action.note}</p>}
          </div>
        </section>

        <section className="rounded-xl border border-border/70 bg-surface">
          <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2.5">
            <ExternalLink className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Объект</h2>
          </div>
          <div className="space-y-2 px-4 py-3">
            {target.author_id ? (
              <Link to={`/moderation/users/${target.author_id}`} className="text-sm font-medium hover:text-primary hover:underline">
                {target.author_username || "автор"}
              </Link>
            ) : (
              target.author_username && <p className="text-sm font-medium">{target.author_username}</p>
            )}
            {target.exists ? (
              <div className="rounded-lg border border-border/50 bg-background/60 p-3">
                {target.title?.trim() && <p className="font-semibold break-words">{target.title}</p>}
                <p className="whitespace-pre-wrap break-words text-sm">{target.content?.trim() || "Без текста"}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Объект удалён.</p>
            )}
          </div>
        </section>

        {report && (
          <section className="rounded-xl border border-border/70 bg-surface">
            <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2.5">
              <Flag className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Исходная жалоба</h2>
            </div>
            <div className="space-y-1 px-4 py-3 text-sm">
              <p className="text-xs text-muted-foreground">
                {report.source === "system" ? "система" : report.reporter.username} · {report.status}
              </p>
              <p className="whitespace-pre-wrap break-words">{report.reason}</p>
              <Link to={`/moderation/reports/${report.id}`} className="inline-block text-xs text-primary hover:underline">
                Открыть жалобу →
              </Link>
            </div>
          </section>
        )}

        {(sanctions.length > 0 || appeals.length > 0) && (
          <section className="rounded-xl border border-border/70 bg-surface">
            <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2.5">
              <Ban className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Санкции и апелляции автора</h2>
            </div>
            <div className="space-y-2 px-4 py-3">
              {sanctions.map((s) => (
                <div key={s.id} className="rounded-lg border border-border/50 bg-background/60 px-3 py-2 text-sm">
                  <span className="font-medium">{SANCTION_LABELS[s.kind] ?? s.kind}</span>
                  <span className={cn("ml-2 text-[11px]", s.active ? "text-destructive" : "text-muted-foreground")}>
                    {s.active ? "действует" : "снята/истекла"}
                  </span>
                  <p className="mt-1 text-muted-foreground">{s.reason}</p>
                </div>
              ))}
              {appeals.map((a) => (
                <div key={a.id} className="rounded-lg border border-border/50 bg-background/60 px-3 py-2 text-sm">
                  <span className="text-[11px] text-muted-foreground">
                    апелляция: {a.status === "open" ? "на рассмотрении" : a.status === "accepted" ? "принята" : "отклонена"}
                  </span>
                  <p className="mt-1 whitespace-pre-wrap break-words">{a.body}</p>
                  {a.decision_note && <p className="mt-1 text-xs text-muted-foreground">Ответ: {a.decision_note}</p>}
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

export default ModerationAction;
