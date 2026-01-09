import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Menu, X } from "lucide-react";
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
            {/* User info */}
            <div className="pb-4 border-b border-border">
              {username && (
                <UserBadge
                  userId={user.id}
                  username={username}
                  isAnonymous={isAnonymous}
                />
              )}
            </div>

            {/* Profile link */}
            <Link
              to={`/profile/${user.id}`}
              onClick={() => setOpen(false)}
              className="block"
            >
              <Button variant="ghost" className="w-full justify-start">
                Профиль
              </Button>
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

            {/* Logout */}
            <Button
              variant="secondary"
              className="w-full"
              onClick={handleLogout}
            >
              Выйти
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};
