import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ArrowUpRight, ArrowDownLeft, ShoppingCart, Gift, Droplets, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/integrations/api/compat";
import { formatDropsLabel } from "@/utils/formatDropsLabel";
import type { TransactionItemData } from "./TransactionItem";

interface TransactionDetailProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: TransactionItemData | null;
}

const TYPE_CONFIG: Record<string, { icon: typeof ArrowUpRight; color: string; label: string; bg: string }> = {
  transfer_send: { icon: ArrowUpRight, color: "text-red-400", label: "Перевод отправлен", bg: "bg-red-500/10" },
  transfer_receive: { icon: ArrowDownLeft, color: "text-green-400", label: "Перевод получен", bg: "bg-green-500/10" },
  purchase: { icon: ShoppingCart, color: "text-blue-400", label: "Покупка дропсов", bg: "bg-blue-500/10" },
  gift_send: { icon: Gift, color: "text-purple-400", label: "Подарок отправлен", bg: "bg-purple-500/10" },
};

function formatFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("ru-RU", {
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
  const [counterparty, setCounterparty] = useState<{ username: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !transaction?.reference_id || transaction.reference_type !== "user") return;

    let cancelled = false;
    (async () => {
      try {
        const session = await api.auth.getSession();
        const token = session.data.session?.access_token;
        if (!token) return;
        const res = await fetch(`/api/v1/profiles/${transaction.reference_id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!cancelled && data.success && data.data) {
          setCounterparty({ username: data.data.username });
        }
      } catch { /* silent */ }
    })();

    return () => { cancelled = true; };
  }, [open, transaction?.reference_id, transaction?.reference_type]);

  useEffect(() => {
    if (!open) {
      setCounterparty(null);
      setCopied(false);
    }
  }, [open]);

  if (!transaction) return null;

  const config = TYPE_CONFIG[transaction.type] || { icon: Droplets, color: "text-muted-foreground", label: transaction.type, bg: "bg-muted" };
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[80vh] overflow-y-auto">
        <SheetHeader className="mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${config.bg}`}>
              <Icon className={`w-6 h-6 ${config.color}`} />
            </div>
            <div>
              <SheetTitle className="text-base">{config.label}</SheetTitle>
              <p className="text-xs text-muted-foreground">{formatFullDate(transaction.created_at)}</p>
            </div>
          </div>
        </SheetHeader>

        {/* Amount */}
        <div className="text-center py-4">
          <p className={`text-3xl font-bold ${isPositive ? "text-green-400" : "text-red-400"}`}>
            {isPositive ? "+" : ""}{transaction.amount}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {formatDropsLabel(Math.abs(transaction.amount))}
          </p>
        </div>

        {/* Details */}
        <div className="divide-y divide-border border-t">
          <DetailRow label="Баланс после" value={`${transaction.balance_after} ${formatDropsLabel(transaction.balance_after)}`} />

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
      </SheetContent>
    </Sheet>
  );
}
