import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { SETTING_BLOCK_CHROME, SettingBlock, SettingGroup, SettingRow } from "@/components/settings/SettingRow";
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
  message: { key: "notifTypes.message", icon: "💬" },
};

/**
 * Settings → Уведомления. Push subscription master switch + the per-type
 * toggles, in the shared settings row language (the old page rendered its own
 * card with hand-rolled rows).
 */
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const vapidReady = Boolean(prefs?.vapid_public_key);

  return (
    <div className="space-y-5">
      <SettingGroup divided={false}>
        <SettingBlock
          id="set-push"
          title={t("notifTypes.pushTitle")}
          description={t("notifTypes.description")}
          icon={Bell}
        >
          {!supported ? (
            <p className="text-sm text-muted-foreground">{t("notifTypes.unsupported")}</p>
          ) : (
            <>
              <SettingRow
                className={SETTING_BLOCK_CHROME}
                title={t("notifTypes.enablePush")}
                description={!vapidReady ? t("notifTypes.notConfigured") : undefined}
              >
                <Switch
                  checked={subscribed}
                  onCheckedChange={toggleMaster}
                  disabled={busy}
                  aria-label={t("notifTypes.enablePush")}
                />
              </SettingRow>
              {subscribed && (
                <p className="mt-3 text-xs leading-snug text-muted-foreground">{t("settings2.pushDeviceHint")}</p>
              )}
            </>
          )}
        </SettingBlock>
      </SettingGroup>

      {supported && subscribed && (
        <SettingGroup divided={false}>
          <SettingBlock
            id="set-push-types"
            title={t("notifTypes.whatReceive")}
            description={t("settings2.pushTypesDesc")}
            icon={Bell}
          >
            {availableTypes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("notifTypes.noneYet")}</p>
            ) : (
              <div className="divide-y divide-border/50">
                {availableTypes.map((type) => {
                  const label = TYPE_LABELS[type];
                  const title = label ? t(label.key) : type;
                  return (
                    <SettingRow key={type} title={label?.icon ? `${label.icon} ${title}` : title}>
                      <Switch
                        checked={isTypeEnabled(type)}
                        onCheckedChange={(on) => toggleType(type, on)}
                        aria-label={title}
                      />
                    </SettingRow>
                  );
                })}
              </div>
            )}
          </SettingBlock>
        </SettingGroup>
      )}
    </div>
  );
};

export default NotificationsSettings;
