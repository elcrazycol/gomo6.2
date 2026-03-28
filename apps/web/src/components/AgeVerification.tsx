import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface AgeVerificationProps {
  open: boolean;
  onConfirm: () => void;
  onDecline: () => void;
}

export function AgeVerification({ open, onConfirm, onDecline }: AgeVerificationProps) {
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">⚠️ Возрастное ограничение</DialogTitle>
          <DialogDescription className="text-base pt-4">
            Для доступа к этой доске необходимо подтвердить, что вам исполнилось 18 лет.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 mt-4">
          <Button onClick={onConfirm} className="w-full">
            Да, мне есть 18 лет
          </Button>
          <Button variant="outline" onClick={onDecline} className="w-full">
            Нет, вернуться назад
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}