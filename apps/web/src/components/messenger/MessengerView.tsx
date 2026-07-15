import { useEffect, useRef, useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PentagramLoader } from "@/components/PentagramLoader";
import { useMessengerStore, selectSelectedConversation } from "@/stores/messengerStore";
import { messengerWs } from "@/services/messengerWebSocket";
import { eventManager } from "@/services/eventManager";
import { MessengerErrorBoundary } from "./ErrorBoundary";
import { ConversationList } from "./ConversationList";
import { ChatView } from "./ChatView";
import "./messenger.css";

export const MessengerView = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Store
  const init = useMessengerStore((s) => s.init);
  const isInitialLoading = useMessengerStore((s) => s.isInitialLoading);
  const selectConversation = useMessengerStore((s) => s.selectConversation);
  const selectedConversationId = useMessengerStore((s) => s.selectedConversationId);
  const createConversation = useMessengerStore((s) => s.createConversation);
  const typingUsers = useMessengerStore((s) => s.typingUsers);
  const setError = useMessengerStore((s) => s.setError);

  // Refs
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // Mobile
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const conversation = useMessengerStore(selectSelectedConversation);
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
    const reqConv = searchParams.get("conversation");
    const targetUser = searchParams.get("user");
    if (reqConv) {
      selectConversation(reqConv);
    } else if (targetUser && targetUser !== "null") {
      handleStartChat(targetUser);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInitialLoading]);

  // ── WS subscription ───────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedConversationId) return;
    eventManager.subscribeConversation(selectedConversationId);
    return () => { eventManager.unsubscribeConversation(selectedConversationId); };
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
