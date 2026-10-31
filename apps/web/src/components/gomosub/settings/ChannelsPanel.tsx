import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { GripVertical, Loader2, PenLine, Plus, Trash2, Hash, MessageSquare, Lock, SlidersHorizontal, FolderPlus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { buildOverwriteBody, overwriteTriState } from "./permissions";
import { TriStateControl, type TriState } from "./TriStateControl";
import { csrfHeaders, type ChannelOverwrite, type Role, type SettingsCategory, type SettingsChannel } from "./types";
import { inputCls, settingsFormCard, settingsSectionTitle } from "./ui";

type Props = {
  boardId: string;
  channels: SettingsChannel[];
  categories: SettingsCategory[];
  roles: Role[];
  overwrites: ChannelOverwrite[];
  canManage: boolean;
  onChanged: () => Promise<void>;
  onPatchChannels: (next: SettingsChannel[]) => void;
  onOpenOverwrites: (channelId: string) => void;
  openChannelId: string | null;
};

const slugify = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "").slice(0, 30);

const ChannelsPanel = ({ boardId, channels, categories, roles, overwrites, canManage, onChanged, onPatchChannels, onOpenOverwrites, openChannelId }: Props) => {
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

  // Display order: uncategorized (when non-empty), then categories in order.
  const displayGroups = useMemo(() => {
    const arr: { key: string; catId: string | null; label: string; channels: SettingsChannel[] }[] = [];
    const unc = groups.get(null) ?? [];
    if (unc.length > 0) arr.push({ key: "__none", catId: null, label: "Без категории", channels: unc });
    for (const c of sortedCats) arr.push({ key: `cat:${c.id}`, catId: c.id, label: c.name, channels: groups.get(c.id) ?? [] });
    return arr;
  }, [groups, sortedCats]);

  // ─── Pointer drag-and-drop (mouse + touch) ────────────────────────────────
  // Grip has touch-action:none so a touch drag never fights page scroll.
  // Drop target: {catId, beforeId} — beforeId null means append to the group.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ catId: string | null; beforeId: string | null } | null>(null);
  const [persisting, setPersisting] = useState(false);
  const dragState = useRef<{ id: string; started: boolean } | null>(null);

  const channelById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);

  const finishDrag = () => {
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragUp);
    window.removeEventListener("pointercancel", onDragCancel);
    dragState.current = null;
  };

  const onDragMove = (e: PointerEvent) => {
    const st = dragState.current;
    if (!st) return;
    st.started = true;
    setDragId(st.id);
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const row = el?.closest?.("[data-chid]") as HTMLElement | null;
    if (row?.dataset.chid && row.dataset.chid !== st.id) {
      const rect = row.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      setDropTarget({ catId: row.dataset.cat || null, beforeId: before ? row.dataset.chid : nextSiblingId(row.dataset.chid as string) });
      return;
    }
    const cat = el?.closest?.("[data-catdrop]") as HTMLElement | null;
    if (cat) {
      const catId = (cat.dataset.catdrop || null) as string | null;
      setDropTarget({ catId, beforeId: null });
      return;
    }
    setDropTarget(null);
  };

  // Insert after the hovered row (when pointing at its lower half).
  const nextSiblingId = (rowId: string): string | null => {
    for (const g of displayGroupsRef.current) {
      const idx = g.channels.findIndex((c) => c.id === rowId);
      if (idx >= 0) return g.channels[idx + 1]?.id ?? null;
    }
    return null;
  };
  const displayGroupsRef = useRef(displayGroups);
  displayGroupsRef.current = displayGroups;

  const onDragUp = () => {
    const st = dragState.current;
    const target = dropTargetRef.current;
    finishDrag();
    setDragId(null);
    if (st?.started && target) void commitDrop(st.id, target);
    else setDropTarget(null);
  };
  const dropTargetRef = useRef(dropTarget);
  dropTargetRef.current = dropTarget;

  const onDragCancel = () => {
    finishDrag();
    setDragId(null);
    setDropTarget(null);
  };

  const startDrag = (e: React.PointerEvent, chId: string) => {
    if (!canManage || persisting) return;
    e.preventDefault();
    dragState.current = { id: chId, started: false };
    setDropTarget(null);
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragUp);
    window.addEventListener("pointercancel", onDragCancel);
  };

  const commitDrop = async (chId: string, target: { catId: string | null; beforeId: string | null }) => {
    setDropTarget(null);
    const moved = channelById.get(chId);
    if (!moved) return;
    // Build the new flat order in display order.
    const ordered: { ch: SettingsChannel; catId: string | null }[] = [];
    for (const g of displayGroups) {
      const list = g.channels.filter((c) => c.id !== chId);
      if (g.catId === target.catId) {
        if (target.beforeId) {
          const idx = list.findIndex((c) => c.id === target.beforeId);
          list.splice(idx >= 0 ? idx : list.length, 0, moved);
        } else {
          list.push(moved);
        }
      }
      for (const c of list) ordered.push({ ch: c, catId: g.catId });
    }
    // Include channels of unknown groups (shouldn't happen, but never drop).
    for (const c of channels) {
      if (!ordered.some((o) => o.ch.id === c.id)) ordered.push({ ch: c, catId: c.category_id ?? null });
    }
    const movedCatChanged = (moved.category_id ?? null) !== target.catId;
    setPersisting(true);
    try {
      if (movedCatChanged) {
        const r = await fetch(`/api/v1/channels?id=eq.${chId}&board_id=eq.${boardId}`, {
          method: "PUT", headers: csrfHeaders(true),
          body: JSON.stringify({ category_id: target.catId }),
        });
        if (!r.ok) throw new Error("category");
      }
      const jobs: Promise<Response>[] = [];
      ordered.forEach((o, i) => {
        if (o.ch.sort_order !== i) {
          jobs.push(fetch(`/api/v1/channels?id=eq.${o.ch.id}&board_id=eq.${boardId}`, {
            method: "PUT", headers: csrfHeaders(true), body: JSON.stringify({ sort_order: i }),
          }));
        }
      });
      const results = await Promise.all(jobs);
      if (results.some((r) => !r.ok)) throw new Error("order");
      // Patch the parent list in place: no full reload, no spinner, the
      // dragged row and scroll position stay exactly where they are.
      onPatchChannels(ordered.map((o, i) => ({ ...o.ch, sort_order: i, category_id: o.catId })));
      toast.success("Каналы обновлены");
    } catch {
      toast.error("Не удалось сохранить порядок");
      await reload();
    }
    setPersisting(false);
  };

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

  const rowRefs = useRef(new Map<string, HTMLDivElement | null>());

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
    const patch = buildOverwriteBody(ex, perm, state);
    const body = { board_id: boardId, channel_id: chId, role_id: roleId, ...patch };
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
    // Targeted refresh of this channel's overwrites only: the panel stays
    // open and the page never reloads or jumps.
    await onOpenOverwrites(chId);
  };

  const renderChannel = (ch: SettingsChannel, catId: string | null) => {
    const isOpen = openChannelId === ch.id;
    const isEditing = editingId === ch.id;
    const isDragged = dragId === ch.id;
    const showBefore = dropTarget?.beforeId === ch.id;
    return (
      <div key={ch.id} data-chid={ch.id} data-cat={catId ?? ""} className={cn(isDragged && "opacity-40")}>
        {showBefore && <div className="h-0.5 rounded bg-primary mx-1 -my-0.5 relative z-10" />}
        <div ref={(el) => { rowRefs.current.set(ch.id, el); if (!el) rowRefs.current.delete(ch.id); }}
          data-chid={ch.id} data-cat={catId ?? ""}
          className="rounded-2xl border border-border/60 bg-surface overflow-hidden">
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          {canManage && (
            <div
              onPointerDown={(e) => startDrag(e, ch.id)}
              className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground/60 hover:text-foreground shrink-0"
              title="Тянуть чтобы переместить"
            >
              <GripVertical className="w-4 h-4" />
            </div>
          )}
          <span className={ch.kind === "text"
            ? "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-sky-500/15 text-sky-400"
            : ch.is_private ? "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-amber-500/15 text-amber-500"
            : "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-muted text-muted-foreground"}>
            {ch.kind === "text"
              ? <MessageSquare className="w-4 h-4" />
              : ch.is_private ? <Lock className="w-4 h-4" /> : <Hash className="w-4 h-4" />}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[15px] font-semibold truncate">{ch.name}</span>
              {ch.kind === "text" && <Badge variant="secondary" className="text-[10px] rounded shrink-0">чат</Badge>}
              {ch.is_private && <Badge variant="outline" className="text-[10px] rounded shrink-0 text-amber-600 border-amber-500/40">приват</Badge>}
            </div>
            <div className="text-xs text-muted-foreground truncate">/c/{ch.slug}</div>
          </div>
          {canManage && (
            <div className="flex items-center gap-0.5 shrink-0">
              <Button size="sm" variant="ghost" className={cn("h-8 w-8 p-0 rounded-lg", isOpen && "bg-primary/10 text-primary")} title="Права доступа"
                onClick={() => (isOpen ? onOpenOverwrites("") : (setEditingId(null), onOpenOverwrites(ch.id)))}>
                <SlidersHorizontal className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 rounded-lg" title="Изменить"
                onClick={() => {
                  setEditingId(isEditing ? null : ch.id);
                  setEdit({ name: ch.name, kind: ch.kind ?? "forum", category_id: ch.category_id ?? "__none", is_private: ch.is_private });
                }}>
                <PenLine className={cn("w-4 h-4", isEditing && "text-primary")} />
              </Button>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 rounded-lg text-destructive hover:text-destructive hover:bg-destructive/10" title="Удалить"
                onClick={() => deleteChannel(ch)}><Trash2 className="w-4 h-4" /></Button>
            </div>
          )}
        </div>
        {isEditing && (
          <div className="border-t border-border/40 px-3 py-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
              <div className="space-y-1.5">
                <div className={settingsSectionTitle}>Название</div>
                <Input value={edit.name} maxLength={50} onChange={(e) => setEdit((p) => ({ ...p, name: e.target.value }))} className={inputCls("h-9 text-sm")} />
              </div>
              <div className="space-y-1.5">
                <div className={settingsSectionTitle}>Категория</div>
                <Select value={edit.category_id} onValueChange={(v) => setEdit((p) => ({ ...p, category_id: v }))}>
                  <SelectTrigger className={inputCls("h-9 text-sm")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Без категории</SelectItem>
                    {sortedCats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex rounded-lg bg-muted/60 p-0.5 gap-0.5">
                <button type="button" onClick={() => setEdit((p) => ({ ...p, kind: "forum" }))}
                  className={cn("h-7 px-3 rounded-md text-xs font-medium transition-colors", edit.kind === "forum" ? "bg-surface shadow-sm" : "text-muted-foreground hover:text-foreground")}># Форум</button>
                <button type="button" onClick={() => setEdit((p) => ({ ...p, kind: "text" }))}
                  className={cn("h-7 px-3 rounded-md text-xs font-medium transition-colors", edit.kind === "text" ? "bg-surface shadow-sm" : "text-muted-foreground hover:text-foreground")}>Чат</button>
              </div>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" className="h-8 text-xs rounded-lg" onClick={() => setEditingId(null)}>Отмена</Button>
              <Button size="sm" className="h-8 text-xs rounded-lg" onClick={() => saveEdit(ch)}>Сохранить</Button>
            </div>
            <label className="flex items-center gap-3 px-1 py-1 cursor-pointer">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Приватный канал</span>
                <span className="block text-xs text-muted-foreground">Видят только роли с доступом</span>
              </span>
              <Switch checked={edit.is_private} onCheckedChange={(v) => setEdit((p) => ({ ...p, is_private: v }))} className="shrink-0" />
            </label>
          </div>
        )}
        {isOpen && (
          <div className="border-t border-border/40 px-3 py-2">
            <div className="text-[11px] text-muted-foreground py-1">
              ✓ разрешить · ✕ запретить · – наследовать. Запрет побеждает.
            </div>
            <div className="divide-y divide-border/40">
              {roles.map((role) => {
                const ow = overwrites.find((o) => o.channel_id === ch.id && o.role_id === role.id);
                return (
                  <div key={role.id} className="flex items-center gap-2 py-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: role.color }} />
                    <span className="text-sm font-medium flex-1 min-w-0 truncate">{role.name}</span>
                    <span className="hidden sm:inline text-[11px] uppercase tracking-wide text-muted-foreground w-12">Вид</span>
                    <TriStateControl size="sm" state={overwriteTriState(ow, "view_channel")}
                      disabled={savingOw === `${ch.id}:${role.id}:view_channel`}
                      onPick={(s) => setOverwrite(ch.id, role.id, "view_channel", s)} />
                    <span className="hidden sm:inline text-[11px] uppercase tracking-wide text-muted-foreground w-12">Текст</span>
                    <TriStateControl size="sm" state={overwriteTriState(ow, "send_messages")}
                      disabled={savingOw === `${ch.id}:${role.id}:send_messages`}
                      onPick={(s) => setOverwrite(ch.id, role.id, "send_messages", s)} />
                  </div>
                );
              })}
            </div>
          </div>
        )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {canManage && (
        <div className={settingsFormCard}>
          <div className={settingsSectionTitle}>Новый канал</div>
          <div className="grid gap-3 sm:grid-cols-[1fr_140px_150px]">
            <Input placeholder="Название" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={50} className={inputCls("h-9")} />
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
        <div className={settingsFormCard}>
          <div className={settingsSectionTitle}>Категории</div>
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
            <Input placeholder="Новая категория" value={newCatName} onChange={(e) => setNewCatName(e.target.value)} maxLength={40} className={inputCls("h-8 text-sm")} />
            <Button size="sm" variant="outline" className="h-8" onClick={createCategory} disabled={!newCatName.trim()}>
              <FolderPlus className="w-4 h-4 mr-1" />Добавить
            </Button>
          </div>
        </div>
      )}

      {persisting && <div className="text-xs text-muted-foreground text-center">Сохранение порядка…</div>}
      {displayGroups.map((g) => (
        <div key={g.key} data-catdrop={g.catId ?? ""} className="space-y-1.5 rounded-lg">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</div>
          {g.channels.length === 0 ? (
            <div className={cn(
              "rounded-lg border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground",
              dropTarget && dropTarget.catId === g.catId && dropTarget.beforeId === null && "border-primary bg-primary/5 text-primary",
            )}>
              {dropTarget && dropTarget.catId === g.catId ? "Отпусти сюда" : "Пусто — тяни сюда каналы"}
            </div>
          ) : (
            g.channels.map((ch) => renderChannel(ch, g.catId))
          )}
          {g.channels.length > 0 && dropTarget && dropTarget.catId === g.catId && dropTarget.beforeId === null && (
            <div className="h-0.5 rounded bg-primary mx-1" />
          )}
        </div>
      ))}
      {channels.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Каналов пока нет</p>}
    </div>
  );
};

export default ChannelsPanel;
