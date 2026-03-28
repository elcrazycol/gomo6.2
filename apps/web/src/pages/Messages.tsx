import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PentagramLoader } from "@/components/PentagramLoader";

const Messages = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetUserId = searchParams.get("user");
  const [status, setStatus] = useState("Проверяем сессию...");
  const [error, setError] = useState<string | null>(null);

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
        setStatus("Подготавливаем защищенный переход в мессенджер...");

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
        setStatus("Перенаправляем в E2EE-мессенджер...");
        window.location.assign(payload.redirectTo);
      } catch (handoffError) {
        const message = handoffError instanceof Error ? handoffError.message : "Не удалось открыть мессенджер";
        setError(message);
      }
    };

    startHandoff();
  }, [navigate, targetUserId]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card/80 p-8 text-center shadow-xl backdrop-blur">
        <div className="mb-5 flex justify-center">
          <PentagramLoader size="md" />
        </div>
        <h1 className="mb-3 text-2xl font-bold">gomo6 messenger</h1>
        <p className="text-sm text-muted-foreground">{error ?? status}</p>
        {error && (
          <div className="mt-6 flex justify-center gap-3">
            <Button onClick={() => window.location.reload()}>Повторить</Button>
            <Button variant="outline" onClick={() => navigate("/")}>
              На главную
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Messages;
