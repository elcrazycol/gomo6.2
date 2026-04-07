import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/api/client_simple";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { HeaderUsername } from "@/components/HeaderUsername";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Bot, Plus, Code, Activity, Trash2, Edit, Power } from "lucide-react";

interface BotData {
  id: string;
  username: string;
  display_name: string;
  description: string;
  lua_code: string;
  is_active: boolean;
  created_at: string;
}

const Bots = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");
  const [bots, setBots] = useState<BotData[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedBot, setSelectedBot] = useState<BotData | null>(null);
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

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/auth");
      return;
    }

    setUser(session.user);

    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", session.user.id)
      .single();

    if (profile) {
      setCurrentUserUsername(profile.username);
    }

    const { data: achievements } = await supabase
      .from("user_achievements")
      .select(`
        achievement_id,
        achievements (
          reward_type,
          reward_value
        )
      `)
      .eq("user_id", session.user.id);

    if (achievements) {
      const colorAchievement = achievements.find(
        (a: any) => a.achievements?.reward_type === "username_color"
      );
      if (colorAchievement) {
        setCurrentUserColor(colorAchievement.achievements.reward_value);
      }
    }

    await loadBots(session.user.id);
    setLoading(false);
  };

  const loadBots = async (userId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch("http://localhost:8080/api/v1/bots", {
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
  };

  const createBot = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch("http://localhost:8080/api/v1/bots", {
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
    if (!selectedBot) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch(`http://localhost:8080/api/v1/bots/${selectedBot.id}`, {
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
        setEditDialogOpen(false);
        setSelectedBot(null);
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

      const response = await fetch(`http://localhost:8080/api/v1/bots/${botId}/toggle`, {
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

      const response = await fetch(`http://localhost:8080/api/v1/bots/${botId}`, {
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

  const openEditDialog = (bot: BotData) => {
    setSelectedBot(bot);
    setFormData({
      username: bot.username,
      display_name: bot.display_name,
      description: bot.description,
      lua_code: bot.lua_code,
    });
    setEditDialogOpen(true);
  };

  if (loading) {
    return <PentagramLoader />;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center">
          <div className="mr-4 flex">
            <Link to="/" className="mr-6 flex items-center space-x-2">
              <span className="font-bold">gomo6</span>
            </Link>
          </div>
          <div className="flex flex-1 items-center justify-between space-x-2 md:justify-end">
            <nav className="flex items-center space-x-2">
              {user && (
                <>
                  <NotificationBell />
                  <ChatIcon />
                  <ProfileHoverCard username={currentUserUsername}>
                    <Link to={`/u/${currentUserUsername}`}>
                      <HeaderUsername username={currentUserUsername} color={currentUserColor} />
                    </Link>
                  </ProfileHoverCard>
                  <Link to="/settings">
                    <Button variant="ghost" size="icon">
                      <Bot className="h-5 w-5" />
                    </Button>
                  </Link>
                </>
              )}
              <MobileMenu />
            </nav>
          </div>
        </div>
      </header>

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
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Создать бота</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
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
                    rows={3}
                  />
                </div>
                <div>
                  <Label htmlFor="lua_code">Lua код</Label>
                  <Textarea
                    id="lua_code"
                    value={formData.lua_code}
                    onChange={(e) => setFormData({ ...formData, lua_code: e.target.value })}
                    className="font-mono text-sm"
                    rows={15}
                  />
                </div>
                <Button onClick={createBot} className="w-full">
                  Создать
                </Button>
              </div>
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
              <Card key={bot.id}>
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
                      onClick={() => toggleBot(bot.id)}
                    >
                      <Power className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditDialog(bot)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => deleteBot(bot.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Редактировать бота</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit_display_name">Отображаемое имя</Label>
                <Input
                  id="edit_display_name"
                  value={formData.display_name}
                  onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit_description">Описание</Label>
                <Textarea
                  id="edit_description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                />
              </div>
              <div>
                <Label htmlFor="edit_lua_code">Lua код</Label>
                <Textarea
                  id="edit_lua_code"
                  value={formData.lua_code}
                  onChange={(e) => setFormData({ ...formData, lua_code: e.target.value })}
                  className="font-mono text-sm"
                  rows={15}
                />
              </div>
              <Button onClick={updateBot} className="w-full">
                Сохранить
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
};

export default Bots;
