import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PentagramLoader } from "@/components/PentagramLoader";

const Messages = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetUserId = searchParams.get("user");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const startHandoff = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        navigate("/auth");
        return;
      }

      try {
        const response = await fetch("/api/messenger/handoff", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          credentials: "include",
          body: JSON.stringify({
            targetUserId,
          }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || "Не удалось открыть мессенджер");
        }

        const payload = await response.json();
        window.location.assign(payload.redirectTo);
      } catch (handoffError) {
        const message = handoffError instanceof Error ? handoffError.message : "Не удалось открыть мессенджер";
        console.error("[messenger-handoff] failed", message);
        setFailed(true);
      }
    };

    startHandoff();
  }, [navigate, targetUserId]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="w-full max-w-lg p-8 text-center">
        <div className="flex justify-center">
          <PentagramLoader size="md" />
        </div>
        {failed ? <p className="mt-4 text-sm text-muted-foreground"> </p> : null}
      </div>
    </div>
  );
};

export default Messages;
