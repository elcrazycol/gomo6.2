import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { Loader2, User } from "lucide-react";
import { pluralRu } from "@/utils/pluralRu";
import type { SuggestionKeyDownProps } from "@tiptap/suggestion";
import type { ProfileSearchResult } from "@/utils/searchProfiles";

export interface MentionListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

interface MentionListProps {
  items: ProfileSearchResult[];
  command: (item: ProfileSearchResult) => void;
  query: string;
  loading?: boolean;
}

export const MentionList = forwardRef<MentionListHandle, MentionListProps>(
  ({ items, command, query, loading = false }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    const selectItem = useCallback(
      (index: number) => {
        const item = items[index];
        if (item) command(item);
      },
      [items, command]
    );

    useImperativeHandle(
      ref,
      () => ({
        onKeyDown: ({ event }) => {
          if (event.key === "ArrowUp") {
            if (items.length === 0) return true;
            event.preventDefault();
            setSelectedIndex((prev) => (prev + items.length - 1) % items.length);
            return true;
          }
          if (event.key === "ArrowDown") {
            if (items.length === 0) return true;
            event.preventDefault();
            setSelectedIndex((prev) => (prev + 1) % items.length);
            return true;
          }
          if (event.key === "Enter") {
            if (items.length === 0) return true;
            event.preventDefault();
            selectItem(selectedIndex);
            return true;
          }
          // Escape is handled by the suggestion plugin itself
          return false;
        },
      }),
      [items, selectedIndex, selectItem]
    );

    if (loading && items.length === 0) {
      return (
        <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Поиск...
        </div>
      );
    }

    return (
      <div className="py-2">
        <div className="mb-1 border-b border-border/50 px-3 py-1 text-xs font-medium text-muted-foreground">
          Выберите пользователя{query ? `: @${query}` : ""}
        </div>
        {items.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">Никого не нашли</div>
        ) : (
          items.map((user, index) => (
            <button
              key={user.id}
              type="button"
              className={`mx-1 flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-all duration-150 hover:bg-muted/60 ${
                index === selectedIndex ? "bg-muted shadow-sm" : ""
              }`}
              onClick={() => selectItem(index)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-muted">
                <User className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                  @{user.username}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {pluralRu((user.thread_count || 0) + (user.wall_post_count || 0), "запись", "записи", "записей")}
                  {user.account_number ? ` • №${user.account_number}` : ""}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    );
  }
);

MentionList.displayName = "MentionList";
