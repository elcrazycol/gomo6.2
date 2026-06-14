import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, UserPlus, ArrowRight, Lock, AlertCircle } from "lucide-react";
import { PentagramLoader } from "@/components/PentagramLoader";

interface InviteInfo {
  board_id: string;
  board_name: string;
  expired: boolean;
  maxed_out: boolean;
  max_uses: number;
  current_uses: number;
}

const GomoSubJoin = () => {
  const { slug, code } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ id: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const { data: { session } } = await api.auth.getSession();
        setUser(session?.user ?? null);

        const res = await fetch(`/api/v1/invites/${code}`);
        const data = await res.json();

        if (!res.ok || !data.success) {
          setError(data.error || "Приглашение не найдено");
          return;
        }

        setInviteInfo(data.data);
      } catch {
        setError("Не удалось загрузить приглашение");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [code]);

  const handleJoin = async () => {
    if (!user) {
      navigate(`/auth?redirect=/g/${slug}/join/${code}`);
      return;
    }

    setJoining(true);
    try {
      const { data: { session } } = await api.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`/api/v1/invites/${code}/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
      });

      const d = await res.json();

      if (!res.ok || !d.success) {
        throw new Error(d.error || "Не удалось принять приглашение");
      }

      toast.success("Вы присоединились к g-сабу");
      navigate(`/g/${d.data.board_slug}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setJoining(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <PentagramLoader size="lg" />
    </div>
  );

  if (error) return (
    <div className="max-w-md mx-auto p-6 pt-20">
      <Card className="text-center">
        <CardContent className="pt-6 space-y-4">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto" />
          <h2 className="text-lg font-semibold">Приглашение не найдено</h2>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={() => navigate("/g")}>
            К списку g-сабов
          </Button>
        </CardContent>
      </Card>
    </div>
  );

  const canJoin = !inviteInfo?.expired && !inviteInfo?.maxed_out;

  return (
    <div className="max-w-md mx-auto p-6 pt-20">
      <Card className="border-primary/20">
        <CardHeader className="text-center">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <Lock className="w-7 h-7 text-primary" />
          </div>
          <CardTitle className="text-xl">Приглашение в приватный g-саб</CardTitle>
          {inviteInfo && (
            <p className="text-sm text-muted-foreground mt-1">
              Вас пригласили в <span className="font-medium text-foreground">{inviteInfo.board_name}</span>
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-5">
          {inviteInfo && (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Статус</span>
                <span className={canJoin ? "text-emerald-600 font-medium" : "text-destructive font-medium"}>
                  {inviteInfo.expired ? "Истекло" : inviteInfo.maxed_out ? "Лимит исчерпан" : "Активно"}
                </span>
              </div>
              {inviteInfo.max_uses > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Использований</span>
                  <span>{inviteInfo.current_uses} / {inviteInfo.max_uses}</span>
                </div>
              )}
            </div>
          )}

          {!user ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground text-center">
                Войдите в аккаунт, чтобы присоединиться к g-сабу
              </p>
              <Link to={`/auth?redirect=/g/${slug}/join/${code}`} className="block">
                <Button className="w-full">Войти</Button>
              </Link>
            </div>
          ) : (
            <Button
              onClick={handleJoin}
              disabled={!canJoin || joining}
              className="w-full"
              size="lg"
            >
              {joining ? (
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              ) : (
                <UserPlus className="w-5 h-5 mr-2" />
              )}
              {canJoin ? "Присоединиться" : "Недоступно"}
            </Button>
          )}

          <div className="text-center">
            <Link to="/g" className="text-sm text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1">
              <ArrowRight className="w-3 h-3" /> Все g-сабы
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default GomoSubJoin;
