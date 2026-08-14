import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useEmojiData, EmojiData, EmojiPackData } from '@/contexts/EmojiDataContext';
import { storageUrl } from '@/utils/storage';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Smile, Search, PackagePlus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Link } from 'react-router-dom';
import { useMobileKeyboard } from '@/hooks/useMobileKeyboard';

interface EmojiPickerProps {
  onEmojiSelect: (data: { emojiId: string; packId: string; url: string; name: string }) => void;
  children?: React.ReactNode;
  triggerRef?: React.RefObject<HTMLElement>;
  /** Close the panel right after picking an emoji (e.g. one-shot pickers). */
  closeOnSelect?: boolean;
  /**
   * Mobile keyboard-replacement mode (touch only): the trigger swaps the soft
   * keyboard for this panel — the panel is sized to the exact keyboard height
   * and slides in with the same ease as the native keyboard. Visibility is
   * controlled by the parent via swapOpen / swapHeight / onSwapToggle /
   * onSwapClose (see useEmojiKeyboardSwap). Desktop keeps the normal popover.
   */
  keyboardSwap?: boolean;
  /** Controlled open state (keyboardSwap mode). */
  swapOpen?: boolean;
  /** Panel height in px — the captured keyboard height (keyboardSwap mode). */
  swapHeight?: number;
  /** Trigger toggled while in keyboardSwap mode. */
  onSwapToggle?: () => void;
  /** Close requested without returning the keyboard (outside tap / Escape). */
  onSwapClose?: () => void;
}

export const EmojiPicker = ({
  onEmojiSelect,
  children,
  triggerRef,
  closeOnSelect = false,
  keyboardSwap = false,
  swapOpen = false,
  swapHeight = 0,
  onSwapToggle,
  onSwapClose,
}: EmojiPickerProps) => {
  const { subscribedPacks, ownedPacks, isLoading } = useEmojiData();
  const { isTouch } = useMobileKeyboard();
  const keyboardMode = keyboardSwap === true && isTouch;
  const [open, setOpen] = useState(false);
  const [selectedPackId, setSelectedPackId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [isMobileSheet, setIsMobileSheet] = useState(false);
  // Keep the keyboard-swap panel mounted ~260ms after the parent flips
  // swapOpen off so it slides down like the keyboard instead of popping.
  const [swapClosing, setSwapClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!keyboardMode) return;
    if (swapOpen) {
      setSwapClosing(false);
      return;
    }
    if (!swapClosing) {
      setSwapClosing(true);
      const t = setTimeout(() => setSwapClosing(false), 280);
      return () => clearTimeout(t);
    }
  }, [keyboardMode, swapOpen, swapClosing]);

  // Below the sm breakpoint the panel renders as a bottom sheet (full width,
  // rounded top corners) — the anchor-based popover cannot be positioned
  // reliably on small screens and overflows the viewport.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const update = () => setIsMobileSheet(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const updatePosition = useCallback(() => {
    if (isMobileSheet || !triggerRef?.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const panelWidth = Math.min(320, window.innerWidth - 16);
    const buttonCenter = rect.left + rect.width / 2;
    let panelLeft = buttonCenter - panelWidth / 2;
    panelLeft = Math.max(8, Math.min(panelLeft, window.innerWidth - panelWidth - 8));

    const panelHeight = panelRef.current?.offsetHeight || 350;
    // Prefer opening above the trigger; fall back below, then clamp to the
    // viewport so the panel is never cut off vertically.
    let top = rect.top - panelHeight - 8;
    if (top < 8) {
      top = rect.bottom + 8;
      if (top + panelHeight > window.innerHeight - 8) {
        top = Math.max(8, window.innerHeight - panelHeight - 8);
      }
    }
    top = Math.max(8, Math.min(top, window.innerHeight - panelHeight - 8));

    setPosition({ top, left: panelLeft });
  }, [triggerRef, isMobileSheet]);

  useEffect(() => {
    if (!keyboardMode && open && triggerRef?.current) {
      requestAnimationFrame(updatePosition);
    }
  }, [open, keyboardMode, triggerRef, updatePosition]);

  useEffect(() => {
    const active = keyboardMode ? swapOpen || swapClosing : open;
    if (!active) return;
    const handler = (e: MouseEvent) => {
      const inPanel =
        (pickerRef.current && pickerRef.current.contains(e.target as Node)) ||
        (panelRef.current && panelRef.current.contains(e.target as Node));
      const inTrigger = triggerRef?.current && triggerRef.current.contains(e.target as Node);
      if (!inPanel && !inTrigger) {
        if (keyboardMode) onSwapClose?.();
        else setOpen(false);
      }
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (keyboardMode) onSwapClose?.();
        else setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', escHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', escHandler);
    };
  }, [keyboardMode, swapOpen, swapClosing, open, triggerRef, onSwapClose]);

  const getFilteredEmojis = useCallback((pack: EmojiPackData): EmojiData[] => {
    if (!pack.emojis) return [];
    if (!search) return pack.emojis;
    const query = search.trim().toLowerCase();
    return pack.emojis.filter(e =>
      (e.unicode_triggers || []).some((trigger) => trigger.toLowerCase().includes(query))
    );
  }, [search]);

  const availablePacks = [...subscribedPacks, ...ownedPacks.filter((pack) => !subscribedPacks.some((subscribed) => subscribed.id === pack.id))];
  const currentPack = availablePacks.find(p => p.id === selectedPackId) || availablePacks[0];

  const handleEmojiClick = (emoji: EmojiData, pack: EmojiPackData) => {
    const url = storageUrl('emojis', emoji.image_url);
    onEmojiSelect({ emojiId: emoji.id, packId: pack.id, url, name: emoji.name });
    if (closeOnSelect) {
      if (keyboardMode) onSwapClose?.();
      else setOpen(false);
    }
  };

  const handleTriggerClick = () => {
    if (keyboardMode) onSwapToggle?.();
    else setOpen(!open);
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleTriggerClick();
    }
  };

  // Shared panel body. In keyboard mode the search and footer are dropped so
  // the grid gets the whole keyboard-height space (Telegram-style panel).
  const renderBody = (compact: boolean) => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-full min-h-48">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
        </div>
      );
    }
    if (availablePacks.length === 0) {
      return (
        <div className="p-6 text-center text-muted-foreground">
          <PackagePlus className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm mb-3">Нет подписанных паков</p>
          <Link to="/emojis" onClick={() => (keyboardMode ? onSwapClose?.() : setOpen(false))}>
            <Button variant="outline" size="sm">Найти паки</Button>
          </Link>
        </div>
      );
    }
    return (
      <div className={`flex flex-col ${compact ? 'h-full' : 'max-h-96 max-sm:max-h-none'}`}>
        {!compact && (
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
        )}

        {/* Pack tabs */}
        <div className="flex gap-1 p-2 border-b overflow-x-auto">
          {availablePacks.map((pack) => (
            <Button
              key={pack.id}
              variant={(currentPack?.id === pack.id && !search) ? "default" : "ghost"}
              size="sm"
              className="h-8 w-8 p-0 shrink-0 max-sm:h-7 max-sm:w-7"
              onClick={() => { setSelectedPackId(pack.id); setSearch(''); }}
              title={pack.name}
            >
              {pack.icon_url ? (
                <img src={storageUrl('emojis', pack.icon_url)} alt={pack.name} className="w-5 h-5 object-contain max-sm:h-4 max-sm:w-4" />
              ) : (
                <span className="text-xs">{pack.name.charAt(0)}</span>
              )}
            </Button>
          ))}
        </div>

        {/* Emoji grid */}
        <ScrollArea className="flex-1 p-2 min-h-0">
          {search ? (
            // Search results across all packs
            availablePacks.map(pack => {
              const filtered = getFilteredEmojis(pack);
              if (filtered.length === 0) return null;
              return (
                <div key={pack.id} className="mb-3">
                  <h4 className="text-xs font-medium text-muted-foreground mb-1 px-1">{pack.name}</h4>
                  <div className="grid grid-cols-8 gap-1 max-sm:grid-cols-7">
                    {filtered.map(emoji => (
                      <button
                        key={emoji.id}
                        className="h-9 w-9 p-0 hover:bg-muted rounded flex items-center justify-center max-sm:h-8 max-sm:w-8"
                        onClick={() => handleEmojiClick(emoji, pack)}
                        title={(emoji.unicode_triggers || []).join(' ') || 'Кастомный эмодзи'}
                      >
                        <img src={storageUrl('emojis', emoji.image_url)} alt={emoji.name} className="w-6 h-6 object-contain max-sm:h-5 max-sm:w-5" />
                      </button>
                    ))}
                  </div>
                </div>
              );
            })
          ) : currentPack ? (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-1 px-1">{currentPack.name}</h4>
              <div className="grid grid-cols-8 gap-1 max-sm:grid-cols-7">
                {(currentPack.emojis || []).map(emoji => (
                  <button
                    key={emoji.id}
                    className="h-9 w-9 p-0 hover:bg-muted rounded flex items-center justify-center max-sm:h-8 max-sm:w-8"
                    onClick={() => handleEmojiClick(emoji, currentPack)}
                    title={(emoji.unicode_triggers || []).join(' ') || 'Кастомный эмодзи'}
                  >
                    <img src={storageUrl('emojis', emoji.image_url)} alt={emoji.name} className="w-6 h-6 object-contain max-sm:h-5 max-sm:w-5" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </ScrollArea>

        {!compact && (
          <div className="p-2 border-t">
            <Link to="/emojis" onClick={() => setOpen(false)} className="w-full">
              <Button variant="ghost" size="sm" className="w-full text-xs">
                <PackagePlus className="h-3 w-3 mr-1" />
                Обзор паков
              </Button>
            </Link>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        data-testid="emoji-picker-trigger"
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        ref={triggerRef as React.Ref<HTMLDivElement>}
      >
        {children || (
          <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl shrink-0">
            <Smile className="h-5 w-5" />
          </Button>
        )}
      </div>

      {keyboardMode ? (
        (swapOpen || swapClosing) && createPortal(
          <div
            ref={pickerRef}
            data-testid="emoji-keyboard-panel"
            className="fixed inset-x-0 bottom-0 z-[100] overflow-hidden rounded-t-2xl border-t border-border bg-background/95 backdrop-blur-xl shadow-2xl"
            style={{
              height: swapHeight || 300,
              animation: swapClosing
                ? 'emoji-sheet-down 240ms cubic-bezier(0.4, 0, 0.2, 1) both'
                : 'emoji-sheet-up 260ms cubic-bezier(0.22, 1, 0.36, 1) both',
            }}
          >
            {renderBody(true)}
          </div>,
          document.body
        )
      ) : (
        open && createPortal(
          <div
            ref={panelRef}
            className={`fixed z-[100] w-80 max-w-[calc(100vw-16px)] bg-background/95 backdrop-blur-xl border border-border shadow-2xl overflow-hidden rounded-2xl max-sm:inset-x-0 max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none max-sm:rounded-t-2xl`}
            style={{
              ...(isMobileSheet ? {} : { top: position.top, left: position.left, maxHeight: '400px' }),
              ...(isMobileSheet ? { maxHeight: '75dvh' } : {}),
            }}
          >
            {renderBody(false)}
          </div>,
          document.body
        )
      )}
    </>
  );
};
