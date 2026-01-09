import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/Footer";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";

const Rules = () => {
  const [user, setUser] = useState<any>(null);
  const [isModerator, setIsModerator] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user ?? null);

      if (session?.user) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", session.user.id);

        setIsModerator(roles?.some(r => r.role === 'moderator' || r.role === 'admin') || false);
      }
    };
    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-board-header text-board-header-foreground p-2 sm:p-3 border-b border-border">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
          <div className="text-sm sm:text-base flex-1 min-w-0">
            <Link to="/" className="text-lg sm:text-xl font-bold hover:underline">
              gomo6
            </Link>
            <span className="mx-1 sm:mx-2 hidden sm:inline">/</span>
            <span className="text-base sm:text-lg hidden sm:inline">Правила</span>
          </div>
          <div className="flex gap-1 sm:gap-2 items-center flex-shrink-0">
            <ThemeToggle />
            {user && <NotificationBell userId={user.id} />}
            {user && <ChatIcon userId={user.id} />}
            {user ? (
              <>
                <div className="hidden sm:flex gap-1 sm:gap-2 items-center">
                  <ProfileHoverCard userId={user.id}>
                    <Link to={`/profile/${user.id}`}>
                      <Button variant="ghost" size="sm" className="text-xs sm:text-sm">Профиль</Button>
                    </Link>
                  </ProfileHoverCard>
                  {isModerator && (
                    <Link to="/moderation">
                      <Button variant="ghost" size="sm" className="text-xs sm:text-sm">Модерация</Button>
                    </Link>
                  )}
                </div>
                <MobileMenu
                  user={user}
                  isModerator={isModerator}
                  username={user ? "Пользователь" : undefined}
                  isAnonymous={false}
                />
              </>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => window.location.href = "/auth"} className="text-xs sm:text-sm">
                Войти
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4">
        <div className="mb-6">
          <Link to="/" className="text-link hover:underline text-sm">
            ← Назад на главную
          </Link>
        </div>

        <div className="space-y-6">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-4">Правила gomo6</h1>
            <p className="text-muted-foreground">
              Пожалуйста, ознакомьтесь с правилами перед использованием форума
            </p>
          </div>

          <div className="space-y-6">
            <section className="bg-card p-6 rounded-lg border">
              <h2 className="text-xl font-semibold mb-4">1. Общие правила</h2>
              <ul className="space-y-2 text-sm">
                <li>• Запрещено размещение незаконного контента</li>
                <li>• Запрещено распространение вредоносного ПО</li>
                <li>• Запрещена пропаганда насилия и экстремизма</li>
                <li>• Запрещено нарушение авторских прав</li>
                <li>• Запрещено размещение личных данных других пользователей</li>
              </ul>
            </section>

            <section className="bg-card p-6 rounded-lg border">
              <h2 className="text-xl font-semibold mb-4">2. Контент</h2>
              <ul className="space-y-2 text-sm">
                <li>• Запрещено размещение порнографического контента</li>
                <li>• Запрещено размещение контента для несовершеннолетних</li>
                <li>• Запрещены спам и флуд</li>
                <li>• Запрещено создание провокационных тем для разжигания конфликтов</li>
              </ul>
            </section>

            <section className="bg-card p-6 rounded-lg border">
              <h2 className="text-xl font-semibold mb-4">3. Поведение</h2>
              <ul className="space-y-2 text-sm">
                <li>• Будьте уважительны к другим пользователям</li>
                <li>• Не используйте оскорбления и угрозы</li>
                <li>• Не раскрывайте личную информацию</li>
                <li>• Модераторы имеют право удалять контент и блокировать пользователей</li>
              </ul>
            </section>

            <section className="bg-card p-6 rounded-lg border">
              <h2 className="text-xl font-semibold mb-4">4. Технические правила</h2>
              <ul className="space-y-2 text-sm">
                <li>• Максимальный размер изображения: 10MB</li>
                <li>• Поддерживаемые форматы: JPG, PNG, WEBP, GIF</li>
                <li>• Запрещено использование ботов и автоматизированных скриптов</li>
              </ul>
            </section>

            <section className="bg-card p-6 rounded-lg border">
              <h2 className="text-xl font-semibold mb-4">5. Последствия нарушения</h2>
              <ul className="space-y-2 text-sm">
                <li>• Предупреждение</li>
                <li>• Временная блокировка</li>
                <li>• Постоянная блокировка</li>
                <li>• Удаление аккаунта</li>
              </ul>
            </section>

            <div className="text-center pt-6">
              <p className="text-sm text-muted-foreground">
                Нарушение правил может привести к блокировке аккаунта без предупреждения.
              </p>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default Rules;