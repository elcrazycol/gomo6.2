import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { ArrowLeft, Copy, Check, Shield, Key, Globe, Lock, Info, AlertTriangle, Sparkles, ExternalLink, Eye, EyeOff, ShieldAlert } from "lucide-react";

const CreateApp = () => {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [redirectUris, setRedirectUris] = useState("");
  const [homepageUrl, setHomepageUrl] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [isConfidential, setIsConfidential] = useState(true);
  const [scopes, setScopes] = useState<string[]>(["profile"]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ client_id: string; client_secret: string } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);

  const allScopes = [
    { id: "openid", label: "openid", description: "OpenID Connect — идентификация учётной записи", icon: "🆔" },
    { id: "profile", label: "profile", description: "Имя пользователя и аватар", icon: "👤" },
    { id: "email", label: "email", description: "Email адрес пользователя", icon: "📧" },
    { id: "offline_access", label: "offline_access", description: "Обновление токенов в фоне (refresh token)", icon: "🔄" },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { session } = await api.getSession();
      if (!session) {
        toast.error("Необходимо войти в систему");
        navigate("/login");
        return;
      }

      const redirectUriList = redirectUris
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      if (redirectUriList.length === 0) {
        toast.error("Добавьте хотя бы один redirect URI");
        setLoading(false);
        return;
      }

      const res = await api.fetch("/api/v1/developer/apps", {
        method: "POST",
        body: JSON.stringify({
          name,
          description,
          redirect_uris: redirectUriList,
          allowed_scopes: scopes,
          is_confidential: isConfidential,
          logo_url: logoUrl,
          homepage_url: homepageUrl,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Ошибка создания приложения");
        setLoading(false);
        return;
      }

      setResult({
        client_id: data.app.client_id,
        client_secret: data.client_secret,
      });
      toast.success("Приложение создано!");
    } catch (err: any) {
      toast.error("Ошибка соединения");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (field: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    if (field === "secret") setSecretCopied(true);
    setTimeout(() => {
      setCopiedField(null);
      setSecretCopied(false);
    }, 2500);
  };

  const uriWarnings = useMemo(() => {
    const uris = redirectUris
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    return uris.filter((uri) => {
      try {
        const url = new URL(uri);
        // Allow http for localhost, 127.0.0.1, [::1] — warn for everything else
        return (
          url.protocol === "http:" &&
          url.hostname !== "localhost" &&
          url.hostname !== "127.0.0.1" &&
          url.hostname !== "[::1]" &&
          !url.hostname.endsWith(".localhost")
        );
      } catch {
        return false;
      }
    });
  }, [redirectUris]);

  const scopeToggle = (scopeId: string) => {
    setScopes((prev) =>
      prev.includes(scopeId)
        ? prev.filter((s) => s !== scopeId)
        : [...prev, scopeId]
    );
  };

  // Success state
  if (result) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 space-y-6">
        <Button variant="ghost" onClick={() => { setResult(null); navigate("/apps"); }} className="gap-2">
          <ArrowLeft className="w-4 h-4" /> Назад к приложениям
        </Button>

        <div className="text-center space-y-3 mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Приложение создано!</h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Сохраните <strong>Client Secret</strong> — он будет показан только один раз.
            При утере секрета вы сможете сгенерировать новый в настройках приложения.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-5">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Client ID</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input value={result.client_id} readOnly className="font-mono text-xs pr-10 bg-muted/30" />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard("id", result.client_id)}
                  className="gap-2"
                >
                  {copiedField === "id" ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                  {copiedField === "id" ? "Скопировано" : "Копировать"}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Client Secret
                <span className="text-xs text-muted-foreground font-normal">(показан один раз!)</span>
              </Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    value={result.client_secret}
                    readOnly
                    type={showSecret ? "text" : "password"}
                    className="font-mono text-xs pr-10 bg-amber-500/5 border-amber-500/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <Button
                  size="sm"
                  variant={secretCopied ? "default" : "outline"}
                  onClick={() => copyToClipboard("secret", result.client_secret)}
                  className={`gap-2 ${secretCopied ? "bg-emerald-600 hover:bg-emerald-500" : ""}`}
                >
                  {secretCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {secretCopied ? "Скопировано!" : "Копировать"}
                </Button>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col sm:flex-row gap-3 pt-2">
            <Button onClick={() => navigate("/apps")} variant="outline" className="w-full gap-2">
              <Shield className="w-4 h-4" />
              Список приложений
            </Button>
            <Button
              onClick={() => navigate(`/apps/${result.client_id}`)}
              className="w-full gap-2"
            >
              Настройки приложения
              <ExternalLink className="w-4 h-4" />
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 space-y-6">
      <Button variant="ghost" onClick={() => navigate("/apps")} className="gap-2">
        <ArrowLeft className="w-4 h-4" /> Назад
      </Button>

      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/10 flex items-center justify-center">
          <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Создать приложение</h1>
          <p className="text-sm text-muted-foreground">
            Зарегистрируйте OAuth-приложение для интеграции с gomo6
          </p>
        </div>
      </div>

      <Card>
        <form onSubmit={handleSubmit}>
          <CardContent className="pt-6 space-y-6">
            {/* Basic Info */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-1 border-b border-border/50">
                <Info className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm font-semibold">Основная информация</span>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="name" className="text-sm font-medium">
                    Название приложения <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Моё приложение"
                    required
                    className="h-10"
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="description" className="text-sm font-medium">Описание</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Краткое описание того, что делает ваше приложение..."
                    className="min-h-[80px] resize-none"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="homepageUrl" className="text-sm font-medium">Сайт приложения</Label>
                  <div className="relative">
                    <Globe className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="homepageUrl"
                      value={homepageUrl}
                      onChange={(e) => setHomepageUrl(e.target.value)}
                      placeholder="https://myapp.example.com"
                      className="pl-9 h-10"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="logoUrl" className="text-sm font-medium">URL логотипа</Label>
                  <Input
                    id="logoUrl"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="https://example.com/logo.png"
                    className="h-10"
                  />
                </div>
              </div>
            </div>

            {/* Redirect URIs */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-1 border-b border-border/50">
                <ExternalLink className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm font-semibold">Redirect URIs</span>
                <span className="text-destructive text-xs font-medium">*</span>
              </div>

              <div className="space-y-2">
                <Textarea
                  id="redirectUris"
                  value={redirectUris}
                  onChange={(e) => setRedirectUris(e.target.value)}
                  placeholder={`https://myapp.example.com/callback\nhttp://localhost:3000/callback`}
                  className="min-h-[100px] font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Info className="w-3 h-3" />
                  Каждый URI на новой строке. Для разработки можно использовать localhost.
                </p>
              </div>

              {/* URI validation warnings */}
              {uriWarnings.length > 0 && (
                <div className="space-y-1.5">
                  {uriWarnings.map((uri, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2.5 p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5"
                    >
                      <ShieldAlert className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div className="text-xs leading-relaxed">
                        <span className="font-mono text-foreground break-all">{uri}</span>
                        <span className="text-muted-foreground"> — использует HTTP вместо HTTPS. </span>
                        <span className="text-amber-600 dark:text-amber-400 font-medium">Рекомендуется HTTPS</span>
                        <span className="text-muted-foreground"> для продакшена.</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Security */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-1 border-b border-border/50">
                <Lock className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm font-semibold">Безопасность</span>
              </div>

              <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/40 border border-border/50">
                <Switch
                  id="confidential"
                  checked={isConfidential}
                  onCheckedChange={setIsConfidential}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <Label htmlFor="confidential" className="text-sm font-medium cursor-pointer">
                    Конфиденциальное приложение
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    Требует <code className="text-xs bg-muted px-1 rounded">client_secret</code> для обмена кода на токены.
                    Рекомендуется для серверных приложений. Для SPA / мобильных приложений отключите эту опцию.
                  </p>
                </div>
              </div>
            </div>

            {/* Scopes */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-1 border-b border-border/50">
                <Key className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm font-semibold">Разрешения (Scopes)</span>
              </div>

              <p className="text-xs text-muted-foreground">
                Выберите, к каким данным пользователя приложение будет иметь доступ.
              </p>

              <div className="grid gap-3">
                {allScopes.map((scope) => (
                  <div
                    key={scope.id}
                    className={`flex items-start gap-3 p-3.5 rounded-lg border transition-all duration-150 cursor-pointer hover:border-emerald-500/30 hover:bg-emerald-500/5 ${
                      scopes.includes(scope.id)
                        ? "border-emerald-500/40 bg-emerald-500/5"
                        : "border-border/60 bg-background"
                    }`}
                    onClick={() => scopeToggle(scope.id)}
                  >
                    <Checkbox
                      id={`scope-${scope.id}`}
                      checked={scopes.includes(scope.id)}
                      onCheckedChange={() => scopeToggle(scope.id)}
                      className="mt-0.5"
                    />
                    <Label htmlFor={`scope-${scope.id}`} className="cursor-pointer flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs">{scope.icon}</span>
                        <span className="font-mono text-sm font-medium">{scope.label}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{scope.description}</p>
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col sm:flex-row gap-3 border-t border-border/50 pt-6">
            <Button type="submit" className="w-full gap-2 h-11" disabled={loading}>
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Создание...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Создать приложение
                </>
              )}
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate("/apps")} className="w-full sm:w-auto">
              Отмена
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export default CreateApp;
