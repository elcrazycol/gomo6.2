import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Search, Users } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PentagramLoader } from "@/components/PentagramLoader";
import { UserAvatar } from "@/components/UserAvatar";
import { storageUrl } from "@/utils/storage";
import { getInitials, formatPresence } from "./utils";
import { messengerApi } from "@/services/messengerApi";
import { apiClient } from "@/integrations/api/client";
import { useMessengerStore } from "@/stores/messengerStore";
import { useFriendsStore } from "@/stores/friendsStore";

interface UserSearchResult {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

type Mode = "list" | "group";

/**
 * Telegram's "New message" sheet, one click shorter.
 *
 * Opening it focuses the search field immediately and already shows the people
 * the reader is most likely to write to — recent 1:1 chats first, then friends.
 * A tap on any row opens (or creates) the conversation and closes the sheet, so
 * starting a chat never goes through a mode chooser. Group creation stays a
 * quiet secondary row above the list.
 */
export function NewChatDialog({ open, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("list");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const selectConversation = useMessengerStore((s) => s.selectConversation);
  const createConversation = useMessengerStore((s) => s.createConversation);
  const conversations = useMessengerStore((s) => s.conversations);
  const friends = useFriendsStore((s) => s.friends);
  const fetchFriends = useFriendsStore((s) => s.fetchFriends);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setMode("list");
    setQuery("");
    setResults([]);
    setGroupName("");
    setIsCreating(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    reset();
    if (friends.length === 0) void fetchFriends();
  }, [open, reset, fetchFriends, friends.length]);

  // Autofocus on open and whenever the sheet switches back to the list: the
  // reader's first action is typing a name.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open, mode]);

  useEffect(() => {
    if (!open || mode !== "list" || !query.trim()) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setIsSearching(true);
      apiClient
        .request<UserSearchResult[]>(`/api/v1/drops/users/search?q=${encodeURIComponent(query.trim())}`)
        .then((res) => setResults((res.data ?? []) as UserSearchResult[]))
        .catch(() => setResults([]))
        .finally(() => setIsSearching(false));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [open, mode, query]);

  const recents = useMemo(
    () => conversations.filter((conversation) => !conversation.is_group && !conversation.is_notes && conversation.other_user_id),
    [conversations],
  );

  const recentIds = useMemo(
    () => new Set(recents.map((conversation) => conversation.other_user_id).filter(Boolean)),
    [recents],
  );

  const friendsToShow = useMemo(
    () => friends.filter((friend) => !recentIds.has(friend.user_id)),
    [friends, recentIds],
  );

  const handleStartChat = useCallback(async (userId: string) => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const convId = await createConversation(userId);
      if (convId) {
        selectConversation(convId);
        onClose();
      }
    } catch (err) {
      console.error("Failed to start chat:", err);
    } finally {
      setIsCreating(false);
    }
  }, [isCreating, createConversation, selectConversation, onClose]);

  const handleCreateGroup = useCallback(async () => {
    if (!groupName.trim() || isCreating) return;
    setIsCreating(true);
    try {
      const { conversation_id } = await messengerApi.createGroup(groupName.trim(), []);
      selectConversation(conversation_id);
      onClose();
    } catch (err) {
      console.error("Failed to create group:", err);
    } finally {
      setIsCreating(false);
    }
  }, [groupName, isCreating, selectConversation, onClose]);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="new-chat-dialog gap-0 overflow-hidden p-0">
        <div className="new-chat-head">
          {mode === "group" ? (
            <button type="button" className="new-chat-back" onClick={() => setMode("list")} aria-label="Назад">
              <ArrowLeft size={16} />
            </button>
          ) : null}
          <DialogTitle className="new-chat-title">
            {mode === "group" ? "Новая группа" : "Новый чат"}
          </DialogTitle>
        </div>

        {mode === "list" ? (
          <>
            <div className="new-chat-search">
              <Search size={16} className="new-chat-search-icon" aria-hidden="true" />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Имя, @никнейм или телефон"
                className="new-chat-search-input"
                aria-label="Поиск пользователей"
              />
            </div>

            <div className="new-chat-body">
              {!query.trim() && (
                <button type="button" className="new-chat-group-row" onClick={() => setMode("group")}>
                  <span className="new-chat-group-icon"><Users size={16} /></span>
                  <span>Создать группу</span>
                </button>
              )}

              {query.trim() ? (
                <>
                  {isSearching && <div className="new-chat-loader"><PentagramLoader size="sm" /></div>}
                  {!isSearching && results.length === 0 && (
                    <p className="new-chat-empty">Никого не нашли</p>
                  )}
                  {results.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      className="new-chat-row"
                      disabled={isCreating}
                      onClick={() => void handleStartChat(user.id)}
                    >
                      <NewChatAvatar user={user} />
                      <span className="new-chat-row-copy">
                        <span className="new-chat-row-name">{user.display_name || user.username}</span>
                        <span className="new-chat-row-sub">@{user.username}</span>
                      </span>
                    </button>
                  ))}
                </>
              ) : (
                <>
                  {recents.length > 0 && (
                    <div className="new-chat-section">Недавние</div>
                  )}
                  {recents.map((conversation) => (
                    <button
                      key={conversation.id}
                      type="button"
                      className="new-chat-row"
                      disabled={isCreating}
                      onClick={() => {
                        selectConversation(conversation.id);
                        onClose();
                      }}
                    >
                      <span className="avatar">
                        {conversation.other_avatar_url ? (
                          <UserAvatar
                            src={conversation.other_avatar_url}
                            userId={conversation.other_user_id ?? ""}
                            alt={conversation.other_username || ""}
                            className="h-full w-full"
                          />
                        ) : (
                          <span>{getInitials(conversation.other_username || "")}</span>
                        )}
                      </span>
                      <span className="new-chat-row-copy">
                        <span className="new-chat-row-name">
                          {conversation.other_display_name || conversation.other_username}
                        </span>
                        <span className="new-chat-row-sub">
                          {formatPresence(conversation.other_is_online, conversation.other_last_seen_at)}
                        </span>
                      </span>
                    </button>
                  ))}

                  {friendsToShow.length > 0 && <div className="new-chat-section">Друзья</div>}
                  {friendsToShow.map((friend) => (
                    <button
                      key={friend.user_id}
                      type="button"
                      className="new-chat-row"
                      disabled={isCreating}
                      onClick={() => void handleStartChat(friend.user_id)}
                    >
                      <span className="avatar">
                        {friend.avatar_url ? (
                          <UserAvatar
                            src={friend.avatar_url}
                            userId={friend.user_id}
                            alt={friend.username}
                            className="h-full w-full"
                          />
                        ) : (
                          <span>{getInitials(friend.username)}</span>
                        )}
                      </span>
                      <span className="new-chat-row-copy">
                        <span className="new-chat-row-name">{friend.display_name || friend.username}</span>
                        <span className="new-chat-row-sub">
                          {friend.is_online ? "в сети" : `@${friend.username}`}
                        </span>
                      </span>
                    </button>
                  ))}

                  {recents.length === 0 && friendsToShow.length === 0 && (
                    <p className="new-chat-empty">
                      Начни вводить имя — найдём человека по всему gomo6.
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        ) : (
          <div className="new-chat-body new-chat-group-body">
            <label className="new-chat-label" htmlFor="new-chat-group-name">Название группы</label>
            <input
              ref={inputRef}
              id="new-chat-group-name"
              type="text"
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void handleCreateGroup(); }}
              placeholder="Например, «Книжный клуб»"
              className="new-chat-group-input"
              maxLength={80}
            />
            <p className="new-chat-hint">Участников можно добавить сразу после создания.</p>
            <button
              type="button"
              className="new-chat-create"
              onClick={() => void handleCreateGroup()}
              disabled={!groupName.trim() || isCreating}
            >
              {isCreating ? "Создаём…" : "Создать группу"}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NewChatAvatar({ user }: { user: UserSearchResult }) {
  const src = user.avatar_url ? storageUrl("post-images", user.avatar_url) || undefined : undefined;
  return (
    <span className="avatar">
      {src ? (
        <img src={src} alt={user.username} className="h-full w-full object-cover" />
      ) : (
        <span>{getInitials(user.username)}</span>
      )}
    </span>
  );
}
