import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

interface OnlineStatusProps {
  isOnline?: boolean;
  lastSeen?: string | null;
  showText?: boolean;
  className?: string;
}

export function OnlineStatus({
  isOnline,
  lastSeen,
  showText = true,
  className = ""
}: OnlineStatusProps) {
  if (isOnline) {
    return (
      <div className={`flex items-center gap-1.5 ${className}`}>
        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        {showText && (
          <span className="text-sm text-muted-foreground">в сети</span>
        )}
      </div>
    );
  }

  if (lastSeen) {
    try {
      const timeAgo = formatDistanceToNow(new Date(lastSeen), {
        addSuffix: true,
        locale: ru,
      });

      return (
        <span className={`text-sm text-muted-foreground ${className}`}>
          {showText ? `был(а) в сети ${timeAgo}` : timeAgo}
        </span>
      );
    } catch (error) {
      // Invalid date, don't show anything
      return null;
    }
  }

  return null;
}
