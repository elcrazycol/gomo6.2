import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Gift, Send, User } from "lucide-react";
import { storageUrl } from "@/utils/storage";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import type { GiftCatalogItem } from "@/components/GiftCard";

interface UserGiftItem {
  id: string;
  gift_id: string;
  sender_id?: string;
  recipient_id: string;
  message?: string;
  is_anonymous: boolean;
  created_at: string;
  gift_name?: string;
  gift_image_url?: string;
  gift_price?: number;
  sender_username?: string;
  sender_avatar_url?: string;
}

interface GiftsTabProps {
  userId: string;
  isOwnProfile: boolean;
  giftCatalog: GiftCatalogItem[];
  recipientUsername: string;
  onGiftSent?: () => void;
}

const formatGarmaLabel = (value: number) => {
  const abs = Math.abs(value);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return "gарма";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "gармы";
  return "gарм";
};

export function GiftsTab({ userId, isOwnProfile, giftCatalog, recipientUsername, onGiftSent }: GiftsTabProps) {
  const [gifts, setGifts] = useState<UserGiftItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [showCatalog, setShowCatalog] = useState(false);
  const [selectedCatalogGift, setSelectedCatalogGift] = useState<GiftCatalogItem | null>(null);
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [detailGift, setDetailGift] = useState<UserGiftItem | null>(null);
  const pageSize = 50;

  useEffect(() => {
    setGifts([]);
    setOffset(0);
    setHasMore(true);
    loadGifts(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const loadGifts = async (currentOffset: number) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v1/user_gifts?recipient_id=eq.${userId}&limit=${pageSize}&offset=${currentOffset}`
      );
      const result = await res.json();
      const data = result.data || [];

      if (currentOffset === 0) {
        setGifts(data);
      } else {
        setGifts((prev) => [...prev, ...data]);
      }
      setHasMore(data.length === pageSize);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const loadMore = () => {
    const nextOffset = offset + pageSize;
    setOffset(nextOffset);
    loadGifts(nextOffset);
  };

  const handleSendGift = async () => {
    if (!selectedCatalogGift || sending) return;
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
          gift_id: selectedCatalogGift.id,
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
      toast.success(`Подарок «${selectedCatalogGift.name}» отправлен!`);
      setMessage("");
      setIsAnonymous(false);
      setShowSendDialog(false);
      setSelectedCatalogGift(null);
      loadGifts(0);
      onGiftSent?.();
    } catch {
      const { toast } = await import("sonner");
      toast.error("Ошибка отправки подарка");
    } finally {
      setSending(false);
    }
  };

  const giftImageUrl = (url?: string) => {
    if (!url) return null;
    return storageUrl("post-images", url) || url;
  };

  return (
    <div className="relative">
      {/* Gift grid */}
      {loading && gifts.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <PentagramLoader size="lg" />
        </div>
      ) : gifts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Gift className="w-10 h-10 mb-3 opacity-50" />
          <p>Подарков пока нет</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-2">
            {gifts.map((gift) => {
              const img = giftImageUrl(gift.gift_image_url);
              const senderImg = !gift.is_anonymous ? giftImageUrl(gift.sender_avatar_url) : null;
              return (
                <button
                  key={gift.id}
                  onClick={() => setDetailGift(gift)}
                  className="relative aspect-square rounded-lg bg-muted border border-border hover:border-primary/50 hover:scale-105 transition-all overflow-hidden"
                >
                  {img ? (
                    <img src={img} alt={gift.gift_name || "Подарок"} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Gift className="w-6 h-6 text-muted-foreground" />
                    </div>
                  )}
                  {/* Sender avatar badge */}
                  {!gift.is_anonymous && (
                    <div className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full border border-background overflow-hidden bg-muted flex items-center justify-center">
                      {senderImg ? (
                        <img src={senderImg} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <User className="w-3 h-3 text-muted-foreground" />
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                onClick={loadMore}
                disabled={loading}
                className="text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                {loading ? "Загрузка..." : "Показать ещё"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Sticky "Подарить" button */}
      {!isOwnProfile && giftCatalog.length > 0 && (
        <div className="sticky bottom-4 left-0 right-0 pt-4 pointer-events-none">
          <div className="flex justify-center pointer-events-auto">
            <Button onClick={() => setShowCatalog(true)} className="shadow-lg">
              <Send className="w-4 h-4 mr-2" />
              Подарить
            </Button>
          </div>
        </div>
      )}

      {/* Gift detail dialog */}
      <Dialog open={!!detailGift} onOpenChange={(open) => { if (!open) setDetailGift(null); }}>
        <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
          {detailGift && (
            <>
              {/* Gift image */}
              <div className="w-full aspect-square bg-muted flex items-center justify-center">
                {giftImageUrl(detailGift.gift_image_url) ? (
                  <img
                    src={giftImageUrl(detailGift.gift_image_url)!}
                    alt={detailGift.gift_name || "Подарок"}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Gift className="w-16 h-16 text-muted-foreground" />
                )}
              </div>

              {/* Info */}
              <div className="p-4 space-y-3">
                {/* Sender */}
                {!detailGift.is_anonymous && detailGift.sender_id ? (
                  <ProfileHoverCard userId={detailGift.sender_id}>
                    <a
                      href={`/profile/${detailGift.sender_id}`}
                      onClick={(e) => e.preventDefault()}
                      className="flex items-center gap-2.5 group/sender"
                    >
                      <div className="w-8 h-8 rounded-full bg-muted overflow-hidden flex-shrink-0 border border-border">
                        {giftImageUrl(detailGift.sender_avatar_url) ? (
                          <img
                            src={giftImageUrl(detailGift.sender_avatar_url)!}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <User className="w-4 h-4 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <span className="text-sm font-medium group-hover/sender:text-primary transition-colors">
                        {detailGift.sender_username || "пользователь"}
                      </span>
                    </a>
                  </ProfileHoverCard>
                ) : (
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-muted overflow-hidden flex-shrink-0 border border-border flex items-center justify-center">
                      <User className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <span className="text-sm text-muted-foreground">Аноним</span>
                  </div>
                )}

                {/* Price */}
                {detailGift.gift_price != null && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Стоимость:</span>
                    <span className="text-sm font-medium">
                      {detailGift.gift_price} {formatGarmaLabel(detailGift.gift_price)}
                    </span>
                  </div>
                )}

                {/* Message */}
                {detailGift.message && (
                  <div className="pt-2 border-t border-border">
                    <p className="text-sm text-muted-foreground">Сообщение:</p>
                    <p className="text-sm mt-1">{detailGift.message}</p>
                  </div>
                )}

                {/* Date */}
                <p className="text-xs text-muted-foreground pt-1">
                  {formatDistanceToNow(new Date(detailGift.created_at), { addSuffix: true, locale: ru })}
                </p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Catalog picker dialog */}
      <Dialog open={showCatalog} onOpenChange={setShowCatalog}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Выберите подарок</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            {giftCatalog.map((gift) => (
              <button
                key={gift.id}
                onClick={() => {
                  setSelectedCatalogGift(gift);
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
                  <p className="text-xs text-muted-foreground">{gift.price} {formatGarmaLabel(gift.price)}</p>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Send gift dialog */}
      <Dialog open={showSendDialog} onOpenChange={setShowSendDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Отправить подарок</DialogTitle>
          </DialogHeader>
          {selectedCatalogGift && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
                <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
                  {selectedCatalogGift.image_url ? (
                    <img src={giftImageUrl(selectedCatalogGift.image_url) || selectedCatalogGift.image_url} alt={selectedCatalogGift.name} className="w-full h-full object-cover" />
                  ) : (
                    <Gift className="w-8 h-8 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <p className="font-medium">{selectedCatalogGift.name}</p>
                  <p className="text-sm text-muted-foreground">{selectedCatalogGift.price} {formatGarmaLabel(selectedCatalogGift.price)}</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Получатель: <span className="text-foreground font-medium">@{recipientUsername}</span>
              </p>
              <div>
                <label className="text-sm font-medium" htmlFor="gift-msg">Сообщение</label>
                <input
                  id="gift-msg"
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
                {sending ? "Отправка..." : `Отправить за ${selectedCatalogGift.price} ${formatGarmaLabel(selectedCatalogGift.price)}`}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
