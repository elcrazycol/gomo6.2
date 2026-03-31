import { Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { applyTheme, getStoredTheme, type ColorTheme, syncSharedAppearanceCookies } from "@/utils/theme";

export function ThemeToggle() {
  const [open, setOpen] = useState(false);
  const [{ colorTheme, isDarkMode }, setThemeState] = useState(() => getStoredTheme());

  // Load theme from localStorage on mount
  useEffect(() => {
    const storedTheme = getStoredTheme();
    setThemeState(storedTheme);
    applyTheme(storedTheme.colorTheme, storedTheme.isDarkMode);
  }, []);

  const handleColorChange = (newColor: ColorTheme) => {
    setThemeState((prev) => ({ ...prev, colorTheme: newColor }));
    localStorage.setItem('color-theme', newColor);
    applyTheme(newColor, isDarkMode);
    syncSharedAppearanceCookies();
  };

  const handleModeToggle = (checked: boolean) => {
    setThemeState((prev) => ({ ...prev, isDarkMode: checked }));
    localStorage.setItem('dark-mode', checked.toString());
    applyTheme(colorTheme, checked);
    syncSharedAppearanceCookies();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon">
          <Settings className="h-[1.2rem] w-[1.2rem]" />
          <span className="sr-only">Настройки темы</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Настройки темы</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="space-y-4">
            <Label className="text-base font-semibold">Цветовая схема</Label>
            <RadioGroup value={colorTheme} onValueChange={(val) => handleColorChange(val as ColorTheme)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="cannabis" id="cannabis" />
                <Label htmlFor="cannabis" className="cursor-pointer">
                  🌿 Зелёная каннабиоидная
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="pink" id="pink" />
                <Label htmlFor="pink" className="cursor-pointer">
                  💖 Розовая няшная
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="blue" id="blue" />
                <Label htmlFor="blue" className="cursor-pointer">
                  💙 Синяя депрессивная
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="blood" id="blood" />
                <Label htmlFor="blood" className="cursor-pointer">
                  🩸 Кроваво-красная
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="pumpkin" id="pumpkin" />
                <Label htmlFor="pumpkin" className="cursor-pointer">
                  🎃 Оранжево-тыквенная
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="graphite" id="graphite" />
                <Label htmlFor="graphite" className="cursor-pointer">
                  Монохромный графит
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="lavender" id="lavender" />
                <Label htmlFor="lavender" className="cursor-pointer">
                  Космический лавандовый
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="volcanic" id="volcanic" />
                <Label htmlFor="volcanic" className="cursor-pointer">
                  Вулканический пепел
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="mint" id="mint" />
                <Label htmlFor="mint" className="cursor-pointer">
                  Мятный лимонад
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="glitch" id="glitch" />
                <Label htmlFor="glitch" className="cursor-pointer">
                  Глитч-кор
                </Label>
              </div>
            </RadioGroup>
          </div>
          
          <div className="flex items-center justify-between">
            <Label htmlFor="dark-mode" className="text-base font-semibold">
              Тёмный режим
            </Label>
            <Switch
              id="dark-mode"
              checked={isDarkMode}
              onCheckedChange={handleModeToggle}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
