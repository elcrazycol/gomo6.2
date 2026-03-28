import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Bold, Italic, Eye, Type, Underline, Strikethrough, Palette, Hash, AtSign, Link, Zap, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CompactFormattingToolbarProps {
  onFormat: (prefix: string, suffix: string) => void;
}

export const CompactFormattingToolbar = ({ onFormat }: CompactFormattingToolbarProps) => {
  return (
    <TooltipProvider>
      <div className="flex gap-1 mb-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="px-2"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onClick={() => onFormat("[B]", "[/B]")}>
              <Bold className="h-4 w-4 mr-2" />
              Жирный текст
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onFormat("[I]", "[/I]")}>
              <Italic className="h-4 w-4 mr-2" />
              Курсив
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onFormat("[U]", "[/U]")}>
              <Underline className="h-4 w-4 mr-2" />
              Подчеркнутый
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onFormat("[S]", "[/S]")}>
              <Strikethrough className="h-4 w-4 mr-2" />
              Зачеркнутый
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onFormat("[blur]", "[/blur]")}>
              <Eye className="h-4 w-4 mr-2" />
              Blur-спойлер
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onFormat("[size=2]", "[/size]")}>
              <Type className="h-4 w-4 mr-2" />
              Размер текста
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onFormat("[col=#ff0000]", "[/col]")}>
              <Palette className="h-4 w-4 mr-2" />
              Цвет текста
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onFormat(":emoji:", "")}>
              <Zap className="h-4 w-4 mr-2" />
              Эмодзи
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onFormat("@", "")}>
              <AtSign className="h-4 w-4 mr-2" />
              Упоминание
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onFormat("https://", "")}>
              <Link className="h-4 w-4 mr-2" />
              Ссылка
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </TooltipProvider>
  );
};