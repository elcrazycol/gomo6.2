import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Play, RotateCcw, Sparkles, XCircle, Dices, Package, Trash2 } from "lucide-react";
import { toast } from "sonner";

// ─── Types (mirror of internal/gamification) ────────────────────────────────

interface RarityInfo {
  rarity: string;
  color: string;
}

interface ChestConfig {
  key: string;
  start_rarity: string;
  max_rarity: string;
  attempts_per_tier: number;
  upgrade_chances: Record<string, number>;
}

interface MechanicInfo {
  key: string;
  config?: ChestConfig;
}

interface ChestState {
  mechanic_key: string;
  rarity: string;
  attempts_left: number;
  opened: boolean;
  final_rarity?: string;
}

interface ChestEvent {
  type: "upgraded" | "failed" | "opened";
  rarity: string;
  attempts_left: number;
  final_rarity?: string;
}

interface TapResult {
  state: ChestState;
  event: ChestEvent;
  chance?: number;
  roll?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RARITY_LABELS: Record<string, string> = {
  common: "Common",
  unusual: "Unusual",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
  mythic: "Mythic",
  eternal: "Eternal",
};

function rarityLabel(r: string): string {
  return RARITY_LABELS[r] ?? r;
}

// ─── Component ───────────────────────────────────────────────────────────────

const Chests = () => {
  const navigate = useNavigate();
  const [sessionChecked, setSessionChecked] = useState(false);

  // Catalog (rarity ladder + mechanics with config)
  const [rarities, setRarities] = useState<RarityInfo[]>([]);
  const [mechanics, setMechanics] = useState<MechanicInfo[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Active chest session
  const [mechanicKey, setMechanicKey] = useState<string>("");
  const [state, setState] = useState<ChestState | null>(null);
  const [lastEvent, setLastEvent] = useState<ChestEvent | null>(null);
  const [lastChance, setLastChance] = useState<number | null>(null);
  const [lastRoll, setLastRoll] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    api.getSession().then(({ session }) => {
      if (!session) navigate("/login?redirect=/chests");
      setSessionChecked(true);
    });
  }, [navigate]);

  // Load the catalog once (rarities + registered chest mechanics).
  useEffect(() => {
    if (!sessionChecked) return;
    (async () => {
      try {
        const res = await api.fetch("/api/v1/gamification/catalog");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load catalog");
        const data = json.data as { rarities: RarityInfo[]; mechanics: MechanicInfo[] };
        setRarities(data.rarities || []);
        setMechanics(data.mechanics || []);
        const first = data.mechanics?.[0]?.key || "";
        setMechanicKey(first);
        setCatalogError(null);
      } catch (err: any) {
        console.error(err);
        setCatalogError(err.message || "Failed to load catalog");
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionChecked]);

  const mechanicConfig = mechanics.find((m) => m.key === mechanicKey)?.config;
  const rarityColor = (r: string) => rarities.find((x) => x.rarity === r)?.color || "#888";

  // Spawn a fresh chest.
  const startChest = useCallback(async (key?: string) => {
    const k = key || mechanicKey;
    if (!k) return;
    setBusy(true);
    try {
      const res = await api.fetch("/api/v1/gamification/chests/start", {
        method: "POST",
        body: JSON.stringify({ mechanic: k }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to start");
      const data = json.data as { state: ChestState };
      setState(data.state);
      setLastEvent(null);
      setLastChance(null);
      setLastRoll(null);
      setHistory([]);
    } catch (err: any) {
      toast.error(err.message || "Failed to start chest");
    } finally {
      setBusy(false);
    }
  }, [mechanicKey]);

  // One tap with an optional force mode.
  const tap = useCallback(async (force: "" | "upgrade" | "fail" | "roll", rollValue?: number) => {
    if (!state || state.opened) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { state, force };
      if (force === "roll" && rollValue !== undefined) body.roll = rollValue;
      const res = await api.fetch("/api/v1/gamification/chests/tap", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to tap");
      const data = json.data as TapResult;

      setState(data.state);
      setLastEvent(data.event);
      setLastChance(data.chance ?? null);
      setLastRoll(data.roll ?? null);

      const chance = data.chance !== undefined && data.chance !== null
        ? `${(data.chance * 100).toFixed(0)}%`
        : "—";
      const roll = data.roll !== undefined ? data.roll.toFixed(3) : "—";
      const lines = [...history];
      if (data.event.type === "opened") {
        lines.push(`→ Открыт: ${rarityLabel(data.event.final_rarity || data.event.rarity)} (roll ${roll})`);
      } else {
        lines.push(
          `${data.event.type === "upgraded" ? "⬆" : "✗"} ${rarityLabel(data.event.rarity)} · шанс ${chance} · roll ${roll} · попыток: ${data.event.attempts_left}`
        );
      }
      setHistory(lines);
    } catch (err: any) {
      toast.error(err.message || "Failed to tap");
    } finally {
      setBusy(false);
    }
  }, [state, history]);

  if (!sessionChecked || loading) {
    return <div className="flex items-center justify-center py-20"><PentagramLoader size="lg" /></div>;
  }

  const color = state ? rarityColor(state.rarity) : "#888";

  return (
    <div className="space-y-6 max-w-5xl">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="w-6 h-6" /> Сундуки
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Песочница геймификации: тапай по сундуку и проверяй флоу редкостей
          </p>
        </div>
        {state && (
          <Button onClick={() => startChest()} disabled={busy} className="gap-2">
            <RotateCcw className="w-4 h-4" /> Новый сундук
          </Button>
        )}
      </div>

      {catalogError && (
        <Card className="border-destructive/40">
          <CardContent className="py-6 text-center">
            <p className="text-sm text-destructive">Не удалось загрузить каталог: {catalogError}</p>
          </CardContent>
        </Card>
      )}

      {/* ── Mechanic picker + rarity ladder ── */}
      {!state && !catalogError && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Выбери тип сундука</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {mechanics.map((m) => (
                <Button
                  key={m.key}
                  variant={mechanicKey === m.key ? "default" : "outline"}
                  onClick={() => setMechanicKey(m.key)}
                  className="gap-2"
                >
                  <Package className="w-4 h-4" /> {m.key}
                </Button>
              ))}
            </div>
            {mechanicConfig && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-muted-foreground">
                <div>Старт: <span className="text-foreground">{rarityLabel(mechanicConfig.start_rarity)}</span></div>
                <div>Макс: <span className="text-foreground">{rarityLabel(mechanicConfig.max_rarity)}</span></div>
                <div>Попыток/тир: <span className="text-foreground">{mechanicConfig.attempts_per_tier}</span></div>
                <div>Типов: <span className="text-foreground">{mechanics.length}</span></div>
              </div>
            )}
            <Button onClick={() => startChest()} disabled={busy} className="gap-2">
              <Play className="w-4 h-4" /> Выдать сундук
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Chest in play ── */}
      {state && (
        <>
          {/* Rarity ladder */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Лестница редкостей
                </h2>
                {mechanicConfig && (
                  <span className="text-xs text-muted-foreground">
                    потолок: {rarityLabel(mechanicConfig.max_rarity)}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {rarities.map((r) => {
                  const reached = rarities.indexOf(r) <= (state ? rarities.findIndex((x) => x.rarity === state.rarity) : -1);
                  const current = state?.rarity === r.rarity;
                  return (
                    <Badge
                      key={r.rarity}
                      className={`h-7 gap-1.5 ${current ? "ring-2 ring-offset-1" : ""} ${
                        !reached ? "opacity-40" : ""
                      }`}
                      style={{
                        backgroundColor: `${r.color}22`,
                        borderColor: r.color,
                        color: r.color,
                        boxShadow: current ? `0 0 12px ${r.color}66` : undefined,
                      }}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color }} />
                      {rarityLabel(r.rarity)}
                    </Badge>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Chest + controls */}
          <Card>
            <CardContent className="p-6 flex flex-col items-center">
              {/* Chest visual */}
              <div
                className={`w-40 h-40 rounded-2xl border-2 flex flex-col items-center justify-center gap-1 relative ${
                  state.opened ? "" : "cursor-pointer hover:scale-[1.02] active:scale-95 transition-transform"
                }`}
                style={{
                  borderColor: color,
                  background: `radial-gradient(circle at 50% 30%, ${color}33, ${color}11 70%)`,
                  boxShadow: state.opened ? `0 0 30px ${color}55` : `0 0 18px ${color}44`,
                }}
                onClick={() => !busy && !state.opened && tap("")}
                title={state.opened ? "Сундук открыт" : "Тапни по сундуку"}
              >
                <span
                  className="text-5xl"
                  style={{ filter: state.opened ? "drop-shadow(0 0 8px currentColor)" : undefined, color }}
                >
                  {state.opened ? "🎁" : "📦"}
                </span>
                <span className="text-sm font-bold uppercase tracking-widest" style={{ color }}>
                  {rarityLabel(state.rarity)}
                </span>
                {state.opened && (
                  <Badge className="absolute -bottom-3 bg-amber-500/20 text-amber-500 border-amber-500/40">
                    Итог: {rarityLabel(state.final_rarity || state.rarity)}
                  </Badge>
                )}
              </div>

              {/* Attempt pips */}
              {!state.opened && (
                <div className="flex items-center gap-1.5 mt-6">
                  {Array.from({ length: mechanicConfig?.attempts_per_tier ?? 5 }).map((_, i) => (
                    <span
                      key={i}
                      className="w-3.5 h-3.5 rounded-full border"
                      style={{
                        backgroundColor: i < state.attempts_left ? color : "transparent",
                        borderColor: color,
                      }}
                    />
                  ))}
                  <span className="ml-2 text-xs text-muted-foreground">
                    попыток: {state.attempts_left}
                  </span>
                </div>
              )}

              {/* Controls */}
              {!state.opened && (
                <div className="flex flex-wrap items-center justify-center gap-2 mt-5">
                  <Button onClick={() => tap("")} disabled={busy} className="gap-2" size="lg">
                    <Dices className="w-4 h-4" /> Тапнуть (случайно)
                  </Button>
                  <Button onClick={() => tap("upgrade")} disabled={busy} variant="secondary" className="gap-2">
                    <Sparkles className="w-4 h-4" /> Улучшить
                  </Button>
                  <Button onClick={() => tap("fail")} disabled={busy} variant="outline" className="gap-2 text-red-500 border-red-500/40 hover:bg-red-500/10">
                    <XCircle className="w-4 h-4" /> Провалить
                  </Button>
                </div>
              )}
              {state.opened && (
                <Button onClick={() => startChest()} disabled={busy} className="gap-2 mt-5">
                  <RotateCcw className="w-4 h-4" /> Открыть следующий
                </Button>
              )}

              {/* Last event readout */}
              {lastEvent && !state.opened && (
                <div className="mt-5 flex items-center gap-2 text-sm">
                  {lastEvent.type === "upgraded" ? (
                    <span className="text-emerald-500 font-medium">⬆ Редкость повышена!</span>
                  ) : (
                    <span className="text-red-400 font-medium">Шанс не выпал</span>
                  )}
                  <span className="text-muted-foreground text-xs">
                    {lastChance !== null && <>шанс {Math.round(lastChance * 100)}% · </>}
                    {lastRoll !== null && <>roll {lastRoll.toFixed(3)} · </>}
                    попыток: {state.attempts_left}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Event history */}
          {history.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">История тапов</CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setHistory([])}
                    className="text-muted-foreground gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Очистить
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 font-mono text-xs">
                  {history.slice(-12).reverse().map((line, i) => (
                    <li key={history.length - i} className="text-muted-foreground">
                      {line}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Config reference */}
          {mechanicConfig && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Шансы улучшения ({mechanicConfig.key})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {Object.entries(mechanicConfig.upgrade_chances || {}).map(([r, chance]) => (
                    <div key={r} className="flex items-center justify-between text-xs px-3 py-1.5 rounded-lg border border-border">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: rarityColor(r) }} />
                        {rarityLabel(r)}
                      </span>
                      <span className="text-muted-foreground">{Math.round(chance * 100)}%</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default Chests;
