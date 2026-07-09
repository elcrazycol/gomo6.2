import { useState, useCallback, useEffect, useRef } from "react";
import { Search, X, MessageCircle, Users } from "lucide-react";
import { PentagramLoader } from "@/components/PentagramLoader";
import { storageUrl } from "@/utils/storage";
import { getInitials } from "./utils";
import { messengerApi } from "@/services/messengerApi";
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

export function NewChatDialog({ open, onClose }: Props) {
  const [mode, setMode] = useState<"menu" | "search" | "group">("menu");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const selectConversation = useMessengerStore((s) => s.selectConversation);
  const createConversation = useMessengerStore((s) => s.createConversation);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setMode("menu");
      setQuery("");
      setResults([]);
      setGroupName("");
    }
  }, [open]);

  useEffect(() => {
    if (mode !== "search" || !query.trim() || query.length < 1) {
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
  }, [query, mode]);

  useEffect(() => {
    if ((mode === "search" || mode === "group") && open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [mode, open]);

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

  const handleCreateGroup = useCallback(async () => {
    if (!groupName.trim() || isCreating) return;
    setIsCreating(true);
    try {
      const { conversation_id } = await messengerApi.createGroup(groupName.trim(), []);
      selectConversation(conversation_id);
      onClose();
    } catch (err) {
      console.error("Failed to create group:", err);
    } finally {
      setIsCreating(false);
    }
  }, [groupName, isCreating, selectConversation, onClose]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "15vh",
      }}
      onClick={onClose}
    >
      {/* Backdrop */}
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.3)" }} />

      {/* Dialog */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: 340,
          maxHeight: "70vh",
          background: "hsl(var(--card))",
          border: "1px solid hsl(var(--border))",
          borderRadius: 12,
          boxShadow: "0 8px 30px rgba(0,0,0,0.18)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: "1px solid hsl(var(--border))" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            {mode === "menu" && "Новый чат"}
            {mode === "search" && "Найти пользователя"}
            {mode === "group" && "Новая группа"}
          </span>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(var(--muted-foreground))", padding: 2, display: "flex" }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {mode === "menu" && (
            <div style={{ padding: 8 }}>
              <button
                type="button"
                onClick={() => setMode("search")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  padding: "10px 12px",
                  border: "none",
                  borderRadius: 8,
                  background: "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 13,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "hsl(var(--thread-hover))"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <MessageCircle size={18} style={{ color: "hsl(var(--primary))" }} />
                <span>Написать пользователю</span>
              </button>
              <button
                type="button"
                onClick={() => setMode("group")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  padding: "10px 12px",
                  border: "none",
                  borderRadius: 8,
                  background: "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 13,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "hsl(var(--thread-hover))"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <Users size={18} style={{ color: "hsl(var(--primary))" }} />
                <span>Создать группу</span>
              </button>
            </div>
          )}

          {mode === "search" && (
            <div style={{ padding: "8px 12px 12px" }}>
              <div style={{ position: "relative", marginBottom: 8 }}>
                <Search size={16} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "hsl(var(--muted-foreground))" }} />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Имя пользователя..."
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
          )}

          {mode === "group" && (
            <div style={{ padding: "8px 12px 12px" }}>
              <input
                ref={inputRef}
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreateGroup(); }}
                placeholder="Название группы"
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
              <button
                type="button"
                onClick={handleCreateGroup}
                disabled={!groupName.trim() || isCreating}
                style={{
                  width: "100%",
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: groupName.trim() ? "hsl(var(--primary))" : "hsl(var(--muted))",
                  color: groupName.trim() ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: isCreating || !groupName.trim() ? "not-allowed" : "pointer",
                }}
              >
                {isCreating ? "Создание..." : "Создать"}
              </button>
              <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 8, textAlign: "center" }}>
                После создания можно добавить участников
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
