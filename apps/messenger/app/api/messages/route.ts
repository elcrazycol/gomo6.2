import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, messengerAdmin } from "@/lib/auth";

const json = (payload: Record<string, unknown>, status = 200) => NextResponse.json(payload, { status });

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request.headers.get("authorization"));
  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await request.json().catch(() => null);
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : null;
  const clientMessageId = typeof body?.clientMessageId === "string" ? body.clientMessageId : null;
  const messageBody = typeof body?.body === "string" ? body.body.trim() : "";

  if (!conversationId || !clientMessageId || !messageBody) {
    return json({ error: "Invalid message payload" }, 400);
  }

  const admin = messengerAdmin();
  const { data: membership } = await admin
    .from("chat_conversation_members")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return json({ error: "Conversation access denied" }, 403);
  }

  const { data: device } = await admin
    .from("chat_devices")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("last_seen_at", { ascending: false })
    .maybeSingle();

  if (!device) {
    return json({ error: "Messenger device is not registered for this account" }, 403);
  }

  const { data: messageRow, error: messageError } = await admin
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      sender_user_id: user.id,
      sender_device_id: device.id,
      client_message_id: clientMessageId,
      body: messageBody,
    })
    .select("id, sent_at, client_message_id, body")
    .single();

  if (messageError || !messageRow) {
    return json({ error: messageError?.message ?? "Failed to create message" }, 500);
  }

  await admin
    .from("chat_receipts")
    .update({ delivered_at: messageRow.sent_at, updated_at: new Date().toISOString() })
    .eq("message_id", messageRow.id)
    .is("delivered_at", null);

  return json({
    message: {
      id: messageRow.id,
      sentAt: messageRow.sent_at,
      clientMessageId: messageRow.client_message_id,
      body: messageRow.body,
    },
  });
}
