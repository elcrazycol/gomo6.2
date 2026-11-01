import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { invalidateByPrefix } from "@/integrations/api/queryCache";
import { wsService } from "@/services/websocket";
import { Button } from "@/components/ui/button";
import { Loader2, Hash, KeyRound, Users, Link, Gavel, PenLine, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import GeneralPanel, { type GeneralForm } from "@/components/gomosub/settings/GeneralPanel";
import RolesPanel, { normalizeRoles } from "@/components/gomosub/settings/RolesPanel";
import MembersPanel from "@/components/gomosub/settings/MembersPanel";
import ChannelsPanel from "@/components/gomosub/settings/ChannelsPanel";
import BansPanel from "@/components/gomosub/settings/BansPanel";
import InvitesPanel, { type Invite } from "@/components/gomosub/settings/InvitesPanel";
import { memberTop } from "@/components/gomosub/settings/permissions";
import { parsePerms, rpcGet, type BanItem, type ChannelOverwrite, type Member, type MemberRoleGrant, type Role, type SettingsCategory, type SettingsChannel } from "@/components/gomosub/settings/types";

type TabValue = "general" | "roles" | "members" | "channels" | "bans" | "invites";

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

const buildTabItems = (visibility: string, bans: number): { value: TabValue; label: string; icon: LucideIcon; badge?: number }[] => {
  const items: { value: TabValue; label: string; icon: LucideIcon; badge?: number }[] = [
    { value: "general", label: "Основное", icon: PenLine },
    { value: "roles", label: "Роли", icon: KeyRound },
    { value: "members", label: "Участники", icon: Users },
    { value: "channels", label: "Каналы", icon: Hash },
    { value: "bans", label: "Баны", icon: Gavel, badge: bans || undefined },
  ];
  if (visibility === "private") items.push({ value: "invites", label: "Приглашения", icon: Link });
  return items;
};

const GomoSubSettings = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [myId, setMyId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [myPerms, setMyPerms] = useState<Record<string, boolean>>({});
  const [tagInput, setTagInput] = useState("");
  const [activeTab, setActiveTab] = useState<TabValue>("general");

  const [channels, setChannels] = useState<SettingsChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [categories, setCategories] = useState<SettingsCategory[]>([]);
  const [openChannelId, setOpenChannelId] = useState<string | null>(null);
  const [overwrites, setOverwrites] = useState<ChannelOverwrite[]>([]);

  const [roles, setRoles] = useState<Role[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [grants, setGrants] = useState<MemberRoleGrant[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  const [bans, setBans] = useState<BanItem[]>([]);
  const [boardVisibility, setBoardVisibility] = useState("public");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);

  const [form, setForm] = useState<GeneralForm>({ id: "", name: "", description: "", gomosub_avatar_url: "", cover_image_url: "", gomosub_tags: [] });
  const [standardRules, setStandardRules] = useState("");
  const [allowedRules, setAllowedRules] = useState<string[]>([""]);
  const [forbiddenRules, setForbiddenRules] = useState<string[]>([""]);
  const [originalRulesMarkdown, setOriginalRulesMarkdown] = useState<string | null>(null);
  const rulesPreview = useMemo(() => buildRulesMarkdown(standardRules, allowedRules, forbiddenRules) || "", [standardRules, allowedRules, forbiddenRules]);
  const rulesChanged = useMemo(() => {
    const current = rulesPreview?.trim() || null;
    const original = originalRulesMarkdown?.trim() || null;
    return current !== original;
  }, [rulesPreview, originalRulesMarkdown]);

  const loadChannels = async (boardId: string) => {
    setChannelsLoading(true);
    try {
      const r = await fetch(`/api/v1/channels?board_id=eq.${boardId}&order=sort_order.asc`);
      const d = await r.json();
      setChannels((d.data || []) as SettingsChannel[]);
    } catch { /* ignore */ }
    setChannelsLoading(false);
  };

  const loadCategories = async (boardId: string) => {
    try {
      const r = await fetch(`/api/v1/channel_categories?board_id=eq.${boardId}&order=sort_order.asc`);
      const d = await r.json();
      setCategories((d.data || []) as SettingsCategory[]);
    } catch { /* ignore */ }
  };

  const loadRoles = async (boardId: string) => {
    const r = await fetch(`/api/v1/gomosub_roles?board_id=eq.${boardId}&order=position.desc`);
    const d = await r.json();
    setRoles(normalizeRoles(d.data));
  };

  // Members come from the permission-gated roster RPC (not the generic
  // memberships table, which is user-scoped and only ever returns the
  // caller's own row — the old code showed a single member for that reason).
  const loadMembers = async (boardId: string) => {
    const res = await rpcGet(`/api/rpc/gomosub_members?_board_id=${boardId}`);
    const rows = ((res.ok ? (res.data as { members?: unknown[] })?.members : []) ?? []) as {
      user_id: string; username?: string; role_id?: string | null; timed_out_until?: string | null;
    }[];
    setMembers(rows.map((m) => ({
      user_id: m.user_id,
      role_id: m.role_id ?? null,
      timed_out_until: m.timed_out_until ?? null,
      profiles: { username: m.username ?? "" },
    } as Member)));
  };

  const loadGrants = async (boardId: string) => {
    try {
      const r = await fetch(`/api/v1/gomosub_member_roles?board_id=eq.${boardId}`);
      const d = await r.json();
      setGrants((d.data || []) as MemberRoleGrant[]);
    } catch { /* ignore */ }
  };

  const loadOverwrites = async (channelId: string) => {
    try {
      const r = await fetch(`/api/v1/channel_permissions?channel_id=eq.${channelId}`);
      const d = await r.json();
      const rows = (d.data || []) as ChannelOverwrite[];
      setOverwrites((prev) => {
        const others = prev.filter((o) => o.channel_id !== channelId);
        return [...others, ...rows.map((x) => ({
          ...x,
          allow: parsePerms(x.allow),
          deny: parsePerms(x.deny),
        }))];
      });
    } catch { /* ignore */ }
  };

  const loadBans = async (boardId: string, token: string | undefined) => {
    try {
      const r = await fetch(`/api/rpc/gomosub_bans?_board_id=${boardId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const d = await r.json();
      if (r.ok && d?.success) setBans((d.data || []) as BanItem[]);
    } catch { /* ignore */ }
  };

  const loadInvites = async (boardId: string, token: string | undefined) => {
    setInvitesLoading(true);
    try {
      if (!token) { setInvitesLoading(false); return; }
      const r = await fetch(`/api/v1/boards/${boardId}/invites`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setInvites((d.data || []) as Invite[]);
    } catch { /* ignore */ }
    setInvitesLoading(false);
  };

  // Targeted patch after drag-and-drop reorder: updates the list in place
  // without the full reloadAll (which flashes a spinner and jumps scroll).
  // Structural writes (create/edit/delete) still go through reloadAll.
  const patchChannels = (next: SettingsChannel[]) => {
    invalidateByPrefix("/api/v1/channels");
    invalidateByPrefix("/api/v1/channel_categories");
    setChannels(next);
  };

  const reloadAll = async () => {
    if (!form.id) return;
    // Raw CRUD fetches bypass the query-builder, so drop the client URL
    // cache explicitly — otherwise the board page keeps serving the
    // pre-mutation channel/role/member lists.
    invalidateByPrefix("/api/v1/channels");
    invalidateByPrefix("/api/v1/channel_categories");
    invalidateByPrefix("/api/v1/gomosub_roles");
    invalidateByPrefix("/api/v1/channel_permissions");
    invalidateByPrefix("/api/v1/gomosub_member_roles");
    invalidateByPrefix("/api/v1/gomosub_memberships");
    setDataLoading(true);
    await Promise.all([loadChannels(form.id), loadCategories(form.id), loadRoles(form.id), loadMembers(form.id), loadGrants(form.id)]);
    if (openChannelId) await loadOverwrites(openChannelId);
    setDataLoading(false);
  };

  // Live roster: any membership/grant change on this board (join, leave,
  // kick, ban, timeout, role grant) refetches members + roles + bans so the
  // open tab never goes stale. Channel edits are excluded on purpose — a
  // refetch mid-drag would yank the row out from under the pointer.
  const reloadRosterRelated = async () => {
    if (!form.id) return;
    await Promise.all([loadRoles(form.id), loadMembers(form.id), loadGrants(form.id)]);
    await reloadBans();
  };

  useEffect(() => {
    if (!form.id) return;
    const room = `board_${form.id}`;
    wsService.subscribe(room);
    const unsub = wsService.on("gomosub_member_changed", (message) => {
      const data = message.data as { board_id?: string } | undefined;
      if (data?.board_id === form.id) void reloadRosterRelated();
    });
    return () => {
      unsub();
      wsService.unsubscribe(room);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.id]);

  const reloadBans = async () => {
    if (!form.id) return;
    const { data: { session } } = await api.auth.getSession();
    await loadBans(form.id, session?.access_token);
  };

  const reloadInvites = async () => {
    if (!form.id) return;
    const { data: { session } } = await api.auth.getSession();
    await loadInvites(form.id, session?.access_token);
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data: { user } } = await api.auth.getUser();
      if (!user) { navigate("/auth"); return; }
      const { data: board } = await api.from("boards").select("id,name,description,rules_markdown,gomosub_avatar_url,cover_image_url,owner_id,gomosub_tags,is_gomosub,visibility").eq("slug", slug).eq("is_gomosub", true).maybeSingle();
      if (!board) { toast.error("G-саб не найден"); navigate("/g"); return; }
      const isOwnerUser = board.owner_id === user.id;
      let perms: Record<string, boolean> = {};
      if (!isOwnerUser) {
        try {
          const { data: { session } } = await api.auth.getSession();
          if (!session?.access_token) { toast.error("Нужно войти"); navigate(`/g/${slug}`); return; }
          const permRes = await fetch(`/api/rpc/get_board_user_permissions?_board_id=${board.id}`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          const permData = await permRes.json();
          perms = permData.data?.permissions || {};
          if (!perms.can_manage_channels && !perms.can_manage_roles && !perms.can_manage_members && !perms.administrator) {
            toast.error("Нет прав для управления настройками"); navigate(`/g/${slug}`); return;
          }
        } catch {
          toast.error("Не удалось проверить права доступа"); navigate(`/g/${slug}`); return;
        }
      }
      const tags = Array.isArray(board.gomosub_tags) ? board.gomosub_tags.filter((t: unknown): t is string => typeof t === "string") : [];
      const parsedRules = parseRulesMarkdown(board.rules_markdown);
      setStandardRules(parsedRules.standardRules);
      setAllowedRules(parsedRules.allowedRules);
      setForbiddenRules(parsedRules.forbiddenRules);
      setOriginalRulesMarkdown(board.rules_markdown ?? null);
      setIsOwner(isOwnerUser);
      setMyId(user.id);
      setOwnerId(board.owner_id);
      setMyPerms(perms);
      setBoardVisibility(board.visibility || "public");
      setForm({ id: board.id, name: board.name || "", description: board.description || "", gomosub_avatar_url: board.gomosub_avatar_url || "", cover_image_url: board.cover_image_url || "", gomosub_tags: tags });
      setLoading(false);
      setDataLoading(true);
      const { data: { session } } = await api.auth.getSession();
      await Promise.all([
        loadChannels(board.id), loadCategories(board.id), loadRoles(board.id),
        loadMembers(board.id), loadGrants(board.id), loadBans(board.id, session?.access_token),
      ]);
      if (board.visibility === "private") await loadInvites(board.id, session?.access_token);
      setDataLoading(false);
    };
    load();
  }, [navigate, slug]);

  const addTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    if (form.gomosub_tags.includes(t)) { toast.error("Такой тег уже добавлен"); return; }
    if (form.gomosub_tags.length >= 20) { toast.error("Максимум 20 кастомных тегов"); return; }
    setForm((p) => ({ ...p, gomosub_tags: [...p.gomosub_tags, t] }));
    setTagInput("");
  };
  const removeTag = (tag: string) => setForm((p) => ({ ...p, gomosub_tags: p.gomosub_tags.filter((t) => t !== tag) }));
  const updateRuleItem = (kind: "allowed" | "forbidden", i: number, v: string) => {
    const s = kind === "allowed" ? setAllowedRules : setForbiddenRules;
    s((p) => p.map((item, idx) => (idx === i ? v : item)));
  };
  const addRuleItem = (k: "allowed" | "forbidden") => {
    const s = k === "allowed" ? setAllowedRules : setForbiddenRules;
    s((p) => [...p, ""]);
  };
  const removeRuleItem = (k: "allowed" | "forbidden", i: number) => {
    const s = k === "allowed" ? setAllowedRules : setForbiddenRules;
    s((p) => { const n = p.filter((_, idx) => idx !== i); return n.length ? n : [""]; });
  };

  const handleSave = async () => {
    if (!isOwner) return;
    if (!form.name.trim()) { toast.error("Название обязательно"); return; }
    if (!form.description.trim()) { toast.error("Описание обязательно"); return; }
    setSaving(true);
    const updateData: Record<string, unknown> = {
      name: form.name.trim(), description: form.description.trim(),
      gomosub_avatar_url: form.gomosub_avatar_url || null,
      cover_image_url: form.cover_image_url || null, gomosub_tags: form.gomosub_tags,
    };
    if (rulesChanged) updateData.rules_markdown = rulesPreview || null;
    const { error } = await api.from("boards").update(updateData).eq("id", form.id);
    setSaving(false);
    if (error) { toast.error((error as { message?: string }).message || "Не удалось сохранить"); return; }
    if (rulesChanged) setOriginalRulesMarkdown(rulesPreview || null);
    toast.success("Настройки g-саба сохранены");
  };

  const can = (key: string) => isOwner || !!myPerms.administrator || !!myPerms[key];
  const canManageRoles = can("can_manage_roles");
  const canManageChannels = can("can_manage_channels");
  const canManageMembers = can("can_manage_members");

  const actor = useMemo(() => {
    const me = members.find((m) => m.user_id === myId);
    return {
      id: myId,
      isOwner,
      isAdmin: !!myPerms.administrator,
      top: me ? memberTop(me, roles, grants) : isOwner ? Number.MAX_SAFE_INTEGER : 0,
    };
  }, [members, roles, grants, myId, isOwner, myPerms]);

  if (loading) return <div className="max-w-4xl mx-auto p-6 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  const tabItems = buildTabItems(boardVisibility, bans.length);

  return (
    <div className="max-w-5xl mx-auto w-full px-3 sm:px-5 pb-32 md:pb-10">
      <header className="pt-1 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Настройки сообщества</h1>
          <p className="text-sm text-muted-foreground truncate">g/{slug}</p>
        </div>
        <Button variant="outline" size="sm" className="h-9 rounded-full shrink-0" onClick={() => navigate(`/g/${slug}`)}>
          К сабу
        </Button>
      </header>

      <div className="mt-4 flex flex-col md:flex-row md:gap-7">
        <nav className="md:w-52 md:shrink-0 md:sticky md:top-24 md:self-start" aria-label={`Настройки g/${slug}`}>
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide md:hidden -mx-3 px-3 pb-1">
            {tabItems.map((item) => (
              <button
                key={item.value}
                onClick={() => setActiveTab(item.value)}
                className={cn(
                  "shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                  activeTab === item.value
                    ? "border-primary/40 bg-primary/10 font-medium text-primary"
                    : "border-border/60 bg-surface text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}{item.badge ? ` · ${item.badge}` : ""}
              </button>
            ))}
          </div>
          <div className="hidden md:block space-y-0.5">
            {tabItems.map((item) => (
              <button
                key={item.value}
                onClick={() => setActiveTab(item.value)}
                aria-current={activeTab === item.value ? "true" : undefined}
                className={cn(
                  "flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-sm transition-colors",
                  activeTab === item.value
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 text-left">{item.label}</span>
                {item.badge ? <span className="text-xs bg-destructive/15 text-destructive rounded-full px-1.5">{item.badge}</span> : null}
              </button>
            ))}
          </div>
        </nav>

        <div className="min-w-0 flex-1 mt-4 md:mt-0">
          {dataLoading && activeTab !== "general" && (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          )}
          {!dataLoading && activeTab === "general" && (
            <GeneralPanel
              form={form} setForm={setForm}
              standardRules={standardRules} setStandardRules={setStandardRules}
              allowedRules={allowedRules} forbiddenRules={forbiddenRules}
              updateRuleItem={updateRuleItem} addRuleItem={addRuleItem} removeRuleItem={removeRuleItem}
              rulesPreview={rulesPreview}
              tagInput={tagInput} setTagInput={setTagInput} addTag={addTag} removeTag={removeTag}
              isOwner={isOwner} boardVisibility={boardVisibility} slug={slug ?? ""}
              saving={saving} onSave={handleSave}
              canPostStories={isOwner || !!myPerms.administrator || !!myPerms.can_post_stories}
            />
          )}
          {!dataLoading && activeTab === "roles" && (
            <RolesPanel boardId={form.id} roles={roles} members={members} grants={grants} canManage={canManageRoles} onChanged={reloadAll} />
          )}
          {!dataLoading && activeTab === "members" && (
            <MembersPanel
              boardId={form.id} ownerId={ownerId} members={members} roles={roles} grants={grants} bans={bans}
              actor={actor} canAssign={canManageMembers}
              canKick={can("kick_members") || canManageMembers} canBan={can("ban_members") || canManageMembers}
              canTimeout={can("timeout_members") || canManageMembers} onChanged={async () => { await reloadAll(); await reloadBans(); }}
            />
          )}
          {!dataLoading && activeTab === "channels" && (
            channelsLoading
              ? <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
              : <ChannelsPanel
                  boardId={form.id} channels={channels} categories={categories} roles={roles}
                  overwrites={overwrites} canManage={canManageChannels} onChanged={reloadAll}
                  onPatchChannels={patchChannels}
                  openChannelId={openChannelId}
                  onOpenOverwrites={async (id) => {
                    // Set (not toggle): saving an overwrite refreshes through
                    // this same callback and must not collapse the panel.
                    // Targeted per-channel refetch only — no reloadAll, so no
                    // spinner and no scroll jump while toggling overwrites.
                    setOpenChannelId(id || null);
                    if (id) {
                      invalidateByPrefix("/api/v1/channel_permissions");
                      await loadOverwrites(id);
                    }
                  }}
                />
          )}
          {!dataLoading && activeTab === "bans" && (
            <BansPanel boardId={form.id} bans={bans} canManage={canManageMembers || can("ban_members")} onChanged={reloadBans} />
          )}
          {!dataLoading && activeTab === "invites" && (
            <InvitesPanel boardId={form.id} slug={slug ?? ""} invites={invites} loading={invitesLoading} onChanged={reloadInvites} />
          )}
        </div>
      </div>
    </div>
  );
};

export default GomoSubSettings;
