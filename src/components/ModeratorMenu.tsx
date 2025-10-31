import { MoreVertical, Trash2, Edit, Ban } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

interface ModeratorMenuProps {
  onDelete: () => void;
  onEdit?: () => void;
  onBan: () => void;
  type: "post" | "thread" | "profile";
}

export const ModeratorMenu = ({ onDelete, onEdit, onBan, type }: ModeratorMenuProps) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-popover border-border">
        {onEdit && (
          <DropdownMenuItem onClick={onEdit} className="cursor-pointer">
            <Edit className="h-4 w-4 mr-2" />
            Изменить {type === "post" ? "пост" : "тред"}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onDelete} className="cursor-pointer text-destructive">
          <Trash2 className="h-4 w-4 mr-2" />
          Удалить {type === "post" ? "пост" : type === "thread" ? "тред" : "профиль"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onBan} className="cursor-pointer text-destructive">
          <Ban className="h-4 w-4 mr-2" />
          Забанить пользователя
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};