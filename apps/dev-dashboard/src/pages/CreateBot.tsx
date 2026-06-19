import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Copy, Check, Bot, Sparkles, ExternalLink, AlertTriangle } from "lucide-react";

const CreateBot = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ username: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

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

      const finalUsername = username.endsWith("_bot") ? username : username + "_bot";

      const res = await api.fetch("/api/v1/bots", {
        method: "POST",
        body: JSON.stringify({
          username: finalUsername,
          display_name: displayName || null,
          description: description || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Ошибка создания бота");
        setLoading(false);
        return;
      }

      setResult({
        username: data.data.username,
        token: data.data.token,
      });
      toast.success("Бот создан!");
    } catch (err: any) {
      toast.error("Ошибка соединения");
    } finally {
      setLoading(false);
    }
  };

  const copyToken = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // Success state
  if (result) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 space-y-6">
        <Button variant="ghost" onClick={() => navigate("/bots")} className="gap-2">
          <ArrowLeft className="w-4 h-4" /> Назад к ботам
        </Button>

        <div className="text-center space-y-3 mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Бот создан!</h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Сохраните <strong>токен</strong> — он будет показан только один раз.
            При утере вы сможете сгенерировать новый в настройках бота.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-5">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Имя бота</Label>
              <div className="flex gap-2">
                <Input value={result.username} readOnly className="font-mono text-xs bg-muted/30" />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                API Токен
                <span className="text-xs text-muted-foreground font-normal">(показан один раз!)</span>
              </Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    value={result.token}
                    readOnly
                    className="font-mono text-xs pr-10 bg-amber-500/5 border-amber-500/20"
                  />
                </div>
                <Button
                  size="sm"
                  variant={copied ? "default" : "outline"}
                  onClick={copyToken}
                  className={`gap-2 ${copied ? "bg-emerald-600 hover:bg-emerald-500" : ""}`}
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? "Скопировано!" : "Копировать"}
                </Button>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col sm:flex-row gap-3 pt-2">
            <Button onClick={() => navigate("/bots")} variant="outline" className="w-full gap-2">
              <Bot className="w-4 h-4" />
              Список ботов
            </Button>
            <Button
              onClick={() => navigate(`/bots/${result.username}`)}
              className="w-full gap-2"
            >
              Настройки бота
              <ExternalLink className="w-4 h-4" />
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 space-y-6">
      <Button variant="ghost" onClick={() => navigate("/bots")} className="gap-2">
        <ArrowLeft className="w-4 h-4" /> Назад
      </Button>

      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/10 flex items-center justify-center">
          <Bot className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Создать бота</h1>
          <p className="text-sm text-muted-foreground">
            Новый API-аккаунт для автоматизации
          </p>
        </div>
      </div>

      <Card>
        <form onSubmit={handleSubmit}>
          <CardContent className="pt-6 space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-sm font-medium">
                  Имя пользователя <span className="text-destructive">*</span>
                </Label>
                <div className="relative">
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="my_bot"
                    required
                    className="h-10 pr-12"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-mono">
                    _bot
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Только буквы, цифры и подчёркивания. Суффикс _bot добавится автоматически.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="displayName" className="text-sm font-medium">Отображаемое имя</Label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Мой бот"
                  className="h-10"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description" className="text-sm font-medium">Описание</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Что делает этот бот..."
                  className="min-h-[80px] resize-none"
                />
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
                  Создать бота
                </>
              )}
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate("/bots")} className="w-full sm:w-auto">
              Отмена
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export default CreateBot;
