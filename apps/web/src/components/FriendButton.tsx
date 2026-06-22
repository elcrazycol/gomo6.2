import { useEffect, useState } from "react";
import { useFriendsStore, type FriendStatus } from "@/stores/friendsStore";
import { api } from "@/integrations/api/compat";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserPlus, UserCheck, Clock, X, Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";

interface FriendButtonProps {
  userId: string;
  isOwnProfile: boolean;
}

export const FriendButton = ({ userId, isOwnProfile }: FriendButtonProps) => {
  const { friendStatusMap, sendRequest, acceptRequest, rejectRequest, removeFriend, checkStatus } =
    useFriendsStore();
  const [loading, setLoading] = useState(false);

  const statusData = friendStatusMap[userId];
  const status: FriendStatus = statusData?.status || "none";
  const requestId = statusData?.requestId;

  useEffect(() => {
    if (!isOwnProfile && userId) {
      checkStatus(userId);
    }
  }, [userId, isOwnProfile, checkStatus]);

  if (isOwnProfile) return null;

  const handleSendRequest = async () => {
    setLoading(true);
    try {
      await sendRequest(userId);
      toast.success("Заявка отправлена");
    } catch {
      toast.error("Ошибка отправки заявки");
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async () => {
    if (!requestId) return;
    setLoading(true);
    try {
      await acceptRequest(requestId);
      toast.success("Заявка принята");
    } catch {
      toast.error("Ошибка принятия заявки");
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    if (!requestId) return;
    setLoading(true);
    try {
      await rejectRequest(requestId);
      toast.success("Заявка отклонена");
    } catch {
      toast.error("Ошибка отклонения заявки");
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    setLoading(true);
    try {
      await removeFriend(userId);
      toast.success("Удалён из друзей");
    } catch {
      toast.error("Ошибка удаления");
    } finally {
      setLoading(false);
    }
  };

  const handleCancelRequest = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await api.auth.getSession();
      const token = session?.access_token;
      await fetch(`/api/v1/friends/${userId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      useFriendsStore.getState().setStatus(userId, "none");
      toast.success("Заявка отменена");
    } catch {
      toast.error("Ошибка отмены заявки");
    } finally {
      setLoading(false);
    }
  };

  // Friends - show dropdown with option to remove
  if (status === "friends") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            disabled={loading}
          >
            <UserCheck className="w-4 h-4" />
            <span className="hidden sm:inline">Друзья</span>
            <ChevronDown className="w-3 h-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleRemove} className="text-destructive">
            Удалить из друзей
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Pending sent - show cancel button
  if (status === "pending_sent") {
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5"
        onClick={handleCancelRequest}
        disabled={loading}
      >
        <Clock className="w-4 h-4" />
        <span className="hidden sm:inline">Заявка отправлена</span>
      </Button>
    );
  }

  // Pending received - show accept/reject buttons
  if (status === "pending_received") {
    return (
      <div className="flex gap-1">
        <Button
          variant="default"
          size="sm"
          className="h-8 gap-1.5"
          onClick={handleAccept}
          disabled={loading}
        >
          <Check className="w-4 h-4" />
          <span className="hidden sm:inline">Принять</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={handleReject}
          disabled={loading}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  // No relationship - show add friend button
  return (
    <Button
      variant="default"
      size="sm"
      className="h-8 gap-1.5"
      onClick={handleSendRequest}
      disabled={loading}
    >
      <UserPlus className="w-4 h-4" />
      <span className="hidden sm:inline">Добавить в друзья</span>
    </Button>
  );
};
