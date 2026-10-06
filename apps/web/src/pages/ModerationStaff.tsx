import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";

import { apiClient } from "@/integrations/api/client";
import { useModeratorGate } from "@/hooks/useModeratorGate";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface StaffMember {
  user_id: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
  roles: string[];
}

/** Staff roles (route /moderation/staff): who may read/act, granted by admins. */
const ModerationStaff = () => {
  const { isAdmin, canReadModeration } = useModeratorGate();

  const [items, setItems] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("helper");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await apiClient.rawRequest<{ items: StaffMember[] }>("/api/v1/moderation/staff");
      if (error) throw error;
      setItems((data as { items: StaffMember[] })?.items ?? []);
    } catch {
      toast.error("Не удалось загрузить персонал");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canReadModeration) return;
    load();
  }, [canReadModeration, load]);

  const grant = async () => {
    const name = username.trim().replace(/^@/, "");
    if (!name) {
      toast.error("Введите username");
      return;
    }
    setBusy("grant");
    try {
      await apiClient.rawRequest("/api/v1/moderation/staff", {
        method: "POST",
        body: JSON.stringify({ username: name, role }),
      });
      toast.success("Роль выдана");
      setUsername("");
      await load();
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === "role_already_granted") toast.error("У пользователя уже есть эта роль");
      else toast.error(e.message || "Не удалось выдать роль");
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (member: StaffMember, r: string) => {
    setBusy(`${member.user_id}:${r}`);
    try {
      await apiClient.rawRequest(`/api/v1/moderation/staff/${member.user_id}/${r}`, { method: "DELETE" });
      toast.success("Роль снята");
      await load();
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === "last_admin") toast.error("Это последний админ");
      else if (e.code === "cannot_revoke_self") toast.error("Нельзя снять админку с себя");
      else toast.error(e.message || "Не удалось снять роль");
    } finally {
      setBusy(null);
    }
  };

  if (!canReadModeration) return null;

  return (
    <div className="bg-background min-h-screen">
      <main className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
        <div>
          <Link to="/moderation" className="text-sm text-muted-foreground transition-colors hover:text-primary">
            ← Модерация
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold">
            <Users className="h-5 w-5 text-primary" />
            Персонал
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAdmin ? "Вы можете выдавать и снимать роли модератора и хелпера. Роль admin — только вручную в БД." : "Только просмотр — роли меняет админ."}
          </p>
        </div>

        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-surface p-4">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              className="h-9 w-[200px] rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"
            />
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="w-[210px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="helper">helper — только чтение</SelectItem>
                <SelectItem value="moderator">moderator</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" className="gap-1.5" onClick={grant} disabled={busy === "grant"}>
              {busy === "grant" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Выдать
            </Button>
          </div>
        )}

        {loading && items.length === 0 ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Загружаем…
          </div>
        ) : items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-12 text-center text-muted-foreground">
            Персонала нет
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((m) => (
              <div key={m.user_id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-surface px-4 py-2.5">
                <Link to={`/moderation/users/${m.user_id}`} className="font-medium hover:text-primary hover:underline">
                  {m.display_name || m.username}
                </Link>
                <span className="text-xs text-muted-foreground">@{m.username}</span>
                <div className="ml-auto flex flex-wrap gap-1.5">
                  {m.roles.map((r) => (
                    <span
                      key={r}
                      className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] text-primary"
                    >
                      {r}
                      {isAdmin && r !== "admin" && (
                        <button
                          type="button"
                          onClick={() => revoke(m, r)}
                          disabled={busy === `${m.user_id}:${r}`}
                          title="Снять роль"
                          className="transition-colors hover:text-destructive"
                        >
                          {busy === `${m.user_id}:${r}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default ModerationStaff;
