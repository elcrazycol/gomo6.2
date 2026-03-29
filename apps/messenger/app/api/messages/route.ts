import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/session";
import { getConversationForUser, getMessengerUserByMainId } from "@/lib/server";
import { messengerAdmin } from "@/lib/supabase";

const json = (payload: Record<string, unknown>, status = 200) => NextResponse.json(payload, { status });

export async function POST(request: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await request.json().catch(() => null);
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : null;
  const ciphertext = typeof body?.ciphertext === "string" ? body.ciphertext : null;
  const nonce = typeof body?.nonce === "string" ? body.nonce : null;
  const senderDeviceId = typeof body?.senderDeviceId === "string" ? body.senderDeviceId : null;

  if (!conversationId || !ciphertext || !nonce || !senderDeviceId) {
    return json({ error: "Invalid message payload" }, 400);
  }

  const self = await getMessengerUserByMainId(session.sub);
  if (!self) {
    return json({ error: "Messenger user not found" }, 404);
  }

  const membership = await getConversationForUser(conversationId, self.id);
  if (!membership) {
    return json({ error: "Conversation access denied" }, 403);
  }

  const admin = messengerAdmin();
  const { data, error } = await admin
    .from("messenger_messages")
    .insert({
      conversation_id: conversationId,
      sender_user_id: self.id,
      sender_device_id: senderDeviceId,
      ciphertext,
      nonce,
    })
    .select("id, sent_at")
    .single();

  if (error || !data) {
    return json({ error: `Failed to store message: ${error?.message ?? "unknown"}` }, 500);
  }

  return json({
    message: {
      id: data.id,
      sentAt: data.sent_at,
    },
  });
}
