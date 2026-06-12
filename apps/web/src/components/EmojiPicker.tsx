import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Smile, Loader2 } from 'lucide-react';

interface EmojiGroup {
  id: string;
  name: string;
}

interface Emoji {
  id: string;
  name: string;
  code: string;
  image_url: string;
  group_id: string;
}

interface EmojiPickerProps {
  onEmojiSelect: (emojiCode: string) => void;
  children?: React.ReactNode;
  triggerRef?: React.RefObject<HTMLElement>;
}

export const EmojiPicker = ({ onEmojiSelect, children, triggerRef }: EmojiPickerProps) => {
  const [groups, setGroups] = useState<EmojiGroup[]>([]);
  const [emojis, setEmojis] = useState<Emoji[]>([]);
  const [groupedEmojis, setGroupedEmojis] = useState<Record<string, Emoji[]>>({});
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [panelHeight, setPanelHeight] = useState(300); // More realistic initial height
  const [closeTimeout, setCloseTimeout] = useState<NodeJS.Timeout | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Check if device is mobile
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768 || 'ontouchstart' in window);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const updatePosition = useCallback(() => {
    if (triggerRef?.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      let currentPanelHeight = panelHeight; // Use measured height, fallback to initial estimate

      // If panel exists, use its actual height
      if (panelRef.current) {
        currentPanelHeight = panelRef.current.offsetHeight;
      }

      // Always position above button
      const top = rect.top - currentPanelHeight;

      // Center panel horizontally relative to button
      const panelWidth = 320;
      const buttonCenter = rect.left + rect.width / 2;
      const panelLeft = buttonCenter - panelWidth / 2;

      // Ensure panel stays within viewport bounds
      const clampedLeft = Math.max(8, Math.min(panelLeft, window.innerWidth - panelWidth - 8));

      setPosition({
        top,
        left: clampedLeft
      });
    }
  }, [triggerRef, panelHeight]);

  const groupEmojis = useCallback(() => {
    const grouped = emojis.reduce((acc, emoji) => {
      const groupId = emoji.group_id;
      if (!acc[groupId]) {
        acc[groupId] = [];
      }
      acc[groupId].push(emoji);
      return acc;
    }, {} as Record<string, Emoji[]>);

    setGroupedEmojis(grouped);
  }, [emojis]);

  useEffect(() => {
    if (open) {
      loadEmojis();
      // Calculate initial position immediately - always position above button
      if (triggerRef?.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const estimatedHeight = 300; // More realistic initial estimate
        const top = rect.top - estimatedHeight; // Position above button with estimated height
        const panelWidth = 320;
        const buttonCenter = rect.left + rect.width / 2;
        const panelLeft = buttonCenter - panelWidth / 2;
        const clampedLeft = Math.max(8, Math.min(panelLeft, window.innerWidth - panelWidth - 8));
        
        setPosition({ top, left: clampedLeft });
      }
      
      // Update position after content loads and panel is measured
      requestAnimationFrame(() => {
        if (panelRef.current) {
          const height = panelRef.current.offsetHeight;
          setPanelHeight(height);
          updatePosition();
        }
      });
    }
  }, [open, triggerRef, updatePosition]);

  useEffect(() => {
    if (open && panelRef.current) {
      const height = panelRef.current.offsetHeight;
      setPanelHeight(height);
      updatePosition();
    }
  }, [open, loading, updatePosition]); // Re-measure when content loads

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isMobile && open) {
        if (
          pickerRef.current &&
          !pickerRef.current.contains(event.target as Node) &&
          triggerRef?.current &&
          !triggerRef.current.contains(event.target as Node)
        ) {
          setOpen(false);
        }
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        if (closeTimeout) {
          clearTimeout(closeTimeout);
          setCloseTimeout(null);
        }
      }
    };

    if (isMobile) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    document.addEventListener('keydown', handleEscape);

    return () => {
      if (isMobile) {
        document.removeEventListener('mousedown', handleClickOutside);
      }
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isMobile, open, closeTimeout, triggerRef]);

  const openPicker = () => {
    if (closeTimeout) {
      clearTimeout(closeTimeout);
      setCloseTimeout(null);
    }
    setOpen(true);
  };      const handleButtonMouseLeave = (_e: React.MouseEvent) => {
    // Don't close immediately - let the user move to the panel
    // The panel will handle closing when mouse leaves it
  };

  const handlePanelMouseLeave = (e: React.MouseEvent) => {
    // Check if we're actually leaving the panel/button area
    const relatedTarget = e.relatedTarget as HTMLElement;
    const isLeavingToButton = triggerRef?.current?.contains(relatedTarget);

    // Only close if we're not moving back to the button
    if (!isLeavingToButton) {
      closePicker();
    }
  };

  const closePicker = () => {
    // Clear any existing timeout
    if (closeTimeout) clearTimeout(closeTimeout);
    // Close immediately when mouse leaves panel area
    setOpen(false);
  };

  useEffect(() => {
    if (emojis.length > 0) {
      groupEmojis();
      if (!selectedGroup && groups.length > 0) {
        setSelectedGroup(groups[0].id);
      }
    }
  }, [emojis, groups, groupEmojis, selectedGroup]);

  const loadEmojis = async () => {
    try {
      setLoading(true);

      // TODO: Implement emoji system when tables are created
      // For now, just set empty arrays to prevent errors
      setGroups([]);
      setEmojis([]);
      setGroupedEmojis({});
    } catch {
      console.error('Error loading emojis:', error);
    } finally {
      setLoading(false);
    }
  };

  const scrollToGroup = (groupId: string) => {
    setSelectedGroup(groupId);
    const element = document.getElementById(`emoji-group-${groupId}`);
    if (element && scrollAreaRef.current) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleEmojiClick = (emojiCode: string) => {
    onEmojiSelect(`:${emojiCode}:`);
    // Don't close picker - let user continue selecting emojis
  };

  const renderGroupNavigation = () => {
    if (groups.length === 0) return null;

    return (
      <div className="flex gap-1 p-2 bg-muted/50 border-b">
        {groups.map((group) => {
          const groupEmojis = groupedEmojis[group.id] || [];
          const firstEmoji = groupEmojis[0];

          return (
            <Button
              key={group.id}
              variant={selectedGroup === group.id ? "default" : "ghost"}
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => scrollToGroup(group.id)}
              title={group.name}
            >
              {firstEmoji ? (
                <img
                  src={firstEmoji.image_url}
                  alt={firstEmoji.name}
                  className="w-5 h-5 object-contain"
                />
              ) : (
                <span className="text-xs">?</span>
              )}
            </Button>
          );
        })}
      </div>
    );
  };

  const renderEmojiGroups = () => {
    return groups.map((group) => {
      const groupEmojis = groupedEmojis[group.id] || [];

      if (groupEmojis.length === 0) return null;

      return (
        <div key={group.id} id={`emoji-group-${group.id}`} className="mb-4">
          <h4 className="text-sm font-medium text-muted-foreground mb-2 px-2">
            {group.name}
          </h4>
          <div className="grid grid-cols-8 gap-1">
            {groupEmojis.map((emoji) => (
              <Button
                key={emoji.id}
                variant="ghost"
                size="sm"
                className="h-10 w-10 p-0 hover:bg-muted"
                onClick={() => handleEmojiClick(emoji.code)}
                title={`:${emoji.code}:`}
              >
                <img
                  src={emoji.image_url}
                  alt={emoji.name}
                  className="w-7 h-7 object-contain"
                />
              </Button>
            ))}
          </div>
          <Separator className="mt-4" />
        </div>
      );
    });
  };

  return (
    <>
      {/* Trigger button */}
      <div
        onClick={isMobile ? () => setOpen(!open) : undefined}
        onMouseEnter={!isMobile ? openPicker : undefined}
        onMouseLeave={!isMobile ? handleButtonMouseLeave : undefined}
        ref={(triggerRef as React.Ref<HTMLDivElement>) ?? undefined}
      >
        {children || (
          <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl shrink-0">
            <Smile className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* Portal for the picker */}
      {open && createPortal(
        <div
          ref={(el) => {
            if (el && panelRef.current !== el) {
              panelRef.current = el;
              // Update position after render with proper measurement
              requestAnimationFrame(() => {
                updatePosition();
              });
            }
          }}
          className="fixed z-[100] w-80 bg-background/95 backdrop-blur-xl border border-border rounded-2xl shadow-2xl overflow-hidden"
          style={{
            top: position.top,
            left: position.left,
            maxHeight: '400px'
          }}
          onMouseLeave={!isMobile ? handlePanelMouseLeave : undefined}
        >
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <div className="max-h-96 flex flex-col">
              {renderGroupNavigation()}
              <ScrollArea className="flex-1 p-2" ref={scrollAreaRef}>
                {renderEmojiGroups()}
              </ScrollArea>
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
};