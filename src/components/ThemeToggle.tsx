import { Settings } from "lucide-react";
import { useTheme } from "next-themes";
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
import { useState } from "react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  
  // Определяем текущую цветовую тему и режим
  const isDark = theme?.includes('-dark') || theme === 'dark';
  const colorTheme = theme?.replace('-dark', '') || 'theme-cannabis';

  const handleColorChange = (newColorTheme: string) => {
    if (isDark) {
      setTheme(`${newColorTheme}-dark`);
    } else {
      setTheme(newColorTheme);
    }
  };

  const handleModeToggle = (checked: boolean) => {
    if (checked) {
      setTheme(`${colorTheme}-dark`);
    } else {
      setTheme(colorTheme);
    }
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
            <RadioGroup value={colorTheme} onValueChange={handleColorChange}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="theme-cannabis" id="cannabis" />
                <Label htmlFor="cannabis" className="cursor-pointer">
                  🌿 Зелёная каннабиоидная
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="theme-pink" id="pink" />
                <Label htmlFor="pink" className="cursor-pointer">
                  💖 Розовая няшная
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="theme-blue" id="blue" />
                <Label htmlFor="blue" className="cursor-pointer">
                  💙 Синяя депрессивная
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="theme-blood" id="blood" />
                <Label htmlFor="blood" className="cursor-pointer">
                  🩸 Кроваво-красная
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="theme-pumpkin" id="pumpkin" />
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
