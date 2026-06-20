import { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/integrations/api/compat";

interface TransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentBalance: number;
  onSuccess: () => void;
}

interface UserSearchResult {
  id: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
  wallet_address: string;
}

export function TransferDialog({ open, onOpenChange, currentBalance, onSuccess }: TransferDialogProps) {
  const [mode, setMode] = useState<"username" | "address">("username");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const [addressInput, setAddressInput] = useState("");
  const [amount, setAmount] = useState<number>(10);
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const ADDRESS_REGEX = /^GM6-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
  const validAddress = mode === "address" && ADDRESS_REGEX.test(addressInput);

  const quickAmounts = [10, 50, 100, 500];

  const searchUsers = useCallback(async (query: string) => {
    if (query.length < 1) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const session = await api.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) return;

      const res = await fetch(`/api/v1/drops/users/search?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      const data = await res.json();
      if (data.success) {
        setSearchResults(data.data);
        setShowResults(true);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
  }, []);

  useEffect(() => {
    if (mode !== "username") return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchUsers(searchQuery), 300);
    return () => {
      clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, [searchQuery, mode, searchUsers]);

  const resetForm = () => {
    setSearchQuery("");
    setSearchResults([]);
    setSelectedUser(null);
    setAddressInput("");
    setAmount(10);
    setDescription("");
    setShowResults(false);
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) resetForm();
    onOpenChange(isOpen);
  };

  const handleSend = async () => {
    if (amount < 1) {
      toast.error("Минимум 1 дропс");
      return;
    }
    if (amount > currentBalance) {
      toast.error("Недостаточно дропсов");
      return;
    }

    const payload: Record<string, unknown> = { amount };
    if (mode === "username" && selectedUser) {
      payload.recipient_username = selectedUser.username;
    } else if (mode === "address" && validAddress) {
      payload.recipient_address = addressInput.toUpperCase();
    } else {
      toast.error("Укажите получателя");
      return;
    }
    if (description.trim()) {
      payload.description = description.trim();
    }

    setSending(true);
    try {
      const session = await api.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        toast.error("Нужно войти в аккаунт");
        return;
      }

      const res = await fetch("/api/v1/drops/transfer", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.success) {
        toast.success(`Отправлено ${amount} ${amount === 1 ? "дропс" : amount < 5 ? "дропса" : "дропсов"} @${data.data.recipient_username}`);
        handleClose(false);
        onSuccess();
      } else {
        toast.error(data.error || "Ошибка перевода");
      }
    } catch {
      toast.error("Ошибка сети");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRight className="w-5 h-5 text-blue-400" />
            Отправить дропсы
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Mode toggle */}
          <div className="flex gap-2 bg-muted rounded-lg p-1">
            <button
              type="button"
              onClick={() => { setMode("username"); setSelectedUser(null); setSearchQuery(""); }}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                mode === "username" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              По @имени
            </button>
            <button
              type="button"
              onClick={() => { setMode("address"); setSelectedUser(null); setAddressInput(""); }}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                mode === "address" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              По адресу
            </button>
          </div>

          {/* Recipient input */}
          {mode === "username" ? (
            <div className="relative">
              <Label>Получатель</Label>
              <div className="relative mt-1.5">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={selectedUser ? `@${selectedUser.username}` : searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSelectedUser(null);
                  }}
                  onFocus={() => searchResults.length > 0 && setShowResults(true)}
                  placeholder="Введите @username..."
                  className="pl-9"
                  disabled={!!selectedUser}
                />
                {selectedUser && (
                  <button
                    type="button"
                    onClick={() => { setSelectedUser(null); setSearchQuery(""); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {showResults && searchResults.length > 0 && !selectedUser && (
                <div className="absolute z-50 w-full mt-1 bg-background border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {searchResults.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => {
                        setSelectedUser(user);
                        setShowResults(false);
                        setSearchQuery("");
                      }}
                      className="w-full px-3 py-2 flex items-center gap-2 hover:bg-muted/50 text-left"
                    >
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
                        {user.username[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-medium">@{user.username}</div>
                        <div className="text-xs text-muted-foreground font-mono">{user.wallet_address}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <Label>Адрес кошелька</Label>
              <Input
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value.toUpperCase())}
                placeholder="GM6-XXXX-XXXX"
                className="mt-1.5 font-mono"
                maxLength={14}
              />
              {addressInput && !validAddress && (
                <p className="text-xs text-red-400 mt-1">Формат: GM6-XXXX-XXXX</p>
              )}
            </div>
          )}

          {/* Amount */}
          <div>
            <Label>Количество</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val) && val >= 1) setAmount(val);
              }}
              min={1}
              max={currentBalance}
              className="mt-1.5 text-center text-lg font-semibold"
            />
            <div className="flex gap-2 mt-2">
              {quickAmounts.map((q) => (
                <Button
                  key={q}
                  variant={amount === q ? "default" : "outline"}
                  size="sm"
                  onClick={() => setAmount(q)}
                  className="flex-1"
                  disabled={q > currentBalance}
                >
                  {q}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 text-center">
              Баланс: {currentBalance} {currentBalance === 1 ? "дропс" : currentBalance < 5 ? "дропса" : "дропсов"}
            </p>
          </div>

          {/* Description */}
          <div>
            <Label>Комментарий <span className="text-muted-foreground">(необязательно)</span></Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="За что перевод..."
              className="mt-1.5"
              maxLength={200}
            />
          </div>

          {/* Send button */}
          <Button
            onClick={handleSend}
            disabled={sending || amount < 1 || amount > currentBalance || (!selectedUser && !validAddress)}
            className="w-full"
            size="lg"
          >
            {sending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Отправка...
              </>
            ) : (
              <>
                <ArrowRight className="w-4 h-4 mr-2" />
                Отправить {amount} {amount === 1 ? "дропс" : amount < 5 ? "дропса" : "дропсов"}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
