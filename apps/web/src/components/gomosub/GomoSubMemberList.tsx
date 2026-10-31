import { memo, useMemo } from "react";
import { Crown, Timer } from "lucide-react";
import { cn } from "@/lib/utils";

export type RosterRole = {
  id: string;
  name: string;
  color: string;
  position: number;
  is_everyone?: boolean;
};

export type RosterMember = {
  user_id: string;
  username: string;
  role_ids: string[];
  timed_out: boolean;
  is_owner: boolean;
};

const topRoleOf = (m: RosterMember, roles: RosterRole[]): RosterRole | null => {
  let top: RosterRole | null = null;
  for (const r of roles) {
    if (r.is_everyone) continue;
    if (m.role_ids.includes(r.id) && (!top || r.position > top.position)) top = r;
  }
  return top;
};

/**
 * Discord-like member roster: grouped by top role (role color as the name
 * color), owner first, timed-out members badged. Pure presentational — data
 * comes from GET /api/rpc/gomosub_members.
 */
export const GomoSubMemberList = memo(
  ({ roles, members, className }: { roles: RosterRole[]; members: RosterMember[]; className?: string }) => {
    const groups = useMemo(() => {
      const byRole = new Map<string, RosterMember[]>();
      const plain: RosterMember[] = [];
      const sorted = [...members].sort((a, b) => a.username.localeCompare(b.username, "ru"));
      for (const m of sorted) {
        const top = topRoleOf(m, roles);
        if (!top) {
          plain.push(m);
          continue;
        }
        const list = byRole.get(top.id) ?? [];
        list.push(m);
        byRole.set(top.id, list);
      }
      const orderedRoles = [...roles].filter((r) => !r.is_everyone && byRole.has(r.id)).sort((a, b) => b.position - a.position);
      // Owner always heads the list, even without a special role.
      const ownerFirst = (list: RosterMember[]) => [...list].sort((a, b) => Number(b.is_owner) - Number(a.is_owner));
      return {
        orderedRoles,
        byRole,
        plain: ownerFirst(plain),
        topOf: new Map(members.map((m) => [m.user_id, topRoleOf(m, roles)])),
      };
    }, [roles, members]);

    const renderRow = (m: RosterMember) => {
      const top = groups.topOf.get(m.user_id);
      const color = top?.color ?? "#99aab5";
      return (
        <div key={m.user_id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/60 transition-colors min-w-0">
          <div
            className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white"
            style={{ backgroundColor: color }}
          >
            {(m.username || "?")[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 min-w-0">
              <span className="text-sm truncate" style={{ color: top ? color : undefined }}>
                {m.username || m.user_id.slice(0, 8)}
              </span>
              {m.is_owner && <Crown className="w-3.5 h-3.5 shrink-0 text-amber-500" />}
              {m.timed_out && <Timer className="w-3.5 h-3.5 shrink-0 text-amber-600" />}
            </div>
          </div>
        </div>
      );
    };

    return (
      <div className={cn("space-y-3", className)}>
        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest px-2">
          Участники — {members.length}
        </div>
        {groups.orderedRoles.map((r) => (
          <div key={r.id}>
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 truncate">
              {r.name} — {(groups.byRole.get(r.id) ?? []).length}
            </div>
            {(groups.byRole.get(r.id) ?? []).map(renderRow)}
          </div>
        ))}
        {groups.plain.length > 0 && (
          <div>
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
              Участники — {groups.plain.length}
            </div>
            {groups.plain.map(renderRow)}
          </div>
        )}
      </div>
    );
  },
);

GomoSubMemberList.displayName = "GomoSubMemberList";
