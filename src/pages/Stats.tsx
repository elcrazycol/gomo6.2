import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
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

interface TimeStats {
  total_minutes: number;
  last_updated?: string | null;
}

interface StatPoint {
  date: string;
  value: number;
}

const groupByDate = (timestamps: string[], weight = 1): StatPoint[] => {
  const map = new Map<string, number>();
  timestamps.forEach((ts) => {
    const key = ts.slice(0, 10); // YYYY-MM-DD
    map.set(key, (map.get(key) || 0) + weight);
  });
  return Array.from(map.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
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

export default function Stats() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlInitDone = useRef(false);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [timeStats, setTimeStats] = useState<TimeStats | null>(null);
  const [postsRaw, setPostsRaw] = useState<StatPoint[]>([]);
  const [threadsRaw, setThreadsRaw] = useState<StatPoint[]>([]);
  const [postLikesRaw, setPostLikesRaw] = useState<StatPoint[]>([]);
  const [threadLikesRaw, setThreadLikesRaw] = useState<StatPoint[]>([]);
  const [repliesRaw, setRepliesRaw] = useState<StatPoint[]>([]);
  const [metric, setMetric] = useState("garma");

  useEffect(() => {
    const load = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) {
        navigate("/auth");
        return;
      }

      setLoading(true);

      const [profileRes, postsRes, threadsRes, postLikesRes, threadLikesRes, repliesRes, timeRes] = await Promise.all([
        supabase.from("profiles").select("username, garma, post_count, thread_count").eq("id", userId).single(),
        supabase.from("posts").select("created_at").eq("user_id", userId).order("created_at", { ascending: true }),
        supabase.from("threads").select("created_at").eq("user_id", userId).order("created_at", { ascending: true }),
        supabase
          .from("post_likes")
          .select("created_at, posts!inner(user_id)")
          .eq("posts.user_id", userId)
          .order("created_at", { ascending: true }),
        supabase
          .from("thread_likes")
          .select("created_at, threads!inner(user_id)")
          .eq("threads.user_id", userId)
          .order("created_at", { ascending: true }),
        supabase
          .from("posts")
          .select("created_at, threads!inner(user_id)")
          .eq("threads.user_id", userId)
          .neq("user_id", userId)
          .order("created_at", { ascending: true }),
        supabase
          .from("user_session_time")
          .select("total_minutes, last_updated")
          .eq("user_id", userId)
          .maybeSingle(),
      ]);

      if (profileRes.data) setProfile(profileRes.data);
      if (timeRes.data) setTimeStats(timeRes.data);

      setPostsRaw(groupByDate(postsRes.data?.map((p) => p.created_at) || []));
      setThreadsRaw(groupByDate(threadsRes.data?.map((t) => t.created_at) || []));
      setPostLikesRaw(groupByDate(postLikesRes.data?.map((l) => l.created_at) || []));
      setThreadLikesRaw(groupByDate(threadLikesRes.data?.map((l) => l.created_at) || []));
      setRepliesRaw(groupByDate(repliesRes.data?.map((r) => r.created_at) || []));

      setLoading(false);
    };

    load();
  }, [navigate]);

  const applyWeight = (points: StatPoint[], weight: number) =>
    points.map((p) => ({ ...p, value: p.value * weight }));

  const garmaSeries = useMemo(() => {
    const timePoints: StatPoint[] = timeStats?.total_minutes
      ? [{ date: (timeStats.last_updated || new Date().toISOString()).slice(0, 10), value: Math.floor(timeStats.total_minutes / 30) }]
      : [];
    const merged = [
      ...applyWeight(postsRaw, 0.5),
      ...applyWeight(threadsRaw, 4),
      ...applyWeight(postLikesRaw, 2),
      ...applyWeight(threadLikesRaw, 3),
      ...applyWeight(repliesRaw, 0.25),
      ...timePoints,
    ];
    const mergedMap = new Map<string, number>();
    merged.forEach(({ date, value }) => mergedMap.set(date, (mergedMap.get(date) || 0) + value));
    const acc = accumulate(
      Array.from(mergedMap.entries())
        .map(([date, value]) => ({ date, value }))
        .sort((a, b) => (a.date < b.date ? -1 : 1))
    );
    const target = profile?.garma ?? (acc.length ? acc[acc.length - 1].value : 0);
    return scaleSeries(acc, target);
  }, [postsRaw, threadsRaw, postLikesRaw, threadLikesRaw, repliesRaw, timeStats, profile]);

  const currentSeries = useMemo(() => {
    switch (metric) {
      case "posts":
        return scaleSeries(accumulate(postsRaw), profile?.post_count || 0);
      case "threads":
        return scaleSeries(accumulate(threadsRaw), profile?.thread_count || 0);
      case "postLikes":
        return accumulate(postLikesRaw);
      case "threadLikes":
        return accumulate(threadLikesRaw);
      case "replies":
        return accumulate(repliesRaw);
      case "garma":
      default:
        return garmaSeries;
    }
  }, [metric, postsRaw, threadsRaw, postLikesRaw, threadLikesRaw, repliesRaw, garmaSeries]);

  const garmaBreakdown = useMemo(() => {
    const sum = (arr: StatPoint[]) => arr.reduce((s, p) => s + p.value, 0);
    const postsVal = sum(postsRaw) * 0.5;
    const threadsVal = sum(threadsRaw) * 4;
    const postLikesVal = sum(postLikesRaw) * 2;
    const threadLikesVal = sum(threadLikesRaw) * 3;
    const repliesVal = sum(repliesRaw) * 0.25;
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
  }, [postsRaw, threadsRaw, postLikesRaw, threadLikesRaw, repliesRaw, timeStats, profile]);

  // Инициализируем метрику из query-параметра
  useEffect(() => {
    const m = searchParams.get("metric");
    const allowed = new Set(["garma", "posts", "threads", "postLikes", "threadLikes", "replies"]);
    if (m && allowed.has(m)) {
      setMetric(m);
    }
    urlInitDone.current = true;
  }, [searchParams]);

  const formatDate = (d: string) => format(new Date(d), "dd.MM");

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
          <CardContent className="flex items-center gap-2 text-2xl font-bold"><Clock3 className="h-5 w-5 text-primary" />{Math.floor((timeStats?.total_minutes || 0) / 60)} ч</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Динамика</CardTitle>
            <p className="text-sm text-muted-foreground">Выберите метрику — данные считаются по датам событий</p>
          </div>
          <Select value={metric} onValueChange={setMetric}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Метрика" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="garma">gарма (накопительно)</SelectItem>
              <SelectItem value="posts">Посты</SelectItem>
              <SelectItem value="threads">Треды</SelectItem>
              <SelectItem value="postLikes">Лайки постов</SelectItem>
              <SelectItem value="threadLikes">Лайки тредов</SelectItem>
              <SelectItem value="replies">Ответы в моих тредах</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {currentSeries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Недостаточно данных</p>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={currentSeries} margin={{ left: 0, right: 0, top: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorA" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                  <XAxis dataKey="date" tickFormatter={formatDate} tickMargin={8} />
                  <YAxis tickMargin={8} width={60} allowDecimals={false} />
                  <RechartsTooltip formatter={(v: number) => v.toFixed(2)} labelFormatter={(d) => formatDate(d as string)} />
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
          <div className="h-72">
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
