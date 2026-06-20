import { EventEmitter } from "node:events";
import type { BotConfig, RawWsMessage } from "./types/index.js";
import type { BotEvents } from "./types/events.js";
import { MessageContextImpl, PostContextImpl } from "./types/events.js";
import { HttpClient } from "./client/httpClient.js";
import { WsClient } from "./client/wsClient.js";

const DEFAULT_BASE_URL = "https://gomo6.wtf";
const DEFAULT_WS_URL = "wss://gomo6.wtf/ws";

export class GomoBot extends EventEmitter<BotEvents> {
  private http: HttpClient;
  private ws: WsClient;
  private config: Required<BotConfig>;

  constructor(config: BotConfig) {
    super();
    this.config = {
      baseUrl: DEFAULT_BASE_URL,
      wsUrl: DEFAULT_WS_URL,
      reconnect: true,
      reconnectInterval: 3000,
      maxReconnectAttempts: 10,
      ...config,
    };

    this.http = new HttpClient(this.config.token, this.config.baseUrl);
    this.ws = new WsClient({
      token: this.config.token,
      url: this.config.wsUrl,
      reconnect: this.config.reconnect,
      reconnectInterval: this.config.reconnectInterval,
      maxReconnectAttempts: this.config.maxReconnectAttempts,
    });

    this.ws.on("connected", (data) => this.emit("connected", data as { user_id: string; username: string }));
    this.ws.on("connected", () => this.emit("ready"));
    this.ws.on("raw", (msg) => this.routeEvent(msg as RawWsMessage));
    this.ws.on("reconnect_error", (err) => {
      console.error("[GomoBot] WebSocket reconnect error:", err instanceof Error ? err.message : err);
    });
    this.ws.on("reconnect_failed", (err) => {
      console.error("[GomoBot] WebSocket reconnect failed:", err instanceof Error ? err.message : err);
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    });
    this.ws.on("error", (err) => this.emit("error", err instanceof Error ? err : new Error(String(err))));
    this.ws.on("disconnected", () => this.emit("disconnected"));
    this.ws.on("reconnecting", (n) => this.emit("reconnecting", n as number));

    this.on("error", (err) => {
      console.error("[GomoBot] Error:", err instanceof Error ? err.message : err);
    });
  }

  get api(): HttpClient {
    return this.http;
  }

  start(): void {
    this.ws.connect();
  }

  stop(): void {
    this.ws.disconnect();
  }

  subscribeToThread(threadId: string): void {
    this.ws.subscribe(threadId);
  }

  subscribeToBoard(boardId: string): void {
    this.ws.subscribe(`board_${boardId}`);
  }

  subscribeToFeed(): void {
    this.ws.subscribe("feed");
  }

  subscribeToChat(conversationId: string): void {
    this.ws.subscribe(`chat_${conversationId}`);
  }

  unsubscribeFromThread(threadId: string): void {
    this.ws.unsubscribe(threadId);
  }

  unsubscribeFromBoard(boardId: string): void {
    this.ws.unsubscribe(`board_${boardId}`);
  }

  unsubscribeFromChat(conversationId: string): void {
    this.ws.unsubscribe(`chat_${conversationId}`);
  }

  get isConnected(): boolean {
    return this.ws.connected;
  }

  private safeEmit(event: string, ...args: unknown[]): void {
    const listeners = this.listeners(event);
    for (const rawListener of listeners) {
      const listener = rawListener as (...a: unknown[]) => unknown;
      try {
        const result = listener(...args);
        if (result && typeof (result as any).catch === "function") {
          (result as Promise<void>).catch((err) => {
            this.emit("error", err instanceof Error ? err : new Error(String(err)));
          });
        }
      } catch (err) {
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  private routeEvent(msg: RawWsMessage): void {
    const data = msg.data as Record<string, unknown>;

    switch (msg.type) {
      case "new_chat_message":
        this.safeEmit("message", new MessageContextImpl(this.http, data as any));
        this.safeEmit("chat_message", new MessageContextImpl(this.http, data as any));
        break;

      case "new_post":
      case "new_reply":
        this.safeEmit("post_created", new PostContextImpl(this.http, data as any));
        break;

      case "new_thread":
        this.safeEmit("thread_created", data as any);
        break;

      case "like":
        this.safeEmit("like", data as any);
        break;

      case "unlike":
        this.safeEmit("unlike", data as any);
        break;

      case "new_wall_post":
        this.safeEmit("wall_post", data as any);
        break;

      case "update_wall_post":
        this.safeEmit("wall_post_edited", data as any);
        break;

      case "delete_wall_post":
        this.safeEmit("wall_post_deleted", data as { id: string; user_id: string });
        break;

      case "message_edited":
        this.safeEmit("message_edited", data as { id: string; content: string; conversation_id: string });
        break;

      case "message_deleted":
        this.safeEmit("message_deleted", data as { id: string; conversation_id: string });
        break;

      case "read_receipt":
        this.safeEmit("read_receipt", data as { message_id: string; user_id: string; conversation_id: string });
        break;

      case "new_notification":
        this.safeEmit("notification", data);
        break;

      case "user_online":
        this.safeEmit("user_online", data as { user_id: string; username: string });
        break;

      case "user_offline":
        this.safeEmit("user_offline", data as { user_id: string; username: string });
        break;

      case "typing":
        this.safeEmit("typing", { ...data, room: msg.room } as any);
        break;

      case "chat_typing":
        this.safeEmit("chat_typing", data as any);
        break;
    }
  }
}
