import { useId, useMemo } from "react";
import { suminagashiParams } from "@/utils/seededPattern";
import "./SeededPattern.css";

export type SeededPatternProps = {
  /** Stable identity: user id, username, anything unique. Same key → same art. */
  seedKey: string;
  className?: string;
  title?: string;
  /** Cheap variant for tiny surfaces (avatars): gradient + rings, no
   *  feTurbulence/displacement passes. ~10x cheaper in lists. */
  simple?: boolean;
};

/**
 * Suminagashi (ink-in-water) generative art. One SVG field (`800×320`),
 * rendered with `slice` so the avatar circle and the wide banner are two
 * windows into the SAME artwork — one identity, like a CS pattern index.
 * Purely deterministic: no network, no storage, no animation.
 */
export function SeededPattern({ seedKey, className, title, simple = false }: SeededPatternProps) {
  const rawId = useId();
  // useId contains ":" which breaks url(#…) references — strip it.
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9]/g, ""), [rawId]);
  const p = useMemo(() => suminagashiParams(seedKey), [seedKey]);

  const bgId = `sp-bg-${uid}`;
  const warpId = `sp-warp-${uid}`;
  const grainId = `sp-grain-${uid}`;
  const shadeId = `sp-shade-${uid}`;

  return (
    <svg
      viewBox="0 0 800 320"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      role="img"
      aria-label={title ?? `Pattern #${String(p.patternNo).padStart(3, "0")}`}
      aria-hidden={title === undefined ? undefined : false}
    >
      <defs>
        <linearGradient id={bgId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={p.bg0} />
          <stop offset="100%" stopColor={p.bg1} />
        </linearGradient>
        {!simple && (
          <filter id={warpId} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.012 0.028"
              numOctaves="2"
              seed={p.turbSeed}
              result="n"
            />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="55" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        )}
        {!simple && (
          <filter id={grainId}>
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed={p.turbSeed} />
            <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.5 0" />
          </filter>
        )}
        <radialGradient id={shadeId} cx="50%" cy="45%" r="75%">
          <stop offset="55%" stopColor="black" stopOpacity="0" />
          <stop offset="100%" stopColor="black" stopOpacity="0.38" />
        </radialGradient>
      </defs>

      <rect width="800" height="320" fill={`url(#${bgId})`} />
      <g filter={simple ? undefined : `url(#${warpId})`} fill="none">
        {p.rings.map((r, i) => (
          <path
            key={i}
            d={r.d}
            stroke={r.ink}
            strokeWidth={r.width}
            opacity={r.opacity}
            strokeLinejoin="round"
          />
        ))}
      </g>
      <rect width="800" height="320" fill={`url(#${shadeId})`} />
      {!simple && <rect width="800" height="320" filter={`url(#${grainId})`} opacity="0.07" />}
    </svg>
  );
}

export default SeededPattern;
