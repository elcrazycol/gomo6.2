import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Menu, X, User, Settings, Hammer, LogOut, Plus, Grid3X3 } from "lucide-react";
import { toast } from "sonner";
import { UserBadge } from "@/components/UserBadge";
import { HeaderUsername } from "@/components/HeaderUsername";

interface MobileMenuProps {
  user: any;
  isModerator: boolean;
}

export const MobileMenu = ({ user, isModerator }: MobileMenuProps) => {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState<string>("");
  const [isAnonymous, setIsAnonymous] = useState<boolean>(false);
  const [accountNumber, setAccountNumber] = useState<number | undefined>();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  
  // Check if we're on own profile page
  const isOwnProfile = location.pathname === `/profile/${user?.id}`;

  useEffect(() => {
    // Always load own user profile
    if (user) {
      const loadProfile = async () => {
        const { data } = await supabase
          .from("profiles")
          .select("username, is_anonymous, account_number, avatar_url")
          .eq("id", user.id)
          .single();
        
        if (data) {
          setUsername(data.username);
          setIsAnonymous(data.is_anonymous);
          setAccountNumber(data.account_number);
          setAvatarUrl(data.avatar_url);
        }
      };
      loadProfile();
    }
  }, [user]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Вышли");
    setOpen(false);
  };

  if (!user) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="sm:hidden hover:bg-white/20 hover:text-white transition-colors"
        onClick={() => setOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-[280px] sm:w-[300px]">
          <SheetHeader>
            <SheetTitle className="text-left">Меню</SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            {/* Create thread button */}
            <Button
              onClick={() => {
                navigate("/");
                setOpen(false);
              }}
              className="w-full relative group hover:translate-x-0.5 transition-transform duration-200"
            >
              <Plus className="w-4 h-4 mr-2" />
              Создать тред
              <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
            </Button>

            {/* Boards view button */}
            <Button
              variant="outline"
              onClick={() => {
                navigate("/boards");
                setOpen(false);
              }}
              className="w-full relative group hover:translate-x-0.5 transition-transform duration-200"
            >
              <Grid3X3 className="w-4 h-4 mr-2" />
              Просмотр по доскам
              <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
            </Button>

            {/* User profile panel */}
            <Link
              to={`/profile/${user.id}`}
              onClick={() => setOpen(false)}
              className="block"
            >
              <div className="p-4 bg-card border border-border rounded-lg hover:bg-card/80 transition-colors cursor-pointer">
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={username || "Пользователь"} className="w-full h-full object-cover" />
                    ) : (
                    <User className="w-6 h-6 text-muted-foreground" />
                    )}
                  </div>

                  {/* User info with HeaderUsername */}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">
                      <HeaderUsername userId={user.id} className="text-base font-semibold" />
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      ID: {user.id.slice(0, 8)} {accountNumber && `(${accountNumber})`}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {isAnonymous ? "Анонимный режим" : "Нажмите для просмотра профиля"}
                    </div>
                  </div>
                </div>
              </div>
            </Link>

            {/* Settings link */}
            <Link
              to="/settings"
              onClick={() => setOpen(false)}
              className="block"
            >
              <Button variant="ghost" className="w-full justify-start relative group hover:translate-x-0.5 transition-transform duration-200 !hover:bg-primary/10 !hover:text-primary">
                <Settings className="w-4 h-4 mr-2" />
                Настройки
                <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
              </Button>
            </Link>

            {/* Moderation link */}
            {isModerator && (
              <Link
                to="/moderation"
                onClick={() => setOpen(false)}
                className="block"
              >
                <Button variant="ghost" className="w-full justify-start relative group hover:translate-x-0.5 transition-transform duration-200 !hover:bg-primary/10 !hover:text-primary">
                  <Hammer className="w-4 h-4 mr-2" />
                  Модерация
                  <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
                </Button>
              </Link>
            )}

            {/* Logout button - only show when viewing own profile */}
            {isOwnProfile && (
              <Button 
                variant="ghost" 
                className="w-full justify-start relative group !hover:bg-red-500/10 !hover:text-red-500"
                onClick={handleLogout}
              >
                <LogOut className="w-4 h-4 mr-2" />
                Выйти из аккаунта
                <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};
