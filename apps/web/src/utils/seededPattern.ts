/**
 * Deterministic "suminagashi" (ink-in-water) pattern engine.
 *
 * CS-skin idea, gomo6 edition: one template + one numeric seed (0-999,
 * displayed as `#412`) fully determines the artwork. Nothing is stored —
 * the avatar circle and the wide banner render the SAME field, the avatar
 * just crops its center (`preserveAspectRatio="xMidYMid slice"`), so the
 * two always match like one identity.
 *
 * All randomness flows from FNV-1a → mulberry32. No Math.random, no I/O.
 */

/** 32-bit FNV-1a. Stable across reloads, no dependencies. */
export function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** CS-style display number: `#000`–`#999`. */
export function patternNumber(seedKey: string): number {
  return hashSeed(`gomo6:pattern:${seedKey}`) % 1000;
}

/** feTurbulence/displacement seed (0-99, deterministic per key). */
export function turbulenceSeed(seedKey: string): number {
  return hashSeed(`gomo6:turb:${seedKey}`) % 100;
}

export interface InkPalette {
  name: string;
  /** [lightness 0..1, chroma, hue] — deliberately muted, never neon. */
  bg: [number, number, number];
  bg2: [number, number, number];
  inks: Array<[number, number, number]>;
}

/**
 * Curated muted palettes (dusty, inky, calm). Chroma is clamped low on
 * purpose: lightness 0.3-0.75, chroma ≤ 0.09 — "волны, но не вырвиглаз".
 */
const PALETTES: InkPalette[] = [
  { name: "graphite-rose", bg: [0.3, 0.025, 330], bg2: [0.42, 0.035, 350], inks: [[0.62, 0.07, 345], [0.55, 0.05, 20], [0.72, 0.045, 90]] },
  { name: "ink-sage", bg: [0.28, 0.03, 170], bg2: [0.4, 0.04, 160], inks: [[0.6, 0.06, 165], [0.68, 0.05, 110], [0.55, 0.045, 200]] },
  { name: "slate-indigo", bg: [0.3, 0.03, 265], bg2: [0.44, 0.045, 275], inks: [[0.62, 0.07, 270], [0.7, 0.05, 210], [0.58, 0.05, 310]] },
  { name: "umber-sand", bg: [0.3, 0.035, 70], bg2: [0.45, 0.05, 80], inks: [[0.66, 0.07, 75], [0.6, 0.055, 40], [0.72, 0.04, 100]] },
  { name: "deep-teal", bg: [0.27, 0.035, 195], bg2: [0.4, 0.05, 190], inks: [[0.6, 0.07, 190], [0.68, 0.05, 160], [0.55, 0.05, 225]] },
  { name: "smoke-plum", bg: [0.3, 0.03, 300], bg2: [0.42, 0.04, 320], inks: [[0.62, 0.065, 315], [0.58, 0.05, 280], [0.7, 0.04, 340]] },
  { name: "moss-stone", bg: [0.29, 0.03, 130], bg2: [0.42, 0.04, 120], inks: [[0.62, 0.06, 125], [0.7, 0.045, 90], [0.55, 0.05, 160]] },
  { name: "ash-blue", bg: [0.31, 0.028, 230], bg2: [0.46, 0.04, 220], inks: [[0.66, 0.06, 225], [0.6, 0.05, 255], [0.73, 0.035, 190]] },
  { name: "clay-fog", bg: [0.32, 0.035, 30], bg2: [0.48, 0.045, 45], inks: [[0.64, 0.07, 30], [0.6, 0.05, 350], [0.72, 0.04, 70]] },
  { name: "night-fern", bg: [0.26, 0.032, 150], bg2: [0.38, 0.045, 145], inks: [[0.58, 0.065, 150], [0.66, 0.05, 180], [0.6, 0.05, 100]] },
];

export function paletteFor(seedKey: string): InkPalette {
  return PALETTES[hashSeed(`gomo6:pal:${seedKey}`) % PALETTES.length]!;
}

export const oklch = (c: [number, number, number], alpha = 1): string =>
  alpha >= 1
    ? `oklch(${(c[0] * 100).toFixed(1)}% ${c[1].toFixed(3)} ${c[2].toFixed(0)})`
    : `oklch(${(c[0] * 100).toFixed(1)}% ${c[1].toFixed(3)} ${c[2].toFixed(0)} / ${alpha.toFixed(2)})`;

export interface MarblingRing {
  d: string;
  ink: string;
  width: number;
  opacity: number;
}

export interface SuminagashiParams {
  seedKey: string;
  patternNo: number;
  palette: InkPalette;
  rings: MarblingRing[];
  /** Normalized swirl center — shared by avatar crop and banner pano. */
  center: { x: number; y: number };
  turbSeed: number;
  bg0: string;
  bg1: string;
}

const W = 800;
const H = 320;

/** Build the full deterministic param set for a key (user id, etc.). */
export function suminagashiParams(seedKey: string): SuminagashiParams {
  const key = seedKey || "anon";
  const rand = mulberry32(hashSeed(`gomo6:pattern:${key}`));
  const palette = paletteFor(key);
  const patternNo = patternNumber(key);
  const turbSeed = turbulenceSeed(key);

  const cx = 0.3 + rand() * 0.4;
  const cy = 0.35 + rand() * 0.3;
  // 2-3 sine harmonics per ring = organic wobble, marbling comb drift on x.
  const h1 = { f: 2 + Math.floor(rand() * 3), a: 0.04 + rand() * 0.09, p: rand() * Math.PI * 2 };
  const h2 = { f: 4 + Math.floor(rand() * 4), a: 0.015 + rand() * 0.05, p: rand() * Math.PI * 2 };
  const h3 = { f: 1 + Math.floor(rand() * 2), a: 0.05 + rand() * 0.1, p: rand() * Math.PI * 2 };
  const combK = 2 + rand() * 4;
  const combA = 0.02 + rand() * 0.06;
  const rot = rand() * Math.PI * 2;
  const stretch = 1.6 + rand() * 1.6; // wide ellipse — reads as waves in banner
  const ringCount = 9 + Math.floor(rand() * 4);
  const inkCount = palette.inks.length;

  const rings: MarblingRing[] = [];
  const steps = 96;
  for (let r = 0; r < ringCount; r++) {
    const t = r / Math.max(1, ringCount - 1);
    const baseR = 24 + t * 300 + rand() * 10;
    const ink = palette.inks[(r + Math.floor(rand() * inkCount)) % inkCount]!;
    let d = "";
    for (let i = 0; i <= steps; i++) {
      const th = (i / steps) * Math.PI * 2;
      const wob =
        Math.sin(th * h1.f + h1.p) * h1.a +
        Math.sin(th * h2.f + h2.p) * h2.a +
        Math.sin(th * h3.f + h3.p + t * 3.0) * h3.a * (0.4 + t);
      const rr = baseR * (1 + wob);
      // Ellipse stretched + rotated, plus comb drift along x.
      const ex = Math.cos(th) * rr * stretch;
      const ey = Math.sin(th) * rr;
      const rx = ex * Math.cos(rot) - ey * Math.sin(rot);
      const ry = ex * Math.sin(rot) + ey * Math.cos(rot);
      const px = cx * W + rx + Math.sin((cy * H + ry) * (combK / H) * Math.PI * 2) * combA * W * t;
      const py = cy * H + ry * 0.62;
      d += `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
    }
    d += "Z";
    rings.push({
      d,
      ink: oklch(ink, 1),
      width: 1.2 + (1 - t) * 2.4 + rand() * 1.2,
      opacity: 0.16 + (1 - t) * 0.3,
    });
  }

  return {
    seedKey: key,
    patternNo,
    palette,
    rings,
    center: { x: cx, y: cy },
    turbSeed,
    bg0: oklch(palette.bg, 1),
    bg1: oklch(palette.bg2, 1),
  };
}
