import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, Crown, Timer, Plus, Check, Gavel, LogOut, VolumeX, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { canModerateTarget, memberRoleIds, memberTop } from "./permissions";
import { inputCls } from "./ui";
import { csrfHeaders, rpcPost, type BanItem, type Member, type MemberRoleGrant, type Role } from "./types";

type Actor = { id: string; isOwner: boolean; isAdmin: boolean; top: number };

type Props = {
  boardId: string;
  ownerId: string;
  members: Member[];
  roles: Role[];
  grants: MemberRoleGrant[];
  bans: BanItem[];
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

const MembersPanel = ({ boardId, ownerId, members, roles, grants, bans, actor, canAssign, canKick, canBan, canTimeout, onChanged }: Props) => {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rolePickerOpen, setRolePickerOpen] = useState(false);
  const [timeoutPickerOpen, setTimeoutPickerOpen] = useState(false);
  const [banFormOpen, setBanFormOpen] = useState(false);
  const [banReason, setBanReason] = useState("");
  const [banExpiry, setBanExpiry] = useState("never");
  const [banPurge, setBanPurge] = useState(true);

  const sortedRoles = useMemo(() => [...roles].sort((a, b) => b.position - a.position), [roles]);
  const bannedIds = useMemo(() => new Set(bans.map((b) => b.user_id)), [bans]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...members].sort((a, b) => memberTop(b, roles, grants) - memberTop(a, roles, grants));
    if (!q) return list;
    return list.filter((m) => (m.profiles?.username ?? m.user_id).toLowerCase().includes(q));
  }, [members, roles, grants, query]);

  const topRoleOf = (m: Member): Role | null => {
    const ids = new Set(memberRoleIds(m, grants));
    let top: Role | null = null;
    for (const r of sortedRoles) {
      if (r.is_everyone) continue;
      if (ids.has(r.id) && (!top || r.position > top.position)) top = r;
    }
    return top;
  };

  const selected = members.find((m) => m.user_id === selectedId) ?? null;
  // Close the card if the member vanished (kick/ban/leave).
  useEffect(() => {
    if (selectedId && !members.some((m) => m.user_id === selectedId)) {
      setSelectedId(null);
      setRolePickerOpen(false);
      setTimeoutPickerOpen(false);
      setBanFormOpen(false);
    }
  }, [members, selectedId]);

  const openCard = (m: Member) => {
    setSelectedId(m.user_id);
    setRolePickerOpen(false);
    setTimeoutPickerOpen(false);
    setBanFormOpen(false);
    setBanReason("");
    setBanExpiry("never");
  };

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

  const doBan = async (m: Member) => {
    setBusy(`ban:${m.user_id}`);
    let expires_at: string | undefined;
    if (banExpiry !== "never") {
      const d = new Date();
      d.setDate(d.getDate() + parseInt(banExpiry, 10));
      expires_at = d.toISOString();
    }
    const res = await rpcPost("/api/rpc/gomosub_ban", {
      board_id: boardId, user_id: m.user_id,
      reason: banReason.trim() || undefined, expires_at, delete_messages: banPurge,
    });
    setBusy(null);
    if (!res.ok) { toast.error((res.error as string) || "Не удалось забанить"); return; }
    toast.success("Участник забанен");
    setBanFormOpen(false);
    setBanReason("");
    setBanExpiry("never");
    await onChanged();
  };

  const doUnban = async (m: Member) => {
    setBusy(`unban:${m.user_id}`);
    const res = await rpcPost("/api/rpc/gomosub_unban", { board_id: boardId, user_id: m.user_id });
    setBusy(null);
    if (!res.ok) { toast.error((res.error as string) || "Не удалось разбанить"); return; }
    toast.success("Бан снят");
    await onChanged();
  };

  const doTimeout = async (m: Member, minutes: number) => {
    setBusy(`timeout:${m.user_id}`);
    const res = await rpcPost("/api/rpc/gomosub_timeout", { board_id: boardId, user_id: m.user_id, duration_minutes: minutes });
    setBusy(null);
    if (!res.ok) { toast.error((res.error as string) || "Не удалось замутить"); return; }
    toast.success("Мьют выдан");
    setTimeoutPickerOpen(false);
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
        <div className="rounded-xl border border-border/60 bg-muted/25 px-3 py-2 text-[11px] text-muted-foreground">
          Выдавать роли могут только держатели прав «Управление ролями» или «Управление участниками».
        </div>
      )}

      {/* Compact user cards: avatar + role-colored name. Everything else
          lives in the user card dialog. */}
      <div className="rounded-2xl border border-border/60 bg-surface overflow-hidden divide-y divide-border/40">
        {filtered.map((m) => {
          const name = m.profiles?.username ?? `${m.user_id.slice(0, 8)}…`;
          const top = topRoleOf(m);
          const color = top?.color ?? "#99aab5";
          const isOwnerRow = m.user_id === ownerId;
          const timedOut = m.timed_out_until && new Date(m.timed_out_until) > new Date();
          return (
            <button
              key={m.user_id}
              onClick={() => openCard(m)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/40"
            >
              <span
                className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-sm font-bold text-white"
                style={{ backgroundColor: color }}
              >
                {name[0]?.toUpperCase() ?? "?"}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold truncate" style={{ color: top ? color : undefined }}>
                  {name}
                </span>
              </span>
              {isOwnerRow && <Crown className="w-3.5 h-3.5 shrink-0 text-amber-500" />}
              {timedOut && <Timer className="w-3.5 h-3.5 shrink-0 text-amber-600" />}
              {m.user_id === actor.id && <Badge variant="secondary" className="text-[10px] rounded shrink-0">ты</Badge>}
            </button>
          );
        })}
        {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">Никого не найдено</p>}
      </div>

      {/* User card dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelectedId(null); }}>
        <DialogContent className="max-w-sm p-0 overflow-hidden gap-0">
          {selected && (() => {
            const m = selected;
            const name = m.profiles?.username ?? `${m.user_id.slice(0, 8)}…`;
            const ids = memberRoleIds(m, grants);
            const top = topRoleOf(m);
            const color = top?.color ?? "#99aab5";
            const isOwnerRow = m.user_id === ownerId;
            const isSelf = m.user_id === actor.id;
            const timedOut = m.timed_out_until && new Date(m.timed_out_until) > new Date();
            const banned = bannedIds.has(m.user_id);
            const allowed = !isSelf && canModerateTarget(actor, memberTop(m, roles, grants), isOwnerRow);
            const heldRoles = sortedRoles.filter((r) => !r.is_everyone && ids.includes(r.id));
            return (
              <>
                <div className="px-4 pt-4 pb-3 border-b border-border/40">
                  <div className="flex items-center gap-3">
                    <span
                      className="w-14 h-14 rounded-2xl shrink-0 flex items-center justify-center text-2xl font-bold text-white"
                      style={{ backgroundColor: color }}
                    >
                      {name[0]?.toUpperCase() ?? "?"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <DialogHeader className="p-0 space-y-0.5 text-left">
                        <DialogTitle className="text-lg leading-tight truncate" style={{ color: top ? color : undefined }}>
                          {name}
                        </DialogTitle>
                      </DialogHeader>
                      <div className="text-xs text-muted-foreground truncate">u{m.user_id.slice(0, 8)}</div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {isOwnerRow && (
                          <Badge variant="secondary" className="text-[10px] rounded">
                            <Crown className="w-3 h-3 mr-0.5 text-amber-500" />владелец
                          </Badge>
                        )}
                        {isSelf && <Badge variant="secondary" className="text-[10px] rounded">это ты</Badge>}
                        {timedOut && (
                          <Badge variant="outline" className="text-[10px] rounded text-amber-600 border-amber-500/40">
                            <Timer className="w-3 h-3 mr-0.5" />мут до {new Date(m.timed_out_until as string).toLocaleString()}
                          </Badge>
                        )}
                        {banned && (
                          <Badge variant="destructive" className="text-[10px] rounded">забанен</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Roles */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-3">
                    {heldRoles.map((r) => (
                      <Badge key={r.id} variant="secondary" className="text-[11px] rounded-full font-medium">
                        <span className="w-1.5 h-1.5 rounded-full mr-1" style={{ backgroundColor: r.color }} />
                        {r.name}
                      </Badge>
                    ))}
                    {canAssign && (
                      <button
                        onClick={() => setRolePickerOpen((v) => !v)}
                        title="Роли"
                        className={cn(
                          "w-6 h-6 rounded-full border border-dashed border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors",
                          rolePickerOpen && "border-primary text-primary",
                        )}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {rolePickerOpen && canAssign && (
                    <div className="mt-2 rounded-xl border border-border/60 max-h-44 overflow-y-auto divide-y divide-border/40">
                      {sortedRoles.filter((r) => !r.is_everyone).map((r) => {
                        const has = ids.includes(r.id);
                        const key = `${m.user_id}:${r.id}`;
                        const lock = !has && !canModerateTarget(actor, r.position, false) && !actor.isOwner && !actor.isAdmin;
                        return (
                          <button
                            key={r.id}
                            disabled={busy === key || lock}
                            onClick={() => toggleGrant(m, r.id, has)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-muted/40 disabled:opacity-50 text-left"
                          >
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                            <span className="flex-1 truncate">{r.name}</span>
                            {busy === key
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                              : has ? <Check className="w-4 h-4 text-emerald-500" /> : null}
                          </button>
                        );
                      })}
                      {sortedRoles.filter((r) => !r.is_everyone).length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-3">Ролей пока нет — создай во вкладке «Роли»</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Timeout presets */}
                {canTimeout && allowed && timeoutPickerOpen && !timedOut && (
                  <div className="px-4 py-2.5 border-b border-border/40">
                    <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Мьют на</div>
                    <div className="flex flex-wrap gap-1.5">
                      {TIMEOUT_PRESETS.map((p) => (
                        <Button
                          key={p.label} size="sm" variant="outline" className="h-7 text-xs rounded-lg"
                          disabled={busy === `timeout:${m.user_id}`} onClick={() => doTimeout(m, p.minutes)}
                        >
                          {p.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Ban form */}
                {canBan && allowed && banFormOpen && !banned && (
                  <div className="px-4 py-3 border-b border-border/40 space-y-2.5">
                    <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Бан</div>
                    <Input
                      value={banReason} onChange={(e) => setBanReason(e.target.value)}
                      placeholder="Причина" maxLength={240} className={inputCls("h-9 text-sm")}
                    />
                    <Select value={banExpiry} onValueChange={setBanExpiry}>
                      <SelectTrigger className={inputCls("h-9")}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {BAN_EXPIRY.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={banPurge} onCheckedChange={(v) => setBanPurge(v === true)} />
                      Удалить сообщения из чатов саба
                    </label>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="h-8 text-xs rounded-lg flex-1" onClick={() => setBanFormOpen(false)}>
                        Отмена
                      </Button>
                      <Button
                        size="sm" variant="destructive" className="h-8 text-xs rounded-lg flex-1"
                        disabled={busy === `ban:${m.user_id}`} onClick={() => doBan(m)}
                      >
                        {busy === `ban:${m.user_id}` && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}Забанить
                      </Button>
                    </div>
                  </div>
                )}

                {/* Bottom actions: mute / kick / ban with active-state toggles */}
                {(canTimeout || canKick || canBan) && allowed && (
                  <div className="grid grid-cols-3 divide-x divide-border/40 border-t border-border/40">
                    {canTimeout && (
                      timedOut ? (
                        <button
                          onClick={() => doUntimeout(m)}
                          disabled={busy === `untimeout:${m.user_id}`}
                          className="flex flex-col items-center gap-1 py-3 text-xs text-emerald-600 hover:bg-muted/40 transition-colors disabled:opacity-50"
                        >
                          {busy === `untimeout:${m.user_id}`
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Volume2 className="w-4 h-4" />}
                          Снять мьют
                        </button>
                      ) : (
                        <button
                          onClick={() => { setBanFormOpen(false); setTimeoutPickerOpen((v) => !v); }}
                          className={cn(
                            "flex flex-col items-center gap-1 py-3 text-xs text-muted-foreground hover:bg-muted/40 transition-colors",
                            timeoutPickerOpen && "text-amber-600",
                          )}
                        >
                          <VolumeX className="w-4 h-4" />
                          Мьют
                        </button>
                      )
                    )}
                    {canKick && (
                      <button
                        onClick={() => doKick(m)}
                        disabled={busy === `kick:${m.user_id}`}
                        className="flex flex-col items-center gap-1 py-3 text-xs text-muted-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
                      >
                        {busy === `kick:${m.user_id}`
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <LogOut className="w-4 h-4" />}
                        Кик
                      </button>
                    )}
                    {canBan && (
                      banned ? (
                        <button
                          onClick={() => doUnban(m)}
                          disabled={busy === `unban:${m.user_id}`}
                          className="flex flex-col items-center gap-1 py-3 text-xs text-emerald-600 hover:bg-muted/40 transition-colors disabled:opacity-50"
                        >
                          {busy === `unban:${m.user_id}`
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Gavel className="w-4 h-4" />}
                          Снять бан
                        </button>
                      ) : (
                        <button
                          onClick={() => { setTimeoutPickerOpen(false); setBanFormOpen((v) => !v); }}
                          className={cn(
                            "flex flex-col items-center gap-1 py-3 text-xs transition-colors hover:bg-muted/40",
                            banFormOpen ? "text-destructive" : "text-muted-foreground",
                          )}
                        >
                          <Gavel className="w-4 h-4" />
                          Бан
                        </button>
                      )
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MembersPanel;
