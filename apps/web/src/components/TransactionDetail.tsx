import type { ComponentType } from "react";
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowUpRight, ArrowDownLeft, Gift, Coins, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { useProfileCache } from "@/contexts/ProfileCacheContext";
import { CurrencyIcon, type CurrencyKind } from "@/components/CurrencyIcon";
import { formatTxAmountLabel } from "./TransactionItem";
import { getIntlLanguage } from "@/i18n/dateLocale";
import type { TransactionItemData } from "./TransactionItem";

interface TransactionDetailProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: TransactionItemData | null;
}

interface TxDetailTypeConfig {
  icon?: ComponentType<{ className?: string }>;
  currency?: CurrencyKind;
  color: string;
  label: string;
  bg: string;
}

const TYPE_CONFIG: Record<string, TxDetailTypeConfig> = {
  transfer_send: { icon: ArrowUpRight, color: "text-red-400", label: "Перевод отправлен", bg: "bg-red-500/10" },
  transfer_receive: { icon: ArrowDownLeft, color: "text-green-400", label: "Перевод получен", bg: "bg-green-500/10" },
  purchase: { currency: "gems", color: "text-rose-400", label: "Покупка гемов", bg: "bg-rose-500/10" },
  gift_send: { icon: Gift, color: "text-purple-400", label: "Подарок отправлен", bg: "bg-purple-500/10" },
  gift_upgrade: { icon: Gift, color: "text-purple-400", label: "Улучшение подарка", bg: "bg-purple-500/10" },
  quest_reward: { currency: "drops", color: "text-amber-400", label: "Награда за квест", bg: "bg-amber-500/10" },
  quest_reward_gems: { currency: "gems", color: "text-rose-400", label: "Награда за квест", bg: "bg-rose-500/10" },
};

function formatFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString(getIntlLanguage(), {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm text-right ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}

export function TransactionDetail({ open, onOpenChange, transaction }: TransactionDetailProps) {
  const { loadProfile } = useProfileCache();
  const [counterparty, setCounterparty] = useState<{ username: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !transaction?.reference_id || transaction.reference_type !== "user") return;

    let cancelled = false;
    (async () => {
      try {
        // Goes through ProfileCacheContext (5 min TTL), so reopening the same
        // transaction dialog reuses the cached profile instead of a fresh fetch.
        const profile = await loadProfile(transaction.reference_id);
        if (!cancelled && profile.username) {
          setCounterparty({ username: profile.username });
        }
      } catch { /* silent */ }
    })();

    return () => { cancelled = true; };
  }, [open, transaction?.reference_id, transaction?.reference_type, loadProfile]);

  useEffect(() => {
    if (!open) {
      setCounterparty(null);
      setCopied(false);
    }
  }, [open]);

  if (!transaction) return null;

  const config: TxDetailTypeConfig = TYPE_CONFIG[transaction.type] || { icon: Coins, color: "text-muted-foreground", label: transaction.type, bg: "bg-muted" };
  const Icon = config.icon;
  const isPositive = transaction.amount > 0;

  const handleCopyHash = async () => {
    if (!transaction.tx_hash) return;
    await navigator.clipboard.writeText(transaction.tx_hash);
    setCopied(true);
    toast.success("Хэш скопирован");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${config.bg}`}>
              {config.currency ? (
                <CurrencyIcon kind={config.currency} className="w-5 h-5" />
              ) : (
                Icon && <Icon className={`w-5 h-5 ${config.color}`} />
              )}
            </div>
            <div>
              <DialogTitle className="text-base">{config.label}</DialogTitle>
              <p className="text-xs text-muted-foreground">{formatFullDate(transaction.created_at)}</p>
            </div>
          </div>
        </DialogHeader>

        {/* Amount */}
        <div className="text-center py-3">
          <p className={`text-3xl font-bold ${isPositive ? "text-green-400" : "text-red-400"}`}>
            {isPositive ? "+" : ""}{transaction.amount}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {formatTxAmountLabel(transaction.type, transaction.amount)}
          </p>
        </div>

        {/* Details */}
        <div className="divide-y divide-border border-t">
          <DetailRow label="Баланс после" value={`${transaction.balance_after} ${formatTxAmountLabel(transaction.type, transaction.balance_after)}`} />

          {counterparty && (
            <DetailRow
              label={isPositive ? "От кого" : "Кому"}
              value={`@${counterparty.username}`}
            />
          )}

          {transaction.description && (
            <DetailRow label="Комментарий" value={transaction.description} />
          )}

          {transaction.blockchain && (
            <DetailRow label="Блокчейн" value={transaction.blockchain} />
          )}

          {transaction.tx_hash && (
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-muted-foreground">Tx Hash</span>
              <div className="flex items-center gap-1.5">
                <code className="text-xs font-mono text-muted-foreground truncate max-w-[180px]">{transaction.tx_hash}</code>
                <button type="button" onClick={handleCopyHash} className="p-1 rounded hover:bg-muted transition-colors">
                  {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                </button>
              </div>
            </div>
          )}

          <DetailRow label="ID операции" value={transaction.id.slice(0, 8)} mono />
        </div>
      </DialogContent>
    </Dialog>
  );
}
