import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CornerDownLeft } from "lucide-react";
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
    const reduceMotion = useReducedMotion();

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
      <div className="w-[calc(100vw-20px)] overflow-hidden rounded-2xl border border-border/60 bg-background/70 shadow-2xl backdrop-blur-xl animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150 motion-reduce:animate-none sm:w-80">
        <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
          <span className="text-[11px] font-medium text-muted-foreground">Вставить блок</span>
          {query && (
            <span className="rounded-full bg-foreground/5 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
              /{query}
            </span>
          )}
        </div>

        <div className="p-1.5">
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
                  className={`relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors ${
                    selected ? "" : "hover:bg-foreground/5"
                  }`}
                >
                  {selected && (
                    <motion.span
                      layoutId="slash-active"
                      transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 700, damping: 40, mass: 0.6 }}
                      className="absolute inset-0 z-0 rounded-xl bg-gradient-to-b from-primary/25 to-primary/5 ring-1 ring-inset ring-primary/30 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.22)]"
                    />
                  )}
                  <span
                    className={`relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-foreground/5 ring-1 ring-inset ring-border/60 ${
                      selected ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    <item.Icon className="h-4 w-4" />
                  </span>
                  <span className="relative z-10 min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{item.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.hint}</span>
                  </span>
                  {selected && <CornerDownLeft className="relative z-10 h-3.5 w-3.5 shrink-0 text-primary" />}
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-border/50 px-3 py-1.5 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded bg-foreground/5 px-1 py-0.5 font-sans">↑↓</kbd> навигация
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded bg-foreground/5 px-1 py-0.5 font-sans">↵</kbd> выбрать
          </span>
          <span className="ml-auto inline-flex items-center gap-1">
            <kbd className="rounded bg-foreground/5 px-1 py-0.5 font-sans">esc</kbd>
          </span>
        </div>
      </div>
    );
  },
);

SlashCommandList.displayName = "SlashCommandList";
