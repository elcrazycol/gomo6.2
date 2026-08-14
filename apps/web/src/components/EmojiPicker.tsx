import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useEmojiData, EmojiData, EmojiPackData } from '@/contexts/EmojiDataContext';
import { storageUrl } from '@/utils/storage';
import { Button } from '@/components/ui/button';
import { Smile, Clock, Plus, PackagePlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMobileKeyboard } from '@/hooks/useMobileKeyboard';
import {
  getRecentEmojis,
  addRecentEmoji,
  subscribeRecentEmojis,
  RecentEmoji,
} from '@/lib/recentEmojis';

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

/**
 * Panel layout shared by both the mobile keyboard-replacement sheet and the
 * desktop popover:
 *
 *  • header — sticky tab bar: [недавние] [pack…] [+]; the active tab follows
 *    the section currently under the header as you scroll (scroll-spy) and is
 *    kept centered in the bar;
 *  • body — every pack (and the "Недавние" history section, when non-empty)
 *    stacked one after another in a single scrollable list, so you scroll
 *    pack after pack;
 *  • the rightmost "+" jumps to the emoji catalog page (/emojis).
 */
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
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [isMobileSheet, setIsMobileSheet] = useState(false);
  // Keep the keyboard-swap panel mounted through its exit animation after the
  // parent flips swapOpen off so it slides down like the keyboard instead of
  // popping. The timer lives in a ref and is only cleared on unmount/reopen —
  // if it were an effect-local cleanup, the re-render caused by the state
  // change itself would clear it before it ever fires (stuck mounted panel).
  const [swapClosing, setSwapClosing] = useState(false);
  const swapCloseTimer = useRef<number | null>(null);
  const prevSwapOpen = useRef(swapOpen);
  const panelRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const rafRef = useRef<number | null>(null);

  const [recent, setRecent] = useState<RecentEmoji[]>(() => getRecentEmojis());
  const [activeSectionId, setActiveSectionId] = useState('');

  // Keep open pickers in sync when another one records an emoji.
  useEffect(() => subscribeRecentEmojis(() => setRecent(getRecentEmojis())), []);

  useEffect(() => {
    if (!keyboardMode) return;
    const wasOpen = prevSwapOpen.current;
    prevSwapOpen.current = swapOpen;
    if (swapOpen) {
      if (swapCloseTimer.current !== null) {
        clearTimeout(swapCloseTimer.current);
        swapCloseTimer.current = null;
      }
      setSwapClosing(false);
      if (!wasOpen) {
        // Fresh open: always land on the top of the stack (recent emojis),
        // never mid-stack from a previous session.
        const el = scrollRef.current;
        if (el && typeof el.scrollTo === 'function') el.scrollTo({ top: 0 });
      }
      return;
    }
    // Only animate the exit when the panel was actually open — a fresh mount
    // with swapOpen=false must not flash an invisible closing panel.
    if (wasOpen) {
      setSwapClosing(true);
      if (swapCloseTimer.current === null) {
        // Safety net: if the panel's exit animation never fires (reduced
        // motion / odd browser), force the unmount shortly after.
        swapCloseTimer.current = window.setTimeout(() => {
          setSwapClosing(false);
          swapCloseTimer.current = null;
        }, 300);
      }
    }
    return () => {
      if (swapCloseTimer.current !== null) {
        clearTimeout(swapCloseTimer.current);
        swapCloseTimer.current = null;
      }
    };
  }, [keyboardMode, swapOpen]);

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

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const availablePacks = useMemo(
    () => [
      ...subscribedPacks,
      ...ownedPacks.filter((pack) => !subscribedPacks.some((subscribed) => subscribed.id === pack.id)),
    ],
    [subscribedPacks, ownedPacks]
  );

  // The stacked scroll list: history first, then every pack one after another.
  const sections = useMemo(() => {
    const list: { id: string; title: string }[] = [];
    if (recent.length > 0) list.push({ id: 'recent', title: 'Недавние' });
    for (const pack of availablePacks) list.push({ id: pack.id, title: pack.name });
    return list;
  }, [recent, availablePacks]);

  // Keep the active tab valid while packs stream in / history changes: fall
  // back to the first section without scrolling the list.
  useEffect(() => {
    if (sections.length === 0) {
      setActiveSectionId('');
      return;
    }
    setActiveSectionId((prev) => (sections.some((s) => s.id === prev) ? prev : sections[0].id));
  }, [sections]);

  const handleScroll = useCallback(() => {
    const compute = () => {
      const el = scrollRef.current;
      if (!el) return;
      const containerTop = el.getBoundingClientRect().top;
      let current = sections[0]?.id ?? '';
      for (const section of sectionRefs.current.values()) {
        if (section.getBoundingClientRect().top - containerTop <= 32) {
          current = section.dataset.sectionId ?? current;
        } else {
          break;
        }
      }
      // Fully scrolled to the bottom → the last section is active even if its
      // header never crossed the top (short trailing pack).
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) {
        current = sections[sections.length - 1]?.id ?? current;
      }
      setActiveSectionId(current);
    };
    if (typeof requestAnimationFrame === 'function') {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        compute();
      });
    } else {
      compute();
    }
  }, [sections]);

  const scrollToSection = useCallback((id: string) => {
    const el = scrollRef.current;
    const section = sectionRefs.current.get(id);
    if (el && section && typeof el.scrollTo === 'function') {
      const containerTop = el.getBoundingClientRect().top;
      const target = section.getBoundingClientRect().top - containerTop + el.scrollTop - 8;
      el.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }
    setActiveSectionId(id);
  }, []);

  // Keep the active tab centered in the (horizontally scrollable) tab bar.
  useEffect(() => {
    const bar = tabBarRef.current;
    const tab = activeSectionId ? tabRefs.current.get(activeSectionId) : null;
    if (!bar || !tab || typeof bar.scrollTo !== 'function') return;
    const barRect = bar.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    const left = bar.scrollLeft + (tabRect.left - barRect.left) - bar.clientWidth / 2 + tabRect.width / 2;
    bar.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [activeSectionId]);

  const setTabRef = (id: string) => (el: HTMLButtonElement | null) => {
    if (el) tabRefs.current.set(id, el);
    else tabRefs.current.delete(id);
  };

  const setSectionRef = (id: string) => (el: HTMLElement | null) => {
    if (el) sectionRefs.current.set(id, el);
    else sectionRefs.current.delete(id);
  };

  const handleEmojiClick = (emoji: EmojiData, pack: EmojiPackData) => {
    const url = storageUrl('emojis', emoji.image_url);
    const data = { emojiId: emoji.id, packId: pack.id, url, name: emoji.name };
    addRecentEmoji(data);
    onEmojiSelect(data);
    if (closeOnSelect) {
      if (keyboardMode) onSwapClose?.();
      else setOpen(false);
    }
  };

  const handleRecentClick = (emoji: RecentEmoji) => {
    // Re-picking a recent emoji bumps it to the front of the history.
    addRecentEmoji(emoji);
    onEmojiSelect(emoji);
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

  // Shared panel body: header tab bar + stacked scrollable sections.
  const renderBody = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center flex-1 min-h-48">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
        </div>
      );
    }
    if (sections.length === 0) {
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
      // flex-1 (not h-full): inside a max-height-constrained flex column this
      // is the only way the inner scroll container gets a bounded height — a
      // percentage height would resolve against auto and the stacked list
      // would be clipped by the panel's overflow-hidden instead of scrolling.
      <div className="flex flex-col flex-1 min-h-0">
        {/* Tab bar: history (left) · packs · "+" catalog shortcut (right) */}
        <div
          ref={tabBarRef}
          className="flex gap-1 p-2 border-b overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {recent.length > 0 && (
            <Button
              ref={setTabRef('recent')}
              variant={activeSectionId === 'recent' ? 'default' : 'ghost'}
              size="sm"
              className="h-8 w-8 p-0 shrink-0 rounded-full max-sm:h-7 max-sm:w-7"
              onClick={() => scrollToSection('recent')}
              title="Недавно использованные"
              aria-label="Недавно использованные"
            >
              <Clock className="h-4 w-4 max-sm:h-3.5 max-sm:w-3.5" />
            </Button>
          )}
          {availablePacks.map((pack) => (
            <Button
              key={pack.id}
              ref={setTabRef(pack.id)}
              variant={activeSectionId === pack.id ? 'default' : 'ghost'}
              size="sm"
              className="h-8 w-8 p-0 shrink-0 max-sm:h-7 max-sm:w-7"
              onClick={() => scrollToSection(pack.id)}
              title={pack.name}
            >
              {pack.icon_url ? (
                <img
                  src={storageUrl('emojis', pack.icon_url)}
                  alt={pack.name}
                  className="w-5 h-5 object-contain max-sm:h-4 max-sm:w-4"
                />
              ) : (
                <span className="text-xs">{pack.name.charAt(0)}</span>
              )}
            </Button>
          ))}
          <Link
            to="/emojis"
            className="ml-auto shrink-0"
            onClick={() => (keyboardMode ? onSwapClose?.() : setOpen(false))}
            title="Все паки эмодзи"
            aria-label="Все паки эмодзи"
          >
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full max-sm:h-7 max-sm:w-7">
              <Plus className="h-4 w-4 max-sm:h-3.5 max-sm:w-3.5" />
            </Button>
          </Link>
        </div>

        {/* Stacked sections: one scroll container, pack after pack */}
        <div
          ref={scrollRef}
          data-testid="emoji-panel-scroll"
          className="flex-1 overflow-y-auto overscroll-contain min-h-0"
          onScroll={handleScroll}
        >
          {recent.length > 0 && (
            <section ref={setSectionRef('recent')} data-section-id="recent" className="pb-2">
              <h4 className="text-xs font-medium text-muted-foreground mb-1 px-1">Недавние</h4>
              <div className="grid grid-cols-8 gap-1 max-sm:grid-cols-7">
                {recent.map((emoji) => (
                  <button
                    key={emoji.emojiId}
                    className="h-9 w-9 p-0 hover:bg-muted rounded flex items-center justify-center max-sm:h-8 max-sm:w-8"
                    onClick={() => handleRecentClick(emoji)}
                    title={emoji.name}
                  >
                    <img src={emoji.url} alt={emoji.name} className="w-6 h-6 object-contain max-sm:h-5 max-sm:w-5" />
                  </button>
                ))}
              </div>
            </section>
          )}
          {availablePacks.map((pack) => (
            <section key={pack.id} ref={setSectionRef(pack.id)} data-section-id={pack.id} className="pb-2">
              <h4 className="text-xs font-medium text-muted-foreground mb-1 px-1">{pack.name}</h4>
              <div className="grid grid-cols-8 gap-1 max-sm:grid-cols-7">
                {(pack.emojis || []).map((emoji) => (
                  <button
                    key={emoji.id}
                    className="h-9 w-9 p-0 hover:bg-muted rounded flex items-center justify-center max-sm:h-8 max-sm:w-8"
                    onClick={() => handleEmojiClick(emoji, pack)}
                    title={(emoji.unicode_triggers || []).join(' ') || 'Кастомный эмодзи'}
                  >
                    <img
                      src={storageUrl('emojis', emoji.image_url)}
                      alt={emoji.name}
                      className="w-6 h-6 object-contain max-sm:h-5 max-sm:w-5"
                    />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
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
            className="fixed inset-x-0 bottom-0 z-[100] flex flex-col overflow-hidden rounded-t-2xl border-t border-border bg-background/95 backdrop-blur-xl shadow-2xl"
            style={{
              height: swapHeight || 300,
              animation: swapClosing
                ? 'emoji-sheet-down 240ms cubic-bezier(0.4, 0, 0.2, 1) both'
                : 'emoji-sheet-up 260ms cubic-bezier(0.22, 1, 0.36, 1) both',
            }}
            onAnimationEnd={(e) => {
              // Only the panel's own exit animation un-mounts it — bubbling
              // animationend from children (hover transitions etc.) is ignored.
              if (swapClosing && e.target === e.currentTarget) {
                setSwapClosing(false);
              }
            }}
          >
            {renderBody()}
          </div>,
          document.body
        )
      ) : (
        open && createPortal(
          <div
            ref={panelRef}
            data-testid="emoji-picker-popover"
            className={`fixed z-[100] w-80 max-w-[calc(100vw-16px)] flex flex-col bg-background/95 backdrop-blur-xl border border-border shadow-2xl overflow-hidden rounded-2xl max-sm:inset-x-0 max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none max-sm:rounded-t-2xl`}
            style={{
              ...(isMobileSheet ? {} : { top: position.top, left: position.left, maxHeight: 'min(520px, 70vh)' }),
              ...(isMobileSheet ? { maxHeight: '75dvh' } : {}),
            }}
          >
            {renderBody()}
          </div>,
          document.body
        )
      )}
    </>
  );
};
