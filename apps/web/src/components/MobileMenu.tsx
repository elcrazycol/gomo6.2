import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Menu, User, Settings, Hammer, LogOut, Grid3X3, Search, Users, Droplets } from "lucide-react";
import { toast } from "sonner";
import { HeaderUsername } from "@/components/HeaderUsername";
import { storageUrl } from "@/utils/storage";
import { useQuery } from "@tanstack/react-query";
import { formatDropsLabel } from "@/utils/formatDropsLabel";

import type { User as UserFromClient } from "@/integrations/api/client";

interface MobileMenuProps {
  user: UserFromClient | null;
  isModerator: boolean;
}

interface GomoSubItem {
  id: string;
  slug: string;
  name: string;
}

export const MobileMenu = ({ user, isModerator }: MobileMenuProps) => {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState<string>("");
  const [isAnonymous, setIsAnonymous] = useState<boolean>(false);
  const [accountNumber, setAccountNumber] = useState<number | undefined>();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [joinedSubs, setJoinedSubs] = useState<GomoSubItem[]>([]);
  const [randomSubs, setRandomSubs] = useState<GomoSubItem[]>([]);
  const navigate = useNavigate();
  const location = useLocation();
  
  // Check if we're on own profile page
  const isOwnProfile = location.pathname === `/profile/${user?.id}`;

  // Fetch drops balance
  const { data: dropsData } = useQuery({
    queryKey: ['user-drops-mobile', user?.id],
    queryFn: async () => {
      const session = await api.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) return null;
      const res = await fetch(`/api/v1/user/drops?user_id=${user!.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) return json.data as { drops: number };
      return null;
    },
    enabled: open && !!user?.id,
    staleTime: 30 * 1000,
  });

  useEffect(() => {
    // Always load own user profile
    if (user) {
      const loadProfile = async () => {
        const { data } = await api
          .from("profiles")
          .select("username, is_anonymous, account_number, avatar_url")
          .eq("id", user.id)
          .single();
        
        if (data) {
          setUsername(data.username as string);
          setIsAnonymous(data.is_anonymous as boolean);
          setAccountNumber(data.account_number as number | undefined);
          setAvatarUrl(storageUrl("post-images", data.avatar_url as string | null));
        }
      };
      loadProfile();
    }
  }, [user]);

  useEffect(() => {
    if (!user?.id) return;

    const loadSubSections = async () => {
      const { data: memberships } = await api
        .from("gomosub_memberships")
        .select("board_id")
        .eq("user_id", user.id);
      const joinedBoardIds = (memberships ?? []).map((m) => m.board_id);

      if (joinedBoardIds.length > 0) {
        const { data } = await api
          .from("boards")
          .select("id, slug, name")
          .in("id", joinedBoardIds)
          .order("created_at", { ascending: false })
          .limit(6);
        setJoinedSubs((data as unknown as GomoSubItem[]) ?? []);
      } else {
        setJoinedSubs([]);
      }

      const { data: allGSubs } = await api
        .from("boards")
        .select("id, slug, name")
        .eq("is_gomosub", true)
        .eq("visibility", "public")
        .limit(30);

      if (allGSubs && allGSubs.length > 0) {
        const picked = [...allGSubs].sort(() => Math.random() - 0.5).slice(0, 3);
        setRandomSubs(picked as unknown as GomoSubItem[]);
      } else {
        setRandomSubs([]);
      }
    };

    loadSubSections();
  }, [user?.id, open]);

  const handleLogout = async () => {
    await api.auth.signOut();
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
        <SheetContent side="right" className="w-[280px] sm:w-[320px] p-0 flex flex-col">
          <SheetHeader className="px-4 pt-4 pb-3 border-b border-border bg-background/95 backdrop-blur sticky top-0 z-10">
            <SheetTitle className="text-left">Меню</SheetTitle>
          </SheetHeader>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
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
                    {dropsData && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setOpen(false);
                          window.dispatchEvent(new CustomEvent('open-drops-shop'));
                        }}
                        className="flex items-center gap-1 mt-1 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        <Droplets className="w-4 h-4" />
                        <span>{dropsData.drops} {formatDropsLabel(dropsData.drops)}</span>
                      </button>
                    )}
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {isAnonymous ? "Анонимный режим" : "Нажмите для просмотра профиля"}
                    </div>
                  </div>
                </div>
              </div>
            </Link>

            {/* Compact nav row */}
            <div className="-mx-1 overflow-x-auto pb-1">
              <div className="flex min-w-max items-center gap-2 px-1">
                <Button
                  variant="ghost"
                  onClick={() => {
                    navigate("/boards");
                    setOpen(false);
                  }}
                  className="h-10 rounded-xl border border-border bg-card px-3 text-xs shrink-0"
                >
                  <Grid3X3 className="w-3.5 h-3.5 mr-1.5" />
                  Доски
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    navigate("/g");
                    setOpen(false);
                  }}
                  className="h-10 rounded-xl border border-border bg-card px-3 text-xs shrink-0"
                >
                  <Users className="w-3.5 h-3.5 mr-1.5" />
                  G-сабы
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    navigate("/search");
                    setOpen(false);
                  }}
                  className="h-10 rounded-xl px-3 text-xs shrink-0"
                >
                  <Search className="w-3.5 h-3.5 mr-1.5" />
                  Поиск
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    navigate("/settings/appearance");
                    setOpen(false);
                  }}
                  className="h-10 rounded-xl px-3 text-xs shrink-0"
                >
                  <Settings className="w-3.5 h-3.5 mr-1.5" />
                  Настройки
                </Button>
              </div>
            </div>

            {/* Settings link */}
            <Link
              to="/settings/appearance"
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

            <div className="space-y-2 pt-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Подписки</div>
              {joinedSubs.length === 0 ? (
                <div className="text-xs text-muted-foreground">Пока нет подписок</div>
              ) : (
                joinedSubs.map((sub) => (
                  <Link
                    key={sub.id}
                    to={`/g/${sub.slug}`}
                    onClick={() => setOpen(false)}
                    className="block rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/40 transition-colors"
                  >
                    <div className="font-medium text-primary">g/{sub.slug}</div>
                    <div className="text-xs text-muted-foreground line-clamp-1">{sub.name}</div>
                  </Link>
                ))
              )}
            </div>

            <div className="space-y-2 pt-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Капля рандома</div>
              {randomSubs.map((sub) => (
                <Link
                  key={sub.id}
                  to={`/g/${sub.slug}`}
                  onClick={() => setOpen(false)}
                  className="block rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/40 transition-colors"
                >
                  <div className="font-medium text-primary">g/{sub.slug}</div>
                  <div className="text-xs text-muted-foreground line-clamp-1">{sub.name}</div>
                </Link>
              ))}
            </div>

            <div className="space-y-2 pt-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Важное</div>
              <Link to="/rules" onClick={() => setOpen(false)} className="block rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/40 transition-colors">Информация</Link>
              <Link to="/bugs" onClick={() => setOpen(false)} className="block rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/40 transition-colors">Баги/Идеи</Link>
              <Link to="/faq" onClick={() => setOpen(false)} className="block rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/40 transition-colors">FAQ</Link>
            </div>

          </div>

          {isOwnProfile && (
            <div className="border-t border-border p-4 bg-background/95 backdrop-blur">
              <Button 
                variant="ghost" 
                className="w-full justify-start relative group !hover:bg-red-500/10 !hover:text-red-500"
                onClick={handleLogout}
              >
                <LogOut className="w-4 h-4 mr-2" />
                Выйти из аккаунта
                <span className="absolute bottom-0 left-0 w-0 h-[1.5px] bg-current transition-all duration-300 ease-out group-hover:w-full"></span>
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
};
