import { EmojiData } from '@/contexts/EmojiDataContext';
import { storageUrl } from '@/utils/storage';
import { Trash2 } from 'lucide-react';

interface EmojiGridProps {
  emojis: EmojiData[];
  onRemove?: (emojiId: string) => void;
  selectable?: boolean;
  onSelect?: (emoji: EmojiData) => void;
}

export function EmojiGrid({ emojis, onRemove, selectable, onSelect }: EmojiGridProps) {
  if (emojis.length === 0) {
    return <div className="text-center py-8 text-muted-foreground text-sm">Нет эмодзи. Добавьте первый!</div>;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {emojis.map((emoji) => (
        <div
          key={emoji.id}
          className={`relative group flex min-h-24 items-center gap-3 rounded-xl border p-2 transition-all ${selectable ? 'cursor-pointer hover:border-primary hover:ring-1 hover:ring-primary' : 'hover:bg-muted/30'}`}
          onClick={() => selectable && onSelect?.(emoji)}
          onKeyDown={(event) => {
            if (selectable && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault();
              onSelect?.(emoji);
            }
          }}
          role={selectable ? 'button' : undefined}
          tabIndex={selectable ? 0 : undefined}
        >
          <img src={storageUrl('emojis', emoji.image_url) || ''} alt={emoji.name} className="h-16 w-16 shrink-0 object-contain" draggable={false} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">Кастомный эмодзи</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {(emoji.unicode_triggers || []).map((trigger) => <span key={trigger} className="rounded-full bg-muted px-1.5 py-0.5 text-base leading-none">{trigger}</span>)}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">{emoji.is_animated ? 'Анимация' : 'WebP'} · 128px</div>
          </div>
          {onRemove && (
            <button type="button" className="absolute right-1 top-1 rounded-full bg-destructive/80 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100" onClick={(event) => { event.stopPropagation(); onRemove(emoji.id); }} title="Удалить эмодзи" aria-label={`Удалить ${emoji.name}`}>
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
