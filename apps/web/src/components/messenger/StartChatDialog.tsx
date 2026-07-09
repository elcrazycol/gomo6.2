import { useState, useCallback, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { PentagramLoader } from "@/components/PentagramLoader";
import { storageUrl } from "@/utils/storage";
import { getInitials } from "./utils";
import { useMessengerStore } from "@/stores/messengerStore";

interface UserSearchResult {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function StartChatDialog({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const selectConversation = useMessengerStore((s) => s.selectConversation);
  const createConversation = useMessengerStore((s) => s.createConversation);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim() || query.length < 1) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setIsSearching(true);
      fetch(`/api/v1/drops/users/search?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("auth_token") ?? ""}` },
      })
        .then((r) => r.json())
        .then((res) => setResults(res.data || []))
        .catch(() => setResults([]))
        .finally(() => setIsSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const handleStartChat = useCallback(async (userId: string) => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const convId = await createConversation(userId);
      if (convId) {
        selectConversation(convId);
        onClose();
      }
    } catch (err) {
      console.error("Failed to start chat:", err);
    } finally {
      setIsCreating(false);
    }
  }, [isCreating, createConversation, selectConversation, onClose]);

  return (
    <div style={{ padding: "0 12px 12px" }}>
      <div style={{ position: "relative", marginBottom: 8 }}>
        <Search size={16} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "hsl(var(--muted-foreground))" }} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Найти пользователя..."
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
      {isSearching && <div style={{ textAlign: "center", padding: 12 }}><PentagramLoader size="sm" /></div>}
      {!isSearching && query.length >= 1 && results.length === 0 && (
        <p style={{ textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 12, padding: 8 }}>Ничего не найдено</p>
      )}
      {results.map((user) => (
        <button
          key={user.id}
          type="button"
          disabled={isCreating}
          onClick={() => handleStartChat(user.id)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            width: "100%",
            padding: "8px 10px",
            border: "none",
            borderRadius: 8,
            background: "transparent",
            cursor: isCreating ? "not-allowed" : "pointer",
            textAlign: "left",
            opacity: isCreating ? 0.6 : 1,
          }}
          onMouseEnter={(e) => { if (!isCreating) e.currentTarget.style.background = "hsl(var(--thread-hover))"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          <div className="avatar" style={{ width: 34, height: 34, fontSize: 12 }}>
            {user.avatar_url ? (
              <img src={storageUrl("post-images", user.avatar_url) || undefined} alt={user.username} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} />
            ) : (
              <span>{getInitials(user.username)}</span>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{user.display_name || user.username}</div>
            <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>@{user.username}</div>
          </div>
        </button>
      ))}
    </div>
  );
}
