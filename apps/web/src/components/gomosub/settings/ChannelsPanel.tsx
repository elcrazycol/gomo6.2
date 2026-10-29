import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, Hash, MessageSquare, Lock, Shield, ChevronUp, ChevronDown, FolderPlus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { applyTriState, overwriteTriState, type TriState } from "./permissions";
import { csrfHeaders, type ChannelOverwrite, type Role, type SettingsCategory, type SettingsChannel } from "./types";

type Props = {
  boardId: string;
  channels: SettingsChannel[];
  categories: SettingsCategory[];
  roles: Role[];
  overwrites: ChannelOverwrite[];
  canManage: boolean;
  onChanged: () => Promise<void>;
  onOpenOverwrites: (channelId: string) => void;
  openChannelId: string | null;
};

const slugify = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "").slice(0, 30);

const TriButton = ({ state, onPick, disabled }: { state: TriState; onPick: (s: TriState) => void; disabled?: boolean }) => (
  <span className="inline-flex rounded-md border border-border/70 overflow-hidden">
    {(["deny", "inherit", "allow"] as TriState[]).map((s) => (
      <button
        key={s}
        type="button"
        disabled={disabled}
        onClick={() => onPick(s)}
        title={s === "allow" ? "Разрешить" : s === "deny" ? "Запретить" : "Наследовать"}
        className={cn(
          "w-7 h-6 text-[11px] font-bold transition-colors disabled:opacity-50",
          state === s
            ? s === "allow" ? "bg-emerald-500/90 text-white" : s === "deny" ? "bg-destructive text-white" : "bg-muted text-foreground"
            : "bg-surface text-muted-foreground hover:bg-muted",
        )}
      >
        {s === "allow" ? "✓" : s === "deny" ? "✕" : "–"}
      </button>
    ))}
  </span>
);

const ChannelsPanel = ({ boardId, channels, categories, roles, overwrites, canManage, onChanged, onOpenOverwrites, openChannelId }: Props) => {
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<"forum" | "text">("forum");
  const [newCategory, setNewCategory] = useState("__none");
  const [newPrivate, setNewPrivate] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ name: string; kind: "forum" | "text"; category_id: string; is_private: boolean }>({ name: "", kind: "forum", category_id: "__none", is_private: false });
  const [newCatName, setNewCatName] = useState("");
  const [renamingCat, setRenamingCat] = useState<string | null>(null);
  const [renamingCatName, setRenamingCatName] = useState("");
  const [savingOw, setSavingOw] = useState<string | null>(null);

  const sortedCats = useMemo(() => [...categories].sort((a, b) => a.sort_order - b.sort_order), [categories]);
  const groups = useMemo(() => {
    const byCat = new Map<string | null, SettingsChannel[]>();
    const list = [...channels].sort((a, b) => a.sort_order - b.sort_order);
    for (const ch of list) {
      const key = ch.category_id ?? null;
      if (!byCat.has(key)) byCat.set(key, []);
      byCat.get(key)!.push(ch);
    }
    return byCat;
  }, [channels]);

  const reload = onChanged;

  const createChannel = async () => {
    const name = newName.trim();
    if (!name || !canManage) return;
    setAdding(true);
    const r = await fetch("/api/v1/channels", {
      method: "POST", headers: csrfHeaders(true),
      body: JSON.stringify({
        board_id: boardId, slug: slugify(name) || `channel-${Date.now() % 10000}`, name,
        category: null, sort_order: channels.length,
        is_private: newPrivate, kind: newKind,
        category_id: newCategory === "__none" ? null : newCategory,
      }),
    });
    const d = await r.json().catch(() => null);
    setAdding(false);
    if (!r.ok || !d?.success) { toast.error(d?.error || "Не удалось создать канал"); return; }
    setNewName("");
    toast.success("Канал создан");
    await reload();
  };

  const saveEdit = async (ch: SettingsChannel) => {
    const name = edit.name.trim();
    if (!name) { toast.error("Название обязательно"); return; }
    const r = await fetch(`/api/v1/channels?id=eq.${ch.id}&board_id=eq.${boardId}`, {
      method: "PUT", headers: csrfHeaders(true),
      body: JSON.stringify({
        name, kind: edit.kind, is_private: edit.is_private,
        category_id: edit.category_id === "__none" ? null : edit.category_id,
      }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.success) { toast.error(d?.error || "Не удалось обновить канал"); return; }
    setEditingId(null);
    await reload();
  };

  const deleteChannel = async (ch: SettingsChannel) => {
    if (!window.confirm(`Удалить канал «${ch.name}»? Сообщения и записи будут потеряны.`)) return;
    const r = await fetch(`/api/v1/channels?id=eq.${ch.id}&board_id=eq.${boardId}`, { method: "DELETE", headers: csrfHeaders() });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.success) { toast.error(d?.error || "Не удалось удалить канал"); return; }
    toast.success("Канал удалён");
    await reload();
  };

  const moveChannel = async (ch: SettingsChannel, dir: -1 | 1) => {
    const group = groups.get(ch.category_id ?? null) ?? [];
    const idx = group.findIndex((c) => c.id === ch.id);
    const other = group[idx + dir];
    if (!other) return;
    // Swap sort orders with the neighbour.
    const swap = async (id: string, order: number) =>
      fetch(`/api/v1/channels?id=eq.${id}&board_id=eq.${boardId}`, {
        method: "PUT", headers: csrfHeaders(true), body: JSON.stringify({ sort_order: order }),
      });
    const ok1 = await (await swap(ch.id, other.sort_order)).ok;
    const ok2 = await (await swap(other.id, ch.sort_order)).ok;
    if (!ok1 || !ok2) toast.error("Не удалось сохранить порядок");
    await reload();
  };

  const createCategory = async () => {
    const name = newCatName.trim();
    if (!name || !canManage) return;
    const r = await fetch("/api/v1/channel_categories", {
      method: "POST", headers: csrfHeaders(true),
      body: JSON.stringify({ board_id: boardId, name, sort_order: categories.length }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.success) { toast.error(d?.error || "Не удалось создать категорию"); return; }
    setNewCatName("");
    await reload();
  };

  const renameCategory = async (cat: SettingsCategory) => {
    const name = renamingCatName.trim();
    if (!name) return;
    const r = await fetch(`/api/v1/channel_categories?id=eq.${cat.id}&board_id=eq.${boardId}`, {
      method: "PUT", headers: csrfHeaders(true), body: JSON.stringify({ name }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.success) { toast.error(d?.error || "Не удалось переименовать"); return; }
    setRenamingCat(null);
    await reload();
  };

  const deleteCategory = async (cat: SettingsCategory) => {
    if (!window.confirm(`Удалить категорию «${cat.name}»? Каналы останутся без категории.`)) return;
    const r = await fetch(`/api/v1/channel_categories?id=eq.${cat.id}&board_id=eq.${boardId}`, { method: "DELETE", headers: csrfHeaders() });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.success) { toast.error(d?.error || "Не удалось удалить категорию"); return; }
    await reload();
  };

  const setOverwrite = async (chId: string, roleId: string, perm: "view_channel" | "send_messages", state: TriState) => {
    if (!canManage) return;
    const key = `${chId}:${roleId}:${perm}`;
    setSavingOw(key);
    const ex = overwrites.find((o) => o.channel_id === chId && o.role_id === roleId);
    const patch = applyTriState(ex, perm, state);
    const other: "view_channel" | "send_messages" = perm === "view_channel" ? "send_messages" : "view_channel";
    const otherState = overwriteTriState(ex, other);
    const otherPatch = applyTriState({ allow: patch.allow, deny: patch.deny }, other, otherState);
    const body = {
      board_id: boardId, channel_id: chId, role_id: roleId,
      allow: otherPatch.allow, deny: otherPatch.deny,
      can_read: perm === "view_channel" ? patch.can_read : otherPatch.can_read,
      can_write: perm === "send_messages" ? patch.can_write : otherPatch.can_write,
    };
    let r: Response;
    if (ex?.id) {
      r = await fetch(`/api/v1/channel_permissions?id=eq.${ex.id}&board_id=eq.${boardId}`, {
        method: "PUT", headers: csrfHeaders(true), body: JSON.stringify(body),
      });
    } else {
      r = await fetch("/api/v1/channel_permissions", { method: "POST", headers: csrfHeaders(true), body: JSON.stringify(body) });
    }
    const d = await r.json().catch(() => null);
    setSavingOw(null);
    if (!r.ok || !d?.success) { toast.error(d?.error || "Не удалось обновить права"); return; }
    await onOpenOverwritesRefresh(chId);
  };

  const onOpenOverwritesRefresh = async (chId: string) => {
    onOpenOverwrites(chId);
    await reload();
  };

  const renderChannel = (ch: SettingsChannel) => {
    const isOpen = openChannelId === ch.id;
    const isEditing = editingId === ch.id;
    return (
      <div key={ch.id} className="rounded-lg border border-border/60 bg-surface">
        <div className="flex items-center gap-2 px-3 py-2">
          {ch.kind === "text"
            ? <MessageSquare className="w-4 h-4 text-sky-400 shrink-0" />
            : ch.is_private ? <Lock className="w-4 h-4 text-amber-500 shrink-0" /> : <Hash className="w-4 h-4 text-muted-foreground shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{ch.name}</div>
            <div className="text-xs text-muted-foreground truncate">
              /c/{ch.slug}{ch.kind === "text" ? " · чат" : ""}{ch.is_private ? " · приватный" : ""}
            </div>
          </div>
          {canManage && (
            <div className="flex items-center gap-0.5 shrink-0">
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Выше"
                onClick={() => moveChannel(ch, -1)}><ChevronUp className="w-3.5 h-3.5" /></Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Ниже"
                onClick={() => moveChannel(ch, 1)}><ChevronDown className="w-3.5 h-3.5" /></Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Права доступа"
                onClick={() => (isOpen ? onOpenOverwrites("") : (setEditingId(null), onOpenOverwrites(ch.id)))}>
                <Shield className={cn("w-3.5 h-3.5", isOpen && "text-primary")} />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" title="Изменить"
                onClick={() => {
                  setEditingId(ch.id);
                  setEdit({ name: ch.name, kind: ch.kind ?? "forum", category_id: ch.category_id ?? "__none", is_private: ch.is_private });
                }}>Изм.</Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" title="Удалить"
                onClick={() => deleteChannel(ch)}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          )}
        </div>
        {isEditing && (
          <div className="border-t border-border/60 p-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Название</Label>
                <Input value={edit.name} maxLength={50} onChange={(e) => setEdit((p) => ({ ...p, name: e.target.value }))} className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Категория</Label>
                <Select value={edit.category_id} onValueChange={(v) => setEdit((p) => ({ ...p, category_id: v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Без категории</SelectItem>
                    {sortedCats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-1">
                <Button type="button" size="sm" variant={edit.kind === "forum" ? "secondary" : "ghost"} className="h-7 text-xs"
                  onClick={() => setEdit((p) => ({ ...p, kind: "forum" }))}># Форум</Button>
                <Button type="button" size="sm" variant={edit.kind === "text" ? "secondary" : "ghost"} className="h-7 text-xs"
                  onClick={() => setEdit((p) => ({ ...p, kind: "text" }))}>Чат</Button>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Switch checked={edit.is_private} onCheckedChange={(v) => setEdit((p) => ({ ...p, is_private: v }))} />
                Приватный
              </label>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingId(null)}>Отмена</Button>
              <Button size="sm" className="h-7 text-xs" onClick={() => saveEdit(ch)}>Сохранить</Button>
            </div>
          </div>
        )}
        {isOpen && (
          <div className="border-t border-border/60 p-3 space-y-2">
            <div className="text-xs text-muted-foreground">
              ✓ — разрешить · ✕ — запретить (перекрывает) · – — наследовать. Запрет побеждает.
            </div>
            {roles.map((role) => {
              const ow = overwrites.find((o) => o.channel_id === ch.id && o.role_id === role.id);
              return (
                <div key={role.id} className="flex items-center gap-2 py-1">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: role.color }} />
                  <span className="text-sm flex-1 min-w-0 truncate">{role.name}</span>
                  <span className="hidden sm:inline text-xs text-muted-foreground w-14">Вид</span>
                  <TriButton state={overwriteTriState(ow, "view_channel")}
                    disabled={savingOw === `${ch.id}:${role.id}:view_channel`}
                    onPick={(s) => setOverwrite(ch.id, role.id, "view_channel", s)} />
                  <span className="hidden sm:inline text-xs text-muted-foreground w-14">Текст</span>
                  <TriButton state={overwriteTriState(ow, "send_messages")}
                    disabled={savingOw === `${ch.id}:${role.id}:send_messages`}
                    onPick={(s) => setOverwrite(ch.id, role.id, "send_messages", s)} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="rounded-xl border border-border/70 bg-muted/30 p-4 space-y-3">
          <div className="text-sm font-medium">Новый канал</div>
          <div className="grid gap-3 sm:grid-cols-[1fr_140px_150px]">
            <Input placeholder="Название" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={50} className="h-9" />
            <div className="flex items-center gap-1">
              <Button type="button" size="sm" variant={newKind === "forum" ? "secondary" : "ghost"} className="h-8 text-xs flex-1"
                onClick={() => setNewKind("forum")}># Форум</Button>
              <Button type="button" size="sm" variant={newKind === "text" ? "secondary" : "ghost"} className="h-8 text-xs flex-1"
                onClick={() => setNewKind("text")}>Чат</Button>
            </div>
            <Select value={newCategory} onValueChange={setNewCategory}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Категория" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Без категории</SelectItem>
                {sortedCats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Switch checked={newPrivate} onCheckedChange={setNewPrivate} />
              <Lock className="w-3.5 h-3.5" />Приватный
            </label>
            <span className="flex-1" />
            <Button size="sm" onClick={createChannel} disabled={adding || !newName.trim()}>
              {adding ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}Добавить
            </Button>
          </div>
        </div>
      )}

      {canManage && (
        <div className="rounded-xl border border-border/70 bg-muted/30 p-4 space-y-2">
          <div className="text-sm font-medium">Категории</div>
          {sortedCats.map((c) => (
            <div key={c.id} className="flex items-center gap-2">
              {renamingCat === c.id ? (
                <>
                  <Input value={renamingCatName} maxLength={40} onChange={(e) => setRenamingCatName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") renameCategory(c); }} className="h-8 text-sm" autoFocus />
                  <Button size="sm" className="h-8 text-xs" onClick={() => renameCategory(c)}>OK</Button>
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setRenamingCat(null)}>✕</Button>
                </>
              ) : (
                <>
                  <span className="text-sm flex-1 truncate">{c.name}</span>
                  <Badge variant="secondary" className="text-[10px]">{groups.get(c.id)?.length ?? 0}</Badge>
                  <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs"
                    onClick={() => { setRenamingCat(c.id); setRenamingCatName(c.name); }}>Переименовать</Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => deleteCategory(c)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
          <div className="flex gap-2">
            <Input placeholder="Новая категория" value={newCatName} onChange={(e) => setNewCatName(e.target.value)} maxLength={40} className="h-8 text-sm" />
            <Button size="sm" variant="outline" className="h-8" onClick={createCategory} disabled={!newCatName.trim()}>
              <FolderPlus className="w-4 h-4 mr-1" />Добавить
            </Button>
          </div>
        </div>
      )}

      {(groups.get(null) ?? []).length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Без категории</div>
          {(groups.get(null) ?? []).map(renderChannel)}
        </div>
      )}
      {sortedCats.map((c) => (
        <div key={c.id} className="space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{c.name}</div>
          {(groups.get(c.id) ?? []).length === 0
            ? <p className="text-xs text-muted-foreground pl-1">Пусто</p>
            : (groups.get(c.id) ?? []).map(renderChannel)}
        </div>
      ))}
      {channels.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Каналов пока нет</p>}
    </div>
  );
};

export default ChannelsPanel;
