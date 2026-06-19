import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PentagramLoader } from "@/components/PentagramLoader";
import {
  Plus,
  Bot,
  Trash2,
  Calendar,
  ChevronRight,
  Search,
} from "lucide-react";
import { toast } from "sonner";

interface BotItem {
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

const Bots = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    api.getSession().then(({ session }) => {
      if (!session) navigate("/login?redirect=/bots");
      setSessionChecked(true);
    });
  }, []);

  const { data: bots, isLoading } = useQuery({
    queryKey: ["bots"],
    queryFn: async () => {
      const res = await api.fetch("/api/v1/bots");
      if (!res.ok) throw new Error("Failed to fetch bots");
      const json = await res.json();
      return json.data as BotItem[];
    },
    enabled: sessionChecked,
  });

  const deleteMutation = useMutation({
    mutationFn: async (botId: string) => {
      const res = await api.fetch(`/api/v1/bots/${botId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete bot");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      toast.success("Бот удалён");
    },
    onError: (err: any) => {
      toast.error(err.message || "Ошибка при удалении");
    },
  });

  const handleDelete = (e: React.MouseEvent, botId: string) => {
    e.stopPropagation();
    if (confirm("Удалить бота? Это действие нельзя отменить.")) {
      deleteMutation.mutate(botId);
    }
  };

  const filteredBots = bots?.filter(
    (bot) =>
      !searchQuery ||
      bot.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      bot.display_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeCount = bots?.filter((b) => b.is_active).length || 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-3">
          <PentagramLoader size="md" />
          <p className="text-sm text-muted-foreground">Загрузка ботов...</p>
        </div>
      </div>
    );
  }

  const hasBots = bots && bots.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Боты</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Создавайте API-аккаунты для автоматизации
          </p>
        </div>
        <Button
          onClick={() => navigate("/bots/create")}
          className="gap-2 h-10 px-5 shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Создать бота
        </Button>
      </div>

      {/* Stats */}
      {hasBots && (
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Bot className="w-4 h-4" />
            <span>
              <span className="font-semibold text-foreground">{bots.length}</span> ботов
            </span>
          </div>
          <span className="text-border">·</span>
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>
              <span className="font-semibold text-foreground">{activeCount}</span> активных
            </span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!hasBots && (
        <Card className="border-dashed border-2">
          <CardContent className="py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/10 flex items-center justify-center mx-auto mb-5">
              <Bot className="w-7 h-7 text-emerald-500/60" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Ещё нет ботов</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6 leading-relaxed">
              Создайте API-бота для автоматизации действий на платформе.
              Бот получит токен для доступа к API.
            </p>
            <Button onClick={() => navigate("/bots/create")} className="gap-2">
              <Plus className="w-4 h-4" />
              Создать бота
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      {hasBots && (
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск ботов..."
            className="pl-9"
          />
        </div>
      )}

      {/* Bot list */}
      {hasBots && filteredBots && (
        <div className="grid gap-3">
          {filteredBots.length === 0 && (
            <div className="text-center py-12">
              <Search className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Ничего не найдено</p>
            </div>
          )}
          {filteredBots.map((bot) => (
            <Card
              key={bot.id}
              className="group cursor-pointer hover:border-emerald-500/30 hover:shadow-md transition-all duration-200"
              onClick={() => navigate(`/bots/${bot.id}`)}
            >
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-start gap-4">
                  {/* Bot icon */}
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/10 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  </div>

                  {/* Bot info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                        {bot.username}
                      </h3>
                      <Badge
                        variant={bot.is_active ? "default" : "secondary"}
                        className={`text-[10px] px-2 py-0.5 ${
                          bot.is_active
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                            : ""
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full mr-1.5 inline-block ${
                            bot.is_active ? "bg-emerald-500" : "bg-muted-foreground/50"
                          }`}
                        />
                        {bot.is_active ? "Активен" : "Неактивен"}
                      </Badge>
                    </div>
                    {bot.display_name && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {bot.display_name}
                      </p>
                    )}
                    {bot.description && (
                      <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">
                        {bot.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-2.5">
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Calendar className="w-3 h-3" />
                        {new Date(bot.created_at).toLocaleDateString("ru-RU", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all h-8 w-8 p-0"
                      onClick={(e) => handleDelete(e, bot.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                    <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-emerald-500/60 transition-all group-hover:translate-x-0.5" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default Bots;
