import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import type { SuggestionKeyDownProps } from '@tiptap/suggestion';
import type { EmojiData } from '@/contexts/EmojiDataContext';
import { storageUrl } from '@/utils/storage';

export interface CustomEmojiSuggestionsHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

interface Props {
  items: EmojiData[];
  command: (item: EmojiData) => void;
  query: string;
}

export const CustomEmojiSuggestions = forwardRef<CustomEmojiSuggestionsHandle, Props>(({ items, command, query }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  useEffect(() => setSelectedIndex(0), [items, query]);

  const select = useCallback((index: number) => {
    const item = items[index];
    if (item) command(item);
  }, [items, command]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((index) => items.length ? (index + items.length - 1) % items.length : 0);
        return true;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((index) => items.length ? (index + 1) % items.length : 0);
        return true;
      }
      if (event.key === 'Enter' && items.length > 0) {
        event.preventDefault();
        select(selectedIndex);
        return true;
      }
      return false;
    },
  }), [items, selectedIndex, select]);

  return (
    <div className="w-[min(360px,calc(100vw-20px))] rounded-xl border border-border bg-background/95 p-2 shadow-2xl backdrop-blur-xl">
      <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">Кастомные эмодзи для {query}</div>
      {items.length === 0 ? <div className="px-2 py-3 text-sm text-muted-foreground">Для этого эмодзи пока нет вариантов</div> : (
        <div className="space-y-1">
          {items.map((emoji, index) => (
            <button key={emoji.id} type="button" onClick={() => select(index)} onMouseEnter={() => setSelectedIndex(index)} className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left ${index === selectedIndex ? 'bg-muted' : 'hover:bg-muted/60'}`}>
              <img src={storageUrl('emojis', emoji.image_url) || ''} alt={emoji.name} className="h-8 w-8 object-contain" draggable={false} />
              <span className="min-w-0 flex-1 truncate text-sm">Кастомный эмодзи</span>
              <span className="text-xs text-muted-foreground">{emoji.is_animated ? 'GIF' : 'WEBP'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
CustomEmojiSuggestions.displayName = 'CustomEmojiSuggestions';
