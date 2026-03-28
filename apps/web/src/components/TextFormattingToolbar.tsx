import { Button } from "@/components/ui/button";
import { Bold, Italic, Eye } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TextFormattingToolbarProps {
  onFormat: (prefix: string, suffix: string) => void;
}

export const TextFormattingToolbar = ({ onFormat }: TextFormattingToolbarProps) => {
  return (
    <TooltipProvider>
      <div className="flex gap-1 mb-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onFormat("[B]", "[/B]")}
            >
              <Bold className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Жирный текст</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onFormat("[I]", "[/I]")}
            >
              <Italic className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Курсив</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onFormat("[blur]", "[/blur]")}
            >
              <Eye className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Blur-спойлер</p>
          </TooltipContent>
        </Tooltip>

      </div>
    </TooltipProvider>
  );
};
