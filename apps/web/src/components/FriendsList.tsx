import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useFriendsStore, type Friend } from "@/stores/friendsStore";
import { storageUrl } from "@/utils/storage";
import { User } from "lucide-react";
import { OnlineStatus } from "@/components/OnlineStatus";
import { NicknameEmoji } from "@/components/NicknameEmoji";
import { useRealtimeOnlineStatus, type UserStatus } from "@/hooks/useRealtimeStatus";

interface FriendsListProps {
  userId?: string;
}

const FriendItem = ({ friend, liveStatus }: { friend: Friend; liveStatus?: UserStatus }) => {
  // Live status from the presence room when available, otherwise the
  // REST-loaded value from the friends store.
  const isOnline = liveStatus?.is_online ?? friend.is_online;
  return (
    <Link
      to={`/profile/${friend.user_id}`}
      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
    >
      {/* Avatar */}
      <div className="relative">
        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center overflow-hidden">
          {friend.avatar_url ? (
            <img
              src={storageUrl("post-images", friend.avatar_url) || friend.avatar_url}
              alt={friend.username}
              className="w-full h-full object-cover"
            />
          ) : (
            <User className="w-5 h-5 text-muted-foreground" />
          )}
        </div>
        {/* Online indicator */}
        {isOnline && (
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-background" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate flex items-center gap-1">
          {friend.display_name || friend.username}
          {friend.nickname_emoji_id && <NicknameEmoji emojiId={friend.nickname_emoji_id} />}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          @{friend.username}
        </p>
      </div>

      {/* Online status — realtime handled by the bulk hook above; the row
          itself must not open a second subscription per friend. */}
      <OnlineStatus
        userId={friend.user_id}
        isOnline={isOnline}
        showText={false}
        realtime={false}
      />
    </Link>
  );
};

export const FriendsList = ({ userId }: FriendsListProps) => {
  const { profileFriends, fetchProfileFriends, isLoading } = useFriendsStore();

  // Bulk presence: one subscription per visible friend (capped inside the
  // hook); snapshots arrive instantly, then deltas keep the dots live.
  const liveStatuses = useRealtimeOnlineStatus(profileFriends.map((f) => f.user_id));

  useEffect(() => {
    if (userId) {
      fetchProfileFriends(userId);
    }
  }, [userId, fetchProfileFriends]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-pulse text-muted-foreground">Загрузка...</div>
      </div>
    );
  }

  if (profileFriends.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Пока нет друзей</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {profileFriends.map((friend) => (
        <FriendItem
          key={friend.user_id}
          friend={friend}
          liveStatus={liveStatuses.get(friend.user_id)}
        />
      ))}
    </div>
  );
};
