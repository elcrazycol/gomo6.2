import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { safeDate } from "@/utils/safeDate";
import { useUserRealtimeStatus } from "@/hooks/useRealtimeStatus";

// A user who went offline within the last minute reads as «был(а) только что»
// instead of «был(а) в сети 1 минуту назад» — date-fns rounds 30–90 s up to a
// full minute, which looks wrong the moment the status flips to offline.
const JUST_NOW_MS = 60_000;

interface OnlineStatusProps {
  userId?: string;
  isOnline?: boolean;
  lastSeen?: string | null;
  showText?: boolean;
  className?: string;
  /** Disable the internal presence-room subscription (default true). Lists
   * that already track live status via a bulk hook pass their values through
   * props and set this to false to avoid one subscription per row. */
  realtime?: boolean;
}

export function OnlineStatus({
  userId,
  isOnline: initialIsOnline,
  lastSeen: initialLastSeen,
  showText = true,
  className = "",
  realtime = true
}: OnlineStatusProps) {
  // Subscribe to real-time status updates if userId is provided
  const realtimeStatus = useUserRealtimeStatus(userId, realtime);

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
      const lastSeenDate = safeDate(lastSeen);
      const justNow = Date.now() - lastSeenDate.getTime() <= JUST_NOW_MS;

      let label: string;
      if (justNow) {
        label = showText ? "был(а) только что" : "только что";
      } else {
        const timeAgo = formatDistanceToNow(lastSeenDate, {
          addSuffix: true,
          locale: ru,
        });
        label = showText ? `был(а) в сети ${timeAgo}` : timeAgo;
      }

      return (
        <span className={`text-sm text-muted-foreground ${className}`}>
          {label}
        </span>
      );
    } catch (error) {
      // Invalid date, don't show anything
      return null;
    }
  }

  return null;
}
