import { useState } from "react";
import { Sparkles } from "lucide-react";
import { storageUrl } from "@/utils/storage";

interface UpgradedGiftCardProps {
  id: string;
  giftId: string;
  isUpgraded: boolean;
  isUpgradable: boolean;
  giftLayerImageUrl?: string | null;
  backgroundLayerImageUrl?: string | null;
  symbolLayerImageUrl?: string | null;
  giftLayerRarity?: number | null;
  backgroundLayerRarity?: number | null;
  symbolLayerRarity?: number | null;
  fallbackImageUrl?: string;
  giftName?: string;
}

/**
 * Renders a gift card with optional layered composition for upgraded gifts.
 * Does NOT include upgrade button — that's handled by the dialog in GiftsTab.
 */
export function UpgradedGiftCard({
  id: _id,
  giftId: _giftId,
  isUpgraded,
  isUpgradable,
  giftLayerImageUrl,
  backgroundLayerImageUrl,
  symbolLayerImageUrl,
  giftLayerRarity,
  backgroundLayerRarity,
  symbolLayerRarity,
  fallbackImageUrl,
  giftName,
}: UpgradedGiftCardProps) {
  const [hovered, setHovered] = useState(false);

  const resolveUrl = (url?: string | null) => {
    if (!url) return null;
    if (url.startsWith("http")) return url;
    return storageUrl("gift-layers", url);
  };

  // Base gift images are in post-images bucket, not gift-layers
  const baseImg = fallbackImageUrl
    ? storageUrl("post-images", fallbackImageUrl) || fallbackImageUrl
    : null;

  // Upgraded — 3-layer composition
  if (isUpgraded) {
    const giftImg = resolveUrl(giftLayerImageUrl);
    const bgImg = resolveUrl(backgroundLayerImageUrl);
    const symImg = resolveUrl(symbolLayerImageUrl);

    return (
      <div
        className="relative aspect-square rounded-lg border border-amber-500/20 overflow-hidden group"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Layers */}
        <div className="absolute inset-0">
          {bgImg && (
            <div className="absolute inset-0" style={{ zIndex: 1 }}>
              <img src={bgImg} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          {giftImg && (
            <div
              className="absolute inset-0 transition-transform duration-700 ease-out"
              style={{
                zIndex: 2,
                transform: hovered ? "scale(1.03)" : "scale(1)",
              }}
            >
              <img src={giftImg} alt={giftName || ""} className="w-full h-full object-contain" />
            </div>
          )}
          {symImg && (
            <div
              className="absolute inset-0 transition-opacity duration-500"
              style={{
                zIndex: 3,
                opacity: hovered ? 1 : 0.85,
              }}
            >
              <img src={symImg} alt="" className="w-full h-full object-contain" />
            </div>
          )}
        </div>

        {/* Sparkle indicator */}
        <div className="absolute top-1 right-1 w-3 h-3 rounded-full bg-amber-500/90 flex items-center justify-center z-10">
          <Sparkles className="w-1.5 h-1.5 text-white" />
        </div>

        {/* Rarity — minimal, only on hover */}
        <div
          className={`absolute bottom-0 left-0 right-0 p-1 flex justify-center gap-1.5 transition-opacity duration-200 z-10 ${
            hovered ? "opacity-100" : "opacity-0"
          }`}
        >
          {giftLayerRarity != null && (
            <span className="text-[9px] text-primary/80 font-medium bg-background/70 px-1 rounded">
              {giftLayerRarity}%
            </span>
          )}
          {backgroundLayerRarity != null && (
            <span className="text-[9px] text-primary/80 font-medium bg-background/70 px-1 rounded">
              {backgroundLayerRarity}%
            </span>
          )}
          {symbolLayerRarity != null && (
            <span className="text-[9px] text-primary/80 font-medium bg-background/70 px-1 rounded">
              {symbolLayerRarity}%
            </span>
          )}
        </div>
      </div>
    );
  }

  // Upgradable but not yet upgraded — show base image with sparkle indicator
  if (isUpgradable) {
    return (
      <div className="relative aspect-square rounded-lg bg-muted border border-border overflow-hidden">
        {baseImg ? (
          <img src={baseImg} alt={giftName || ""} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-3xl">🎁</div>
        )}
        <div className="absolute top-1 right-1 w-3 h-3 rounded-full bg-amber-500/90 flex items-center justify-center z-10">
          <Sparkles className="w-1.5 h-1.5 text-white" />
        </div>
      </div>
    );
  }

  // Regular static gift
  return (
    <div className="relative aspect-square rounded-lg bg-muted border border-border overflow-hidden">
      {baseImg ? (
        <img src={baseImg} alt={giftName || ""} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-3xl">🎁</div>
      )}
    </div>
  );
}
