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

type ColorTheme = 'cannabis' | 'pink' | 'blue' | 'blood' | 'pumpkin';

export function ThemeToggle() {
  const [open, setOpen] = useState(false);
  const [colorTheme, setColorTheme] = useState<ColorTheme>('cannabis');
  const [isDark, setIsDark] = useState(false);

  // Load theme from localStorage on mount
  useEffect(() => {
    const savedColor = localStorage.getItem('color-theme') as ColorTheme;
    const savedMode = localStorage.getItem('dark-mode');
    
    if (savedColor) {
      setColorTheme(savedColor);
    }
    if (savedMode) {
      setIsDark(savedMode === 'true');
    }
    
    // Apply theme immediately
    applyTheme(savedColor || 'cannabis', savedMode === 'true');
  }, []);

  const applyTheme = (color: ColorTheme, dark: boolean) => {
    const html = document.documentElement;
    
    // Remove all theme classes
    html.classList.remove(
      'theme-cannabis', 'theme-cannabis-dark',
      'theme-pink', 'theme-pink-dark',
      'theme-blue', 'theme-blue-dark',
      'theme-blood', 'theme-blood-dark',
      'theme-pumpkin', 'theme-pumpkin-dark'
    );
    
    // Add new theme class
    const themeClass = dark ? `theme-${color}-dark` : `theme-${color}`;
    html.classList.add(themeClass);
  };

  const handleColorChange = (newColor: ColorTheme) => {
    setColorTheme(newColor);
    localStorage.setItem('color-theme', newColor);
    applyTheme(newColor, isDark);
  };

  const handleModeToggle = (checked: boolean) => {
    setIsDark(checked);
    localStorage.setItem('dark-mode', checked.toString());
    applyTheme(colorTheme, checked);
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
            </RadioGroup>
          </div>
          
          <div className="flex items-center justify-between">
            <Label htmlFor="dark-mode" className="text-base font-semibold">
              Тёмный режим
            </Label>
            <Switch
              id="dark-mode"
              checked={isDark}
              onCheckedChange={handleModeToggle}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}