import { useState, useEffect } from "react";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Gift, Send, User, Sparkles } from "lucide-react";
import { DropsBalance } from "@/components/DropsBalance";
import { storageUrl } from "@/utils/storage";
import type { GiftCatalogItem } from "@/components/GiftCard";
import { UpgradedGiftCard } from "@/components/UpgradedGiftCard";
import { GiftDetailPanel } from "@/components/GiftDetailPanel";
import { formatDropsLabel } from "@/utils/formatDropsLabel";
import { toast } from "sonner";

interface UserGiftItem {
  id: string;
  gift_id: string;
  sender_id?: string;
  recipient_id: string;
  message?: string;
  is_anonymous: boolean;
  created_at: string;
  is_upgraded: boolean;
  gift_layer_id?: string;
  background_layer_id?: string;
  symbol_layer_id?: string;
  upgraded_at?: string;
  gift_layer_image_url?: string;
  background_layer_image_url?: string;
  symbol_layer_image_url?: string;
  gift_layer_rarity?: number;
  background_layer_rarity?: number;
  symbol_layer_rarity?: number;
  gift_name?: string;
  gift_image_url?: string;
  gift_price?: number;
  is_gift_upgradable?: boolean;
  gift_upgrade_cost?: number;
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

export function GiftsTab({ userId, isOwnProfile, giftCatalog, recipientUsername, onGiftSent }: GiftsTabProps) {
  const [gifts, setGifts] = useState<UserGiftItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [showCatalog, setShowCatalog] = useState(false);
  const [selectedCatalogGift, setSelectedCatalogGift] = useState<GiftCatalogItem | null>(null);
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [sending, setSending] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
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

  const handleUpgrade = async () => {
    if (!detailGift || upgrading) return;
    setUpgrading(true);
    try {
      const { api } = await import("@/integrations/api/compat");
      const session = await api.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        toast.error("Необходима авторизация");
        setUpgrading(false);
        return;
      }

      const res = await fetch(`/api/v1/gifts/${detailGift.id}/upgrade`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        toast.error(result.error || "Не удалось улучшить подарок");
        setUpgrading(false);
        return;
      }

      toast.success(`Подарок «${detailGift.gift_name || "?"}» улучшен!`);
      setDetailGift(null);
      loadGifts(0);
    } catch {
      toast.error("Ошибка улучшения");
    } finally {
      setUpgrading(false);
    }
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
          Authorization: `Bearer ${token}`,
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
        toast.error(result.error || "Не удалось отправить подарок");
        return;
      }

      toast.success(`Подарок «${selectedCatalogGift.name}» отправлен!`);
      setMessage("");
      setIsAnonymous(false);
      setShowSendDialog(false);
      setSelectedCatalogGift(null);
      loadGifts(0);
      onGiftSent?.();
    } catch {
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
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-1.5 sm:gap-2">
            {gifts.map((gift) => {
              const senderImg = !gift.is_anonymous ? giftImageUrl(gift.sender_avatar_url) : null;
              // Use UpgradedGiftCard for upgraded or upgradable gifts
              if (gift.is_upgraded || gift.is_gift_upgradable) {
                return (
                  <button
                    key={gift.id}
                    onClick={() => setDetailGift(gift)}
                    className="relative"
                  >
                    <UpgradedGiftCard
                      id={gift.id}
                      giftId={gift.gift_id}
                      isUpgraded={gift.is_upgraded}
                      isUpgradable={gift.is_gift_upgradable || false}
                      giftLayerImageUrl={gift.gift_layer_image_url}
                      backgroundLayerImageUrl={gift.background_layer_image_url}
                      symbolLayerImageUrl={gift.symbol_layer_image_url}
                      giftLayerRarity={gift.gift_layer_rarity}
                      backgroundLayerRarity={gift.background_layer_rarity}
                      symbolLayerRarity={gift.symbol_layer_rarity}
                      fallbackImageUrl={gift.gift_image_url}
                      giftName={gift.gift_name}
                    />
                    {!gift.is_anonymous && (
                      <div className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full border border-background overflow-hidden bg-muted flex items-center justify-center z-10">
                        {senderImg ? (
                          <img src={senderImg} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <User className="w-3 h-3 text-muted-foreground" />
                        )}
                      </div>
                    )}
                  </button>
                );
              }

              // Regular static gift
              const img = giftImageUrl(gift.gift_image_url);
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
        <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
          {detailGift && (
            <GiftDetailPanel
              isUpgraded={detailGift.is_upgraded}
              isUpgradable={detailGift.is_gift_upgradable}
              giftLayerImageUrl={detailGift.gift_layer_image_url}
              backgroundLayerImageUrl={detailGift.background_layer_image_url}
              symbolLayerImageUrl={detailGift.symbol_layer_image_url}
              giftLayerRarity={detailGift.gift_layer_rarity}
              backgroundLayerRarity={detailGift.background_layer_rarity}
              symbolLayerRarity={detailGift.symbol_layer_rarity}
              giftImageUrl={giftImageUrl(detailGift.gift_image_url)}
              giftName={detailGift.gift_name}
              senderId={detailGift.sender_id}
              senderUsername={detailGift.sender_username}
              senderAvatarUrl={giftImageUrl(detailGift.sender_avatar_url)}
              isAnonymous={detailGift.is_anonymous}
              price={detailGift.gift_price}
              message={detailGift.message}
              createdAt={detailGift.created_at}
              onUpgrade={handleUpgrade}
              upgradeCost={detailGift.gift_upgrade_cost}
              upgrading={upgrading}
              isOwnProfile={isOwnProfile}
            />
          )}
        </DialogContent>
      </Dialog>

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
                  setSelectedCatalogGift(gift);
                  setShowCatalog(false);
                  setShowSendDialog(true);
                }}
                className="flex flex-col items-center gap-2 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/50 transition-colors text-left"
              >
                <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center overflow-hidden relative">
                  {gift.image_url ? (
                    <img
                      src={giftImageUrl(gift.image_url) || gift.image_url}
                      alt={gift.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Gift className="w-8 h-8 text-muted-foreground" />
                  )}
                  {gift.is_upgradable && (
                    <div className="absolute top-0 right-0 w-4 h-4 bg-amber-500 rounded-bl-lg flex items-center justify-center">
                      <Sparkles className="w-2.5 h-2.5 text-white" />
                    </div>
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
          {selectedCatalogGift && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
                <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center overflow-hidden flex-shrink-0 relative">
                  {selectedCatalogGift.image_url ? (
                    <img src={giftImageUrl(selectedCatalogGift.image_url) || selectedCatalogGift.image_url} alt={selectedCatalogGift.name} className="w-full h-full object-cover" />
                  ) : (
                    <Gift className="w-8 h-8 text-muted-foreground" />
                  )}
                  {selectedCatalogGift.is_upgradable && (
                    <div className="absolute top-0 right-0 w-4 h-4 bg-amber-500 rounded-bl-lg flex items-center justify-center">
                      <Sparkles className="w-2.5 h-2.5 text-white" />
                    </div>
                  )}
                </div>
                <div>
                  <p className="font-medium">{selectedCatalogGift.name}</p>
                  <p className="text-sm text-muted-foreground">{selectedCatalogGift.price} {formatDropsLabel(selectedCatalogGift.price)}</p>
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
                {sending ? "Отправка..." : `Отправить за ${selectedCatalogGift.price} ${formatDropsLabel(selectedCatalogGift.price)}`}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
