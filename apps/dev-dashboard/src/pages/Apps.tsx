import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Plus, Shield, Key, Trash2, ExternalLink, Calendar, Clock, ChevronRight } from "lucide-react";
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
    <div className="max-w-4xl mx-auto px-4 sm:px-6 space-y-8">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Мои приложения</h1>
          <p className="text-sm text-muted-foreground">
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

      {!hasApps ? (
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
      ) : (
        <div className="grid gap-4">
          {apps.map((app, index) => (
            <Card
              key={app.id}
              className="group cursor-pointer hover:border-emerald-500/30 hover:shadow-md transition-all duration-200"
              onClick={() => navigate(`/apps/${app.id}`)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-lg group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                        {app.name}
                      </CardTitle>
                      {app.description && (
                        <CardDescription className="mt-1 line-clamp-2">
                          {app.description}
                        </CardDescription>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge
                      variant={app.is_active ? "default" : "secondary"}
                      className={`text-[10px] px-2 py-0.5 ${
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
                    <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-emerald-500/60 transition-all group-hover:translate-x-0.5" />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pb-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="inline-flex items-center gap-1.5 text-xs font-mono text-muted-foreground bg-muted/50 rounded-md px-2.5 py-1 border border-border/50">
                    <Key className="w-3 h-3" />
                    {app.client_id.substring(0, 20)}...
                  </div>
                  {app.homepage_url && (
                    <a
                      href={app.homepage_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Сайт
                    </a>
                  )}
                </div>
              </CardContent>
              <CardFooter className="flex justify-between pt-0">
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {new Date(app.created_at).toLocaleDateString("ru-RU", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all"
                  onClick={(e) => handleDelete(e, app.id)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default DeveloperApps;
