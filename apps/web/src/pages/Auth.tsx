import { useState, useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { apiClient } from "@/integrations/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { z } from "zod";
import { LEGAL_VERSIONS } from "@/lib/legal/config";
import { cn } from "@/lib/utils";
import { Gomo6Mark } from "@/components/Gomo6Mark";
import { useQueryClient } from "@tanstack/react-query";
import { supportsWebAuthn, prepareLoginOptions, serializeAuthentication } from "@/services/passkeys";
import { apiErrorMessage } from "@/utils/apiErrors";
import { Eye, EyeOff, Loader2, Shield } from "lucide-react";
import TurnstileWidget, { isTurnstileEnabled, type TurnstileWidgetHandle } from "@/components/TurnstileWidget";

/** Shared standalone shell: full-height gradient backdrop + brand mark + a
 *  single centred card, matching the other layout-less pages (e.g. OAuthConsent). */
const AuthShell = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background via-background to-primary/5 p-4 sm:p-6">
    <div className="w-full max-w-md animate-in fade-in zoom-in-95 duration-300">
      <div className="relative mb-6 flex justify-center">
        <span
          aria-hidden="true"
          className="gomo-mark-halo pointer-events-none absolute left-1/2 top-1/2 h-20 w-20 rounded-full bg-primary/30 blur-2xl"
        />
        <Gomo6Mark className="gomo-mark-breathe relative h-16 w-16 text-primary" />
      </div>
      <h1 className="sr-only">gomo6</h1>
      {children}
    </div>
  </div>
);

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
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
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

  const switchMode = (login: boolean) => {
    if (login === isLogin) return;
    setIsLogin(login);
    setAgreedToTerms(false);
    setTurnstileToken(null);
    turnstileRef.current?.reset();
  };

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
              terms_version: LEGAL_VERSIONS.terms,
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
      <AuthShell>
        <Card className="overflow-hidden border-border/60 shadow-lg">
          <CardContent className="p-6">
            <h2 className="mb-4 text-center text-lg font-semibold tracking-tight">
              {t('auth.confirmLogin')}
            </h2>

            <form onSubmit={handleVerify2FA} className="space-y-4">
              <div className="space-y-2">
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

              <Button type="submit" className="w-full gap-2" disabled={loading || totpCode.length < 6}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
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
          </CardContent>
        </Card>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <Card className="overflow-hidden border-border/60 shadow-lg">
        <CardContent className="p-6">
          {/* Mode switch: both options stay visible, the active one is raised. */}
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-border/60 bg-muted/40 p-1">
            <button
              type="button"
              aria-pressed={isLogin}
              onClick={() => switchMode(true)}
              disabled={loading}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60",
                isLogin
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border/50"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t('auth.loginTitle')}
            </button>
            <button
              type="button"
              aria-pressed={!isLogin}
              onClick={() => switchMode(false)}
              disabled={loading}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60",
                !isLogin
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border/50"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t('auth.registerTitle')}
            </button>
          </div>

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

            <div className="space-y-2">
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
              <p className="text-xs text-muted-foreground">{t('auth.caseSensitive')}</p>
            </div>

            {!isLogin && (
              <div className="space-y-2">
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

            <div className="space-y-2">
              <Label htmlFor="password">{t('auth.password')}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••"
                  required
                  disabled={loading}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  disabled={loading}
                  aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-foreground disabled:opacity-60"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
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
                    <Link
                      to="/legal/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-link hover:underline"
                    >
                      {t('auth.termsLink')}
                    </Link>{" "}
                    {t('auth.termsAnd')}{" "}
                    <Link
                      to="/legal/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-link hover:underline"
                    >
                      {t('auth.privacyLink')}
                    </Link>
                  </label>
                </div>
              </div>
            )}

            {/* Cloudflare Turnstile — human verification for login/register */}
            {isTurnstileEnabled() && (
              <div className="flex justify-center">
                <TurnstileWidget
                  key={isLogin ? "login" : "signup"}
                  ref={turnstileRef}
                  action={isLogin ? "login" : "signup"}
                  onToken={setTurnstileToken}
                />
              </div>
            )}

            <Button type="submit" className="w-full gap-2" disabled={loading || (!isLogin && !agreedToTerms)}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? t('common.loading') : isLogin ? t('auth.login') : t('auth.registerBtn')}
            </Button>

            {isLogin && supportsWebAuthn() && (
              <>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-surface px-2 text-muted-foreground">{t('auth.or')}</span>
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
        </CardContent>
      </Card>
    </AuthShell>
  );
};

export default Auth;
