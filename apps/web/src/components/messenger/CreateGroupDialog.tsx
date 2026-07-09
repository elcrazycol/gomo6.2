import { useState, useCallback, useEffect } from "react";
import { X, Search, Users, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PentagramLoader } from "@/components/PentagramLoader";
import { storageUrl } from "@/utils/storage";
import { getInitials } from "./utils";
import { messengerApi } from "@/services/messengerApi";
import { useMessengerStore } from "@/stores/messengerStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface UserSearchResult {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

export function CreateGroupDialog({ open, onClose }: Props) {
  const [step, setStep] = useState<"search" | "name">("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<UserSearchResult[]>([]);
  const [groupName, setGroupName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const selectConversation = useMessengerStore((s) => s.selectConversation);

  useEffect(() => {
    if (!open) {
      setStep("search");
      setSearchQuery("");
      setSearchResults([]);
      setSelectedUsers([]);
      setGroupName("");
    }
  }, [open]);

  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setIsSearching(true);
      fetch(`/api/v1/profiles?username=ilike.*${encodeURIComponent(searchQuery)}*&select=id,username,display_name,avatar_url&limit=10`)
        .then((r) => r.json())
        .then((res) => setSearchResults(res.data || []))
        .catch(() => setSearchResults([]))
        .finally(() => setIsSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const toggleUser = useCallback((user: UserSearchResult) => {
    setSelectedUsers((prev) =>
      prev.some((u) => u.id === user.id)
        ? prev.filter((u) => u.id !== user.id)
        : [...prev, user]
    );
  }, []);

  const handleCreate = useCallback(async () => {
    if (selectedUsers.length === 0 || isCreating) return;
    setIsCreating(true);
    try {
      const name = groupName.trim() || selectedUsers.map((u) => u.username).join(", ");
      const { conversation_id } = await messengerApi.createGroup(
        name,
        selectedUsers.map((u) => u.id),
      );
      selectConversation(conversation_id);
      onClose();
    } catch (err) {
      console.error("Failed to create group:", err);
    } finally {
      setIsCreating(false);
    }
  }, [selectedUsers, groupName, isCreating, selectConversation, onClose]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md" style={{ padding: 0, overflow: "hidden" }}>
        <DialogHeader style={{ padding: "16px 16px 0" }}>
          <DialogTitle>
            {step === "search" ? "Новый чат" : "Название группы"}
          </DialogTitle>
        </DialogHeader>

        {step === "search" ? (
          <div style={{ padding: "0 16px 16px" }}>
            {/* Search input */}
            <div style={{ position: "relative", marginBottom: 12 }}>
              <Search size={16} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "hsl(var(--muted-foreground))" }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Найти пользователя..."
                autoFocus
                style={{
                  width: "100%",
                  padding: "8px 10px 8px 34px",
                  borderRadius: 8,
                  border: "1px solid hsl(var(--input))",
                  background: "hsl(var(--background))",
                  color: "hsl(var(--foreground))",
                  fontSize: 14,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Selected users */}
            {selectedUsers.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                {selectedUsers.map((u) => (
                  <span
                    key={u.id}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "4px 8px",
                      borderRadius: 16,
                      background: "hsl(var(--primary) / 0.1)",
                      color: "hsl(var(--primary))",
                      fontSize: 13,
                    }}
                  >
                    {u.username}
                    <button
                      type="button"
                      onClick={() => toggleUser(u)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, display: "flex" }}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Search results */}
            {isSearching && <div style={{ textAlign: "center", padding: 16 }}><PentagramLoader size="sm" /></div>}
            {!isSearching && searchQuery.length >= 2 && searchResults.length === 0 && (
              <p style={{ textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 13, padding: 16 }}>Ничего не найдено</p>
            )}
            {searchResults.map((user) => {
              const isSelected = selectedUsers.some((u) => u.id === user.id);
              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => toggleUser(user)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "8px 10px",
                    border: "none",
                    borderRadius: 8,
                    background: isSelected ? "hsl(var(--primary) / 0.08)" : "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background-color 0.15s",
                  }}
                >
                  <div className="avatar" style={{ width: 36, height: 36, fontSize: 12 }}>
                    {user.avatar_url ? (
                      <img src={storageUrl("post-images", user.avatar_url) || undefined} alt={user.username} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} />
                    ) : (
                      <span>{getInitials(user.username)}</span>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{user.display_name || user.username}</div>
                    <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>@{user.username}</div>
                  </div>
                  {isSelected && <Check size={16} style={{ color: "hsl(var(--primary))" }} />}
                </button>
              );
            })}

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              {selectedUsers.length > 0 && (
                <button
                  type="button"
                  onClick={() => setStep("name")}
                  style={{
                    flex: 1,
                    padding: "10px 16px",
                    borderRadius: 8,
                    border: "1px solid hsl(var(--border))",
                    background: "hsl(var(--card))",
                    color: "hsl(var(--foreground))",
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }}
                >
                  <Users size={16} />
                  Создать группу ({selectedUsers.length})
                </button>
              )}
            </div>
          </div>
        ) : (
          <div style={{ padding: "0 16px 16px" }}>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Название группы (необязательно)"
              autoFocus
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid hsl(var(--input))",
                background: "hsl(var(--background))",
                color: "hsl(var(--foreground))",
                fontSize: 14,
                outline: "none",
                boxSizing: "border-box",
                marginBottom: 12,
              }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => setStep("search")}
                style={{
                  flex: 1,
                  padding: "10px 16px",
                  borderRadius: 8,
                  border: "1px solid hsl(var(--border))",
                  background: "hsl(var(--card))",
                  color: "hsl(var(--foreground))",
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                Назад
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={isCreating}
                style={{
                  flex: 2,
                  padding: "10px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: "hsl(var(--primary))",
                  color: "hsl(var(--primary-foreground))",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: isCreating ? "not-allowed" : "pointer",
                  opacity: isCreating ? 0.6 : 1,
                }}
              >
                {isCreating ? "Создание..." : "Создать"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
