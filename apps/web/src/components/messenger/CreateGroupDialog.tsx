import { useState, useCallback, useEffect, useRef } from "react";
import { X, Search, Check } from "lucide-react";
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
  const [step, setStep] = useState<"members" | "name">("members");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selected, setSelected] = useState<UserSearchResult[]>([]);
  const [groupName, setGroupName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const selectConversation = useMessengerStore((s) => s.selectConversation);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setStep("members");
      setQuery("");
      setResults([]);
      setSelected([]);
      setGroupName("");
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim() || query.length < 1) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setIsSearching(true);
      fetch(`/api/v1/drops/users/search?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((res) => setResults(res.data || []))
        .catch(() => setResults([]))
        .finally(() => setIsSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const toggleUser = useCallback((user: UserSearchResult) => {
    setSelected((prev) =>
      prev.some((u) => u.id === user.id)
        ? prev.filter((u) => u.id !== user.id)
        : [...prev, user]
    );
  }, []);

  const handleCreate = useCallback(async () => {
    if (selected.length === 0 || isCreating) return;
    setIsCreating(true);
    try {
      const name = groupName.trim() || selected.map((u) => u.username).join(", ");
      const { conversation_id } = await messengerApi.createGroup(
        name,
        selected.map((u) => u.id),
      );
      selectConversation(conversation_id);
      onClose();
    } catch (err) {
      console.error("Failed to create group:", err);
    } finally {
      setIsCreating(false);
    }
  }, [selected, groupName, isCreating, selectConversation, onClose]);

  return (
    <div style={{ padding: "0 12px 12px" }}>
      {step === "members" ? (
        <>
          {/* Search */}
          <div style={{ position: "relative", marginBottom: 8 }}>
            <Search size={16} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "hsl(var(--muted-foreground))" }} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Добавить участников..."
              style={{
                width: "100%",
                padding: "8px 10px 8px 34px",
                borderRadius: 8,
                border: "1px solid hsl(var(--input))",
                background: "hsl(var(--background))",
                color: "hsl(var(--foreground))",
                fontSize: 13,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Selected chips */}
          {selected.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
              {selected.map((u) => (
                <span
                  key={u.id}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 8px",
                    borderRadius: 12,
                    background: "hsl(var(--primary) / 0.1)",
                    color: "hsl(var(--primary))",
                    fontSize: 12,
                  }}
                >
                  {u.username}
                  <button
                    type="button"
                    onClick={() => toggleUser(u)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, display: "flex" }}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Results */}
          {isSearching && <div style={{ textAlign: "center", padding: 12 }}><PentagramLoader size="sm" /></div>}
          {!isSearching && query.length >= 1 && results.length === 0 && (
            <p style={{ textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 12, padding: 8 }}>Ничего не найдено</p>
          )}
          {results.map((user) => {
            const isSelected = selected.some((u) => u.id === user.id);
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
                }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "hsl(var(--thread-hover))"; }}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
              >
                <div className="avatar" style={{ width: 34, height: 34, fontSize: 12 }}>
                  {user.avatar_url ? (
                    <img src={storageUrl("post-images", user.avatar_url) || undefined} alt={user.username} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} />
                  ) : (
                    <span>{getInitials(user.username)}</span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{user.display_name || user.username}</div>
                  <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>@{user.username}</div>
                </div>
                {isSelected && <Check size={14} style={{ color: "hsl(var(--primary))", flexShrink: 0 }} />}
              </button>
            );
          })}

          {/* Next button */}
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => setStep("name")}
              style={{
                width: "100%",
                marginTop: 8,
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                background: "hsl(var(--primary))",
                color: "hsl(var(--primary-foreground))",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Далее ({selected.length} участн.)
            </button>
          )}
        </>
      ) : (
        <>
          {/* Group name */}
          <input
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Название группы (необязательно)"
            autoFocus
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid hsl(var(--input))",
              background: "hsl(var(--background))",
              color: "hsl(var(--foreground))",
              fontSize: 13,
              outline: "none",
              boxSizing: "border-box",
              marginBottom: 8,
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => setStep("members")}
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid hsl(var(--border))",
                background: "hsl(var(--card))",
                color: "hsl(var(--foreground))",
                fontSize: 13,
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
                padding: "8px 12px",
                borderRadius: 8,
                border: "none",
                background: "hsl(var(--primary))",
                color: "hsl(var(--primary-foreground))",
                fontSize: 13,
                fontWeight: 500,
                cursor: isCreating ? "not-allowed" : "pointer",
                opacity: isCreating ? 0.6 : 1,
              }}
            >
              {isCreating ? "Создание..." : "Создать группу"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
