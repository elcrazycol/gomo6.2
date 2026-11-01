import { useState } from "react";
import { Fingerprint } from "lucide-react";
import { useTranslation } from "react-i18next";
import { reauthWithPasskey } from "@/services/passkeys";
import { apiClient } from "@/integrations/api/client";
import { useNavigate } from "react-router-dom";
import { KeyRound, Loader2, MonitorSmartphone, Scale, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/integrations/api/compat";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { openCookieSettings } from "@/lib/cookieConsent";
import { fillLegalText } from "@/lib/legal/config";
import { LEGAL_DOCUMENTS, LEGAL_DOC_ORDER } from "@/lib/legal/documents";
import { PasskeysSettings } from "@/components/PasskeysSettings";
import { SessionsSettings } from "@/components/SessionsSettings";
import { TwoFASection } from "@/components/TwoFASection";
import { SettingGroup, SettingRow } from "./SettingRow";

/**
 * Settings → Безопасность.
 *
 * Re-homes the account-security controls that used to live in the "Аккаунт"
 * tab (password dialog, 2FA, passkeys, devices) under one roof, in the same
 * grouped-card language as the rest of the page. The heavy lifting stays in the
 * dedicated components — they are embedded with `withHeader={false}` so the
 * section owns the headings.
 */

const PASSWORD_MIN_LENGTH = 6;

interface SecuritySectionProps {
  userId: string;
}

export const SecuritySection = ({ userId }: SecuritySectionProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changing, setChanging] = useState(false);
  // Fresh passkey ceremony as a substitute for the current password.
  const [reauthToken, setReauthToken] = useState<string | null>(null);

  const closeDialog = () => {
    setPasswordOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setReauthToken(null);
  };

  const handleReauthWithPasskey = async () => {
    try {
      const token = await reauthWithPasskey(
        () => apiClient.beginPasskeyReauth(),
        (cred) => apiClient.finishPasskeyReauth(cred),
      );
      setReauthToken(token);
      toast.success(t("settings.reauthConfirmed"));
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "passkeysUnsupported") toast.error(t("settings.passkeysUnsupported"));
      else if (msg && msg !== "passkeyReauthCancelled") toast.error(t("settings.passkeyReauthFailed"));
    }
  };

  const handlePasswordChange = async (event: React.FormEvent) => {
    event.preventDefault();
    if ((!currentPassword && !reauthToken) || !newPassword || !confirmPassword) {
      toast.error(t("settings.passwordFieldsRequired"));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t("settings.passwordsMismatch"));
      return;
    }
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      toast.error(t("settings.passwordMinLength"));
      return;
    }

    setChanging(true);
    try {
      const { error } = await api.auth.updateUser({
        password: newPassword,
        ...(reauthToken ? { reauth_token: reauthToken } : { current_password: currentPassword }),
      });
      if (error) throw error;
      toast.success(t("settings.passwordChanged"));
      closeDialog();
    } catch (error) {
      const message =
        error && typeof (error as { message?: string }).message === "string"
          ? (error as { message: string }).message
          : t("settings.unknownError");
      toast.error(t("settings.passwordChangeError", { error: message }));
    } finally {
      setChanging(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* ── Пароль ────────────────────────────────────────────────────── */}
      <SettingGroup divided={false}>
        <SettingRow
          id="set-password"
          icon={KeyRound}
          title={t("settings.password")}
          description={t("settings.passwordDescription")}
        >
          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setPasswordOpen(true)}>
            <KeyRound className="h-4 w-4" />
            {t("settings.changePassword")}
          </Button>
        </SettingRow>
      </SettingGroup>

      {/* ── Двухфакторная аутентификация ──────────────────────────────── */}
      <SettingGroup
        id="set-two-factor"
        title={t("settings.twoFactor")}
        description={t("settings.twoFactorDescription")}
        divided={false}
      >
        <div className="px-4 py-4 sm:px-5">
          <TwoFASection userId={userId} />
        </div>
      </SettingGroup>

      {/* ── Passkeys ──────────────────────────────────────────────────── */}
      <SettingGroup
        id="set-passkeys"
        title={
          <span className="inline-flex items-center gap-2">
            <Fingerprint className="h-4 w-4 text-muted-foreground" />
            {t("settings2.passkeysTitle")}
          </span>
        }
        description={t("settings.passkeysDescription")}
        divided={false}
      >
        <div className="px-4 pb-4 sm:px-5">
          <PasskeysSettings withHeader={false} />
        </div>
      </SettingGroup>

      {/* ── Устройства и сессии ───────────────────────────────────────── */}
      <SettingGroup
        id="set-sessions"
        title={
          <span className="inline-flex items-center gap-2">
            <MonitorSmartphone className="h-4 w-4 text-muted-foreground" />
            {t("settings.devicesAndSessions")}
          </span>
        }
        description={t("settings.sessionsDescription")}
        divided={false}
      >
        <div className="px-4 pb-4 sm:px-5">
          <SessionsSettings withHeader={false} />
        </div>
      </SettingGroup>

      {/* ── Правовая информация ───────────────────────────────────────── */}
      <SettingGroup
        id="set-legal"
        title={
          <span className="inline-flex items-center gap-2">
            <Scale className="h-4 w-4 text-muted-foreground" />
            {t("settings2.legalTitle")}
          </span>
        }
        description={t("settings2.legalDesc")}
      >
        {LEGAL_DOC_ORDER.map((id) => {
          const doc = LEGAL_DOCUMENTS[id];
          return (
            <SettingRow
              key={id}
              title={fillLegalText(doc.title)}
              description={fillLegalText(doc.summary)}
              onClick={() => navigate(`/legal/${id}`)}
            />
          );
        })}
        <SettingRow title={t("settings2.legalCookieTitle")} description={t("settings2.legalCookieDesc")}>
          <Button type="button" variant="outline" size="sm" onClick={openCookieSettings}>
            {t("settings2.legalCookieAction")}
          </Button>
        </SettingRow>
      </SettingGroup>

      {/* Hint: security is server-enforced. */}
      <p className="flex items-start gap-2 px-1 text-xs leading-snug text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t("settings2.securityHint")}
      </p>

      <Dialog open={passwordOpen} onOpenChange={(open) => (open ? setPasswordOpen(true) : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.changePassword")}</DialogTitle>
            <DialogDescription>{t("settings.passwordDescription")}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handlePasswordChange}>
            {reauthToken ? (
              <p className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                <Fingerprint className="h-4 w-4 text-primary" />
                {t("settings.reauthConfirmed")}
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="current-password">{t("auth.currentPassword")}</Label>
                  <Input
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-2"
                  onClick={handleReauthWithPasskey}
                >
                  <Fingerprint className="h-4 w-4" />
                  {t("settings.usePasskeyInstead")}
                </Button>
              </>
            )}
            <div className="space-y-2">
              <Label htmlFor="new-password">{t("auth.newPassword")}</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">{t("settings.confirmNewPassword")}</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </div>
            <Button type="submit" className="w-full gap-2" disabled={changing}>
              {changing && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("settings.changePassword")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
