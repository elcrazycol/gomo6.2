import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { Bell, Loader2 } from "lucide-react";
import {
  enablePush,
  disablePush,
  getPushPreferences,
  isPushSupported,
  isSubscribed,
  updatePushPreferences,
  type PushPreferences,
} from "@/services/pushNotifications";

// Notification type → i18n key + (optional) emoji. Keep in sync with the
// backend's NotificationTypes() catalog (internal/push/service.go).
const TYPE_LABELS: Record<string, { key: string; icon: string }> = {
  like: { key: "notifTypes.like", icon: "👍" },
  reply: { key: "notifTypes.reply", icon: "💬" },
  wall_post: { key: "notifTypes.wallPost", icon: "📝" },
  wall_post_like: { key: "notifTypes.wallPostLike", icon: "👍" },
  wall_comment: { key: "notifTypes.wallComment", icon: "💬" },
  wall_comment_reply: { key: "notifTypes.wallCommentReply", icon: "💬" },
  wall_repost: { key: "notifTypes.wallRepost", icon: "🔁" },
  friend_request: { key: "notifTypes.friendRequest", icon: "👥" },
  friend_accepted: { key: "notifTypes.friendAccepted", icon: "👥" },
  gift_received: { key: "notifTypes.giftReceived", icon: "🎁" },
};

const NotificationsSettings = () => {
  const { t } = useTranslation();
  const [supported] = useState(isPushSupported);
  const [subscribed, setSubscribed] = useState(false);
  const [prefs, setPrefs] = useState<PushPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [p, s] = await Promise.all([getPushPreferences(), isSubscribed()]);
      setPrefs(p);
      setSubscribed(s);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (supported) {
      refresh();
    } else {
      setLoading(false);
    }
  }, [supported, refresh]);

  const availableTypes = useMemo(() => prefs?.available_types ?? [], [prefs]);

  const isTypeEnabled = useCallback(
    (type: string) => {
      if (!prefs) return true; // no row => everything enabled
      if (prefs.type_map[type] !== undefined) return prefs.type_map[type];
      return true;
    },
    [prefs]
  );

  const toggleMaster = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) {
        const ok = await enablePush();
        if (!ok) {
          toast.error(t("notifTypes.enableFailed"));
          await refresh();
          return;
        }
        toast.success(t("notifTypes.enabled"));
        await refresh();
      } else {
        const ok = await disablePush();
        if (ok) toast.success(t("notifTypes.disabled"));
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleType = async (type: string, on: boolean) => {
    if (!prefs) return;
    const next = { ...prefs.type_map, [type]: on };
    // Optimistic update for snappy UI.
    setPrefs({ ...prefs, type_map: next });
    const ok = await updatePushPreferences(next);
    if (!ok) {
      toast.error(t("notifTypes.saveError"));
      await refresh();
    }
  };

  const vapidReady = Boolean(prefs?.vapid_public_key);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="bg-card p-4 sm:p-6 border border-border">
      <div className="flex items-center gap-2 mb-4">
        <Bell className="h-5 w-5" />
        <h2 className="text-lg font-semibold">{t("notifTypes.pushTitle")}</h2>
      </div>

      {!supported ? (
        <p className="text-sm text-muted-foreground">{t("notifTypes.unsupported")}</p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("notifTypes.description")}</p>

          {/* Master switch */}
          <div className="flex items-center justify-between rounded-lg border border-border bg-background/60 px-3 py-2">
            <span className="text-sm font-medium">{t("notifTypes.enablePush")}</span>
            <Switch checked={subscribed} onCheckedChange={toggleMaster} disabled={busy} />
          </div>

          {/* VAPID not configured on the server hint */}
          {!vapidReady && (
            <p className="text-xs text-muted-foreground">{t("notifTypes.notConfigured")}</p>
          )}

          {/* Per-type toggles */}
          {subscribed && (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("notifTypes.whatReceive")}</p>
              {availableTypes.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("notifTypes.noneYet")}</p>
              ) : (
                availableTypes.map((type) => {
                  const label = TYPE_LABELS[type];
                  return (
                    <div
                      key={type}
                      className="flex items-center justify-between rounded-lg border border-border bg-background/60 px-3 py-2"
                    >
                      <span className="text-sm">
                        {label?.icon ? <span className="mr-2">{label.icon}</span> : null}
                        {label ? t(label.key) : type}
                      </span>
                      <Switch checked={isTypeEnabled(type)} onCheckedChange={(on) => toggleType(type, on)} />
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationsSettings;
