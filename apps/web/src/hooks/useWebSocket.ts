// WebSocket React hooks for real-time updates
import { useEffect, useCallback, useRef } from 'react';
import { wsService, WebSocketMessage, WebSocketMessageType } from '../services/websocket';

/**
 * React hook for WebSocket integration
 * 
 * Usage:
 * const { connected, subscribe, on } = useWebSocket();
 * 
 * useEffect(() => {
 *   if (connected) {
 *     subscribe('feed');
 *     return on('new_post', (msg) => console.log('New post:', msg));
 *   }
 * }, [connected]);
 */
export function useWebSocket() {
  // Note: We don't auto-disconnect on unmount to keep connection alive across navigation

  // Connect on mount
  useEffect(() => {
    wsService.connect();
  }, []);

  const subscribe = useCallback((room: string) => {
    wsService.subscribe(room);
  }, []);

  const unsubscribe = useCallback((room: string) => {
    wsService.unsubscribe(room);
  }, []);

  const on = useCallback((type: WebSocketMessageType, handler: (msg: WebSocketMessage) => void) => {
    return wsService.on(type, handler);
  }, []);

  const subscribeToFeed = useCallback(() => {
    wsService.subscribeToFeed();
  }, []);

  const subscribeToThread = useCallback((threadId: string) => {
    wsService.subscribeToThread(threadId);
  }, []);

  return {
    connected: wsService.connected,
    subscribe,
    unsubscribe,
    on,
    subscribeToFeed,
    subscribeToThread,
  };
}

/**
 * Hook for realtime post updates in feed
 * Automatically subscribes to feed and calls callback on new posts
 * NOTE: Does NOT auto-unsubscribe on unmount - manage manually if needed
 */
export function useRealtimePosts(onNewPost: (post: any) => void) {
  const { connected, subscribe, on } = useWebSocket();
  const callbackRef = useRef(onNewPost);
  
  // Keep callback ref up to date
  useEffect(() => {
    callbackRef.current = onNewPost;
  }, [onNewPost]);

  useEffect(() => {
    if (!connected) return;

    // Subscribe to feed once on mount
    subscribe('feed');
    
    // Listen for new posts
    const unsubscribe = on('new_post', (message) => {
      if (message.data) {
        try {
          const postData = typeof message.data === 'string' 
            ? JSON.parse(message.data) 
            : message.data;
          callbackRef.current(postData);
        } catch (e) {
          console.error('Error parsing realtime post:', e);
        }
      }
    });

    // Return unsubscribe function for manual cleanup only
    return () => {
      unsubscribe();
    };
  }, [connected, subscribe, on]);
}

/**
 * Hook for realtime thread replies
 * NOTE: Does NOT auto-unsubscribe on unmount - manage manually if needed
 */
export function useRealtimeReplies(threadId: string | undefined, onNewReply: (reply: any) => void) {
  const { connected, subscribe, on } = useWebSocket();
  const callbackRef = useRef(onNewReply);
  
  useEffect(() => {
    callbackRef.current = onNewReply;
  }, [onNewReply]);

  useEffect(() => {
    if (!connected || !threadId) return;

    // Subscribe to thread
    subscribe(threadId);

    // Listen for new posts (replies) in this thread
    const unsubscribe = on('new_post', (message) => {
      if (message.data) {
        try {
          const replyData = typeof message.data === 'string' 
            ? JSON.parse(message.data) 
            : message.data;
          // Only process if it's for this thread
          if (replyData.thread_id === threadId) {
            callbackRef.current(replyData);
          }
        } catch (e) {
          console.error('Error parsing realtime reply:', e);
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [connected, threadId, subscribe, on]);
}
