import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { storageUrl, uploadFile } from "@/utils/storage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, Save, Settings, Plus, Trash2, GripVertical, Hash, Shield, Lock, Eye, EyeOff, Users } from "lucide-react";
import { toast } from "sonner";
import { renderPreviewContent } from "@/utils/emojiUtils";

type TabValue = "general" | "channels" | "roles";

const parseRulesMarkdown = (rules: string | null) => {
  const raw = (rules || "").trim();
  if (!raw) return { standardRules: "Уважай участников и соблюдай тематику саба.", allowedRules: [""], forbiddenRules: [""] };
  const canMarker = /###\s*Можно/i, cantMarker = /###\s*Нельзя/i;
  const canMatch = raw.search(canMarker), cantMatch = raw.search(cantMarker);
  let standardRules = raw, canPart = "", cantPart = "";
  if (canMatch >= 0 || cantMatch >= 0) {
    const firstBlock = [canMatch, cantMatch].filter((x) => x >= 0).sort((a, b) => a - b)[0] ?? 0;
    standardRules = raw.slice(0, firstBlock).trim();
    if (canMatch >= 0 && cantMatch >= 0) { if (canMatch < cantMatch) { canPart = raw.slice(canMatch, cantMatch); cantPart = raw.slice(cantMatch); } else { cantPart = raw.slice(cantMatch, canMatch); canPart = raw.slice(canMatch); } }
    else if (canMatch >= 0) canPart = raw.slice(canMatch); else if (cantMatch >= 0) cantPart = raw.slice(cantMatch);
  }
  const extractBullets = (text: string) => text.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("- ")).map((l) => l.replace(/^-\s*/, ""));
  return { standardRules: standardRules || "Уважай участников и соблюдай тематику саба.", allowedRules: extractBullets(canPart).length ? extractBullets(canPart) : [""], forbiddenRules: extractBullets(cantPart).length ? extractBullets(cantPart) : [""] };
};

const buildRulesMarkdown = (s: string, a: string[], f: string[]) => {
  const blocks: string[] = [];
  if (s.trim()) blocks.push(s.trim());
  const al = a.map((x) => x.trim()).filter(Boolean), fl = f.map((x) => x.trim()).filter(Boolean);
  if (al.length) blocks.push(`### Можно\n${al.map((x) => `- ${x}`).join("\n")}`);
  if (fl.length) blocks.push(`### Нельзя\n${fl.map((x) => `- ${x}`).join("\n")}`);
  return blocks.join("\n\n").trim() || null;
};

const PERMISSION_LABELS: Record<string, string> = { can_manage_roles: "Управление ролями", can_manage_channels: "Управление каналами", can_manage_members: "Управление участниками", can_delete_threads: "Удаление тредов", can_pin_threads: "Закрепление тредов" };

const GomoSubSettings = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [activeTab, setActiveTab] = useState<TabValue>("general");

  const [channels, setChannels] = useState<{ id: string; slug: string; name: string; category: string; sort_order: number; is_private: boolean }[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelSlug, setNewChannelSlug] = useState("");
  const [newChannelCategory, setNewChannelCategory] = useState("");
  const [newChannelIsPrivate, setNewChannelIsPrivate] = useState(false);
  const [addingChannel, setAddingChannel] = useState(false);
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [reordering, setReordering] = useState(false);

  const [roles, setRoles] = useState<{ id: string; board_id: string; name: string; color: string; position: number; permissions: Record<string, boolean> }[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleColor, setNewRoleColor] = useState("#99aab5");
  const [newRolePermissions, setNewRolePermissions] = useState<Record<string, boolean>>({});
  const [addingRole, setAddingRole] = useState(false);

  const [members, setMembers] = useState<{ user_id: string; role_id: string | null; profiles?: { username: string } }[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [managingPermsChannelId, setManagingPermsChannelId] = useState<string | null>(null);
  const [channelPerms, setChannelPerms] = useState<{ id?: string; channel_id: string; role_id: string; can_read: boolean; can_write: boolean }[]>([]);
  const [channelPermsLoading, setChannelPermsLoading] = useState(false);

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  const [form, setForm] = useState({ id: "", name: "", description: "", gomosub_avatar_url: "", cover_image_url: "", gomosub_tags: [] as string[] });
  const [standardRules, setStandardRules] = useState("");
  const [allowedRules, setAllowedRules] = useState<string[]>([""]);
  const [forbiddenRules, setForbiddenRules] = useState<string[]>([""]);
  const rulesPreview = useMemo(() => buildRulesMarkdown(standardRules, allowedRules, forbiddenRules) || "", [standardRules, allowedRules, forbiddenRules]);

  const loadChannels = async (boardId: string) => { setChannelsLoading(true); const r = await fetch(`/api/v1/channels?board_id=eq.${boardId}&order=sort_order.asc`); const d = await r.json(); setChannels((d.data || []) as typeof channels); setChannelsLoading(false); };
  const loadRoles = async (boardId: string) => { setRolesLoading(true); const r = await fetch(`/api/v1/gomosub_roles?board_id=eq.${boardId}&order=position.desc`); const d = await r.json(); const data = (d.data || []) as { id: string; board_id: string; name: string; color: string; position: number; permissions: unknown }[]; setRoles(data.map((x) => ({ ...x, permissions: typeof x.permissions === "string" ? JSON.parse(x.permissions as string) : (x.permissions as Record<string, boolean> || {}) }))); setRolesLoading(false); };
  const loadMembers = async (boardId: string) => { setMembersLoading(true); const r = await fetch(`/api/v1/gomosub_memberships?board_id=eq.${boardId}`); const d = await r.json(); const data = (d.data || []) as { user_id: string; role_id: string | null }[]; if (data.length > 0) { const userIds = [...new Set(data.map((m) => m.user_id))].join(","); const pr = await fetch(`/api/v1/profiles?id=in.(${userIds})`); const pd = await pr.json(); const profiles = (pd.data || []) as { id: string; username: string }[]; const pm = new Map(profiles.map((p) => [p.id, p])); setMembers(data.map((m) => ({ ...m, profiles: pm.get(m.user_id) }))); } else setMembers([]); setMembersLoading(false); };
  const loadChannelPerms = async (channelId: string) => { setChannelPermsLoading(true); const r = await fetch(`/api/v1/channel_permissions?channel_id=eq.${channelId}`); const d = await r.json(); setChannelPerms((d.data || []) as typeof channelPerms); setChannelPermsLoading(false); };

  useEffect(() => { const load = async () => { setLoading(true); const { data: { user } } = await api.auth.getUser(); if (!user) { navigate("/auth"); return; } const { data: board } = await api.from("boards").select("id,name,description,rules_markdown,gomosub_avatar_url,cover_image_url,owner_id,gomosub_tags,is_gomosub").eq("slug", slug).eq("is_gomosub", true).maybeSingle(); if (!board) { toast.error("G-саб не найден"); navigate("/g"); return; } if (board.owner_id !== user.id) { toast.error("Только создатель может менять настройки"); navigate(`/g/${slug}`); return; } const tags = Array.isArray(board.gomosub_tags) ? board.gomosub_tags.filter((t: unknown): t is string => typeof t === "string") : []; const parsedRules = parseRulesMarkdown(board.rules_markdown); setStandardRules(parsedRules.standardRules); setAllowedRules(parsedRules.allowedRules); setForbiddenRules(parsedRules.forbiddenRules); setIsOwner(true); setForm({ id: board.id, name: board.name || "", description: board.description || "", gomosub_avatar_url: board.gomosub_avatar_url || "", cover_image_url: board.cover_image_url || "", gomosub_tags: tags }); setLoading(false); await Promise.all([loadChannels(board.id), loadRoles(board.id), loadMembers(board.id)]); }; load(); }, [navigate, slug]);

  const addTag = () => { const t = tagInput.trim(); if (!t) return; if (form.gomosub_tags.includes(t)) { toast.error("Такой тег уже добавлен"); return; } if (form.gomosub_tags.length >= 20) { toast.error("Максимум 20 кастомных тегов"); return; } setForm((p) => ({ ...p, gomosub_tags: [...p.gomosub_tags, t] })); setTagInput(""); };
  const removeTag = (tag: string) => setForm((p) => ({ ...p, gomosub_tags: p.gomosub_tags.filter((t) => t !== tag) }));
  const updateRuleItem = (kind: "allowed" | "forbidden", i: number, v: string) => { const s = kind === "allowed" ? setAllowedRules : setForbiddenRules; s((p) => p.map((item, idx) => idx === i ? v : item)); };
  const addRuleItem = (k: "allowed" | "forbidden") => { const s = k === "allowed" ? setAllowedRules : setForbiddenRules; s((p) => [...p, ""]); };
  const removeRuleItem = (k: "allowed" | "forbidden", i: number) => { const s = k === "allowed" ? setAllowedRules : setForbiddenRules; s((p) => { const n = p.filter((_, idx) => idx !== i); return n.length ? n : [""]; }); };

  const uploadSingleImage = async (file: File, kind: "avatar" | "cover") => { if (!["image/jpeg","image/jpg","image/png","image/webp","image/gif"].includes(file.type)) { toast.error("Неподдерживаемый формат"); return; } if (file.size > 10*1024*1024) { toast.error("Файл слишком большой. Максимум 10MB"); return; } if (kind === "avatar") setUploadingAvatar(true); else setUploadingCover(true); try { const { data: { user } } = await api.auth.getUser(); if (!user) { toast.error("Нужно войти"); return; } const ext = file.name.split(".").pop() || "jpg"; const fn = `${user.id}/${Date.now()}_${kind}.${ext}`; await uploadFile("post-images", fn, file); if (kind === "avatar") setForm((p) => ({ ...p, gomosub_avatar_url: fn })); else setForm((p) => ({ ...p, cover_image_url: fn })); toast.success(kind === "avatar" ? "Аватар обновлен" : "Фон обновлен"); } catch (e) { toast.error((e instanceof Error ? e.message : String(e)) || "Не удалось загрузить"); } finally { if (kind === "avatar") setUploadingAvatar(false); else setUploadingCover(false); } };

  const handleAddChannel = async () => { const name = newChannelName.trim(); const cs = newChannelSlug.trim().toLowerCase().replace(/\s+/g, "-") || name.toLowerCase().replace(/\s+/g, "-"); if (!name) { toast.error("Название канала обязательно"); return; } setAddingChannel(true); const r = await fetch('/api/v1/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ board_id: form.id, slug: cs, name, category: newChannelCategory.trim() || null, sort_order: channels.length, is_private: newChannelIsPrivate }) }); const d = await r.json(); setAddingChannel(false); if (!r.ok || !d.success) { toast.error(d.error || "Не удалось создать канал"); return; } setNewChannelName(""); setNewChannelSlug(""); setNewChannelCategory(""); setNewChannelIsPrivate(false); await loadChannels(form.id); toast.success("Канал создан"); };
  const handleDeleteChannel = async (chId: string) => { const r = await fetch(`/api/v1/channels?id=eq.${chId}`, { method: 'DELETE' }); const d = await r.json(); if (!r.ok || !d.success) { toast.error(d.error || "Не удалось удалить канал"); return; } await loadChannels(form.id); toast.success("Канал удалён"); };
  const handleUpdateChannel = async (chId: string, updates: Record<string, unknown>) => { const r = await fetch(`/api/v1/channels?id=eq.${chId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) }); const d = await r.json(); if (!r.ok || !d.success) { toast.error(d.error || "Не удалось обновить канал"); return; } setEditingChannelId(null); await loadChannels(form.id); };
  const handleAddRole = async () => { const name = newRoleName.trim(); if (!name) { toast.error("Название роли обязательно"); return; } setAddingRole(true); const r = await fetch('/api/v1/gomosub_roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ board_id: form.id, name, color: newRoleColor, position: roles.length, permissions: newRolePermissions }) }); const d = await r.json(); setAddingRole(false); if (!r.ok || !d.success) { toast.error(d.error || "Не удалось создать роль"); return; } setNewRoleName(""); setNewRoleColor("#99aab5"); setNewRolePermissions({}); await loadRoles(form.id); toast.success("Роль создана"); };
  const handleDeleteRole = async (rId: string) => { const r = await fetch(`/api/v1/gomosub_roles?id=eq.${rId}`, { method: 'DELETE' }); const d = await r.json(); if (!r.ok || !d.success) { toast.error(d.error || "Не удалось удалить роль"); return; } await Promise.all([loadRoles(form.id), loadMembers(form.id)]); toast.success("Роль удалена"); };
  const handleAssignRole = async (userId: string, roleId: string | null) => { const r = await fetch(`/api/v1/gomosub_memberships?board_id=eq.${form.id}&user_id=eq.${userId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role_id: roleId }) }); const d = await r.json(); if (!r.ok || !d.success) { toast.error(d.error || "Не удалось назначить роль"); return; } await loadMembers(form.id); toast.success(roleId ? "Роль назначена" : "Роль снята"); };
  const handleOpenChannelPerms = async (chId: string) => { setManagingPermsChannelId(chId); await loadChannelPerms(chId); };
  const handleTogglePermRole = async (chId: string, roleId: string, cr: boolean, cw: boolean) => { const ex = channelPerms.find((p) => p.role_id === roleId); if (ex?.id) { const r = await fetch(`/api/v1/channel_permissions?id=eq.${ex.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ can_read: cr, can_write: cw }) }); const d = await r.json(); if (!r.ok || !d.success) { toast.error("Не удалось обновить права"); return; } } else if (cr || cw) { const r = await fetch('/api/v1/channel_permissions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel_id: chId, role_id: roleId, can_read: cr, can_write: cw }) }); const d = await r.json(); if (!r.ok || !d.success) { toast.error("Не удалось добавить права"); return; } } await loadChannelPerms(chId); };
  const handleToggleChannelPrivacy = async (chId: string, isPrivate: boolean) => { await handleUpdateChannel(chId, { is_private: isPrivate }); };

  const handleReorderChannels = async (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    setReordering(true);
    const reordered = [...channels];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    setChannels(reordered);
    const results = await Promise.all(reordered.map((ch, i) => fetch(`/api/v1/channels?id=eq.${ch.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sort_order: i }) }).catch(() => null)));
    const anyFailed = results.some((r) => !r || !r.ok);
    if (anyFailed) {
      toast.error("Не удалось сохранить порядок каналов");
      await loadChannels(form.id);
    } else {
      toast.success("Порядок каналов обновлён");
    }
    setReordering(false);
  };

  const handleDragStart = (e: React.DragEvent, idx: number) => { e.dataTransfer.setData("text/plain", ""); e.dataTransfer.effectAllowed = "move"; setDragIndex(idx); };
  const handleDragOver = (e: React.DragEvent, idx: number) => { e.preventDefault(); if (dragIndex !== null && dragIndex !== idx) { e.dataTransfer.dropEffect = "move"; } };
  const handleDrop = async (toIdx: number) => { if (dragIndex !== null && dragIndex !== toIdx) { await handleReorderChannels(dragIndex, toIdx); } setDragIndex(null); };

  const handleSave = async () => { if (!isOwner) return; if (!form.name.trim()) { toast.error("Название обязательно"); return; } if (!form.description.trim()) { toast.error("Описание обязательно"); return; } setSaving(true); const { error } = await api.from("boards").update({ name: form.name.trim(), description: form.description.trim(), rules_markdown: rulesPreview || null, gomosub_avatar_url: form.gomosub_avatar_url || null, cover_image_url: form.cover_image_url || null, gomosub_tags: form.gomosub_tags }).eq("id", form.id); setSaving(false); if (error) { toast.error((error as { message?: string }).message || "Не удалось сохранить"); return; } toast.success("Настройки g-саба сохранены"); };

  if (loading) return <div className="max-w-4xl mx-auto p-6 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="max-w-4xl mx-auto p-3 sm:p-6 space-y-4">
      <Card className="overflow-hidden border-primary/30">
        <div className="h-36 sm:h-44 bg-muted/30 border-b border-border relative">
          <input ref={coverInputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadSingleImage(file, "cover"); e.target.value = ""; }} />
          <button type="button" onClick={() => coverInputRef.current?.click()} className="group relative w-full h-full text-left">{form.cover_image_url ? <img src={storageUrl("post-images", form.cover_image_url) || form.cover_image_url} alt="cover" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-sm text-muted-foreground">{uploadingCover ? "Загрузка..." : "Нажми сюда, чтобы обновить фон"}</div>}<div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors" /></button>
          <div className="absolute -bottom-10 left-4 w-20 h-20 rounded-full border-4 border-background bg-card overflow-hidden flex items-center justify-center text-xl font-bold text-muted-foreground">
            <input ref={avatarInputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadSingleImage(file, "avatar"); e.target.value = ""; }} />
            <button type="button" onClick={() => avatarInputRef.current?.click()} className="group relative w-full h-full">{form.gomosub_avatar_url ? <img src={storageUrl("post-images", form.gomosub_avatar_url) || form.gomosub_avatar_url} alt="avatar" className="w-full h-full object-cover" /> : <span>{uploadingAvatar ? "..." : (form.name.trim()[0] || "g").toUpperCase()}</span>}<div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors" /></button>
          </div>
        </div>
        <CardHeader className="pt-12"><CardTitle className="flex items-center gap-2"><Settings className="w-5 h-5 text-primary" />Настройки g/{slug}</CardTitle>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)} className="mt-3"><TabsList className="grid w-full grid-cols-3"><TabsTrigger value="general">Основное</TabsTrigger><TabsTrigger value="channels">Каналы</TabsTrigger><TabsTrigger value="roles">Роли</TabsTrigger></TabsList></Tabs>
        </CardHeader>
        <CardContent className="space-y-5">
          {activeTab === "general" && (<><div className="text-xs text-muted-foreground">Для смены фото нажми прямо на аватар или фоновый прямоугольник в шапке.</div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><label className="text-sm font-medium">Название</label><Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} maxLength={80} /></div><div className="space-y-2"><label className="text-sm font-medium">Описание</label><Input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} maxLength={240} /></div></div><div className="space-y-2"><label className="text-sm font-medium">Базовые правила</label><Textarea value={standardRules} onChange={(e) => setStandardRules(e.target.value)} rows={3} /></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><div className="flex items-center justify-between"><label className="text-sm font-medium">Можно</label><Button size="sm" variant="outline" onClick={() => addRuleItem("allowed")}><Plus className="w-4 h-4" /></Button></div>{allowedRules.map((r, i) => (<div key={`a${i}`} className="flex gap-2"><Input value={r} onChange={(e) => updateRuleItem("allowed", i, e.target.value)} placeholder="Добавить разрешение" /><Button size="sm" variant="outline" onClick={() => removeRuleItem("allowed", i)}>x</Button></div>))}</div><div className="space-y-2"><div className="flex items-center justify-between"><label className="text-sm font-medium">Нельзя</label><Button size="sm" variant="outline" onClick={() => addRuleItem("forbidden")}><Plus className="w-4 h-4" /></Button></div>{forbiddenRules.map((r, i) => (<div key={`f${i}`} className="flex gap-2"><Input value={r} onChange={(e) => updateRuleItem("forbidden", i, e.target.value)} placeholder="Добавить ограничение" /><Button size="sm" variant="outline" onClick={() => removeRuleItem("forbidden", i)}>x</Button></div>))}</div></div><div className="space-y-2"><label className="text-sm font-medium">Кастомные теги</label><div className="flex flex-col sm:flex-row gap-2"><Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="новости, гайды, драмa..." maxLength={24} /><Button type="button" variant="outline" onClick={addTag} className="w-full sm:w-auto">Добавить</Button></div><div className="flex flex-wrap gap-2">{form.gomosub_tags.map((tag) => (<Badge key={tag} variant="secondary" className="cursor-pointer" onClick={() => removeTag(tag)} title="Нажми, чтобы удалить">#{tag}</Badge>))}</div></div></>)}
          {activeTab === "channels" && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">Каналы — как в Discord. Перетаскивай за <GripVertical className="w-3.5 h-3.5 inline text-muted-foreground" /> чтобы менять порядок.</div>
              <div className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-3"><div className="text-sm font-medium">Новый канал</div><div className="grid gap-3 sm:grid-cols-3"><Input placeholder="Название" value={newChannelName} onChange={(e) => setNewChannelName(e.target.value)} maxLength={50} /><Input placeholder="Слаг" value={newChannelSlug} onChange={(e) => setNewChannelSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"))} maxLength={30} /><Input placeholder="Категория" value={newChannelCategory} onChange={(e) => setNewChannelCategory(e.target.value)} maxLength={40} /></div><div className="flex items-center gap-3"><div className="flex items-center gap-2"><Switch id="ncpr" checked={newChannelIsPrivate} onCheckedChange={setNewChannelIsPrivate} /><Label htmlFor="ncpr" className="text-sm cursor-pointer">{newChannelIsPrivate ? <Lock className="w-3.5 h-3.5 inline mr-1" /> : <Eye className="w-3.5 h-3.5 inline mr-1" />}Приватный</Label></div>{newChannelIsPrivate && roles.length === 0 && <span className="text-xs text-muted-foreground">Создай роли во вкладке «Роли»</span>}</div><Button onClick={handleAddChannel} disabled={addingChannel || !newChannelName.trim()} size="sm">{addingChannel && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}<Plus className="w-4 h-4 mr-1" />Добавить</Button></div>
              {channelsLoading ? <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div> : channels.length === 0 ? <div className="text-sm text-muted-foreground text-center py-4">Каналов пока нет. Создай первый!</div> : <div className="space-y-2">{channels.map((ch, idx) => (<div key={ch.id}><div className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${dragIndex === idx ? "border-primary/50 bg-primary/5" : "border-border/60 bg-card"} ${dragIndex !== null && dragIndex !== idx ? "opacity-60" : ""}`}
                  draggable={!reordering} onDragStart={(e) => handleDragStart(e, idx)} onDragOver={(e) => handleDragOver(e, idx)} onDrop={() => handleDrop(idx)} onDragEnd={() => setDragIndex(null)}>
                  <div className="cursor-grab active:cursor-grabbing" title="Перетащить"><GripVertical className="w-4 h-4 text-muted-foreground shrink-0 hover:text-primary transition-colors" /></div>
                  {ch.is_private ? <Lock className="w-4 h-4 text-amber-500 shrink-0" /> : <Hash className="w-4 h-4 text-muted-foreground shrink-0" />}
                  {editingChannelId === ch.id ? (<div className="flex-1 flex items-center gap-2"><Input defaultValue={ch.name} className="h-7 text-sm" maxLength={50} onKeyDown={(e) => { if (e.key === "Enter") handleUpdateChannel(ch.id, { name: (e.target as HTMLInputElement).value }); }} autoFocus /><Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingChannelId(null)}>Отмена</Button></div>) : (<div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{ch.is_private ? "🔒 " : "# "}{ch.name}</div><div className="text-xs text-muted-foreground">/c/{ch.slug}{ch.category && <span className="ml-2">· {ch.category}</span>}{ch.is_private && <span className="ml-2 text-amber-500">· приватный</span>}</div></div>)}
                  <div className="flex items-center gap-1"><Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingChannelId(ch.id)} title="Переименовать">✎</Button><Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={async () => { await handleToggleChannelPrivacy(ch.id, !ch.is_private); }} title={ch.is_private ? "Сделать публичным" : "Сделать приватным"}>{ch.is_private ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}</Button><Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleOpenChannelPerms(ch.id)} title="Права доступа"><Shield className="w-3.5 h-3.5" /></Button><Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => handleDeleteChannel(ch.id)} title="Удалить канал"><Trash2 className="w-4 h-4" /></Button></div></div>
                  {managingPermsChannelId === ch.id && (<div className="mt-2 ml-8 rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2"><div className="flex items-center justify-between"><span className="text-sm font-medium">Права доступа: {ch.name}</span><Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setManagingPermsChannelId(null)}>✕</Button></div>{!ch.is_private ? <p className="text-xs text-muted-foreground">Канал публичный — права ролей не применяются.</p> : ch.is_private && channelPermsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : ch.is_private && roles.length === 0 ? <p className="text-xs text-muted-foreground">Создай роли во вкладке «Роли»</p> : ch.is_private ? <div className="space-y-1.5">{roles.map((role) => { const perm = channelPerms.find((p) => p.role_id === role.id); const cr = perm?.can_read ?? false; const cw = perm?.can_write ?? false; return (<div key={role.id} className="flex items-center gap-3 py-1"><div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: role.color }} /><span className="text-sm flex-1 min-w-0 truncate">{role.name}</span><Label className="text-xs flex items-center gap-1 cursor-pointer"><Switch checked={cr} onCheckedChange={(v) => handleTogglePermRole(ch.id, role.id, v, cw)} />Чтение</Label><Label className="text-xs flex items-center gap-1 cursor-pointer"><Switch checked={cw} onCheckedChange={(v) => handleTogglePermRole(ch.id, role.id, cr, v)} />Запись</Label></div>); })}</div> : null}</div>)}</div>))}</div>}
            </div>
          )}
          {activeTab === "roles" && (<div className="space-y-5"><div className="text-sm text-muted-foreground">Роли — как в Discord. Назначай цвета, права и доступ к приватным каналам.</div><div className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-3"><div className="text-sm font-medium">Новая роль</div><div className="flex gap-3 items-end flex-wrap"><div className="space-y-1.5"><Label className="text-xs">Название</Label><Input placeholder="напр. Модератор" value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} maxLength={30} className="w-36" /></div><div className="space-y-1.5"><Label className="text-xs">Цвет</Label><div className="flex items-center gap-2"><input type="color" value={newRoleColor} onChange={(e) => setNewRoleColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0 p-0" /><Input value={newRoleColor} onChange={(e) => setNewRoleColor(e.target.value)} className="w-24 font-mono text-xs h-8" maxLength={7} /></div></div></div><div className="space-y-1.5"><Label className="text-xs">Права</Label><div className="flex flex-wrap gap-3">{Object.entries(PERMISSION_LABELS).map(([key, label]) => (<Label key={key} className="flex items-center gap-1.5 text-xs cursor-pointer"><Switch checked={newRolePermissions[key] || false} onCheckedChange={(v) => setNewRolePermissions((p) => ({ ...p, [key]: v }))} />{label}</Label>))}</div></div><Button onClick={handleAddRole} disabled={addingRole || !newRoleName.trim()} size="sm">{addingRole && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}<Plus className="w-4 h-4 mr-1" />Создать роль</Button></div>{rolesLoading ? <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div> : roles.length === 0 ? <div className="text-sm text-muted-foreground text-center py-4">Ролей пока нет</div> : <div className="space-y-2">{roles.map((role) => (<div key={role.id} className="rounded-lg border border-border/60 bg-card p-3 space-y-2"><div className="flex items-center gap-3"><div className="w-4 h-4 rounded-full shrink-0 ring-1 ring-border" style={{ backgroundColor: role.color }} /><span className="text-sm font-medium flex-1">{role.name}</span><span className="text-xs text-muted-foreground font-mono">{role.color}</span><Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => handleDeleteRole(role.id)} title="Удалить роль"><Trash2 className="w-4 h-4" /></Button></div>{Object.keys(role.permissions).length > 0 && <div className="flex flex-wrap gap-1 ml-7">{Object.entries(role.permissions).filter(([,v]) => v).map(([k]) => (<Badge key={k} variant="secondary" className="text-[10px]">{PERMISSION_LABELS[k] || k}</Badge>))}</div>}</div>))}</div>}<div className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-3"><div className="text-sm font-medium flex items-center gap-2"><Users className="w-4 h-4" />Участники ({members.length})</div>{membersLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : members.length === 0 ? <p className="text-xs text-muted-foreground">Нет участников</p> : <div className="space-y-1.5 max-h-64 overflow-y-auto">{members.map((m) => { const cr = roles.find((r) => r.id === m.role_id); return (<div key={m.user_id} className="flex items-center gap-2 py-1"><span className="text-sm flex-1 truncate">{m.profiles?.username || m.user_id.slice(0, 8)}</span>{cr && <Badge style={{ backgroundColor: cr.color + "20", color: cr.color, borderColor: cr.color + "40" }} variant="outline" className="text-[10px]">{cr.name}</Badge>}<Select value={m.role_id || "none"} onValueChange={(v) => handleAssignRole(m.user_id, v === "none" ? null : v)}><SelectTrigger className="h-7 w-32 text-xs"><SelectValue placeholder="Нет роли" /></SelectTrigger><SelectContent><SelectItem value="none">Нет роли</SelectItem>{roles.map((role) => (<SelectItem key={role.id} value={role.id}><div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: role.color }} />{role.name}</div></SelectItem>))}</SelectContent></Select></div>); })}</div>}</div></div>)}
          {activeTab === "general" && (<div className="rounded-lg border border-border p-3 bg-muted/30"><div className="text-xs text-muted-foreground mb-2">Превью правил</div>{renderPreviewContent(rulesPreview, "g-settings-rules")}</div>)}
          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-between"><Button variant="outline" onClick={() => navigate(`/g/${slug}`)}>К g-сабу</Button><Button onClick={handleSave} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}<Save className="w-4 h-4 mr-2" />Сохранить</Button></div>
        </CardContent>
      </Card>
    </div>
  );
};
export default GomoSubSettings;
