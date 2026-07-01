import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Plus, Trash2, Copy } from "lucide-react";

export interface Shadow {
  id: string;
  x: number;
  y: number;
  blur: number;
  color: string;
}

interface ShadowEditorProps {
  shadows: Shadow[];
  onChange: (shadows: Shadow[]) => void;
  /** 'text' for text-shadow, 'box' for box-shadow */
  type: "text" | "box";
  label?: string;
  maxBlur?: number;
}

let _shadowIdCounter = 0;
function newId() {
  return `shadow-${Date.now()}-${++_shadowIdCounter}`;
}

export function ShadowEditor({
  shadows,
  onChange,
  type,
  label,
  maxBlur = 10,
}: ShadowEditorProps) {
  const addShadow = () => {
    onChange([
      ...shadows,
      { id: newId(), x: 0, y: type === "text" ? -1 : 1, blur: type === "text" ? 1 : 3, color: type === "text" ? "#ffffff" : "#000000" },
    ]);
  };

  const removeShadow = (id: string) => {
    onChange(shadows.filter((s) => s.id !== id));
  };

  const duplicateShadow = (id: string) => {
    const shadow = shadows.find((s) => s.id === id);
    if (shadow) {
      onChange([...shadows, { ...shadow, id: newId() }]);
    }
  };

  const updateShadow = (id: string, field: keyof Shadow, value: string | number) => {
    onChange(shadows.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <Label className="text-sm font-medium">
          {label || (type === "text" ? "Тени текста" : "Тени блока")}
        </Label>
        <Button type="button" onClick={addShadow} size="sm" variant="outline" className="h-7 text-xs">
          <Plus className="w-3 h-3 mr-1" />
          Добавить
        </Button>
      </div>

      {shadows.length === 0 && (
        <p className="text-xs text-muted-foreground py-2">
          {type === "text" ? "Тени не добавлены" : "Тени блока не добавлены"}
        </p>
      )}

      <div className="space-y-2">
        {shadows.map((shadow) => (
          <div key={shadow.id} className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  X: {shadow.x}px
                </Label>
                <Slider
                  value={[shadow.x]}
                  onValueChange={([v]) => updateShadow(shadow.id, "x", v)}
                  min={-20}
                  max={20}
                  step={0.5}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  Y: {shadow.y}px
                </Label>
                <Slider
                  value={[shadow.y]}
                  onValueChange={([v]) => updateShadow(shadow.id, "y", v)}
                  min={-20}
                  max={20}
                  step={0.5}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  Blur: {shadow.blur}px
                </Label>
                <Slider
                  value={[shadow.blur]}
                  onValueChange={([v]) => updateShadow(shadow.id, "blur", v)}
                  min={0}
                  max={maxBlur}
                  step={0.5}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Цвет</Label>
                <div className="flex gap-1 mt-1">
                  <Input
                    type="color"
                    value={shadow.color}
                    onChange={(e) => updateShadow(shadow.id, "color", e.target.value)}
                    className="w-8 h-8 p-0.5 cursor-pointer border-0"
                  />
                  <Input
                    type="text"
                    value={shadow.color}
                    onChange={(e) => updateShadow(shadow.id, "color", e.target.value)}
                    className="flex-1 h-8 text-xs font-mono"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-1 justify-end">
              <Button
                type="button"
                onClick={() => duplicateShadow(shadow.id)}
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
              >
                <Copy className="w-3 h-3" />
              </Button>
              <Button
                type="button"
                onClick={() => removeShadow(shadow.id)}
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 text-destructive hover:text-destructive"
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Convert Shadow[] to CSS text-shadow / box-shadow value string */
export function shadowsToCss(shadows: Shadow[], type: "text" | "box", maxBlur = 10): string {
  if (shadows.length === 0) return "";
  const value = shadows
    .map((s) => `${s.x}px ${s.y}px ${Math.min(s.blur, maxBlur)}px ${s.color}`)
    .join(", ");
  return `${type === "text" ? "text-shadow" : "box-shadow"}: ${value}`;
}

/** Parse a CSS text-shadow / box-shadow value string to Shadow[] */
export function parseCssToShadows(cssValue: string): Shadow[] {
  if (!cssValue) return [];
  const shadows: Shadow[] = [];
  const parts = cssValue.split(",").map((s) => s.trim());

  for (const part of parts) {
    const match = part.match(
      /(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(.+)/,
    );
    if (match) {
      shadows.push({
        id: newId(),
        x: parseFloat(match[1]),
        y: parseFloat(match[2]),
        blur: parseFloat(match[3]),
        color: match[4].trim(),
      });
    }
  }

  return shadows;
}
