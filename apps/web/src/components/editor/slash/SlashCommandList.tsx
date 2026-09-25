import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import type { SuggestionKeyDownProps } from "@tiptap/suggestion";
import type { SlashItem } from "./slashCommands";

export interface SlashCommandListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

interface SlashCommandListProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
  query: string;
}

export const SlashCommandList = forwardRef<SlashCommandListHandle, SlashCommandListProps>(
  ({ items, command, query }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    const selectItem = useCallback(
      (index: number) => {
        const item = items[index];
        if (item) command(item);
      },
      [items, command],
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
          return false;
        },
      }),
      [items, selectedIndex, selectItem],
    );

    return (
      <div className="w-[calc(100vw-20px)] overflow-hidden rounded-xl border border-border bg-background/95 py-1 shadow-xl backdrop-blur-sm sm:w-72">
        <div className="border-b border-border/50 px-3 py-1 text-xs font-medium text-muted-foreground">
          Вставить блок
        </div>
        {items.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">
            Ничего не найдено{query ? `: /${query}` : ""}
          </div>
        ) : (
          items.map((item, index) => (
            <button
              key={item.key}
              type="button"
              data-slash-item={item.key}
              className={`mx-1 flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${
                index === selectedIndex ? "bg-muted shadow-sm" : "hover:bg-muted/60"
              }`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectItem(index)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-border/60 bg-background">
                <item.Icon className="h-4 w-4 text-muted-foreground" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{item.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{item.hint}</span>
              </span>
            </button>
          ))
        )}
      </div>
    );
  },
);

SlashCommandList.displayName = "SlashCommandList";
