// Minimal colour picker: a palette/spectrum switch, a saturation/value square,
// a hue slider, a random button and a hex field. No animations.

import { useEffect, useRef, useState } from "react";
import { Ban, Shuffle } from "lucide-react";

import { Input } from "@/components/ui/input";

type HSV = { h: number; s: number; v: number };
type Mode = "palette" | "spectrum";

// A curated 7 hues × 4 tones grid (Tailwind ramps): a rainbow per row,
// light → dark per column. No neutral wall.
const SWATCHES = [
  "#fecaca", "#fed7aa", "#fde68a", "#bbf7d0", "#99f6e4", "#bfdbfe", "#ddd6fe",
  "#f87171", "#fb923c", "#facc15", "#4ade80", "#2dd4bf", "#60a5fa", "#a78bfa",
  "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0d9488", "#2563eb", "#7c3aed",
  "#991b1b", "#9a3412", "#854d0e", "#166534", "#115e59", "#1e40af", "#5b21b6",
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const hexToHsv = (hex: string): HSV => {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return { h: 0, s: 0, v: 100 };
  const int = parseInt(match[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : (delta / max) * 100, v: max * 100 };
};

export const hsvToHex = ({ h, s, v }: HSV): string => {
  const sN = s / 100;
  const vN = v / 100;
  const c = vN * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = vN - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const to255 = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${to255(r)}${to255(g)}${to255(b)}`;
};

const randomHex = () => `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`;

const tabClass = (active: boolean) =>
  `rounded px-2 py-1 text-xs ${active ? "text-primary" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"}`;

export const ColorPicker = ({
  value,
  onChange,
  onClear,
}: {
  value: string;
  onChange: (hex: string) => void;
  /** Render a "no colour" cell at the end of the swatch grid. */
  onClear?: () => void;
}) => {
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(value));
  const [hexDraft, setHexDraft] = useState(value);
  const [mode, setMode] = useState<Mode>("palette");
  const svRef = useRef<HTMLDivElement | null>(null);
  const hueRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setHsv(hexToHsv(value));
    setHexDraft(value);
  }, [value]);

  const emit = (next: HSV) => {
    setHsv(next);
    const hex = hsvToHex(next);
    setHexDraft(hex);
    onChange(hex);
  };

  const readSv = (clientX: number, clientY: number) => {
    const el = svRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    emit({
      ...hsv,
      s: clamp(((clientX - rect.left) / rect.width) * 100, 0, 100),
      v: clamp(100 - ((clientY - rect.top) / rect.height) * 100, 0, 100),
    });
  };

  const readHue = (_clientX: number, clientY: number) => {
    const el = hueRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    emit({ ...hsv, h: clamp(((clientY - rect.top) / rect.height) * 360, 0, 360) });
  };

  const dragProps = (read: (x: number, y: number) => void) => ({
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      read(event.clientX, event.clientY);
    },
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.buttons !== 1) return;
      read(event.clientX, event.clientY);
    },
  });

  const current = hsvToHex(hsv).toLowerCase();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-0.5">
          <button type="button" onClick={() => setMode("palette")} className={tabClass(mode === "palette")}>
            Палитра
          </button>
          <button type="button" onClick={() => setMode("spectrum")} className={tabClass(mode === "spectrum")}>
            Спектр
          </button>
        </div>
        <button
          type="button"
          title="Случайный цвет"
          onClick={() => emit(hexToHsv(randomHex()))}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
        >
          <Shuffle className="h-3.5 w-3.5" />
        </button>
      </div>

      {mode === "palette" ? (
        <div className="grid grid-cols-7 gap-1.5">
          {SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              title={swatch}
              onClick={() => emit(hexToHsv(swatch))}
              className={`h-6 rounded-[3px] ${current === swatch.toLowerCase() ? "ring-2 ring-foreground/40" : ""}`}
              style={{ backgroundColor: swatch }}
            />
          ))}
          {onClear && (
            <button
              type="button"
              title="Без цвета"
              onClick={onClear}
              className="flex h-6 items-center justify-center rounded-[3px] text-muted-foreground hover:bg-foreground/5"
            >
              <Ban className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ) : (
        <div className="flex gap-3">
          <div
            ref={svRef}
            {...dragProps(readSv)}
            className="relative h-40 flex-1 cursor-crosshair rounded-[3px]"
            style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
          >
            <div className="absolute inset-0 rounded-[3px]" style={{ background: "linear-gradient(to right, #fff, transparent)" }} />
            <div className="absolute inset-0 rounded-[3px]" style={{ background: "linear-gradient(to top, #000, transparent)" }} />
            <span
              className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }}
            />
          </div>
          <div
            ref={hueRef}
            {...dragProps(readHue)}
            className="relative h-40 w-3.5 cursor-ns-resize rounded-[3px]"
            style={{ background: "linear-gradient(to bottom, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}
          >
            <span
              className="absolute left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style={{ top: `${(hsv.h / 360) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Input
          value={hexDraft}
          onChange={(event) => {
            setHexDraft(event.target.value);
            if (/^#?[0-9a-f]{6}$/i.test(event.target.value.trim())) emit(hexToHsv(event.target.value));
          }}
          placeholder="#000000"
          className="h-9 min-w-0 flex-1 font-mono"
        />
        <span
          className="h-9 w-9 shrink-0 rounded-[3px] border border-border/60"
          style={{ backgroundColor: current }}
          title={current}
        />
      </div>
    </div>
  );
};
