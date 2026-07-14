import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useEmojiData, EmojiData, EmojiPackData } from '@/contexts/EmojiDataContext';
import { storageUrl } from '@/utils/storage';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Smile, Search, PackagePlus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Link } from 'react-router-dom';

interface EmojiPickerProps {
  onEmojiSelect: (data: { emojiId: string; packId: string; url: string; name: string }) => void;
  children?: React.ReactNode;
  triggerRef?: React.RefObject<HTMLElement>;
}

export const EmojiPicker = ({ onEmojiSelect, children, triggerRef }: EmojiPickerProps) => {
  const { subscribedPacks, allEmojis, isLoading } = useEmojiData();
  const [open, setOpen] = useState(false);
  const [selectedPackId, setSelectedPackId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (triggerRef?.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const panelWidth = 320;
      const buttonCenter = rect.left + rect.width / 2;
      let panelLeft = buttonCenter - panelWidth / 2;
      panelLeft = Math.max(8, Math.min(panelLeft, window.innerWidth - panelWidth - 8));

      const panelHeight = panelRef.current?.offsetHeight || 350;
      const top = rect.top - panelHeight - 8;

      setPosition({ top: top < 8 ? rect.bottom + 8 : top, left: panelLeft });
    }
  }, [triggerRef]);

  useEffect(() => {
    if (open && triggerRef?.current) {
      requestAnimationFrame(updatePosition);
    }
  }, [open, triggerRef, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        pickerRef.current && !pickerRef.current.contains(e.target as Node) &&
        triggerRef?.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', escHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', escHandler);
    };
  }, [open, triggerRef]);

  const getFilteredEmojis = useCallback((pack: EmojiPackData): EmojiData[] => {
    if (!pack.emojis) return [];
    if (!search) return pack.emojis;
    return pack.emojis.filter(e =>
      e.name.toLowerCase().includes(search.toLowerCase())
    );
  }, [search]);

  const currentPack = subscribedPacks.find(p => p.id === selectedPackId) || subscribedPacks[0];

  const handleEmojiClick = (emoji: EmojiData, pack: EmojiPackData) => {
    const url = storageUrl('emojis', emoji.image_url);
    onEmojiSelect({ emojiId: emoji.id, packId: pack.id, url, name: emoji.name });
  };

  return (
    <>
      <div
        onClick={() => setOpen(!open)}
        ref={triggerRef as React.Ref<HTMLDivElement>}
      >
        {children || (
          <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl shrink-0">
            <Smile className="h-5 w-5" />
          </Button>
        )}
      </div>

      {open && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[100] w-80 bg-background/95 backdrop-blur-xl border border-border rounded-2xl shadow-2xl overflow-hidden"
          style={{ top: position.top, left: position.left, maxHeight: '400px' }}
        >
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : subscribedPacks.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">
              <PackagePlus className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm mb-3">Нет подписанных паков</p>
              <Link to="/emojis" onClick={() => setOpen(false)}>
                <Button variant="outline" size="sm">Найти паки</Button>
              </Link>
            </div>
          ) : (
            <div className="max-h-96 flex flex-col">
              {/* Search */}
              <div className="p-2 border-b">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Поиск эмодзи..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8 h-8 text-sm"
                  />
                </div>
              </div>

              {/* Pack tabs */}
              <div className="flex gap-1 p-2 border-b overflow-x-auto">
                {subscribedPacks.map((pack) => (
                  <Button
                    key={pack.id}
                    variant={(currentPack?.id === pack.id && !search) ? "default" : "ghost"}
                    size="sm"
                    className="h-8 w-8 p-0 shrink-0"
                    onClick={() => { setSelectedPackId(pack.id); setSearch(''); }}
                    title={pack.name}
                  >
                    {pack.icon_url ? (
                      <img src={storageUrl('emojis', pack.icon_url)} alt={pack.name} className="w-5 h-5 object-contain" />
                    ) : (
                      <span className="text-xs">{pack.name.charAt(0)}</span>
                    )}
                  </Button>
                ))}
              </div>

              {/* Emoji grid */}
              <ScrollArea className="flex-1 p-2">
                {search ? (
                  // Search results across all packs
                  subscribedPacks.map(pack => {
                    const filtered = getFilteredEmojis(pack);
                    if (filtered.length === 0) return null;
                    return (
                      <div key={pack.id} className="mb-3">
                        <h4 className="text-xs font-medium text-muted-foreground mb-1 px-1">{pack.name}</h4>
                        <div className="grid grid-cols-8 gap-1">
                          {filtered.map(emoji => (
                            <button
                              key={emoji.id}
                              className="h-9 w-9 p-0 hover:bg-muted rounded flex items-center justify-center"
                              onClick={() => handleEmojiClick(emoji, pack)}
                              title={emoji.name}
                            >
                              <img src={storageUrl('emojis', emoji.image_url)} alt={emoji.name} className="w-6 h-6 object-contain" />
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })
                ) : currentPack ? (
                  <div>
                    <h4 className="text-xs font-medium text-muted-foreground mb-1 px-1">{currentPack.name}</h4>
                    <div className="grid grid-cols-8 gap-1">
                      {(currentPack.emojis || []).map(emoji => (
                        <button
                          key={emoji.id}
                          className="h-9 w-9 p-0 hover:bg-muted rounded flex items-center justify-center"
                          onClick={() => handleEmojiClick(emoji, currentPack)}
                          title={emoji.name}
                        >
                          <img src={storageUrl('emojis', emoji.image_url)} alt={emoji.name} className="w-6 h-6 object-contain" />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </ScrollArea>

              {/* Footer */}
              <div className="p-2 border-t">
                <Link to="/emojis" onClick={() => setOpen(false)} className="w-full">
                  <Button variant="ghost" size="sm" className="w-full text-xs">
                    <PackagePlus className="h-3 w-3 mr-1" />
                    Обзор паков
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
};
