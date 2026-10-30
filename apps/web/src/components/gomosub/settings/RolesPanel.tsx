import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ALL_PERM_KEYS, PERMISSION_GROUPS, roleMemberCount } from "./permissions";
import { inputCls, settingsFormCard, settingsSectionTitle } from "./ui";
import { csrfHeaders, parsePerms, type Member, type MemberRoleGrant, type Role } from "./types";

type Props = {
  boardId: string;
  roles: Role[];
  members: Member[];
  grants: MemberRoleGrant[];
  canManage: boolean;
  onChanged: () => Promise<void>;
};

const RolesPanel = ({ boardId, roles, members, grants, canManage, onChanged }: Props) => {
  const sorted = useMemo(() => [...roles].sort((a, b) => b.position - a.position), [roles]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // No implicit selection: the editor draft is created on click, so the
  // switches always edit a real role instead of a draft-less placeholder.
  const selected = sorted.find((r) => r.id === selectedId) ?? null;

  const [draft, setDraft] = useState<{ name: string; color: string; position: number; perms: Record<string, boolean> } | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#5865f2");
  const [newPerms, setNewPerms] = useState<Record<string, boolean>>({});

  const openRole = (r: Role) => {
    setSelectedId(r.id);
    setDraft({ name: r.name, color: r.color, position: r.position, perms: { ...r.permissions } });
  };

  const saveRole = async () => {
    if (!selected || !draft || !canManage) return;
    if (!selected.is_everyone && !draft.name.trim()) { toast.error("Название роли обязательно"); return; }
    setSaving(true);
    const body: Record<string, unknown> = { permissions: draft.perms };
    if (!selected.is_everyone) {
      body.name = draft.name.trim();
      body.color = draft.color;
      body.position = draft.position;
    }
    const r = await fetch(`/api/v1/gomosub_roles?id=eq.${selected.id}&board_id=eq.${boardId}`, {
      method: "PUT", headers: csrfHeaders(true), body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => null);
    setSaving(false);
    if (!r.ok || !d?.success) { toast.error(d?.error || "Не удалось сохранить роль"); return; }
    toast.success("Роль сохранена");
    await onChanged();
  };

  const deleteRole = async (role: Role) => {
    if (role.is_everyone || !canManage) return;
    if (!window.confirm(`Удалить роль «${role.name}»? Участники потеряют её права.`)) return;
    const r = await fetch(`/api/v1/gomosub_roles?id=eq.${role.id}&board_id=eq.${boardId}`, {
      method: "DELETE", headers: csrfHeaders(),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.success) { toast.error(d?.error || "Не удалось удалить роль"); return; }
    setSelectedId(null);
    setDraft(null);
    toast.success("Роль удалена");
    await onChanged();
  };

  const createRole = async () => {
    const name = newName.trim();
    if (!name || !canManage) return;
    setCreating(true);
    const maxPos = roles.reduce((m, r) => (r.is_everyone ? m : Math.max(m, r.position)), 0);
    const r = await fetch("/api/v1/gomosub_roles", {
      method: "POST", headers: csrfHeaders(true),
      body: JSON.stringify({ board_id: boardId, name, color: newColor, position: maxPos + 1, permissions: newPerms }),
    });
    const d = await r.json().catch(() => null);
    setCreating(false);
    if (!r.ok || !d?.success) { toast.error(d?.error || "Не удалось создать роль"); return; }
    setNewName("");
    setNewPerms({});
    toast.success("Роль создана");
    await onChanged();
  };

  const list = (
    <div className="rounded-2xl border border-border/60 bg-surface overflow-hidden divide-y divide-border/40 p-1">
      {sorted.map((r) => {
        const count = r.is_everyone ? members.length : roleMemberCount(r.id, members, grants);
        const active = selected?.id === r.id;
        return (
          <button
            key={r.id}
            onClick={() => openRole(r)}
            className={cn(
              "w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
              active ? "bg-muted" : "hover:bg-muted/50 text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
            <span className={cn("flex-1 min-w-0 truncate", active ? "font-semibold" : "font-medium")}>{r.name}</span>
            {r.is_everyone && <Badge variant="secondary" className="text-[10px] shrink-0">все</Badge>}
            <span className="text-xs text-muted-foreground shrink-0">{count}</span>
          </button>
        );
      })}
      {sorted.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">Ролей пока нет</p>}
    </div>
  );

  const editor = selected && (
    <div className="rounded-2xl border border-border/60 bg-surface overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
        <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: draft?.color ?? selected.color }} />
        <span className="font-semibold text-[15px] truncate flex-1">{selected.is_everyone ? "@everyone — базовая роль" : draft?.name || selected.name}</span>
        {!selected.is_everyone && canManage && (
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => deleteRole(selected)} title="Удалить роль">
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>
      {selected.is_everyone && (
        <p className="px-4 py-2.5 text-xs text-muted-foreground border-b border-border/40">Применяется ко всем участникам автоматически: удалить или переименовать нельзя.</p>
      )}
      {!selected.is_everyone && (
        <div className="grid gap-3 sm:grid-cols-3 px-4 py-3 border-b border-border/40">
          <div className="space-y-1.5">
            <div className={settingsSectionTitle}>Название</div>
            <Input value={draft?.name ?? ""} maxLength={50} disabled={!canManage}
              onChange={(e) => setDraft((p) => (p ? { ...p, name: e.target.value } : p))}
              className={inputCls("h-9")} />
          </div>
          <div className="space-y-1.5">
            <div className={settingsSectionTitle}>Цвет</div>
            <div className="flex items-center gap-2">
              <input type="color" value={draft?.color ?? "#99aab5"} disabled={!canManage}
                onChange={(e) => setDraft((p) => (p ? { ...p, color: e.target.value } : p))}
                className="w-9 h-9 rounded cursor-pointer border border-border p-0.5 bg-transparent" />
              <Input value={draft?.color ?? ""} maxLength={7} disabled={!canManage}
                onChange={(e) => setDraft((p) => (p ? { ...p, color: e.target.value } : p))}
                className={inputCls("font-mono text-xs h-9")} />
            </div>
          </div>
          <div className="space-y-1.5">
            <div className={settingsSectionTitle}>Позиция</div>
            <Input type="number" value={draft?.position ?? 0} disabled={!canManage}
              onChange={(e) => setDraft((p) => (p ? { ...p, position: parseInt(e.target.value) || 0 } : p))}
              className={inputCls("h-9")} />
          </div>
        </div>
      )}
      <div className="py-1">
        {PERMISSION_GROUPS.map((g) => (
          <div key={g.title}>
            <div className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{g.title}</div>
            {g.items.map((perm) => (
              <label key={perm.key} className={cn("flex items-center gap-3 px-4 py-2.5", canManage ? "cursor-pointer hover:bg-muted/40" : "opacity-80")}>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{perm.label}</span>
                  <span className="block text-xs text-muted-foreground">{perm.desc}</span>
                </span>
                <Switch
                  checked={!!draft?.perms[perm.key]}
                  disabled={!canManage}
                  onCheckedChange={(v) => setDraft((p) => (p ? { ...p, perms: { ...p.perms, [perm.key]: v } } : p))}
                  className="shrink-0"
                />
              </label>
            ))}
          </div>
        ))}
      </div>
      {canManage && (
        <div className="flex justify-end px-4 py-3 border-t border-border/40">
          <Button size="sm" className="rounded-lg h-8 text-xs" onClick={saveRole} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Сохранить
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Mobile: list → editor with back. Desktop: two columns. */}
      <div className="md:hidden">
        {!selected || !draft ? list : (
          <div className="space-y-3">
            <Button size="sm" variant="ghost" onClick={() => { setSelectedId(null); setDraft(null); }}>
              <ArrowLeft className="w-4 h-4 mr-1" />Все роли
            </Button>
            {editor}
          </div>
        )}
      </div>
      <div className="hidden md:grid md:grid-cols-[220px_1fr] md:gap-4 md:items-start">
        <div className="sticky top-0">{list}</div>
        <div>{editor ?? <p className="text-sm text-muted-foreground py-8 text-center">Выбери роль слева</p>}</div>
      </div>
      {canManage && (
        <div className={settingsFormCard}>
          <div className={settingsSectionTitle}>Новая роль</div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <div className={settingsSectionTitle}>Название</div>
              <Input placeholder="напр. Модератор" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={50} className={inputCls("w-44 h-9")} />
            </div>
            <div className="space-y-1.5">
              <div className={settingsSectionTitle}>Цвет</div>
              <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="w-9 h-9 rounded cursor-pointer border border-border p-0.5 bg-transparent" />
            </div>
            <Button size="sm" onClick={createRole} disabled={creating || !newName.trim()}>
              {creating ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}Создать
            </Button>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {ALL_PERM_KEYS.map((key) => (
              <label key={key} className="flex items-center gap-1.5 text-xs cursor-pointer text-muted-foreground">
                <Switch checked={!!newPerms[key]} onCheckedChange={(v) => setNewPerms((p) => ({ ...p, [key]: v }))} />
                {PERMISSION_GROUPS.flatMap((g) => g.items).find((i) => i.key === key)?.label ?? key}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const normalizeRoles = (data: unknown): Role[] => {
  const arr = Array.isArray(data) ? data : [];
  return arr.map((x: Record<string, unknown>) => ({
    id: String(x.id ?? ""),
    board_id: String(x.board_id ?? ""),
    name: String(x.name ?? ""),
    color: typeof x.color === "string" ? x.color : "#99aab5",
    position: typeof x.position === "number" ? x.position : 0,
    permissions: parsePerms(x.permissions),
    is_everyone: x.is_everyone === true,
  }));
};

export default RolesPanel;
