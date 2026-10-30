import type { ComponentType } from "react";
import { ArrowUpRight, ArrowDownLeft, Gift, Coins } from "lucide-react";
import i18n from "@/i18n";
import { getIntlLanguage } from "@/i18n/dateLocale";
import { CurrencyIcon, type CurrencyKind } from "@/components/CurrencyIcon";
import { formatGemsLabel } from "@/utils/formatGemsLabel";
import { formatDropsLabel } from "@/utils/formatDropsLabel";

export interface TransactionItemData {
  id: string;
  type: string;
  amount: number;
  balance_after: number;
  description?: string;
  reference_id?: string;
  reference_type?: string;
  blockchain?: string;
  tx_hash?: string;
  created_at: string;
}

interface TransactionItemProps {
  transaction: TransactionItemData;
  onSelect?: (tx: TransactionItemData) => void;
}

interface TxTypeConfig {
  icon?: ComponentType<{ className?: string }>;
  currency?: CurrencyKind;
  color: string;
  label: string;
}

const TYPE_CONFIG: Record<string, TxTypeConfig> = {
  transfer_send: { icon: ArrowUpRight, color: "text-red-400", label: "Отправлено" },
  transfer_receive: { icon: ArrowDownLeft, color: "text-green-400", label: "Получено" },
  purchase: { currency: "gems", color: "text-rose-400", label: "Покупка" },
  gift_send: { icon: Gift, color: "text-purple-400", label: "Подарок" },
  gift_upgrade: { icon: Gift, color: "text-purple-400", label: "Улучшение" },
  quest_reward: { currency: "drops", color: "text-amber-400", label: "Награда за квест" },
  quest_reward_gems: { currency: "gems", color: "text-rose-400", label: "Награда за квест" },
};

/** Amount label in the row's own currency: quest rewards pay drops, everything else moves gems. */
export function formatTxAmountLabel(type: string, amount: number): string {
  return type === "quest_reward"
    ? formatDropsLabel(Math.abs(amount))
    : formatGemsLabel(Math.abs(amount));
}

export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return i18n.t("time.justNow");
  if (diffMin < 60) return i18n.t("time.minutesShort", { count: diffMin });
  if (diffHour < 24) return i18n.t("time.hoursShort", { count: diffHour });
  if (diffDay < 7) return i18n.t("time.daysShort", { count: diffDay });
  return date.toLocaleDateString(getIntlLanguage(), { day: "numeric", month: "short" });
}

export function TransactionItem({ transaction, onSelect }: TransactionItemProps) {
  const config: TxTypeConfig = TYPE_CONFIG[transaction.type] || { icon: Coins, color: "text-muted-foreground", label: transaction.type };
  const Icon = config.icon;
  const isPositive = transaction.amount > 0;

  return (
    <button
      type="button"
      onClick={() => onSelect?.(transaction)}
      className="w-full flex items-center gap-3 py-3 px-1 text-left hover:bg-muted/50 transition-colors rounded-md cursor-pointer"
    >
      <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
        isPositive ? "bg-green-500/10" : "bg-red-500/10"
      }`}>
        {config.currency ? (
          <CurrencyIcon kind={config.currency} className="w-4 h-4" />
        ) : (
          Icon && <Icon className={`w-4 h-4 ${config.color}`} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{config.label}</div>
        {transaction.description && (
          <div className="text-xs text-muted-foreground truncate">{transaction.description}</div>
        )}
      </div>
      <div className="text-right flex-shrink-0">
        <div className={`text-sm font-semibold ${isPositive ? "text-green-400" : "text-red-400"}`}>
          {isPositive ? "+" : ""}{transaction.amount} {formatTxAmountLabel(transaction.type, transaction.amount)}
        </div>
        <div className="text-xs text-muted-foreground">{formatRelativeTime(transaction.created_at)}</div>
      </div>
    </button>
  );
}
