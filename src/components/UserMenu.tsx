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
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-popover border-border">
        <DropdownMenuItem onClick={onEdit} className="cursor-pointer">
          <Edit className="h-4 w-4 mr-2" />
          Изменить {type === "post" ? "пост" : "тред"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDelete} className="cursor-pointer text-destructive">
          <Trash2 className="h-4 w-4 mr-2" />
          Удалить {type === "post" ? "пост" : "тред"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onReport} className="cursor-pointer text-orange-600">
          <Flag className="h-4 w-4 mr-2" />
          Пожаловаться
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};