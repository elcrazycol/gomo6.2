import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Plus, ExternalLink, Key, Trash2, BookOpen } from "lucide-react";
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

  // Check auth
  useState(() => {
    api.getSession().then(({ session }) => {
      if (!session) navigate("/login?redirect=/apps");
      setSessionChecked(true);
    });
  });

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <PentagramLoader size="md" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Мои приложения</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Управляйте OAuth-приложениями для входа через gomo6
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.open("http://localhost:3001/oauth", "_blank")}>
            <BookOpen className="w-4 h-4 mr-2" />
            Документация
          </Button>
          <Button onClick={() => navigate("/apps/create")}>
            <Plus className="w-4 h-4 mr-2" />
            Создать
          </Button>
        </div>
      </div>

      {!apps || apps.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Key className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Нет приложений</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Создайте своё первое OAuth-приложение для интеграции с gomo6
            </p>
            <Button onClick={() => navigate("/apps/create")}>
              Создать приложение
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {apps.map((app) => (
            <Card key={app.id} className="hover:border-primary/40 transition-colors cursor-pointer" onClick={() => navigate(`/apps/${app.id}`)}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{app.name}</CardTitle>
                    {app.description && (
                      <CardDescription className="mt-1">{app.description}</CardDescription>
                    )}
                  </div>
                  <Badge variant={app.is_active ? "default" : "secondary"}>
                    {app.is_active ? "Активно" : "Неактивно"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pb-3">
                <div className="text-xs font-mono text-muted-foreground bg-muted rounded px-2 py-1 inline-block">
                  Client ID: {app.client_id.substring(0, 16)}...
                </div>
              </CardContent>
              <CardFooter className="flex justify-between pt-0">
                <div className="text-xs text-muted-foreground">
                  Создано: {new Date(app.created_at).toLocaleDateString()}
                </div>
                <div className="flex gap-2">
                  {app.homepage_url && (
                    <Button size="sm" variant="ghost" asChild>
                      <a href={app.homepage_url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("Удалить приложение? Это действие нельзя отменить.")) {
                        deleteMutation.mutate(app.id);
                      }
                    }}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default DeveloperApps;
