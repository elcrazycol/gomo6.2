import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowLeft, TrendingUp, Clock3, ThumbsUp, MessageSquare } from "lucide-react";
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

interface ProfileSummary {
  username: string;
  garma: number;
  post_count: number;
  thread_count: number;
}
interface Privacy {
  show_profile_stats: boolean;
  show_detailed_stats: boolean;
  stats_visibility: Record<string, boolean>;
}

interface TimeStats {
  total_minutes: number;
  last_updated?: string | null;
}

type Range = "1d" | "30d" | "90d" | "180d" | "365d" | "all";
type Mode = "cumulative" | "period";

interface StatPoint {
  label: string;
  value: number;
  ts: number;
}

const groupByInterval = (timestamps: string[], interval: "hour" | "day" | "month", weight = 1): StatPoint[] => {
  const map = new Map<string, { value: number; ts: number; label: string }>();
  timestamps.forEach((ts) => {
    const d = new Date(ts);
    const label =
      interval === "hour"
        ? `${d.getHours().toString().padStart(2, "0")}:00`
        : interval === "month"
          ? `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}`
          : ts.slice(0, 10); // day
    const key = `${interval}-${label}`;
    if (!map.has(key)) {
      map.set(key, { value: weight, ts: d.getTime(), label });
    } else {
      const prev = map.get(key)!;
      map.set(key, { value: prev.value + weight, ts: prev.ts, label: prev.label });
    }
  });

  return Array.from(map.values())
    .map((entry) => ({
      label: entry.label,
      value: entry.value,
      ts: entry.ts,
    }))
    .sort((a, b) => a.ts - b.ts);
};

const accumulate = (points: StatPoint[]): StatPoint[] => {
  let acc = 0;
  return points.map((p) => {
    acc += p.value;
    return { ...p, value: acc };
  });
};

const scaleSeries = (series: StatPoint[], target: number) => {
  if (!series.length || target <= 0) return series;
  const last = series[series.length - 1].value;
  if (last === 0) return series;
  const k = target / last;
  return series.map((p) => ({ ...p, value: p.value * k }));
};

const filterByRange = (series: StatPoint[], range: Range) => {
  if (range === "all") return series;
  const daysMap: Record<Range, number> = {
    "1d": 1,
    "30d": 30,
    "90d": 90,
    "180d": 180,
    "365d": 365,
    all: 0,
  };
  const days = daysMap[range];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return series.filter((p) => p.ts >= cutoff);
};

export default function Stats() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlInitDone = useRef(false);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [privacy, setPrivacy] = useState<Privacy | null>(null);
  const [viewedUserId, setViewedUserId] = useState<string | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [timeStats, setTimeStats] = useState<TimeStats | null>(null);
  const [postsTs, setPostsTs] = useState<string[]>([]);
  const [threadsTs, setThreadsTs] = useState<string[]>([]);
  const [postLikesTs, setPostLikesTs] = useState<string[]>([]);
  const [threadLikesTs, setThreadLikesTs] = useState<string[]>([]);
  const [repliesTs, setRepliesTs] = useState<string[]>([]);
  const [metric, setMetric] = useState("garma");
  const [range, setRange] = useState<Range>("all");
  const [mode, setMode] = useState<Mode>("cumulative");

  useEffect(() => {
    const load = async () => {
      const { data: sessionData } = await api.auth.getSession();
      const self = sessionData.session?.user.id;
      const token = sessionData.session?.access_token;
      if (!self) {
        navigate("/auth");
        return;
      }
      setSelfId(self);
      const targetUserId = searchParams.get("user") || self;
      setViewedUserId(targetUserId);

      setLoading(true);

      const rpcHeaders: Record<string, string> = token ? { 'Authorization': `Bearer ${token}` } : {};

      const [profileRes, postsRes, threadsRes, postLikesRes, threadLikesRes, repliesRes, timeRes, privacyRes] = await Promise.all([
        fetch(`/api/v1/profiles?id=eq.${targetUserId}`).then(r => r.json()),
        fetch(`/api/v1/posts?user_id=eq.${targetUserId}&order=created_at.asc`).then(r => r.json()),
        fetch(`/api/v1/threads?user_id=eq.${targetUserId}&order=created_at.asc`).then(r => r.json()),
        fetch(`/api/rpc/get_user_post_likes_received_timestamps?user_uuid=${targetUserId}`, { headers: rpcHeaders }).then(r => r.json()),
        fetch(`/api/rpc/get_user_thread_likes_received_timestamps?user_uuid=${targetUserId}`, { headers: rpcHeaders }).then(r => r.json()),
        fetch(`/api/rpc/get_user_thread_reply_timestamps?user_uuid=${targetUserId}`, { headers: rpcHeaders }).then(r => r.json()),
        fetch(`/api/v1/user_session_time?user_id=eq.${targetUserId}`).then(r => r.json()),
        fetch(`/api/v1/privacy_settings?user_id=eq.${targetUserId}`).then(r => r.json()),
      ]);

      // Go backend wraps in {data: [...], success: true} — always array
      const profileData = profileRes.data?.[0] as ProfileSummary | undefined;
      if (profileData) setProfile(profileData);

      const privacyData = privacyRes.data?.[0] as { show_profile_stats?: boolean; show_detailed_stats?: boolean; stats_visibility?: Record<string, boolean> } | undefined;
      if (privacyData) {
        setPrivacy({
          show_profile_stats: privacyData.show_profile_stats ?? false,
          show_detailed_stats: privacyData.show_detailed_stats ?? false,
          stats_visibility: privacyData.stats_visibility || {},
        });
      } else {
        setPrivacy({ show_profile_stats: false, show_detailed_stats: false, stats_visibility: {} });
      }

      const timeData = timeRes.data?.[0] as TimeStats | undefined;
      if (timeData) setTimeStats(timeData);

      setPostsTs((postsRes.data as Array<{ created_at: string }>)?.map((p) => p.created_at) || []);
      setThreadsTs((threadsRes.data as Array<{ created_at: string }>)?.map((t) => t.created_at) || []);
      setPostLikesTs((postLikesRes.data as Array<{ created_at: string }>)?.map((l) => l.created_at) || []);
      setThreadLikesTs((threadLikesRes.data as Array<{ created_at: string }>)?.map((l) => l.created_at) || []);
      setRepliesTs((repliesRes.data as Array<{ created_at: string }>)?.map((r) => r.created_at) || []);

      setLoading(false);
    };

    load();
  }, [navigate, searchParams]);

  const applyWeight = (points: StatPoint[], weight: number) =>
    points.map((p) => ({ ...p, value: p.value * weight }));

  const postsDaily = useMemo(() => groupByInterval(postsTs, "day"), [postsTs]);
  const threadsDaily = useMemo(() => groupByInterval(threadsTs, "day"), [threadsTs]);
  const postLikesDaily = useMemo(() => groupByInterval(postLikesTs, "day"), [postLikesTs]);
  const threadLikesDaily = useMemo(() => groupByInterval(threadLikesTs, "day"), [threadLikesTs]);
  const repliesDaily = useMemo(() => groupByInterval(repliesTs, "day"), [repliesTs]);

  const pickInterval = (r: Range): "hour" | "day" | "month" => {
    if (r === "1d") return "hour";
    if (r === "30d" || r === "90d" || r === "180d") return "day";
    return "month";
  };

  const filterTimestamps = (ts: string[], r: Range) => {
    if (r === "all") return ts;
    const daysMap: Record<Range, number> = { "1d": 1, "30d": 30, "90d": 90, "180d": 180, "365d": 365, all: 0 };
    const days = daysMap[r];
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return ts.filter((t) => new Date(t).getTime() >= cutoff);
  };

  const garmaSeries = useMemo(() => {
    const timePoints: StatPoint[] = timeStats?.total_minutes
      ? [
          {
            label: (timeStats.last_updated || new Date().toISOString()).slice(0, 10),
            value: Math.floor(timeStats.total_minutes / 30),
            ts: new Date(timeStats.last_updated || new Date().toISOString()).getTime(),
          },
        ]
      : [];
    const merged = [
      ...applyWeight(postsDaily, 0.5),
      ...applyWeight(threadsDaily, 4),
      ...applyWeight(postLikesDaily, 2),
      ...applyWeight(threadLikesDaily, 3),
      ...applyWeight(repliesDaily, 0.25),
      ...timePoints,
    ];
    const mergedMap = new Map<number, number>();
    merged.forEach(({ ts, value }) => mergedMap.set(ts, (mergedMap.get(ts) || 0) + value));
    const acc = accumulate(
      Array.from(mergedMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([ts, value]) => ({ ts, label: new Date(ts).toISOString().slice(0, 10), value }))
    );
    const target = profile?.garma ?? (acc.length ? acc[acc.length - 1].value : 0);
    return scaleSeries(acc, target);
  }, [postsDaily, threadsDaily, postLikesDaily, threadLikesDaily, repliesDaily, timeStats, profile]);

  const currentSeries = useMemo(() => {
    const interval = pickInterval(range);
    const build = (ts: string[], weight = 1) => {
      const filtered = filterTimestamps(ts, range);
      const grouped = groupByInterval(filtered, interval, weight);
      return mode === "cumulative" ? accumulate(grouped) : grouped;
    };

    switch (metric) {
      case "posts":
        return mode === "cumulative"
          ? scaleSeries(filterByRange(accumulate(postsDaily), range), profile?.post_count || 0)
          : build(postsTs);
      case "threads":
        return mode === "cumulative"
          ? scaleSeries(filterByRange(accumulate(threadsDaily), range), profile?.thread_count || 0)
          : build(threadsTs);
      case "postLikes":
        return mode === "cumulative" ? accumulate(filterByRange(postLikesDaily, range)) : build(postLikesTs);
      case "threadLikes":
        return mode === "cumulative" ? accumulate(filterByRange(threadLikesDaily, range)) : build(threadLikesTs);
      case "replies":
        return mode === "cumulative" ? accumulate(filterByRange(repliesDaily, range)) : build(repliesTs);
      case "garma":
      default: {
        if (mode === "cumulative") {
          return filterByRange(garmaSeries, range);
        }
        const filteredWeights = [
          ...groupByInterval(filterTimestamps(postsTs, range), interval, 0.5),
          ...groupByInterval(filterTimestamps(threadsTs, range), interval, 4),
          ...groupByInterval(filterTimestamps(postLikesTs, range), interval, 2),
          ...groupByInterval(filterTimestamps(threadLikesTs, range), interval, 3),
          ...groupByInterval(filterTimestamps(repliesTs, range), interval, 0.25),
        ];
        const mergedMap = new Map<number, number>();
        filteredWeights.forEach((p) => mergedMap.set(p.ts, (mergedMap.get(p.ts) || 0) + p.value));
        const series = Array.from(mergedMap.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([ts, value]) => ({
            ts,
            label: interval === "hour" ? `${new Date(ts).getHours().toString().padStart(2, "0")}:00` : new Date(ts).toISOString().slice(0, 10),
            value,
          }));
        return series;
      }
    }
  }, [
    metric,
    postsDaily,
    threadsDaily,
    postLikesDaily,
    threadLikesDaily,
    repliesDaily,
    postsTs,
    threadsTs,
    postLikesTs,
    threadLikesTs,
    repliesTs,
    garmaSeries,
    range,
    profile?.post_count,
    profile?.thread_count,
    mode,
  ]);

  const garmaBreakdown = useMemo(() => {
    const sum = (arr: StatPoint[]) => arr.reduce((s, p) => s + p.value, 0);
    const postsVal = sum(postsDaily) * 0.5;
    const threadsVal = sum(threadsDaily) * 4;
    const postLikesVal = sum(postLikesDaily) * 2;
    const threadLikesVal = sum(threadLikesDaily) * 3;
    const repliesVal = sum(repliesDaily) * 0.25;
    const timeVal = timeStats ? Math.floor(timeStats.total_minutes / 30) : 0;
    const total = postsVal + threadsVal + postLikesVal + threadLikesVal + repliesVal + timeVal;
    const target = profile?.garma && profile.garma > 0 ? profile.garma : total;
    const k = total > 0 ? target / total : 1;
    return [
      { label: "Лайки постов", value: postLikesVal * k, color: "#22c55e" },
      { label: "Лайки тредов", value: threadLikesVal * k, color: "#3b82f6" },
      { label: "Посты", value: postsVal * k, color: "#f59e0b" },
      { label: "Треды", value: threadsVal * k, color: "#a855f7" },
      { label: "Ответы в моих тредах", value: repliesVal * k, color: "#ef4444" },
      { label: "Время на сайте", value: timeVal * k, color: "#0ea5e9" },
    ];
  }, [postsDaily, threadsDaily, postLikesDaily, threadLikesDaily, repliesDaily, timeStats, profile]);

  // Инициализируем метрику из query-параметра
  useEffect(() => {
    const m = searchParams.get("metric");
    const allowed = new Set(["garma", "posts", "threads", "postLikes", "threadLikes", "replies"]);
    if (m && allowed.has(m)) {
      setMetric(m);
    }
    urlInitDone.current = true;
  }, [searchParams]);

  const formatDate = (ts: number, r: Range) => {
    const interval = pickInterval(r);
    if (interval === "hour") return format(new Date(ts), "HH:mm");
    if (interval === "month") return format(new Date(ts), "LLL yy");
    return format(new Date(ts), "dd.MM");
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-4">
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Загружаем статистику…</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-5xl mx-auto p-4">
        <p className="text-muted-foreground">Не удалось загрузить профиль</p>
      </div>
    );
  }

  const isOwn = viewedUserId && selfId ? viewedUserId === selfId : false;
  const canViewDetailed = isOwn || (privacy?.show_detailed_stats ?? false);
  const metricAllowed = (m: string) =>
    isOwn || (canViewDetailed && (privacy?.stats_visibility?.[m] ?? false));
  const summaryAllowed = isOwn || (privacy?.show_profile_stats ?? false);

  if (!isOwn && !canViewDetailed) {
    return (
      <div className="max-w-5xl mx-auto p-4">
        <div className="text-muted-foreground">Статистика этого пользователя скрыта</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1">
          <ArrowLeft className="h-4 w-4" /> Назад
        </Button>
        <h1 className="text-2xl font-bold">Статистика {profile.username}</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Текущая gарма</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-2 text-2xl font-bold"><TrendingUp className="h-5 w-5 text-primary" />{profile.garma}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Постов</CardTitle></CardHeader>
          <CardContent className="flex items-center gap-2 text-2xl font-bold"><MessageSquare className="h-5 w-5 text-primary" />{profile.post_count}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Тредов</CardTitle></CardHeader>
          <CardContent className="flex items-center gap-2 text-2xl font-bold">{profile.thread_count}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Время на сайте</CardTitle></CardHeader>
          <CardContent className="flex items-center gap-2 text-2xl font-bold">
            <Clock3 className="h-5 w-5 text-primary" />
            {timeStats?.total_minutes != null ? Math.max(0, Math.floor(timeStats.total_minutes / 60)) + " ч" : "—"}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Динамика</CardTitle>
            <p className="text-sm text-muted-foreground">Выберите метрику — данные считаются по датам событий</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <Select value={metric} onValueChange={setMetric}>
              <SelectTrigger className="w-[200px] sm:w-[220px]"><SelectValue placeholder="Метрика" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="garma">gарма (накопительно)</SelectItem>
                <SelectItem value="posts">Посты</SelectItem>
                <SelectItem value="threads">Треды</SelectItem>
                <SelectItem value="postLikes">Лайки постов</SelectItem>
                <SelectItem value="threadLikes">Лайки тредов</SelectItem>
                <SelectItem value="replies">Ответы в моих тредах</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-1 flex-wrap">
              {[
                { key: "1d", label: "1д" },
                { key: "30d", label: "30д" },
                { key: "90d", label: "90д" },
                { key: "180d", label: "180д" },
                { key: "365d", label: "1г" },
                { key: "all", label: "Всё" },
              ].map((opt) => (
                <Button
                  key={opt.key}
                  variant={range === opt.key ? "default" : "outline"}
                  size="sm"
                  className="px-2"
                  onClick={() => setRange(opt.key as typeof range)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
            <div className="flex gap-1 flex-wrap">
              <Button
                size="sm"
                variant={mode === "cumulative" ? "default" : "outline"}
                onClick={() => setMode("cumulative")}
              >
                Накопительно
              </Button>
              <Button
                size="sm"
                variant={mode === "period" ? "default" : "outline"}
                onClick={() => setMode("period")}
              >
                За интервал
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!metricAllowed(metric) && !isOwn ? (
            <p className="text-sm text-muted-foreground">Эта метрика скрыта владельцем</p>
          ) : currentSeries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Недостаточно данных</p>
          ) : (
            <div className="h-72 sm:h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={currentSeries} margin={{ left: 0, right: 0, top: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorA" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                  <XAxis dataKey="ts" tickFormatter={(v) => formatDate(v as number, range)} tickMargin={8} type="number" domain={["dataMin", "dataMax"]} />
                  <YAxis tickMargin={8} width={60} allowDecimals={false} />
                  <RechartsTooltip formatter={(v: number) => v.toFixed(2)} labelFormatter={(d) => formatDate(d as number, range)} />
                  <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" fill="url(#colorA)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Вклад в gарму</CardTitle>
          <p className="text-sm text-muted-foreground">Расчёт с теми же весами, что в формуле gармы</p>
        </CardHeader>
        <CardContent>
          <div className="h-64 sm:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={garmaBreakdown} layout="vertical" margin={{ left: 80 }}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                <XAxis type="number" />
                <YAxis type="category" dataKey="label" width={140} />
                <RechartsTooltip formatter={(v: number) => v.toFixed(2)} />
                <Bar dataKey="value">
                  {garmaBreakdown.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
