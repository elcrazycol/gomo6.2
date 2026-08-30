import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { apiClient } from "@/integrations/api/client";
import { ActiEyePanel } from "./ActiEyePanel";

export interface ActiEyeDay {
  date: string;
  active: boolean;
}

export interface ActiEyeSummary {
  posts: number;
  comments: number;
  likes: number;
  active_days: number;
  current_streak: number;
  best_streak: number;
  days: ActiEyeDay[];
  seed: number;
}

/** One base color per activity counter (posts, comments, likes, visits).
 *  Kept as [r,g,b] so the gradient can desaturate/dim them by activity. */
const ACTIVITY_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [167, 139, 250], // violet-400 — записи
  [56, 189, 248], // sky-400 — комментарии
  [251, 191, 36], // amber-400 — лайки
  [52, 211, 153], // emerald-400 — заходы
];

/** Minimum fraction per active color so no color ever disappears. */
const MIN_FRAC = 0.12;

/**
 * Maps an account's total activity to a vividness in [0,1]. Log-scale so a
 * handful of actions reads as "quiet" while hundreds of actions read as
 * "alive" without the number inflating forever. 0 = muted, 1 = vivid.
 */
function vividness(summary: ActiEyeSummary): number {
  const n = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  const score =
    Math.log10(1 + n(summary.posts)) +
    Math.log10(1 + n(summary.comments)) +
    Math.log10(1 + n(summary.likes)) +
    Math.log10(1 + n(summary.active_days));
  // ~1.2 (new account) .. ~10 (very active); clamp into 0..1.6 then fold.
  return Math.max(0, Math.min(1, (score - 1.2) / 5));
}

/** Blend a base color toward gray and scale brightness by activity vividness. */
function tonedColor(c: readonly [number, number, number], v: number): string {
  const gray = 116; // muted desaturated base
  const sat = 0.45 + v * 0.55; // 0.45 flat → 1.0 vivid
  const bright = 0.55 + v * 0.5; // 0.55 dim → 1.05 punchy
  const mix = (x: number) => gray + (x - gray) * sat;
  const [r, g, b] = c;
  const clamp255 = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
  return `rgb(${clamp255(mix(r) * bright)} ${clamp255(mix(g) * bright)} ${clamp255(mix(b) * bright)})`;
}

/**
 * Builds a smooth RADIAL gradient (no conic pie-point, no sharp angles):
 * colors melt into each other in soft rings from the center to the rim.
 * Ring widths mirror the activity counters, and the user's stable seed
 * nudges the gradient center slightly off-axis so the blend stays organic.
 * The gradient is static — only the hue drift animates it. Empty when there
 * is no activity yet (caller falls back to orange).
 */
function buildGradient(summary: ActiEyeSummary): string {
  const weights = [summary.posts, summary.comments, summary.likes, summary.active_days];
  const total = weights.reduce((a, b) => a + (Number.isFinite(b) && b > 0 ? b : 0), 0);
  if (total <= 0) return "";

  const v = vividness(summary);
  const color = (i: number) => tonedColor(ACTIVITY_COLORS[i], v);

  const active = weights.filter((w) => w > 0).length;
  const pool = 1 - active * MIN_FRAC;

  const stops: string[] = [];
  const order: number[] = [];
  let frac = 0;
  weights.forEach((w, i) => {
    if (!(w > 0)) return;
    order.push(i);
    stops.push(`${color(i)} ${(frac * 100).toFixed(1)}%`);
    frac += MIN_FRAC + (w / total) * pool;
  });
  if (order.length === 0) return "";
  // Close the loop: the rim blends back toward the first color.
  stops.push(`${color(order[0])} 100%`);

  const seed = (summary.seed ?? 0) % 360;
  const rad = (seed * Math.PI) / 180;
  const cx = 50 + Math.cos(rad) * 14;
  const cy = 50 + Math.sin(rad) * 14;

  return `radial-gradient(circle at ${cx.toFixed(1)}% ${cy.toFixed(1)}%, ${stops.join(", ")})`;
}

async function fetchActiEye(): Promise<ActiEyeSummary | null> {
  try {
    const res = await fetch("/api/v1/actieye", { credentials: "include" });
    if (!res.ok) return null;
    const json = await res.json();
    const data = json?.data;
    if (!data || typeof data !== "object") return null;
    return data as ActiEyeSummary;
  } catch {
    return null;
  }
}

interface ActiEyeProps {
  className?: string;
}

/**
 * ActiEye — «око, следящее за активностью». Круг справа от статистики
 * профиля: цвета градиента зависят от активности владельца (записи,
 * комментарии, лайки, заходы), а медленное вращение двигает цвета.
 * Клик открывает минималистичную панель с «дорогой» серии заходов.
 */
export function ActiEye({ className }: ActiEyeProps) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<ActiEyeSummary | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // No session → nothing to show; the circle stays the default orange.
    if (!apiClient.getCSRFToken() && !apiClient.getToken()) return;
    let cancelled = false;
    fetchActiEye().then((data) => {
      if (!cancelled && data) setSummary(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const gradient = summary ? buildGradient(summary) : "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "relative shrink-0 size-8 sm:size-12 rounded-full overflow-hidden",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          className
        )}
        aria-label={t("actieye.activity")}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {gradient ? (
          <div className="absolute inset-0 animate-[actieye-hue_18s_ease-in-out_infinite_alternate]">
            {/* Статичный радиальный градиент — без углов, только hue-дрейф. */}
            <div className="absolute inset-0 rounded-full" style={{ background: gradient }} />
          </div>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-orange-400 to-orange-600" />
        )}
        {/* Glossy highlight — the sphere reads as a glowing bead */}
        <div className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_32%_28%,rgba(255,255,255,0.4),transparent_55%)]" />
        {/* Depth vignette at the rim */}
        <div className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_50%_50%,transparent_62%,rgba(0,0,0,0.28)_100%)]" />
        {/* Crisp border that does not rotate with the gradient */}
        <span className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-black/25" />
      </button>
      {open &&
        createPortal(<ActiEyePanel summary={summary} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
