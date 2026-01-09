import { useEffect, useState, useRef } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { NotificationBell } from "@/components/NotificationBell";
import { ChatIcon } from "@/components/ChatIcon";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Send } from "lucide-react";

interface Conversation {
  id: string;
  user1_id: string;
  user2_id: string;
  last_message_at: string;
  user1: {
    id: string;
    username: string;
    is_anonymous: boolean;
  };
  user2: {
    id: string;
    username: string;
    is_anonymous: boolean;
  };
  unread_count: number;
}

interface Message {
  id: string;
  sender_id: string;
  recipient_id: string;
  content: string;
  created_at: string;
  is_read: boolean;
  sender: {
    username: string;
    is_anonymous: boolean;
  };
}

const Messages = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetUserId = searchParams.get("user");
  const [user, setUser] = useState<any>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageContent, setMessageContent] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user ?? null);
      
      if (!session?.user) {
        navigate("/auth");
        return;
      }
    };
    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
        if (!session?.user) {
          navigate("/auth");
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (user) {
      loadConversations();
    }
  }, [user]);

  useEffect(() => {
    if (targetUserId && user && user.id !== targetUserId) {
      // Find or create conversation with target user
      findOrCreateConversation(targetUserId);
    }
  }, [targetUserId, user]);

  useEffect(() => {
    if (selectedConversation) {
      loadMessages(selectedConversation);
      
      // Set up realtime subscription for new messages
      const channel = supabase
        .channel(`conversation-${selectedConversation}-messages`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `conversation_id=eq.${selectedConversation}`,
          },
          () => {
            loadMessages(selectedConversation);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [selectedConversation]);

  useEffect(() => {
    // Scroll to bottom when new messages arrive
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  };

  const findOrCreateConversation = async (otherUserId: string) => {
    if (!user) return;

    // Try to find existing conversation
    const { data: existing1 } = await supabase
      .from("conversations")
      .select("*")
      .eq("user1_id", user.id)
      .eq("user2_id", otherUserId)
      .maybeSingle();

    const { data: existing2 } = await supabase
      .from("conversations")
      .select("*")
      .eq("user1_id", otherUserId)
      .eq("user2_id", user.id)
      .maybeSingle();

    const existing = existing1 || existing2;

    if (existing) {
      setSelectedConversation(existing.id);
      // Remove user param from URL
      navigate("/messages", { replace: true });
    } else {
      // Create new conversation
      const { data: newConv, error } = await supabase
        .from("conversations")
        .insert({
          user1_id: user.id,
          user2_id: otherUserId,
        })
        .select()
        .single();

      if (error) {
        toast.error("Ошибка создания переписки");
        return;
      }

      setSelectedConversation(newConv.id);
      navigate("/messages", { replace: true });
      loadConversations();
    }
  };

  const loadConversations = async () => {
    if (!user) return;

    const { data } = await supabase
      .from("conversations")
      .select(`
        *,
        user1:profiles!conversations_user1_id_fkey(id, username, is_anonymous),
        user2:profiles!conversations_user2_id_fkey(id, username, is_anonymous)
      `)
      .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`)
      .order("last_message_at", { ascending: false });

    if (data) {
      // Calculate unread counts for each conversation
      const conversationsWithUnread = await Promise.all(
        data.map(async (conv) => {
          const { count } = await supabase
            .from("messages")
            .select("id", { count: "exact", head: true })
            .eq("conversation_id", conv.id)
            .eq("recipient_id", user.id)
            .eq("is_read", false);

          return {
            ...conv,
            unread_count: count || 0,
          };
        })
      );

      setConversations(conversationsWithUnread);
    }
  };

  const loadMessages = async (conversationId: string) => {
    if (!user) return;

    const { data } = await supabase
      .from("messages")
      .select(`
        *,
        sender:profiles!messages_sender_id_fkey(username, is_anonymous)
      `)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (data) {
      setMessages(data);

      // Mark messages as read
      await supabase
        .from("messages")
        .update({ is_read: true })
        .eq("conversation_id", conversationId)
        .eq("recipient_id", user.id)
        .eq("is_read", false);

      // Reload conversations to update unread counts
      loadConversations();
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedConversation || !messageContent.trim()) return;

    setLoading(true);

    const { error } = await supabase.from("messages").insert({
      conversation_id: selectedConversation,
      sender_id: user.id,
      recipient_id: getOtherUserId(),
      content: messageContent.trim(),
    });

    setLoading(false);

    if (error) {
      toast.error("Ошибка отправки сообщения");
      return;
    }

    setMessageContent("");
    
    // Update conversation's last_message_at
    await supabase
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", selectedConversation);

    loadConversations();
  };

  const getOtherUserId = () => {
    if (!user || !selectedConversation) return null;
    const conv = conversations.find((c) => c.id === selectedConversation);
    if (!conv) return null;
    return conv.user1_id === user.id ? conv.user2_id : conv.user1_id;
  };

  const getOtherUser = () => {
    if (!user || !selectedConversation) return null;
    const conv = conversations.find((c) => c.id === selectedConversation);
    if (!conv) return null;
    return conv.user1_id === user.id ? conv.user2 : conv.user1;
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Вышли");
  };

  if (!user) return <div className="p-4">Загрузка...</div>;

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-board-header text-board-header-foreground p-3 border-b border-border">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <Link to="/" className="text-xl font-bold hover:underline">
            gomo6
          </Link>
          <div className="flex gap-1 sm:gap-2 items-center flex-wrap">
            <ThemeToggle />
            <NotificationBell userId={user.id} />
            <ChatIcon userId={user.id} />
            <Link to={`/profile/${user.id}`}>
              <Button variant="ghost" size="sm" className="text-xs sm:text-sm">Профиль</Button>
            </Link>
            <Button variant="secondary" size="sm" onClick={handleLogout} className="text-xs sm:text-sm">
              Выйти
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4">
        <div className="bg-card border border-border flex flex-col h-[calc(100vh-120px)]">
          <div className="flex flex-1 overflow-hidden">
            {/* Conversations list */}
            <div className="w-full sm:w-80 border-r border-border flex flex-col">
              <div className="p-4 border-b border-border">
                <h2 className="text-lg font-bold">Сообщения</h2>
              </div>
              <div className="flex-1 overflow-y-auto">
                <div className="space-y-1 p-2">
                  {conversations.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center p-4">
                      Нет переписок
                    </p>
                  ) : (
                    conversations.map((conv) => {
                      const otherUser = conv.user1_id === user.id ? conv.user2 : conv.user1;
                      return (
                        <button
                          key={conv.id}
                          onClick={() => setSelectedConversation(conv.id)}
                          className={`w-full text-left p-3 border border-border hover:bg-post-header transition-colors ${
                            selectedConversation === conv.id ? "bg-board-header" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-sm truncate">
                                {otherUser.is_anonymous ? "Аноним" : otherUser.username}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {formatDistanceToNow(new Date(conv.last_message_at), {
                                  locale: ru,
                                  addSuffix: true,
                                })}
                              </p>
                            </div>
                            {conv.unread_count > 0 && (
                              <span className="ml-2 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
                                {conv.unread_count > 9 ? '9+' : conv.unread_count}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Messages area */}
            <div className="flex-1 flex flex-col">
              {selectedConversation ? (
                <>
                  <div className="p-4 border-b border-border">
                    <h3 className="font-bold">
                      {getOtherUser()?.is_anonymous ? "Аноним" : getOtherUser()?.username}
                    </h3>
                  </div>
                  <div 
                    ref={messagesContainerRef}
                    className="flex-1 overflow-y-auto p-4"
                  >
                    <div className="space-y-3">
                      {messages.map((msg) => {
                        const isOwn = msg.sender_id === user.id;
                        return (
                          <div
                            key={msg.id}
                            className={`flex ${isOwn ? "justify-end" : "justify-start"}`}
                          >
                            <div
                              className={`max-w-[70%] p-2 rounded ${
                                isOwn
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-post-header border border-border"
                              }`}
                            >
                              <p className="text-sm break-words">{msg.content}</p>
                              <p className="text-xs opacity-70 mt-1">
                                {formatDistanceToNow(new Date(msg.created_at), {
                                  locale: ru,
                                  addSuffix: true,
                                })}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                      <div ref={messagesEndRef} />
                    </div>
                  </div>
                  <form onSubmit={handleSendMessage} className="p-4 border-t border-border">
                    <div className="flex gap-2">
                      <Textarea
                        value={messageContent}
                        onChange={(e) => setMessageContent(e.target.value)}
                        placeholder="Написать сообщение..."
                        rows={2}
                        className="resize-none"
                        disabled={loading}
                      />
                      <Button type="submit" disabled={loading || !messageContent.trim()}>
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                  </form>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-muted-foreground">Выберите переписку</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Messages;
