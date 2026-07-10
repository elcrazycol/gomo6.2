import { useState, useEffect } from "react";
import { Lock, ShieldCheck, Shield } from "lucide-react";
import { isConversationVerified } from "@/services/e2e/e2eSafetyNumber";
import { SafetyNumberDialog } from "./SafetyNumberDialog";

interface E2EBannerProps {
  isInitializing?: boolean;
  conversationId?: string;
  remoteUserId?: string;
  remoteUsername?: string;
}

export function E2EBanner({
  isInitializing = false,
  conversationId,
  remoteUserId,
  remoteUsername,
}: E2EBannerProps) {
  const [verified, setVerified] = useState(false);
  const [showSafetyNumber, setShowSafetyNumber] = useState(false);

  useEffect(() => {
    if (!conversationId) return;
    isConversationVerified(conversationId).then(setVerified);
  }, [conversationId]);

  return (
    <>
      <div
        className={`flex items-center gap-2 px-4 py-2 border-b text-xs cursor-pointer transition-colors ${
          verified
            ? "bg-green-500/10 border-green-500/20 text-green-600 hover:bg-green-500/15"
            : "bg-amber-500/10 border-amber-500/20 text-amber-600 hover:bg-amber-500/15"
        }`}
        onClick={() => !isInitializing && setShowSafetyNumber(true)}
      >
        {verified ? (
          <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />
        ) : (
          <Lock className="w-3.5 h-3.5 flex-shrink-0" />
        )}
        {isInitializing ? (
          <span>Установка зашифрованного соединения...</span>
        ) : verified ? (
          <span>Зашифровано и верифицировано</span>
        ) : (
          <span>
            Зашифровано E2E.{" "}
            <span className="underline">Нажмите чтобы сверить safety number</span>
          </span>
        )}
      </div>

      {conversationId && remoteUserId && remoteUsername && (
        <SafetyNumberDialog
          open={showSafetyNumber}
          onClose={() => setShowSafetyNumber(false)}
          conversationId={conversationId}
          remoteUserId={remoteUserId}
          remoteUsername={remoteUsername}
        />
      )}
    </>
  );
}
