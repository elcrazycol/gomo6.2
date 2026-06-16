import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { api } from "@/integrations/api/compat";
import { User } from "lucide-react";

// Cache for user search results
const searchCache = new Map<string, any[]>();

interface User {
  id: string;
  username: string;
  account_number?: number;
  post_count?: number;
}

interface UserMentionsProps {
  content: string;
  onContentChange: (content: string) => void;
  onUserSelect: (user: User) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  getContent?: () => string;
  setContent?: (content: string) => void;
  getCursorPos?: () => number;
  getCursorRect?: () => DOMRect | null;
  getEditorEl?: () => HTMLElement | null;
  focusInput?: () => void;
  setCursorPos?: (pos: number) => void;
}

export const UserMentions = ({ content, onContentChange, onUserSelect, textareaRef, getContent, setContent, getCursorPos, getCursorRect, getEditorEl, focusInput, setCursorPos }: UserMentionsProps) => {
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const popupRef = useRef<HTMLDivElement>(null);
  const [cursorPosition, setCursorPosition] = useState({ top: 0, left: 0, width: 0 });

  // Get cursor position in textarea (fallback)
  const getCursorPosition = (textarea: HTMLTextAreaElement) => {
    const { selectionStart } = textarea;
    const textBeforeCursor = textarea.value.substring(0, selectionStart);

    // Create a temporary div to measure text
    const div = document.createElement('div');
    const styles = window.getComputedStyle(textarea);

    // Copy styles from textarea
    div.style.font = styles.font;
    div.style.fontSize = styles.fontSize;
    div.style.fontFamily = styles.fontFamily;
    div.style.lineHeight = styles.lineHeight;
    div.style.whiteSpace = 'pre-wrap';
    div.style.wordWrap = 'break-word';
    div.style.width = textarea.clientWidth + 'px';
    div.style.position = 'absolute';
    div.style.top = '-9999px';
    div.style.left = '-9999px';
    div.style.visibility = 'hidden';

    document.body.appendChild(div);
    div.textContent = textBeforeCursor;
    const rect = div.getBoundingClientRect();
    document.body.removeChild(div);

    const textareaRect = textarea.getBoundingClientRect();

    return {
      top: textareaRect.top + rect.height - textarea.scrollTop + 5,
      left: textareaRect.left + 10,
      width: 0
    };
  };

  // Search users function
  const searchUsers = async (query: string) => {
    setLoading(true);

    // Check cache first
    if (searchCache.has(query)) {
      setUsers(searchCache.get(query)!);
      setLoading(false);
      return;
    }

    try {
      let queryBuilder = api
        .from('profiles')
        .select('id, username, account_number, post_count')
        .not('username', 'is', null)
        .limit(10);

      if (query.length > 0) {
        // If query looks like a number, prioritize exact account_number match
        if (/^\d+$/.test(query)) {
          const accountNum = parseInt(query);
          queryBuilder = queryBuilder.or(`account_number.eq.${accountNum},username.ilike.%${query}%`);
        } else {
          // Build search conditions for username search
          const conditions: string[] = [`username.ilike.%${query}%`];

          // If query looks like UUID, search by id
          if (query.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
            conditions.push(`id.eq.${query}`);
          }

          queryBuilder = queryBuilder.or(conditions.join(','));
        }
      }

      const { data, error } = await queryBuilder;

      if (error) {
        console.error('Error searching users:', error);
        setUsers([]);
        searchCache.set(query, []);
      } else {
        const usersData = (data || []).map((user: { id: string; username: string; account_number?: number; post_count?: number }) => ({
          id: user.id,
          username: user.username,
          account_number: user.account_number,
          post_count: user.post_count || 0,
          color: '' // Will be loaded separately if needed
        }));

        // If query is a number, sort to prioritize exact account_number matches
        if (/^\d+$/.test(query)) {
          const accountNum = parseInt(query);
          usersData.sort((a, b) => {
            const aExact = a.account_number === accountNum ? 1 : 0;
            const bExact = b.account_number === accountNum ? 1 : 0;
            if (aExact !== bExact) return bExact - aExact;
            return a.username.localeCompare(b.username);
          });
        } else {
          // Sort by username for text queries
          usersData.sort((a, b) => a.username.localeCompare(b.username));
        }

        setUsers(usersData);
        searchCache.set(query, usersData);
      }
    } catch (error) {
      console.error('Error searching users:', error);
      setUsers([]);
      searchCache.set(query, []);
    }
    setLoading(false);
  };

  // Search for users when @ is typed
  useEffect(() => {
    const textarea = textareaRef.current;
    // Support both textarea and external (contentEditable) providers
    const readText = () => (getContent ? getContent() : (textarea?.value ?? content));
    const readCursor = () => (getCursorPos ? getCursorPos() : (textarea?.selectionStart ?? 0));
    const readRect = () => (getCursorRect ? getCursorRect() : null);

    const handleInput = () => {
      const text = readText();
      const cursorPos = readCursor();
      const caretRect = readRect();

      // Find the @ symbol before cursor
      const textBeforeCursor = text.substring(0, cursorPos);
      const atIndex = textBeforeCursor.lastIndexOf('@');

      if (atIndex !== -1 && (atIndex === 0 || textBeforeCursor[atIndex - 1] === ' ' || textBeforeCursor[atIndex - 1] === '\n')) {
        const query = textBeforeCursor.substring(atIndex + 1);
        // Check if query doesn't contain space or newline
        if (!query.includes(' ') && !query.includes('\n')) {
          // Valid mention - show popup
          setMentionQuery(query);
          setShowMentions(true);
          if (textarea) {
            setCursorPosition(getCursorPosition(textarea));
          } else if (caretRect) {
            // Anchor to caret rect in contentEditable
            setCursorPosition({ top: caretRect.top, left: caretRect.left, width: caretRect.width });
          }
          setSelectedIndex(0);
          searchUsers(query);
        } else {
          setShowMentions(false);
          setUsers([]);
        }
      } else {
        setShowMentions(false);
        setUsers([]);
      }

      // Update position if mentions are currently shown
      if (showMentions && atIndex !== -1 && (atIndex === 0 || textBeforeCursor[atIndex - 1] === ' ' || textBeforeCursor[atIndex - 1] === '\n')) {
        const currentQuery = textBeforeCursor.substring(atIndex + 1);
        if (!currentQuery.includes(' ') && !currentQuery.includes('\n')) {
          if (textarea) {
            setCursorPosition(getCursorPosition(textarea));
          } else if (caretRect) {
            setCursorPosition({ top: caretRect.top, left: caretRect.left, width: caretRect.width });
          }
        }
      }
    };

    if (textarea) {
      textarea.addEventListener('input', handleInput);
      textarea.addEventListener('keyup', handleInput);
      textarea.addEventListener('click', handleInput);
    } else {
      // If no textarea, we still run on content prop changes via dependency below.
      handleInput();
    }

    return () => {
      if (textarea) {
        textarea.removeEventListener('input', handleInput);
        textarea.removeEventListener('keyup', handleInput);
        textarea.removeEventListener('click', handleInput);
      }
    };
  }, [textareaRef, content, getContent, getCursorPos, getCursorRect, showMentions]); // Depend on either textarea or external providers

  // Select user and insert mention
  const selectUser = useCallback((user: User) => {
    const textarea = textareaRef.current;
    const text = getContent ? getContent() : (textarea?.value ?? content);
    const cursorPos = getCursorPos ? getCursorPos() : (textarea?.selectionStart ?? 0);

    // Find the @ symbol before cursor
    const textBeforeCursor = text.substring(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');

    if (atIndex !== -1) {
      // Replace @query with @username
      const newText = textBeforeCursor.substring(0, atIndex) + `@${user.username} ` + text.substring(cursorPos);
      if (setContent) {
        setContent(newText);
      } else {
        onContentChange(newText);
      }

      // Set cursor after the mention
      setTimeout(() => {
        if (focusInput) focusInput();
        if (setCursorPos) {
          setCursorPos(atIndex + user.username.length + 2);
        } else if (textarea) {
          textarea.focus();
          textarea.setSelectionRange(atIndex + user.username.length + 2, atIndex + user.username.length + 2);
        }
      }, 0);
    }

    setShowMentions(false);
    setUsers([]);
  }, [textareaRef, content, getContent, getCursorPos, onContentChange, setContent, focusInput, setCursorPos]);

  // Handle keyboard navigation
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !showMentions) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!showMentions || users.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => prev < users.length - 1 ? prev + 1 : 0);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => prev > 0 ? prev - 1 : users.length - 1);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (users[selectedIndex]) {
          selectUser(users[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        setShowMentions(false);
      }
    };

    textarea.addEventListener('keydown', handleKeyDown);
    return () => textarea.removeEventListener('keydown', handleKeyDown);
  }, [showMentions, users, selectedIndex, textareaRef, selectUser]);

  // Update position when mentions panel is shown
  useEffect(() => {
    if (!showMentions) return;

    const updatePosition = () => {
      const textarea = textareaRef.current;
      const caretRect = getCursorRect ? getCursorRect() : null;

      if (textarea) {
        setCursorPosition(getCursorPosition(textarea));
      } else if (caretRect) {
        setCursorPosition({ top: caretRect.top, left: caretRect.left, width: caretRect.width });
      }
    };

    // Update position immediately and after a short delay to ensure DOM is ready
    updatePosition();
    const timeout = setTimeout(updatePosition, 10);
    const raf = requestAnimationFrame(() => {
      updatePosition();
    });

    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(raf);
    };
  }, [showMentions, getCursorRect, textareaRef]);

  // Hide mentions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const popup = popupRef.current;
      if (!popup) return;
      if (popup.contains(target)) return;

      const textarea = textareaRef.current;
      if (textarea && textarea.contains(target)) return;

      const editorEl = getEditorEl ? getEditorEl() : null;
      if (editorEl && editorEl.contains(target)) return;

      setShowMentions(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [getEditorEl, textareaRef]);

  if (!showMentions || (users.length === 0 && !loading)) return null;

  // Calculate position - use callback ref to ensure position is calculated after render
  const calculatePosition = () => {
    const h = popupRef.current?.offsetHeight ?? 280;
    const w = popupRef.current?.offsetWidth ?? 320;
    const centerX = cursorPosition.left + (cursorPosition.width ?? 0) / 2;
    const unclamped = centerX - w / 2;
    const maxLeft = Math.max(10, window.innerWidth - w - 10);
    
    return {
      top: Math.max(10, cursorPosition.top - h - 8),
      left: Math.min(maxLeft, Math.max(10, unclamped))
    };
  };

  return createPortal(
    <div
      ref={(el) => {
        popupRef.current = el;
        // Update position after element is mounted
        if (el) {
          requestAnimationFrame(() => {
            const pos = calculatePosition();
            el.style.top = `${pos.top}px`;
            el.style.left = `${pos.left}px`;
          });
        }
      }}
      className="fixed z-[9999] bg-background/95 backdrop-blur-sm border border-border rounded-xl shadow-xl max-h-64 overflow-y-auto w-[calc(100vw-20px)] sm:w-auto sm:min-w-[280px] sm:max-w-[320px] animate-in fade-in-0 zoom-in-95 duration-200"
      style={{
        top: calculatePosition().top,
        left: calculatePosition().left
      }}
    >
      {loading ? (
        <div className="p-3 text-center text-muted-foreground">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mx-auto mb-2"></div>
          Поиск...
        </div>
      ) : (
        <div className="py-2">
          <div className="px-3 py-1 text-xs font-medium text-muted-foreground border-b border-border/50 mb-1">
            Выберите пользователя
          </div>
          {users.map((user, index) => (
            <button
              key={user.id}
              className={`w-full px-3 py-2.5 text-left hover:bg-muted/60 transition-all duration-150 flex items-center gap-3 rounded-md mx-1 ${
                index === selectedIndex ? 'bg-muted shadow-sm' : ''
              }`}
              onClick={() => selectUser(user)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                <User className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate text-foreground">
                  {user.username}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {user.post_count || 0} постов • ID: {user.id.slice(0, 8)}
                  {user.account_number ? ` (${user.account_number})` : null}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body
  );
};