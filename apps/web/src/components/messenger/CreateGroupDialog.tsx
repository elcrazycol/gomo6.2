import { useState, useCallback, useEffect, useRef } from "react";
import { messengerApi } from "@/services/messengerApi";
import { useMessengerStore } from "@/stores/messengerStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CreateGroupDialog({ open, onClose }: Props) {
  const [groupName, setGroupName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const selectConversation = useMessengerStore((s) => s.selectConversation);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setGroupName("");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const handleCreate = useCallback(async () => {
    if (!groupName.trim() || isCreating) return;
    setIsCreating(true);
    try {
      const { conversation_id } = await messengerApi.createGroup(
        groupName.trim(),
        [],
      );
      selectConversation(conversation_id);
      onClose();
    } catch (err) {
      console.error("Failed to create group:", err);
    } finally {
      setIsCreating(false);
    }
  }, [groupName, isCreating, selectConversation, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleCreate();
    }
    if (e.key === "Escape") {
      onClose();
    }
  }, [handleCreate, onClose]);

  return (
    <div style={{ padding: "0 12px 12px" }}>
      <input
        ref={inputRef}
        type="text"
        value={groupName}
        onChange={(e) => setGroupName(e.target.value)}
        onKeyDown={handleKeyDown}
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
        onClick={handleCreate}
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
    </div>
  );
}
