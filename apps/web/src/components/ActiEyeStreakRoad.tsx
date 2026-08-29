import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ActiEyeDay } from "./ActiEye";

// ─── Deterministic per-day randomness ───────────────────────────────────────
// The day's date seeds both its vertical position and the shape of the waves
// around it, so every circle keeps its own stable "place" across re-renders:
// the road only changes when a day is actually added or removed.

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Layout constants ────────────────────────────────────────────────────────
const SPACING = 46; // px between consecutive days
const HEIGHT = 120; // svg height
const BAND = 34; // circles may appear ±BAND px around the vertical center
const DOT_R = 8;
const PAD = 24;

const EMERALD_FILL = "rgb(52 211 153)"; // visited day
const EMERALD_STROKE = "rgb(16 185 129)";
const GRAY_FILL = "rgb(148 163 184)"; // missed day
const GRAY_STROKE = "rgb(100 116 139)";
const WAVE_STROKE = "rgb(100 116 139)";

interface ActiEyeStreakRoadProps {
  days: ActiEyeDay[];
}

/**
 * The streak "дорога": one circle per day of the window — emerald for visits,
 * gray for missed days — each placed at a random (but stable) spot inside a
 * vertical band, connected by chaotic wavy lines. The track scrolls
 * horizontally; every new day pushes the road forward to the newest circle.
 */
export function ActiEyeStreakRoad({ days }: ActiEyeStreakRoadProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeCount = days.filter((d) => d.active).length;
  const width = Math.max(days.length, 1) * SPACING + PAD * 2;

  const points = days.map((d, i) => {
    const rnd = mulberry32(hashStr(d.date));
    return {
      date: d.date,
      active: d.active,
      x: PAD + i * SPACING + SPACING / 2,
      y: HEIGHT / 2 + (rnd() * 2 - 1) * BAND,
    };
  });

  // A wavy double-curve between each neighbouring pair — chaotic but stable.
  const waves: string[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const rnd = mulberry32(hashStr(`${a.date}|${b.date}`));
    const dx = b.x - a.x;
    const mx = a.x + dx * 0.5;
    const my = (a.y + b.y) / 2 + (rnd() * 2 - 1) * 18;
    const c1y = a.y + (rnd() * 2 - 1) * 36;
    const c2y = my + (rnd() * 2 - 1) * 36;
    const c3y = my + (rnd() * 2 - 1) * 36;
    const c4y = b.y + (rnd() * 2 - 1) * 36;
    waves.push(
      `M ${a.x} ${a.y} C ${a.x + dx * 0.25} ${c1y}, ${a.x + dx * 0.35} ${c2y}, ${mx} ${my} ` +
        `C ${a.x + dx * 0.65} ${c3y}, ${a.x + dx * 0.75} ${c4y}, ${b.x} ${b.y}`
    );
  }

  // New days push the road forward: always keep the newest circle in view.
  // First paint jumps straight to the end (smooth scrolling across a long
  // road gets interrupted on mobile), later additions scroll smoothly.
  const didScroll = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const behavior = didScroll.current ? "smooth" : "auto";
    didScroll.current = true;
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ left: el.scrollWidth, behavior });
    } else {
      el.scrollLeft = el.scrollWidth; // jsdom fallback
    }
  }, [days.length]);

  if (activeCount === 0) {
    return <p className="py-2 text-xs text-muted-foreground">{t("actieye.noStreakYet")}</p>;
  }

  return (
    <div ref={scrollRef} className="overflow-x-auto">
      <svg
        width={width}
        height={HEIGHT}
        className="block shrink-0"
        // Explicit px sizing beats any global max-width clamping, so the
        // road really overflows its container and scrolls end to end.
        style={{ width, minWidth: width, maxWidth: "none" }}
        role="img"
        aria-label={t("actieye.streakRoad")}
      >
        {waves.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={WAVE_STROKE}
            strokeOpacity={0.4}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {points.map((p, i) => {
          const newest = i === points.length - 1;
          return (
            <g key={p.date}>
              {newest && p.active && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={DOT_R + 7}
                  fill={EMERALD_STROKE}
                  fillOpacity={0.16}
                  className="animate-pulse"
                />
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={DOT_R}
                fill={p.active ? EMERALD_FILL : GRAY_FILL}
                stroke={p.active ? EMERALD_STROKE : GRAY_STROKE}
                strokeWidth={1.5}
                fillOpacity={p.active ? 1 : 0.75}
                data-date={p.date}
              >
                <title>{p.date}</title>
              </circle>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
