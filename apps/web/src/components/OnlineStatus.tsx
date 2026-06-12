import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { safeDate } from "@/utils/safeDate";
import { useUserRealtimeStatus } from "@/hooks/useRealtimeStatus";

interface OnlineStatusProps {
  userId?: string;
  isOnline?: boolean;
  lastSeen?: string | null;
  showText?: boolean;
  className?: string;
}

export function OnlineStatus({
  userId,
  isOnline: initialIsOnline,
  lastSeen: initialLastSeen,
  showText = true,
  className = ""
}: OnlineStatusProps) {
  // Subscribe to real-time status updates if userId is provided
  const realtimeStatus = useUserRealtimeStatus(userId);

  // Use real-time status if available, otherwise fall back to props
  const isOnline = realtimeStatus?.is_online ?? initialIsOnline;
  const lastSeen = realtimeStatus?.last_seen ?? initialLastSeen;

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
      const timeAgo = formatDistanceToNow(safeDate(lastSeen), {
        addSuffix: true,
        locale: ru,
      });

      return (
        <span className={`text-sm text-muted-foreground ${className}`}>
          {showText ? `был(а) в сети ${timeAgo}` : timeAgo}
        </span>
      );
    } catch {
      // Invalid date, don't show anything
      return null;
    }
  }

  return null;
}
