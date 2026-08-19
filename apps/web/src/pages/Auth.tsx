import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { apiClient } from "@/integrations/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { z } from "zod";
import { TermsOfService } from "@/components/TermsOfService";
import { PentagramLoader } from "@/components/PentagramLoader";
import { useQueryClient } from "@tanstack/react-query";
import { supportsWebAuthn, prepareLoginOptions, serializeAuthentication } from "@/services/passkeys";
import { apiErrorMessage } from "@/utils/apiErrors";
import { Shield } from "lucide-react";
import TurnstileWidget, { isTurnstileEnabled, type TurnstileWidgetHandle } from "@/components/TurnstileWidget";

const Auth = () => {
  const { t } = useTranslation();
  const authSchema = z.object({
    username: z.string().trim().min(3, t('auth.usernameMin3')).max(20, t('auth.usernameMax20')),
    password: z.string().min(6, t('auth.passwordMin6')),
  });

  const codeSchema = z.object({
    code: z.string().min(6, t('auth.codeMin6')),
  });

  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  // Get redirect URL from query params (set by AuthGuard or auth:expired handler)
  // Only allow same-origin paths to prevent open redirect attacks
  const rawRedirect = searchParams.get("redirect") || "/";
  const redirectTo = rawRedirect.startsWith("/") ? rawRedirect : "/";

  // 2FA state
  const [needs2FA, setNeeds2FA] = useState(false);
  const [partialToken, setPartialToken] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);


  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await api.auth.getSession();
      if (session) {
        navigate(redirectTo, { replace: true });
      }
    };
    checkSession();
  }, [navigate, redirectTo]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const validation = authSchema.safeParse({ username, password });
    if (!validation.success) {
      toast.error(validation.error.errors[0].message);
      return;
    }

    if (!isLogin && !agreedToTerms) {
      toast.error(t('auth.agreeTerms'));
      return;
    }

    // Turnstile gate: a fresh widget token is required before any auth request.
    if (isTurnstileEnabled() && !turnstileToken) {
      toast.error(t('auth.confirmNotRobot'));
      return;
    }

    setLoading(true);

    try {
      if (isLogin) {
        const { data, error } = await api.auth.signInWithPassword({
          username,
          password,
          turnstileToken: turnstileToken ?? undefined,
        });

        if (error) {
          toast.error(apiErrorMessage(error, t));
          turnstileRef.current?.reset();
          return;
        }

        // Check if 2FA is needed
        if (data?.session?.needs_2fa) {
          setPartialToken(data.session.access_token);
          setNeeds2FA(true);
          setLoading(false);
          return; // Wait for 2FA code
        }

        // Invalidate auth cache to force refetch
        await queryClient.invalidateQueries({ queryKey: ['auth'] });
        await queryClient.refetchQueries({ queryKey: ['auth', 'currentUser'] });

        // Reconnect WebSocket with new token
        const { wsService } = await import("@/services/websocket");
        await wsService.disconnect();
        await wsService.connect();

        toast.success(t('auth.loginSuccess'));
        navigate(redirectTo, { replace: true });
      } else {
        const { error } = await api.auth.signUp({
          username,
          password,
          options: {
            data: {
              display_name: displayName.trim() || undefined,
            },
          } as { data?: { display_name?: string } },
          turnstileToken: turnstileToken ?? undefined,
        });

        if (error) {
          toast.error(apiErrorMessage(error, t));
          turnstileRef.current?.reset();
          return;
        }

        // Record terms acceptance
        const { data: newSession } = await api.auth.getSession();
        if (newSession.session?.user) {
          await api
            .from("user_terms_acceptance")
            .insert({
              user_id: newSession.session.user.id,
            });
        }

        // Reconnect WebSocket with new token
        const { wsService } = await import("@/services/websocket");
        await wsService.disconnect();
        await wsService.connect();

        toast.success(t('auth.registerSuccess'));
        setIsLogin(true);
      }
    } catch (_: unknown) {
      toast.error(t('auth.genericError'));
      turnstileRef.current?.reset();
    } finally {
      setLoading(false);
    }
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();

    const validation = codeSchema.safeParse({ code: totpCode });
    if (!validation.success) {
      toast.error(t('auth.enter2faCode'));
      return;
    }

    setLoading(true);

    try {
      const { error } = await api.auth.verify2FA(partialToken, totpCode, trustDevice);

      if (error) {
        toast.error(apiErrorMessage(error, t));
        setLoading(false);
        return;
      }

      // Invalidate auth cache to force refetch
      await queryClient.invalidateQueries({ queryKey: ['auth'] });
      await queryClient.refetchQueries({ queryKey: ['auth', 'currentUser'] });

      // Reconnect WebSocket with new token
      const { wsService } = await import("@/services/websocket");
      await wsService.disconnect();
      await wsService.connect();

      toast.success(t('auth.loginSuccess'));
      navigate(redirectTo, { replace: true });
    } catch (_: unknown) {
      toast.error(t('auth.verifyError'));
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    if (!isLogin) return; // only for login mode

    if (!supportsWebAuthn()) {
      toast.error(t('auth.noPasskeys'));
      return;
    }

    setLoading(true);
    try {
      // Step 1: get login options from server (discoverable — no username needed)
      const optionsData = await apiClient.beginPasskeyLogin();
      const wrapped = optionsData.options as Record<string, unknown>;
      if (!wrapped) throw new Error("No passkeys found");
      // go-webauthn nests options under {publicKey: {challenge, ...}}
      const options = wrapped.publicKey as Record<string, unknown>;
      if (!options) throw new Error("No passkeys found");

      // Step 2: get assertion from browser
      const publicKey = prepareLoginOptions(options);
      const credential = await navigator.credentials.get({ publicKey });
      if (!credential) throw new Error("Authentication cancelled");

      // Step 3: send assertion to server with session token
      const serialized = serializeAuthentication(credential as PublicKeyCredential);
      const _result = await apiClient.finishPasskeyLogin(optionsData.session_token, serialized);

      // Success — same post-login flow as password login
      await queryClient.invalidateQueries({ queryKey: ['auth'] });
      await queryClient.refetchQueries({ queryKey: ['auth', 'currentUser'] });

      const { wsService } = await import("@/services/websocket");
      await wsService.disconnect();
      await wsService.connect();

      toast.success(t('auth.loginSuccess'));
      navigate(redirectTo, { replace: true });
    } catch (err) {
      const msg = (err as Error).message || t('auth.passkeyLoginError');
      if (!msg.includes("cancelled") && !msg.includes("AbortError")) {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBackToLogin = () => {
    setNeeds2FA(false);
    setPartialToken("");
    setTotpCode("");
    setTrustDevice(false);
  };

  if (needs2FA) {
    return (
      <div className="flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <PentagramLoader size="md" />
            </div>
            <h1 className="text-4xl font-bold text-primary mb-2">gomo6</h1>
            <p className="text-muted-foreground">{t('auth.twoFactorAuth')}</p>
          </div>

          <div className="bg-card border border-border p-6 rounded">
            <h2 className="text-xl font-bold mb-4 text-center">
              {t('auth.confirmLogin')}
            </h2>

            <form onSubmit={handleVerify2FA} className="space-y-4">
              <div>
                <Label htmlFor="totp-code">{t('auth.authCodeLabel')}</Label>
                <Input
                  id="totp-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                  placeholder="000000"
                  required
                  disabled={loading}
                  className="text-center text-2xl tracking-widest"
                  maxLength={6}
                />
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="trust-device"
                  checked={trustDevice}
                  onCheckedChange={(checked) => setTrustDevice(checked as boolean)}
                  disabled={loading}
                />
                <label
                  htmlFor="trust-device"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  {t('auth.rememberDevice')}
                </label>
              </div>

              <Button type="submit" className="w-full" disabled={loading || totpCode.length < 6}>
                {loading ? t('auth.verifying') : t('common.confirm')}
              </Button>
            </form>

            <div className="mt-4 text-center text-sm">
              <button
                onClick={handleBackToLogin}
                className="text-link hover:underline"
                disabled={loading}
              >
                {t('auth.backToLogin')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <PentagramLoader size="md" />
          </div>
          <h1 className="text-4xl font-bold text-primary mb-2">gomo6</h1>
          <p className="text-muted-foreground">{t('auth.imageboard')}</p>
        </div>

        <div className="bg-card border border-border p-6 rounded">
          <h2 className="text-xl font-bold mb-4 text-center">
            {isLogin ? t('auth.loginTitle') : t('auth.registerTitle')}
          </h2>

          <form onSubmit={handleAuth} className="space-y-4">
            {/* ── HoneyPot: hidden from humans, visible to bots in DOM ── */}
            <div
              style={{
                position: "absolute",
                left: "-9999px",
                opacity: 0,
                height: 0,
                width: 0,
                overflow: "hidden",
              }}
              aria-hidden="true"
            >
              <label htmlFor="website">Website</label>
              <input
                type="text"
                id="website"
                name="website"
                tabIndex={-1}
                autoComplete="off"
              />
            </div>

            <div>
              <Label htmlFor="username">{t('auth.username')}</Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="anon"
                required
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground mt-1">{t('auth.caseSensitive')}</p>
            </div>

            {!isLogin && (
              <div>
                <Label htmlFor="display-name">{t('auth.displayName')} <span className="text-muted-foreground">{t('auth.displayNameOptional')}</span></Label>
                <Input
                  id="display-name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t('auth.displayNamePlaceholder')}
                  disabled={loading}
                />
              </div>
            )}

            <div>
              <Label htmlFor="password">{t('auth.password')}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••"
                required
                disabled={loading}
              />
            </div>

            {!isLogin && (
              <div className="flex items-start space-x-2">
                <Checkbox 
                  id="terms" 
                  checked={agreedToTerms}
                  onCheckedChange={(checked) => setAgreedToTerms(checked as boolean)}
                  disabled={loading}
                />
                <div className="grid gap-1.5 leading-none">
                  <label
                    htmlFor="terms"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    {t('auth.termsAgree')}{" "}
                    <button
                      type="button"
                      onClick={() => setShowTerms(true)}
                      className="text-link hover:underline"
                    >
                      {t('auth.termsLink')}
                    </button>
                  </label>
                </div>
              </div>
            )}

            {/* Cloudflare Turnstile — human verification for login/register */}
            {isTurnstileEnabled() && (
              <TurnstileWidget
                key={isLogin ? "login" : "signup"}
                ref={turnstileRef}
                action={isLogin ? "login" : "signup"}
                onToken={setTurnstileToken}
              />
            )}

            <Button type="submit" className="w-full" disabled={loading || (!isLogin && !agreedToTerms)}>
              {loading ? t('common.loading') : isLogin ? t('auth.login') : t('auth.registerBtn')}
            </Button>

            {isLogin && supportsWebAuthn() && (
              <>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">{t('auth.or')}</span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-2"
                  onClick={handlePasskeyLogin}
                  disabled={loading}
                >
                  <Shield className="h-4 w-4" />
                  {t('auth.passkeyLogin')}
                </Button>
              </>
            )}
          </form>

          <div className="mt-4 text-center text-sm">
            <button
              onClick={() => {
                setIsLogin(!isLogin);
                setAgreedToTerms(false);
                setTurnstileToken(null);
                turnstileRef.current?.reset();
              }}
              className="text-link hover:underline"
              disabled={loading}
            >
              {isLogin ? t('auth.noAccountRegister') : t('auth.haveAccountLogin')}
            </button>
          </div>
        </div>
      </div>
      
      <TermsOfService 
        open={showTerms} 
        onAccept={() => {
          setShowTerms(false);
          setAgreedToTerms(true);
        }}
        onDecline={() => setShowTerms(false)}
        canDecline={true}
      />
    </div>
  );
};

export default Auth;