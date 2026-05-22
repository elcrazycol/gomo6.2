import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/api/client_simple";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PentagramLoader } from "@/components/PentagramLoader";
import { toast } from "sonner";
import { ArrowLeft, Copy, Check, RotateCcw, Trash2, Fingerprint, User, Mail, RefreshCw } from "lucide-react";

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
  const [copied, setCopied] = useState(false);
  const [session, setSession] = useState<any>(null);

  useState(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (!session) navigate("/auth?redirect=/developer/apps");
    });
  });

  const { data: app, isLoading } = useQuery({
    queryKey: ["developer-app", id],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const res = await fetch(`/api/v1/developer/apps/${id}`, {
        headers: { "Authorization": `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch app");
      const json = await res.json();
      return json.data as OAuthApp;
    },
    enabled: !!session && !!id,
  });

  const { data: tokens } = useQuery({
    queryKey: ["developer-app-tokens", id],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/v1/developer/apps/${id}/tokens`, {
        headers: { "Authorization": `Bearer ${session!.access_token}` },
      });
      if (!res.ok) return [];
      const json = await res.json();
      return json.data as Token[];
    },
    enabled: !!session && !!id,
  });

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/v1/developer/apps/${id}/regenerate-secret`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${session!.access_token}` },
      });
      if (!res.ok) throw new Error("Failed to regenerate secret");
      const json = await res.json();
      return json.data.client_secret as string;
    },
    onSuccess: (secret) => {
      navigator.clipboard.writeText(secret);
      toast.success("Новый Client Secret скопирован в буфер обмена");
    },
    onError: (err: any) => toast.error(err.message || "Ошибка"),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/v1/developer/apps/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session!.access_token}`,
        },
        body: JSON.stringify({ is_active: !app?.is_active }),
      });
      if (!res.ok) throw new Error("Failed to update app");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["developer-app", id] });
      toast.success("Статус приложения изменён");
    },
    onError: (err: any) => toast.error(err.message || "Ошибка"),
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <PentagramLoader size="md" />
      </div>
    );
  }

  if (!app) {
    return (
      <div className="max-w-2xl mx-auto p-4">
        <Button variant="ghost" onClick={() => navigate("/developer/apps")}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Назад
        </Button>
        <p className="text-center text-muted-foreground mt-8">Приложение не найдено</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      <Button variant="ghost" onClick={() => navigate("/developer/apps")}>
        <ArrowLeft className="w-4 h-4 mr-2" /> Назад
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-2xl">{app.name}</CardTitle>
              {app.description && <CardDescription>{app.description}</CardDescription>}
            </div>
            <Badge variant={app.is_active ? "default" : "secondary"}>
              {app.is_active ? "Активно" : "Неактивно"}
            </Badge>
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="credentials">
        <TabsList>
          <TabsTrigger value="credentials">Учётные данные</TabsTrigger>
          <TabsTrigger value="settings">Настройки</TabsTrigger>
          <TabsTrigger value="tokens">Токены ({tokens?.length || 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="credentials" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Client ID</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input value={app.client_id} readOnly className="font-mono text-xs" />
                <Button size="sm" variant="outline" onClick={() => copyToClipboard(app.client_id)}>
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Client Secret</CardTitle>
              <CardDescription>
                Секрет хранится в зашифрованном виде. Вы можете сгенерировать новый.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                onClick={() => {
                  if (confirm("Сгенерировать новый Client Secret? Старый перестанет работать.")) {
                    regenerateMutation.mutate();
                  }
                }}
                disabled={regenerateMutation.isPending}
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                {regenerateMutation.isPending ? "Генерация..." : "Сгенерировать новый"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Redirect URIs</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1">
                {app.redirect_uris?.map((uri, i) => (
                  <li key={i} className="text-sm font-mono bg-muted rounded px-2 py-1">
                    {uri}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Разрешения (Scopes)</CardTitle>
              <CardDescription>
                Данные, к которым приложение имеет доступ
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {(!app.allowed_scopes || app.allowed_scopes.length === 0) ? (
                  <p className="text-sm text-muted-foreground">Нет разрешений</p>
                ) : (
                  app.allowed_scopes.map((s) => {
                    const descriptions: Record<string, string> = {
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
                        default: return null;
                      }
                    };
                    return (
                      <div key={s} className="flex items-start gap-3 p-3 rounded-lg bg-muted/40 border border-border/30 hover:bg-muted/60 transition-colors">
                        <div className="w-7 h-7 rounded-md bg-background flex items-center justify-center flex-shrink-0 ring-1 ring-border/30">
                          {scopeIcon(s)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="font-mono text-xs">{s}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                            {descriptions[s] || s}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Статус приложения</p>
                  <p className="text-sm text-muted-foreground">
                    {app.is_active ? "Приложение активно и может использоваться" : "Приложение отключено"}
                  </p>
                </div>
                <Button
                  variant={app.is_active ? "destructive" : "default"}
                  onClick={() => toggleActiveMutation.mutate()}
                  disabled={toggleActiveMutation.isPending}
                >
                  {app.is_active ? "Отключить" : "Включить"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tokens" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Активные токены</CardTitle>
              <CardDescription>
                Всего активных токенов: {tokens?.length || 0}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!tokens || tokens.length === 0 ? (
                <p className="text-sm text-muted-foreground">Нет активных токенов</p>
              ) : (
                <div className="space-y-2">
                  {tokens.map((token) => (
                    <div key={token.id} className="flex items-center justify-between bg-muted rounded p-3">
                      <div>
                        <div className="text-xs font-mono">ID: {token.token_id.substring(0, 16)}...</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          User: {token.user_id.substring(0, 12)}...
                        </div>
                        <div className="flex gap-1 mt-1">
                          {token.scopes?.map((s) => (
                            <Badge key={s} variant="outline" className="text-[10px] px-1 py-0">{s}</Badge>
                          ))}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground text-right">
                        <div>Истекает: {new Date(token.expires_at).toLocaleDateString()}</div>
                        <div>Создан: {new Date(token.created_at).toLocaleDateString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AppDetail;