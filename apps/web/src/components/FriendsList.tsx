import { Link } from "react-router-dom";
import { useFriendsStore, type Friend } from "@/stores/friendsStore";
import { storageUrl } from "@/utils/storage";
import { User } from "lucide-react";
import { OnlineStatus } from "@/components/OnlineStatus";

interface FriendsListProps {
  userId?: string;
}

const FriendItem = ({ friend }: { friend: Friend }) => {
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
        {friend.is_online && (
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-background" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">
          {friend.display_name || friend.username}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          @{friend.username}
        </p>
      </div>

      {/* Online status */}
      <OnlineStatus
        userId={friend.user_id}
        isOnline={friend.is_online}
        showText={false}
      />
    </Link>
  );
};

export const FriendsList = ({ userId }: FriendsListProps) => {
  const { friends, isLoading } = useFriendsStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-pulse text-muted-foreground">Загрузка...</div>
      </div>
    );
  }

  if (friends.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Пока нет друзей</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {friends.map((friend) => (
        <FriendItem key={friend.user_id} friend={friend} />
      ))}
    </div>
  );
};
