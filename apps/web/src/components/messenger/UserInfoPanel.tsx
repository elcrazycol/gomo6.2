import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, BellOff, ExternalLink, FileText, Gift, Image as ImageIcon, Play, Search, ShieldOff, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropsBalance } from "@/components/DropsBalance";
import { NicknameEmoji } from "@/components/NicknameEmoji";
import { UserAvatar } from "@/components/UserAvatar";
import { storageUrl, giftImageUrl } from "@/utils/storage";
import { formatPresence, getGroupInitials, getInitials } from "./utils";
import type { GiftCatalogItem } from "@/components/GiftCard";
import { formatDropsLabel } from "@/utils/formatDropsLabel";
import { messengerApi, type SharedAttachment } from "@/services/messengerApi";
import { apiClient } from "@/integrations/api/client";
import { useAuthenticatedAttachmentUrl } from "./attachmentMedia";
import { useMessengerStore } from "@/stores/messengerStore";
import type { Attachment, GroupMember } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  // 1:1 fields
  userId?: string;
  username?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  isOnline?: boolean | null;
  lastSeenAt?: string | null;
  isMuted?: boolean;
  /** Jump to the message a shared attachment belongs to. */
  onJumpToMessage?: (messageId: string) => void;
  // Group fields
  isGroup?: boolean;
  groupName?: string | null;
  groupAvatarUrl?: string | null;
  memberCount?: number;
}

const SHARED_MEDIA_LIMIT = 9;
const SHARED_FILE_LIMIT = 4;

/**
 * Telegram-style chat profile panel.
 *
 * A quiet card: who this is, two primary actions (profile / gift), the two
 * switches people actually change here (notifications, block), and the media
 * already exchanged in the conversation. Everything is loaded when the panel
 * opens — the message history is never touched.
 */
export function UserInfoPanel({
  open,
  onClose,
  conversationId,
  userId,
  username,
  displayName,
  avatarUrl,
  isOnline,
  lastSeenAt,
  isMuted = false,
  onJumpToMessage,
  isGroup,
  groupName,
  groupAvatarUrl,
  memberCount,
}: Props) {
  const setConversationMuted = useMessengerStore((s) => s.setConversationMuted);
  const setConversationBlockedByMe = useMessengerStore((s) => s.setConversationBlockedByMe);
  const loadConversations = useMessengerStore((s) => s.loadConversations);

  const [giftCatalog, setGiftCatalog] = useState<GiftCatalogItem[]>([]);
  const [showCatalog, setShowCatalog] = useState(false);
  const [selectedGift, setSelectedGift] = useState<GiftCatalogItem | null>(null);
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [message, setMessage] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [sending, setSending] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [addMemberQuery, setAddMemberQuery] = useState("");
  const [addMemberResults, setAddMemberResults] = useState<Array<{ id: string; username: string; display_name: string | null; avatar_url: string | null }>>([]);

  const [muted, setMuted] = useState(isMuted);
  const [muteBusy, setMuteBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [media, setMedia] = useState<SharedAttachment[]>([]);
  const [files, setFiles] = useState<SharedAttachment[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);

  useEffect(() => {
    setMuted(isMuted);
  }, [isMuted, conversationId]);

  useEffect(() => {
    if (!open) return;
    apiClient
      .request<GiftCatalogItem[]>("/api/v1/gift_catalog")
      .then((res) => setGiftCatalog((res.data ?? []) as GiftCatalogItem[]))
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open || isGroup || !userId) return;
    let cancelled = false;
    messengerApi
      .listBlocks()
      .then((blocks) => {
        if (!cancelled) setBlocked(blocks.some((block) => block.user_id === userId));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, isGroup, userId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setMediaLoading(true);
    Promise.all([
      messengerApi.listSharedAttachments(conversationId, ["image", "video"], SHARED_MEDIA_LIMIT),
      messengerApi.listSharedAttachments(conversationId, ["file", "audio"], SHARED_FILE_LIMIT),
    ])
      .then(([mediaRows, fileRows]) => {
        if (cancelled) return;
        setMedia(mediaRows);
        setFiles(fileRows);
      })
      .catch(() => {
        if (!cancelled) {
          setMedia([]);
          setFiles([]);
        }
      })
      .finally(() => {
        if (!cancelled) setMediaLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, conversationId]);

  useEffect(() => {
    if (!open || !isGroup || !conversationId) return;
    messengerApi.getGroupMembers(conversationId)
      .then((members) => setGroupMembers(members))
      .catch(() => {});
  }, [open, isGroup, conversationId]);

  useEffect(() => {
    if (!showAddMember || !addMemberQuery.trim()) {
      setAddMemberResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      apiClient
        .request<Array<{ id: string; username: string; display_name: string | null; avatar_url: string | null }>>(
          `/api/v1/drops/users/search?q=${encodeURIComponent(addMemberQuery.trim())}`,
        )
        .then((res) => setAddMemberResults((res.data ?? []) as typeof addMemberResults))
        .catch(() => setAddMemberResults([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [showAddMember, addMemberQuery]);

  const handleAddMember = useCallback(async (memberId: string) => {
    if (!conversationId) return;
    try {
      await messengerApi.addGroupMembers(conversationId, [memberId]);
      const members = await messengerApi.getGroupMembers(conversationId);
      setGroupMembers(members);
      setShowAddMember(false);
      setAddMemberQuery("");
    } catch (err) {
      const text = err instanceof Error ? err.message : "";
      if (/friend/i.test(text)) toast.error("Добавлять в группу можно только друзей");
      else if (/limit/i.test(text)) toast.error("Достигнут лимит участников группы (100)");
      else toast.error("Не удалось добавить участника");
    }
  }, [conversationId]);

  const handleToggleMute = useCallback(async () => {
    if (muteBusy) return;
    const next = !muted;
    setMuted(next);
    setMuteBusy(true);
    try {
      await messengerApi.setMuted(conversationId, next);
      setConversationMuted(conversationId, next);
    } catch {
      setMuted(!next);
      toast.error("Не удалось изменить уведомления");
    } finally {
      setMuteBusy(false);
    }
  }, [muteBusy, muted, conversationId, setConversationMuted]);

  const handleToggleBlock = useCallback(async () => {
    if (!userId || blockBusy) return;
    const next = !blocked;
    setBlockBusy(true);
    try {
      if (next) await messengerApi.blockUser(userId);
      else await messengerApi.unblockUser(userId);
      setBlocked(next);
      setConfirmBlock(false);
      // The chat behind the panel swaps its composer for the unblock bar (and
      // the peer's presence is hidden immediately, as the server does).
      setConversationBlockedByMe(conversationId, next);
      if (!next) void loadConversations({ force: true });
      toast.success(next ? "Пользователь заблокирован" : "Пользователь разблокирован");
    } catch {
      toast.error(next ? "Не удалось заблокировать" : "Не удалось разблокировать");
    } finally {
      setBlockBusy(false);
    }
  }, [userId, blocked, blockBusy, conversationId, setConversationBlockedByMe, loadConversations]);

  const sendDialogImage = selectedGift ? giftImageUrl(selectedGift.image_url) : null;

  const handleSendGift = async () => {
    if (!selectedGift || sending) return;
    setSending(true);
    try {
      await apiClient.request("/api/v1/gifts/send", {
        method: "POST",
        body: JSON.stringify({
          gift_id: selectedGift.id,
          recipient_id: userId,
          message: message.trim() || undefined,
          is_anonymous: isAnonymous,
        }),
      });
      toast.success(`Подарок «${selectedGift.name}» отправлен!`);
      setMessage("");
      setIsAnonymous(false);
      setShowSendDialog(false);
      setSelectedGift(null);
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "Не удалось отправить подарок");
    } finally {
      setSending(false);
    }
  };

  const jumpTo = useCallback((messageId: string) => {
    onJumpToMessage?.(messageId);
    onClose();
  }, [onJumpToMessage, onClose]);

  const avatarSrc = avatarUrl ? storageUrl("post-images", avatarUrl) || undefined : undefined;

  return (
    <>
      {open && <div className="user-info-panel-backdrop" onClick={onClose} />}

      <aside className={`user-info-panel ${open ? "is-open" : ""}`} aria-label="Информация о чате">
        <div className="user-info-panel-header">
          <span>{isGroup ? "О группе" : "Профиль"}</span>
          <button type="button" className="user-info-panel-close" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>

        <div className="user-info-panel-body">
          {isGroup ? (
            <>
              <div className="user-info-avatar">
                {groupAvatarUrl ? (
                  <img src={storageUrl("post-images", groupAvatarUrl) || undefined} alt={groupName || ""} />
                ) : (
                  <span>{getGroupInitials(groupName)}</span>
                )}
              </div>

              <h3 className="user-info-name">{groupName || "Группа"}</h3>
              <p className="user-info-presence">
                {memberCount} участник{memberCount === 1 ? "" : memberCount && memberCount < 5 ? "а" : "ов"}
              </p>

              <div className="user-info-section">
                <div className="user-info-section-head">
                  <span>Участники</span>
                  <button
                    type="button"
                    className="user-info-inline-btn"
                    onClick={() => setShowAddMember((value) => !value)}
                  >
                    <UserPlus size={13} />
                    Добавить
                  </button>
                </div>

                {showAddMember && (
                  <div className="user-info-member-search">
                    <div className="user-info-member-search-field">
                      <Search size={14} aria-hidden="true" />
                      <input
                        type="text"
                        value={addMemberQuery}
                        onChange={(event) => setAddMemberQuery(event.target.value)}
                        placeholder="Найти пользователя…"
                        autoFocus
                      />
                    </div>
                    {addMemberResults.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        className="user-info-member-row is-result"
                        onClick={() => void handleAddMember(user.id)}
                      >
                        <span className="avatar small">
                          {user.avatar_url ? (
                            <img src={storageUrl("post-images", user.avatar_url) || undefined} alt={user.username} />
                          ) : (
                            <span>{getInitials(user.username)}</span>
                          )}
                        </span>
                        <span className="user-info-member-name">{user.display_name || user.username}</span>
                        <UserPlus size={13} className="user-info-member-add" />
                      </button>
                    ))}
                  </div>
                )}

                {groupMembers.map((member) => (
                  <div key={member.user_id} className="user-info-member-row">
                    <span className="avatar small">
                      {member.avatar_url ? (
                        <img src={storageUrl("post-images", member.avatar_url) || undefined} alt={member.username} />
                      ) : (
                        <span>{getInitials(member.username)}</span>
                      )}
                    </span>
                    <span className="user-info-member-name">
                      {member.display_name || member.username}
                      {member.nickname_emoji_id && <NicknameEmoji emojiId={member.nickname_emoji_id} />}
                    </span>
                    {member.role === "admin" && <span className="user-info-member-role">admin</span>}
                    {member.is_online && <span className="online-dot" />}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="user-info-hero">
                <div className="user-info-avatar">
                  {avatarSrc ? (
                    <UserAvatar src={avatarUrl || ""} userId={userId || ""} alt={username || ""} className="h-full w-full" />
                  ) : (
                    <span>{getInitials(username || "")}</span>
                  )}
                </div>
                <h3 className="user-info-name">{displayName || username}</h3>
                {userId && username && (
                  <Link to={`/profile/${userId}`} className="user-info-username" onClick={onClose}>
                    @{username}
                    <ExternalLink size={11} />
                  </Link>
                )}
                <p className="user-info-presence">{formatPresence(isOnline ?? null, lastSeenAt ?? null)}</p>
              </div>

              <div className="user-info-actions">
                {userId && (
                  <Link to={`/profile/${userId}`} className="user-info-action-btn" onClick={onClose}>
                    Профиль
                  </Link>
                )}
                {giftCatalog.length > 0 && (
                  <button type="button" className="user-info-action-btn primary" onClick={() => setShowCatalog(true)}>
                    <Gift size={14} />
                    Подарить
                  </button>
                )}
              </div>

              <div className="user-info-switches">
                <button
                  type="button"
                  className="user-info-switch-row"
                  onClick={() => void handleToggleMute()}
                  aria-pressed={muted}
                  disabled={muteBusy}
                >
                  <span className="user-info-switch-icon">
                    {muted ? <BellOff size={16} /> : <Bell size={16} />}
                  </span>
                  <span className="user-info-switch-copy">
                    <span>Уведомления</span>
                    <small>{muted ? "Выключены" : "Включены"}</small>
                  </span>
                  <span className={`user-info-switch${muted ? " is-on" : ""}`} aria-hidden="true">
                    <span />
                  </span>
                </button>

                {userId && (
                  <button
                    type="button"
                    className={`user-info-switch-row user-info-block-row${blocked ? " is-blocked" : ""}`}
                    onClick={() => (blocked ? void handleToggleBlock() : setConfirmBlock(true))}
                    disabled={blockBusy}
                  >
                    <span className="user-info-switch-icon"><ShieldOff size={16} /></span>
                    <span className="user-info-switch-copy">
                      <span>{blocked ? "Разблокировать" : "Заблокировать"}</span>
                      <small>{blocked ? "Сообщения и звонки запрещены" : "Скрыть переписку и звонки"}</small>
                    </span>
                  </button>
                )}
              </div>

              <div className="user-info-section">
                <div className="user-info-section-head">
                  <span>Медиа</span>
                  {media.length > 0 && <small>{media.length}</small>}
                </div>
                {mediaLoading ? (
                  <div className="user-info-media-empty">Загружаем…</div>
                ) : media.length > 0 ? (
                  <div className="user-info-media-grid">
                    {media.map((item) => (
                      <SharedMediaTile key={item.id} item={item} onOpen={() => jumpTo(item.message_id)} />
                    ))}
                  </div>
                ) : (
                  <div className="user-info-media-empty">
                    <ImageIcon size={16} />
                    <span>Пока нет фото и видео</span>
                  </div>
                )}
              </div>

              {files.length > 0 && (
                <div className="user-info-section">
                  <div className="user-info-section-head">
                    <span>Файлы</span>
                    <small>{files.length}</small>
                  </div>
                  <div className="user-info-files">
                    {files.map((item) => (
                      <button key={item.id} type="button" className="user-info-file-row" onClick={() => jumpTo(item.message_id)}>
                        <span className="user-info-file-icon"><FileText size={15} /></span>
                        <span className="user-info-file-copy">
                          <span>{item.name}</span>
                          <small>{Math.max(1, Math.round(item.size / 1024))} КБ</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </aside>

      <Dialog open={showCatalog} onOpenChange={setShowCatalog}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader className="pr-10">
            <div className="flex items-center justify-between">
              <DialogTitle>Выберите подарок</DialogTitle>
              <DropsBalance />
            </div>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            {giftCatalog.map((gift) => {
              const catalogImage = giftImageUrl(gift.image_url);
              return (
                <button
                  key={gift.id}
                  type="button"
                  onClick={() => {
                    setSelectedGift(gift);
                    setShowCatalog(false);
                    setShowSendDialog(true);
                  }}
                  className="flex flex-col items-center gap-2 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/50 transition-colors text-left"
                >
                  <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                    {catalogImage ? (
                      <img src={catalogImage} alt={gift.name} className="w-full h-full object-cover" />
                    ) : (
                      <Gift className="w-8 h-8 text-muted-foreground" />
                    )}
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium">{gift.name}</p>
                    <p className="text-xs text-muted-foreground">{gift.price} {formatDropsLabel(gift.price)}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showSendDialog} onOpenChange={setShowSendDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader className="pr-10">
            <div className="flex items-center justify-between">
              <DialogTitle>Отправить подарок</DialogTitle>
              <DropsBalance />
            </div>
          </DialogHeader>
          {selectedGift && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
                <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
                  {sendDialogImage ? (
                    <img src={sendDialogImage} alt={selectedGift.name} className="w-full h-full object-cover" />
                  ) : (
                    <Gift className="w-8 h-8 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <p className="font-medium">{selectedGift.name}</p>
                  <p className="text-sm text-muted-foreground">{selectedGift.price} {formatDropsLabel(selectedGift.price)}</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Получатель: <span className="text-foreground font-medium">@{username}</span>
              </p>
              <div>
                <label className="text-sm font-medium" htmlFor="messenger-gift-msg">Сообщение</label>
                <input
                  id="messenger-gift-msg"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Напишите что-нибудь…"
                  maxLength={500}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Анонимно</p>
                  <p className="text-xs text-muted-foreground">Получатель не узнает от кого</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAnonymous((value) => !value)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isAnonymous ? "bg-primary" : "bg-input"}`}
                  aria-pressed={isAnonymous}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isAnonymous ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>
              <Button onClick={() => void handleSendGift()} disabled={sending} className="w-full">
                {sending ? "Отправка…" : `Отправить за ${selectedGift.price} ${formatDropsLabel(selectedGift.price)}`}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmBlock} onOpenChange={setConfirmBlock}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Заблокировать @{username}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Вы больше не сможете обмениваться сообщениями. Разблокировать можно здесь же.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="user-info-action-btn" onClick={() => setConfirmBlock(false)}>
              Отмена
            </button>
            <button
              type="button"
              className="user-info-action-btn is-danger"
              onClick={() => void handleToggleBlock()}
              disabled={blockBusy}
            >
              Заблокировать
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * One shared-media cell. The full image is fetched through the authenticated
 * attachment cache (the storage bucket is private), and the tile itself links
 * back to the message it came from instead of opening a separate viewer.
 */
function SharedMediaTile({ item, onOpen }: { item: SharedAttachment; onOpen: () => void }) {
  const meta = useMemo(() => {
    if (!item.meta) return {} as { preview_key?: string; thumb_hash?: string; lqip?: string };
    try {
      return JSON.parse(item.meta) as { preview_key?: string; thumb_hash?: string; lqip?: string };
    } catch {
      return {};
    }
  }, [item.meta]);

  const attachment = useMemo<Attachment>(() => ({
    id: item.id,
    url: item.url,
    type: item.type === "video" ? "video" : "image",
    name: item.name,
    size: item.size,
    mime: item.mime,
    meta: item.meta,
  }), [item]);

  const src = useAuthenticatedAttachmentUrl(attachment, meta.preview_key || item.url, true);

  return (
    <button type="button" className="user-info-media-tile" onClick={onOpen} title={item.name}>
      {src ? (
        <img src={src} alt={item.name} loading="lazy" decoding="async" />
      ) : (
        <span className="user-info-media-placeholder" aria-hidden="true" />
      )}
      {item.type === "video" && (
        <span className="user-info-media-play" aria-hidden="true"><Play size={12} /></span>
      )}
    </button>
  );
}
