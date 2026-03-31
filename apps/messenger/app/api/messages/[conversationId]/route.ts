import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, messengerAdmin } from "@/lib/auth";

const json = (payload: Record<string, unknown>, status = 200) => NextResponse.json(payload, { status });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const user = await getAuthenticatedUser(request.headers.get("authorization"));
  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const { conversationId } = await params;
  const deviceId = request.nextUrl.searchParams.get("deviceId");

  if (!conversationId || !deviceId) {
    return json({ error: "Missing conversation or device" }, 400);
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
    .eq("id", deviceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!device) {
    return json({ error: "Unknown recipient device" }, 403);
  }

  const { data: envelopes, error } = await admin
    .from("chat_message_envelopes")
    .select(
      `
        message_id,
        ciphertext,
        message_type,
        delivered_at,
        opened_at,
        chat_messages!inner (
          id,
          sender_user_id,
          sender_device_id,
          sent_at,
          conversation_id
        )
      `
    )
    .eq("recipient_user_id", user.id)
    .eq("recipient_device_id", deviceId)
    .eq("chat_messages.conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    return json({ error: error.message }, 500);
  }

  const messages = ((envelopes as any[]) ?? []).map((row) => ({
    id: row.chat_messages.id,
    ciphertext: row.ciphertext,
    messageType: row.message_type,
    sentAt: row.chat_messages.sent_at,
    deliveredAt: row.delivered_at,
    openedAt: row.opened_at,
    senderUserId: row.chat_messages.sender_user_id,
    senderDeviceId: row.chat_messages.sender_device_id,
  }));

  const messageIds = messages.map((message) => message.id);

  const { data: receipts } = await admin
    .from("chat_receipts")
    .select("message_id, user_id, delivered_at, read_at")
    .in("message_id", messageIds);

  return json({
    messages,
    receipts: (receipts as Array<{ message_id: string; user_id: string; delivered_at: string | null; read_at: string | null }> | null) ?? [],
  });
}
