import { useState, useEffect, useCallback } from "react";
import { Lock, ShieldCheck, X } from "lucide-react";
import { isConversationVerified } from "@/services/e2e/e2eSafetyNumber";
import { SafetyNumberDialog } from "./SafetyNumberDialog";

interface E2EBannerProps {
  isInitializing?: boolean;
  conversationId?: string;
  remoteUserId?: string;
  remoteUsername?: string;
}

function getDismissKey(conversationId: string) {
  return `e2e_banner_dismissed_${conversationId}`;
}

export function E2EBanner({
  isInitializing = false,
  conversationId,
  remoteUserId,
  remoteUsername,
}: E2EBannerProps) {
  const [verified, setVerified] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showSafetyNumber, setShowSafetyNumber] = useState(false);

  useEffect(() => {
    if (!conversationId) return;
    setDismissed(localStorage.getItem(getDismissKey(conversationId)) === "1");
    isConversationVerified(conversationId).then(setVerified);
  }, [conversationId]);

  const handleDismiss = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (conversationId) {
      localStorage.setItem(getDismissKey(conversationId), "1");
    }
    setDismissed(true);
  }, [conversationId]);

  if (dismissed) return null;

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
          <span className="flex-1">Установка зашифрованного соединения...</span>
        ) : verified ? (
          <span className="flex-1">Зашифровано и верифицировано</span>
        ) : (
          <span className="flex-1">
            Зашифровано E2E.{" "}
            <span className="underline">Нажмите чтобы сверить safety number</span>
          </span>
        )}
        <button
          type="button"
          onClick={handleDismiss}
          className="flex-shrink-0 p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          aria-label="Закрыть"
        >
          <X className="w-3 h-3" />
        </button>
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
