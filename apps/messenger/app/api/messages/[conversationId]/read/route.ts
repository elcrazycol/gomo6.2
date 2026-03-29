import { NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/session";
import { getConversationForUser, getMessengerUserByMainId } from "@/lib/server";
import { messengerAdmin } from "@/lib/supabase";

const json = (payload: Record<string, unknown>, status = 200) => NextResponse.json(payload, { status });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const session = await getSessionFromCookies();
  if (!session) {
    return json({ error: "Unauthorized" }, 401);
  }

  const self = await getMessengerUserByMainId(session.sub);
  if (!self) {
    return json({ error: "Messenger user not found" }, 404);
  }

  const { conversationId } = await params;
  const membership = await getConversationForUser(conversationId, self.id);
  if (!membership) {
    return json({ error: "Conversation access denied" }, 403);
  }

  const body = await request.json().catch(() => null);
  const lastReadMessageId = typeof body?.lastReadMessageId === "string" ? body.lastReadMessageId : null;

  const admin = messengerAdmin();
  const { error } = await admin
    .from("messenger_conversation_members")
    .update({
      last_read_at: new Date().toISOString(),
      last_read_message_id: lastReadMessageId,
      unread_count_cache: 0,
    })
    .eq("conversation_id", conversationId)
    .eq("user_id", self.id);

  if (error) {
    return json({ error: "Failed to update read state" }, 500);
  }

  return json({ ok: true });
}
