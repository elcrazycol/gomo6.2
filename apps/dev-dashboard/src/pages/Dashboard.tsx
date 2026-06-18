import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { getSavedUser } from "@/lib/oauth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PentagramLoader } from "@/components/PentagramLoader";
import {
  Shield,
  Gift,
  ExternalLink,
  BookOpen,
  ArrowRight,
} from "lucide-react";

const Dashboard = () => {
  const navigate = useNavigate();
  const user = getSavedUser();

  const { data: apps, isLoading: appsLoading } = useQuery({
    queryKey: ["developer-apps"],
    queryFn: async () => {
      const res = await api.fetch("/api/v1/developer/apps");
      if (!res.ok) throw new Error("Failed to fetch apps");
      const json = await res.json();
      return json.data;
    },
  });

  const { data: gifts, isLoading: giftsLoading } = useQuery({
    queryKey: ["admin-gifts"],
    queryFn: async () => {
      const res = await api.fetch("/api/v1/admin/gifts");
      if (!res.ok) throw new Error("Failed to fetch gifts");
      const json = await res.json();
      return json.data;
    },
  });

  const isLoading = appsLoading || giftsLoading;

  const stats = [
    {
      label: "Приложения",
      value: apps?.length ?? 0,
      icon: Shield,
      color: "emerald",
      onClick: () => navigate("/apps"),
    },
    {
      label: "Подарки",
      value: gifts?.length ?? 0,
      icon: Gift,
      color: "violet",
      onClick: () => navigate("/gifts"),
    },
  ];

  const quickActions = [
    {
      title: "OAuth приложения",
      description: "Создавайте и управляйте OAuth-приложениями для интеграции с gomo6",
      icon: Shield,
      path: "/apps",
      color: "emerald",
    },
    {
      title: "Управление подарками",
      description: "Создавайте, редактируйте и настраивайте каталог подарков",
      icon: Gift,
      path: "/gifts",
      color: "violet",
    },
    {
      title: "Документация API",
      description: "Подробная документация по OAuth 2.0 API gomo6",
      icon: BookOpen,
      external: true,
      url: `//docs.${window.location.hostname.replace(/^(docs|dev|www)\./, "")}/oauth`,
      color: "blue",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {user?.preferred_username || user?.name || "Разработчик"}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Панель управления разработчика gomo6
        </p>
      </div>

      {/* Stats */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <PentagramLoader size="md" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <button
                key={stat.label}
                onClick={stat.onClick}
                className="group text-left"
              >
                <Card className="hover:border-emerald-500/30 hover:shadow-md transition-all duration-200 cursor-pointer">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">{stat.label}</p>
                        <p className="text-3xl font-bold mt-1">{stat.value}</p>
                      </div>
                      <div
                        className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                          stat.color === "emerald"
                            ? "bg-emerald-500/10"
                            : stat.color === "violet"
                            ? "bg-violet-500/10"
                            : "bg-blue-500/10"
                        }`}
                      >
                        <Icon
                          className={`w-6 h-6 ${
                            stat.color === "emerald"
                              ? "text-emerald-500"
                              : stat.color === "violet"
                              ? "text-violet-500"
                              : "text-blue-500"
                          }`}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-1 mt-3 text-xs text-muted-foreground group-hover:text-emerald-500 transition-colors">
                      Подробнее
                      <ArrowRight className="w-3 h-3" />
                    </div>
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>
      )}

      {/* Quick actions */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Быстрый доступ</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {quickActions.map((action) => {
            const Icon = action.icon;
            const colorClasses =
              action.color === "emerald"
                ? "bg-emerald-500/10 text-emerald-500 group-hover:bg-emerald-500/15"
                : action.color === "violet"
                ? "bg-violet-500/10 text-violet-500 group-hover:bg-violet-500/15"
                : "bg-blue-500/10 text-blue-500 group-hover:bg-blue-500/15";

            return (
              <button
                key={action.title}
                onClick={() =>
                  action.external
                    ? window.open(action.url, "_blank")
                    : navigate(action.path!)
                }
                className="group text-left"
              >
                <Card className="hover:shadow-md transition-all duration-200 h-full">
                  <CardContent className="p-5 flex flex-col h-full">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${colorClasses}`}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="mt-4 flex-1">
                      <h3 className="font-semibold text-sm">{action.title}</h3>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        {action.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 mt-4 text-xs text-muted-foreground group-hover:text-emerald-500 transition-colors">
                      {action.external ? (
                        <>
                          Открыть
                          <ExternalLink className="w-3 h-3" />
                        </>
                      ) : (
                        <>
                          Перейти
                          <ArrowRight className="w-3 h-3" />
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>
      </div>

      {/* Recent apps */}
      {!appsLoading && apps && apps.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Последние приложения</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/apps")}
              className="gap-1.5 text-xs"
            >
              Все приложения
              <ArrowRight className="w-3 h-3" />
            </Button>
          </div>
          <div className="grid gap-3">
            {apps.slice(0, 3).map((app: any) => (
              <button
                key={app.id}
                onClick={() => navigate(`/apps/${app.id}`)}
                className="group text-left"
              >
                <Card className="hover:border-emerald-500/30 transition-all duration-200">
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/10 flex items-center justify-center flex-shrink-0">
                      <Shield className="w-5 h-5 text-emerald-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm group-hover:text-emerald-500 transition-colors truncate">
                        {app.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {app.description || "OAuth приложение"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          app.is_active ? "bg-emerald-500" : "bg-muted-foreground/30"
                        }`}
                      />
                      <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-emerald-500 transition-all group-hover:translate-x-0.5" />
                    </div>
                  </CardContent>
                </Card>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
