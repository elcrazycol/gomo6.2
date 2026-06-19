import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PentagramLoader } from "@/components/PentagramLoader";
import { toast } from "sonner";
import {
  ArrowLeft, Copy, Check, RotateCcw, Trash2, Bot, Calendar, Clock,
  AlertTriangle, Settings, ToggleLeft, ToggleRight, Key,
} from "lucide-react";

interface BotDetail {
  id: string;
  owner_id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const BotDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

  useEffect(() => {
    api.getSession().then(({ session }) => {
      if (!session) navigate("/login");
      setSessionChecked(true);
    });
  }, []);

  const { data: bot, isLoading } = useQuery({
    queryKey: ["bot", id],
    queryFn: async () => {
      const res = await api.fetch(`/api/v1/bots/${id}`);
      if (!res.ok) throw new Error("Failed to fetch bot");
      const json = await res.json();
      return json.data as BotDetail;
    },
    enabled: !!sessionChecked && !!id,
  });

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      const res = await api.fetch(`/api/v1/bots/${id}/regenerate-token`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to regenerate token");
      const json = await res.json();
      return json.data.token as string;
    },
    onSuccess: (token) => {
      setNewToken(token);
      toast.success("Новый токен сгенерирован", { duration: 5000 });
    },
    onError: (err: any) => toast.error(err.message || "Ошибка"),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async () => {
      const res = await api.fetch(`/api/v1/bots/${id}/toggle`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to toggle bot");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bot", id] });
      toast.success(bot?.is_active ? "Бот отключён" : "Бот включён");
    },
    onError: (err: any) => toast.error(err.message || "Ошибка"),
  });

  const deleteBotMutation = useMutation({
    mutationFn: async () => {
      const res = await api.fetch(`/api/v1/bots/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete bot");
    },
    onSuccess: () => {
      toast.success("Бот удалён");
      navigate("/bots");
    },
    onError: (err: any) => toast.error(err.message || "Ошибка"),
  });

  const copyToClipboard = (field: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const copyNewToken = () => {
    if (!newToken) return;
    navigator.clipboard.writeText(newToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2500);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("ru-RU", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-3">
          <PentagramLoader size="md" />
          <p className="text-sm text-muted-foreground">Загрузка бота...</p>
        </div>
      </div>
    );
  }

  if (!bot) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-8">
        <Button variant="ghost" onClick={() => navigate("/bots")} className="gap-2 mb-8">
          <ArrowLeft className="w-4 h-4" /> Назад
        </Button>
        <Card>
          <CardContent className="py-16 text-center">
            <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mx-auto mb-4">
              <Bot className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Бот не найден</h3>
            <p className="text-sm text-muted-foreground">Возможно, он был удалён</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 space-y-6">
      {/* Back button */}
      <Button variant="ghost" onClick={() => navigate("/bots")} className="gap-2">
        <ArrowLeft className="w-4 h-4" /> Назад к ботам
      </Button>

      {/* Bot Header */}
      <Card className="overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-emerald-500/80 via-emerald-600 to-emerald-500/80" />
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/10 flex items-center justify-center flex-shrink-0">
                <Bot className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <CardTitle className="text-2xl tracking-tight">{bot.username}</CardTitle>
                  <Badge
                    variant={bot.is_active ? "default" : "secondary"}
                    className={`text-[10px] ${
                      bot.is_active
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                        : ""
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full mr-1.5 inline-block ${
                      bot.is_active ? "bg-emerald-500" : "bg-muted-foreground/50"
                    }`} />
                    {bot.is_active ? "Активен" : "Неактивен"}
                  </Badge>
                </div>
                {bot.display_name && (
                  <CardDescription className="mt-1.5 text-sm">{bot.display_name}</CardDescription>
                )}
                {bot.description && (
                  <CardDescription className="mt-0.5 text-sm">{bot.description}</CardDescription>
                )}
                <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    Создан: {formatDate(bot.created_at)}
                  </span>
                  {bot.updated_at && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Обновлён: {formatDate(bot.updated_at)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Tabbed Content */}
      <Tabs defaultValue="token" className="space-y-6">
        <TabsList className="w-full sm:w-auto justify-start overflow-x-auto">
          <TabsTrigger value="token" className="gap-2">
            <Key className="w-4 h-4" />
            Токен
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="w-4 h-4" />
            Настройки
          </TabsTrigger>
          <TabsTrigger value="danger" className="gap-2 text-destructive">
            <AlertTriangle className="w-4 h-4" />
            <span className="hidden sm:inline">Опасная зона</span>
          </TabsTrigger>
        </TabsList>

        {/* Token Tab */}
        <TabsContent value="token" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Key className="w-4 h-4 text-amber-500" />
                API Токен
              </CardTitle>
              <CardDescription>
                Токен используется для авторизации запросов бота к API.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 p-3.5 rounded-lg bg-amber-500/5 border border-amber-500/10">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Текущий токен не отображается по соображениям безопасности.
                  Для получения нового токена нажмите кнопку ниже. Старый токен перестанет работать.
                </p>
              </div>

              {newToken && (
                <div className="space-y-2 p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-500" />
                    Новый токен
                    <span className="text-xs text-muted-foreground font-normal">(показан один раз!)</span>
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      value={newToken}
                      readOnly
                      className="font-mono text-xs bg-emerald-500/5 border-emerald-500/20"
                    />
                    <Button
                      size="sm"
                      variant={copiedToken ? "default" : "outline"}
                      onClick={copyNewToken}
                      className={`gap-2 ${copiedToken ? "bg-emerald-600 hover:bg-emerald-500" : ""}`}
                    >
                      {copiedToken ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {copiedToken ? "Скопировано!" : "Копировать"}
                    </Button>
                  </div>
                </div>
              )}

              <Button
                variant="outline"
                onClick={() => {
                  if (confirm("Сгенерировать новый токен? Старый перестанет работать.")) {
                    regenerateMutation.mutate();
                  }
                }}
                disabled={regenerateMutation.isPending}
                className="gap-2"
              >
                <RotateCcw className={`w-4 h-4 ${regenerateMutation.isPending ? "animate-spin" : ""}`} />
                {regenerateMutation.isPending ? "Генерация..." : "Сгенерировать новый токен"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    bot.is_active ? "bg-emerald-500/10" : "bg-muted"
                  }`}>
                    {bot.is_active
                      ? <ToggleRight className="w-5 h-5 text-emerald-500" />
                      : <ToggleLeft className="w-5 h-5 text-muted-foreground" />
                    }
                  </div>
                  <div>
                    <p className="font-medium">Статус бота</p>
                    <p className="text-sm text-muted-foreground">
                      {bot.is_active
                        ? "Бот активен и может использовать API"
                        : "Бот отключён — запросы отклоняются"
                      }
                    </p>
                  </div>
                </div>
                <Button
                  variant={bot.is_active ? "outline" : "default"}
                  size="sm"
                  onClick={() => toggleActiveMutation.mutate()}
                  disabled={toggleActiveMutation.isPending}
                  className="gap-2"
                >
                  {bot.is_active ? (
                    <>Отключить</>
                  ) : (
                    <>Включить</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Danger Zone Tab */}
        <TabsContent value="danger" className="space-y-4">
          <Card className="border-destructive/20">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2 text-destructive">
                <AlertTriangle className="w-4 h-4" />
                Опасная зона
              </CardTitle>
              <CardDescription>
                Действия в этом разделе необратимы.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4 p-4 rounded-lg bg-destructive/5 border border-destructive/10">
                <div className="flex items-start gap-3">
                  <Trash2 className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">Удалить бота</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Аккаунт бота будет удалён навсегда. Токен перестанет работать.
                    </p>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (confirm("Вы уверены? Это действие нельзя отменить.")) {
                      deleteBotMutation.mutate();
                    }
                  }}
                  disabled={deleteBotMutation.isPending}
                  className="gap-2 flex-shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                  Удалить
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default BotDetailPage;
