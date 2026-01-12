import { MoreVertical, Trash2, Edit, Flag, Share2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface UserMenuProps {
  onEdit?: () => void;
  onDelete?: () => void;
  onReport?: () => void;
  onShare?: () => void;
  type: "post" | "thread";
  isOwner: boolean;
  postId?: string;
  threadId?: string;
}

export const UserMenu = ({ onEdit, onDelete, onReport, onShare, type, isOwner, postId, threadId }: UserMenuProps) => {
  const { toast } = useToast();

  const handleShare = async () => {
    if (onShare) {
      onShare();
      return;
    }

    // Default share logic
    let shareUrl = "";
    if (type === "post" && postId) {
      shareUrl = `${window.location.origin}${window.location.pathname}#post-${postId}`;
    } else if (type === "thread" && threadId) {
      shareUrl = `${window.location.origin}/thread/${threadId}`;
    }

    if (shareUrl) {
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast({
          title: "Ссылка скопирована!",
          description: "Ссылка на " + (type === "post" ? "сообщение" : "тред") + " скопирована в буфер обмена",
        });
      } catch (err) {
        console.error('Failed to copy: ', err);
        toast({
          title: "Ошибка",
          description: "Не удалось скопировать ссылку",
          variant: "destructive",
        });
      }
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-popover border-border">
        <DropdownMenuItem onClick={handleShare} className="cursor-pointer">
          <Share2 className="h-4 w-4 mr-2" />
          Поделиться
        </DropdownMenuItem>
        {isOwner && onEdit && (
          <DropdownMenuItem onClick={onEdit} className="cursor-pointer">
            <Edit className="h-4 w-4 mr-2" />
            Изменить {type === "post" ? "пост" : "тред"}
          </DropdownMenuItem>
        )}
        {isOwner && onDelete && (
          <DropdownMenuItem onClick={onDelete} className="cursor-pointer text-destructive">
            <Trash2 className="h-4 w-4 mr-2" />
            Удалить {type === "post" ? "пост" : "тред"}
          </DropdownMenuItem>
        )}
        {!isOwner && onReport && (
          <DropdownMenuItem onClick={onReport} className="cursor-pointer text-orange-600">
            <Flag className="h-4 w-4 mr-2" />
            Пожаловаться
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};