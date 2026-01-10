import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { MobileMenu } from "@/components/MobileMenu";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const Settings = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      setLoading(false);
    };

    getUser();
  }, []);

  if (loading) {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  if (!user) {
    navigate("/auth");
    return null;
  }

  return (
    <div className="bg-background min-h-screen flex flex-col">
      <div className="flex-1">
        <header className="bg-board-header text-board-header-foreground p-3 border-b border-border">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
            <Link to="/" className="text-xl font-bold hover:underline flex-shrink-0">
              gomo6
            </Link>
            <div className="flex gap-1 sm:gap-2 items-center flex-shrink-0">
              <ThemeToggle />
              {user && <NotificationBell userId={user.id} />}
              {user && <ChatIcon userId={user.id} />}
              <div className="hidden sm:flex gap-1 sm:gap-2 items-center">
                <ProfileHoverCard userId={user.id}>
                  <Link to={`/profile/${user.id}`}>
                    <Button variant="ghost" size="sm" className="text-xs sm:text-sm">Профиль</Button>
                  </Link>
                </ProfileHoverCard>
              </div>
              <MobileMenu user={user} />
            </div>
          </div>
        </header>

        <main className="max-w-4xl mx-auto p-4">
          <div className="space-y-6">
            <div className="text-center">
              <h1 className="text-2xl font-bold mb-2">Настройки</h1>
              <p className="text-muted-foreground">Настройки профиля и приложения</p>
            </div>

            <Tabs defaultValue="appearance" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="general">Основные</TabsTrigger>
                <TabsTrigger value="appearance">Внешний вид</TabsTrigger>
                <TabsTrigger value="account">Аккаунт</TabsTrigger>
                <TabsTrigger value="privacy">Приватность</TabsTrigger>
              </TabsList>

              <TabsContent value="general" className="space-y-4">
                <div className="bg-card p-6 border border-border">
                  <h2 className="text-lg font-semibold mb-4">Основные настройки</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">Язык</label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Настройки языка находятся в разработке
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Часовой пояс</label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Автоматическое определение часового пояса
                      </p>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="appearance" className="space-y-4">
                <div className="bg-card p-6 border border-border">
                  <h2 className="text-lg font-semibold mb-4">Внешний вид</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">Тема</label>
                      <div className="mt-2">
                        <ThemeToggle />
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Размер шрифта</label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Настройки размера шрифта находятся в разработке
                      </p>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="account" className="space-y-4">
                <div className="bg-card p-6 border border-border">
                  <h2 className="text-lg font-semibold mb-4">Аккаунт</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">Профиль</label>
                      <p className="text-sm text-muted-foreground mt-1 mb-3">
                        Управление информацией профиля
                      </p>
                      <Link to={`/profile/${user.id}`}>
                        <Button variant="outline">
                          Перейти в профиль
                        </Button>
                      </Link>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Пароль</label>
                      <p className="text-sm text-muted-foreground mt-1 mb-3">
                        Изменение пароля доступно в профиле
                      </p>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="privacy" className="space-y-4">
                <div className="bg-card p-6 border border-border">
                  <h2 className="text-lg font-semibold mb-4">Приватность</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">Видимость профиля</label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Настройки приватности находятся в разработке
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Блокировка пользователей</label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Управление заблокированными пользователями
                      </p>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Settings;