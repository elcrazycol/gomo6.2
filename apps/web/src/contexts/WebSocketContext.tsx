import { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/api/supabaseCompat";

type WebSocketMessage = {
  type: string;
  data: unknown;
  timestamp: number;
};

type WebSocketContextType = {
  isConnected: boolean;
  subscribe: (room: string) => void;
  unsubscribe: (room: string) => void;
  on: (type: string, handler: (data: unknown) => void) => () => void;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error("useWebSocket must be used within WebSocketProvider");
  }
  return context;
};

type Props = {
  children: ReactNode;
};

export const WebSocketProvider = ({ children }: Props) => {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, Set<(data: unknown) => void>>>(new Map());
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);

  const connect = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        return;
      }

      const wsBase = import.meta.env.VITE_WS_URL || "/ws";
      const url = `${wsBase}?token=${session.access_token}`;

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[WebSocket] Connected");
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          const handlers = handlersRef.current.get(message.type);
          if (handlers) {
            handlers.forEach((handler) => handler(message.data));
          }
        } catch (error) {
          console.error("[WebSocket] Error parsing message:", error);
        }
      };

      ws.onerror = (error) => {
        console.error("[WebSocket] Error:", error);
      };

      ws.onclose = () => {
        console.log("[WebSocket] Disconnected");
        setIsConnected(false);
        wsRef.current = null;

        // Reconnect with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
        reconnectAttemptsRef.current++;

        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }

        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect();
        }, delay);
      };
    } catch (error) {
      console.error("[WebSocket] Connection error:", error);
    }
  }, []);

  const subscribe = (room: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "subscribe",
        data: room,
      }));
    }
  };

  const unsubscribe = (room: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "unsubscribe",
        data: room,
      }));
    }
  };

  const on = (type: string, handler: (data: unknown) => void) => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, new Set());
    }
    handlersRef.current.get(type)!.add(handler);

    return () => {
      const handlers = handlersRef.current.get(type);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          handlersRef.current.delete(type);
        }
      }
    };
  };

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return (
    <WebSocketContext.Provider value={{ isConnected, subscribe, unsubscribe, on }}>
      {children}
    </WebSocketContext.Provider>
  );
};
