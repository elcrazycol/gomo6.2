import { MoreVertical, Trash2, Edit, Flag } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

interface UserMenuProps {
  onEdit: () => void;
  onDelete: () => void;
  onReport: () => void;
  type: "post" | "thread";
}

export const UserMenu = ({ onEdit, onDelete, onReport, type }: UserMenuProps) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-primary/10 hover:text-primary transition-colors">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-popover border-border shadow-lg">
        <DropdownMenuItem onClick={onEdit} className="cursor-pointer hover:bg-primary/15 hover:text-primary focus:bg-primary/15 focus:text-primary transition-colors px-3 py-2">
          <Edit className="h-4 w-4 mr-3" />
          Изменить {type === "post" ? "пост" : "тред"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDelete} className="cursor-pointer text-destructive hover:bg-destructive/15 hover:text-destructive focus:bg-destructive/15 focus:text-destructive transition-colors px-3 py-2">
          <Trash2 className="h-4 w-4 mr-3" />
          Удалить {type === "post" ? "пост" : "тред"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onReport} className="cursor-pointer text-orange-600 hover:bg-orange-500/15 hover:text-orange-600 focus:bg-orange-500/15 focus:text-orange-600 transition-colors px-3 py-2">
          <Flag className="h-4 w-4 mr-3" />
          Пожаловаться
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};