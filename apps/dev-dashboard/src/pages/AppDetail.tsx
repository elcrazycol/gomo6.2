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
  ArrowLeft, Copy, Check, RotateCcw, Trash2, Fingerprint, User, Mail,
  RefreshCw, Shield, ShieldOff, Eye, EyeOff, ExternalLink, Globe, Key,
  Calendar, Clock, AlertTriangle, Info, Settings, Activity, List,
  ToggleLeft, ToggleRight, ShieldAlert
} from "lucide-react";

interface OAuthApp {
  id: string;
  name: string;
  description: string;
  client_id: string;
  redirect_uris: string[];
  allowed_scopes: string[];
  is_confidential: boolean;
  logo_url: string;
  homepage_url: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface Token {
  id: string;
  token_id: string;
  user_id: string;
  scopes: string[];
  expires_at: string;
  revoked: boolean;
  created_at: string;
}

const AppDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    api.getSession().then(({ session }) => {
      if (!session) navigate("/login");
      setSessionChecked(true);
    });
  }, []);

  const { data: app, isLoading } = useQuery({
    queryKey: ["developer-app", id],
    queryFn: async () => {
      const res = await api.fetch(`/api/v1/developer/apps/${id}`);
      if (!res.ok) throw new Error("Failed to fetch app");
      const json = await res.json();
      return json.data as OAuthApp;
    },
    enabled: !!sessionChecked && !!id,
  });

  const { data: tokens } = useQuery({
    queryKey: ["developer-app-tokens", id],
    queryFn: async () => {
      const res = await api.fetch(`/api/v1/developer/apps/${id}/tokens`);
      if (!res.ok) return [];
      const json = await res.json();
      return json.data as Token[];
    },
    enabled: !!sessionChecked && !!id,
  });

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      const res = await api.fetch(`/api/v1/developer/apps/${id}/regenerate-secret`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to regenerate secret");
      const json = await res.json();
      return json.data.client_secret as string;
    },
    onSuccess: (secret) => {
      navigator.clipboard.writeText(secret);
      toast.success("Новый Client Secret скопирован в буфер обмена", { duration: 5000 });
    },
    onError: (err: any) => toast.error(err.message || "Ошибка"),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async () => {
      const res = await api.fetch(`/api/v1/developer/apps/${id}`, {
        method: "PUT",
        body: JSON.stringify({ is_active: !app?.is_active }),
      });
      if (!res.ok) throw new Error("Failed to update app");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["developer-app", id] });
      toast.success(app?.is_active ? "Приложение отключено" : "Приложение включено");
    },
    onError: (err: any) => toast.error(err.message || "Ошибка"),
  });

  const deleteAppMutation = useMutation({
    mutationFn: async () => {
      const res = await api.fetch(`/api/v1/developer/apps/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete app");
    },
    onSuccess: () => {
      toast.success("Приложение удалено");
      navigate("/apps");
    },
    onError: (err: any) => toast.error(err.message || "Ошибка"),
  });

  const copyToClipboard = (field: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const toggleSecretVisibility = (key: string) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const activeTokens = tokens?.filter((t) => !t.revoked) || [];
  const revokedTokens = tokens?.filter((t) => t.revoked) || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-3">
          <PentagramLoader size="md" />
          <p className="text-sm text-muted-foreground">Загрузка приложения...</p>
        </div>
      </div>
    );
  }

  if (!app) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-8">
        <Button variant="ghost" onClick={() => navigate("/apps")} className="gap-2 mb-8">
          <ArrowLeft className="w-4 h-4" /> Назад
        </Button>
        <Card>
          <CardContent className="py-16 text-center">
            <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mx-auto mb-4">
              <ShieldOff className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Приложение не найдено</h3>
            <p className="text-sm text-muted-foreground">Возможно, оно было удалено или у вас нет доступа</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const scopeDescriptions: Record<string, string> = {
    openid: "OpenID Connect — идентификация учётной записи",
    profile: "Имя пользователя и аватар",
    email: "Email адрес",
    offline_access: "Обновление токенов в фоне",
  };

  const scopeIcon = (scope: string) => {
    const cls = "w-4 h-4";
    switch (scope) {
      case "openid": return <Fingerprint className={`${cls} text-blue-500`} />;
      case "profile": return <User className={`${cls} text-emerald-500`} />;
      case "email": return <Mail className={`${cls} text-amber-500`} />;
      case "offline_access": return <RefreshCw className={`${cls} text-violet-500`} />;
      default: return <Key className={`${cls} text-muted-foreground`} />;
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("ru-RU", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("ru-RU", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 space-y-6">
      {/* Back button */}
      <Button variant="ghost" onClick={() => navigate("/apps")} className="gap-2">
        <ArrowLeft className="w-4 h-4" /> Назад к приложениям
      </Button>

      {/* App Header */}
      <Card className="overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-emerald-500/80 via-emerald-600 to-emerald-500/80" />
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/10 flex items-center justify-center flex-shrink-0">
                <Shield className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <CardTitle className="text-2xl tracking-tight">{app.name}</CardTitle>
                  <Badge
                    variant={app.is_active ? "default" : "secondary"}
                    className={`text-[10px] ${
                      app.is_active
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                        : ""
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full mr-1.5 inline-block ${
                      app.is_active ? "bg-emerald-500" : "bg-muted-foreground/50"
                    }`} />
                    {app.is_active ? "Активно" : "Неактивно"}
                  </Badge>
                </div>
                {app.description && (
                  <CardDescription className="mt-1.5 text-sm">{app.description}</CardDescription>
                )}
                <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    Создано: {formatDate(app.created_at)}
                  </span>
                  {app.updated_at && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Обновлено: {formatDate(app.updated_at)}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {app.homepage_url && (
              <a
                href={app.homepage_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
              >
                <Globe className="w-4 h-4" />
                {new URL(app.homepage_url).hostname}
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Tabbed Content */}
      <Tabs defaultValue="credentials" className="space-y-6">
        <TabsList className="w-full sm:w-auto justify-start overflow-x-auto">
          <TabsTrigger value="credentials" className="gap-2">
            <Key className="w-4 h-4" />
            <span className="hidden sm:inline">Учётные данные</span>
            <span className="sm:hidden">Креды</span>
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="w-4 h-4" />
            Настройки
          </TabsTrigger>
          <TabsTrigger value="tokens" className="gap-2">
            <Activity className="w-4 h-4" />
            Токены
            {activeTokens.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
                {activeTokens.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="danger" className="gap-2 text-destructive">
            <AlertTriangle className="w-4 h-4" />
            <span className="hidden sm:inline">Опасная зона</span>
          </TabsTrigger>
        </TabsList>

        {/* Credentials Tab */}
        <TabsContent value="credentials" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Key className="w-4 h-4 text-emerald-500" />
                Client ID
              </CardTitle>
              <CardDescription>
                Публичный идентификатор приложения. Используется в URL авторизации.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input value={app.client_id} readOnly className="font-mono text-xs bg-muted/30 pr-10" />
                  <button
                    type="button"
                    onClick={() => toggleSecretVisibility("client_id")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showSecrets["client_id"] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard("client_id", app.client_id)}
                  className="gap-2"
                >
                  {copiedField === "client_id" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copiedField === "client_id" ? "Готово" : "Копировать"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-500" />
                Client Secret
              </CardTitle>
              <CardDescription>
                Секретный ключ хранится в зашифрованном виде. При компрометации — сгенерируйте новый.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 p-3.5 rounded-lg bg-amber-500/5 border border-amber-500/10">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  После генерации нового секрета старый перестанет работать.
                  Приложение нужно будет обновить на всех серверах.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  if (confirm("Сгенерировать новый Client Secret? Старый перестанет работать.")) {
                    regenerateMutation.mutate();
                  }
                }}
                disabled={regenerateMutation.isPending}
                className="gap-2"
              >
                <RotateCcw className={`w-4 h-4 ${regenerateMutation.isPending ? "animate-spin" : ""}`} />
                {regenerateMutation.isPending ? "Генерация..." : "Сгенерировать новый секрет"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ExternalLink className="w-4 h-4 text-emerald-500" />
                Redirect URIs
              </CardTitle>
              <CardDescription>
                URLs для перенаправления после авторизации пользователя
              </CardDescription>
            </CardHeader>
            <CardContent>
              {app.redirect_uris?.length > 0 ? (
                <ul className="space-y-1.5">
                  {app.redirect_uris.map((uri, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 text-sm font-mono bg-muted/40 rounded-lg px-3.5 py-2 border border-border/40">
                      <span className="truncate text-xs">{uri}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 flex-shrink-0"
                        onClick={() => copyToClipboard(`uri-${i}`, uri)}
                      >
                        {copiedField === `uri-${i}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Не указаны</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <List className="w-4 h-4 text-emerald-500" />
                Разрешения (Scopes)
              </CardTitle>
              <CardDescription>Данные пользователя, к которым приложение имеет доступ</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                {(!app.allowed_scopes || app.allowed_scopes.length === 0) ? (
                  <p className="text-sm text-muted-foreground">Нет разрешений</p>
                ) : (
                  app.allowed_scopes.map((s) => (
                    <div
                      key={s}
                      className="flex items-start gap-3 p-3.5 rounded-lg bg-muted/30 border border-border/40 hover:bg-muted/50 transition-colors"
                    >
                      <div className="w-8 h-8 rounded-lg bg-background flex items-center justify-center flex-shrink-0 ring-1 ring-border/30">
                        {scopeIcon(s)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="font-mono text-xs px-2">{s}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                          {scopeDescriptions[s] || s}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    app.is_active ? "bg-emerald-500/10" : "bg-muted"
                  }`}>
                    {app.is_active
                      ? <ToggleRight className="w-5 h-5 text-emerald-500" />
                      : <ToggleLeft className="w-5 h-5 text-muted-foreground" />
                    }
                  </div>
                  <div>
                    <p className="font-medium">Статус приложения</p>
                    <p className="text-sm text-muted-foreground">
                      {app.is_active
                        ? "Приложение активно и может использоваться для OAuth-авторизации"
                        : "Приложение отключено — новые авторизации невозможны"
                      }
                    </p>
                  </div>
                </div>
                <Button
                  variant={app.is_active ? "outline" : "default"}
                  size="sm"
                  onClick={() => toggleActiveMutation.mutate()}
                  disabled={toggleActiveMutation.isPending}
                  className="gap-2"
                >
                  {app.is_active ? (
                    <>Отключить <ShieldOff className="w-4 h-4" /></>
                  ) : (
                    <>Включить <Shield className="w-4 h-4" /></>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tokens Tab */}
        <TabsContent value="tokens" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-500" />
                    Активные токены
                  </CardTitle>
                  <CardDescription>
                    Всего активных сессий: {activeTokens.length}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {activeTokens.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
                    <RefreshCw className="w-6 h-6 text-muted-foreground/50" />
                  </div>
                  <p className="text-sm text-muted-foreground">Нет активных токенов</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {activeTokens.map((token) => (
                    <div
                      key={token.id}
                      className="flex items-start justify-between gap-4 bg-muted/30 border border-border/40 rounded-lg p-4 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="text-xs font-mono bg-muted rounded px-2 py-0.5 truncate max-w-[200px]">
                            {token.token_id}
                          </div>
                          <Badge variant="default" className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                            Активен
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {token.scopes?.map((s) => (
                            <Badge key={s} variant="outline" className="text-[10px] px-1.5 py-0">
                              {s}
                            </Badge>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            Истекает: {formatDateTime(token.expires_at)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Создан: {formatDate(token.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {revokedTokens.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2 text-muted-foreground">
                  <ShieldOff className="w-4 h-4" />
                  Отозванные токены
                </CardTitle>
                <CardDescription>Всего: {revokedTokens.length}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {revokedTokens.slice(0, 10).map((token) => (
                    <div
                      key={token.id}
                      className="flex items-center justify-between gap-4 bg-muted/15 border border-border/20 rounded-lg p-3 opacity-60"
                    >
                      <div className="text-xs font-mono truncate">{token.token_id}</div>
                      <Badge variant="secondary" className="text-[10px]">Отозван</Badge>
                    </div>
                  ))}
                  {revokedTokens.length > 10 && (
                    <p className="text-xs text-muted-foreground text-center pt-2">
                      И ещё {revokedTokens.length - 10} отозванных токенов
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
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
                Действия в этом разделе необратимы. Будьте осторожны.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4 p-4 rounded-lg bg-destructive/5 border border-destructive/10">
                <div className="flex items-start gap-3">
                  <Trash2 className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">Удалить приложение</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Все токены будут немедленно отозваны. Пользователи больше не смогут войти через это приложение.
                    </p>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (confirm("Вы уверены? Это действие нельзя отменить. Все токены будут отозваны.")) {
                      deleteAppMutation.mutate();
                    }
                  }}
                  disabled={deleteAppMutation.isPending}
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

export default AppDetail;
