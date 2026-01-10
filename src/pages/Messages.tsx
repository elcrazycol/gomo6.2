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
import { MobileMenu } from "@/components/MobileMenu";
import { ProfileHoverCard } from "@/components/ProfileHoverCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserBadge } from "@/components/UserBadge";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Send, Search, ChevronDown, Settings } from "lucide-react";

const getColorClass = (color: string): string => {
  const colorClasses: Record<string, string> = {
    purple: "text-purple-500",
    gold: "text-yellow-500",
    orange: "text-orange-500",
    red: "text-red-500",
    blue: "text-blue-500",
    green: "text-green-500",
    yellow: "text-yellow-400",
    cyan: "text-cyan-500",
  };
  return colorClasses[color] || "";
};

const ScrollToBottomButton = ({ onClick, visible }: { onClick: () => void; visible: boolean }) => {
  if (!visible) return null;

  return (
    <button
      onClick={onClick}
      className="absolute bottom-4 right-4 z-10 w-8 h-8 bg-background/60 hover:bg-background/80 border border-border/50 text-muted-foreground hover:text-foreground rounded-full flex items-center justify-center shadow-sm transition-all duration-200 backdrop-blur-sm"
    >
      <ChevronDown className="h-4 w-4" />
    </button>
  );
};

const generateConversationHash = (userId: string, otherUserId: string): string => {
  return btoa(`${userId}-${otherUserId}-${Date.now()}`).slice(0, 16);
};

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
  const [pageLoading, setPageLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  
  // For mobile: show conversation list or chat view
  const [showChatView, setShowChatView] = useState(false);
  const [userColors, setUserColors] = useState<Map<string, string>>(new Map());
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationHashes, setConversationHashes] = useState<Map<string, string>>(new Map());
  const [loadingFromSearch, setLoadingFromSearch] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const currentLoadController = useRef<AbortController | null>(null);
  const currentLoadingConversation = useRef<string | null>(null);

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
      const loadAll = async () => {
        setPageLoading(true);
        await loadConversations();
        setPageLoading(false);
      };
      loadAll();
    }
  }, [user]);

  useEffect(() => {
    if (targetUserId && user && user.id !== targetUserId) {
      // Find or create conversation with target user
      findOrCreateConversation(targetUserId);
    } else if (targetUserId && user && user.id === targetUserId) {
      // User trying to message themselves - remove param
      navigate("/messages", { replace: true });
    }
  }, [targetUserId, user, navigate]);

  useEffect(() => {
    if (selectedConversation) {
      setConversationLoading(true);
      setLoading(true);

      // Generate hash for this conversation
      const conversationHash = generateConversationHash(user?.id || '', selectedConversation);
      setConversationHashes(prev => new Map(prev.set(selectedConversation, conversationHash)));

      loadMessages(selectedConversation, conversationHash);
      // On mobile, show chat view when conversation is selected
      if (window.innerWidth < 640) {
        setShowChatView(true);
      }
      
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
          async (payload) => {
            // Add new message to existing list without reloading
            const newMessage = payload.new as Message;

            // Load sender profile for the new message
            const { data: senderProfile } = await supabase
              .from("profiles")
              .select("username, is_anonymous")
              .eq("id", newMessage.sender_id)
              .single();

            const messageWithProfile: Message = {
              ...newMessage,
              sender: senderProfile || { username: "Неизвестен", is_anonymous: false },
            };

            // Add to messages list
            setMessages(prev => {
              const exists = prev.some(msg => msg.id === messageWithProfile.id);
              if (exists) return prev;
              return [...prev, messageWithProfile];
            });

            // If message is for current user, mark as read
            if (newMessage.recipient_id === user?.id) {
              await supabase
                .from("messages")
                .update({ is_read: true })
                .eq("id", newMessage.id);
            }

            // Reload conversations to update unread counts
            loadConversations();
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
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  };

  const handleScroll = () => {
    if (messagesContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
      // Show button if user is more than 100px from bottom
      const isNearBottom = scrollTop + clientHeight >= scrollHeight - 100;
      setShowScrollButton(!isNearBottom);
    }
  };

  const performSearch = async (query: string) => {
    if (!query.trim() || !user) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    try {
      // Search by ID (exact match)
      const idSearch = await supabase
        .from("profiles")
        .select("id, username, is_anonymous, account_number")
        .eq("id", query.trim())
        .neq("id", user.id)
        .limit(10);

      // Search by account number
      const accountSearch = await supabase
        .from("profiles")
        .select("id, username, is_anonymous, account_number")
        .eq("account_number", parseInt(query.trim()))
        .neq("id", user.id)
        .limit(10);

      // Search by username (partial match)
      const usernameSearch = await supabase
        .from("profiles")
        .select("id, username, is_anonymous, account_number")
        .ilike("username", `%${query.trim()}%`)
        .neq("id", user.id)
        .limit(10);

      // Combine and deduplicate results
      const allResults = new Map();

      [...(idSearch.data || []), ...(accountSearch.data || []), ...(usernameSearch.data || [])].forEach(user => {
        allResults.set(user.id, user);
      });

      setSearchResults(Array.from(allResults.values()).slice(0, 10));
    } catch (error) {
      console.error("Search error:", error);
      setSearchResults([]);
    }
    setSearchLoading(false);
  };

  const findOrCreateConversation = async (otherUserId: string) => {
    if (!user) return;

    // Cancel any ongoing load
    if (currentLoadController.current) {
      currentLoadController.current.abort();
    }

    // Reset loading state
    setLoading(true);
    setConversationLoading(true);

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
      if (window.innerWidth < 640) {
        setShowChatView(true);
      }
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
        toast.error("Ошибка создания переписки: " + error.message);
        return;
      }

      // Reload conversations first to get full data with profiles
      await loadConversations();
      
      // Then set the selected conversation
      setSelectedConversation(newConv.id);
      navigate("/messages", { replace: true });
      if (window.innerWidth < 640) {
        setShowChatView(true);
      }
    }
  };

  const loadConversations = async () => {
    if (!user) return;

    const { data } = await supabase
      .from("conversations")
      .select("*")
      .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`)
      .order("last_message_at", { ascending: false });

    if (data) {
      // Load profiles and unread counts for each conversation
      const conversationsWithUnread = await Promise.all(
        data.map(async (conv) => {
          // Load user1 profile
          const { data: user1Profile } = await supabase
            .from("profiles")
            .select("id, username, is_anonymous")
            .eq("id", conv.user1_id)
            .single();

          // Load user2 profile
          const { data: user2Profile } = await supabase
            .from("profiles")
            .select("id, username, is_anonymous")
            .eq("id", conv.user2_id)
            .single();

          // Count unread messages
          const { count } = await supabase
            .from("messages")
            .select("id", { count: "exact", head: true })
            .eq("conversation_id", conv.id)
            .eq("recipient_id", user.id)
            .eq("is_read", false);

          return {
            ...conv,
            user1: user1Profile || { id: conv.user1_id, username: "Неизвестен", is_anonymous: false },
            user2: user2Profile || { id: conv.user2_id, username: "Неизвестен", is_anonymous: false },
            unread_count: count || 0,
          };
        })
      );

      setConversations(conversationsWithUnread);

      // Load colors for all users in conversations
      const colorPromises = conversationsWithUnread.map(async (conv) => {
        const otherUser = conv.user1_id === user.id ? conv.user2 : conv.user1;
        if (otherUser && !otherUser.is_anonymous) {
          const { data: achievements } = await supabase
            .from("user_achievements")
            .select(`
              achievement_id,
              achievements (
                reward_type,
                reward_value
              )
            `)
            .eq("user_id", otherUser.id);

          if (achievements) {
            const colorRewards = achievements
              .filter((a: any) => a.achievements?.reward_type === "username_color")
              .map((a: any) => a.achievements.reward_value);

            const priority = ['purple', 'gold', 'orange', 'red', 'blue', 'green', 'yellow', 'cyan'];
            for (const p of priority) {
              if (colorRewards.includes(p)) {
                return { userId: otherUser.id, color: p };
              }
            }
          }
        }
        return null;
      });

      const colorResults = await Promise.all(colorPromises);
      const newColors = new Map();
      colorResults.forEach(result => {
        if (result) {
          newColors.set(result.userId, result.color);
        }
      });
      setUserColors(newColors);
    }
  };

  const loadMessages = async (conversationId: string, expectedHash?: string) => {
    if (!user) return;

    // Cancel any previous load
    if (currentLoadController.current) {
      currentLoadController.current.abort();
    }

    // Create new controller for this load
    const controller = new AbortController();
    currentLoadController.current = controller;
    currentLoadingConversation.current = conversationId;


    setLoading(true);

    try {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      // Check if this load was cancelled
      if (controller.signal.aborted) {
        return;
      }

    if (data) {
      // Load sender profiles for each message
      const messagesWithProfiles = await Promise.all(
        data.map(async (msg) => {
          const { data: senderProfile } = await supabase
            .from("profiles")
            .select("username, is_anonymous")
            .eq("id", msg.sender_id)
            .single();

          return {
            ...msg,
            sender: senderProfile || { username: "Неизвестен", is_anonymous: false },
          };
        })
      );

      // Check if this load was cancelled
      if (controller.signal.aborted) {
        return;
      }

      // Set messages for this conversation
      setMessages(messagesWithProfiles);

      // Check if load was cancelled
      if (controller.signal.aborted) {
        return;
      }

      // Mark messages as read
      await supabase
        .from("messages")
        .update({ is_read: true })
        .eq("conversation_id", conversationId)
        .eq("recipient_id", user.id)
        .eq("is_read", false);

      // Check hash again before completing
      const finalHash = conversationHashes.get(conversationId);
      if (expectedHash && finalHash !== expectedHash) {
        return; // Conversation changed during loading
      }

      // Load colors for conversation participants
      const conversation = conversations.find(c => c.id === conversationId);
      if (conversation) {
        const otherUser = conversation.user1_id === user.id ? conversation.user2 : conversation.user1;
        if (otherUser && !otherUser.is_anonymous && !userColors.has(otherUser.id)) {
          const { data: achievements } = await supabase
            .from("user_achievements")
            .select(`
              achievement_id,
              achievements (
                reward_type,
                reward_value
              )
            `)
            .eq("user_id", otherUser.id);

          if (achievements) {
            const colorRewards = achievements
              .filter((a: any) => a.achievements?.reward_type === "username_color")
              .map((a: any) => a.achievements.reward_value);

            const priority = ['purple', 'gold', 'orange', 'red', 'blue', 'green', 'yellow', 'cyan'];
            for (const p of priority) {
              if (colorRewards.includes(p)) {
                setUserColors(prev => new Map(prev.set(otherUser.id, p)));
                break;
              }
            }
          }
        }
      }

      // Check if load was cancelled before completing
      if (controller.signal.aborted) {
        return;
      }

      // Reload conversations to update unread counts
      loadConversations();
    }

    // Complete loading if this conversation is still being loaded
    if (currentLoadingConversation.current === conversationId && !controller.signal.aborted) {
      setLoading(false);
      setConversationLoading(false);
      setLoadingFromSearch(false);
      currentLoadingConversation.current = null;
      currentLoadController.current = null;

      // Scroll to bottom after loading messages (instant for initial load)
      setTimeout(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
      }, 50);
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      // Load was cancelled, reset state
      if (currentLoadingConversation.current === conversationId) {
        currentLoadingConversation.current = null;
        currentLoadController.current = null;
      }
      return;
    }
    console.error('Load messages error:', error);
    setLoading(false);
    setConversationLoading(false);
    setLoadingFromSearch(false);
    currentLoadingConversation.current = null;
    currentLoadController.current = null;
  }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!user || !selectedConversation || !messageContent.trim()) return;

    const recipientId = getOtherUserId();
    if (!recipientId) {
      toast.error("Не удалось определить получателя");
      return;
    }

    const messageText = messageContent.trim();
    setMessageContent(""); // Clear input immediately

    // Send message to database
    const { error } = await supabase.from("messages").insert({
      conversation_id: selectedConversation,
      sender_id: user.id,
      recipient_id: recipientId,
      content: messageText,
    });

    if (error) {
      toast.error("Ошибка отправки сообщения: " + error.message);
      // Restore message text on error
      setMessageContent(messageText);
    }

    if (error) {
      toast.error("Ошибка отправки сообщения: " + error.message);
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

  if (!user || pageLoading) {
    return (
      <div className="bg-background flex items-center justify-center min-h-screen">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  return (
    <div className="bg-background">
      <header className="bg-board-header text-board-header-foreground p-3 border-b border-border">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
          <Link to="/" className="text-xl font-bold hover:underline flex-shrink-0">
            gomo6
          </Link>
          <div className="flex gap-1 sm:gap-2 items-center flex-shrink-0">
            <Link to="/settings">
              <Button variant="ghost" size="sm" className="p-2">
                <Settings className="h-4 w-4" />
              </Button>
            </Link>
            <NotificationBell userId={user.id} />
            <ChatIcon userId={user.id} />
            <div className="hidden sm:flex gap-1 sm:gap-2 items-center">
              <ProfileHoverCard userId={user.id}>
                <Link to={`/profile/${user.id}`}>
                  <Button variant="ghost" size="sm" className="text-xs sm:text-sm">Профиль</Button>
                </Link>
              </ProfileHoverCard>
            </div>
            <MobileMenu
              user={user}
              isModerator={false}
            />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-2 sm:p-4">
        <div className="bg-card border border-border flex flex-col h-[calc(100vh-120px)] sm:h-[calc(100vh-120px)]">
          {/* Mobile: Show either list or chat */}
          <div className="flex flex-1 overflow-hidden">
            {/* Conversations list - hidden on mobile when chat is open */}
            <div className={`${showChatView ? 'hidden sm:flex' : 'flex'} w-full sm:w-80 border-r border-border flex-col`}>
              <div className="p-3 sm:p-4 border-b border-border flex items-center justify-between">
                <h2 className="text-base sm:text-lg font-bold">Чаты</h2>
                <button
                  onClick={() => setShowSearch(!showSearch)}
                  className="p-2 hover:bg-post-header rounded-lg transition-colors"
                >
                  <Search className="h-4 w-4" />
                </button>
              </div>

              {/* Search panel */}
              {showSearch && (
                <div className="border-b border-border p-3">
                  <input
                    type="text"
                    placeholder="Поиск по ID, доп. ID или никнейму..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      performSearch(e.target.value);
                    }}
                    className="w-full p-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  {searchLoading && (
                    <div className="flex justify-center mt-2">
                      <PentagramLoader size="sm" />
                    </div>
                  )}
                  {searchResults.length > 0 && (
                    <div className="mt-2 max-h-60 overflow-y-auto space-y-2">
                      {searchResults.map((user) => (
                        <button
                          key={user.id}
                          onClick={() => {
                            setShowSearch(false);
                            setSearchQuery("");
                            setSearchResults([]);
                            setLoadingFromSearch(true);
                            findOrCreateConversation(user.id);
                          }}
                          className="w-full flex items-center gap-3 p-2 hover:bg-post-header rounded-lg transition-colors text-left"
                        >
                          <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
                            <span className="text-sm font-bold">
                              {user.is_anonymous ? "A" : user.username.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`font-medium text-sm truncate ${getColorClass(userColors.get(user.id) || "")}`}>
                              {user.is_anonymous ? "Аноним" : user.username}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              ID: {user.id.slice(0, 8)} • {user.account_number ? `Доп: ${user.account_number}` : 'Без доп. ID'}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex-1 overflow-y-auto">
                {loadingFromSearch && (
                  <div className="flex justify-center items-center py-8">
                    <PentagramLoader size="sm" />
                  </div>
                )}
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
                          onClick={() => {
                            if (selectedConversation !== conv.id) {
                              setSelectedConversation(conv.id);
                              setLoadingFromSearch(false); // Reset search flag for existing chats
                              if (window.innerWidth < 640) {
                                setShowChatView(true);
                              }
                            }
                          }}
                          className={`w-full text-left p-3 border border-border hover:bg-post-header transition-colors ${
                            selectedConversation === conv.id ? "bg-board-header" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className={`font-bold text-sm truncate ${getColorClass(userColors.get(otherUser.id) || "")}`}>
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
            <div className={`${showChatView ? 'flex' : 'hidden sm:flex'} flex-1 flex-col`}>
              {selectedConversation ? (
                <>
                  <div className="p-3 sm:p-4 border-b border-border flex items-center gap-2">
                    {/* Back button for mobile */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="sm:hidden"
                      onClick={() => {
                        setShowChatView(false);
                        setSelectedConversation(null);
                      }}
                    >
                      ←
                    </Button>
                    <div className="flex-1">
                      {getOtherUser() && (
                        <UserBadge
                          userId={getOtherUser().id}
                          username={getOtherUser().is_anonymous ? "Аноним" : getOtherUser().username}
                          isAnonymous={getOtherUser().is_anonymous}
                        />
                      )}
                    </div>
                  </div>
                  <div
                    ref={messagesContainerRef}
                    className="flex-1 overflow-y-auto p-3 sm:p-4 relative"
                    onScroll={handleScroll}
                  >
                    <ScrollToBottomButton onClick={scrollToBottom} visible={showScrollButton} />
                    <div className="space-y-3">
                      {loading ? (
                        <div className="flex justify-center items-center h-full min-h-[200px]">
                          <PentagramLoader size="sm" />
                        </div>
                      ) : messages.length === 0 ? (
                        <div className="text-center text-muted-foreground py-8">
                          {selectedConversation ? "Сообщений пока нет" : "Выберите чат для начала общения"}
                        </div>
                      ) : (
                        <>
                          {messages.map((msg) => {
                          const isOwn = msg.sender_id === user.id;
                          return (
                            <div
                              key={msg.id}
                              className={`flex ${isOwn ? "justify-end" : "justify-start"}`}
                            >
                              <div
                                className={`max-w-[85%] sm:max-w-[70%] p-2 sm:p-3 rounded-lg ${
                                  isOwn
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-post-header border border-border"
                                }`}
                              >
                                <p className="text-sm break-words">{msg.content}</p>
                                <p className={`text-xs opacity-70 mt-1 ${isOwn ? 'text-right' : ''}`}>
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
                        </>
                      )}
                    </div>
                  </div>
                  <form onSubmit={handleSendMessage} className="p-3 sm:p-4 border-t border-border">
                    <div className="flex gap-2">
                      <Textarea
                        value={messageContent}
                        onChange={(e) => setMessageContent(e.target.value)}
                        onKeyDown={(e) => {
                          // Send on Enter only on desktop
                          if (e.key === 'Enter' && !e.shiftKey && window.innerWidth >= 768) {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                        placeholder="Написать сообщение..."
                        rows={2}
                        className="resize-none text-sm"
                      />
                      <Button type="submit" disabled={!messageContent.trim()} size="icon">
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                  </form>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center p-4">
                  <p className="text-muted-foreground text-center">
                    {window.innerWidth < 640 ? "Выберите переписку из списка" : "Выберите переписку"}
                  </p>
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
