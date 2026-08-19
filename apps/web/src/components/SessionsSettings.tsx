import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { getIntlLanguage } from "@/i18n/dateLocale";
import { apiClient, type SessionInfo } from "@/integrations/api/client";
import { api } from "@/integrations/api/compat";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PentagramLoader } from "@/components/PentagramLoader";
import {
  Monitor,
  Smartphone,
  Tablet,
  Globe,
  LogOut,
  Trash2,
  RefreshCw,
  MapPin,
} from "lucide-react";

/** Converts an ISO-3166-1 alpha-2 country code into a flag emoji. */
function flagEmoji(code: string): string {
  if (!code || code.length !== 2) return "🌐";
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

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
  return parts.length > 0 ? parts.join(" · ") : i18n.t("settings.unknownDevice");
}

function formatTimeAgo(dateStr: string) {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "—";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);

  if (diffMin < 1) return i18n.t("time.justNow");
  if (diffMin < 60) return i18n.t("time.minutesShort", { count: diffMin });
  if (diffH < 24) return i18n.t("time.hoursShort", { count: diffH });
  if (diffD < 7) return i18n.t("time.daysShort", { count: diffD });
  return date.toLocaleDateString(getIntlLanguage());
}

/** Where the device is: "RU, Москва-стиль" is overkill — flag + country + IP. */
function formatLocation(session: SessionInfo) {
  const pieces: string[] = [];
  if (session.country_name) pieces.push(session.country_name);
  if (session.ip_address) pieces.push(session.ip_address);
  return pieces.join(" · ");
}

export function SessionsSettings() {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const data = await apiClient.getSessions();
      setSessions(data);
    } catch {
      toast.error(t("settings.sessionsLoadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Keep the "online" dots honest while the page is open.
  useEffect(() => {
    const id = window.setInterval(loadSessions, 30_000);
    return () => window.clearInterval(id);
  }, [loadSessions]);

  const handleDeleteSession = async (session: SessionInfo) => {
    setActionLoading(session.id);
    try {
      const result = await apiClient.deleteSession(session.id);
      if (result.was_current) {
        // Current session was deleted — log out locally.
        await api.auth.signOut();
        window.location.href = "/auth";
        return;
      }
      toast.success(t("settings.sessionEnded"));
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
    } catch {
      toast.error(t("settings.sessionEndError"));
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteAllOther = async () => {
    setActionLoading("all");
    try {
      const result = await apiClient.deleteAllOtherSessions();
      toast.success(
        result.deleted > 0
          ? t("settings.sessionsEnded", { count: result.deleted })
          : t("settings.noOtherSessions")
      );
      setSessions((prev) => prev.filter((s) => s.is_current));
    } catch {
      toast.error(t("settings.sessionsEndError"));
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
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{t("settings.devicesAndSessions")}</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {t("settings.sessionsDescription")}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground"
          onClick={loadSessions}
          disabled={actionLoading !== null}
          aria-label={t("settings.refreshSessions")}
        >
          <RefreshCw
            className={`h-4 w-4 ${actionLoading ? "animate-spin" : ""}`}
          />
        </Button>
      </div>

      {sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("settings.noActiveSessions")}</p>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`flex items-center justify-between gap-3 p-3 rounded-lg border transition-colors ${
                session.is_current
                  ? "border-primary/30 bg-primary/5"
                  : "border-border bg-background/50 hover:border-border/80"
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="text-muted-foreground shrink-0">
                  {getDeviceIcon(session)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">
                      {formatDeviceName(session)}
                    </span>
                    {session.is_current ? (
                      <span className="text-xs bg-primary/15 text-primary px-1.5 py-0.5 rounded-full shrink-0">
                        {t("settings.thisDevice")}
                      </span>
                    ) : (
                      session.online && (
                        <span className="text-xs bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded-full shrink-0 flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          {t("settings.online")}
                        </span>
                      )
                    )}
                  </div>

                  <div className="text-xs text-muted-foreground mt-0.5 space-y-0.5">
                    <div className="flex items-center gap-1 truncate">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {flagEmoji(session.country_code)}{" "}
                        {formatLocation(session) || t("settings.locationUnknown")}
                      </span>
                    </div>
                    <div className="truncate">
                      {t("settings.loginAt")}: <span className="text-foreground/80">{formatTimeAgo(session.created_at)}</span>
                      {" · "}{t("settings.activityAt")}: <span className="text-foreground/80">{formatTimeAgo(session.last_active_at)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="shrink-0 ml-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive gap-1"
                  onClick={() => handleDeleteSession(session)}
                  disabled={actionLoading === session.id}
                >
                  {session.is_current ? (
                    <>
                      <LogOut className="h-4 w-4" />
                      <span className="hidden sm:inline">{t("nav.logout")}</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4" />
                      <span className="hidden sm:inline">{t("settings.endSession")}</span>
                    </>
                  )}
                </Button>
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
            {t("settings.endAllOtherSessions", { count: otherSessions.length })}
          </Button>
        </div>
      )}
    </div>
  );
}
