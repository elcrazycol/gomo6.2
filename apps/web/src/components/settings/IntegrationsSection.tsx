import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { ExternalLink, Loader2, Music, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/integrations/api/compat";
import { Button } from "@/components/ui/button";
import { SettingBlock, SettingGroup } from "./SettingRow";

/**
 * Settings → Интеграции. Spotify connect/disconnect (the only integration),
 * plus a placeholder for the rest so the section never looks half-shipped.
 *
 * The OAuth redirect currently comes back to `/settings/integrations`, so the
 * status/message query params are handled here as well as on the old page —
 * harmless duplication that disappears when `/settings` becomes this shell.
 */

interface IntegrationsSectionProps {
  userId?: string | null;
}

export const IntegrationsSection = ({ userId }: IntegrationsSectionProps) => {
  const { t } = useTranslation();
  const location = useLocation();
  const [connected, setConnected] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const token = (await api.auth.getSession()).data.session?.access_token;
      const res = await fetch("/api/v1/integrations/spotify/status", {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = await res.json();
      setConnected(Boolean(data.connected));
      setName(data.spotify_name || null);
      setAvatar(data.spotify_avatar || null);
    } catch {
      // A missing integration must not break the settings page.
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Surface the OAuth result when Spotify bounces the user back here.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const status = params.get("spotify_status");
    const message = params.get("spotify_message");
    if (status === "success") {
      toast.success(message || t("settings.spotifyConnected"));
      window.history.replaceState({}, "", location.pathname);
    } else if (status === "error") {
      toast.error(message || t("settings.spotifyConnectError"));
      window.history.replaceState({}, "", location.pathname);
    }
  }, [location.pathname, location.search, t]);

  const connect = async () => {
    setBusy(true);
    try {
      const token = (await api.auth.getSession()).data.session?.access_token;
      const res = await fetch("/api/v1/integrations/spotify/auth-url", {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t("settings.spotifyNotConfigured"));
        return;
      }
      if (data.auth_url) {
        setAuthUrl(data.auth_url);
        window.location.href = data.auth_url;
      } else {
        toast.error(t("settings.spotifyAuthUrlError"));
      }
    } catch {
      toast.error(t("settings.spotifyConnectError"));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const token = (await api.auth.getSession()).data.session?.access_token;
      const res = await fetch("/api/v1/integrations/spotify/disconnect", {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (res.ok) {
        setConnected(false);
        setName(null);
        setAvatar(null);
        setAuthUrl(null);
        toast.success(t("settings.spotifyDisconnected"));
      } else {
        toast.error(t("settings.spotifyDisconnectError"));
      }
    } catch {
      toast.error(t("settings.spotifyDisconnectError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <SettingGroup divided={false}>
        <SettingBlock
          id="set-spotify"
          title="Spotify"
          description={
            connected
              ? t("settings.spotifyConnectedAs", { name: name || "Spotify" })
              : t("settings.spotifyDescription")
          }
          icon={Music}
        >
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : connected ? (
            <div className="space-y-3">
              {avatar && (
                <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/50 p-3">
                  <img src={avatar} alt={t("settings.spotifyAvatarAlt")} className="h-10 w-10 rounded-full" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{name || "Spotify"}</p>
                    <p className="text-xs text-muted-foreground">{t("settings.connected")}</p>
                  </div>
                </div>
              )}
              <Button variant="destructive" size="sm" className="gap-2" onClick={disconnect} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {t("settings.disconnectSpotify")}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{t("settings.spotifyDescriptionLong")}</p>
              <Button onClick={connect} disabled={busy} variant="outline" size="sm" className="gap-2">
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Music className="h-4 w-4 text-[#1DB954]" />
                )}
                {t("settings.connectSpotify")}
              </Button>
              {authUrl && <p className="text-xs text-muted-foreground">{t("settings.spotifyAuthorizeHint")}</p>}
            </div>
          )}
        </SettingBlock>
      </SettingGroup>

      <SettingGroup divided={false}>
        <SettingBlock
          id="set-integrations-soon"
          title={t("settings2.moreIntegrationsTitle")}
          description={t("settings2.moreIntegrationsDesc")}
          icon={Sparkles}
        >
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            {t("settings2.moreIntegrationsHint")}
          </p>
        </SettingBlock>
      </SettingGroup>
    </div>
  );
};
