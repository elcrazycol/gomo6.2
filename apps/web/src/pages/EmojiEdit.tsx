import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Settings, ArrowLeft, Search, Edit, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Emoji {
  id: string;
  name: string;
  code: string;
  image_url: string;
  group_id: string;
  emoji_groups: {
    name: string;
  };
  created_at: string;
}

interface EmojiGroup {
  id: string;
  name: string;
}

const EmojiEdit = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [currentUserUsername, setCurrentUserUsername] = useState("");
  const [currentUserColor, setCurrentUserColor] = useState("");

  const [emojis, setEmojis] = useState<Emoji[]>([]);
  const [groups, setGroups] = useState<EmojiGroup[]>([]);
  const [filteredEmojis, setFilteredEmojis] = useState<Emoji[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    const { data: { user } } = await api.auth.getUser();

    if (!user) {
      navigate("/auth");
      return;
    }

    setUser(user);

    const { data: roles } = await api
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const isMod = roles?.some(r => r.role === 'moderator' || r.role === 'admin');

    if (!isMod) {
      toast.error("У вас нет доступа к этой странице");
      navigate("/");
      return;
    }

    setIsModerator(true);

    // Load current user profile and color
    const { data: profile } = await api
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .single();

    if (profile) {
      setCurrentUserUsername(profile.username);
    }

    // Load current user color
    const { data: achievements } = await api
      .from("user_achievements")
      .select(`
        achievement_id,
        achievements (
          reward_type,
          reward_value
        )
      `)
      .eq("user_id", user.id);

    if (achievements) {
      const colorRewards = achievements
        .filter((a: any) => a.achievements?.reward_type === "username_color")
        .map((a: any) => a.achievements.reward_value);

      const priority = ['purple', 'gold', 'orange', 'red', 'blue', 'green', 'yellow', 'cyan'];
      for (const p of priority) {
        if (colorRewards.includes(p)) {
          setCurrentUserColor(p);
          break;
        }
      }
    }
  }, [navigate]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const loadEmojis = async () => {
    try {
      const { data, error } = await api
        .from('emojis')
        .select(`
          id,
          name,
          code,
          image_url,
          group_id,
          created_at,
          emoji_groups (
            name
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setEmojis(data || []);
    } catch (error) {
      console.error('Error loading emojis:', error);
      toast.error('Ошибка загрузки эмодзи');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isModerator) {
      loadEmojis();
      loadGroups();
    }
     
  }, [isModerator]);

  const loadGroups = async () => {
    try {
      const { data, error } = await api
        .from('emoji_groups')
        .select('id, name')
        .order('name');

      if (error) throw error;

      setGroups(data || []);
    } catch (error) {
      console.error('Error loading groups:', error);
    }
  };

  const filterEmojis = useCallback(() => {
    let filtered = emojis;

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(emoji =>
        emoji.name.toLowerCase().includes(query) ||
        emoji.code.toLowerCase().includes(query)
      );
    }

    // Filter by group
    if (selectedGroup !== "all") {
      filtered = filtered.filter(emoji => emoji.group_id === selectedGroup);
    }

    setFilteredEmojis(filtered);
  }, [emojis, searchQuery, selectedGroup]);

  useEffect(() => {
    filterEmojis();
  }, [filterEmojis]);

  const handleDeleteEmoji = async (emojiId: string, emojiCode: string) => {
    try {
      const { error } = await api
        .from('emojis')
        .delete()
        .eq('id', emojiId);

      if (error) throw error;

      // Remove from local state
      setEmojis(prev => prev.filter(e => e.id !== emojiId));

      toast.success(`Эмодзи ${emojiCode} удален`);
    } catch (error) {
      console.error('Error deleting emoji:', error);
      toast.error('Ошибка удаления эмодзи');
    }
  };

  if (!isModerator) return null;

  if (loading) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Загрузка эмодзи...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background min-h-screen">
      <header className="bg-board-header text-board-header-foreground p-3 border-b border-border">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-4">
            <Link to="/moderation/emojis">
              <Button variant="ghost" size="sm" className="p-2 hover:bg-white/20 hover:text-white transition-colors">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <h1 className="text-xl font-bold">Редактирование эмодзи</h1>
          </div>
          <div className="flex gap-1 sm:gap-2 items-center flex-shrink-0">
            <Link to="/settings" className="hidden sm:block">
              <Button variant="ghost" size="sm" className="p-2 hover:bg-white/20 hover:text-white transition-colors">
                <Settings className="h-4 w-4" />
              </Button>
            </Link>
            {user && <NotificationBell userId={user.id} />}
            {user && <ChatIcon userId={user.id} />}
            <div className="hidden sm:flex gap-1 sm:gap-2 items-center ml-2">
              {user && (
                <ProfileHoverCard userId={user.id}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`text-sm sm:text-base hover:bg-white/20 hover:text-white transition-colors drop-shadow-[0_0_1px_rgba(255,255,255,0.8)] ${
                      currentUserColor === 'purple' ? 'text-purple-500' :
                      currentUserColor === 'gold' ? 'text-yellow-500' :
                      currentUserColor === 'orange' ? 'text-orange-500' :
                      currentUserColor === 'red' ? 'text-red-500' :
                      currentUserColor === 'blue' ? 'text-blue-500' :
                      currentUserColor === 'green' ? 'text-green-500' :
                      currentUserColor === 'yellow' ? 'text-yellow-400' :
                      currentUserColor === 'cyan' ? 'text-cyan-500' :
                      'text-quote'
                    }`}
                    onClick={() => navigate(`/profile/${user.id}`)}
                  >
                    {currentUserUsername || 'Профиль'}
                  </Button>
                </ProfileHoverCard>
              )}
            </div>
            {user && (
              <MobileMenu
                user={user}
                isModerator={true}
              />
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">Редактирование эмодзи</h1>
          <p className="text-muted-foreground">Выберите эмодзи для редактирования</p>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Поиск по названию или коду..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <Select value={selectedGroup} onValueChange={setSelectedGroup}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Все группы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все группы</SelectItem>
              {groups.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Stats */}
        <div className="mb-6 text-sm text-muted-foreground">
          Показано {filteredEmojis.length} из {emojis.length} эмодзи
        </div>

        {/* Emoji Grid */}
        {filteredEmojis.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-lg">
              {searchQuery || selectedGroup !== "all"
                ? "Эмодзи не найдены"
                : "Нет созданных эмодзи"
              }
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {filteredEmojis.map((emoji) => (
              <Card key={emoji.id} className="group hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex flex-col items-center space-y-3">
                    {/* Emoji Image */}
                    <div className="relative">
                      <img
                        src={emoji.image_url}
                        alt={emoji.name}
                        className="w-16 h-16 object-contain border border-border rounded"
                      />
                    </div>

                    {/* Emoji Info */}
                    <div className="text-center space-y-1 w-full">
                      <p className="font-medium text-sm truncate" title={emoji.name}>
                        {emoji.name}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">
                        :{emoji.code}:
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {emoji.emoji_groups?.name}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 w-full">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 text-xs"
                        onClick={() => navigate(`/moderation/emojis/edit/${emoji.id}`)}
                      >
                        <Edit className="h-3 w-3 mr-1" />
                        Изменить
                      </Button>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Удалить эмодзи</AlertDialogTitle>
                            <AlertDialogDescription>
                              Вы уверены, что хотите удалить эмодзи "{emoji.name}" с кодом :{emoji.code}:?
                              Это действие нельзя отменить.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Отмена</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDeleteEmoji(emoji.id, emoji.code)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Удалить
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
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

export default EmojiEdit;