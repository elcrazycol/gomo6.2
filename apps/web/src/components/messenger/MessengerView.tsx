import { useEffect, useRef, useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PentagramLoader } from "@/components/PentagramLoader";
import { useMessengerStore } from "@/stores/messengerStore";
import { messengerWs } from "@/services/messengerWebSocket";
import { MessengerErrorBoundary } from "./ErrorBoundary";
import { ConversationList } from "./ConversationList";
import { ChatView } from "./ChatView";

export const MessengerView = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Store
  const init = useMessengerStore((s) => s.init);
  const isInitialLoading = useMessengerStore((s) => s.isInitialLoading);
  const selectConversation = useMessengerStore((s) => s.selectConversation);
  const selectedConversationId = useMessengerStore((s) => s.selectedConversationId);
  const createConversation = useMessengerStore((s) => s.createConversation);
  const typingUsers = useMessengerStore((s) => s.typingUsers);
  const selectedConv = useMessengerStore((s) => s.selectedConversation);
  const setError = useMessengerStore((s) => s.setError);

  // Refs
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const msgScrollRef = useRef<HTMLDivElement | null>(null);

  // Mobile
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const conversation = selectedConv();
  const showMobileChat = Boolean(conversation) && (!isMobile || !sidebarOpen);

  // ChatIcon (always in header) manages store init + WS connect lifecycle.
  // Here we just ensure store is initialized (idempotent if already done)
  // and WS is connected. No disconnect — ChatIcon stays alive across page navs.
  useEffect(() => {
    init();
    messengerWs.connect(); // registers handlers on shared wsService
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── URL sync ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (isInitialLoading) return;
    const targetUser = searchParams.get("user");
    const reqConv = searchParams.get("conversation");
    if (targetUser) {
      handleStartChat(targetUser);
    } else if (reqConv) {
      selectConversation(reqConv);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInitialLoading]);

  // ── WS subscription ───────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedConversationId) return;
    const room = `chat_${selectedConversationId}`;
    messengerWs.subscribe(room);
    return () => { messengerWs.unsubscribe(room); };
  }, [selectedConversationId]);

  // ── Prevent body scroll (robust for iOS/Android) ──────────────────────
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";

    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
    };
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

  // ── Mobile detection ──────────────────────────────────────────────────
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 980px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // ── iOS keyboard: dynamic viewport height ──────────────────────────
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const updateHeight = () => {
      const panel = document.querySelector(".chat-panel.is-open") as HTMLElement | null;
      if (panel) {
        panel.style.height = `${vv.height}px`;
        panel.style.transform = `translateY(${vv.offsetTop}px)`;
      }
    };

    vv.addEventListener("resize", updateHeight);
    vv.addEventListener("scroll", updateHeight);
    updateHeight();

    return () => {
      vv.removeEventListener("resize", updateHeight);
      vv.removeEventListener("scroll", updateHeight);
      const panel = document.querySelector(".chat-panel.is-open") as HTMLElement | null;
      if (panel) {
        panel.style.height = "";
        panel.style.transform = "";
      }
    };
  }, [showMobileChat]);

  // ── Composer auto-resize ──────────────────────────────────────────────
  // (moved from context; composer handles its own height via ChatView)

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
      setSearchParams({ conversation: id, user: conv.other_user_id }, { replace: true });
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
      <div className="messenger-app">
        <div className={`messenger-shell ${showMobileChat ? "mobile-chat-open" : ""}`}>
          <aside className={`sidebar-panel ${sidebarOpen ? "is-open" : ""}`}>
            <ConversationList
              onStartChat={handleStartChat}
              onSelectConversation={handleSelectConversation}
              targetUserId={searchParams.get("user")}
            />
          </aside>

          <section className={`chat-panel ${showMobileChat ? "is-open" : ""}`}>
            <ChatView
              onBack={handleBack}
              composerRef={composerRef}
              messageScrollRef={msgScrollRef}
              endRef={endRef}
              typingUsername={typingUsername}
              onTyping={handleTyping}
            />
          </section>
        </div>
      </div>
    </MessengerErrorBoundary>
  );
};
