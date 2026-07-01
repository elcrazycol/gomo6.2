import { useState, useEffect, useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { GradientPicker } from "./GradientPicker";
import { ShadowEditor, shadowsToCss, parseCssToShadows, type Shadow } from "./ShadowEditor";
import { usernamePresets } from "./customPresets";
import { Button } from "@/components/ui/button";

interface UsernameEditorProps {
  value: string;
  onChange: (css: string) => void;
}

interface UsernameState {
  colorCss: string;
  backgroundColor: string;
  borderRadius: number;
  shadows: Shadow[];
}

function parseUsernameCss(css: string): UsernameState {
  const state: UsernameState = {
    colorCss: "",
    backgroundColor: "",
    borderRadius: 0,
    shadows: [],
  };
  if (!css) return state;

  // Extract color/gradient portion
  const parts = css.split(";").map((s) => s.trim()).filter(Boolean);
  const colorParts: string[] = [];
  const inGradient = false;

  for (const part of parts) {
    const prop = part.split(":")[0]?.trim();
    if (!prop) continue;

    if (prop === "background-color") {
      state.backgroundColor = part.substring(part.indexOf(":") + 1).trim();
    } else if (prop === "border-radius") {
      const val = parseInt(part.substring(part.indexOf(":") + 1), 10);
      if (!isNaN(val)) state.borderRadius = val;
    } else if (prop === "text-shadow") {
      state.shadows = parseCssToShadows(part.substring(part.indexOf(":") + 1).trim());
    } else if (
      prop === "color" ||
      prop === "background" ||
      prop === "background-image" ||
      prop === "-webkit-background-clip" ||
      prop === "-webkit-text-fill-color" ||
      prop === "background-clip"
    ) {
      colorParts.push(part);
    }
  }

  state.colorCss = colorParts.join("; ");
  return state;
}

function stateToCss(state: UsernameState): string {
  const parts: string[] = [];

  if (state.colorCss) {
    parts.push(state.colorCss);
  }

  if (state.backgroundColor) {
    parts.push(`background-color: ${state.backgroundColor}`);
  }

  if (state.borderRadius > 0) {
    parts.push(`border-radius: ${state.borderRadius}px`);
  }

  const shadowCss = shadowsToCss(state.shadows, "text", 5);
  if (shadowCss) {
    parts.push(shadowCss);
  }

  return parts.join("; ");
}

export function UsernameEditor({ value, onChange }: UsernameEditorProps) {
  const [state, setState] = useState<UsernameState>(() => parseUsernameCss(value));

  useEffect(() => {
    setState(parseUsernameCss(value));
  }, [value]);

  const emitChange = useCallback(
    (next: UsernameState) => {
      setState(next);
      onChange(stateToCss(next));
    },
    [onChange],
  );

  return (
    <div className="space-y-6">
      {/* Presets */}
      <div>
        <Label className="text-sm font-medium mb-2 block">Быстрые стили</Label>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {usernamePresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                const nextState = parseUsernameCss(preset.css);
                emitChange(nextState);
              }}
              className="group relative overflow-hidden rounded-lg border border-border bg-card p-2 text-left transition-all hover:border-primary/40 hover:shadow-sm"
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="w-3 h-3 rounded-full shrink-0 border border-white/20"
                  style={{ backgroundColor: preset.previewColor }}
                />
                <span className="text-xs font-medium truncate">{preset.nameRu}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Color / Gradient */}
      <GradientPicker
        label="Цвет никнейма"
        value={state.colorCss}
        onChange={(css) => emitChange({ ...state, colorCss: css })}
        showClipToggle={true}
      />

      {/* Background Color */}
      <div>
        <Label className="text-sm font-medium mb-2 block">Цвет фона</Label>
        <div className="flex gap-2 items-center">
          <Input
            type="color"
            value={state.backgroundColor || "#000000"}
            onChange={(e) => emitChange({ ...state, backgroundColor: e.target.value })}
            className="w-14 h-10 p-1 cursor-pointer"
            disabled={!state.backgroundColor}
          />
          <Input
            type="text"
            value={state.backgroundColor}
            onChange={(e) => emitChange({ ...state, backgroundColor: e.target.value })}
            placeholder="Прозрачный"
            className="flex-1 font-mono text-sm"
          />
          {state.backgroundColor ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => emitChange({ ...state, backgroundColor: "" })}
              className="shrink-0"
            >
              Сброс
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => emitChange({ ...state, backgroundColor: "#1a1a2e" })}
              className="shrink-0"
            >
              Добавить
            </Button>
          )}
        </div>
      </div>

      {/* Border Radius */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-sm font-medium">Скругление</Label>
          <span className="text-xs font-mono text-muted-foreground">{state.borderRadius}px</span>
        </div>
        <Slider
          value={[state.borderRadius]}
          onValueChange={([v]) => emitChange({ ...state, borderRadius: v })}
          min={0}
          max={20}
          step={1}
        />
      </div>

      {/* Text Shadows */}
      <ShadowEditor
        shadows={state.shadows}
        onChange={(shadows) => emitChange({ ...state, shadows })}
        type="text"
        maxBlur={5}
      />

      {/* Raw CSS (collapsible) */}
      <details className="group">
        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
          Показать CSS код
        </summary>
        <div className="mt-2">
          <textarea
            value={value}
            onChange={(e) => {
              // Allow raw CSS editing — just pass through directly
              onChange(e.target.value);
            }}
            rows={3}
            className="w-full font-mono text-xs bg-muted/50 border border-border rounded-md p-2 resize-y"
            placeholder="color: #d6d6de; text-shadow: ..."
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Ручное редактирование CSS. Визуальные контролы обновятся при перезагрузке.
          </p>
        </div>
      </details>
    </div>
  );
}
