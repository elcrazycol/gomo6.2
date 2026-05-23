import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/api/client_simple";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, Plus, Activity, Trash2, Edit, Power, Code, Settings, FileText, ChevronLeft, Save, Terminal, AlertCircle, Info, AlertTriangle, RefreshCw } from "lucide-react";
import Editor from "@monaco-editor/react";

interface BotData {
  id: string;
  username: string;
  display_name: string;
  description: string;
  lua_code: string;
  is_active: boolean;
  created_at: string;
}

interface BotLog {
  id: string;
  bot_id: string;
  level: "info" | "warn" | "error";
  message: string;
  created_at: string;
}

const Bots = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [bots, setBots] = useState<BotData[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingBot, setEditingBot] = useState<BotData | null>(null);
  const [logs, setLogs] = useState<BotLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [formData, setFormData] = useState({
    username: "",
    display_name: "",
    description: "",
    lua_code: `function onThreadPost(post)
  bot.log("info", "Получен пост: " .. post.id)

  local content = post.content or ""
  if content:match("привет") then
    bot.sendThreadPost(post.thread_id, "Привет! 👋")
  end
end`,
  });

  const loadBots = useCallback(async (userId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch("/api/v1/bots", {
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setBots(data || []);
      }
    } catch (error) {
      console.error("Failed to load bots:", error);
    }
  }, []);

  const checkAuth = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/auth");
      return;
    }

    setUser(session.user);
    await loadBots(session.user.id);
    setLoading(false);
  }, [navigate, loadBots]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const createBot = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch("/api/v1/bots", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        toast.success("Бот создан!");
        setCreateDialogOpen(false);
        setFormData({
          username: "",
          display_name: "",
          description: "",
          lua_code: formData.lua_code,
        });
        await loadBots(session.user.id);
      } else {
        const error = await response.json();
        toast.error(error.error || "Ошибка создания бота");
      }
    } catch (error) {
      toast.error("Ошибка создания бота");
    }
  };

  const updateBot = async () => {
    if (!editingBot) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch(`/api/v1/bots/${editingBot.id}`, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          display_name: formData.display_name,
          description: formData.description,
          lua_code: formData.lua_code,
        }),
      });

      if (response.ok) {
        toast.success("Бот обновлён!");
        setEditingBot(null);
        await loadBots(session.user.id);
      } else {
        const error = await response.json();
        toast.error(error.error || "Ошибка обновления бота");
      }
    } catch (error) {
      toast.error("Ошибка обновления бота");
    }
  };

  const toggleBot = async (botId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch(`/api/v1/bots/${botId}/toggle`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        toast.success("Статус бота изменён");
        await loadBots(session.user.id);
      }
    } catch (error) {
      toast.error("Ошибка изменения статуса");
    }
  };

  const deleteBot = async (botId: string) => {
    if (!confirm("Удалить бота?")) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch(`/api/v1/bots/${botId}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        toast.success("Бот удалён");
        await loadBots(session.user.id);
      }
    } catch (error) {
      toast.error("Ошибка удаления бота");
    }
  };

  const loadLogs = useCallback(async (botId: string) => {
    try {
      setLogsLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      console.log("[Logs] Fetching logs for bot:", botId);
      const response = await fetch(`/api/v1/bots/${botId}/logs`, {
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
        },
      });

      console.log("[Logs] Response status:", response.status);
      const text = await response.text();
      console.log("[Logs] Raw response text:", text);

      if (response.ok) {
        const data = text ? JSON.parse(text) : [];
        console.log("[Logs] Parsed data:", data);
        console.log("[Logs] Number of logs:", data?.length || 0);
        setLogs(data || []);
      } else {
        console.error("[Logs] Failed to fetch logs:", response.statusText);
      }
    } catch (error) {
      console.error("[Logs] Failed to load logs:", error);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (editingBot && showLogs) {
      loadLogs(editingBot.id);
      const interval = setInterval(() => loadLogs(editingBot.id), 5000);
      return () => clearInterval(interval);
    }
  }, [editingBot, showLogs, loadLogs]);

  useEffect(() => {
    if (showLogs && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, showLogs]);

  const clearLogs = async (botId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch(`/api/v1/bots/${botId}/logs`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        toast.success("Логи очищены");
        setLogs([]);
      }
    } catch (error) {
      toast.error("Ошибка очистки логов");
    }
  };

  const openEditDialog = (bot: BotData) => {
    setEditingBot(bot);
    setFormData({
      username: bot.username,
      display_name: bot.display_name,
      description: bot.description,
      lua_code: bot.lua_code,
    });
    setShowLogs(false);
    setLogs([]);
  };

  const getLogIcon = (level: string) => {
    switch (level) {
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case "warn":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Info className="h-4 w-4 text-blue-500" />;
    }
  };

  const getLogColor = (level: string) => {
    switch (level) {
      case "error":
        return "text-red-500";
      case "warn":
        return "text-yellow-500";
      default:
        return "text-blue-500";
    }
  };

  if (loading) {
    return <PentagramLoader />;
  }

  // Режим редактирования бота
  if (editingBot) {
    return (
      <div className="min-h-screen bg-background relative">
        <div className="border-b">
          <div className="container flex h-14 items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditingBot(null);
                setShowLogs(false);
                setLogs([]);
              }}
            >
              <ChevronLeft className="mr-2 h-4 w-4" />
              Назад
            </Button>
            <div className="flex-1">
              <h1 className="text-lg font-semibold">{editingBot.display_name}</h1>
              <p className="text-xs text-muted-foreground">@{editingBot.username}</p>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setShowLogs(!showLogs);
                if (!showLogs) {
                  loadLogs(editingBot.id);
                }
              }}
            >
              <Terminal className="mr-2 h-4 w-4" />
              {showLogs ? "Скрыть логи" : "Показать логи"}
            </Button>
            <Button onClick={updateBot}>
              <Save className="mr-2 h-4 w-4" />
              Сохранить
            </Button>
          </div>
        </div>

        <div className="container py-6">
          <Tabs defaultValue="code" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="code">
                    <Code className="mr-2 h-4 w-4" />
                    Код
                  </TabsTrigger>
                  <TabsTrigger value="settings">
                    <Settings className="mr-2 h-4 w-4" />
                    Настройки
                  </TabsTrigger>
                  <TabsTrigger value="docs">
                    <FileText className="mr-2 h-4 w-4" />
                    Документация
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="code" className="mt-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>Lua код бота</CardTitle>
                      <CardDescription>
                        Редактируйте код с подсветкой синтаксиса и автодополнением
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="border rounded-lg overflow-hidden">
                        <Editor
                          height="600px"
                          defaultLanguage="lua"
                          value={formData.lua_code}
                          onChange={(value) => setFormData({ ...formData, lua_code: value || "" })}
                          theme="vs-dark"
                          options={{
                            minimap: { enabled: true },
                            fontSize: 14,
                            lineNumbers: "on",
                            roundedSelection: false,
                            scrollBeyondLastLine: false,
                            automaticLayout: true,
                            tabSize: 2,
                            wordWrap: "on",
                          }}
                          onMount={(editor) => {
                            // Фикс ошибки Monaco Editor
                            setTimeout(() => {
                              editor.layout();
                            }, 100);
                          }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

            <TabsContent value="settings" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Настройки бота</CardTitle>
                  <CardDescription>
                    Основная информация о боте
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="display_name">Отображаемое имя</Label>
                    <Input
                      id="display_name"
                      value={formData.display_name}
                      onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="description">Описание</Label>
                    <Textarea
                      id="description"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      rows={4}
                    />
                  </div>
                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <p className="font-medium">Статус бота</p>
                      <p className="text-sm text-muted-foreground">
                        {editingBot.is_active ? "Бот активен и обрабатывает события" : "Бот выключен"}
                      </p>
                    </div>
                    <Button
                      variant={editingBot.is_active ? "destructive" : "default"}
                      onClick={() => toggleBot(editingBot.id)}
                    >
                      <Power className="mr-2 h-4 w-4" />
                      {editingBot.is_active ? "Выключить" : "Включить"}
                    </Button>
                  </div>
                  <div className="pt-4 border-t">
                    <Button
                      variant="destructive"
                      onClick={() => {
                        deleteBot(editingBot.id);
                        setEditingBot(null);
                      }}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Удалить бота
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="docs" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>API документация</CardTitle>
                  <CardDescription>
                    Доступные функции и события для ботов
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold mb-2">События</h3>
                    <div className="space-y-3">
                      <div className="p-3 border rounded-lg">
                        <code className="text-sm font-mono">function onThreadPost(post)</code>
                        <p className="text-sm text-muted-foreground mt-1">
                          Вызывается при создании нового поста в треде
                        </p>
                      </div>
                      <div className="p-3 border rounded-lg">
                        <code className="text-sm font-mono">function onThreadCreate(thread)</code>
                        <p className="text-sm text-muted-foreground mt-1">
                          Вызывается при создании нового треда
                        </p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-semibold mb-2">Функции бота</h3>
                    <div className="space-y-3">
                      <div className="p-3 border rounded-lg">
                        <code className="text-sm font-mono">bot.sendThreadPost(thread_id, content)</code>
                        <p className="text-sm text-muted-foreground mt-1">
                          Отправить пост в тред
                        </p>
                      </div>
                      <div className="p-3 border rounded-lg">
                        <code className="text-sm font-mono">bot.log(level, message)</code>
                        <p className="text-sm text-muted-foreground mt-1">
                          Записать лог (уровни: "info", "warn", "error")
                        </p>
                      </div>
                      <div className="p-3 border rounded-lg">
                        <code className="text-sm font-mono">bot.getThread(thread_id)</code>
                        <p className="text-sm text-muted-foreground mt-1">
                          Получить информацию о треде
                        </p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-semibold mb-2">Пример</h3>
                    <pre className="p-4 bg-muted rounded-lg text-sm overflow-x-auto">
{`function onThreadPost(post)
  bot.log("info", "Новый пост: " .. post.id)

  local content = post.content or ""

  -- Ответ на приветствие
  if content:match("привет") then
    bot.sendThreadPost(post.thread_id, "Привет! 👋")
  end

  -- Команда /help
  if content:match("^/help") then
    bot.sendThreadPost(post.thread_id,
      "Доступные команды:\\n/help - эта справка")
  end
end`}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Выдвижная панель логов */}
        <div
          className={`fixed top-0 right-0 h-full w-[500px] bg-background border-l shadow-2xl transform transition-transform duration-300 ease-in-out z-50 ${
            showLogs ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <Card className="h-full flex flex-col rounded-none border-0">
            <CardHeader className="flex-shrink-0 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Terminal className="h-5 w-5" />
                    Логи бота
                  </CardTitle>
                  <CardDescription>
                    Обновляется каждые 3 секунды
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadLogs(editingBot.id)}
                    disabled={logsLoading}
                  >
                    <RefreshCw className={`h-4 w-4 ${logsLoading ? "animate-spin" : ""}`} />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => clearLogs(editingBot.id)}
                  >
                    Очистить
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full">
                <div className="p-4 space-y-2 font-mono text-sm">
                  {logs.length === 0 ? (
                    <div className="text-center text-muted-foreground py-8">
                      <Terminal className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>Логов пока нет</p>
                    </div>
                  ) : (
                    logs.map((log) => (
                      <div
                        key={log.id}
                        className="flex gap-2 p-2 rounded hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex-shrink-0 mt-0.5">
                          {getLogIcon(log.level)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 mb-1">
                            <span className={`font-semibold uppercase text-xs ${getLogColor(log.level)}`}>
                              {log.level}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(log.created_at).toLocaleTimeString("ru-RU")}
                            </span>
                          </div>
                          <div className="text-foreground break-words whitespace-pre-wrap">
                            {log.message}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={logsEndRef} />
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Overlay для закрытия панели */}
        {showLogs && (
          <div
            className="fixed inset-0 bg-black/20 z-40 transition-opacity duration-300"
            onClick={() => setShowLogs(false)}
          />
        )}
      </div>
    );
  }

  // Список ботов
  return (
    <div className="min-h-screen bg-background">
      <main className="container py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">Мои боты</h1>
            <p className="text-muted-foreground">Управление ботами на Lua</p>
          </div>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Создать бота
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Создать бота</DialogTitle>
              </DialogHeader>
              <Tabs defaultValue="basic" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="basic">Основное</TabsTrigger>
                  <TabsTrigger value="code">Код</TabsTrigger>
                </TabsList>

                <TabsContent value="basic" className="space-y-4 mt-4">
                  <div>
                    <Label htmlFor="username">Username (латиница)</Label>
                    <Input
                      id="username"
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      placeholder="mybot"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Будет создан как: {formData.username || "mybot"}.bot
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="display_name">Отображаемое имя</Label>
                    <Input
                      id="display_name"
                      value={formData.display_name}
                      onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                      placeholder="Мой бот"
                    />
                  </div>
                  <div>
                    <Label htmlFor="description">Описание</Label>
                    <Textarea
                      id="description"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Описание бота"
                      rows={4}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="code" className="mt-4">
                  <div>
                    <Label>Lua код</Label>
                    <div className="mt-2 border rounded-lg overflow-hidden">
                      <Editor
                        height="400px"
                        defaultLanguage="lua"
                        value={formData.lua_code}
                        onChange={(value) => setFormData({ ...formData, lua_code: value || "" })}
                        theme="vs-dark"
                        options={{
                          minimap: { enabled: false },
                          fontSize: 13,
                          lineNumbers: "on",
                          scrollBeyondLastLine: false,
                          automaticLayout: true,
                          tabSize: 2,
                        }}
                        onMount={(editor) => {
                          setTimeout(() => editor.layout(), 100);
                        }}
                      />
                    </div>
                  </div>
                </TabsContent>
              </Tabs>

              <Button onClick={createBot} className="w-full mt-4">
                Создать
              </Button>
            </DialogContent>
          </Dialog>
        </div>

        {bots.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Bot className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-4">У вас пока нет ботов</p>
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Создать первого бота
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {bots.map((bot) => (
              <Card key={bot.id} className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => openEditDialog(bot)}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="flex items-center gap-2">
                        {bot.display_name}
                        {bot.is_active ? (
                          <Badge variant="default" className="text-xs">
                            <Activity className="mr-1 h-3 w-3" />
                            Активен
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            Выключен
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription>@{bot.username}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                    {bot.description || "Без описания"}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleBot(bot.id);
                      }}
                    >
                      <Power className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditDialog(bot);
                      }}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteBot(bot.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default Bots;
