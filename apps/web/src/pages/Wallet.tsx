import { useState, useEffect, useCallback } from "react";
import { ArrowRight, Copy, Check, Plus, Droplets } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/integrations/api/compat";
import { TransferDialog } from "@/components/TransferDialog";
import { DropsShop } from "@/components/DropsShop";
import { TransactionItem, TransactionItemData } from "@/components/TransactionItem";
import { TransactionDetail } from "@/components/TransactionDetail";
import { formatDropsLabel } from "@/utils/formatDropsLabel";
import { Button } from "@/components/ui/button";

type FilterType = "all" | "transfer_send" | "transfer_receive" | "purchase" | "gift_send";

const FILTERS: { key: FilterType; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "transfer_send", label: "Отправлено" },
  { key: "transfer_receive", label: "Получено" },
  { key: "purchase", label: "Покупки" },
  { key: "gift_send", label: "Подарки" },
];

export default function Wallet() {
  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState(0);
  const [copied, setCopied] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState<TransactionItemData | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [transactions, setTransactions] = useState<TransactionItemData[]>([]);
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [loading, setLoading] = useState(true);

  const getToken = async () => {
    const session = await api.auth.getSession();
    return session.data.session?.access_token;
  };

  const fetchWallet = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch("/api/v1/drops/wallet", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setAddress(data.data.address);
        setBalance(data.data.balance);
      }
    } catch { /* silent */ }
  }, []);

  const fetchTransactions = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const typeParam = activeFilter !== "all" ? `&type=${activeFilter}` : "";
      const res = await fetch(`/api/v1/drops/history?limit=50${typeParam}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setTransactions(data.data || []);
      }
    } catch { /* silent */ }
  }, [activeFilter]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchWallet(), fetchTransactions()]).finally(() => setLoading(false));
  }, [fetchWallet, fetchTransactions]);

  const handleCopy = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    toast.success("Адрес скопирован");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTransferSuccess = () => {
    fetchWallet();
    fetchTransactions();
  };

  const handleShopClose = (isOpen: boolean) => {
    setShopOpen(isOpen);
    if (!isOpen) {
      fetchWallet();
      fetchTransactions();
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
      {/* Balance Card */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
          <Droplets className="w-4 h-4" />
          Баланс
        </div>
        <p className="text-3xl font-bold tracking-tight">
          {balance.toLocaleString("ru-RU")} <span className="text-base font-normal text-muted-foreground">{formatDropsLabel(balance)}</span>
        </p>

        {/* Wallet address */}
        {address && (
          <div className="flex items-center gap-2 mt-3 text-sm">
            <code className="font-mono text-muted-foreground bg-muted px-2 py-1 rounded">{address}</code>
            <button
              type="button"
              onClick={handleCopy}
              className="p-1 rounded-md hover:bg-muted transition-colors"
              title="Копировать адрес"
            >
              {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
            </button>
          </div>
        )}

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-3 mt-4">
          <Button
            onClick={() => setTransferOpen(true)}
            variant="default"
            size="lg"
            className="flex items-center justify-center gap-2"
          >
            <ArrowRight className="w-4 h-4" />
            Отправить
          </Button>
          <Button
            onClick={() => setShopOpen(true)}
            variant="secondary"
            size="lg"
            className="flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Пополнить
          </Button>
        </div>
      </div>

      {/* Transaction History */}
      <div>
        <h2 className="text-lg font-semibold mb-3">История операций</h2>

        {/* Filter tabs */}
        <div className="flex gap-1 bg-muted rounded-lg p-1 mb-4 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setActiveFilter(f.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                activeFilter === f.key
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Transaction list */}
        {loading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Загрузка...</div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            {activeFilter === "all" ? "Пока нет операций" : "Нет операций этого типа"}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {transactions.map((tx) => (
              <TransactionItem
                key={tx.id}
                transaction={tx}
                onSelect={(t) => { setSelectedTx(t); setDetailOpen(true); }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Dialogs */}
      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        currentBalance={balance}
        onSuccess={handleTransferSuccess}
      />
      <DropsShop open={shopOpen} onOpenChange={handleShopClose} />
      <TransactionDetail
        open={detailOpen}
        onOpenChange={setDetailOpen}
        transaction={selectedTx}
      />
    </div>
  );
}
