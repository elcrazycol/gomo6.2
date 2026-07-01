import { useState, useEffect, useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { GradientPicker } from "./GradientPicker";
import { ShadowEditor, shadowsToCss, parseCssToShadows, type Shadow } from "./ShadowEditor";
import { badgePresets } from "./customPresets";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

interface BadgeEditorProps {
  text: string;
  css: string;
  onTextChange: (text: string) => void;
  onCssChange: (css: string) => void;
}

interface BadgeState {
  colorCss: string;
  backgroundColor: string;
  borderRadius: number;
  textShadows: Shadow[];
  boxShadows: Shadow[];
}

function parseBadgeCss(css: string): BadgeState {
  const state: BadgeState = {
    colorCss: "",
    backgroundColor: "",
    borderRadius: 4,
    textShadows: [],
    boxShadows: [],
  };
  if (!css) return state;

  const parts = css.split(";").map((s) => s.trim()).filter(Boolean);
  const colorParts: string[] = [];

  for (const part of parts) {
    const colonIdx = part.indexOf(":");
    if (colonIdx === -1) continue;
    const prop = part.substring(0, colonIdx).trim();
    const val = part.substring(colonIdx + 1).trim();

    if (prop === "background-color") {
      state.backgroundColor = val;
    } else if (prop === "border-radius") {
      const num = parseInt(val, 10);
      if (!isNaN(num)) state.borderRadius = num;
    } else if (prop === "text-shadow") {
      state.textShadows = parseCssToShadows(val);
    } else if (prop === "box-shadow") {
      state.boxShadows = parseCssToShadows(val);
    } else if (
      prop === "color" ||
      prop === "background" ||
      prop === "background-image" ||
      prop === "-webkit-background-clip" ||
      prop === "-webkit-text-fill-color" ||
      prop === "background-clip" ||
      prop === "font-weight" ||
      prop === "border" ||
      prop === "backdrop-filter"
    ) {
      colorParts.push(part);
    }
  }

  state.colorCss = colorParts.join("; ");
  return state;
}

function stateToCss(state: BadgeState): string {
  const parts: string[] = [];

  if (state.colorCss) parts.push(state.colorCss);
  if (state.backgroundColor) parts.push(`background-color: ${state.backgroundColor}`);
  if (state.borderRadius > 0) parts.push(`border-radius: ${state.borderRadius}px`);

  const tsCss = shadowsToCss(state.textShadows, "text");
  if (tsCss) parts.push(tsCss);

  const bsCss = shadowsToCss(state.boxShadows, "box");
  if (bsCss) parts.push(bsCss);

  return parts.join("; ");
}

export function BadgeEditor({ text, css, onTextChange, onCssChange }: BadgeEditorProps) {
  const [state, setState] = useState<BadgeState>(() => parseBadgeCss(css));

  useEffect(() => {
    setState(parseBadgeCss(css));
  }, [css]);

  const emitChange = useCallback(
    (next: BadgeState) => {
      setState(next);
      onCssChange(stateToCss(next));
    },
    [onCssChange],
  );

  return (
    <div className="space-y-6">
      {/* Badge text */}
      <div>
        <Label className="text-sm font-medium mb-2 block">Текст бейджа</Label>
        <Input
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder="VIP, Модератор, и т.д."
          maxLength={20}
        />
        <p className="text-[10px] text-muted-foreground mt-1">Максимум 20 символов</p>
      </div>

      {/* Presets */}
      <div>
        <Label className="text-sm font-medium mb-2 block">Быстрые стили</Label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {badgePresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                const nextState = parseBadgeCss(preset.css);
                emitChange(nextState);
              }}
              className="group relative overflow-hidden rounded-lg border border-border bg-card p-2 text-left transition-all hover:border-primary/40 hover:shadow-sm"
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="w-3 h-3 rounded shrink-0"
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
        label="Цвет бейджа"
        value={state.colorCss}
        onChange={(css) => emitChange({ ...state, colorCss: css })}
        showClipToggle={false}
      />

      {/* Background color (override) */}
      <div>
        <Label className="text-sm font-medium mb-2 block">Доп. цвет фона</Label>
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
            placeholder="Авто"
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
              onClick={() => emitChange({ ...state, backgroundColor: "rgba(0,0,0,0.3)" })}
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
        shadows={state.textShadows}
        onChange={(shadows) => emitChange({ ...state, textShadows: shadows })}
        type="text"
        label="Тени текста"
        maxBlur={5}
      />

      {/* Box Shadows */}
      <ShadowEditor
        shadows={state.boxShadows}
        onChange={(shadows) => emitChange({ ...state, boxShadows: shadows })}
        type="box"
        label="Тени блока"
      />

      {/* Raw CSS */}
      <details className="group">
        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
          Показать CSS код
        </summary>
        <div className="mt-2">
          <textarea
            value={css}
            onChange={(e) => onCssChange(e.target.value)}
            rows={3}
            className="w-full font-mono text-xs bg-muted/50 border border-border rounded-md p-2 resize-y"
            placeholder="color: #fff; background: linear-gradient(...); ..."
          />
        </div>
      </details>
    </div>
  );
}
