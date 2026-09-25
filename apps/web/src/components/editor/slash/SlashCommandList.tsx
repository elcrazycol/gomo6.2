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
      <div className="w-[calc(100vw-20px)] overflow-hidden rounded-lg border border-border bg-popover shadow-md animate-in fade-in-0 duration-100 motion-reduce:animate-none sm:w-80">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">Вставить блок</span>
          {query && <span className="font-mono text-xs text-muted-foreground/80">/{query}</span>}
        </div>

        <div className="py-1">
          {items.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
              Ничего не найдено
            </div>
          ) : (
            items.map((item, index) => {
              const selected = index === selectedIndex;
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-label={item.title}
                  data-slash-item={item.key}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectItem(index)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`relative flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                    selected ? "bg-muted" : "hover:bg-muted/50"
                  }`}
                >
                  {selected && (
                    <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" aria-hidden="true" />
                  )}
                  <item.Icon className={`h-4 w-4 shrink-0 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{item.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.hint}</span>
                  </span>
                  {selected && <span className="shrink-0 text-[11px] text-muted-foreground/70">↵</span>}
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border/60 px-3 py-1.5 text-[10px] text-muted-foreground/70">
          <span>↑↓ навигация</span>
          <span aria-hidden="true">·</span>
          <span>↵ выбрать</span>
          <span className="ml-auto">esc</span>
        </div>
      </div>
    );
  },
);

SlashCommandList.displayName = "SlashCommandList";
