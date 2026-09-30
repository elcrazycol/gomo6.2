import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowLeft, TrendingUp, Clock3, ThumbsUp, MessageSquare, Eye } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import { format } from "date-fns";

// ── API shape (GET /api/v1/users/:id/stats) ──────────────────────────────────

interface StatsDay {
  date: string;
  events: number;
}

interface StatsTotals {
  posts: number;
  threads: number;
  wall_posts: number;
  comments: number;
  likes_received: number;
  likes_given: number;
  views_received: number;
  garma: number;
  session_minutes: number;
}

interface BreakdownEntry {
  key: string;
  weight: number;
  raw: number;
  value: number;
}

interface StatsPayload {
  user_id: string;
  username: string;
  can_view: boolean;
  stats_hidden: boolean;
  detailed: boolean;
  totals: StatsTotals | null;
  garma_breakdown: BreakdownEntry[] | null;
  activity_daily: StatsDay[] | null;
  activity_days: number;
  activity_series: Record<string, StatsDay[]> | null;
  computed_at: string;
}

type RangeKey = "7" | "30" | "90" | "365";
type Mode = "cumulative" | "period";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "7", label: "7д" },
  { key: "30", label: "30д" },
  { key: "90", label: "90д" },
  { key: "365", label: "1г" },
];

// Garma weights — MUST match the server formula (profiles.snapshotStatsSQL and
// the breakdown endpoint). The chart is the weighted sum of the server-provided
// daily series, so it is exact where timestamps exist; session time and
// achievement rewards have no per-day timestamps and are therefore not plotted.
const GARMA_WEIGHTS: Record<string, number> = {
  posts: 0.5,
  threads: 4,
  wall_posts: 0.5,
  wall_comments: 0.5,
  post_likes_received: 2,
  thread_likes_received: 3,
  wall_post_likes_received: 2,
  wall_comment_likes_received: 1,
  replies: 0.25,
};

interface MetricDef {
  key: string;
  label: string;
  kinds: string[];
  weights?: Record<string, number>;
}

const METRICS: MetricDef[] = [
  { key: "garma", label: "Гарма за активность", kinds: Object.keys(GARMA_WEIGHTS), weights: GARMA_WEIGHTS },
  { key: "posts", label: "Записи (сабы + стена)", kinds: ["threads", "wall_posts"] },
  { key: "comments", label: "Комментарии", kinds: ["posts", "wall_comments"] },
  {
    key: "likes",
    label: "Лайки полученные",
    kinds: ["post_likes_received", "thread_likes_received", "wall_post_likes_received", "wall_comment_likes_received"],
  },
  { key: "threads", label: "Записи в сабах", kinds: ["threads"] },
  { key: "postLikes", label: "Лайки постов", kinds: ["post_likes_received"] },
  { key: "threadLikes", label: "Лайки записей", kinds: ["thread_likes_received"] },
  { key: "replies", label: "Ответы в моих записях", kinds: ["replies"] },
];

const BREAKDOWN_META: Record<string, { label: string; color: string }> = {
  post_likes: { label: "Лайки постов", color: "#22c55e" },
  thread_likes: { label: "Лайки записей", color: "#3b82f6" },
  threads: { label: "Записи в сабах", color: "#a855f7" },
  wall_post_likes: { label: "Лайки записей стены", color: "#14b8a6" },
  wall_comment_likes: { label: "Лайки комментов стены", color: "#06b6d4" },
  wall_posts: { label: "Записи на стене", color: "#f59e0b" },
  comments: { label: "Комментарии", color: "#f97316" },
  replies: { label: "Ответы в моих записях", color: "#ef4444" },
  session_time: { label: "Время на сайте", color: "#0ea5e9" },
  achievements: { label: "Достижения", color: "#eab308" },
};

interface Point {
  ts: number;
  label: string;
  value: number;
}

// buildSeries sums the requested server series into one, applying the metric's
// weights. No scaling to a target — the shape and the values are the real data.
function buildSeries(metric: MetricDef, series: Record<string, StatsDay[]> | null, mode: Mode): Point[] {
  const byDate = new Map<string, number>();
  const src = series || {};
  metric.kinds.forEach((kind) => {
    const weight = metric.weights?.[kind] ?? 1;
    (src[kind] || []).forEach((p) => {
      byDate.set(p.date, (byDate.get(p.date) || 0) + p.events * weight);
    });
  });

  let points: Point[] = Array.from(byDate.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, value]) => ({ ts: new Date(`${date}T00:00:00Z`).getTime(), label: date, value }));

  if (mode === "cumulative") {
    let acc = 0;
    points = points.map((p) => ({ ...p, value: (acc += p.value) }));
  }
  return points;
}

export default function Stats() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [targetId, setTargetId] = useState<string | null>(null);
  const [data, setData] = useState<StatsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("30");
  const [metric, setMetric] = useState("garma");
  const [mode, setMode] = useState<Mode>("cumulative");

  // Resolve who to view (query param, else the signed-in user).
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: sessionData } = await api.auth.getSession();
      const self = sessionData.session?.user.id;
      if (!alive) return;
      if (!self) {
        navigate("/auth");
        return;
      }
      setTargetId(searchParams.get("user") || self);
    })();
    return () => {
      alive = false;
    };
  }, [navigate, searchParams]);

  // Initial metric from the query string (profile links pass ?metric=…).
  useEffect(() => {
    const m = searchParams.get("metric");
    if (m && METRICS.some((def) => def.key === m)) setMetric(m);
  }, [searchParams]);

  // ONE request for the whole page.
  useEffect(() => {
    if (!targetId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/v1/users/${encodeURIComponent(targetId)}/stats?days=${range}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (alive) setData((json?.data as StatsPayload) ?? null);
      })
      .catch(() => {
        if (alive) setError("Не удалось загрузить статистику");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [targetId, range]);

  const series = useMemo(() => {
    const def = METRICS.find((m) => m.key === metric) ?? METRICS[0];
    return buildSeries(def, data?.activity_series ?? null, mode);
  }, [data, metric, mode]);

  const breakdown = useMemo(() => {
    const rows = data?.garma_breakdown || [];
    return rows
      .map((e) => ({
        key: e.key,
        label: BREAKDOWN_META[e.key]?.label ?? e.key,
        color: BREAKDOWN_META[e.key]?.color ?? "oklch(var(--primary))",
        value: e.value,
      }))
      .filter((e) => e.value > 0);
  }, [data]);

  const breakdownSum = useMemo(() => breakdown.reduce((s, e) => s + e.value, 0), [breakdown]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Загружаем статистику…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-5xl mx-auto p-4">
        <p className="text-muted-foreground">{error ?? "Не удалось загрузить статистику"}</p>
      </div>
    );
  }

  if (!data.can_view || data.stats_hidden) {
    return (
      <div className="max-w-5xl mx-auto p-4 space-y-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1">
          <ArrowLeft className="h-4 w-4" /> Назад
        </Button>
        <div className="text-muted-foreground">Статистика этого пользователя скрыта</div>
      </div>
    );
  }

  const totals = data.totals;
  const xTick = (v: number) => (range === "365" ? format(new Date(v), "LLL yy") : format(new Date(v), "dd.MM"));

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1">
          <ArrowLeft className="h-4 w-4" /> Назад
        </Button>
        <h1 className="text-2xl font-bold">Статистика {data.username}</h1>
      </div>

      {totals && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Гарма</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-2 text-2xl font-bold">
              <TrendingUp className="h-5 w-5 text-primary" />
              {totals.garma}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Записи</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-2 text-2xl font-bold">
              <MessageSquare className="h-5 w-5 text-primary" />
              {totals.threads + totals.wall_posts}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Комментарии</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">{totals.comments}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Лайков получено</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-2 text-2xl font-bold">
              <ThumbsUp className="h-5 w-5 text-primary" />
              {totals.likes_received}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Просмотры</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-2 text-2xl font-bold">
              <Eye className="h-5 w-5 text-primary" />
              {totals.views_received}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Время на сайте</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-2 text-2xl font-bold">
              <Clock3 className="h-5 w-5 text-primary" />
              {Math.max(0, Math.floor(totals.session_minutes / 60))} ч
            </CardContent>
          </Card>
        </div>
      )}

      {!data.detailed ? (
        <Card>
          <CardHeader>
            <CardTitle>Подробная статистика</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Владелец скрыл детальную статистику — показаны только итоги.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Динамика</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Честные данные по датам событий. Гарма за активность не включает время на сайте и награды за достижения.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <Select value={metric} onValueChange={setMetric}>
                  <SelectTrigger className="w-[200px] sm:w-[220px]">
                    <SelectValue placeholder="Метрика" />
                  </SelectTrigger>
                  <SelectContent>
                    {METRICS.map((m) => (
                      <SelectItem key={m.key} value={m.key}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-1 flex-wrap">
                  {RANGES.map((opt) => (
                    <Button
                      key={opt.key}
                      variant={range === opt.key ? "default" : "outline"}
                      size="sm"
                      className="px-2"
                      onClick={() => setRange(opt.key)}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
                <div className="flex gap-1 flex-wrap">
                  <Button size="sm" variant={mode === "cumulative" ? "default" : "outline"} onClick={() => setMode("cumulative")}>
                    Накопительно
                  </Button>
                  <Button size="sm" variant={mode === "period" ? "default" : "outline"} onClick={() => setMode("period")}>
                    За интервал
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {series.length === 0 ? (
                <p className="text-sm text-muted-foreground">Недостаточно данных</p>
              ) : (
                <div className="h-72 sm:h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={series} margin={{ left: 0, right: 0, top: 10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorA" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="oklch(var(--primary))" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="oklch(var(--primary))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                      <XAxis
                        dataKey="ts"
                        tickFormatter={(v) => xTick(v as number)}
                        tickMargin={8}
                        type="number"
                        domain={["dataMin", "dataMax"]}
                      />
                      <YAxis tickMargin={8} width={60} allowDecimals={false} />
                      <RechartsTooltip
                        formatter={(v: number) => (Number.isInteger(v) ? v : v.toFixed(2))}
                        labelFormatter={(d) => format(new Date(d as number), "dd.MM.yyyy")}
                      />
                      <Area type="monotone" dataKey="value" stroke="oklch(var(--primary))" fill="url(#colorA)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Вклад в гарму</CardTitle>
              <p className="text-sm text-muted-foreground">
                Точные слагаемые формулы: {breakdownSum.toFixed(1)}
                {totals ? ` → гарма ${Math.floor(breakdownSum)}` : ""}.
                {totals && Math.floor(breakdownSum) !== totals.garma
                  ? " Итог подтянется фоновым снапшотом (≈2 мин)."
                  : ""}
              </p>
            </CardHeader>
            <CardContent>
              {breakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground">Нет данных</p>
              ) : (
                <div className="h-64 sm:h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={breakdown} layout="vertical" margin={{ left: 80 }}>
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                      <XAxis type="number" />
                      <YAxis type="category" dataKey="label" width={160} />
                      <RechartsTooltip formatter={(v: number) => v.toFixed(2)} />
                      <Bar dataKey="value">
                        {breakdown.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Итоги обновляются фоновым снапшотом (≈2 мин). Данные сформированы {format(new Date(data.computed_at), "dd.MM.yyyy HH:mm")}.
      </p>
    </div>
  );
}
