import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/api/client_simple";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { PentagramLoader } from "@/components/PentagramLoader";
import { toast } from "sonner";

interface OAuthApp {
  client_id: string;
  name: string;
  description: string;
  logo_url: string;
  homepage_url: string;
  allowed_scopes: string[];
}

const SCOPE_LABELS: Record<string, string> = {
  "openid": "OpenID Connect (аутентификация)",
  "profile": "Имя пользователя и аватар",
  "email": "Email адрес",
};

const OAuthConsent = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const clientId = searchParams.get("client_id");
  const redirectUri = searchParams.get("redirect_uri");
  const state = searchParams.get("state");
  const scope = searchParams.get("scope");
  const codeChallenge = searchParams.get("code_challenge");
  const codeChallengeMethod = searchParams.get("code_challenge_method");
  const nonce = searchParams.get("nonce");

  // Fetch app info
  const { data: app, isLoading: appLoading } = useQuery({
    queryKey: ["oauth-app", clientId],
    queryFn: async () => {
      if (!clientId) return null;
      const res = await fetch(`/oauth/app-info?client_id=${clientId}`);
      if (!res.ok) throw new Error("Failed to fetch app info");
      return res.json() as Promise<OAuthApp>;
    },
    enabled: !!clientId,
  });

  // Check if user is authenticated
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // Redirect to login with return URL
        navigate(`/auth?redirect=${encodeURIComponent(window.location.href)}`);
      }
    };
    checkSession();
  }, [navigate]);

  const handleAllow = async () => {
    setLoading(true);
    try {
      // Build the authorize URL
      const params = new URLSearchParams();
      params.set("response_type", "code");
      params.set("client_id", clientId || "");
      if (redirectUri) params.set("redirect_uri", redirectUri);
      if (state) params.set("state", state);
      if (scope) params.set("scope", scope);
      if (codeChallenge) params.set("code_challenge", codeChallenge);
      if (codeChallengeMethod) params.set("code_challenge_method", codeChallengeMethod);
      if (nonce) params.set("nonce", nonce);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Необходимо войти в систему");
        navigate("/auth");
        return;
      }

      const res = await fetch(`/oauth/authorize?${params.toString()}`, {
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
        },
      });

      const data = await res.json();

      if (data.error) {
        toast.error(data.error_description || "Ошибка авторизации");
        return;
      }

      if (data.redirect_url) {
        window.location.href = data.redirect_url;
        return;
      }

      // Shouldn't reach here normally
      toast.error("Неожиданный ответ сервера");
    } catch (error: any) {
      toast.error("Ошибка соединения");
    } finally {
      setLoading(false);
    }
  };

  const handleDeny = () => {
    if (redirectUri) {
      const params = new URLSearchParams();
      params.set("error", "access_denied");
      params.set("error_description", "User denied access");
      if (state) params.set("state", state);
      window.location.href = `${redirectUri}?${params.toString()}`;
    } else {
      navigate("/");
    }
  };

  const scopes = scope ? scope.split(" ") : [];

  if (appLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <PentagramLoader size="md" />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            {app?.logo_url ? (
              <img src={app.logo_url} alt={app.name} className="w-16 h-16 rounded-full" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
                <span className="text-2xl font-bold text-primary">{app?.name?.[0] || "?"}</span>
              </div>
            )}
          </div>
          <CardTitle className="text-xl">Вход через gomo6</CardTitle>
          <CardDescription>
            <strong>{app?.name || "Приложение"}</strong> запрашивает доступ к вашему аккаунту
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {app?.description && (
            <p className="text-sm text-muted-foreground text-center">{app.description}</p>
          )}

          <div className="bg-muted rounded-lg p-4 space-y-2">
            <h3 className="text-sm font-medium">Приложению будет предоставлен доступ к:</h3>
            <ul className="space-y-1">
              {scopes.map((s) => (
                <li key={s} className="text-sm text-muted-foreground flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                  {SCOPE_LABELS[s] || s}
                </li>
              ))}
            </ul>
          </div>

          {redirectUri && (
            <p className="text-xs text-muted-foreground text-center">
              Будет перенаправлено на: {new URL(redirectUri).host}
            </p>
          )}
        </CardContent>
        <CardFooter className="flex-col gap-3">
          <Button
            onClick={handleAllow}
            className="w-full"
            disabled={loading}
          >
            {loading ? "Загрузка..." : "Разрешить"}
          </Button>
          <Button
            onClick={handleDeny}
            variant="ghost"
            className="w-full"
            disabled={loading}
          >
            Отказаться
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};

export default OAuthConsent;