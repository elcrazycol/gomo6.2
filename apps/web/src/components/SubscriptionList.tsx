import { Link } from "react-router-dom";
import { useFriendsStore, type SubscriptionUser } from "@/stores/friendsStore";
import { UserAvatar } from "@/components/UserAvatar";
import { OnlineStatus } from "@/components/OnlineStatus";
import { NicknameEmoji } from "@/components/NicknameEmoji";
import { Users } from "lucide-react";
import { useRealtimeOnlineStatus, type UserStatus } from "@/hooks/useRealtimeStatus";
import { profileUrl } from "@/utils/entityUrl";

interface SubscriptionListProps {
  /** `subscribers` = people following this user; `subscriptions` = who they follow. */
  kind: "subscribers" | "subscriptions";
  /** Cap the rendered rows (the forum side panel previews the first 5). */
  limit?: number;
}

const SubscriptionItem = ({ user, liveStatus }: { user: SubscriptionUser; liveStatus?: UserStatus }) => {
  // Live status from the presence room when available, otherwise the
  // REST-loaded value from the store.
  const isOnline = liveStatus?.is_online ?? user.is_online;
  return (
    <Link
      to={profileUrl({ id: user.user_id, public_id: user.public_id })}
      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
    >
      {/* Avatar */}
      <div className="relative">
        <UserAvatar src={user.avatar_url} userId={user.user_id} alt={user.username} className="w-10 h-10" />
        {/* Online indicator */}
        {isOnline && (
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-background" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate flex items-center gap-1">
          {user.display_name || user.username}
          {user.nickname_emoji_id && <NicknameEmoji emojiId={user.nickname_emoji_id} />}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          @{user.username}
        </p>
      </div>

      {/* Mutual pair badge — friends are marked inside both lists. */}
      {user.is_friend && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
          <Users className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Друзья</span>
        </span>
      )}

      {/* Online status — realtime handled by the bulk hook above; the row
          itself must not open a second subscription per user. */}
      <OnlineStatus
        userId={user.user_id}
        isOnline={isOnline}
        showText={false}
        realtime={false}
      />
    </Link>
  );
};

/**
 * Presentational list of subscribers/subscriptions. The parent (SubscriptionsPanel)
 * preloads both lists and only renders this once the current one is ready, so the
 * list never swaps or flashes — it just appears complete.
 */
export const SubscriptionList = ({ kind, limit }: SubscriptionListProps) => {
  const profileSubscribers = useFriendsStore((s) => s.profileSubscribers);
  const profileSubscriptions = useFriendsStore((s) => s.profileSubscriptions);

  const list = kind === "subscribers" ? profileSubscribers : profileSubscriptions;
  const shown = limit ? list.slice(0, limit) : list;
  const hiddenCount = list.length - shown.length;

  // Bulk presence: one subscription per visible user (capped inside the hook);
  // snapshots arrive instantly, then deltas keep the dots live.
  const liveStatuses = useRealtimeOnlineStatus(shown.map((u) => u.user_id));

  if (list.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">
          {kind === "subscribers" ? "Пока нет подписчиков" : "Пока нет подписок"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {shown.map((user) => (
        <SubscriptionItem
          key={user.user_id}
          user={user}
          liveStatus={liveStatuses.get(user.user_id)}
        />
      ))}
      {hiddenCount > 0 && (
        <p className="px-2 pt-1 text-center text-xs text-muted-foreground">
          и ещё {hiddenCount}
        </p>
      )}
    </div>
  );
};
