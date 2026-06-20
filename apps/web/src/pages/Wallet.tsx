import { useState, useEffect, useCallback } from "react";
import { ArrowRight, Copy, Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/integrations/api/compat";
import { TransferDialog } from "@/components/TransferDialog";
import { DropsShop } from "@/components/DropsShop";
import { TransactionItem, TransactionItemData } from "@/components/TransactionItem";
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
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-purple-600 to-blue-800 p-6 text-white">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImVub3Zsb3kiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDM0djItSDI0di0yaDEyem0wLTR2Mkg4VjI4aDI4em0wLTRWMmg4djJoMjh6Ii8+PC9nPjwvZz48L3N2Zz4=')] opacity-30" />
        <div className="relative">
          <p className="text-sm text-white/70 mb-1">Баланс</p>
          <p className="text-4xl font-bold tracking-tight">
            {balance.toLocaleString("ru-RU")} <span className="text-lg font-normal text-white/70">{formatDropsLabel(balance)}</span>
          </p>

          {/* Wallet address */}
          {address && (
            <div className="mt-4 flex items-center gap-2 bg-white/10 rounded-lg px-3 py-2">
              <span className="text-sm font-mono text-white/80">{address}</span>
              <button
                type="button"
                onClick={handleCopy}
                className="ml-auto p-1 rounded-md hover:bg-white/20 transition-colors"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 mt-5">
            <Button
              onClick={() => setTransferOpen(true)}
              className="flex-1 bg-white/20 hover:bg-white/30 text-white border-0"
              size="lg"
            >
              <ArrowRight className="w-4 h-4 mr-1" />
              Отправить
            </Button>
            <Button
              onClick={handleCopy}
              className="flex-1 bg-white/20 hover:bg-white/30 text-white border-0"
              size="lg"
            >
              <Copy className="w-4 h-4 mr-1" />
              Получить
            </Button>
            <Button
              onClick={() => setShopOpen(true)}
              className="flex-1 bg-white/20 hover:bg-white/30 text-white border-0"
              size="lg"
            >
              <Plus className="w-4 h-4 mr-1" />
              Пополнить
            </Button>
          </div>
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
              <TransactionItem key={tx.id} transaction={tx} />
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
    </div>
  );
}
