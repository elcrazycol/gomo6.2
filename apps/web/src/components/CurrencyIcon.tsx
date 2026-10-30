import { Coins, Gem } from "lucide-react";
import { cn } from "@/lib/utils";

export type CurrencyKind = "gems" | "drops";

/**
 * The single currency glyph used everywhere money appears: a ruby for the
 * rare paid gems, a gold coin for the mass earnable drops. The glow mirrors
 * the trophy tier halos so rare money reads as rare at a glance.
 */
const STYLES: Record<CurrencyKind, { icon: typeof Gem; className: string; glow: string }> = {
  gems: {
    icon: Gem,
    className: "text-rose-400",
    glow: "drop-shadow(0 0 5px rgba(244,63,94,0.55))",
  },
  drops: {
    icon: Coins,
    className: "text-amber-400",
    glow: "drop-shadow(0 0 5px rgba(251,191,36,0.5))",
  },
};

export function CurrencyIcon({ kind, className }: { kind: CurrencyKind; className?: string }) {
  const s = STYLES[kind];
  const Icon = s.icon;
  return <Icon aria-hidden className={cn(s.className, className)} style={{ filter: s.glow }} />;
}
