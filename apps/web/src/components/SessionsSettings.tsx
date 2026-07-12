import { useEffect, useState, useCallback } from "react";
import { apiClient, type SessionInfo } from "@/integrations/api/client";
import { api } from "@/integrations/api/compat";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Monitor, Smartphone, Tablet, Globe, LogOut, Trash2 } from "lucide-react";

function getDeviceIcon(session: SessionInfo) {
  if (session.device_type === "mobile") return <Smartphone className="h-5 w-5" />;
  if (session.device_type === "tablet") return <Tablet className="h-5 w-5" />;
  if (session.os_name === "Unknown" && session.browser_name === "Unknown") return <Globe className="h-5 w-5" />;
  return <Monitor className="h-5 w-5" />;
}

function formatDeviceName(session: SessionInfo) {
  const parts: string[] = [];
  if (session.browser_name && session.browser_name !== "Unknown") parts.push(session.browser_name);
  if (session.os_name && session.os_name !== "Unknown") parts.push(session.os_name);
  return parts.length > 0 ? parts.join(" · ") : "Неизвестное устройство";
}

function formatTimeAgo(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);

  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin} мин. назад`;
  if (diffH < 24) return `${diffH} ч. назад`;
  if (diffD < 7) return `${diffD} дн. назад`;
  return date.toLocaleDateString("ru-RU");
}

export function SessionsSettings() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const data = await apiClient.getSessions();
      setSessions(data);
    } catch {
      toast.error("Не удалось загрузить список сессий");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleDeleteSession = async (session: SessionInfo) => {
    setActionLoading(session.id);
    try {
      const result = await apiClient.deleteSession(session.id);
      if (result.was_current) {
        // Current session was deleted — logout
        await api.auth.signOut();
        window.location.href = "/auth";
        return;
      }
      toast.success("Сессия удалена");
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
    } catch {
      toast.error("Не удалось удалить сессию");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteAllOther = async () => {
    setActionLoading("all");
    try {
      const result = await apiClient.deleteAllOtherSessions();
      toast.success(`Завершено ${result.deleted} сессий`);
      setSessions((prev) => prev.filter((s) => s.is_current));
    } catch {
      toast.error("Не удалось завершить сессии");
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <PentagramLoader size="sm" />
      </div>
    );
  }

  const otherSessions = sessions.filter((s) => !s.is_current);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Устройства и сессии</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Управляйте устройствами, на которых выполнен вход в ваш аккаунт
        </p>
      </div>

      {sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Нет активных сессий</p>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`flex items-center justify-between p-3 rounded-lg border ${
                session.is_current
                  ? "border-primary/30 bg-primary/5"
                  : "border-border bg-background/50"
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="text-muted-foreground shrink-0">
                  {getDeviceIcon(session)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">
                      {formatDeviceName(session)}
                    </span>
                    {session.is_current && (
                      <span className="text-xs bg-primary/15 text-primary px-1.5 py-0.5 rounded-full shrink-0">
                        Это устройство
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {session.ip_address && <span>{session.ip_address} · </span>}
                    <span>Вход: {formatTimeAgo(session.created_at)}</span>
                    {session.is_current && (
                      <span> · Активно: {formatTimeAgo(session.last_active_at)}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="shrink-0 ml-3">
                {session.is_current ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive gap-1"
                    onClick={() => handleDeleteSession(session)}
                    disabled={actionLoading === session.id}
                  >
                    <LogOut className="h-4 w-4" />
                    <span className="hidden sm:inline">Выйти</span>
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive gap-1"
                    onClick={() => handleDeleteSession(session)}
                    disabled={actionLoading === session.id}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="hidden sm:inline">Удалить</span>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {otherSessions.length > 0 && (
        <div className="border-t border-border pt-4">
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDeleteAllOther}
            disabled={actionLoading === "all"}
            className="gap-2"
          >
            <Trash2 className="h-4 w-4" />
            Завершить все другие сессии ({otherSessions.length})
          </Button>
        </div>
      )}
    </div>
  );
}
