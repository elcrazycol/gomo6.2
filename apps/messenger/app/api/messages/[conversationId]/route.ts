import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/session";
import { getConversationForUser, getMessengerUserByMainId } from "@/lib/server";
import { messengerAdmin } from "@/lib/supabase";

const json = (payload: Record<string, unknown>, status = 200) => NextResponse.json(payload, { status });

export async function GET(
  _request: NextRequest,
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

  const admin = messengerAdmin();
  const { data: rows, error } = await admin
    .from("messenger_messages")
    .select(
      "id, ciphertext, nonce, sent_at, delivered_at, sender_device_id, sender_user_id, messenger_users!messenger_messages_sender_user_id_fkey(main_user_id)"
    )
    .eq("conversation_id", conversationId)
    .order("sent_at", { ascending: true });

  if (error) {
    return json({ error: "Failed to load messages" }, 500);
  }

  return json({
    messages: (rows ?? []).map((row: any) => ({
      id: row.id,
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      sentAt: row.sent_at,
      deliveredAt: row.delivered_at,
      senderDeviceId: row.sender_device_id,
      senderMainUserId: row.messenger_users?.main_user_id ?? "",
    })),
  });
}
