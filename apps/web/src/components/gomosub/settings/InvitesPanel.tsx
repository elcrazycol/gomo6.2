import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Copy, Trash2, Calendar, Infinity as InfinityIcon, Clock } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/integrations/api/compat";

type Invite = {
  id: string;
  code: string;
  max_uses: number;
  current_uses: number;
  expires_at: string | null;
  created_at: string;
  is_active: boolean;
};

type Props = {
  boardId: string;
  slug: string;
  invites: Invite[];
  loading: boolean;
  onChanged: () => Promise<void>;
};

const InvitesPanel = ({ boardId, slug, invites, loading, onChanged }: Props) => {
  const [maxUses, setMaxUses] = useState(0);
  const [expiresDays, setExpiresDays] = useState(0);
  const [creating, setCreating] = useState(false);

  const copyLink = (code: string) => {
    const url = `${window.location.origin}/g/${slug}/join/${code}`;
    navigator.clipboard.writeText(url).then(() => toast.success("Ссылка скопирована")).catch(() => toast.error("Не удалось скопировать"));
  };

  const create = async () => {
    setCreating(true);
    try {
      const { data: { session } } = await api.auth.getSession();
      if (!session?.access_token) { toast.error("Нужно войти"); return; }
      const body: Record<string, unknown> = { max_uses: maxUses || 0 };
      if (expiresDays > 0) {
        const d = new Date();
        d.setDate(d.getDate() + expiresDays);
        body.expires_at = d.toISOString();
      }
      const r = await fetch(`/api/v1/boards/${boardId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok || !d.success) { toast.error(d.error || "Не удалось создать приглашение"); return; }
      toast.success("Приглашение создано");
      setMaxUses(0);
      setExpiresDays(0);
      await onChanged();
    } catch { toast.error("Ошибка"); }
    setCreating(false);
  };

  const remove = async (inviteId: string) => {
    try {
      const { data: { session } } = await api.auth.getSession();
      if (!session?.access_token) return;
      const r = await fetch(`/api/v1/boards/${boardId}/invites/${inviteId}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const d = await r.json();
      if (!r.ok || !d.success) { toast.error(d.error || "Не удалось удалить"); return; }
      toast.success("Приглашение удалено");
      await onChanged();
    } catch { toast.error("Ошибка"); }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Пригласительные ссылки для входа в приватный саб.</p>
      <div className="rounded-xl border border-border/70 bg-muted/30 p-4 space-y-3">
        <div className="text-sm font-medium">Создать приглашение</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Макс. использований (0 = безлимитно)</Label>
            <Input type="number" min={0} value={maxUses} onChange={(e) => setMaxUses(parseInt(e.target.value) || 0)} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Срок действия</Label>
            <Select value={String(expiresDays)} onValueChange={(v) => setExpiresDays(parseInt(v) || 0)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0"><span className="inline-flex items-center gap-1"><InfinityIcon className="w-3 h-3" />Бессрочно</span></SelectItem>
                <SelectItem value="1">1 день</SelectItem>
                <SelectItem value="7">7 дней</SelectItem>
                <SelectItem value="30">30 дней</SelectItem>
                <SelectItem value="90">90 дней</SelectItem>
                <SelectItem value="365">1 год</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={create} disabled={creating} size="sm">
          {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}<Plus className="w-4 h-4 mr-1" />Создать ссылку
        </Button>
      </div>
      {loading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : invites.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">Приглашений пока нет</p>
      ) : (
        <div className="space-y-2">
          {invites.map((inv) => {
            const isExpired = inv.expires_at && new Date(inv.expires_at) < new Date();
            const isMaxed = inv.max_uses > 0 && inv.current_uses >= inv.max_uses;
            const isActive = inv.is_active && !isExpired && !isMaxed;
            const link = `${window.location.origin}/g/${slug}/join/${inv.code}`;
            return (
              <div key={inv.id} className="rounded-xl border border-border/60 bg-surface p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono max-w-full truncate flex-1">{link}</code>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" onClick={() => copyLink(inv.code)} title="Копировать">
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                  <Badge variant={isActive ? "default" : "secondary"} className="text-[10px]">
                    {isActive ? "Активно" : isExpired ? "Истекло" : isMaxed ? "Лимит" : "Отключено"}
                  </Badge>
                  <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(inv.created_at).toLocaleDateString()}</span>
                  {inv.max_uses > 0 && <span>{inv.current_uses}/{inv.max_uses} исп.</span>}
                  {inv.max_uses === 0 && <span><InfinityIcon className="w-3 h-3 inline" /> исп.</span>}
                  {inv.expires_at && <span><Clock className="w-3 h-3 inline mr-0.5" />до {new Date(inv.expires_at).toLocaleDateString()}</span>}
                </div>
                {isActive && (
                  <Button size="sm" variant="ghost" className="h-6 text-destructive hover:text-destructive text-xs" onClick={() => remove(inv.id)}>
                    <Trash2 className="w-3 h-3 mr-1" />Удалить
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default InvitesPanel;
export type { Invite };
