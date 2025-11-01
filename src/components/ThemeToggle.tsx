import { Moon, Sun, Palette } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:rotate-90 dark:scale-0" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Сменить тему</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <Sun className="mr-2 h-4 w-4" />
          Светлая
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <Moon className="mr-2 h-4 w-4" />
          Тёмная
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setTheme("theme-pink")}>
          <Palette className="mr-2 h-4 w-4" style={{ color: "hsl(330, 70%, 50%)" }} />
          Розовая няшная
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("theme-blue")}>
          <Palette className="mr-2 h-4 w-4" style={{ color: "hsl(220, 60%, 35%)" }} />
          Синяя депрессивная
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("theme-blood")}>
          <Palette className="mr-2 h-4 w-4" style={{ color: "hsl(0, 80%, 45%)" }} />
          Кроваво-красная
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("theme-pumpkin")}>
          <Palette className="mr-2 h-4 w-4" style={{ color: "hsl(30, 85%, 45%)" }} />
          Оранжевая тыквенная
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
