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
  Shield,
  Key,
  Trash2,
  ExternalLink,
  Calendar,
  ChevronRight,
  Search,
  Globe,
} from "lucide-react";
import { toast } from "sonner";

interface OAuthApp {
  id: string;
  name: string;
  description: string;
  client_id: string;
  is_active: boolean;
  created_at: string;
  homepage_url: string;
}

const DeveloperApps = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    api.getSession().then(({ session }) => {
      if (!session) navigate("/login?redirect=/apps");
      setSessionChecked(true);
    });
  }, []);

  const { data: apps, isLoading } = useQuery({
    queryKey: ["developer-apps"],
    queryFn: async () => {
      const res = await api.fetch("/api/v1/developer/apps");
      if (!res.ok) throw new Error("Failed to fetch apps");
      const json = await res.json();
      return json.data as OAuthApp[];
    },
    enabled: sessionChecked,
  });

  const deleteMutation = useMutation({
    mutationFn: async (appId: string) => {
      const res = await api.fetch(`/api/v1/developer/apps/${appId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete app");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["developer-apps"] });
      toast.success("Приложение удалено");
    },
    onError: (err: any) => {
      toast.error(err.message || "Ошибка при удалении");
    },
  });

  const handleDelete = (e: React.MouseEvent, appId: string) => {
    e.stopPropagation();
    if (confirm("Удалить приложение? Это действие нельзя отменить.\nВсе токены будут отозваны.")) {
      deleteMutation.mutate(appId);
    }
  };

  const filteredApps = apps?.filter(
    (app) =>
      !searchQuery ||
      app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeCount = apps?.filter((a) => a.is_active).length || 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-3">
          <PentagramLoader size="md" />
          <p className="text-sm text-muted-foreground">Загрузка приложений...</p>
        </div>
      </div>
    );
  }

  const hasApps = apps && apps.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">OAuth приложения</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Управляйте OAuth-приложениями для входа через gomo6
          </p>
        </div>
        <Button
          onClick={() => navigate("/apps/create")}
          className="gap-2 h-10 px-5 shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Создать приложение
        </Button>
      </div>

      {/* Stats */}
      {hasApps && (
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Shield className="w-4 h-4" />
            <span>
              <span className="font-semibold text-foreground">{apps.length}</span> приложений
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
      {!hasApps && (
        <Card className="border-dashed border-2">
          <CardContent className="py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/10 flex items-center justify-center mx-auto mb-5">
              <Key className="w-7 h-7 text-emerald-500/60" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Ещё нет приложений</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6 leading-relaxed">
              Создайте своё первое OAuth-приложение, чтобы начать интеграцию с gomo6.
              Ваши пользователи смогут входить через свои учётные записи gomo6.
            </p>
            <Button onClick={() => navigate("/apps/create")} className="gap-2">
              <Plus className="w-4 h-4" />
              Создать приложение
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      {hasApps && (
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск приложений..."
            className="pl-9"
          />
        </div>
      )}

      {/* App list */}
      {hasApps && filteredApps && (
        <div className="grid gap-3">
          {filteredApps.length === 0 && (
            <div className="text-center py-12">
              <Search className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Ничего не найдено</p>
            </div>
          )}
          {filteredApps.map((app) => (
            <Card
              key={app.id}
              className="group cursor-pointer hover:border-emerald-500/30 hover:shadow-md transition-all duration-200"
              onClick={() => navigate(`/apps/${app.id}`)}
            >
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-start gap-4">
                  {/* App icon */}
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/10 flex items-center justify-center flex-shrink-0">
                    <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  </div>

                  {/* App info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                        {app.name}
                      </h3>
                      <Badge
                        variant={app.is_active ? "default" : "secondary"}
                        className={`text-[10px] px-2 py-0.5 ${
                          app.is_active
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                            : ""
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full mr-1.5 inline-block ${
                            app.is_active ? "bg-emerald-500" : "bg-muted-foreground/50"
                          }`}
                        />
                        {app.is_active ? "Активно" : "Неактивно"}
                      </Badge>
                    </div>
                    {app.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                        {app.description}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-3 mt-2.5">
                      <div className="inline-flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground bg-muted/50 rounded-md px-2 py-1 border border-border/50">
                        <Key className="w-3 h-3" />
                        {app.client_id.substring(0, 24)}...
                      </div>
                      {app.homepage_url && (
                        <a
                          href={app.homepage_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Globe className="w-3 h-3" />
                          {new URL(app.homepage_url).hostname}
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Calendar className="w-3 h-3" />
                        {new Date(app.created_at).toLocaleDateString("ru-RU", {
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
                      onClick={(e) => handleDelete(e, app.id)}
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

export default DeveloperApps;
