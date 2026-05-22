import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/api/client_simple";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { PentagramLoader } from "@/components/PentagramLoader";
import { toast } from "sonner";
import { Check, Shield, ExternalLink, Ban, User } from "lucide-react";

interface OAuthApp {
  client_id: string;
  name: string;
  description: string;
  logo_url: string;
  homepage_url: string;
  allowed_scopes: string[];
}

interface UserInfo {
  id: string;
  username: string;
  avatar_url?: string;
}

const SCOPE_LABELS: Record<string, { label: string; icon: string }> = {
  openid: { label: "OpenID Connect (аутентификация)", icon: "🔑" },
  profile: { label: "Имя пользователя и аватар", icon: "👤" },
  email: { label: "Email адрес", icon: "📧" },
};

const OAuthConsent = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);

  const clientId = searchParams.get("client_id");
  const redirectUri = searchParams.get("redirect_uri");
  const state = searchParams.get("state");
  const scope = searchParams.get("scope");
  const codeChallenge = searchParams.get("code_challenge");
  const codeChallengeMethod = searchParams.get("code_challenge_method");
  const nonce = searchParams.get("nonce");

  // Check auth session
  useEffect(() => {
    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        navigate(
          `/auth?redirect=${encodeURIComponent(window.location.href)}`
        );
        return;
      }
      // Get user info from /me endpoint
      try {
        const meRes = await fetch("/api/v1/auth/me", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });
        if (meRes.ok) {
          const meData = await meRes.json();
          setUserInfo({
            id: meData.id || session.user.id,
            username: meData.username || session.user.email?.split("@")[0] || "User",
            avatar_url: meData.avatar_url,
          });
        } else {
          // Fallback to session user
          const { data: userData } = await supabase.auth.getUser();
          setUserInfo({
            id: session.user.id,
            username:
              userData?.user?.user_metadata?.username ||
              session.user.email?.split("@")[0] ||
              "User",
          });
        }
      } catch {
        setUserInfo({
          id: session.user.id,
          username: session.user.email?.split("@")[0] || "User",
        });
      }
      setSessionChecked(true);
    };
    checkSession();
  }, [navigate]);

  // Fetch app info
  const {
    data: app,
    isLoading: appLoading,
    error: appError,
  } = useQuery({
    queryKey: ["oauth-app", clientId],
    queryFn: async () => {
      if (!clientId) return null;
      const res = await fetch(`/oauth/app-info?client_id=${clientId}`);
      if (!res.ok) throw new Error("Failed to fetch app info");
      return res.json() as Promise<OAuthApp>;
    },
    enabled: !!clientId,
  });

  const handleAllow = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("response_type", "code");
      params.set("client_id", clientId || "");
      if (redirectUri) params.set("redirect_uri", redirectUri);
      if (state) params.set("state", state);
      if (scope) params.set("scope", scope);
      if (codeChallenge) params.set("code_challenge", codeChallenge);
      if (codeChallengeMethod)
        params.set("code_challenge_method", codeChallengeMethod);
      if (nonce) params.set("nonce", nonce);
      params.set("consent", "true");

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Необходимо войти в систему");
        navigate("/auth");
        return;
      }

      const res = await fetch(`/oauth/authorize?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
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

      toast.error("Неожиданный ответ сервера");
    } catch {
      toast.error("Ошибка соединения");
    } finally {
      setLoading(false);
    }
  }, [
    clientId,
    redirectUri,
    state,
    scope,
    codeChallenge,
    codeChallengeMethod,
    nonce,
    navigate,
  ]);

  const handleDeny = useCallback(() => {
    if (redirectUri) {
      const params = new URLSearchParams();
      params.set("error", "access_denied");
      params.set("error_description", "User denied access");
      if (state) params.set("state", state);
      window.location.href = `${redirectUri}?${params.toString()}`;
    } else {
      navigate("/");
    }
  }, [redirectUri, state, navigate]);

  const scopes = scope ? scope.split(" ") : [];

  const isLoading = appLoading || !sessionChecked;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-background via-background to-primary/5">
        <div className="flex flex-col items-center gap-3">
          <PentagramLoader size="md" />
          <p className="text-sm text-muted-foreground animate-pulse">
            Загрузка...
          </p>
        </div>
      </div>
    );
  }

  if (appError || !app) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-background via-background to-primary/5 p-4">
        <Card className="w-full max-w-md border-destructive/20">
          <CardContent className="pt-8 text-center space-y-4">
            <div className="mx-auto w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
              <Ban className="w-7 h-7 text-destructive" />
            </div>
            <h2 className="text-lg font-semibold">Приложение не найдено</h2>
            <p className="text-sm text-muted-foreground">
              Не удалось загрузить информацию о приложении. Возможно,
              client_id указан неверно.
            </p>
            <Button variant="outline" onClick={() => navigate("/")} className="mt-2">
              На главную
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const redirectHost = redirectUri ? new URL(redirectUri).host : null;

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-background via-background to-primary/5 p-4">
      <div className="w-full max-w-md space-y-3 animate-in fade-in zoom-in-95 duration-300">
        {/* Header */}
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Shield className="w-3.5 h-3.5" />
            <span>Авторизация через gomo6</span>
          </div>
        </div>

        {/* Main consent card */}
        <Card className="overflow-hidden border-border/60 shadow-lg">
          {/* App header */}
          <div className="relative px-6 pt-6 pb-4 flex flex-col items-center text-center border-b border-border/40">
            <div className="relative mb-3">
              {app.logo_url ? (
                <img
                  src={app.logo_url}
                  alt={app.name}
                  className="w-16 h-16 rounded-xl object-cover ring-2 ring-border/40"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                    (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
                  }}
                />
              ) : null}
              <div
                className={`w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center ring-2 ring-border/40 ${app.logo_url ? "hidden" : ""}`}
              >
                <span className="text-2xl font-bold text-primary">
                  {app.name?.[0] || "?"}
                </span>
              </div>
            </div>
            <h1 className="text-lg font-semibold">{app.name}</h1>
            {app.description && (
              <p className="text-sm text-muted-foreground mt-1 max-w-sm line-clamp-2">
                {app.description}
              </p>
            )}
            {app.homepage_url && (
              <a
                href={app.homepage_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
              >
                <ExternalLink className="w-3 h-3" />
                {new URL(app.homepage_url).host}
              </a>
            )}
          </div>

          <CardContent className="p-6 space-y-5">
            {/* User info */}
            {userInfo && (
              <div className="bg-muted/50 rounded-xl p-3.5 flex items-center gap-3 border border-border/40">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 ring-2 ring-border/30">
                  {userInfo.avatar_url ? (
                    <img
                      src={userInfo.avatar_url}
                      alt=""
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <User className="w-5 h-5 text-primary/70" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {userInfo.username}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Вы вошли как этот пользователь
                  </p>
                </div>
                <div className="flex-shrink-0">
                  <Check className="w-4 h-4 text-green-500" />
                </div>
              </div>
            )}

            {/* Scopes */}
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-foreground/80">
                Приложению будет предоставлен доступ к:
              </h2>
              <div className="space-y-2">
                {scopes.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">
                    Базовый доступ (только аутентификация)
                  </p>
                ) : (
                  scopes.map((s) => {
                    const scopeInfo = SCOPE_LABELS[s] || {
                      label: s,
                      icon: "🔒",
                    };
                    return (
                      <div
                        key={s}
                        className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/30 hover:bg-muted/50 transition-colors"
                      >
                        <span className="text-base flex-shrink-0 mt-0.5">
                          {scopeInfo.icon}
                        </span>
                        <div>
                          <p className="text-sm font-medium">
                            {scopeInfo.label}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {s === "openid" &&
                              "Идентификация вашей учётной записи"}
                            {s === "profile" &&
                              "Чтение вашего имени пользователя и аватара"}
                            {s === "email" && "Чтение вашего email адреса"}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Redirect info */}
            {redirectHost && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/20 rounded-lg px-3 py-2">
                <ExternalLink className="w-3 h-3 flex-shrink-0" />
                <span>
                  Будет перенаправлено на:{" "}
                  <span className="font-medium text-foreground/70">
                    {redirectHost}
                  </span>
                </span>
              </div>
            )}
          </CardContent>

          <CardFooter className="flex-col gap-2.5 px-6 pb-6 pt-0">
            <Button
              onClick={handleAllow}
              className="w-full h-11 text-base font-medium gap-2 transition-all active:scale-[0.98]"
              disabled={loading}
            >
              {loading ? (
                <>
                  <PentagramLoader size="sm" />
                  Обработка...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Разрешить
                </>
              )}
            </Button>
            <Button
              onClick={handleDeny}
              variant="outline"
              className="w-full h-10 text-sm gap-2 transition-all active:scale-[0.98]"
              disabled={loading}
            >
              <Ban className="w-3.5 h-3.5" />
              Отказаться
            </Button>
          </CardFooter>
        </Card>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground/60">
          Вы сможете отозвать доступ в любое время в настройках аккаунта
        </p>
      </div>
    </div>
  );
};

export default OAuthConsent;
