import { useState } from "react";
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
import { ArrowLeft, Copy, Check } from "lucide-react";

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
  const [copied, setCopied] = useState(false);

  const allScopes = [
    { id: "openid", label: "openid", description: "OpenID Connect (аутентификация)" },
    { id: "profile", label: "profile", description: "Имя пользователя и аватар" },
    { id: "email", label: "email", description: "Email адрес" },
    { id: "offline_access", label: "offline_access", description: "Обновление токенов в фоне (refresh token)" },
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (result) {
    return (
      <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-6">
        <Button variant="ghost" onClick={() => navigate("/apps")}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Назад к приложениям
        </Button>
        <Card>
          <CardHeader>
            <CardTitle>Приложение создано!</CardTitle>
            <CardDescription>
              Сохраните Client Secret — он больше не будет показан.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Client ID</Label>
              <div className="flex gap-2">
                <Input value={result.client_id} readOnly className="font-mono text-xs" />
                <Button size="sm" variant="outline" onClick={() => copyToClipboard(result.client_id)}>
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-destructive font-bold">Client Secret (показан один раз!)</Label>
              <div className="flex gap-2">
                <Input value={result.client_secret} readOnly className="font-mono text-xs" />
                <Button size="sm" variant="outline" onClick={() => copyToClipboard(result.client_secret)}>
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={() => navigate("/apps")} className="w-full">
              Перейти к списку приложений
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  const scopeToggle = (scopeId: string) => {
    setScopes((prev) =>
      prev.includes(scopeId)
        ? prev.filter((s) => s !== scopeId)
        : [...prev, scopeId]
    );
  };

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-6">
      <Button variant="ghost" onClick={() => navigate("/apps")}>
        <ArrowLeft className="w-4 h-4 mr-2" /> Назад
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Создать приложение</CardTitle>
          <CardDescription>
            Зарегистрируйте OAuth-приложение для интеграции с gomo6
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Название *</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Моё приложение" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Описание</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Краткое описание вашего приложения" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="redirectUris">Redirect URIs *</Label>
              <Textarea id="redirectUris" value={redirectUris} onChange={(e) => setRedirectUris(e.target.value)} placeholder="http://localhost:3000/callback&#10;https://myapp.example.com/callback" className="min-h-[80px]" />
              <p className="text-xs text-muted-foreground">Каждый URI на новой строке</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="homepageUrl">Сайт приложения</Label>
              <Input id="homepageUrl" value={homepageUrl} onChange={(e) => setHomepageUrl(e.target.value)} placeholder="https://myapp.example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="logoUrl">URL логотипа</Label>
              <Input id="logoUrl" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://example.com/logo.png" />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="confidential" checked={isConfidential} onCheckedChange={setIsConfidential} />
              <Label htmlFor="confidential">Конфиденциальное приложение (требует client_secret)</Label>
            </div>
            <div className="space-y-2">
              <Label>Разрешения (scopes)</Label>
              <div className="space-y-2">
                {allScopes.map((scope) => (
                  <div key={scope.id} className="flex items-center gap-2">
                    <Checkbox id={`scope-${scope.id}`} checked={scopes.includes(scope.id)} onCheckedChange={() => scopeToggle(scope.id)} />
                    <Label htmlFor={`scope-${scope.id}`} className="cursor-pointer">
                      <span className="font-mono text-sm">{scope.label}</span>
                      <span className="text-xs text-muted-foreground ml-2">{scope.description}</span>
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Создание..." : "Создать приложение"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export default CreateApp;
