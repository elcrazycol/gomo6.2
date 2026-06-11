import { type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export interface ActionButtonProps {
  icon: ReactNode;
  label: string;
  count?: number | null;
  showLabel?: boolean;
  active?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}

export const ActionButton = ({
  icon,
  label,
  count = null,
  showLabel = true,
  active = false,
  disabled = false,
  loading = false,
  onClick,
}: ActionButtonProps) => (
  <Button
    type="button"
    variant="ghost"
    size="sm"
    onClick={onClick}
    disabled={disabled || loading}
    className={`h-8 gap-1.5 px-1.5 text-xs transition-colors sm:h-9 sm:px-2 sm:text-sm ${
      active ? "text-primary hover:text-primary" : "text-muted-foreground"
    }`}
  >
    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
    {showLabel && <span className="hidden sm:inline">{label}</span>}
    {typeof count === "number" && <span className="text-foreground/80">{count}</span>}
  </Button>
);
