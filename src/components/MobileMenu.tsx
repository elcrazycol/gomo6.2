import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Menu, X, User } from "lucide-react";
import { toast } from "sonner";
import { UserBadge } from "@/components/UserBadge";

interface MobileMenuProps {
  user: any;
  isModerator: boolean;
  username?: string;
  isAnonymous?: boolean;
}

export const MobileMenu = ({ user, isModerator, username: propUsername, isAnonymous: propIsAnonymous }: MobileMenuProps) => {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState<string | undefined>(propUsername);
  const [isAnonymous, setIsAnonymous] = useState<boolean | undefined>(propIsAnonymous);
  const navigate = useNavigate();

  useEffect(() => {
    // Load user profile if username not provided
    if (!propUsername && user) {
      const loadProfile = async () => {
        const { data } = await supabase
          .from("profiles")
          .select("username, is_anonymous")
          .eq("id", user.id)
          .single();
        
        if (data) {
          setUsername(data.username);
          setIsAnonymous(data.is_anonymous);
        }
      };
      loadProfile();
    }
  }, [user, propUsername]);

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
        className="sm:hidden"
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
            {/* User profile panel */}
            <Link
              to={`/profile/${user.id}`}
              onClick={() => setOpen(false)}
              className="block"
            >
              <div className="p-4 bg-card border border-border rounded-lg hover:bg-card/80 transition-colors cursor-pointer">
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                    <User className="w-6 h-6 text-muted-foreground" />
                  </div>

                  {/* User info */}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">
                      {username || "Пользователь"}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      ID: {user.id.slice(0, 8)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {isAnonymous ? "Анонимный режим" : "Нажмите для просмотра профиля"}
                    </div>
                  </div>
                </div>
              </div>
            </Link>

            {/* Moderation link */}
            {isModerator && (
              <Link
                to="/moderation"
                onClick={() => setOpen(false)}
                className="block"
              >
                <Button variant="ghost" className="w-full justify-start">
                  Модерация
                </Button>
              </Link>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};
