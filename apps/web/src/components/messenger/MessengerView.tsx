import { useEffect, useRef, useCallback, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { PentagramLoader } from "@/components/PentagramLoader";
import { useMessengerStore, selectSelectedConversation } from "@/stores/messengerStore";
import { messengerWs } from "@/services/messengerWebSocket";
import { eventManager } from "@/services/eventManager";
import { useMessengerPresence } from "@/hooks/useMessengerPresence";
import { useMobileKeyboard } from "@/hooks/useMobileKeyboard";
import { pinDocumentForSurface, unpinDocumentForSurface } from "@/lib/mobileKeyboard";
import { MessengerErrorBoundary } from "./ErrorBoundary";
import { ConversationList } from "./ConversationList";
import { ChatView } from "./ChatView";
import type { GomoRichEditorHandle } from "@/components/GomoRichEditor";
import "./messenger.css";

const SIDEBAR_DEFAULT_WIDTH = 320;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 460;
const SIDEBAR_COLLAPSED_WIDTH = 76;
const SIDEBAR_COLLAPSE_THRESHOLD = 180;
const SIDEBAR_EXPAND_THRESHOLD = 220;
const SIDEBAR_WIDTH_STORAGE_KEY = "gomo6:messenger-sidebar-width";

function getInitialSidebarWidth() {
  if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH;
  try {
    const stored = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
    return Number.isFinite(stored) && stored >= SIDEBAR_COLLAPSED_WIDTH && stored <= SIDEBAR_MAX_WIDTH
      ? stored
      : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

function saveSidebarWidth(width: number) {
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // Storage can be unavailable in private browsing or restricted contexts.
  }
}

export const MessengerView = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Store
  const init = useMessengerStore((s) => s.init);
  const isInitialLoading = useMessengerStore((s) => s.isInitialLoading);
  const selectConversation = useMessengerStore((s) => s.selectConversation);
  const selectedConversationId = useMessengerStore((s) => s.selectedConversationId);
  const createConversation = useMessengerStore((s) => s.createConversation);
  const typingUsers = useMessengerStore((s) => s.typingUsers);

  // Refs
  const composerRef = useRef<GomoRichEditorHandle | null>(null);

  // Mobile
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(getInitialSidebarWidth);
  const sidebarWidthRef = useRef(sidebarWidth);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  const sidebarCollapsed = !isMobile && sidebarWidth === SIDEBAR_COLLAPSED_WIDTH;

  const conversation = useMessengerStore(selectSelectedConversation);
  const showMobileChat = Boolean(conversation) && (!isMobile || !sidebarOpen);

  // The messenger is a fixed-height app surface (the document never scrolls
  // on /messages). On touch devices, pin the document for the whole route
  // lifetime (position:fixed on body via mobileKeyboard): iOS's focus-pan has
  // literally nothing to scroll when the composer input is focused, so the
  // keyboard slide-in is always smooth instead of racing the per-gesture pin
  // (which is what made the content fly down then back up on re-tap with
  // text). Released on unmount.
  const { isTouch } = useMobileKeyboard();
  useEffect(() => {
    if (!isTouch) return;
    pinDocumentForSurface();
    return () => unpinDocumentForSurface();
  }, [isTouch]);

  // ChatIcon (always in header) manages store init + WS connect lifecycle.
  // Here we just ensure store is initialized (idempotent if already done)
  // and WS is connected. No disconnect — ChatIcon stays alive across page navs.
  useEffect(() => {
    init();
    messengerWs.connect(); // registers handlers on shared wsService
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live presence for 1:1 conversation partners (sidebar dots + chat header).
  // Subscribes to their presence rooms and feeds snapshots/deltas into the
  // messenger store.
  useMessengerPresence();

  // ── URL sync ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (isInitialLoading) return;
    const reqConv = searchParams.get("conversation");
    const targetUser = searchParams.get("user");
    if (reqConv) {
      selectConversation(reqConv);
    } else if (targetUser && targetUser !== "null") {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      handleStartChat(targetUser);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInitialLoading]);

  // ── WS subscription ───────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedConversationId) return;
    eventManager.subscribeConversation(selectedConversationId);
    return () => {
      messengerWs.stopTyping(selectedConversationId);
      eventManager.unsubscribeConversation(selectedConversationId);
    };
  }, [selectedConversationId]);

  // ── Mobile detection ──────────────────────────────────────────────────
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 980px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // ── Hide AppLayout header on mobile when chat is open ─────────────────
  useEffect(() => {
    if (!isMobile) return;
    if (showMobileChat) {
      document.body.classList.add("messenger-mobile-chat-active");
    } else {
      document.body.classList.remove("messenger-mobile-chat-active");
    }
    window.dispatchEvent(new CustomEvent("gomo6:messenger-mobile-chat"));
    return () => {
      if (showMobileChat) {
        document.body.classList.remove("messenger-mobile-chat-active");
        window.dispatchEvent(new CustomEvent("gomo6:messenger-mobile-chat"));
      }
    };
  }, [isMobile, showMobileChat]);

  // ── Sidebar resize ─────────────────────────────────────────────────────
  const updateSidebarWidth = useCallback((width: number) => {
    sidebarWidthRef.current = width;
    setSidebarWidth(width);
    saveSidebarWidth(width);
  }, []);

  const handleSidebarResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isMobile) return;
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const wasCollapsed = startWidth === SIDEBAR_COLLAPSED_WIDTH;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const targetWidth = startWidth + moveEvent.clientX - startX;
      const nextWidth = wasCollapsed
        ? targetWidth > SIDEBAR_EXPAND_THRESHOLD
          ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, targetWidth))
          : SIDEBAR_COLLAPSED_WIDTH
        : targetWidth <= SIDEBAR_COLLAPSE_THRESHOLD
          ? SIDEBAR_COLLAPSED_WIDTH
          : Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, targetWidth));
      sidebarWidthRef.current = nextWidth;
      setSidebarWidth(nextWidth);
    };

    let cleanup = () => undefined;
    const handleMouseUp = () => {
      cleanup();
      resizeCleanupRef.current = null;
      saveSidebarWidth(sidebarWidthRef.current);
    };
    cleanup = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    // Keep the drag smooth even when the pointer crosses images or text.
    resizeCleanupRef.current?.();
    resizeCleanupRef.current = cleanup;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [isMobile, sidebarWidth]);

  const handleSidebarResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isMobile) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();

    if (event.key === "ArrowLeft") {
      updateSidebarWidth(SIDEBAR_COLLAPSED_WIDTH);
    } else if (sidebarCollapsed) {
      updateSidebarWidth(SIDEBAR_MIN_WIDTH);
    } else {
      updateSidebarWidth(Math.min(SIDEBAR_MAX_WIDTH, sidebarWidth + 16));
    }
  }, [isMobile, sidebarCollapsed, sidebarWidth, updateSidebarWidth]);

  // Avoid retaining document styles/listeners if the view disappears mid-drag.
  useEffect(() => () => {
    resizeCleanupRef.current?.();
    resizeCleanupRef.current = null;
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleStartChat = useCallback(async (userId: string) => {
    const convId = await createConversation(userId);
    if (convId) {
      setSearchParams({ conversation: convId, user: userId }, { replace: true });
      selectConversation(convId);
      setSidebarOpen(false);
    }
  }, [createConversation, setSearchParams, selectConversation]);

  const handleSelectConversation = useCallback((id: string) => {
    selectConversation(id);
    setSidebarOpen(false);
    const conv = useMessengerStore.getState().conversations.find((c) => c.id === id);
    if (conv) {
      const params: Record<string, string> = { conversation: id };
      if (conv.other_user_id) params.user = conv.other_user_id;
      setSearchParams(params, { replace: true });
    }
  }, [selectConversation, setSearchParams]);

  const handleTyping = useCallback((isTyping: boolean) => {
    if (!selectedConversationId) return;
    messengerWs.sendTyping(selectedConversationId, isTyping);
  }, [selectedConversationId]);

  const handleBack = useCallback(() => {
    setSidebarOpen(true);
    selectConversation(null);
    setSearchParams({}, { replace: true });
  }, [selectConversation, setSearchParams]);

  // Get typing user for this conversation
  const typingUsername = conversation
    ? Object.values(typingUsers).find((t) => t.user_id === conversation.other_user_id)?.username ?? null
    : null;

  // ── Initial loading state ─────────────────────────────────────────────
  if (isInitialLoading) {
    return (
      <div className="messenger-app">
        <div className="messenger-shell">
          <div className="panel-loader-overlay" style={{ gridColumn: "1 / -1" }}>
            <PentagramLoader size="lg" />
          </div>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <MessengerErrorBoundary>
      {/* The full-screen messenger shell: lib/mobileKeyboard pins the document
          (position:fixed + overflow:hidden) while the composer is focused, so
          Safari's keyboard focus-pan has nothing to scroll. */}
      <div className="messenger-app">
        <div
          className={`messenger-shell ${showMobileChat ? "mobile-chat-open" : ""}`}
          style={!isMobile ? { gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)` } : undefined}
        >
          <aside className={`sidebar-panel ${sidebarOpen ? "is-open" : ""}${sidebarCollapsed ? " is-collapsed" : ""}`}>
            <ConversationList
              onStartChat={handleStartChat}
              onSelectConversation={handleSelectConversation}
              targetUserId={searchParams.get("user")}
              isCollapsed={sidebarCollapsed}
            />
            {!isMobile && (
              /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
              <div
                className="sidebar-resizer"
                role="separator"
                aria-label="Изменить ширину списка диалогов"
                aria-orientation="vertical"
                aria-valuenow={sidebarWidth}
                aria-valuemin={SIDEBAR_COLLAPSED_WIDTH}
                aria-valuemax={SIDEBAR_MAX_WIDTH}
                tabIndex={0}
                onMouseDown={handleSidebarResizeStart}
                onKeyDown={handleSidebarResizeKeyDown}
              />
              /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
            )}
          </aside>

          <section
            className={`chat-panel${showMobileChat ? " is-open" : ""}${!conversation ? " is-empty" : ""}`}
            // Scrolling the chat (history, composer) must keep the soft
            // keyboard up — like the emoji swap panel does — instead of
            // triggering the iOS scroll-to-dismiss (see mobileKeyboard.ts).
            data-kb-keep
          >
            <ChatView
              onBack={handleBack}
              composerRef={composerRef}
              typingUsername={typingUsername}
              onTyping={handleTyping}
            />
          </section>
        </div>
      </div>
    </MessengerErrorBoundary>
  );
};
