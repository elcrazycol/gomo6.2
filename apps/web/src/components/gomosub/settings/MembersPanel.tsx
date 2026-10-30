import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, Crown, Timer, Gavel, LogOut } from "lucide-react";
import { toast } from "sonner";
import { canModerateTarget, memberRoleIds, memberTop } from "./permissions";
import { inputCls, settingsCard } from "./ui";
import { csrfHeaders, rpcPost, type Member, type MemberRoleGrant, type Role } from "./types";

type Actor = { id: string; isOwner: boolean; isAdmin: boolean; top: number };

type Props = {
  boardId: string;
  ownerId: string;
  members: Member[];
  roles: Role[];
  grants: MemberRoleGrant[];
  actor: Actor;
  canAssign: boolean;
  canKick: boolean;
  canBan: boolean;
  canTimeout: boolean;
  onChanged: () => Promise<void>;
};

const TIMEOUT_PRESETS = [
  { label: "10 минут", minutes: 10 },
  { label: "1 час", minutes: 60 },
  { label: "12 часов", minutes: 720 },
  { label: "1 день", minutes: 1440 },
  { label: "7 дней", minutes: 10080 },
];

const BAN_EXPIRY = [
  { label: "Навсегда", value: "never" },
  { label: "1 день", value: "1" },
  { label: "7 дней", value: "7" },
  { label: "30 дней", value: "30" },
];

const MembersPanel = ({ boardId, ownerId, members, roles, grants, actor, canAssign, canKick, canBan, canTimeout, onChanged }: Props) => {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [banTarget, setBanTarget] = useState<Member | null>(null);
  const [banReason, setBanReason] = useState("");
  const [banExpiry, setBanExpiry] = useState("never");
  const [banPurge, setBanPurge] = useState(true);

  const sortedRoles = useMemo(() => [...roles].sort((a, b) => b.position - a.position), [roles]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...members].sort((a, b) => memberTop(b, roles, grants) - memberTop(a, roles, grants));
    if (!q) return list;
    return list.filter((m) => (m.profiles?.username ?? m.user_id).toLowerCase().includes(q));
  }, [members, roles, grants, query]);

  const toggleGrant = async (m: Member, roleId: string, has: boolean) => {
    if (!canAssign) return;
    setBusy(`${m.user_id}:${roleId}`);
    if (has) {
      const r = await fetch(
        `/api/v1/gomosub_member_roles?board_id=eq.${boardId}&user_id=eq.${m.user_id}&role_id=eq.${roleId}`,
        { method: "DELETE", headers: csrfHeaders() },
      );
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.success) toast.error(d?.error || "Не удалось снять роль");
    } else {
      const r = await fetch("/api/v1/gomosub_member_roles", {
        method: "POST", headers: csrfHeaders(true),
        body: JSON.stringify({ board_id: boardId, user_id: m.user_id, role_id: roleId }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.success) toast.error(d?.error || "Не удалось выдать роль");
    }
    setBusy(null);
    await onChanged();
  };

  const doKick = async (m: Member) => {
    if (!window.confirm(`Кикнуть ${(m.profiles?.username ?? "участника")}? Сможет вернуться.`)) return;
    setBusy(`kick:${m.user_id}`);
    const res = await rpcPost("/api/rpc/gomosub_kick", { board_id: boardId, user_id: m.user_id });
    setBusy(null);
    if (!res.ok) { toast.error((res.error as string) || "Не удалось кикнуть"); return; }
    toast.success("Участник кикнут");
    await onChanged();
  };

  const doBan = async () => {
    if (!banTarget) return;
    setBusy(`ban:${banTarget.user_id}`);
    let expires_at: string | undefined;
    if (banExpiry !== "never") {
      const d = new Date();
      d.setDate(d.getDate() + parseInt(banExpiry, 10));
      expires_at = d.toISOString();
    }
    const res = await rpcPost("/api/rpc/gomosub_ban", {
      board_id: boardId, user_id: banTarget.user_id,
      reason: banReason.trim() || undefined, expires_at, delete_messages: banPurge,
    });
    setBusy(null);
    if (!res.ok) { toast.error((res.error as string) || "Не удалось забанить"); return; }
    toast.success("Участник забанен");
    setBanTarget(null); setBanReason(""); setBanExpiry("never");
    await onChanged();
  };

  const doTimeout = async (m: Member, minutes: number) => {
    setBusy(`timeout:${m.user_id}`);
    const res = await rpcPost("/api/rpc/gomosub_timeout", { board_id: boardId, user_id: m.user_id, duration_minutes: minutes });
    setBusy(null);
    if (!res.ok) { toast.error((res.error as string) || "Не удалось замутить"); return; }
    toast.success("Мьют выдан");
    await onChanged();
  };

  const doUntimeout = async (m: Member) => {
    setBusy(`untimeout:${m.user_id}`);
    const res = await rpcPost("/api/rpc/gomosub_untimeout", { board_id: boardId, user_id: m.user_id });
    setBusy(null);
    if (!res.ok) { toast.error((res.error as string) || "Не удалось снять мьют"); return; }
    toast.success("Мьют снят");
    await onChanged();
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Поиск участников…" value={query} onChange={(e) => setQuery(e.target.value)} className={inputCls("pl-9 h-9")} />
      </div>
      <div className="text-xs text-muted-foreground">{members.length} уч.</div>
      {!canAssign && (
        <div className="rounded-lg border border-border/60 bg-muted/25 px-3 py-2 text-[11px] text-muted-foreground">
          Выдавать роли могут только держатели прав «Управление ролями» или «Управление участниками».
        </div>
      )}
      <div className={`${settingsCard} divide-y divide-border/40 max-h-[60vh] overflow-y-auto`}>
        {filtered.map((m) => {
          const name = m.profiles?.username ?? `${m.user_id.slice(0, 8)}…`;
          const ids = memberRoleIds(m, grants);
          const top = memberTop(m, roles, grants);
          const isOwnerRow = m.user_id === ownerId;
          const isSelf = m.user_id === actor.id;
          const timedOut = m.timed_out_until && new Date(m.timed_out_until) > new Date();
          const allowed = !isSelf && canModerateTarget(actor, top, isOwnerRow);
          const heldRoles = sortedRoles.filter((r) => !r.is_everyone && ids.includes(r.id));
          const topRole = heldRoles[0];
          return (
            <div key={m.user_id} className="px-3 py-2.5 space-y-1.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-sm font-bold text-white"
                  style={{ backgroundColor: topRole?.color ?? "#99aab5" }}
                >
                  {name[0]?.toUpperCase() ?? "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-sm font-medium truncate">{name}</span>
                    {isOwnerRow && <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                    {isSelf && <Badge variant="secondary" className="text-[10px]">это ты</Badge>}
                    {timedOut && (
                      <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/40">
                        <Timer className="w-3 h-3 mr-0.5" />мут до {new Date(m.timed_out_until as string).toLocaleString()}
                      </Badge>
                    )}
                  </div>
                  {heldRoles.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {heldRoles.map((r) => (
                        <Badge key={r.id} variant="secondary" className="text-[10px]">
                          <span className="w-1.5 h-1.5 rounded-full mr-1" style={{ backgroundColor: r.color }} />
                          {r.name}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {canAssign && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 pl-10">
                  {sortedRoles.filter((r) => !r.is_everyone).map((r) => {
                    const has = ids.includes(r.id);
                    const key = `${m.user_id}:${r.id}`;
                    return (
                      <label key={r.id} className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                        <Checkbox
                          checked={has}
                          disabled={busy === key || (!has && !canModerateTarget(actor, r.position, false) && !actor.isOwner && !actor.isAdmin)}
                          onCheckedChange={() => toggleGrant(m, r.id, has)}
                        />
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color }} />
                        {r.name}
                      </label>
                    );
                  })}
                </div>
              )}
              {(canKick || canBan || canTimeout) && allowed && (
                <div className="flex flex-wrap items-center gap-1.5 pl-10">
                  {canTimeout && !timedOut && (
                    <span className="inline-flex items-center gap-1">
                      {TIMEOUT_PRESETS.map((p) => (
                        <Button key={p.label} size="sm" variant="outline" className="h-7 text-xs"
                          disabled={busy === `timeout:${m.user_id}`} onClick={() => doTimeout(m, p.minutes)}>
                          {p.label}
                        </Button>
                      ))}
                    </span>
                  )}
                  {canTimeout && timedOut && (
                    <Button size="sm" variant="outline" className="h-7 text-xs"
                      disabled={busy === `untimeout:${m.user_id}`} onClick={() => doUntimeout(m)}>
                      Снять мьют
                    </Button>
                  )}
                  {canKick && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs"
                      disabled={busy === `kick:${m.user_id}`} onClick={() => doKick(m)}>
                      <LogOut className="w-3.5 h-3.5 mr-1" />Кик
                    </Button>
                  )}
                  {canBan && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive"
                      disabled={busy === `ban:${m.user_id}`} onClick={() => setBanTarget(m)}>
                      <Gavel className="w-3.5 h-3.5 mr-1" />Бан
                    </Button>
                  )}
                  {busy?.endsWith(m.user_id) && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">Никого не найдено</p>}
      </div>

      <Dialog open={!!banTarget} onOpenChange={(o) => { if (!o) setBanTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Бан — {banTarget?.profiles?.username ?? "участник"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Причина</Label>
              <Input value={banReason} onChange={(e) => setBanReason(e.target.value)} placeholder="напр. спам" maxLength={240} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Срок</Label>
              <Select value={banExpiry} onValueChange={setBanExpiry}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BAN_EXPIRY.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={banPurge} onCheckedChange={(v) => setBanPurge(v === true)} />
              Удалить сообщения из чатов саба
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setBanTarget(null)}>Отмена</Button>
            <Button variant="destructive" size="sm" disabled={busy === `ban:${banTarget?.user_id}`} onClick={doBan}>
              Забанить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MembersPanel;
