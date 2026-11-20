import { useSyncExternalStore } from "react";
import { wsService } from "@/services/websocket";

/**
 * Realtime link state for the messenger, in Telegram's vocabulary.
 *
 *  • `connected`  — the socket is live; the chat header shows the peer's real
 *    presence.
 *  • `connecting` — the socket dropped and is being re-established (or the
 *    first connection is still in flight). Telegram replaces the peer's status
 *    with "connecting…" and shows a small spinner in the chat list instead of
 *    pretending the conversation is online.
 *  • `offline`    — the OS reports no network. Distinct copy ("Нет сети"), so
 *    the reader knows the problem is not the app.
 *
 * The snapshot is a module-level string: `useSyncExternalStore` requires a
 * stable value between events, and every consumer (header, list footer) reads
 * the same one.
 */
export type MessengerConnectionStatus = "connected" | "connecting" | "offline";

let status: MessengerConnectionStatus = "connecting";
const listeners = new Set<() => void>();
let wired = false;

function computeStatus(): MessengerConnectionStatus {
  if (wsService.connected) return "connected";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  return "connecting";
}

function refresh(): void {
  const next = computeStatus();
  if (next === status) return;
  status = next;
  for (const listener of listeners) listener();
}

function wire(): void {
  if (wired) return;
  wired = true;
  wsService.on("connected", refresh);
  wsService.on("disconnected", refresh);
  if (typeof window !== "undefined") {
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
  }
}

export function getMessengerConnectionStatus(): MessengerConnectionStatus {
  return status;
}

export function subscribeMessengerConnection(listener: () => void): () => void {
  wire();
  listeners.add(listener);
  // The socket may have come up between the seed and this subscription.
  refresh();
  return () => {
    listeners.delete(listener);
  };
}

export function useMessengerConnection(): MessengerConnectionStatus {
  return useSyncExternalStore(
    subscribeMessengerConnection,
    getMessengerConnectionStatus,
    getMessengerConnectionStatus,
  );
}
