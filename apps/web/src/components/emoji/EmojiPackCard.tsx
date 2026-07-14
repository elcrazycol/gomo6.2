import { Link } from 'react-router-dom';
import { storageUrl } from '@/utils/storage';
import { Package, Users } from 'lucide-react';
import { EmojiPackData } from '@/contexts/EmojiDataContext';

interface EmojiPackCardProps {
  pack: EmojiPackData;
}

export function EmojiPackCard({ pack }: EmojiPackCardProps) {
  return (
    <Link
      to={`/emojis/pack/${pack.slug}`}
      className="block p-4 rounded-xl border hover:bg-muted/50 transition-all hover:shadow-sm"
    >
      <div className="flex items-start gap-3">
        {pack.icon_url ? (
          <img src={storageUrl('emojis', pack.icon_url)} alt={pack.name} className="w-12 h-12 object-contain rounded-lg" />
        ) : (
          <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center">
            <Package className="h-6 w-6 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{pack.name}</div>
          {pack.description && (
            <div className="text-sm text-muted-foreground truncate">{pack.description}</div>
          )}
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span>{pack.emoji_count} эмодзи</span>
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {pack.subscriber_count}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
