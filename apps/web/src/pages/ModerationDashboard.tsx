import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Flag, Gauge, Gavel, Loader2, Scale, ScrollText, Users } from "lucide-react";
import { toast } from "sonner";

import { apiClient } from "@/integrations/api/client";
import { useModeratorGate } from "@/hooks/useModeratorGate";

interface Stats {
  open_reports: number;
  open_targets: number;
  oldest_open_seconds: number;
  median_response_seconds: number;
  reports_today: number;
  actions_today: number;
  open_appeals: number;
  computed_at: string;
}

/** Human-readable duration: 45 с · 12 мин · 3 ч 20 мин · 2 д. */
const humanDuration = (seconds: number): string => {
  if (!seconds || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)} с`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const restMin = minutes % 60;
  if (hours < 24) return restMin ? `${hours} ч ${restMin} мин` : `${hours} ч`;
  const days = Math.floor(hours / 24);
  return `${days} д.`;
};

function StatCard({ label, value, hint, icon }: { label: string; value: string; hint?: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/70 bg-surface px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="mt-1 text-2xl font-bold leading-none">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

/**
 * Moderation dashboard (route /moderation): queue depth, response time and the
 * day's activity in one request. Readable by helpers (read-only role).
 */
const ModerationDashboard = () => {
  const { isModerator, canReadModeration } = useModeratorGate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!canReadModeration) return;
    let alive = true;
    setLoading(true);
    apiClient
      .rawRequest<Stats>("/api/v1/moderation/stats")
      .then(({ data, error }) => {
        if (error) throw error;
        if (alive) setStats((data as Stats) ?? null);
      })
      .catch(() => {
        if (alive) toast.error("Не удалось загрузить сводку");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [canReadModeration]);

  if (!canReadModeration) return null;

  return (
    <div className="bg-background min-h-screen">
      <main className="mx-auto max-w-3xl space-y-5 p-4 pb-16">
        <header>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Gavel className="h-5 w-5 text-primary" />
            Модерация
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isModerator ? "Полный доступ" : "Только просмотр (роль helper)"}
          </p>
        </header>

        <div className="flex flex-wrap gap-2">
          <Link
            to="/moderation/reports"
            className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-surface px-4 py-2.5 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
          >
            <Flag className="h-4 w-4" />
            Очередь жалоб
          </Link>
          <Link
            to="/moderation/appeals"
            className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-surface px-4 py-2.5 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
          >
            <Scale className="h-4 w-4" />
            Апелляции
          </Link>
          <Link
            to="/moderation/staff"
            className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-surface px-4 py-2.5 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
          >
            <Users className="h-4 w-4" />
            Персонал
          </Link>
          <Link
            to="/moderation/audit"
            className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-surface px-4 py-2.5 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
          >
            <ScrollText className="h-4 w-4" />
            Журнал действий
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Загружаем…
          </div>
        ) : !stats ? (
          <p className="text-muted-foreground">Сводка недоступна</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label="Открытых жалоб"
              value={String(stats.open_reports)}
              hint={`${stats.open_targets} объект(ов) в очереди`}
              icon={<Flag className="h-3.5 w-3.5" />}
            />
            <StatCard
              label="Самая старая жалоба"
              value={humanDuration(stats.oldest_open_seconds)}
              hint={stats.open_reports === 0 ? "очередь пуста" : "ждёт обработки"}
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
            />
            <StatCard
              label="Медиана реакции"
              value={humanDuration(stats.median_response_seconds)}
              hint="за последние 7 дней"
              icon={<Gauge className="h-3.5 w-3.5" />}
            />
            <StatCard label="Жалоб сегодня" value={String(stats.reports_today)} icon={<Flag className="h-3.5 w-3.5" />} />
            <StatCard label="Действий сегодня" value={String(stats.actions_today)} icon={<ScrollText className="h-3.5 w-3.5" />} />
            <StatCard
              label="Апелляций в ожидании"
              value={String(stats.open_appeals)}
              icon={<Scale className="h-3.5 w-3.5" />}
            />
          </div>
        )}
      </main>
    </div>
  );
};

export default ModerationDashboard;
