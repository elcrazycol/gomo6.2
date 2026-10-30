import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Trophy,
  Plus,
  Search,
  Upload,
  Pencil,
  Trash2,
  X,
  Award,
  Loader2,
  Gem,
  Bug,
  Palette,
  Shield,
  Crown,
  ImageIcon,
  Sparkles,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// ── Types ───────────────────────────────────────────────────────────────────

interface Level {
  level: number;
  threshold: number;
  name_key?: string;
  name?: string;
}

interface AwardRow {
  id: string;
  group_key: string;
  name?: string;
  title?: string;
  description?: string;
  icon?: string;
  category?: string;
  kind?: string;
  origin?: string;
  image_url?: string | null;
  level_images?: Record<string, string>;
  achievement_type?: string;
  sort_order?: number;
  owner_share?: Record<string, number>;
  levels?: Level[];
}

interface Grant {
  id: string;
  user_id: string;
  username: string;
  award_key: string;
  reason: string;
  awarded_at: string;
  revoked_at?: string;
  auto_granted?: boolean;
  awarded_by?: string;
}

/** Auto-issuance rule attached to a hand-granted award. */
interface AutoRule {
  award_key: string;
  award_title: string;
  active_from: string;
  active_to: string;
  min_wall_posts: number;
  min_threads: number;
  min_likes_given: number;
  min_likes_received: number;
  min_active_days: number;
  created_by: string;
}

interface UserHit {
  id: string;
  username: string;
  display_name?: string;
  avatar_url?: string | null;
}

async function apiJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await api.fetch(url, options);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((json && (json.error || json.message)) || `Ошибка ${res.status}`);
  }
  return (json?.data ?? json) as T;
}

const ICON_CHOICES: { name: string; Icon: LucideIcon }[] = [
  { name: "trophy", Icon: Trophy },
  { name: "award", Icon: Award },
  { name: "gem", Icon: Gem },
  { name: "bug", Icon: Bug },
  { name: "palette", Icon: Palette },
  { name: "shield", Icon: Shield },
  { name: "crown", Icon: Crown },
];

function iconFor(name?: string): LucideIcon {
  return ICON_CHOICES.find((i) => i.name === name)?.Icon ?? Trophy;
}

function awardName(a: AwardRow): string {
  return a.title || a.name || a.group_key;
}

/** Owner share for one level, from the computed owner-share map. */
function rarityOf(a: AwardRow, level: number): number | null {
  const v = a.owner_share?.[String(level)];
  return typeof v === "number" ? v : null;
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function formatPercent(v: number | null): string {
  if (v === null) return "—";
  return `${v.toFixed(1)}%`;
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function Awards() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"catalog" | "grants">("catalog");
  const [search, setSearch] = useState("");

  const [editing, setEditing] = useState<AwardRow | "new" | null>(null);
  const [grantTo, setGrantTo] = useState<AwardRow | null>(null);
  const [evaluating, setEvaluating] = useState<string | null>(null);

  const catalog = useQuery({
    queryKey: ["awards", "catalog"],
    queryFn: () => apiJson<AwardRow[]>("/api/v1/achievements?order=sort_order.asc"),
  });
  const grants = useQuery({
    queryKey: ["awards", "grants"],
    queryFn: () => apiJson<Grant[]>("/api/v1/admin/awards/grants?limit=200"),
  });
  const rules = useQuery({
    queryKey: ["awards", "rules"],
    queryFn: () => apiJson<AutoRule[]>("/api/v1/admin/awards/rules"),
  });

  // Stock quests (milestones) are hidden here by design: this panel manages
  // hand-granted awards only. Quests stay visible to users on their page.
  const awards = (catalog.data ?? []).filter((a) => a.kind === "award");
  const rulesByKey = useMemo(
    () => new Map((rules.data ?? []).map((r) => [r.award_key, r])),
    [rules.data],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return awards.filter((a) => {
      if (q && !awardName(a).toLowerCase().includes(q) && !a.group_key.includes(q)) return false;
      return true;
    });
  }, [awards, search]);

  const grantRows = grants.data ?? [];
  const activeGrants = grantRows.filter((g) => !g.revoked_at);

  const evaluate = async (award: AwardRow) => {
    setEvaluating(award.group_key);
    try {
      const res = await apiJson<{ count: number }>("/api/v1/admin/awards/evaluate", {
        method: "POST",
        body: JSON.stringify({ award_key: award.group_key }),
      });
      toast.success(res.count > 0 ? `Выдано: ${res.count}` : "Никто пока не выполнил условия");
      qc.invalidateQueries({ queryKey: ["awards"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEvaluating(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Trophy className="w-5 h-5 text-primary" />
            Награды
          </h1>
          <p className="text-sm text-muted-foreground">
            Ручные награды: арт, окно автопроверки, ручные и автоматические выдачи.
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus className="w-4 h-4 mr-1.5" />
          Создать награду
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {[
          { key: "catalog" as const, label: `Каталог (${awards.length})` },
          { key: "grants" as const, label: `Выдачи (${activeGrants.length})` },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "relative px-3 py-2 text-sm font-medium transition-colors",
              tab === t.key ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {tab === t.key && (
              <span className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-primary" />
            )}
          </button>
        ))}
      </div>

      {tab === "catalog" ? (
        <>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по названию или ключу"
                className="pl-9"
              />
            </div>
          </div>

          {catalog.isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              title="Ничего не найдено"
              hint="Создай первую награду: название, арт и окно автопроверки."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {filtered.map((a) => (
                <AwardCard
                  key={a.group_key}
                  award={a}
                  rule={rulesByKey.get(a.group_key) ?? null}
                  grants={activeGrants.filter((g) => g.award_key === a.group_key).length}
                  evaluating={evaluating === a.group_key}
                  onEvaluate={() => evaluate(a)}
                  onGrant={() => setGrantTo(a)}
                  onEdit={() => setEditing(a)}
                  onDelete={async () => {
                    if (!confirm(`Удалить награду «${awardName(a)}»?`)) return;
                    try {
                      await apiJson(`/api/v1/admin/awards?key=${encodeURIComponent(a.group_key)}`, {
                        method: "DELETE",
                      });
                      toast.success("Награда удалена");
                      qc.invalidateQueries({ queryKey: ["awards"] });
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <GrantsList
          grants={grantRows}
          awards={awards}
          onRevoke={async (g) => {
            const reason = prompt("Причина отзыва? (необязательно)") ?? "";
            try {
              await apiJson("/api/v1/admin/awards/revoke", {
                method: "POST",
                body: JSON.stringify({ id: g.id, reason }),
              });
              toast.success("Награда отозвана");
              qc.invalidateQueries({ queryKey: ["awards"] });
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        />
      )}

      {editing && (
        <AwardEditor
          award={editing === "new" ? null : editing}
          rule={editing === "new" ? null : (rulesByKey.get(editing.group_key) ?? null)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["awards"] });
            setEditing(null);
          }}
        />
      )}
      {grantTo && (
        <GrantModal
          award={grantTo}
          onClose={() => setGrantTo(null)}
          onGranted={() => {
            qc.invalidateQueries({ queryKey: ["awards"] });
            setGrantTo(null);
          }}
        />
      )}
    </div>
  );
}

// ── Award card ──────────────────────────────────────────────────────────────

function formatRuleWindow(rule: AutoRule): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "numeric" });
  return `${fmt(rule.active_from)}–${fmt(rule.active_to)}`;
}

function ruleSummary(rule: AutoRule): string {
  const parts: string[] = [];
  if (rule.min_wall_posts > 0) parts.push(`стена ≥${rule.min_wall_posts}`);
  if (rule.min_threads > 0) parts.push(`треды ≥${rule.min_threads}`);
  if (rule.min_likes_given > 0) parts.push(`лайки+ ≥${rule.min_likes_given}`);
  if (rule.min_likes_received > 0) parts.push(`лайки− ≥${rule.min_likes_received}`);
  if (rule.min_active_days > 0) parts.push(`дни ≥${rule.min_active_days}`);
  return parts.join(" · ");
}

function AwardCard({
  award,
  rule,
  grants,
  evaluating,
  onEvaluate,
  onGrant,
  onEdit,
  onDelete,
}: {
  award: AwardRow;
  rule: AutoRule | null;
  grants: number;
  evaluating: boolean;
  onEvaluate: () => void;
  onGrant: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const Icon = iconFor(award.icon);
  const thumb = award.image_url || null;
  const topRarity = rarityOf(award, 1);

  return (
    <div className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-border/80">
      <div className="flex gap-4">
        {/* Art */}
        <div className="flex-shrink-0 w-16 h-16 rounded-md bg-muted/60 border border-border/60 flex items-center justify-center overflow-hidden">
          {thumb ? (
            <img
              src={thumb}
              alt=""
              className="w-full h-full object-contain"
              loading="lazy"
            />
          ) : (
            <Icon className="w-7 h-7 text-muted-foreground" />
          )}
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium truncate">{awardName(award)}</p>
              <p className="font-mono text-[11px] text-muted-foreground truncate">
                {award.group_key}
              </p>
            </div>
            <span className="text-sm tabular-nums text-muted-foreground whitespace-nowrap">
              {formatPercent(topRarity)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <Tag tone={thumb ? "primary" : "warn"}>{thumb ? "с артом" : "без арта"}</Tag>
            {rule ? (
              <span
                title={ruleSummary(rule)}
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide bg-primary/15 text-primary"
              >
                авто · {formatRuleWindow(rule)}
              </span>
            ) : (
              <Tag tone="muted">только вручную</Tag>
            )}
            {grants > 0 && (
              <Tag tone="muted">
                {grants} {plural(grants, "выдача", "выдачи", "выдач")}
              </Tag>
            )}
          </div>

          {rule && (
            <p className="mt-2 text-xs text-muted-foreground truncate" title={ruleSummary(rule)}>
              {ruleSummary(rule)}
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-border/60">
        <Button size="sm" variant="secondary" onClick={onGrant}>
          <Award className="w-3.5 h-3.5 mr-1" />
          Выдать
        </Button>
        {rule && (
          <Button size="sm" variant="secondary" onClick={onEvaluate} disabled={evaluating}>
            {evaluating ? (
              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 mr-1" />
            )}
            Проверить и выдать
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onEdit} className="ml-auto">
          <Pencil className="w-3.5 h-3.5 mr-1" />
          Править
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone: "primary" | "muted" | "warn" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        tone === "primary" && "bg-primary/15 text-primary",
        tone === "warn" && "bg-amber-500/15 text-amber-600 dark:text-amber-400",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

// ── Grants ──────────────────────────────────────────────────────────────────

function GrantsList({
  grants,
  awards,
  onRevoke,
}: {
  grants: Grant[];
  awards: AwardRow[];
  onRevoke: (g: Grant) => void;
}) {
  const byKey = useMemo(() => new Map(awards.map((a) => [a.group_key, a])), [awards]);

  const active = grants.filter((g) => !g.revoked_at);
  const revoked = grants.filter((g) => g.revoked_at);

  if (grants.length === 0) {
    return <EmptyState title="Выдач пока нет" hint="Выдай первую награду из каталога." />;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border/60 text-xs font-medium text-muted-foreground">
          Активные ({active.length})
        </div>
        <GrantRows rows={active} byKey={byKey} onRevoke={onRevoke} />
      </div>

      {revoked.length > 0 && (
        <div className="rounded-lg border border-border/60 bg-card/50 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border/60 text-xs font-medium text-muted-foreground">
            История отзывов ({revoked.length})
          </div>
          <GrantRows rows={revoked} byKey={byKey} />
        </div>
      )}
    </div>
  );
}

function GrantRows({
  rows,
  byKey,
  onRevoke,
}: {
  rows: Grant[];
  byKey: Map<string, AwardRow>;
  onRevoke?: (g: Grant) => void;
}) {
  if (rows.length === 0) {
    return <p className="px-4 py-3 text-sm text-muted-foreground">Пусто</p>;
  }
  return (
    <div className="divide-y divide-border/60">
      {rows.map((g) => (
        <div key={g.id} className="flex items-center gap-3 px-4 py-2.5">
          <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[11px] font-semibold uppercase flex-shrink-0">
            {g.username?.[0] ?? "?"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm truncate">
              <span className="font-medium">@{g.username || g.user_id.slice(0, 8)}</span>
              <span className="text-muted-foreground"> · </span>
              <span>{byKey.get(g.award_key) ? awardName(byKey.get(g.award_key)!) : g.award_key}</span>
              {g.auto_granted && (
                <span className="ml-1.5 inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                  авто
                </span>
              )}
            </p>
            {(g.reason || g.awarded_by) && (
              <p className="text-xs text-muted-foreground truncate">
                {[g.awarded_by ? `@${g.awarded_by}` : "", g.reason].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <time className="text-xs text-muted-foreground whitespace-nowrap">
            {new Date(g.awarded_at).toLocaleDateString("ru-RU")}
          </time>
          {onRevoke && !g.revoked_at && (
            <Button size="sm" variant="ghost" onClick={() => onRevoke(g)} className="text-muted-foreground">
              <Undo2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Modals ──────────────────────────────────────────────────────────────────

function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          "relative w-full rounded-xl border border-border bg-card shadow-2xl my-auto",
          wide ? "max-w-2xl" : "max-w-lg",
        )}
      >
        <div className="flex items-start justify-between gap-4 p-5 border-b border-border/60">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 -m-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 p-4 border-t border-border/60">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** datetime-local value (local time) → RFC3339 UTC for the API. */
function localInputToISO(v: string): string {
  return new Date(v).toISOString();
}

/** RFC3339 → local datetime-local value for the input. */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Default auto window: now → +7 days, as a local datetime-local value. */
function defaultLocalInput(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function uploadAwardArt(awardKey: string, file: File): Promise<void> {
  const token = api.getToken();
  const form = new FormData();
  form.append("key", awardKey);
  form.append("file", file);
  const res = await fetch("/api/v1/admin/awards/image", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `Ошибка ${res.status}`);
}

function AwardEditor({
  award,
  rule,
  onClose,
  onSaved,
}: {
  award: AwardRow | null;
  rule: AutoRule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!award;
  const [key, setKey] = useState(award?.group_key ?? "");
  const [title, setTitle] = useState(award ? awardName(award) : "");
  const [description, setDescription] = useState(award?.description ?? "");
  const [icon, setIcon] = useState(award?.icon ?? "trophy");
  const [sortOrder, setSortOrder] = useState(award?.sort_order ?? 100);
  const [busy, setBusy] = useState(false);

  // Art: current image plus an optional replacement file.
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(award?.image_url || null);
  useEffect(() => {
    return () => {
      if (preview && preview.startsWith("blob:")) URL.revokeObjectURL(preview);
    };
  }, [preview]);
  const pick = (f: File | null) => {
    if (!f) return;
    setPreview((prev) => {
      if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
      return URL.createObjectURL(f);
    });
    setFile(f);
  };

  // Auto-issuance rule: window + AND-combined thresholds.
  const [ruleOn, setRuleOn] = useState(!!rule);
  const [activeFrom, setActiveFrom] = useState(
    rule ? isoToLocalInput(rule.active_from) : defaultLocalInput(0),
  );
  const [activeTo, setActiveTo] = useState(
    rule ? isoToLocalInput(rule.active_to) : defaultLocalInput(7),
  );
  const [minWallPosts, setMinWallPosts] = useState(rule?.min_wall_posts ?? 0);
  const [minThreads, setMinThreads] = useState(rule?.min_threads ?? 0);
  const [minLikesGiven, setMinLikesGiven] = useState(rule?.min_likes_given ?? 0);
  const [minLikesReceived, setMinLikesReceived] = useState(rule?.min_likes_received ?? 0);
  const [minActiveDays, setMinActiveDays] = useState(rule?.min_active_days ?? 0);

  const save = async () => {
    if (!title.trim()) {
      toast.error("Введите название");
      return;
    }
    if (ruleOn) {
      if (!activeFrom || !activeTo || Number.isNaN(new Date(activeFrom).getTime()) || Number.isNaN(new Date(activeTo).getTime())) {
        toast.error("Укажите корректное окно автопроверки");
        return;
      }
      if (new Date(activeTo) < new Date(activeFrom)) {
        toast.error("Конец окна раньше начала");
        return;
      }
      if ([minWallPosts, minThreads, minLikesGiven, minLikesReceived, minActiveDays].every((v) => v <= 0)) {
        toast.error("Укажите хотя бы один порог больше нуля");
        return;
      }
    }
    setBusy(true);
    try {
      let awardKey = award?.group_key ?? "";
      if (isEdit && award) {
        await apiJson("/api/v1/admin/awards", {
          method: "PATCH",
          body: JSON.stringify({
            key: award.group_key,
            title,
            description,
            icon,
            sort_order: sortOrder,
          }),
        });
      } else {
        const created = await apiJson<{ key: string }>("/api/v1/admin/awards", {
          method: "POST",
          body: JSON.stringify({
            key: key.trim() || undefined,
            title,
            description,
            icon,
            sort_order: sortOrder,
          }),
        });
        awardKey = created.key;
      }
      if (file && awardKey) {
        try {
          await uploadAwardArt(awardKey, file);
        } catch (e) {
          toast.error(`Арт не загрузился: ${(e as Error).message}`);
        }
      }
      if (ruleOn && awardKey) {
        await apiJson("/api/v1/admin/awards/rule", {
          method: "PUT",
          body: JSON.stringify({
            award_key: awardKey,
            active_from: localInputToISO(activeFrom),
            active_to: localInputToISO(activeTo),
            min_wall_posts: minWallPosts,
            min_threads: minThreads,
            min_likes_given: minLikesGiven,
            min_likes_received: minLikesReceived,
            min_active_days: minActiveDays,
          }),
        });
      } else if (!ruleOn && rule) {
        await apiJson(`/api/v1/admin/awards/rule?award_key=${encodeURIComponent(rule.award_key)}`, {
          method: "DELETE",
        });
      }
      toast.success(isEdit ? "Сохранено" : "Награда создана");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isEdit ? "Правка награды" : "Новая награда"}
      subtitle={isEdit ? award?.group_key : "Название, арт и окно автопроверки — всё в одном месте."}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            {isEdit ? "Сохранить" : "Создать"}
          </Button>
        </>
      }
    >
      {!isEdit && (
        <Field label="Ключ (ID)" hint="Латиница/цифры/подчёркивания. Пусто — сгенерируется. Потом не меняется.">
          <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="halloween_2026" />
        </Field>
      )}
      <Field label="Название">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Хэллоуин 2026" />
      </Field>
      <Field label="Описание">
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="За что выдаётся"
          rows={2}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Иконка (запасная, если нет арта)">
          <div className="flex flex-wrap gap-1.5">
            {ICON_CHOICES.map(({ name, Icon }) => (
              <button
                key={name}
                type="button"
                onClick={() => setIcon(name)}
                className={cn(
                  "w-9 h-9 rounded-md border flex items-center justify-center transition-colors",
                  icon === name
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
                title={name}
              >
                <Icon className="w-4 h-4" />
              </button>
            ))}
          </div>
        </Field>
        <Field label="Порядок">
          <Input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
          />
        </Field>
      </div>

      {/* Art */}
      <Field label="Фотокарточка награды" hint="PNG/JPG/WebP/GIF до 5 МБ. Видна в профиле во всю карточку.">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-28 h-28 rounded-lg border border-dashed border-border hover:border-primary/50 transition-colors flex items-center justify-center overflow-hidden bg-muted/30"
          >
            {preview ? (
              <img src={preview} alt="" className="w-full h-full object-contain" />
            ) : (
              <ImageIcon className="w-8 h-8 text-muted-foreground" />
            )}
          </button>
          <div className="flex-1 min-w-0 space-y-1.5">
            <Button size="sm" variant="secondary" onClick={() => inputRef.current?.click()}>
              <Upload className="w-3.5 h-3.5 mr-1" />
              {preview ? "Заменить" : "Выбрать файл"}
            </Button>
            {file && <p className="text-xs text-muted-foreground truncate">{file.name}</p>}
            {!file && preview && (
              <p className="text-xs text-muted-foreground">Текущий арт. Выберите файл, чтобы заменить.</p>
            )}
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />
      </Field>

      {/* Auto-issuance */}
      <div className="rounded-lg border border-border/70 p-4 space-y-4">
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={ruleOn}
            onChange={(e) => setRuleOn(e.target.checked)}
            className="w-4 h-4 rounded accent-primary"
          />
          <span className="text-sm font-medium">Выдавать автоматически за активность</span>
        </label>
        {ruleOn && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Активность с" hint="Включительно">
                <Input
                  type="datetime-local"
                  value={activeFrom}
                  onChange={(e) => setActiveFrom(e.target.value)}
                />
              </Field>
              <Field label="Активность по" hint="Включительно. Позже — никому.">
                <Input
                  type="datetime-local"
                  value={activeTo}
                  onChange={(e) => setActiveTo(e.target.value)}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Field label="Постов на стене ≥">
                <Input type="number" min={0} value={minWallPosts} onChange={(e) => setMinWallPosts(Number(e.target.value))} />
              </Field>
              <Field label="Тредов ≥">
                <Input type="number" min={0} value={minThreads} onChange={(e) => setMinThreads(Number(e.target.value))} />
              </Field>
              <Field label="Лайков поставлено ≥">
                <Input type="number" min={0} value={minLikesGiven} onChange={(e) => setMinLikesGiven(Number(e.target.value))} />
              </Field>
              <Field label="Лайков получено ≥">
                <Input type="number" min={0} value={minLikesReceived} onChange={(e) => setMinLikesReceived(Number(e.target.value))} />
              </Field>
              <Field label="Дней активности ≥">
                <Input type="number" min={0} value={minActiveDays} onChange={(e) => setMinActiveDays(Number(e.target.value))} />
              </Field>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Все условия — одновременно (И). Проверка каждый час и кнопкой «Проверить и выдать».
              Дата выдачи — момент проверки. Кто не выполнил до конца окна — не получит.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

function GrantModal({
  award,
  onClose,
  onGranted,
}: {
  award: AwardRow;
  onClose: () => void;
  onGranted: () => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<UserHit[]>([]);
  const [selected, setSelected] = useState<UserHit | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const rows = await apiJson<UserHit[]>(`/api/v1/drops/users/search?q=${encodeURIComponent(q)}`);
        setHits(rows);
      } catch {
        setHits([]);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  const grant = async () => {
    if (!selected) {
      toast.error("Выберите пользователя");
      return;
    }
    setBusy(true);
    try {
      await apiJson("/api/v1/admin/awards/grant", {
        method: "POST",
        body: JSON.stringify({ user_id: selected.id, award_key: award.group_key, reason }),
      });
      toast.success(`Выдано @${selected.username}`);
      onGranted();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Выдать награду"
      subtitle={awardName(award)}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={grant} disabled={busy || !selected}>
            {busy && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Выдать
          </Button>
        </>
      }
    >
      <Field label="Пользователь">
        {selected ? (
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[11px] font-semibold uppercase">
              {selected.username[0]}
            </div>
            <span className="text-sm">@{selected.username}</span>
            <button
              onClick={() => {
                setSelected(null);
                setQuery("");
              }}
              className="ml-auto text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по юзернейму"
              className="pl-9"
            />
            {hits.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 rounded-md border border-border bg-popover shadow-lg max-h-56 overflow-y-auto">
                {hits.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => setSelected(u)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold uppercase">
                      {u.username[0]}
                    </div>
                    @{u.username}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </Field>
      <Field label="Причина" hint="Видна получателю рядом с наградой.">
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="За помощь с релизом"
          rows={3}
        />
      </Field>
    </Modal>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border py-14 flex flex-col items-center gap-1 text-center">
      <Trophy className="w-6 h-6 text-muted-foreground/60" />
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}
