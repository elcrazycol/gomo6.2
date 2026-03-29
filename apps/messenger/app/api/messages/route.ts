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
  const senderDeviceId = typeof body?.senderDeviceId === "string" ? body.senderDeviceId : null;
  const clientMessageId = typeof body?.clientMessageId === "string" ? body.clientMessageId : null;
  const envelopes = Array.isArray(body?.envelopes) ? body.envelopes : [];

  if (!conversationId || !senderDeviceId || !clientMessageId || envelopes.length === 0) {
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
    .eq("id", senderDeviceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!device) {
    return json({ error: "Unknown sender device" }, 403);
  }

  const { data: messageRow, error: messageError } = await admin
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      sender_user_id: user.id,
      sender_device_id: senderDeviceId,
      client_message_id: clientMessageId,
    })
    .select("id, sent_at")
    .single();

  if (messageError || !messageRow) {
    return json({ error: messageError?.message ?? "Failed to create message" }, 500);
  }

  const { data: conversationMembers } = await admin
    .from("chat_conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId);

  const allowedUserIds = new Set(((conversationMembers as Array<{ user_id: string }> | null) ?? []).map((row) => row.user_id));
  const normalizedEnvelopes = envelopes.filter(
    (entry: unknown): entry is {
      recipientUserId: string;
      recipientDeviceId: string;
      ciphertext: string;
      messageType: number;
    } =>
      typeof entry === "object" &&
      entry !== null &&
      "recipientUserId" in entry &&
      "recipientDeviceId" in entry &&
      "ciphertext" in entry &&
      "messageType" in entry &&
      typeof (entry as { recipientUserId?: unknown }).recipientUserId === "string" &&
      typeof (entry as { recipientDeviceId?: unknown }).recipientDeviceId === "string" &&
      typeof (entry as { ciphertext?: unknown }).ciphertext === "string" &&
      typeof (entry as { messageType?: unknown }).messageType === "number" &&
      allowedUserIds.has((entry as { recipientUserId: string }).recipientUserId)
  );

  if (normalizedEnvelopes.length === 0) {
    return json({ error: "No valid encrypted envelopes supplied" }, 400);
  }

  const recipientDevices = [
    ...new Set(normalizedEnvelopes.map((entry: (typeof normalizedEnvelopes)[number]) => entry.recipientDeviceId)),
  ];
  const { data: knownDevices } = await admin
    .from("chat_devices")
    .select("id, user_id")
    .in("id", recipientDevices);

  const validDeviceOwners = new Map(((knownDevices as Array<{ id: string; user_id: string }> | null) ?? []).map((row) => [row.id, row.user_id]));
  const rowsToInsert = normalizedEnvelopes.filter(
    (entry: (typeof normalizedEnvelopes)[number]) => validDeviceOwners.get(entry.recipientDeviceId) === entry.recipientUserId
  );

  const { error: envelopeError } = await admin.from("chat_message_envelopes").insert(
    rowsToInsert.map((entry: (typeof rowsToInsert)[number]) => ({
      message_id: messageRow.id,
      recipient_user_id: entry.recipientUserId,
      recipient_device_id: entry.recipientDeviceId,
      ciphertext: entry.ciphertext,
      message_type: entry.messageType,
    }))
  );

  if (envelopeError) {
    return json({ error: envelopeError.message }, 500);
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
    },
  });
}
