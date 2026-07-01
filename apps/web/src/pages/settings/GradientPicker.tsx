import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

interface GradientPickerProps {
  /** Current CSS string (e.g. "color: #fff" or "background: linear-gradient(...); -webkit-background-clip: text; ...") */
  value: string;
  /** Called whenever the user changes a control. Receives the generated CSS string. */
  onChange: (css: string) => void;
  /** Optional label shown above the picker */
  label?: string;
  /** Whether to show the "apply gradient to text" toggle (default true) */
  showClipToggle?: boolean;
}

type FillMode = "solid" | "gradient";

interface GradientState {
  mode: FillMode;
  solidColor: string;
  gradStart: string;
  gradEnd: string;
  gradDirection: number;
  clipToText: boolean;
}

/**
 * Parse a CSS string into GradientState.
 * Handles formats produced by this component as well as raw user input.
 */
function parseCssToState(css: string): GradientState {
  const state: GradientState = {
    mode: "solid",
    solidColor: "#d6d6de",
    gradStart: "#ff0000",
    gradEnd: "#0000ff",
    gradDirection: 90,
    clipToText: false,
  };

  if (!css) return state;

  // Detect gradient
  const bgMatch = css.match(/background:\s*([^;]+)/);
  const bgImageMatch = css.match(/background-image:\s*([^;]+)/);
  const gradientValue = bgMatch?.[1] || bgImageMatch?.[1] || "";

  if (gradientValue.includes("linear-gradient")) {
    state.mode = "gradient";

    // Extract direction
    const dirMatch = gradientValue.match(/(\d+)deg/);
    if (dirMatch) state.gradDirection = parseInt(dirMatch[1], 10);

    // Extract colors
    const colorMatches = gradientValue.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)/g);
    if (colorMatches && colorMatches.length >= 2) {
      state.gradStart = colorMatches[0];
      state.gradEnd = colorMatches[1];
    } else if (colorMatches && colorMatches.length === 1) {
      state.gradStart = colorMatches[0];
    }

    // Detect clip
    if (css.includes("-webkit-background-clip: text") || css.includes("background-clip: text")) {
      state.clipToText = true;
    }
  } else {
    // Solid color
    const colorMatch = css.match(/color:\s*([^;]+)/);
    if (colorMatch) {
      state.solidColor = colorMatch[1].trim();
    }
  }

  return state;
}

/** Generate CSS string from GradientState. */
function stateToCss(s: GradientState): string {
  if (s.mode === "solid") {
    return `color: ${s.solidColor}`;
  }

  const gradient = `linear-gradient(${s.gradDirection}deg, ${s.gradStart}, ${s.gradEnd})`;
  const parts: string[] = [`background: ${gradient}`];

  if (s.clipToText) {
    parts.push("-webkit-background-clip: text");
    parts.push("-webkit-text-fill-color: transparent");
    parts.push("background-clip: text");
  }

  return parts.join("; ");
}

export function GradientPicker({ value, onChange, label, showClipToggle = true }: GradientPickerProps) {
  const [state, setState] = useState<GradientState>(() => parseCssToState(value));

  // Sync from props when value changes externally (e.g. preset applied)
  useEffect(() => {
    setState(parseCssToState(value));
  }, [value]);

  // Emit CSS whenever state changes
  const emitChange = useCallback(
    (next: GradientState) => {
      setState(next);
      onChange(stateToCss(next));
    },
    [onChange],
  );

  return (
    <div className="space-y-4">
      {label && <Label className="text-sm font-medium">{label}</Label>}

      {/* Mode toggle */}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={state.mode === "solid" ? "default" : "outline"}
          onClick={() => emitChange({ ...state, mode: "solid" })}
        >
          Заливка
        </Button>
        <Button
          type="button"
          size="sm"
          variant={state.mode === "gradient" ? "default" : "outline"}
          onClick={() => emitChange({ ...state, mode: "gradient" })}
        >
          Градиент
        </Button>
      </div>

      {/* Preview swatch */}
      <div
        className="h-10 rounded-lg border border-border overflow-hidden"
        style={{
          background:
            state.mode === "gradient"
              ? `linear-gradient(${state.gradDirection}deg, ${state.gradStart}, ${state.gradEnd})`
              : state.solidColor,
        }}
      />

      {/* Solid mode */}
      {state.mode === "solid" && (
        <div className="flex gap-2 items-center">
          <Input
            type="color"
            value={state.solidColor}
            onChange={(e) => emitChange({ ...state, solidColor: e.target.value })}
            className="w-14 h-10 p-1 cursor-pointer"
          />
          <Input
            type="text"
            value={state.solidColor}
            onChange={(e) => emitChange({ ...state, solidColor: e.target.value })}
            placeholder="#d6d6de"
            className="flex-1 font-mono text-sm"
          />
        </div>
      )}

      {/* Gradient mode */}
      {state.mode === "gradient" && (
        <div className="space-y-3">
          <div className="flex gap-2 items-center">
            <Input
              type="color"
              value={state.gradStart}
              onChange={(e) => emitChange({ ...state, gradStart: e.target.value })}
              className="w-14 h-10 p-1 cursor-pointer"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <Input
              type="color"
              value={state.gradEnd}
              onChange={(e) => emitChange({ ...state, gradEnd: e.target.value })}
              className="w-14 h-10 p-1 cursor-pointer"
            />
            <div className="flex-1" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs text-muted-foreground">Направление</Label>
              <span className="text-xs font-mono">{state.gradDirection}°</span>
            </div>
            <Slider
              value={[state.gradDirection]}
              onValueChange={([v]) => emitChange({ ...state, gradDirection: v })}
              min={0}
              max={360}
              step={1}
            />
          </div>

          {showClipToggle && (
            <div className="flex items-center justify-between">
              <Label className="text-sm">Градиент на текст</Label>
              <Switch
                checked={state.clipToText}
                onCheckedChange={(v) => emitChange({ ...state, clipToText: v })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
