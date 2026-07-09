// WebSocket service for real-time updates
// Connects to Go backend WebSocket endpoint for live post/thread notifications

// Relative WebSocket URL (works through Vite proxy in dev, Caddy in Docker).
// Override with VITE_WS_URL for custom setups.
const WS_BASE_URL = import.meta.env.VITE_WS_URL || '/ws';

// Ensure URL has correct format
function getWebSocketUrl(): string {
  const baseUrl = WS_BASE_URL;
  
  // If URL doesn't end with /ws, add it
  if (!baseUrl.endsWith('/ws')) {
    return baseUrl.replace(/\/?$/, '/ws');
  }
  
  return baseUrl;
}

export type WebSocketMessageType =
  | 'new_post'
  | 'new_thread'
  | 'new_reply'
  | 'like'
  | 'unlike'
  | 'typing'
  | 'presence'
  | 'connected'
  | 'confirmation'
  | 'ping'
  | 'subscribe'
  | 'unsubscribe'
  | 'new_wall_post'
  | 'update_wall_post'
  | 'delete_wall_post'
  | 'user_online'
  | 'user_offline'
  | 'new_notification'
  | 'new_chat_message'
  | 'message_edited'
  | 'message_deleted'
  | 'read_receipt'
  | 'chat_typing'
  | 'now_playing'
  | 'disconnected';

export interface WebSocketMessage {
  type: WebSocketMessageType;
  room?: string;
  data: unknown;
  user_id?: string;
  username?: string;
  timestamp: number;
}

export type MessageHandler = (message: WebSocketMessage) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000; // Start with 1 second
  private maxReconnectDelay = 30000; // Max 30 seconds
  private pingInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private messageHandlers: Map<WebSocketMessageType, Set<MessageHandler>> = new Map();
  private subscribedRooms: Set<string> = new Set();
  private currentUserId: string | null = null;
  private isConnected = false;
  private isConnecting = false;
  private lastConnectAttempt = 0;
  private minConnectInterval = 1000; // Minimum 1 second between connect attempts

  constructor() {
    // Bind methods
    this.connect = this.connect.bind(this);
    this.disconnect = this.disconnect.bind(this);
    this.handleMessage = this.handleMessage.bind(this);
    this.handleClose = this.handleClose.bind(this);
    this.handleError = this.handleError.bind(this);
    this.handleOpen = this.handleOpen.bind(this);

    // Listen for forced logout (token expired, refresh failed)
    if (typeof window !== 'undefined') {
      window.addEventListener('auth:expired', this.disconnect);
    }

    // Resubscribe to rooms after server confirms auth
    this.on('connected', () => {
      this.resubscribeRooms();
    });
  }

  /**
   * Get auth token from localStorage
   */
  private getToken(): string | null {
    return localStorage.getItem('auth_token');
  }

  /**
   * Connect to WebSocket server
   */
  async connect(): Promise<void> {
    if (this.isConnected || this.isConnecting) {
      return;
    }

    // Debounce: prevent multiple rapid connect attempts
    const now = Date.now();
    if (now - this.lastConnectAttempt < this.minConnectInterval) {
      console.log('[WebSocket] Debouncing connect attempt');
      return;
    }
    this.lastConnectAttempt = now;

    this.isConnecting = true;

    try {
      const token = this.getToken();
      if (!token) {
        this.isConnecting = false;
        return;
      }

  // Build WebSocket URL (no token — auth happens via first message)
      const wsBase = getWebSocketUrl();
      const wsUrl = wsBase;

      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = this.handleOpen;
      this.ws.onmessage = this.handleMessage;
      this.ws.onclose = this.handleClose;
      this.ws.onerror = this.handleError;

    } catch (error) {
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket open
   */
  private handleOpen(): void {
    this.isConnected = true;
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.reconnectDelay = 1000;

    // Start ping interval
    this.startPing();

    // Send auth token as first message
    const token = this.getToken();
    if (token) {
      this.send({ type: 'auth' as WebSocketMessageType, data: { token }, timestamp: Date.now() });
    }
    // DON'T resubscribe here — wait for 'connected' event from server
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(event: MessageEvent): void {
    try {
      const message: WebSocketMessage = JSON.parse(event.data);
      this.emit(message.type, message);
    } catch (error) {
      console.error('[WebSocket] Error parsing message:', error);
    }
  }

  /**
   * Handle WebSocket close
   */
  private handleClose(event: CloseEvent): void {
    this.isConnected = false;
    this.isConnecting = false;
    
    this.stopPing();
    this.emit('disconnected', { type: 'disconnected', data: {}, timestamp: Date.now() });
    
    // Attempt to reconnect unless it was a clean close
    if (event.code !== 1000 && event.code !== 1001) {
      this.scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket error
   */
  private handleError(_error: Event): void {
    // Don't log — 401 auth errors are normal and handled by close event.
    // Close event checks for auth failure and stops reconnection.
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    // Don't reconnect if there's no valid token
    if (!this.getToken()) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay);
    
    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Start ping interval to keep connection alive
   */
  private startPing(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping', data: {}, timestamp: Date.now() });
      }
    }, 30000); // Ping every 30 seconds
  }

  /**
   * Stop ping interval
   */
  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Send message to WebSocket server
   */
  private send(message: Partial<WebSocketMessage>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WebSocket] Cannot send, not connected');
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('[WebSocket] Send error:', error);
      return false;
    }
  }

  /**
   * Subscribe to a room (feed, thread_id, etc.)
   */
  subscribe(room: string): void {
    if (!room) return;
    
    this.subscribedRooms.add(room);
    
    if (this.isConnected) {
      this.send({
        type: 'subscribe',
        data: room,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Unsubscribe from a room
   */
  unsubscribe(room: string): void {
    if (!room) return;
    
    this.subscribedRooms.delete(room);
    
    if (this.isConnected) {
      this.send({
        type: 'unsubscribe',
        data: room,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Send an arbitrary message (used by messengerWs for typing indicators etc.)
   */
  sendRaw(message: Partial<WebSocketMessage>): boolean {
    return this.send(message);
  }

  /**
   * Re-subscribe to all previously subscribed rooms after reconnection
   */
  private resubscribeRooms(): void {
    for (const room of this.subscribedRooms) {
      this.send({
        type: 'subscribe',
        data: room,
        timestamp: Date.now()
      });
    }
  }


  /**
   * Subscribe to notifications room for a user
   */
  subscribeToNotifications(userId: string): void {
    if (!userId) return;
    this.currentUserId = userId;
    this.subscribe(`notifications_${userId}`);
  }

  /**
   * Subscribe to feed for new posts
   */
  subscribeToFeed(): void {
    this.subscribe('feed');
  }

  /**
   * Subscribe to a specific thread
   */
  subscribeToThread(threadId: string): void {
    if (threadId) {
      this.subscribe(threadId);
    }
  }

  /**
   * Send typing indicator
   */
  sendTyping(room: string): void {
    if (!this.isConnected || !room) return;
    
    this.send({
      type: 'typing',
      data: { room },
      timestamp: Date.now()
    });
  }

  /**
   * Register a handler for a specific message type
   */
  on(type: WebSocketMessageType, handler: MessageHandler): () => void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set());
    }
    
    this.messageHandlers.get(type)!.add(handler);
    
    // Return unsubscribe function
    return () => {
      this.off(type, handler);
    };
  }

  /**
   * Remove a handler for a specific message type
   */
  off(type: WebSocketMessageType, handler: MessageHandler): void {
    const handlers = this.messageHandlers.get(type);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Emit message to all registered handlers
   */
  private emit(type: WebSocketMessageType, message: WebSocketMessage): void {
    const handlers = this.messageHandlers.get(type);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(message);
        } catch (error) {
          console.error(`[WebSocket] Handler error for ${type}:`, error);
        }
      });
    }
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.isConnected;
  }

  /**
   * Get list of subscribed rooms
   */
  get rooms(): string[] {
    return Array.from(this.subscribedRooms);
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.stopPing();
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    this.subscribedRooms.clear();
    
    if (this.ws) {
      // Remove listeners before closing to prevent reconnection
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'Client disconnect');
      }
      
      this.ws = null;
    }
    
    this.isConnected = false;
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    
    console.log('[WebSocket] Disconnected by client');
  }
}

// Export singleton instance
export const wsService = new WebSocketService();
export default wsService;
