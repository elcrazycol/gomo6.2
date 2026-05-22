import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { handleCallback } from "@/lib/oauth";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const Callback = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const process = async () => {
      try {
        const { user } = await handleCallback(window.location.href);
        setStatus("success");

        // Redirect to dashboard after a brief delay
        setTimeout(() => {
          navigate("/apps", { replace: true });
        }, 1000);
      } catch (err: any) {
        setStatus("error");
        setErrorMessage(err.message || "Authentication failed");
      }
    };

    process();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">
            {status === "processing" && "Выполняется вход..."}
            {status === "success" && "Вход выполнен!"}
            {status === "error" && "Ошибка входа"}
          </CardTitle>
          <CardDescription>
            {status === "processing" && "Обмен кода авторизации на токены..."}
            {status === "success" && "Перенаправляем в панель управления..."}
            {status === "error" && errorMessage}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center pb-6">
          {status === "processing" && <PentagramLoader size="lg" />}
          {status === "error" && (
            <Button onClick={() => navigate("/login")}>
              Вернуться на страницу входа
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Callback;
