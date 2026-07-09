import { Sparkles } from "lucide-react";
import { storageUrl } from "@/utils/storage";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { User } from "lucide-react";
import { formatDropsLabel } from "@/utils/formatDropsLabel";

interface GiftDetailPanelProps {
  isUpgraded: boolean;
  isUpgradable?: boolean;
  giftLayerImageUrl?: string | null;
  backgroundLayerImageUrl?: string | null;
  symbolLayerImageUrl?: string | null;
  giftLayerRarity?: number | null;
  backgroundLayerRarity?: number | null;
  symbolLayerRarity?: number | null;
  giftImageUrl?: string | null;
  giftName?: string;
  senderId?: string;
  senderUsername?: string;
  senderAvatarUrl?: string | null;
  isAnonymous: boolean;
  price?: number;
  message?: string;
  createdAt: string;
  onUpgrade?: () => void;
  upgradeCost?: number;
  upgrading?: boolean;
  isOwnProfile?: boolean;
}

const resolveUrl = (url?: string | null) => {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return storageUrl("gift-layers", url);
};

export function GiftDetailPanel({
  isUpgraded,
  isUpgradable,
  giftLayerImageUrl,
  backgroundLayerImageUrl,
  symbolLayerImageUrl,
  giftLayerRarity,
  backgroundLayerRarity,
  symbolLayerRarity,
  giftImageUrl,
  giftName,
  senderId,
  senderUsername,
  senderAvatarUrl,
  isAnonymous,
  price,
  message,
  createdAt,
  onUpgrade,
  upgradeCost,
  upgrading,
  isOwnProfile,
}: GiftDetailPanelProps) {
  const bgUrl = resolveUrl(backgroundLayerImageUrl);
  const symUrl = resolveUrl(symbolLayerImageUrl);
  const giftUrl = isUpgraded ? resolveUrl(giftLayerImageUrl) : giftImageUrl;
  const showUpgrade = !isUpgraded && isUpgradable && isOwnProfile && onUpgrade;

  return (
    <div>
      {/* Gift presentation area */}
      <div
        className="relative w-full overflow-hidden"
        style={{ aspectRatio: "1 / 1" }}
      >
        {/* Layer 0: Background or gradient */}
        {bgUrl ? (
          <img
            src={bgUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-muted via-background to-muted" />
        )}

        {/* Layer 1: Tiled symbol pattern */}
        {symUrl && (
          <div
            className="absolute inset-0 z-[1]"
            style={{
              backgroundImage: `url(${symUrl})`,
              backgroundRepeat: "repeat",
              backgroundSize: "80px 80px",
              backgroundPosition: "center",
              opacity: 0.35,
            }}
          />
        )}

        {/* Layer 2: Gift image (centered) */}
        {giftUrl ? (
          <img
            src={giftUrl}
            alt={giftName || "Подарок"}
            className="absolute inset-0 w-full h-full object-contain z-[2] p-8"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center z-[2]">
            <span className="text-7xl">🎁</span>
          </div>
        )}

        {/* Sparkle badge (upgraded) */}
        {isUpgraded && (
          <div className="absolute top-3 right-3 w-7 h-7 rounded-full bg-amber-500/90 flex items-center justify-center z-10 shadow-lg">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
        )}

        {/* Rarity badges (upgraded, bottom) */}
        {isUpgraded && (giftLayerRarity != null || backgroundLayerRarity != null || symbolLayerRarity != null) && (
          <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-2 z-10">
            {giftLayerRarity != null && (
              <span className="text-xs font-medium bg-background/80 backdrop-blur-sm px-2 py-0.5 rounded-full text-primary/80">
                Gift {giftLayerRarity}%
              </span>
            )}
            {backgroundLayerRarity != null && (
              <span className="text-xs font-medium bg-background/80 backdrop-blur-sm px-2 py-0.5 rounded-full text-primary/80">
                BG {backgroundLayerRarity}%
              </span>
            )}
            {symbolLayerRarity != null && (
              <span className="text-xs font-medium bg-background/80 backdrop-blur-sm px-2 py-0.5 rounded-full text-primary/80">
                Symbol {symbolLayerRarity}%
              </span>
            )}
          </div>
        )}
      </div>

      {/* Info section */}
      <div className="p-5 space-y-4">
        {/* Gift name */}
        {giftName && (
          <h3 className="text-lg font-semibold text-center">{giftName}</h3>
        )}

        {/* Sender */}
        {senderId && !isAnonymous ? (
          <ProfileHoverCard userId={senderId}>
            <a
              href={`/profile/${senderId}`}
              onClick={(e) => e.preventDefault()}
              className="flex items-center gap-3 group/sender"
            >
              <div className="w-9 h-9 rounded-full bg-muted overflow-hidden flex-shrink-0 border border-border">
                {senderAvatarUrl ? (
                  <img
                    src={senderAvatarUrl}
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
                {senderUsername || "пользователь"}
              </span>
            </a>
          </ProfileHoverCard>
        ) : (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-muted overflow-hidden flex-shrink-0 border border-border flex items-center justify-center">
              <User className="w-4 h-4 text-muted-foreground" />
            </div>
            <span className="text-sm text-muted-foreground">Аноним</span>
          </div>
        )}

        {/* Price */}
        {price != null && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Стоимость:</span>
            <span className="text-sm font-medium">
              {price} {formatDropsLabel(price)}
            </span>
          </div>
        )}

        {/* Message */}
        {message && (
          <div className="pt-3 border-t border-border">
            <p className="text-sm text-muted-foreground">Сообщение:</p>
            <p className="text-sm mt-1.5">{message}</p>
          </div>
        )}

        {/* Date */}
        <p className="text-xs text-muted-foreground pt-1">
          {formatDistanceToNow(new Date(createdAt), { addSuffix: true, locale: ru })}
        </p>

        {/* Upgrade button */}
        {showUpgrade && (
          <button
            onClick={onUpgrade}
            disabled={upgrading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 hover:bg-amber-500/20 transition-colors text-sm font-medium"
          >
            <Sparkles className="w-4 h-4" />
            {upgrading
              ? "Улучшение..."
              : `Улучшить за ${upgradeCost ?? "?"} ${formatDropsLabel(upgradeCost ?? 0)}`}
          </button>
        )}
      </div>
    </div>
  );
}
