import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  supportsWebAuthn,
  prepareRegistrationOptions,
  serializeRegistration,
} from "@/services/passkeys";
import { apiClient } from "@/integrations/api/client";
import { getIntlLanguage } from "@/i18n/dateLocale";
import { Plus, Trash2, Shield } from "lucide-react";

interface PasskeyInfo {
  credential_id: string;
  name: string;
  attestation_type: string;
  created_at: string;
  last_used_at?: string;
}

export function PasskeysSettings() {
  const { t } = useTranslation();
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

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
      await apiClient.finishPasskeyRegistration(
        (optionsData.name as string) || "Passkey",
        serialized
      );

      toast.success(t("settings.passkeyAdded"));
      loadPasskeys();
    } catch (err) {
      const msg = (err as Error).message || t("settings.passkeyAddError");
      toast.error(msg);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (credId: string) => {
    try {
      await apiClient.deletePasskey(credId);
      toast.success(t("settings.passkeyRemoved"));
      loadPasskeys();
    } catch {
      toast.error(t("settings.passkeyRemoveError"));
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

  return (
    <div className="space-y-4">
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
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : passkeys.length > 0 ? (
        <div className="space-y-2">
          {passkeys.map((pk) => (
            <div
              key={pk.credential_id}
              className="flex items-center justify-between p-3 border rounded-lg bg-background/50"
            >
              <div className="flex items-center gap-3">
                <Shield className="h-8 w-8 text-primary/60" />
                <div>
                  <div className="font-medium text-sm">{pk.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {pk.attestation_type} · {formatDate(pk.created_at)}
                    {pk.last_used_at &&
                      ` · ${t("settings.passkeyLastUsed")}: ${formatDate(pk.last_used_at)}`}
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleDelete(pk.credential_id)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("settings.noPasskeysSaved")}
        </p>
      )}
    </div>
  );
}
