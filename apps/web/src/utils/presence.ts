// Shared parsing for presence WebSocket messages.
//
// Every presence consumer (profile hook, messenger hook, future feed) reads
// the same three event shapes from presence_<userID> rooms, so the parser
// lives in one place to keep the formats from drifting:
//
//   presence_snapshot: { user_id, is_online, last_seen? }   — sent once on subscribe
//   user_online:       { user_id, username, is_online, timestamp } — deltas
//   user_offline:      { user_id, username, is_online, timestamp }
import type { WebSocketMessage } from "@/services/websocket";

export interface PresenceData {
  user_id: string;
  is_online?: boolean;
  last_seen?: string;
}

export function presenceDataFromMessage(
  message: WebSocketMessage,
): PresenceData | null {
  if (!message.data || typeof message.data !== "object") return null;
  const d = message.data as Record<string, unknown>;
  const user_id = typeof d.user_id === "string" ? d.user_id : undefined;
  if (!user_id) return null;
  return {
    user_id,
    is_online: typeof d.is_online === "boolean" ? d.is_online : undefined,
    last_seen: typeof d.last_seen === "string" ? d.last_seen : undefined,
  };
}
