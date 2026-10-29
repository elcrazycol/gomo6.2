import type { Member, MemberRoleGrant, Role } from "./types";

// ─── Permission catalogue (Discord-grouped, Russian labels) ──────────────────

export type PermMeta = { key: string; label: string; desc: string };

export const PERMISSION_GROUPS: { title: string; items: PermMeta[] }[] = [
  {
    title: "Управление сервером",
    items: [
      { key: "administrator", label: "Администратор", desc: "Полный доступ: обходит все проверки прав и иерархию" },
      { key: "can_manage_roles", label: "Управление ролями", desc: "Создавать, изменять и удалять роли ниже своей" },
      { key: "can_manage_channels", label: "Управление каналами", desc: "Создавать, изменять и удалять каналы и категории" },
      { key: "can_manage_members", label: "Управление участниками", desc: "Назначать роли, кикать, банить и мутить" },
    ],
  },
  {
    title: "Модерация",
    items: [
      { key: "kick_members", label: "Выгонять участников", desc: "Кик — исключение без бана, можно вернуться" },
      { key: "ban_members", label: "Банить участников", desc: "Бан с возможностью чистки сообщений" },
      { key: "timeout_members", label: "Мьютить участников", desc: "Временный запрет писать (до 28 дней)" },
      { key: "can_delete_threads", label: "Удалять сообщения", desc: "Удаление чужих записей и сообщений чата" },
    ],
  },
  {
    title: "Контент",
    items: [
      { key: "can_pin_threads", label: "Закреплять записи", desc: "Закрепление записей саба" },
      { key: "can_post_stories", label: "Публиковать истории", desc: "Истории от имени сообщества" },
    ],
  },
  {
    title: "Каналы по умолчанию",
    items: [
      { key: "view_channel", label: "Видеть каналы", desc: "Базовое право; приватные каналы требуют явного разрешения" },
      { key: "send_messages", label: "Писать в каналы", desc: "Базовое право; запрет на канале перекрывает его" },
    ],
  },
];

export const ALL_PERM_KEYS = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));

// ─── Channel overwrites (allow / inherit / deny) ───────────────────────────

export type TriState = "allow" | "inherit" | "deny";

export const overwriteTriState = (
  ow: { allow?: Record<string, boolean>; deny?: Record<string, boolean>; can_read?: boolean; can_write?: boolean } | undefined,
  permKey: "view_channel" | "send_messages",
): TriState => {
  if (ow?.allow?.[permKey]) return "allow";
  if (ow?.deny?.[permKey]) return "deny";
  // Legacy fallback while rows predate allow/deny.
  if (permKey === "view_channel" && ow && ow.can_read === false && !ow.allow) return "deny";
  if (permKey === "send_messages" && ow && ow.can_write === false && !ow.allow) return "deny";
  if (permKey === "view_channel" && ow && ow.can_read === true && !ow.deny) return "allow";
  if (permKey === "send_messages" && ow && ow.can_write === true && !ow.deny) return "allow";
  return "inherit";
};

// applyTriState returns the allow/deny patch plus the legacy booleans kept in
// sync (resolved view/send, false when denied or unset).
export const applyTriState = (
  ow: { allow?: Record<string, boolean>; deny?: Record<string, boolean> } | undefined,
  permKey: "view_channel" | "send_messages",
  state: TriState,
): { allow: Record<string, boolean>; deny: Record<string, boolean>; can_read?: boolean; can_write?: boolean } => {
  const allow = { ...(ow?.allow ?? {}) };
  const deny = { ...(ow?.deny ?? {}) };
  delete allow[permKey];
  delete deny[permKey];
  if (state === "allow") allow[permKey] = true;
  if (state === "deny") deny[permKey] = true;
  const grant = state === "allow";
  return permKey === "view_channel"
    ? { allow, deny, can_read: grant }
    : { allow, deny, can_write: grant };
};

// ─── Role math (client mirror of the backend union + hierarchy) ─────────────

export const memberRoleIds = (m: Member, grants: MemberRoleGrant[]): string[] => {
  const ids = new Set<string>();
  if (m.role_id) ids.add(m.role_id);
  for (const g of grants) if (g.user_id === m.user_id) ids.add(g.role_id);
  return [...ids];
};

/** Highest role position of a member. @everyone counts as the implicit 0. */
export const memberTop = (m: Member, roles: Role[], grants: MemberRoleGrant[]): number => {
  const ids = new Set(memberRoleIds(m, grants));
  let top = m ? 0 : -1;
  for (const r of roles) {
    if (r.is_everyone) continue;
    if (ids.has(r.id) && r.position > top) top = r.position;
  }
  return top;
};

export const roleMemberCount = (roleId: string, members: Member[], grants: MemberRoleGrant[]): number => {
  let n = 0;
  for (const m of members) if (memberRoleIds(m, grants).includes(roleId)) n += 1;
  return n;
};

/** Discord rule: owner and administrators bypass; otherwise strictly above. */
export const canModerateTarget = (
  actor: { isOwner: boolean; isAdmin: boolean; top: number },
  targetTop: number,
  targetIsOwner: boolean,
): boolean => {
  if (targetIsOwner) return false;
  if (actor.isOwner || actor.isAdmin) return true;
  return actor.top > targetTop;
};
