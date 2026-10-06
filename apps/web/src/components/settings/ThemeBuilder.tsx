import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Palette, Plus, Save, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingBlock, Segmented } from "./SettingRow";
import {
  DEFAULT_THEME,
  applyInlineThemeTokens,
  applyTheme,
  buildCustomTokens,
  deleteCustomTheme,
  newCustomId,
  parseCustomThemeJson,
  saveCustomTheme,
  type CustomThemeDef,
  type SeedStyle,
  type ThemeFont,
  type ThemeTexture,
  type ThemeModePref,
} from "@/theme";
import { cn } from "@/lib/utils";

interface ThemeBuilderProps {
  colorTheme: string;
  modePref: ThemeModePref;
  isDarkMode: boolean;
  setColorTheme: (id: string) => void;
}

const RADIUS_OPTIONS = ["0", "0.25rem", "0.5rem", "0.75rem", "1rem", "1.25rem"];
const FONTS: Array<ThemeFont | "default"> = ["default", "rounded", "serif", "mono", "sans"];
const TEXTURES: Array<ThemeTexture> = ["none", "dots", "grid", "scanlines"];
const STYLES: SeedStyle[] = ["soft", "pastel", "mono"];

const Slider = ({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) => (
  <div className="block space-y-1.5">
    <span className="flex items-center justify-between text-xs text-muted-foreground">
      <span>{label}</span>
      <span className="tabular-nums text-foreground/70">{format ? format(value) : value}</span>
    </span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      onChange={(event) => onChange(Number(event.target.value))}
      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-foreground/15 accent-[oklch(var(--primary))]"
    />
  </div>
);

export const ThemeBuilder = ({ colorTheme, modePref, isDarkMode, setColorTheme }: ThemeBuilderProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [hue, setHue] = useState(265);
  const [chroma, setChroma] = useState(0.14);
  const [lightness, setLightness] = useState(0.6);
  const [style, setStyle] = useState<SeedStyle>("soft");
  const [radius, setRadius] = useState("0.5rem");
  const [font, setFont] = useState<ThemeFont | "default">("default");
  const [texture, setTexture] = useState<ThemeTexture>("none");
  const [ioText, setIoText] = useState("");
  const [ioOpen, setIoOpen] = useState(false);

  const seed = useMemo(() => ({ L: lightness, C: chroma, H: hue }), [lightness, chroma, hue]);
  const mode = isDarkMode ? "dark" : "light";

  // Live preview while the builder is open.
  useEffect(() => {
    if (!open) return;
    applyInlineThemeTokens(buildCustomTokens(seed, mode, style), {
      radius,
      font: font === "default" ? undefined : font,
      texture,
    });
    return () => {
      // Restore the actually-selected theme whenever preview values change/unmount.
      applyTheme(colorTheme, modePref);
    };
  }, [open, seed, mode, style, radius, font, texture, colorTheme, modePref]);

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setHue(265);
    setChroma(0.14);
    setLightness(0.6);
    setStyle("soft");
    setRadius("0.5rem");
    setFont("default");
    setTexture("none");
  };

  const handleSave = () => {
    const def: CustomThemeDef = {
      id: editingId ?? newCustomId(),
      name: name.trim() || t("settings2.builderUntitled"),
      seed,
      style,
      radius,
      font: font === "default" ? undefined : font,
      texture,
      supports: ["light", "dark"],
    };
    saveCustomTheme(def);
    setEditingId(def.id);
    setName(def.name);
    setColorTheme(def.id);
  };

  const handleDelete = () => {
    if (!editingId) return;
    deleteCustomTheme(editingId);
    if (colorTheme === editingId) setColorTheme(DEFAULT_THEME);
    resetForm();
  };

  const handleEdit = (def: CustomThemeDef) => {
    setOpen(true);
    setEditingId(def.id);
    setName(def.name);
    setHue(def.seed.H);
    setChroma(def.seed.C);
    setLightness(def.seed.L);
    setStyle(def.style);
    setRadius(def.radius);
    setFont(def.font ?? "default");
    setTexture(def.texture ?? "none");
  };

  const handleExport = () => {
    const def: CustomThemeDef = {
      id: editingId ?? newCustomId(),
      name: name.trim() || t("settings2.builderUntitled"),
      seed,
      style,
      radius,
      font: font === "default" ? undefined : font,
      texture,
      supports: ["light", "dark"],
    };
    setIoText(JSON.stringify(def, null, 2));
    setIoOpen(true);
  };

  const handleImport = () => {
    const def = parseCustomThemeJson(ioText);
    if (!def) return;
    saveCustomTheme(def);
    handleEdit(def);
    setColorTheme(def.id);
  };

  return (
    <SettingBlock
      id="set-builder"
      title={t("settings2.builderTitle")}
      description={t("settings2.builderDesc")}
      icon={Palette}
      className="[&>div]:space-y-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={open ? "secondary" : "outline"} size="sm" className="gap-2" onClick={() => setOpen((v) => !v)}>
          <Plus className="h-4 w-4" />
          {open ? t("settings2.builderClose") : t("settings2.builderOpen")}
        </Button>
        <Button variant="ghost" size="sm" className="gap-2" onClick={handleExport}>
          <Download className="h-4 w-4" />
          {t("settings2.builderExport")}
        </Button>
        <Button variant="ghost" size="sm" className="gap-2" onClick={() => setIoOpen((v) => !v)}>
          <Upload className="h-4 w-4" />
          {t("settings2.builderImport")}
        </Button>
      </div>

      {ioOpen && (
        <div className="space-y-2">
          <textarea
            value={ioText}
            onChange={(event) => setIoText(event.target.value)}
            rows={5}
            spellCheck={false}
            placeholder={t("settings2.builderIoPlaceholder")}
            className="w-full rounded-lg border border-border/60 bg-background/50 p-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          />
          <Button size="sm" variant="outline" onClick={handleImport}>
            {t("settings2.builderImportApply")}
          </Button>
        </div>
      )}

      {open && (
        <div className="space-y-4 rounded-xl border border-border/50 bg-background/40 p-3">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("settings2.builderName")}
            aria-label={t("settings2.builderName")}
          />

          <div className="grid gap-3 sm:grid-cols-3">
            <Slider label={t("settings2.builderHue")} value={hue} min={0} max={360} step={1} onChange={setHue} format={(v) => `${v}°`} />
            <Slider label={t("settings2.builderChroma")} value={chroma} min={0} max={0.3} step={0.005} onChange={setChroma} format={(v) => v.toFixed(3)} />
            <Slider label={t("settings2.builderLightness")} value={lightness} min={0.3} max={0.9} step={0.01} onChange={setLightness} format={(v) => v.toFixed(2)} />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t("settings2.builderStyle")}</span>
              <Segmented
                value={style}
                onChange={(value) => setStyle(value as SeedStyle)}
                options={STYLES.map((s) => ({ value: s, label: t(`settings2.builderStyle_${s}`) }))}
              />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t("settings2.builderRadius")}</span>
              <Segmented value={radius} onChange={(value) => setRadius(String(value))} options={RADIUS_OPTIONS.map((r) => ({ value: r, label: r }))} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <span className="block text-xs text-muted-foreground">{t("settings2.builderFont")}</span>
              <Select value={font} onValueChange={(v) => setFont(v as ThemeFont | "default")}>
                <SelectTrigger aria-label={t("settings2.builderFont")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FONTS.map((f) => (
                    <SelectItem key={f} value={f}>{t(`settings2.builderFont_${f}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <span className="block text-xs text-muted-foreground">{t("settings2.builderTexture")}</span>
              <Select value={texture} onValueChange={(v) => setTexture(v as ThemeTexture)}>
                <SelectTrigger aria-label={t("settings2.builderTexture")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TEXTURES.map((tex) => (
                    <SelectItem key={tex} value={tex}>{t(`settings2.builderTexture_${tex}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" className="gap-2" onClick={handleSave}>
              <Save className="h-4 w-4" />
              {t("settings2.builderSave")}
            </Button>
            <Button size="sm" variant="outline" onClick={resetForm}>
              {t("settings2.builderNew")}
            </Button>
            {editingId && (
              <Button size="sm" variant="ghost" className={cn("gap-2 text-destructive")} onClick={handleDelete}>
                <Trash2 className="h-4 w-4" />
                {t("settings2.builderDelete")}
              </Button>
            )}
          </div>
        </div>
      )}
    </SettingBlock>
  );
};
