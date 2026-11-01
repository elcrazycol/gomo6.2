import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  supportsWebAuthn,
  prepareRegistrationOptions,
  serializeRegistration,
  describeUserAgent,
  reauthWithPasskey,
} from "@/services/passkeys";
import { apiClient } from "@/integrations/api/client";
import { getIntlLanguage } from "@/i18n/dateLocale";
import { Plus, Trash2, Shield, Smartphone, Monitor, Fingerprint } from "lucide-react";

interface PasskeyInfo {
  credential_id: string;
  name: string;
  attestation_type: string;
  created_at: string;
  last_used_at?: string;
  user_agent?: string;
}

/** Hard cap enforced by the backend (register/finish rejects above it). */
const MAX_PASSKEYS = 10;

interface PasskeysSettingsProps {
  /** Hide the component's own title/description when the section provides them. */
  withHeader?: boolean;
}

export function PasskeysSettings({ withHeader = true }: PasskeysSettingsProps = {}) {
  const { t } = useTranslation();
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  // Name-your-passkey step: adding opens a small inline form first, so every
  // key gets a recognizable name ("iPhone 15", "YubiKey") instead of piling
  // up as identical "Passkey" rows.
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState("");
  // Re-auth gate for deletion: the backend requires the current password
  // (when set) and a 2FA code (when enabled) — a stolen session alone must
  // not strip the account's passkeys.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [delPassword, setDelPassword] = useState("");
  const [delCode, setDelCode] = useState("");
  const [deleting, setDeleting] = useState(false);

  const loadPasskeys = async () => {
    try {
      const list = await apiClient.listPasskeys();
      setPasskeys(list);
    } catch {
      // silently fail - passkeys may not be supported yet
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPasskeys();
  }, []);

  const handleAddPasskey = async () => {
    if (!supportsWebAuthn()) {
      toast.error(t("settings.passkeysUnsupported"));
      return;
    }
    if (passkeys.length >= MAX_PASSKEYS) {
      toast.error(t("settings.passkeyLimitReached"));
      return;
    }
    // First click opens the naming step; the ceremony starts on confirm.
    if (!naming) {
      setNaming(true);
      return;
    }
    const name = newName.trim() || t("settings.passkeyDefaultName");

    setAdding(true);
    try {
      // Step 1: get registration options from server
      const optionsData = await apiClient.beginPasskeyRegistration();
      const wrapped = optionsData.options as Record<string, unknown>;
      if (!wrapped) throw new Error(t("settings.passkeysNoOptions"));
      // go-webauthn nests options under {publicKey: {challenge, user, ...}}
      const options = wrapped.publicKey as Record<string, unknown>;
      if (!options) throw new Error(t("settings.passkeysNoOptions"));

      // Step 2: create credential in browser
      const publicKey = prepareRegistrationOptions(options);
      const credential = await navigator.credentials.create({
        publicKey,
      });
      if (!credential) throw new Error(t("settings.passkeysCreateError"));

      // Step 3: serialize and send to server
      const serialized = serializeRegistration(credential as PublicKeyCredential);
      await apiClient.finishPasskeyRegistration(name, serialized);

      toast.success(t("settings.passkeyAdded"));
      setNaming(false);
      setNewName("");
      loadPasskeys();
    } catch (err) {
      const msg = (err as Error).message || t("settings.passkeyAddError");
      toast.error(msg);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = (credId: string) => {
    // Open the re-auth confirmation; the actual DELETE fires on confirm.
    setPendingDelete(credId);
    setDelPassword("");
    setDelCode("");
  };

  const confirmDelete = async (reauthToken?: string) => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await apiClient.deletePasskey(pendingDelete, {
        ...(delPassword ? { current_password: delPassword } : {}),
        ...(delCode.trim() ? { code: delCode.trim() } : {}),
        ...(reauthToken ? { reauth_token: reauthToken } : {}),
      });
      toast.success(t("settings.passkeyRemoved"));
      setPendingDelete(null);
      loadPasskeys();
    } catch {
      toast.error(t("settings.passkeyRemoveError"));
    } finally {
      setDeleting(false);
    }
  };

  const confirmDeleteWithPasskey = async () => {
    try {
      const token = await reauthWithPasskey(
        () => apiClient.beginPasskeyReauth(),
        (cred) => apiClient.finishPasskeyReauth(cred),
      );
      await confirmDelete(token);
    } catch (err) {
      const msg = (err as Error).message || t("settings.passkeyRemoveError");
      if (msg === "passkeysUnsupported") toast.error(t("settings.passkeysUnsupported"));
      else if (msg !== "passkeyReauthCancelled") toast.error(t("settings.passkeyReauthFailed"));
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString(getIntlLanguage(), {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  const addButton = (
    <Button
      onClick={handleAddPasskey}
      disabled={adding || !supportsWebAuthn()}
      variant="outline"
      size="sm"
      className="gap-1"
    >
      <Plus className="h-4 w-4" />
      {adding ? t("settings.passkeyAdding") : t("settings.addPasskey")}
    </Button>
  );

  return (
    <div className="space-y-4">
      {withHeader ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            <div>
              <h3 className="text-lg font-semibold">Passkeys</h3>
              <p className="text-sm text-muted-foreground">
                {t("settings.passkeysDescription")}
              </p>
            </div>
          </div>
          {addButton}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {passkeys.length > 0 ? t("settings2.passkeysCount", { count: passkeys.length }) : ""}
          </p>
          {addButton}
        </div>
      )}

      {naming && (
        <div className="rounded-lg border bg-background/50 p-3 space-y-2">
          <Label htmlFor="pk-new-name" className="text-xs">
            {t("settings.passkeyNameLabel")}
          </Label>
          <div className="flex gap-2">
            <Input
              id="pk-new-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("settings.passkeyNamePlaceholder")}
              maxLength={64}
            />
            <Button size="sm" onClick={handleAddPasskey} disabled={adding}>
              {adding ? t("settings.passkeyAdding") : t("settings.passkeyCreate")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setNaming(false); setNewName(""); }}
              disabled={adding}
            >
              {t("common.cancel")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("settings.passkeyNameHint", { count: passkeys.length, max: MAX_PASSKEYS })}
          </p>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : passkeys.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {t("settings.passkeyCount", { count: passkeys.length, max: MAX_PASSKEYS })}
          </p>
          {passkeys.map((pk) => {
            const device = describeUserAgent(pk.user_agent);
            const isMobile = pk.user_agent ? /iPhone|iPad|Android|Mobile/i.test(pk.user_agent) : false;
            return (
              <div
                key={pk.credential_id}
                className="flex items-center justify-between p-3 border rounded-lg bg-background/50"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {device ? (
                    isMobile ? <Smartphone className="h-8 w-8 shrink-0 text-primary/60" /> : <Monitor className="h-8 w-8 shrink-0 text-primary/60" />
                  ) : (
                    <Shield className="h-8 w-8 shrink-0 text-primary/60" />
                  )}
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{pk.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {device ?? t("settings.unknownDevice")}
                      {` · ${t("settings.passkeyAddedOn")}: ${formatDate(pk.created_at)}`}
                      {pk.last_used_at &&
                        ` · ${t("settings.passkeyLastUsed")}: ${formatDate(pk.last_used_at)}`}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(pk.credential_id)}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("settings.noPasskeysSaved")}
        </p>
      )}

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("settings.passkeyRemoveTitle")}</DialogTitle>
            <DialogDescription>{t("settings.passkeyRemoveReauth")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pk-del-password">{t("settings.currentPassword")}</Label>
              <Input
                id="pk-del-password"
                type="password"
                autoComplete="current-password"
                value={delPassword}
                onChange={(e) => setDelPassword(e.target.value)}
                placeholder={t("settings.currentPasswordPlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pk-del-code">{t("settings.twoFACode")}</Label>
              <Input
                id="pk-del-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={delCode}
                onChange={(e) => setDelCode(e.target.value)}
                placeholder={t("settings.twoFACodePlaceholder")}
              />
              <p className="text-xs text-muted-foreground">{t("settings.passkeyRemoveReauthHint")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">{t("settings.orUse")}</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={confirmDeleteWithPasskey}
            disabled={deleting}
          >
            <Fingerprint className="h-4 w-4" />
            {t("settings.usePasskeyInstead")}
          </Button>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)} disabled={deleting}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => confirmDelete()} disabled={deleting}>
              {deleting ? t("common.loading") : t("settings.passkeyRemoveConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
