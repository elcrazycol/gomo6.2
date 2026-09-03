import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Play, RotateCcw, Sparkles, XCircle, Dices, Package, Trash2, Upload, ImageOff, Check } from "lucide-react";
import { toast } from "sonner";

// ─── Types (mirror of internal/gamification + catalog) ───────────────────────

interface RarityInfo {
  rarity: string;
  color: string;
  image_url: string;
  opened_image_url: string;
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

// Mix a hex rarity color toward white so letters stay readable on the dark
// stage (background-clip:text proved unreliable here — plain solid text only).
function lightenColor(hex: string, amt = 0.35): string {
  const m = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(m)) return hex;
  const n = parseInt(m, 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amt);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

// Deterministic ambient backdrop for the chest stage (no Math.random in render).
const TWINKLES = Array.from({ length: 16 }, (_, i) => ({
  x: 4 + ((i * 61) % 92),
  y: 6 + ((i * 37) % 88),
  s: 1 + (i % 3),
  c: i % 2 === 0 ? "#ffffff" : "#ffd9a0",
  d: 2.5 + (i % 4) * 0.7,
  delay: (i * 0.35) % 3,
}));

// Upload a PNG into the gamification bucket under an explicit key. Admin-only
// server-side (same path and role as gift-layers), so textures are curated.
async function uploadTexture(file: File, key: string): Promise<void> {
  const token = api.getToken();
  if (!token) throw new Error("Not authenticated");

  const formData = new FormData();
  formData.append("file", file);
  formData.append("bucket", "gamification");
  formData.append("key", key);

  const res = await fetch("/storage/v1/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Upload failed");
}

// ─── RarityTexture: image with color placeholder fallback ────────────────────

function RarityTexture({ url, color, alt, className, iconClass }: {
  url: string;
  color: string;
  alt: string;
  className?: string;
  iconClass?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);

  if (!url || failed) {
    return (
      <div
        className={`flex items-center justify-center ${className || ""}`}
        style={{ background: `${color}1f`, border: `1px dashed ${color}66` }}
      >
        <ImageOff className={`${iconClass || "w-5 h-5"} text-muted-foreground/60`} />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      onError={() => setFailed(true)}
      className={`object-contain ${className || ""}`}
      draggable={false}
    />
  );
}

// ─── TextureSlot: one rarity texture (closed or opened) with upload ─────────

function TextureSlot({ rarity, opened, url, color, cacheBust, onUploaded }: {
  rarity: string;
  opened: boolean;
  url: string;
  color: string;
  cacheBust: number;
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [justUploaded, setJustUploaded] = useState(false);

  const key = opened ? `${rarity}_opened.png` : `${rarity}.png`;
  const src = url ? `${url}?v=${cacheBust}` : "";

  const doUpload = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Только картинки (PNG)");
      return;
    }
    setUploading(true);
    try {
      await uploadTexture(file, key);
      setJustUploaded(true);
      setTimeout(() => setJustUploaded(false), 1500);
      onUploaded();
      toast.success(`${key} — загружено`);
    } catch (err: any) {
      toast.error(`Ошибка загрузки ${key}: ${err.message}`);
    } finally {
      setUploading(false);
    }
  }, [key, onUploaded]);

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); doUpload(e.dataTransfer.files?.[0]); }}
      onClick={() => inputRef.current?.click()}
      className={`relative aspect-square rounded-xl border overflow-hidden cursor-pointer transition-all ${
        dragOver ? "border-primary ring-2 ring-primary/40 scale-[1.03]" : "border-border hover:border-primary/50"
      }`}
      title={opened ? `${rarityLabel(rarity)} (открытый) — кликни, чтобы загрузить ${key}` : `${rarityLabel(rarity)} — кликни, чтобы загрузить ${key}`}
    >
      {src && !justUploaded ? (
        <RarityTexture url={src} color={color} alt={key} className="w-full h-full p-1.5" iconClass="w-6 h-6" />
      ) : justUploaded ? (
        <div className="w-full h-full flex items-center justify-center bg-emerald-500/10">
          <Check className="w-6 h-6 text-emerald-500" />
        </div>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1" style={{ background: `${color}14` }}>
          <Upload className="w-5 h-5 text-muted-foreground/50" />
          <span className="text-[9px] text-muted-foreground/70 font-medium">{opened ? "opened" : "closed"}</span>
        </div>
      )}
      {uploading && (
        <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
          <PentagramLoader size="sm" />
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/webp,image/jpeg"
        className="hidden"
        onChange={e => { doUpload(e.target.files?.[0]); e.target.value = ""; }}
      />
    </div>
  );
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
  // Bumped after uploads so <img> URLs get a fresh query param (deterministic keys).
  const [cacheBust, setCacheBust] = useState(0);

  // Active chest session
  const [mechanicKey, setMechanicKey] = useState<string>("");
  const [state, setState] = useState<ChestState | null>(null);
  const [lastEvent, setLastEvent] = useState<ChestEvent | null>(null);
  const [lastChance, setLastChance] = useState<number | null>(null);
  const [lastRoll, setLastRoll] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  // One-shot FX burst (rings/sparkles/chest animation), re-triggered by id.
  const [fx, setFx] = useState<{ id: number; kind: "fail" | "upgrade" | "open" } | null>(null);
  const [chestImgFailed, setChestImgFailed] = useState(false);
  const chestRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    api.getSession().then(({ session }) => {
      if (!session) navigate("/login?redirect=/chests");
      setSessionChecked(true);
    });
  }, [navigate]);

  const loadCatalog = useCallback(async () => {
    try {
      const res = await api.fetch("/api/v1/gamification/catalog");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load catalog");
      const data = json.data as { rarities: RarityInfo[]; mechanics: MechanicInfo[] };
      setRarities(data.rarities || []);
      setMechanics(data.mechanics || []);
      setMechanicKey(prev => prev || data.mechanics?.[0]?.key || "");
      setCatalogError(null);
    } catch (err: any) {
      console.error(err);
      setCatalogError(err.message || "Failed to load catalog");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load the catalog once (rarities + registered chest mechanics).
  useEffect(() => {
    if (!sessionChecked) return;
    loadCatalog();
  }, [sessionChecked, loadCatalog]);

  const mechanicConfig = mechanics.find((m) => m.key === mechanicKey)?.config;
  const rarityInfo = (r: string) => rarities.find((x) => x.rarity === r);
  const rarityColor = (r: string) => rarityInfo(r)?.color || "#888";

  // Sparkle burst particles, regenerated per FX burst.
  const sparkles = useMemo(() => {
    if (!fx || fx.kind === "fail") return [];
    return Array.from({ length: 14 }, () => ({
      dx: `${(Math.random() - 0.5) * 320}px`,
      dy: `${-60 - Math.random() * 220}px`,
      delay: `${(Math.random() * 0.28).toFixed(2)}s`,
      size: 3 + Math.random() * 5,
    }));
  }, [fx]);

  // Chest texture animation via Web Animations API — replayable, no remounts.
  const animateChest = useCallback((kind: "fail" | "upgrade" | "open") => {
    const el = chestRef.current;
    if (!el) return;
    el.getAnimations().forEach((a) => a.cancel());
    if (kind === "fail") {
      el.animate(
        [
          { transform: "translateX(0)" },
          { transform: "translateX(-8px)" },
          { transform: "translateX(7px)" },
          { transform: "translateX(-5px)" },
          { transform: "translateX(4px)" },
          { transform: "translateX(0)" },
        ],
        { duration: 400, easing: "ease-in-out" }
      );
    } else if (kind === "upgrade") {
      el.animate(
        [
          { transform: "translateY(0) scale(1)" },
          { transform: "translateY(-14px) scale(1.08)" },
          { transform: "translateY(0) scale(0.95)" },
          { transform: "translateY(-6px) scale(1.03)" },
          { transform: "translateY(0) scale(1)" },
        ],
        { duration: 600, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" }
      );
    } else {
      el.animate(
        [
          { transform: "scale(0.8)", opacity: 0.3 },
          { transform: "scale(1.07)", opacity: 1 },
          { transform: "scale(1)", opacity: 1 },
        ],
        { duration: 500, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" }
      );
    }
  }, []);

  // Reset the texture error flag whenever the shown texture changes.
  useEffect(() => {
    setChestImgFailed(false);
  }, [state?.rarity, state?.opened, cacheBust]);

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
      setFx(null);
      setChestImgFailed(false);
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

      const kind: "fail" | "upgrade" | "open" =
        data.event.type === "opened" ? "open" : data.event.type === "upgraded" ? "upgrade" : "fail";
      setFx({ id: Date.now(), kind });
      animateChest(kind);

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
  }, [state, history, animateChest]);

  const onTextureUploaded = useCallback(() => {
    setCacheBust(v => v + 1);
  }, []);

  if (!sessionChecked || loading) {
    return <div className="flex items-center justify-center py-20"><PentagramLoader size="lg" /></div>;
  }

  const color = state ? rarityColor(state.rarity) : "#888";
  const isEternal = state?.rarity === "eternal";
  const imgSrc = state
    ? (state.opened ? rarityInfo(state.rarity)?.opened_image_url : rarityInfo(state.rarity)?.image_url) || ""
    : "";

  return (
    <div className="space-y-6 max-w-5xl">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="w-6 h-6" /> Сундуки
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Песочница геймификации: тапай по сундуку, проверяй флоу редкостей и загружай текстурки
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
          {/* Rarity ladder with textures */}
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
              <div className="flex flex-wrap gap-2">
                {rarities.map((r) => {
                  const idx = rarities.findIndex((x) => x.rarity === state.rarity);
                  const reached = rarities.indexOf(r) <= idx;
                  const current = state?.rarity === r.rarity;
                  return (
                    <div
                      key={r.rarity}
                      className={`flex flex-col items-center gap-1 rounded-xl border p-1.5 transition-all ${
                        current ? "ring-2 ring-offset-1" : ""
                      } ${!reached ? "opacity-35 saturate-50" : ""}`}
                      style={{
                        borderColor: current ? r.color : `${r.color}55`,
                        boxShadow: current ? `0 0 14px ${r.color}66` : undefined,
                      }}
                    >
                      <RarityTexture
                        url={`${r.image_url}?v=${cacheBust}`}
                        color={r.color}
                        alt={r.rarity}
                        className={`w-12 h-12 ${isEternal && current ? "eternal-glow rounded-lg" : ""}`}
                        iconClass="w-4 h-4"
                      />
                      <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: r.color }}>
                        {rarityLabel(r.rarity)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Chest stage — pure texture, every effect sits BEHIND the PNG */}
          <Card className="overflow-hidden border-border/60">
            <CardContent className="p-0">
              <div
                className="relative overflow-hidden flex flex-col items-center justify-center py-14 md:py-16 px-6"
                style={{ background: "linear-gradient(180deg, #14161e 0%, #0a0b10 55%, #0e1016 100%)" }}
              >
                {/* rarity tint wash */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{ background: `radial-gradient(55% 75% at 50% 38%, ${color}1f 0%, transparent 70%)` }}
                />
                {/* ambient twinkles */}
                <div className="absolute inset-0 pointer-events-none">
                  {TWINKLES.map((t, i) => (
                    <span
                      key={i}
                      className="absolute rounded-full"
                      style={{
                        left: `${t.x}%`,
                        top: `${t.y}%`,
                        width: t.s,
                        height: t.s,
                        background: t.c,
                        animation: `chest-twinkle ${t.d}s ease-in-out ${t.delay}s infinite`,
                      }}
                    />
                  ))}
                </div>

                {/* chest column */}
                <div className="relative z-10 flex flex-col items-center">
                  {/* floating chest + all FX behind the texture */}
                  <div className="relative chest-float">
                    {/* main glow — behind the PNG */}
                    <div
                      className="absolute left-1/2 top-1/2 w-[420px] h-[420px] rounded-full pointer-events-none"
                      style={{
                        background: isEternal
                          ? "conic-gradient(#ff4d4d, #ff9a3d, #ffe14d, #5cff8a, #4dc9ff, #a44dff, #ff4d4d)"
                          : `radial-gradient(circle, ${color} 0%, ${color}55 45%, transparent 70%)`,
                        filter: "blur(44px)",
                        opacity: 0.65,
                        boxShadow: isEternal ? "0 0 90px 30px rgba(255,255,255,0.16)" : undefined,
                        animation: isEternal
                          ? "eternal-rainbow-spin 3.2s linear infinite"
                          : "chest-glow-breathe 3.2s ease-in-out infinite",
                      }}
                    />
                    {/* tight inner glow — behind the PNG */}
                    <div
                      className="absolute left-1/2 top-1/2 w-64 h-64 rounded-full pointer-events-none"
                      style={{
                        background: `radial-gradient(circle, ${color}dd 0%, transparent 62%)`,
                        filter: "blur(26px)",
                        opacity: 0.55,
                        transform: "translate(-50%, -50%)",
                      }}
                    />

                    {/* expanding rings on upgrade / open */}
                    {fx && fx.kind !== "fail" && (
                      <div
                        key={`ring-a-${fx.id}`}
                        className="absolute left-1/2 top-1/2 w-40 h-40 rounded-full pointer-events-none"
                        style={{
                          border: `2.5px solid ${fx.kind === "open" ? "#ffffff" : color}`,
                          animation: "chest-ring 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards",
                        }}
                      />
                    )}
                    {fx && fx.kind === "open" && (
                      <div
                        key={`ring-b-${fx.id}`}
                        className="absolute left-1/2 top-1/2 w-40 h-40 rounded-full pointer-events-none"
                        style={{
                          border: `1.5px solid ${color}`,
                          animation: "chest-ring 1s cubic-bezier(0.16, 1, 0.3, 1) 0.12s forwards",
                        }}
                      />
                    )}

                    {/* sparkles on upgrade / open */}
                    {fx &&
                      fx.kind !== "fail" &&
                      sparkles.map((s, i) => (
                        <span
                          key={`spark-${fx.id}-${i}`}
                          className="absolute left-1/2 top-1/2 rounded-full pointer-events-none"
                          style={{
                            width: s.size,
                            height: s.size,
                            background: fx.kind === "open" ? "#ffffff" : color,
                            boxShadow: `0 0 ${s.size * 3}px ${fx.kind === "open" ? "#ffffff" : color}`,
                            animation: `chest-sparkle 1s ease-out ${s.delay}s forwards`,
                            // @ts-expect-error custom CSS variable
                            "--dx": s.dx,
                            "--dy": s.dy,
                          }}
                        />
                      ))}

                    {/* the chest itself — no chrome, just the texture */}
                    {imgSrc && !chestImgFailed ? (
                      <img
                        ref={chestRef}
                        src={`${imgSrc}?v=${cacheBust}`}
                        alt={state.opened ? `${state.rarity} opened` : state.rarity}
                        draggable={false}
                        onError={() => setChestImgFailed(true)}
                        onClick={() => !busy && !state.opened && tap("")}
                        className={`relative z-10 w-56 h-56 md:w-72 md:h-72 object-contain select-none ${
                          state.opened
                            ? ""
                            : "cursor-pointer transition-transform duration-150 hover:scale-[1.05] active:scale-[0.96]"
                        }`}
                        style={{ filter: "drop-shadow(0 20px 34px rgba(0,0,0,0.55))" }}
                        title={state.opened ? "Сундук открыт" : "Тапни по сундуку"}
                      />
                    ) : (
                      <div
                        className="relative z-10 w-56 h-56 md:w-72 md:h-72 rounded-2xl flex items-center justify-center"
                        style={{ background: `${color}14`, border: `1px dashed ${color}55` }}
                      >
                        <ImageOff className="w-10 h-10 text-muted-foreground/40" />
                      </div>
                    )}
                  </div>

                  {/* rarity name — solid letters (no bg-clip), glow via text-shadow */}
                  <h3 className="mt-7 text-2xl md:text-3xl font-extrabold uppercase tracking-[0.28em] text-center">
                    <span
                      className={isEternal ? "eternal-rainbow-text" : undefined}
                      style={{
                        color: isEternal ? "#ffffff" : lightenColor(color),
                        textShadow: isEternal
                          ? undefined
                          : `0 0 18px ${color}66, 0 0 44px ${color}40`,
                      }}
                    >
                      {rarityLabel(state.rarity)}
                    </span>
                    <span
                      className="block mx-auto mt-2.5 h-[3px] w-16 rounded-full"
                      style={{
                        background: isEternal
                          ? "linear-gradient(90deg, #ff4d4d, #ffb347, #ffe14d, #5cff8a, #4dc9ff, #a44dff, #ff4d4d)"
                          : `linear-gradient(90deg, transparent, ${color}, transparent)`,
                        backgroundSize: isEternal ? "200% 100%" : undefined,
                        boxShadow: isEternal ? "0 0 12px 1px rgba(255,255,255,0.35)" : `0 0 10px ${color}88`,
                        animation: isEternal ? "eternal-text-shift 3s linear infinite" : undefined,
                      }}
                    />
                  </h3>

                  {/* attempts / итог */}
                  {!state.opened ? (
                    <div className="mt-4 flex items-center gap-2.5">
                      {Array.from({ length: mechanicConfig?.attempts_per_tier ?? 5 }).map((_, i) => {
                        const spent = i >= state.attempts_left;
                        return (
                          <span
                            key={i}
                            className="rounded-full transition-all duration-300"
                            style={{
                              width: 11,
                              height: 11,
                              background: spent ? "transparent" : color,
                              border: `1.5px solid ${spent ? `${color}55` : color}`,
                              boxShadow: spent ? "none" : `0 0 12px ${color}cc`,
                              opacity: spent ? 0.4 : 1,
                              transform: spent ? "scale(0.85)" : "scale(1)",
                            }}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-4 flex items-center gap-3">
                      <span className="h-px w-10" style={{ background: `linear-gradient(90deg, transparent, ${color}aa)` }} />
                      <span className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground/70 font-semibold">итог</span>
                      <span className="text-sm font-extrabold uppercase tracking-[0.2em]" style={{ color }}>
                        {rarityLabel(state.final_rarity || state.rarity)}
                      </span>
                      <span className="h-px w-10" style={{ background: `linear-gradient(270deg, transparent, ${color}aa)` }} />
                    </div>
                  )}

                  {/* hint / last event */}
                  {!state.opened && history.length === 0 && (
                    <span className="mt-3 text-[10px] uppercase tracking-[0.3em] text-muted-foreground/40">
                      тапни по сундуку
                    </span>
                  )}
                  {lastEvent && !state.opened && (
                    <div className="mt-3 flex items-center gap-2 text-xs">
                      {lastEvent.type === "upgraded" ? (
                        <span className="font-semibold" style={{ color: "#5cff8a", textShadow: "0 0 12px rgba(92,255,138,0.45)" }}>
                          ⬆ Редкость повышена!
                        </span>
                      ) : (
                        <span className="font-medium text-red-400/90">Шанс не выпал</span>
                      )}
                      {lastChance !== null && (
                        <span className="text-muted-foreground/60 font-mono">шанс {Math.round(lastChance * 100)}%</span>
                      )}
                      {lastRoll !== null && (
                        <span className="text-muted-foreground/60 font-mono">roll {lastRoll.toFixed(3)}</span>
                      )}
                    </div>
                  )}

                  {/* dev controls — discreet, the chest itself is the button */}
                  <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
                    {!state.opened ? (
                      <>
                        <Button onClick={() => tap("upgrade")} disabled={busy} variant="ghost" size="sm" className="gap-1.5 text-amber-300/80 hover:text-amber-200 hover:bg-white/5">
                          <Sparkles className="w-3.5 h-3.5" /> Улучшить
                        </Button>
                        <Button onClick={() => tap("fail")} disabled={busy} variant="ghost" size="sm" className="gap-1.5 text-red-400/75 hover:text-red-300 hover:bg-white/5">
                          <XCircle className="w-3.5 h-3.5" /> Провалить
                        </Button>
                        <span className="text-muted-foreground/40 text-xs select-none">·</span>
                        <Button onClick={() => tap("")} disabled={busy} variant="ghost" size="sm" className="gap-1.5 text-muted-foreground/70 hover:text-foreground hover:bg-white/5">
                          <Dices className="w-3.5 h-3.5" /> Случайно
                        </Button>
                      </>
                    ) : (
                      <Button onClick={() => startChest()} disabled={busy} size="sm" className="gap-2">
                        <RotateCcw className="w-4 h-4" /> Открыть следующий
                      </Button>
                    )}
                  </div>
                </div>
              </div>
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

      {/* ── Texture upload panel (always visible) ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="w-4 h-4" /> Текстурки сундуков
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              {rarities.length} редкостей × (closed + opened) · ключи <code className="text-foreground/70">{`<rarity>.png`}</code>
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-xs text-muted-foreground">
            Кликни по слоту или перетащи PNG (700×700, прозрачный фон). Текстурка сразу подхватится лестницей и сундуком —
            бакет <code className="text-foreground/70">gamification</code>, ключи <code className="text-foreground/70">common.png</code>,{" "}
            <code className="text-foreground/70">common_opened.png</code> и т.д.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {rarities.map((r) => (
              <div key={r.rarity} className="space-y-2">
                <div className="text-center text-xs font-semibold uppercase tracking-wide" style={{ color: r.color }}>
                  {rarityLabel(r.rarity)}
                </div>
                <TextureSlot
                  rarity={r.rarity}
                  opened={false}
                  url={r.image_url}
                  color={r.color}
                  cacheBust={cacheBust}
                  onUploaded={onTextureUploaded}
                />
                <TextureSlot
                  rarity={r.rarity}
                  opened={true}
                  url={r.opened_image_url}
                  color={r.color}
                  cacheBust={cacheBust}
                  onUploaded={onTextureUploaded}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Chests;