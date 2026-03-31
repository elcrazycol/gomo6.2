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
  if (!conversationId) {
    return json({ error: "Missing conversation" }, 400);
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

  const { data: messages, error } = await admin
    .from("chat_messages")
    .select("id, body, sent_at, sender_user_id, sender_device_id, client_message_id")
    .eq("conversation_id", conversationId)
    .order("sent_at", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return json({ error: error.message }, 500);
  }
  const normalizedMessages = ((messages as any[]) ?? []).map((row) => ({
    id: row.id,
    body: row.body ?? "",
    sentAt: row.sent_at,
    senderUserId: row.sender_user_id,
    senderDeviceId: row.sender_device_id,
    clientMessageId: row.client_message_id,
  }));

  const messageIds = normalizedMessages.map((message) => message.id);

  const { data: receipts } = await admin
    .from("chat_receipts")
    .select("message_id, user_id, delivered_at, read_at")
    .in("message_id", messageIds);

  return json({
    messages: normalizedMessages,
    receipts: (receipts as Array<{ message_id: string; user_id: string; delivered_at: string | null; read_at: string | null }> | null) ?? [],
  });
}
