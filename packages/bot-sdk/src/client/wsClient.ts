import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type { RawWsMessage } from "../types/index.js";

export interface WsClientOptions {
  token: string;
  url: string;
  reconnect: boolean;
  reconnectInterval: number;
  maxReconnectAttempts: number;
}

export class WsClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private options: WsClientOptions;
  private reconnectAttempts = 0;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private subscribedRooms = new Set<string>();
  private isClosing = false;

  constructor(options: WsClientOptions) {
    super();
    this.options = options;
  }

  connect(): void {
    this.isClosing = false;
    this.ws = new WebSocket(this.options.url);

    this.ws.on("open", () => this.onOpen());
    this.ws.on("message", (data: Buffer | string) => this.onMessage(data));
    this.ws.on("close", () => this.onClose());
    this.ws.on("error", (err) => {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    });
  }

  private onOpen(): void {
    this.reconnectAttempts = 0;

    this.send({
      type: "auth",
      data: { token: this.options.token },
      timestamp: Date.now(),
    });

    this.pingInterval = setInterval(() => {
      this.send({ type: "ping", data: {}, timestamp: Date.now() });
    }, 30_000);
  }

  private onMessage(raw: Buffer | string): void {
    let msg: RawWsMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case "connected":
        this.resubscribeAll();
        this.emit("connected", msg.data);
        break;

      case "pong":
        break;

      case "error":
        this.emit("error", new Error((msg.data as { error?: string })?.error || "Unknown WS error"));
        break;

      case "confirmation":
        break;

      default:
        this.emit("raw", msg);
        this.emit(msg.type, msg);
        break;
    }
  }

  private onClose(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.emit("disconnected");

    if (!this.isClosing && this.options.reconnect) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.emit("error", new Error("Max reconnect attempts reached"));
      return;
    }
    this.reconnectAttempts++;
    this.emit("reconnecting", this.reconnectAttempts);
    setTimeout(() => this.connect(), this.options.reconnectInterval);
  }

  private resubscribeAll(): void {
    for (const room of this.subscribedRooms) {
      this.send({ type: "subscribe", data: room, timestamp: Date.now() });
    }
  }

  subscribe(room: string): void {
    this.subscribedRooms.add(room);
    this.send({ type: "subscribe", data: room, timestamp: Date.now() });
  }

  unsubscribe(room: string): void {
    this.subscribedRooms.delete(room);
    this.send({ type: "unsubscribe", data: room, timestamp: Date.now() });
  }

  send(data: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect(): void {
    this.isClosing = true;
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
