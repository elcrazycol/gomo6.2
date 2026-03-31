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
  const { data: membership, error: membershipError } = await admin
    .from("chat_conversation_members")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    return json({ error: membershipError.message }, 500);
  }

  if (!membership) {
    return json({ error: "Conversation access denied" }, 403);
  }

  const { data: messages, error } = await admin
    .from("chat_messages")
    .select("id, sent_at, sender_user_id, client_message_id, ciphertext, nonce, sender_public_key, recipient_public_key")
    .eq("conversation_id", conversationId)
    .order("sent_at", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return json({ error: error.message }, 500);
  }

  const normalizedMessages = ((messages as any[]) ?? []).map((row) => ({
    id: row.id,
    sentAt: row.sent_at,
    senderUserId: row.sender_user_id,
    senderDeviceId: null,
    clientMessageId: row.client_message_id,
    cipherText: row.ciphertext,
    nonce: row.nonce,
    senderPublicKey: row.sender_public_key,
    recipientPublicKey: row.recipient_public_key,
  }));

  const messageIds = normalizedMessages.map((message) => message.id);
  const receipts =
    messageIds.length === 0
      ? []
      : (
          (await admin.from("chat_receipts").select("message_id, user_id, delivered_at, read_at").in("message_id", messageIds))
            .data ?? []
        );

  return json({
    messages: normalizedMessages,
    receipts: (receipts as Array<{ message_id: string; user_id: string; delivered_at: string | null; read_at: string | null }> | null) ?? [],
  });
}
