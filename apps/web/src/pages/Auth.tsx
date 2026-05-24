import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/api/supabaseCompat";
import { apiClient, getDeviceId } from "@/integrations/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { z } from "zod";
import { TermsOfService } from "@/components/TermsOfService";
import { PentagramLoader } from "@/components/PentagramLoader";
import { useQueryClient } from "@tanstack/react-query";

const authSchema = z.object({
  username: z.string().trim().min(3, "Юзернейм минимум 3 символа").max(20, "Юзернейм максимум 20 символов"),
  password: z.string().min(6, "Пароль минимум 6 символов"),
});

const codeSchema = z.object({
  code: z.string().min(6, "Код должен содержать минимум 6 символов"),
});

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // 2FA state
  const [needs2FA, setNeeds2FA] = useState(false);
  const [partialToken, setPartialToken] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        navigate("/");
      }
    };
    checkSession();
  }, [navigate]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const validation = authSchema.safeParse({ username, password });
    if (!validation.success) {
      toast.error(validation.error.errors[0].message);
      return;
    }

    if (!isLogin && !agreedToTerms) {
      toast.error("Необходимо согласиться с пользовательским соглашением");
      return;
    }

    setLoading(true);

    try {
      const email = `${username}@gomo6.local`;

      if (isLogin) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          if (error.message.includes("Invalid login credentials")) {
            toast.error("Неверный логин или пароль");
          } else {
            toast.error(error.message);
          }
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

        toast.success("Вход выполнен");
        navigate("/");
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              username,
            },
            emailRedirectTo: `${window.location.origin}/`,
          },
        });

        if (error) {
          if (error.message.includes("already registered")) {
            toast.error("Этот юзернейм уже занят");
          } else {
            toast.error(error.message);
          }
          return;
        }

        // Record terms acceptance
        const { data: newSession } = await supabase.auth.getSession();
        if (newSession.session?.user) {
          await supabase
            .from("user_terms_acceptance")
            .insert({
              user_id: newSession.session.user.id,
            });
        }

        // Reconnect WebSocket with new token
        const { wsService } = await import("@/services/websocket");
        await wsService.disconnect();
        await wsService.connect();

        toast.success("Регистрация успешна! Можете войти.");
        setIsLogin(true);
      }
    } catch (error: any) {
      toast.error("Произошла ошибка");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();

    const validation = codeSchema.safeParse({ code: totpCode });
    if (!validation.success) {
      toast.error("Введите 6-значный код из аутентификатора");
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.verify2FA(partialToken, totpCode, trustDevice);

      if (error) {
        toast.error("Неверный код 2FA");
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

      toast.success("Вход выполнен");
      navigate("/");
    } catch (error: any) {
      toast.error("Ошибка проверки кода");
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
            <p className="text-muted-foreground">Двухфакторная аутентификация</p>
          </div>

          <div className="bg-card border border-border p-6 rounded">
            <h2 className="text-xl font-bold mb-4 text-center">
              Подтверждение входа
            </h2>

            <form onSubmit={handleVerify2FA} className="space-y-4">
              <div>
                <Label htmlFor="totp-code">Код из аутентификатора</Label>
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
                  Запомнить это устройство на 30 дней
                </label>
              </div>

              <Button type="submit" className="w-full" disabled={loading || totpCode.length < 6}>
                {loading ? "Проверка..." : "Подтвердить"}
              </Button>
            </form>

            <div className="mt-4 text-center text-sm">
              <button
                onClick={handleBackToLogin}
                className="text-link hover:underline"
                disabled={loading}
              >
                Назад к входу
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
          <p className="text-muted-foreground">Имиджборд</p>
        </div>

        <div className="bg-card border border-border p-6 rounded">
          <h2 className="text-xl font-bold mb-4 text-center">
            {isLogin ? "Вход" : "Регистрация"}
          </h2>

          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <Label htmlFor="username">Юзернейм</Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="anon"
                required
                disabled={loading}
              />
            </div>

            <div>
              <Label htmlFor="password">Пароль</Label>
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
                    Вы согласны с{" "}
                    <button
                      type="button"
                      onClick={() => setShowTerms(true)}
                      className="text-link hover:underline"
                    >
                      пользовательским соглашением GOMO6
                    </button>
                  </label>
                </div>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading || (!isLogin && !agreedToTerms)}>
              {loading ? "Загрузка..." : isLogin ? "Войти" : "Зарегистрироваться"}
            </Button>
          </form>

          <div className="mt-4 text-center text-sm">
            <button
              onClick={() => {
                setIsLogin(!isLogin);
                setAgreedToTerms(false);
              }}
              className="text-link hover:underline"
              disabled={loading}
            >
              {isLogin ? "Нет аккаунта? Регистрация" : "Уже есть аккаунт? Вход"}
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