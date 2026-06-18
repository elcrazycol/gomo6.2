import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Droplets, Loader2, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/integrations/api/compat";

const PRICE_PER_DROP = 0.02;

interface DropsShopProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DropsShop({ open, onOpenChange }: DropsShopProps) {
  const [dropsAmount, setDropsAmount] = useState(50);
  const [purchasing, setPurchasing] = useState(false);
  const [waitingConfirmation, setWaitingConfirmation] = useState(false);
  const [drops, setDrops] = useState<number | null>(null);

  const fetchBalance = useCallback(async () => {
    try {
      const session = await api.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) return;

      const res = await fetch("/api/v1/user/drops", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setDrops(data.data.drops);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchBalance();
    }
  }, [open, fetchBalance]);

  const priceUSD = (dropsAmount * PRICE_PER_DROP).toFixed(2);

  const handlePurchase = async () => {
    if (dropsAmount < 1 || dropsAmount > 100000) {
      toast.error("Количество капель должно быть от 1 до 100000");
      return;
    }

    setPurchasing(true);
    try {
      const DePayWidgets = (await import("@depay/widgets")).default;

      DePayWidgets.Payment({
        integration: import.meta.env.VITE_DEPAY_INTEGRATION_ID || "",
        payload: { drops_amount: dropsAmount },
      });

      setWaitingConfirmation(true);
      let attempts = 0;
      const pollInterval = setInterval(async () => {
        attempts++;
        await fetchBalance();
        if (attempts >= 20) {
          clearInterval(pollInterval);
          setWaitingConfirmation(false);
        }
      }, 3000);

      setTimeout(() => {
        clearInterval(pollInterval);
        setWaitingConfirmation(false);
      }, 60000);
    } catch {
      toast.error("Ошибка при открытии виджета оплаты");
    } finally {
      setPurchasing(false);
    }
  };

  const quickAmounts = [10, 50, 100, 500];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Droplets className="w-5 h-5 text-blue-400" />
            Купить капли
          </DialogTitle>
        </DialogHeader>

        {drops !== null && (
          <div className="text-center py-2 text-sm text-muted-foreground">
            Баланс: <span className="font-medium text-foreground">{drops} капель</span>
          </div>
        )}

        {waitingConfirmation && (
          <div className="flex items-center justify-center gap-2 py-3 text-sm text-blue-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Ожидаем подтверждения транзакции...
          </div>
        )}

        <div className="space-y-4">
          <div>
            <Label htmlFor="drops-amount">Количество капель</Label>
            <div className="flex items-center gap-2 mt-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setDropsAmount(Math.max(1, dropsAmount - 10))}
              >
                <Minus className="w-4 h-4" />
              </Button>
              <Input
                id="drops-amount"
                type="number"
                value={dropsAmount}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (!isNaN(val) && val >= 1 && val <= 100000) {
                    setDropsAmount(val);
                  }
                }}
                min={1}
                max={100000}
                className="text-center"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => setDropsAmount(Math.min(100000, dropsAmount + 10))}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="flex gap-2">
            {quickAmounts.map((amount) => (
              <Button
                key={amount}
                variant={dropsAmount === amount ? "default" : "outline"}
                size="sm"
                onClick={() => setDropsAmount(amount)}
                className="flex-1"
              >
                {amount}
              </Button>
            ))}
          </div>

          <div className="text-center py-2">
            <p className="text-2xl font-bold">${priceUSD}</p>
            <p className="text-xs text-muted-foreground">
              {dropsAmount} капель × ${PRICE_PER_DROP} за каплю
            </p>
          </div>

          <Button
            onClick={handlePurchase}
            disabled={purchasing || waitingConfirmation || dropsAmount < 1}
            className="w-full"
            size="lg"
          >
            {purchasing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Открытие виджета...
              </>
            ) : (
              <>
                <Droplets className="w-4 h-4 mr-2" />
                Купить за ${priceUSD}
              </>
            )}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground text-center pt-2">
          Оплата: ETH, Polygon, Base, Solana
        </p>
      </DialogContent>
    </Dialog>
  );
}
