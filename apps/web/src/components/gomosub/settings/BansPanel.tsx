import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Gavel } from "lucide-react";
import { toast } from "sonner";
import { rpcPost, type BanItem } from "./types";

type Props = {
  boardId: string;
  bans: BanItem[];
  canManage: boolean;
  onChanged: () => Promise<void>;
};

const BansPanel = ({ boardId, bans, canManage, onChanged }: Props) => {
  const [busy, setBusy] = useState<string | null>(null);

  const unban = async (userId: string) => {
    setBusy(userId);
    const res = await rpcPost("/api/rpc/gomosub_unban", { board_id: boardId, user_id: userId });
    setBusy(null);
    if (!res.ok) { toast.error((res.error as string) || "Не удалось разбанить"); return; }
    toast.success("Бан снят");
    await onChanged();
  };

  if (bans.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-surface p-8 text-center space-y-2">
        <Gavel className="w-6 h-6 mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Забаненных нет. Тихо и спокойно.</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {bans.map((b) => (
        <div key={b.user_id} className="rounded-xl border border-border/60 bg-surface p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-sm font-bold text-white bg-destructive/80">
            {b.username?.[0]?.toUpperCase() ?? "?"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{b.username || `${b.user_id.slice(0, 8)}…`}</div>
            <div className="text-xs text-muted-foreground truncate">
              {b.reason || "без причины"} · с {new Date(b.created_at).toLocaleDateString()}
              {b.expires_at ? ` · до ${new Date(b.expires_at).toLocaleDateString()}` : " · навсегда"}
            </div>
          </div>
          {b.expires_at && new Date(b.expires_at) > new Date()
            ? <Badge variant="outline" className="text-[10px] shrink-0">активен</Badge>
            : null}
          {canManage && (
            <Button size="sm" variant="outline" className="h-7 text-xs shrink-0"
              disabled={busy === b.user_id} onClick={() => unban(b.user_id)}>
              {busy === b.user_id && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}Разбанить
            </Button>
          )}
        </div>
      ))}
    </div>
  );
};

export default BansPanel;
