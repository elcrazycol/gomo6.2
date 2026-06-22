import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useFriendsStore, type FriendRequest } from "@/stores/friendsStore";
import { storageUrl } from "@/utils/storage";
import { Button } from "@/components/ui/button";
import { User, Check, X } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { safeDate } from "@/utils/safeDate";

export const FriendRequestsList = () => {
  const { incomingRequests, fetchRequests, isLoading } = useFriendsStore();

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-pulse text-muted-foreground">Загрузка...</div>
      </div>
    );
  }

  if (incomingRequests.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Нет входящих заявок</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {incomingRequests.map((request) => (
        <RequestItem key={request.id} request={request} />
      ))}
    </div>
  );
};

const RequestItem = ({ request }: { request: FriendRequest }) => {
  const { acceptRequest, rejectRequest } = useFriendsStore();
  const [loading, setLoading] = useState(false);

  const handleAccept = async () => {
    setLoading(true);
    try {
      await acceptRequest(request.id);
      toast.success("Заявка принята");
    } catch {
      toast.error("Ошибка принятия заявки");
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    setLoading(true);
    try {
      await rejectRequest(request.id);
      toast.success("Заявка отклонена");
    } catch {
      toast.error("Ошибка отклонения заявки");
    } finally {
      setLoading(false);
    }
  };

  const timeAgo = formatDistanceToNow(safeDate(request.created_at), {
    locale: ru,
    addSuffix: true,
  });

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border">
      {/* Avatar */}
      <Link to={`/profile/${request.sender_id}`} className="shrink-0">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center overflow-hidden">
          {request.sender_avatar_url ? (
            <img
              src={storageUrl("post-images", request.sender_avatar_url) || request.sender_avatar_url}
              alt={request.sender_username}
              className="w-full h-full object-cover"
            />
          ) : (
            <User className="w-6 h-6 text-muted-foreground" />
          )}
        </div>
      </Link>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <Link
          to={`/profile/${request.sender_id}`}
          className="font-medium text-sm hover:underline truncate block"
        >
          {request.sender_display_name || request.sender_username}
        </Link>
        <p className="text-xs text-muted-foreground">
          @{request.sender_username} · {timeAgo}
        </p>
      </div>

      {/* Actions */}
      <div className="flex gap-1">
        <Button
          variant="default"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={handleAccept}
          disabled={loading}
        >
          <Check className="w-4 h-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={handleReject}
          disabled={loading}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
};
