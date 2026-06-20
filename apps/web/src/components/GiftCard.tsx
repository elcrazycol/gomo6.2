import { storageUrl } from "@/utils/storage";
import { Gift } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { formatDropsLabel } from "@/utils/formatDropsLabel";

export interface GiftCatalogItem {
  id: string;
  name: string;
  description?: string;
  image_url: string;
  price: number;
  category: string;
  is_active: boolean;
  is_limited: boolean;
  max_quantity?: number;
  sold_count: number;
  sort_order: number;
}

export interface UserGiftItem {
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
}

interface GiftCardProps {
  gift: GiftCatalogItem | UserGiftItem;
  variant?: "catalog" | "received";
  onSend?: (gift: GiftCatalogItem) => void;
}

export function GiftCard({ gift, variant = "catalog", onSend }: GiftCardProps) {
  const isCatalog = variant === "catalog" && "price" in gift && !("gift_price" in gift);
  const catalogGift = isCatalog ? (gift as GiftCatalogItem) : null;
  const userGift = !isCatalog ? (gift as UserGiftItem) : null;

  const imageUrl = isCatalog
    ? storageUrl("post-images", catalogGift!.image_url) || catalogGift!.image_url
    : storageUrl("post-images", userGift!.gift_image_url || "") || userGift!.gift_image_url || "";
  const name = isCatalog ? catalogGift!.name : userGift!.gift_name || "Подарок";
  const price = isCatalog ? catalogGift!.price : userGift!.gift_price || 0;

  return (
    <div className="flex items-center gap-3 p-3 bg-post-header border border-border rounded-lg hover:border-primary/30 transition-colors">
      <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
        {imageUrl ? (
          <img src={imageUrl} alt={name} className="w-full h-full object-cover" />
        ) : (
          <Gift className="w-6 h-6 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{name}</p>
        {variant === "received" && userGift && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>от</span>
            <span className="font-medium text-foreground">
              {userGift.is_anonymous ? "Аноним" : `@${userGift.sender_username || "пользователь"}`}
            </span>
            {userGift.message && (
              <span className="truncate">— {userGift.message}</span>
            )}
          </div>
        )}
        {variant === "received" && userGift && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatDistanceToNow(new Date(userGift.created_at), { addSuffix: true, locale: ru })}
          </p>
        )}
        {isCatalog && catalogGift && (
          <p className="text-xs text-muted-foreground">
            {price} {formatDropsLabel(price)}
            {catalogGift.is_limited && (
              <span className="ml-1 text-amber-500">·Limited</span>
            )}
          </p>
        )}
      </div>
      {isCatalog && onSend && (
        <button
          onClick={() => onSend(catalogGift!)}
          className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors flex-shrink-0"
        >
          Отправить
        </button>
      )}
    </div>
  );
}
