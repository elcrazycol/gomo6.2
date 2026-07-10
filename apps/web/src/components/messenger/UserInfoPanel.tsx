import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { X, Gift, ExternalLink, Search, UserPlus, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropsBalance } from "@/components/DropsBalance";
import { storageUrl } from "@/utils/storage";
import { formatPresence, getInitials } from "./utils";
import type { GiftCatalogItem } from "@/components/GiftCard";
import { formatDropsLabel } from "@/utils/formatDropsLabel";
import { messengerApi } from "@/services/messengerApi";
import type { GroupMember } from "./types";

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
  // Group fields
  isGroup?: boolean;
  groupName?: string | null;
  groupAvatarUrl?: string | null;
  memberCount?: number;
}

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
  isGroup,
  groupName,
  groupAvatarUrl,
  memberCount,
}: Props) {
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
  const [isSearchingMembers, setIsSearchingMembers] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/v1/gift_catalog")
      .then((r) => r.json())
      .then((res) => setGiftCatalog(res.data || []))
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open || !isGroup || !conversationId) return;
    messengerApi.getGroupMembers(conversationId)
      .then((members) => setGroupMembers(members))
      .catch(() => {});
  }, [open, isGroup, conversationId]);

  useEffect(() => {
    if (!showAddMember || !addMemberQuery.trim() || addMemberQuery.length < 1) {
      setAddMemberResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setIsSearchingMembers(true);
      fetch(`/api/v1/drops/users/search?q=${encodeURIComponent(addMemberQuery)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("auth_token") ?? ""}` },
      })
        .then((r) => r.json())
        .then((res) => setAddMemberResults(res.data || []))
        .catch(() => setAddMemberResults([]))
        .finally(() => setIsSearchingMembers(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [showAddMember, addMemberQuery]);

  const handleAddMember = useCallback(async (userId: string) => {
    if (!conversationId) return;
    try {
      await messengerApi.addGroupMembers(conversationId, [userId]);
      const members = await messengerApi.getGroupMembers(conversationId);
      setGroupMembers(members);
      setShowAddMember(false);
      setAddMemberQuery("");
    } catch (err) {
      console.error("Failed to add member:", err);
    }
  }, [conversationId]);

  const giftImageUrl = (url?: string) => {
    if (!url) return null;
    return storageUrl("post-images", url) || url;
  };

  const handleSendGift = async () => {
    if (!selectedGift || sending) return;
    setSending(true);
    try {
      const { api } = await import("@/integrations/api/compat");
      const session = await api.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) return;

      const res = await fetch("/api/v1/gifts/send", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          gift_id: selectedGift.id,
          recipient_id: userId,
          message: message.trim() || undefined,
          is_anonymous: isAnonymous,
        }),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        const { toast } = await import("sonner");
        toast.error(result.error || "Не удалось отправить подарок");
        return;
      }

      const { toast } = await import("sonner");
      toast.success(`Подарок «${selectedGift.name}» отправлен!`);
      setMessage("");
      setIsAnonymous(false);
      setShowSendDialog(false);
      setSelectedGift(null);
    } catch {
      const { toast } = await import("sonner");
      toast.error("Ошибка отправки подарка");
    } finally {
      setSending(false);
    }
  };

  const avatarSrc = avatarUrl ? storageUrl("post-images", avatarUrl) || undefined : undefined;

  return (
    <>
      {/* Backdrop */}
      {open && <div className="user-info-panel-backdrop" onClick={onClose} />}

      {/* Panel */}
      <div className={`user-info-panel ${open ? "is-open" : ""}`}>
        <div className="user-info-panel-header">
          <span>Информация</span>
          <button type="button" className="user-info-panel-close" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>

        <div className="user-info-panel-body">
          {isGroup ? (
            <>
              {/* Group avatar */}
              <div className="user-info-avatar">
                {groupAvatarUrl ? (
                  <img src={storageUrl("post-images", groupAvatarUrl) || undefined} alt={groupName || ""} />
                ) : (
                  <span>{groupName ? groupName.slice(0, 2).toUpperCase() : "ГР"}</span>
                )}
              </div>

              {/* Group name */}
              <h3 className="user-info-name">{groupName || "Группа"}</h3>

              {/* Member count */}
              <p className="user-info-presence">
                {memberCount} участник{memberCount === 1 ? "" : memberCount < 5 ? "а" : "ов"}
              </p>

              {/* Members list */}
              <div style={{ width: "100%", marginTop: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <p className="eyebrow" style={{ margin: 0 }}>Участники</p>
                  <button
                    type="button"
                    onClick={() => setShowAddMember(!showAddMember)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: "1px solid hsl(var(--border))",
                      background: "hsl(var(--card))",
                      color: "hsl(var(--foreground))",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    <UserPlus size={12} />
                    Добавить
                  </button>
                </div>

                {showAddMember && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ position: "relative" }}>
                      <Search size={14} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "hsl(var(--muted-foreground))" }} />
                      <input
                        type="text"
                        value={addMemberQuery}
                        onChange={(e) => setAddMemberQuery(e.target.value)}
                        placeholder="Найти пользователя..."
                        autoFocus
                        style={{
                          width: "100%",
                          padding: "6px 8px 6px 28px",
                          borderRadius: 6,
                          border: "1px solid hsl(var(--input))",
                          background: "hsl(var(--background))",
                          color: "hsl(var(--foreground))",
                          fontSize: 12,
                          outline: "none",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                    {addMemberResults.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => handleAddMember(user.id)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          width: "100%",
                          padding: "6px 8px",
                          border: "none",
                          borderRadius: 6,
                          background: "transparent",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "hsl(var(--thread-hover))"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        <div className="avatar" style={{ width: 24, height: 24, fontSize: 9 }}>
                          {user.avatar_url ? (
                            <img src={storageUrl("post-images", user.avatar_url) || undefined} alt={user.username} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} />
                          ) : (
                            <span>{getInitials(user.username)}</span>
                          )}
                        </div>
                        <span style={{ fontSize: 12 }}>{user.display_name || user.username}</span>
                      </button>
                    ))}
                  </div>
                )}

                {groupMembers.map((m) => (
                  <div key={m.user_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
                    <div className="avatar small" style={{ width: 28, height: 28, fontSize: 11 }}>
                      {m.avatar_url ? (
                        <img src={storageUrl("post-images", m.avatar_url) || undefined} alt={m.username} />
                      ) : (
                        <span>{getInitials(m.username)}</span>
                      )}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{m.display_name || m.username}</span>
                      {m.role === "admin" && <span style={{ fontSize: 11, color: "hsl(var(--primary))", marginLeft: 4 }}>admin</span>}
                    </div>
                    {m.is_online && <span className="online-dot" style={{ width: 8, height: 8 }} />}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              {/* 1:1 avatar */}
              <div className="user-info-avatar">
                {avatarSrc ? (
                  <img src={avatarSrc} alt={username || ""} />
                ) : (
                  <span>{getInitials(username || "")}</span>
                )}
              </div>

              {/* Name */}
              <h3 className="user-info-name">{displayName || username}</h3>

              {/* Username */}
              {userId && username && (
                <Link to={`/profile/${userId}`} className="user-info-username" onClick={onClose}>
                  @{username}
                  <ExternalLink size={12} />
                </Link>
              )}

              {/* Presence */}
              <p className="user-info-presence">
                {formatPresence(isOnline ?? null, lastSeenAt ?? null)}
              </p>

              {/* Actions */}
              <div className="user-info-actions">
                {userId && (
                  <Link
                    to={`/profile/${userId}`}
                    className="user-info-action-btn"
                    onClick={onClose}
                  >
                    Профиль
                  </Link>
                )}
                {giftCatalog.length > 0 && (
                  <button
                    type="button"
                    className="user-info-action-btn primary"
                    onClick={() => setShowCatalog(true)}
                  >
                    <Gift size={14} />
                    Подарить
                  </button>
                )}
                {userId && (
                  <button
                    type="button"
                    className="user-info-action-btn"
                    onClick={async () => {
                      try {
                        const { startE2EChat } = await import("@/services/e2e/e2eManager");
                        const { conversationId, needsOtherUserKeys } = await startE2EChat(userId);
                        if (needsOtherUserKeys) {
                          alert("E2E чат создан. Чтобы обмениваться зашифрованными сообщениями, собеседник должен также открыть E2E чат.");
                        }
                        window.location.href = `/messages?conversation=${conversationId}`;
                        onClose();
                      } catch (err) {
                        alert((err as Error).message || "Не удалось начать E2E чат");
                      }
                    }}
                  >
                    <Lock size={14} />
                    E2E Чат
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Catalog picker dialog */}
      <Dialog open={showCatalog} onOpenChange={setShowCatalog}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader className="pr-10">
            <div className="flex items-center justify-between">
              <DialogTitle>Выберите подарок</DialogTitle>
              <DropsBalance />
            </div>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            {giftCatalog.map((gift) => (
              <button
                key={gift.id}
                onClick={() => {
                  setSelectedGift(gift);
                  setShowCatalog(false);
                  setShowSendDialog(true);
                }}
                className="flex flex-col items-center gap-2 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/50 transition-colors text-left"
              >
                <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                  {gift.image_url ? (
                    <img
                      src={giftImageUrl(gift.image_url) || gift.image_url}
                      alt={gift.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Gift className="w-8 h-8 text-muted-foreground" />
                  )}
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium">{gift.name}</p>
                  <p className="text-xs text-muted-foreground">{gift.price} {formatDropsLabel(gift.price)}</p>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Send gift dialog */}
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
                  {selectedGift.image_url ? (
                    <img src={giftImageUrl(selectedGift.image_url) || selectedGift.image_url} alt={selectedGift.name} className="w-full h-full object-cover" />
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
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Напишите что-нибудь..."
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
                  onClick={() => setIsAnonymous(!isAnonymous)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isAnonymous ? "bg-primary" : "bg-input"}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isAnonymous ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>
              <Button onClick={handleSendGift} disabled={sending} className="w-full">
                {sending ? "Отправка..." : `Отправить за ${selectedGift.price} ${formatDropsLabel(selectedGift.price)}`}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
