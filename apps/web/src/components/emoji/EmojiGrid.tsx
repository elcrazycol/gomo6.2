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
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        Нет эмодзи. Добавьте первый!
      </div>
    );
  }

  return (
    <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
      {emojis.map((emoji) => (
        <div
          key={emoji.id}
          className={`relative group aspect-square border rounded-lg overflow-hidden ${
            selectable ? 'cursor-pointer hover:border-primary hover:ring-1 hover:ring-primary' : ''
          }`}
          onClick={() => selectable && onSelect?.(emoji)}
        >
          <img
            src={storageUrl('emojis', emoji.image_url)}
            alt={emoji.name}
            className="w-full h-full object-contain p-1"
            draggable={false}
          />
          {onRemove && (
            <button
              className="absolute top-0.5 right-0.5 bg-destructive/80 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(emoji.id);
              }}
              title="Удалить"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
          <div className="absolute bottom-0 left-0 right-0 bg-background/80 text-[10px] text-center py-0.5 truncate px-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {emoji.name}
          </div>
        </div>
      ))}
    </div>
  );
}
