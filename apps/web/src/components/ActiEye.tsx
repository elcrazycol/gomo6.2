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

/** One color per activity counter (posts, comments, likes, visits). */
const ACTIVITY_COLORS = [
  "rgb(167 139 250)", // violet-400 — записи
  "rgb(56 189 248)", // sky-400 — комментарии
  "rgb(251 191 36)", // amber-400 — лайки
  "rgb(52 211 153)", // emerald-400 — заходы
] as const;

/** Minimum fraction per active color so no color ever disappears. */
const MIN_FRAC = 0.12;

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

  const active = weights.filter((w) => w > 0).length;
  const pool = 1 - active * MIN_FRAC;

  const stops: string[] = [];
  const order: number[] = [];
  let frac = 0;
  weights.forEach((w, i) => {
    if (!(w > 0)) return;
    order.push(i);
    stops.push(`${ACTIVITY_COLORS[i]} ${(frac * 100).toFixed(1)}%`);
    frac += MIN_FRAC + (w / total) * pool;
  });
  if (order.length === 0) return "";
  // Close the loop: the rim blends back toward the first color.
  stops.push(`${ACTIVITY_COLORS[order[0]]} 100%`);

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
