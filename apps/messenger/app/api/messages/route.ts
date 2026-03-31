import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, messengerAdmin } from "@/lib/auth";
import { getChatPublicKeyForUser } from "@/lib/messenger";

const json = (payload: Record<string, unknown>, status = 200) => NextResponse.json(payload, { status });

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request.headers.get("authorization"));
  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await request.json().catch(() => null);
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : null;
  const clientMessageId = typeof body?.clientMessageId === "string" ? body.clientMessageId : null;
  const cipherText = typeof body?.cipherText === "string" ? body.cipherText : null;
  const nonce = typeof body?.nonce === "string" ? body.nonce : null;
  const senderPublicKey = typeof body?.senderPublicKey === "string" ? body.senderPublicKey : null;
  const recipientPublicKey = typeof body?.recipientPublicKey === "string" ? body.recipientPublicKey : null;

  if (!conversationId || !clientMessageId || !cipherText || !nonce || !senderPublicKey || !recipientPublicKey) {
    return json({ error: "Invalid message payload" }, 400);
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

  const registeredKey = await getChatPublicKeyForUser(user.id);
  if (!registeredKey || registeredKey !== senderPublicKey) {
    return json({ error: "Sender key is out of sync. Reload messenger." }, 409);
  }

  const { data: messageRow, error: messageError } = await admin
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      sender_user_id: user.id,
      client_message_id: clientMessageId,
      ciphertext: cipherText,
      nonce,
      sender_public_key: senderPublicKey,
      recipient_public_key: recipientPublicKey,
      body: "",
    })
    .select("id, sent_at, client_message_id, ciphertext, nonce, sender_public_key, recipient_public_key")
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
      cipherText: messageRow.ciphertext,
      nonce: messageRow.nonce,
      senderPublicKey: messageRow.sender_public_key,
      recipientPublicKey: messageRow.recipient_public_key,
    },
  });
}
