import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { X, Gift, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropsBalance } from "@/components/DropsBalance";
import { storageUrl } from "@/utils/storage";
import { formatPresence, getInitials } from "./utils";
import type { GiftCatalogItem } from "@/components/GiftCard";
import { formatDropsLabel } from "@/utils/formatDropsLabel";

interface Props {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  userId: string;
  username: string;
  displayName?: string | null;
  avatarUrl: string | null;
  isOnline: boolean | null;
  lastSeenAt: string | null;
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
}: Props) {
  const [giftCatalog, setGiftCatalog] = useState<GiftCatalogItem[]>([]);
  const [showCatalog, setShowCatalog] = useState(false);
  const [selectedGift, setSelectedGift] = useState<GiftCatalogItem | null>(null);
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [message, setMessage] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/v1/gift_catalog")
      .then((r) => r.json())
      .then((res) => setGiftCatalog(res.data || []))
      .catch(() => {});
  }, [open]);

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
          {/* Avatar */}
          <div className="user-info-avatar">
            {avatarSrc ? (
              <img src={avatarSrc} alt={username} />
            ) : (
              <span>{getInitials(username)}</span>
            )}
          </div>

          {/* Name */}
          <h3 className="user-info-name">{displayName || username}</h3>

          {/* Username */}
          <Link to={`/profile/${userId}`} className="user-info-username" onClick={onClose}>
            @{username}
            <ExternalLink size={12} />
          </Link>

          {/* Presence */}
          <p className="user-info-presence">
            {formatPresence(isOnline, lastSeenAt)}
          </p>

          {/* Actions */}
          <div className="user-info-actions">
            <Link
              to={`/profile/${userId}`}
              className="user-info-action-btn"
              onClick={onClose}
            >
              Профиль
            </Link>
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
          </div>
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
