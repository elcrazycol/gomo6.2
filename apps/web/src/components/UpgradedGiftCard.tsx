import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { formatDropsLabel } from "@/utils/formatDropsLabel";

interface UpgradedGiftCardProps {
  id: string;
  giftId: string;
  isUpgraded: boolean;
  isUpgradable: boolean;
  upgradeCost?: number | null;
  giftLayerImageUrl?: string | null;
  backgroundLayerImageUrl?: string | null;
  symbolLayerImageUrl?: string | null;
  giftLayerRarity?: number | null;
  backgroundLayerRarity?: number | null;
  symbolLayerRarity?: number | null;
  fallbackImageUrl?: string;
  giftName?: string;
  onUpgraded?: () => void;
}

export function UpgradedGiftCard({
  id,
  giftId,
  isUpgraded,
  isUpgradable,
  upgradeCost,
  giftLayerImageUrl,
  backgroundLayerImageUrl,
  symbolLayerImageUrl,
  giftLayerRarity,
  backgroundLayerRarity,
  symbolLayerRarity,
  fallbackImageUrl,
  giftName,
  onUpgraded,
}: UpgradedGiftCardProps) {
  const [upgrading, setUpgrading] = useState(false);
  const [hovered, setHovered] = useState(false);

  const resolveUrl = (url?: string | null) => {
    if (!url) return null;
    if (url.startsWith("http")) return url;
    return `/api/v1/storage/v1/object/gift-layers/${url}`;
  };

  const handleUpgrade = async () => {
    if (upgrading) return;
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

      const res = await fetch(`/api/v1/gifts/${id}/upgrade`, {
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

      toast.success(`Подарок «${giftName || "?"}» улучшен!`);
      onUpgraded?.();
    } catch {
      toast.error("Ошибка улучшения");
    } finally {
      setUpgrading(false);
    }
  };

  // If not upgraded and not upgradable, just show fallback (regular gift)
  if (!isUpgraded && !isUpgradable) {
    return (
      <div className="relative aspect-square rounded-lg bg-muted border border-border overflow-hidden">
        {fallbackImageUrl ? (
          <img src={resolveUrl(fallbackImageUrl)} alt={giftName || "Подарок"} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">🎁</div>
        )}
      </div>
    );
  }

  // Not upgraded but upgradable — show base image with upgrade button
  if (!isUpgraded && isUpgradable) {
    return (
      <div
        className="relative aspect-square rounded-lg bg-muted border border-border overflow-hidden group"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {fallbackImageUrl ? (
          <img src={resolveUrl(fallbackImageUrl)} alt={giftName || "Подарок"} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-3xl">🎁</div>
        )}

        {/* Upgrade overlay */}
        <div className={`absolute inset-0 flex flex-col items-center justify-center bg-background/80 transition-opacity ${hovered ? "opacity-100" : "opacity-0"}`}>
          <Sparkles className="w-5 h-5 text-amber-500 mb-1" />
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs gap-1"
            disabled={upgrading}
            onClick={(e) => { e.stopPropagation(); handleUpgrade(); }}
          >
            {upgrading ? "..." : `Улучшить за ${upgradeCost || "?"} ${formatDropsLabel(upgradeCost || 0)}`}
          </Button>
        </div>

        {/* Indicator that it can be upgraded */}
        <div className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-amber-500/90 flex items-center justify-center">
          <Sparkles className="w-2.5 h-2.5 text-white" />
        </div>
      </div>
    );
  }

  // Upgraded — show 3-layer animated composition
  const giftImg = resolveUrl(giftLayerImageUrl);
  const bgImg = resolveUrl(backgroundLayerImageUrl);
  const symImg = resolveUrl(symbolLayerImageUrl);

  return (
    <div
      className="relative aspect-square rounded-lg border border-amber-500/30 overflow-hidden group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Layers */}
      <div className="absolute inset-0">
        {/* Background layer */}
        {bgImg && (
          <div className="absolute inset-0" style={{ zIndex: 1 }}>
            <img src={bgImg} alt="фон" className="w-full h-full object-cover" />
          </div>
        )}
        {/* Gift layer */}
        {giftImg && (
          <div
            className="absolute inset-0 transition-transform duration-500"
            style={{
              zIndex: 2,
              transform: hovered ? "scale(1.05)" : "scale(1)",
            }}
          >
            <img src={giftImg} alt={giftName || "подарок"} className="w-full h-full object-contain" />
          </div>
        )}
        {/* Symbol layer — animated float */}
        {symImg && (
          <div
            className="absolute inset-0"
            style={{
              zIndex: 3,
              animation: hovered ? "float-symbol 2s ease-in-out infinite" : "none",
            }}
          >
            <img src={symImg} alt="символ" className="w-full h-full object-contain" />
          </div>
        )}
      </div>

      {/* Rarity badges (hover) */}
      <div className={`absolute bottom-0 left-0 right-0 flex justify-center gap-1 p-1 transition-opacity ${hovered ? "opacity-100" : "opacity-0"}`}>
        {giftLayerRarity != null && (
          <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-pink-500/80 text-white font-medium">
            {giftLayerRarity}%
          </span>
        )}
        {backgroundLayerRarity != null && (
          <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-blue-500/80 text-white font-medium">
            {backgroundLayerRarity}%
          </span>
        )}
        {symbolLayerRarity != null && (
          <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-amber-500/80 text-white font-medium">
            {symbolLayerRarity}%
          </span>
        )}
      </div>

      {/* Sparkle indicator */}
      <div className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
        <Sparkles className="w-2 h-2 text-white" />
      </div>
    </div>
  );
}
