import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Shield, ShieldCheck, ShieldAlert, RefreshCw } from "lucide-react";
import {
  generateSafetyNumber,
  isConversationVerified,
  markConversationVerified,
  removeVerification,
  hashSafetyNumber,
  type SafetyNumber,
} from "@/services/e2e/e2eSafetyNumber";

interface SafetyNumberDialogProps {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  remoteUserId: string;
  remoteUsername: string;
}

export function SafetyNumberDialog({
  open,
  onClose,
  conversationId,
  remoteUserId,
  remoteUsername,
}: SafetyNumberDialogProps) {
  const [safetyNumber, setSafetyNumber] = useState<SafetyNumber | null>(null);
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      const [sn, isVerified] = await Promise.all([
        generateSafetyNumber(
          // Get current user's ID from JWT payload (field is "user_id")
          (() => {
            try {
              const payload = JSON.parse(atob(localStorage.getItem("auth_token")?.split(".")[1] || "{}"));
              return payload.user_id || "";
            } catch { return ""; }
          })(),
          remoteUserId
        ),
        isConversationVerified(conversationId),
      ]);
      setSafetyNumber(sn);
      setVerified(isVerified);
      setLoading(false);
    })();
  }, [open, conversationId, remoteUserId]);

  const handleVerify = async () => {
    if (!safetyNumber) return;
    const hash = await hashSafetyNumber(safetyNumber.numeric);
    await markConversationVerified(conversationId, remoteUserId, hash);
    setVerified(true);
    setComparing(false);
  };

  const handleRemoveVerification = async () => {
    await removeVerification(conversationId);
    setVerified(false);
  };

  const handleRefresh = async () => {
    setLoading(true);
    const sn = await generateSafetyNumber(
      JSON.parse(
        atob(localStorage.getItem("auth_token")?.split(".")[1] || "{}")
      ).sub || "",
      remoteUserId
    );
    setSafetyNumber(sn);
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {verified ? (
              <ShieldCheck className="w-5 h-5 text-green-500" />
            ) : (
              <Shield className="w-5 h-5 text-muted-foreground" />
            )}
            {verified ? "Чат верифицирован" : "Safety Number"}
          </DialogTitle>
          <DialogDescription>
            {verified
              ? `Вы подтвердили, что говорите с @${remoteUsername}.`
              : `Сравните этот код с @${remoteUsername}, чтобы убедиться, что нет перехвата.`}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : safetyNumber ? (
          <div className="space-y-4">
            {/* Emoji fingerprint — visual comparison */}
            <div className="flex justify-center gap-2 text-2xl py-4">
              {safetyNumber.emoji.map((e, i) => (
                <span key={i} className="select-all">
                  {e}
                </span>
              ))}
            </div>

            {/* Numeric groups — precise comparison */}
            <div className="grid grid-cols-3 gap-2 text-center font-mono text-sm">
              {safetyNumber.groups.map((group, i) => (
                <div
                  key={i}
                  className="bg-muted rounded px-2 py-1 select-all"
                >
                  {group}
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 pt-2">
              {verified ? (
                <>
                  <div className="flex items-center gap-2 text-green-600 text-sm justify-center">
                    <ShieldCheck className="w-4 h-4" />
                    Верифицировано
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRemoveVerification}
                    className="text-destructive"
                  >
                    <ShieldAlert className="w-4 h-4 mr-1" />
                    Снять верификацию
                  </Button>
                </>
              ) : comparing ? (
                <>
                  <p className="text-xs text-muted-foreground text-center">
                    Убедитесь, что код совпадает с тем, что видит{" "}
                    @{remoteUsername}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="default"
                      size="sm"
                      className="flex-1"
                      onClick={handleVerify}
                    >
                      Коды совпадают
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setComparing(false)}
                    >
                      Отмена
                    </Button>
                  </div>
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setComparing(true)}
                >
                  <Shield className="w-4 h-4 mr-1" />
                  Сверить Safety Number
                </Button>
              )}
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs"
              onClick={handleRefresh}
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              Обновить код
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            Не удалось сгенерировать safety number. Убедитесь, что ключи
            собеседника зарегистрированы.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
