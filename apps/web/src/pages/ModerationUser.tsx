import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { useDateLocale } from "@/i18n/dateLocale";
import {
  AlertTriangle, Ban, Check, ExternalLink, Flag, Gavel, Loader2, StickyNote, Trash2, Undo2,
} from "lucide-react";
import { toast } from "sonner";

import { apiClient } from "@/integrations/api/client";
import { useModeratorGate } from "@/hooks/useModeratorGate";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { REPORT_CATEGORIES } from "@/components/moderation/ReportDialog";
import { safeDate } from "@/utils/safeDate";
import { cn } from "@/lib/utils";

// ── API shape (GET /api/v1/moderation/users/:id) ─────────────────────────────

interface CardUser {
  id: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
  created_at?: string;
  is_online: boolean;
  garma: number;
  posts: number;
  threads: number;
  wall_posts: number;
  comments: number;
  likes_received: number;
  roles: string[];
  is_staff: boolean;
}

interface SanctionItem {
  id: string;
  kind: "warn" | "mute" | "ban";
  reason: string;
  reason_code?: string | null;
  issued_by?: string;
  created_at?: string;
  expires_at?: string | null;
  revoked_at?: string | null;
  revoked_by?: string;
  active: boolean;
}

interface NoteItem {
  id: string;
  body: string;
  author?: string;
  created_at?: string;
}

interface CardReport {
  id: string;
  target_type: string;
  target_id: string;
  target_link?: string;
  reporter: { username: string };
  category: string;
  reason: string;
  status: "open" | "resolved" | "rejected";
  created_at?: string;
}

interface ReportSummary {
  open: number;
  total: number;
  recent: CardReport[];
}

interface UserCard {
  user: CardUser;
  sanctions: SanctionItem[];
  notes: NoteItem[];
  reports_against: ReportSummary;
  reports_by: ReportSummary;
}

interface ActivityItem {
  id: number;
  event_type: string;
  target_type?: string;
  target_id?: string;
  link?: string;
  created_at?: string;
}

const SANCTION_LABELS: Record<string, string> = {
  warn: "Предупреждение",
  mute: "Запрет писать",
  ban: "Блокировка",
};

const SANCTION_STYLES: Record<string, string> = {
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  mute: "border-orange-500/30 bg-orange-500/10 text-orange-600",
  ban: "border-destructive/40 bg-destructive/10 text-destructive",
};

const DURATIONS: { value: string; label: string }[] = [
  { value: "0", label: "Навсегда" },
  { value: "60", label: "1 час" },
  { value: "1440", label: "1 день" },
  { value: "10080", label: "7 дней" },
  { value: "43200", label: "30 дней" },
];

const EVENT_LABELS: Record<string, string> = {
  entry_created: "Создал запись",
  comment_created: "Написал комментарий",
  like_given: "Поставил лайк",
  like_received: "Получил лайк",
  repost_created: "Сделал репост",
  sub_joined: "Вступил в саб",
  rules_accepted: "Принял правила саба",
  sub_created: "Создал саб",
  gift_sent: "Отправил подарок",
  gift_received: "Получил подарок",
  avatar_updated: "Обновил аватар",
  bio_updated: "Обновил описание",
  profile_styled: "Оформил профиль",
  integration_connected: "Подключил интеграцию",
  daily_visit: "Был на сайте",
};

const categoryLabel = (value: string): string =>
  REPORT_CATEGORIES.find((c) => c.value === value)?.label ?? value;

const plural = (n: number, one: string, few: string, many: string): string =>
  n === 1 ? one : n < 5 ? few : many;

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/60 bg-surface px-3 py-2">
      <div className="text-lg font-bold leading-none">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function ReportRow({ report, dateLocale }: { report: CardReport; dateLocale: ReturnType<typeof useDateLocale> }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/60 p-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-medium">{report.reporter.username}</span>
        <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
          {categoryLabel(report.category)}
        </span>
        <span className="text-xs text-muted-foreground">
          {report.created_at ? formatDistanceToNow(safeDate(report.created_at), { locale: dateLocale, addSuffix: true }) : ""}
        </span>
        {report.status === "resolved" && <span className="text-[11px] text-green-600">оставлена</span>}
        {report.status === "rejected" && <span className="text-[11px] text-muted-foreground">отклонена</span>}
        {report.target_link && (
          <a
            href={report.target_link}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
          >
            <ExternalLink className="h-3 w-3" />
            {report.target_type}
          </a>
        )}
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{report.reason}</p>
    </div>
  );
}

/**
 * Moderation user card — everything a moderator needs about one account in one
 * screen: the summary, sanction history + apply/revoke, internal notes, reports
 * filed against the user and by the user, and their action log from the
 * append-only activity ledger.
 */
const ModerationUser = () => {
  const { isModerator, canReadModeration } = useModeratorGate();
  const { userId } = useParams<{ userId: string }>();
  const dateLocale = useDateLocale();

  const [card, setCard] = useState<UserCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [sanctionKind, setSanctionKind] = useState("warn");
  const [sanctionReason, setSanctionReason] = useState("");
  const [sanctionDuration, setSanctionDuration] = useState("0");
  const [revokeTarget, setRevokeTarget] = useState<SanctionItem | null>(null);

  const [noteBody, setNoteBody] = useState("");
  const [noteDeleteTarget, setNoteDeleteTarget] = useState<NoteItem | null>(null);

  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityCursor, setActivityCursor] = useState("");
  const [activityFilter, setActivityFilter] = useState("all");
  const [activityLoading, setActivityLoading] = useState(false);

  const loadCard = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const { data, error } = await apiClient.rawRequest<UserCard>(`/api/v1/moderation/users/${userId}`);
      if (error) throw error;
      setCard((data as UserCard) ?? null);
    } catch (err) {
      console.error("Error loading user card:", err);
      toast.error("Не удалось загрузить карточку");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const loadActivity = useCallback(
    async (cursor: string, filter: string, append: boolean) => {
      if (!userId) return;
      setActivityLoading(true);
      try {
        const params = new URLSearchParams({ limit: "30" });
        if (filter !== "all") params.set("event_type", filter);
        if (cursor) params.set("before_id", cursor);
        const { data } = await apiClient.rawRequest<{ items: ActivityItem[]; next_cursor: string }>(
          `/api/v1/moderation/users/${userId}/activity?${params}`,
        );
        const payload = (data ?? { items: [], next_cursor: "" }) as { items: ActivityItem[]; next_cursor: string };
        const items = payload.items ?? [];
        setActivity((prev) => (append ? [...prev, ...items] : items));
        setActivityCursor(payload.next_cursor ?? "");
      } catch (err) {
        console.error("Error loading activity:", err);
      } finally {
        setActivityLoading(false);
      }
    },
    [userId],
  );

  useEffect(() => {
    if (!canReadModeration) return;
    loadCard();
  }, [canReadModeration, loadCard]);

  useEffect(() => {
    if (!canReadModeration) return;
    loadActivity("", activityFilter, false);
  }, [canReadModeration, activityFilter, loadActivity]);

  const applySanction = async () => {
    if (!userId) return;
    const reason = sanctionReason.trim();
    if (reason.length < 3) {
      toast.error("Опишите причину санкции");
      return;
    }
    setBusy("sanction");
    try {
      await apiClient.rawRequest(`/api/v1/moderation/users/${userId}/sanctions`, {
        method: "POST",
        body: JSON.stringify({
          kind: sanctionKind,
          reason,
          duration_minutes: Number(sanctionDuration) || 0,
        }),
      });
      toast.success("Санкция применена");
      setSanctionReason("");
      await loadCard();
    } catch (err) {
      toast.error((err as Error)?.message || "Не удалось применить санкцию");
    } finally {
      setBusy(null);
    }
  };

  const confirmRevoke = async () => {
    if (!userId || !revokeTarget) return;
    setBusy(revokeTarget.id);
    try {
      await apiClient.rawRequest(`/api/v1/moderation/users/${userId}/sanctions/${revokeTarget.id}`, {
        method: "DELETE",
      });
      toast.success("Санкция снята");
      setRevokeTarget(null);
      await loadCard();
    } catch (err) {
      toast.error((err as Error)?.message || "Не удалось снять санкцию");
    } finally {
      setBusy(null);
    }
  };

  const addNote = async () => {
    if (!userId) return;
    const body = noteBody.trim();
    if (!body) return;
    setBusy("note");
    try {
      await apiClient.rawRequest(`/api/v1/moderation/users/${userId}/notes`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      setNoteBody("");
      await loadCard();
    } catch (err) {
      toast.error((err as Error)?.message || "Не удалось сохранить заметку");
    } finally {
      setBusy(null);
    }
  };

  const confirmDeleteNote = async () => {
    if (!userId || !noteDeleteTarget) return;
    setBusy(noteDeleteTarget.id);
    try {
      await apiClient.rawRequest(`/api/v1/moderation/users/${userId}/notes/${noteDeleteTarget.id}`, {
        method: "DELETE",
      });
      setNoteDeleteTarget(null);
      await loadCard();
    } catch (err) {
      toast.error((err as Error)?.message || "Не удалось удалить заметку");
    } finally {
      setBusy(null);
    }
  };

  if (!canReadModeration) return null;

  if (loading && !card) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Загружаем…
        </div>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <Link to="/moderation" className="text-sm text-muted-foreground hover:text-primary">← Модерация</Link>
        <p className="mt-4 text-muted-foreground">Пользователь не найден</p>
      </div>
    );
  }

  const u = card.user;
  const activeSanctions = card.sanctions.filter((s) => s.active);

  return (
    <div className="bg-background min-h-screen">
      <main className="mx-auto max-w-3xl space-y-5 p-4 pb-16">
        <Link to="/moderation" className="text-sm text-muted-foreground hover:text-primary transition-colors">
          ← Модерация
        </Link>

        {/* Header */}
        <header className="flex flex-wrap items-center gap-3">
          {u.avatar_url ? (
            <img src={u.avatar_url} alt="" className="h-12 w-12 rounded-full object-cover" />
          ) : (
            <div className="h-12 w-12 rounded-full bg-muted" />
          )}
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold">
              {u.display_name || u.username}
              <span className="text-sm font-normal text-muted-foreground">@{u.username}</span>
              {u.roles.map((r) => (
                <span key={r} className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                  {r}
                </span>
              ))}
              {activeSanctions.some((s) => s.kind === "ban") && (
                <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", SANCTION_STYLES.ban)}>забанен</span>
              )}
            </h1>
            <p className="text-xs text-muted-foreground">
              {u.created_at ? `Регистрация ${format(safeDate(u.created_at), "dd.MM.yyyy")}` : ""}
              {u.is_online ? " · в сети" : ""}
            </p>
          </div>
          <a
            href={`/profile/${u.id}`}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
          >
            <ExternalLink className="h-4 w-4" /> Профиль
          </a>
        </header>

        {/* Counters */}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          <Counter label="Гарма" value={u.garma} />
          <Counter label="Записи" value={u.threads + u.wall_posts} />
          <Counter label="Комменты" value={u.comments} />
          <Counter label="Лайки" value={u.likes_received} />
          <Counter label="Жалоб на него" value={card.reports_against.total} />
          <Counter label="Жалоб от него" value={card.reports_by.total} />
        </div>

        {/* Sanctions */}
        <section className="rounded-xl border border-border/70 bg-surface">
          <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2.5">
            <Ban className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Санкции</h2>
            {activeSanctions.length > 0 && (
              <span className="ml-auto text-xs text-muted-foreground">
                активных: {activeSanctions.length}
              </span>
            )}
          </div>
          <div className="space-y-3 px-4 py-3">
            {!isModerator ? (
              <p className="text-sm text-muted-foreground">Только просмотр. Действия доступны модераторам.</p>
            ) : u.is_staff ? (
              <p className="text-sm text-muted-foreground">Это модератор — санкции к персоналу не применяются.</p>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Select value={sanctionKind} onValueChange={setSanctionKind}>
                    <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="warn">Предупреждение</SelectItem>
                      <SelectItem value="mute">Запрет писать</SelectItem>
                      <SelectItem value="ban">Блокировка</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={sanctionDuration} onValueChange={setSanctionDuration}>
                    <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DURATIONS.map((d) => (
                        <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <textarea
                  value={sanctionReason}
                  onChange={(e) => setSanctionReason(e.target.value.slice(0, 2000))}
                  placeholder="Причина (её увидит пользователь)"
                  rows={2}
                  className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  variant={sanctionKind === "ban" ? "destructive" : "default"}
                  className="gap-1.5"
                  onClick={applySanction}
                  disabled={busy === "sanction"}
                >
                  {busy === "sanction" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gavel className="h-4 w-4" />}
                  Применить
                </Button>
              </div>
            )}

            {card.sanctions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Санкций не было.</p>
            ) : (
              <div className="space-y-2">
                {card.sanctions.map((s) => (
                  <div key={s.id} className="rounded-lg border border-border/50 bg-background/60 p-2.5">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", SANCTION_STYLES[s.kind])}>
                        {SANCTION_LABELS[s.kind] ?? s.kind}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {s.issued_by ? `@${s.issued_by}` : "система"}
                        {s.created_at ? ` · ${formatDistanceToNow(safeDate(s.created_at), { locale: dateLocale, addSuffix: true })}` : ""}
                      </span>
                      {s.expires_at && <span className="text-[11px] text-muted-foreground">до {format(safeDate(s.expires_at), "dd.MM.yyyy HH:mm")}</span>}
                      {s.revoked_at ? (
                        <span className="text-[11px] text-green-600">
                          снята{s.revoked_by ? ` @${s.revoked_by}` : ""}
                        </span>
                      ) : isModerator ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto gap-1 text-xs"
                          onClick={() => setRevokeTarget(s)}
                          disabled={busy === s.id}
                        >
                          <Undo2 className="h-3.5 w-3.5" /> Снять
                        </Button>
                      ) : null}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{s.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Notes */}
        <section className="rounded-xl border border-border/70 bg-surface">
          <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2.5">
            <StickyNote className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Заметки</h2>
            <span className="ml-auto text-xs text-muted-foreground">видят только модераторы</span>
          </div>
          <div className="space-y-3 px-4 py-3">
            {isModerator && (
            <div className="space-y-2">
              <textarea
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value.slice(0, 4000))}
                placeholder="Внутренняя заметка о пользователе…"
                rows={2}
                className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
              />
              <Button size="sm" className="gap-1.5" onClick={addNote} disabled={busy === "note" || !noteBody.trim()}>
                {busy === "note" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Добавить
              </Button>
            </div>
            )}
            {card.notes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Заметок нет.</p>
            ) : (
              <div className="space-y-2">
                {card.notes.map((n) => (
                  <div key={n.id} className="rounded-lg border border-border/50 bg-background/60 p-2.5">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{n.author ? `@${n.author}` : "—"}</span>
                      {n.created_at && <span>· {formatDistanceToNow(safeDate(n.created_at), { locale: dateLocale, addSuffix: true })}</span>}
                      {isModerator && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-6 gap-1 px-2 text-xs"
                          onClick={() => setNoteDeleteTarget(n)}
                          disabled={busy === n.id}
                        >
                          <Trash2 className="h-3 w-3" /> Удалить
                        </Button>
                      )}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm">{n.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Reports */}
        <section className="rounded-xl border border-border/70 bg-surface">
          <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2.5">
            <Flag className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Жалобы</h2>
          </div>
          <div className="space-y-4 px-4 py-3">
            <div>
              <p className="mb-2 text-sm font-medium">
                На него — {card.reports_against.total} {plural(card.reports_against.total, "жалоба", "жалобы", "жалоб")}
                {card.reports_against.open > 0 ? `, открытых ${card.reports_against.open}` : ""}
              </p>
              {card.reports_against.recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">Жалоб нет.</p>
              ) : (
                <div className="space-y-2">
                  {card.reports_against.recent.map((r) => (
                    <ReportRow key={r.id} report={r} dateLocale={dateLocale} />
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">
                От него — {card.reports_by.total} {plural(card.reports_by.total, "жалоба", "жалобы", "жалоб")}
              </p>
              {card.reports_by.recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">Не жаловался.</p>
              ) : (
                <div className="space-y-2">
                  {card.reports_by.recent.map((r) => (
                    <ReportRow key={r.id} report={r} dateLocale={dateLocale} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Activity log */}
        <section className="rounded-xl border border-border/70 bg-surface">
          <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-4 py-2.5">
            <AlertTriangle className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Действия</h2>
            <div className="ml-auto">
              <Select value={activityFilter} onValueChange={setActivityFilter}>
                <SelectTrigger className="h-8 w-[190px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все действия</SelectItem>
                  {Object.entries(EVENT_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="px-4 py-3">
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {activityLoading ? "Загружаем…" : "Действий пока нет."}
              </p>
            ) : (
              <>
                <ol className="space-y-1.5">
                  {activity.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="text-muted-foreground">
                        {a.created_at ? format(safeDate(a.created_at), "dd.MM.yyyy HH:mm") : "—"}
                      </span>
                      <span>{EVENT_LABELS[a.event_type] ?? a.event_type}</span>
                      {a.link && (
                        <a
                          href={a.link}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" /> {a.target_type}
                        </a>
                      )}
                    </li>
                  ))}
                </ol>
                {activityCursor && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => loadActivity(activityCursor, activityFilter, true)}
                    disabled={activityLoading}
                  >
                    {activityLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Показать ещё"}
                  </Button>
                )}
              </>
            )}
          </div>
        </section>
      </main>

      {/* Revoke confirmation */}
      <Dialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Снять санкцию?</DialogTitle>
            <DialogDescription>
              {revokeTarget && `${SANCTION_LABELS[revokeTarget.kind] ?? revokeTarget.kind} перестанет действовать.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>Отмена</Button>
            <Button onClick={confirmRevoke} disabled={busy !== null} className="gap-1.5">
              {busy === revokeTarget?.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
              Снять
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Note deletion */}
      <Dialog open={!!noteDeleteTarget} onOpenChange={(open) => !open && setNoteDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Удалить заметку?</DialogTitle>
            <DialogDescription>Заметка будет удалена безвозвратно.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setNoteDeleteTarget(null)}>Отмена</Button>
            <Button variant="destructive" onClick={confirmDeleteNote} disabled={busy !== null} className="gap-1.5">
              {busy === noteDeleteTarget?.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ModerationUser;
