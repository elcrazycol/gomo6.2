import { useState, useEffect } from "react";
import { api } from "@/integrations/api/compat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface TwoFASectionProps {
  userId: string;
}

export const TwoFASection = ({ userId }: TwoFASectionProps) => {
  const [isEnabled, setIsEnabled] = useState(false);
  const [hasPendingSecret, setHasPendingSecret] = useState(false);
  const [loading, setLoading] = useState(true);
  const [setupUri, setSetupUri] = useState("");
  const [setupSecret, setSetupSecret] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [showRecoveryCodes, setShowRecoveryCodes] = useState(false);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const { data, error } = await api.auth.get2FAStatus();
      if (error) throw error;
      if (data) {
        setIsEnabled(data.enabled);
        setHasPendingSecret(data.has_pending_secret);
      }
    } catch (error: unknown) {
      console.error("Failed to load 2FA status:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async () => {
    try {
      const { data, error } = await api.auth.setupTOTP();
      if (error) throw error;
      if (data) {
        setSetupUri(data.uri);
        setSetupSecret(data.secret);
        setHasPendingSecret(true);
        setShowRecoveryCodes(false);
      }
    } catch (error: unknown) {
      toast.error("Ошибка настройки 2FA: " + error.message);
    }
  };

  const handleVerifyAndEnable = async () => {
    if (verifyCode.length < 6) {
      toast.error("Введите 6-значный код из аутентификатора");
      return;
    }

    setVerifying(true);
    try {
      const { data, error } = await api.auth.verifyAndEnableTOTP(verifyCode);
      if (error) throw error;
      if (data) {
        setIsEnabled(true);
        setHasPendingSecret(false);
        setSetupUri("");
        setSetupSecret("");
        setVerifyCode("");
        setRecoveryCodes(data.recovery_codes || null);
        setShowRecoveryCodes(true);
        toast.success("2FA успешно включена!");
      }
    } catch (error: unknown) {
      toast.error("Неверный код. Попробуйте снова.");
    } finally {
      setVerifying(false);
    }
  };

  const handleDisable = async () => {
    if (!confirm("Вы уверены, что хотите отключить 2FA? Это снизит безопасность вашего аккаунта.")) {
      return;
    }

    try {
      await api.auth.disableTOTP();
      setIsEnabled(false);
      setHasPendingSecret(false);
      setSetupUri("");
      setSetupSecret("");
      setRecoveryCodes(null);
      setShowRecoveryCodes(false);
      toast.success("2FA отключена");
    } catch (error: unknown) {
      toast.error("Ошибка отключения 2FA: " + error.message);
    }
  };

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground py-2">
        Загрузка статуса 2FA...
      </div>
    );
  }

  // Show recovery codes after setup
  if (showRecoveryCodes && recoveryCodes && recoveryCodes.length > 0) {
    return (
      <div className="space-y-3">
        <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 p-3 rounded">
          <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-2">
            ⚠️ Сохраните коды восстановления!
          </p>
          <p className="text-xs text-yellow-700 dark:text-yellow-300 mb-3">
            Если вы потеряете доступ к аутентификатору, эти коды можно использовать для входа.
            Каждый код можно использовать только один раз.
          </p>
          <div className="space-y-1">
            {recoveryCodes.map((code, i) => (
              <div key={i} className="font-mono text-sm bg-white dark:bg-black px-2 py-1 rounded border border-yellow-300 dark:border-yellow-700">
                {code}
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              navigator.clipboard.writeText(recoveryCodes.join("\n"));
              toast.success("Коды скопированы в буфер обмена");
            }}
          >
            Скопировать все
          </Button>
          <Button
            variant="default"
            size="sm"
            className="mt-3 ml-2"
            onClick={() => setShowRecoveryCodes(false)}
          >
            Закрыть
          </Button>
        </div>
      </div>
    );
  }

  // Show setup UI (pending secret but not yet verified)
  if (hasPendingSecret && setupUri) {
    return (
      <div className="space-y-4">
        <div className="bg-card border border-border p-3 rounded">
          <p className="text-sm font-medium mb-2">Настройка 2FA</p>
          <p className="text-xs text-muted-foreground mb-3">
            1. Откройте приложение-аутентификатор (Google Authenticator, Authy и т.д.)
            <br />
            2. Отсканируйте QR-код или введите секретный ключ вручную
          </p>

          {/* QR Code */}
          <div className="flex justify-center mb-3">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(setupUri)}`}
              alt="QR Code for 2FA"
              className="border border-border rounded"
              style={{ width: 180, height: 180 }}
            />
          </div>

          {/* Manual entry */}
          <div className="mb-3">
            <Label className="text-xs">Секретный ключ (для ручного ввода)</Label>
            <Input
              value={setupSecret}
              readOnly
              className="font-mono text-xs mt-1"
              onClick={(e) => {
                (e.target as HTMLInputElement).select();
                navigator.clipboard.writeText(setupSecret);
                toast.success("Секрет скопирован");
              }}
            />
          </div>

          {/* Verify code */}
          <div className="space-y-2">
            <Label htmlFor="verify-totp" className="text-xs">
              3. Введите 6-значный код из аутентификатора для подтверждения
            </Label>
            <div className="flex gap-2">
              <Input
                id="verify-totp"
                type="text"
                inputMode="numeric"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                placeholder="000000"
                className="text-center text-lg tracking-widest font-mono"
                maxLength={6}
                disabled={verifying}
              />
              <Button
                onClick={handleVerifyAndEnable}
                disabled={verifying || verifyCode.length < 6}
              >
                {verifying ? "Проверка..." : "Подтвердить"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Main state: enabled or disabled
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">
            {isEnabled ? "✅ 2FA включена" : "❌ 2FA отключена"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {isEnabled
              ? "При входе потребуется код из аутентификатора"
              : "Добавьте дополнительный уровень защиты"}
          </p>
        </div>
        <Button
          variant={isEnabled ? "destructive" : "default"}
          size="sm"
          onClick={isEnabled ? handleDisable : handleSetup}
        >
          {isEnabled ? "Отключить" : "Включить 2FA"}
        </Button>
      </div>
    </div>
  );
};

export default TwoFASection;