import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { z } from "zod";
import { TermsOfService } from "@/components/TermsOfService";
import { PentagramLoader } from "@/components/PentagramLoader";

const authSchema = z.object({
  username: z.string().trim().min(3, "Юзернейм минимум 3 символа").max(20, "Юзернейм максимум 20 символов"),
  password: z.string().min(6, "Пароль минимум 6 символов"),
});

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const navigate = useNavigate();

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
        const { error } = await supabase.auth.signInWithPassword({
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
        
        toast.success("Регистрация успешна! Можете войти.");
        setIsLogin(true);
      }
    } catch (error: any) {
      toast.error("Произошла ошибка");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
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
