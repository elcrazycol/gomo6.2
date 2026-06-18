import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { storageUrl } from "@/utils/storage";
import { Gift, Loader2 } from "lucide-react";
import { api } from "@/integrations/api/compat";
import type { GiftCatalogItem } from "@/components/GiftCard";

interface GiftSendDialogProps {
  gift: GiftCatalogItem | null;
  recipientId: string;
  recipientUsername: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent?: () => void;
}

const formatDropsLabel = (value: number) => {
  const abs = Math.abs(value);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return "капля";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "капли";
  return "капель";
};

export function GiftSendDialog({ gift, recipientId, recipientUsername, open, onOpenChange, onSent }: GiftSendDialogProps) {
  const [message, setMessage] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!gift || sending) return;
    setSending(true);

    try {
      const session = await api.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        toast.error("Необходима авторизация");
        setSending(false);
        return;
      }

      const res = await fetch("/api/v1/gifts/send", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          gift_id: gift.id,
          recipient_id: recipientId,
          message: message.trim() || undefined,
          is_anonymous: isAnonymous,
        }),
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        toast.error(result.error || "Не удалось отправить подарок");
        setSending(false);
        return;
      }

      toast.success(`Подарок «${gift.name}» отправлен!`);
      setMessage("");
      setIsAnonymous(false);
      onOpenChange(false);
      onSent?.();
    } catch {
      toast.error("Ошибка отправки подарка");
    } finally {
      setSending(false);
    }
  };

  if (!gift) return null;

  const imageUrl = storageUrl("post-images", gift.image_url) || gift.image_url;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Отправить подарок</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
            <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
              {imageUrl ? (
                <img src={imageUrl} alt={gift.name} className="w-full h-full object-cover" />
              ) : (
                <Gift className="w-8 h-8 text-muted-foreground" />
              )}
            </div>
            <div>
              <p className="font-medium">{gift.name}</p>
              {gift.description && (
                <p className="text-sm text-muted-foreground line-clamp-2">{gift.description}</p>
              )}
              <p className="text-sm text-muted-foreground mt-1">
                {gift.price} {formatDropsLabel(gift.price)}
              </p>
            </div>
          </div>

          <div>
            <Label className="text-sm text-muted-foreground">
              Получатель: <span className="text-foreground font-medium">@{recipientUsername}</span>
            </Label>
          </div>

          <div>
            <Label htmlFor="gift-message">Сообщение (необязательно)</Label>
            <Input
              id="gift-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Напишите что-нибудь nice..."
              maxLength={500}
              className="mt-1"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <Label htmlFor="gift-anonymous" className="text-sm">Отправить анонимно</Label>
              <p className="text-xs text-muted-foreground">Получатель не узнает от кого подарок</p>
            </div>
            <Switch
              id="gift-anonymous"
              checked={isAnonymous}
              onCheckedChange={setIsAnonymous}
            />
          </div>

          <Button
            onClick={handleSend}
            disabled={sending}
            className="w-full"
          >
            {sending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Отправка...
              </>
            ) : (
              <>
                <Gift className="w-4 h-4 mr-2" />
                Отправить за {gift.price} {formatDropsLabel(gift.price)}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
