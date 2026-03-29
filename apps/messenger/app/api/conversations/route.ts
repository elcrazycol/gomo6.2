import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/session";
import { getMessengerUserByMainId, getOrCreateMessengerUser } from "@/lib/server";
import { messengerAdmin } from "@/lib/supabase";

const json = (payload: Record<string, unknown>, status = 200) => NextResponse.json(payload, { status });

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) {
    return json({ error: "Unauthorized" }, 401);
  }

  const self = await getMessengerUserByMainId(session.sub);
  if (!self) {
    return json({ conversations: [] });
  }

  const admin = messengerAdmin();
  const { data: membershipsRaw, error } = await admin
    .from("messenger_conversation_members")
    .select("conversation_id, last_read_at, unread_count_cache")
    .eq("user_id", self.id);

  const memberships =
    (membershipsRaw as Array<{
      conversation_id: string;
      last_read_at: string | null;
      unread_count_cache: number | null;
    }> | null) ?? [];

  if (error || !memberships.length) {
    return json({ conversations: [] });
  }

  const conversationIds = memberships.map((membership) => membership.conversation_id);
  const { data: conversationsRaw } = await admin
    .from("messenger_conversations")
    .select("id, created_at, last_message_at, last_message_preview")
    .in("id", conversationIds);
  const conversations =
    (conversationsRaw as Array<{
      id: string;
      created_at: string | null;
      last_message_at: string | null;
      last_message_preview: string | null;
    }> | null) ?? [];

  const { data: keysRaw } = await admin
    .from("messenger_conversation_keys")
    .select("conversation_id, device_id, encrypted_key")
    .eq("user_id", self.id)
    .in("conversation_id", conversationIds);
  const keys =
    (keysRaw as Array<{
      conversation_id: string;
      device_id: string;
      encrypted_key: string;
    }> | null) ?? [];

  const { data: participantsRaw } = await admin
    .from("messenger_conversation_members")
    .select("conversation_id, user_id")
    .in("conversation_id", conversationIds)
    .neq("user_id", self.id);
  const participants =
    (participantsRaw as Array<{
      conversation_id: string;
      user_id: string;
    }> | null) ?? [];

  const participantIds = [...new Set(participants.map((row) => row.user_id))];
  let otherUsersRaw: unknown[] | null = [];
  if (participantIds.length) {
    const response = await admin
      .from("messenger_users")
      .select("id, main_user_id, username, account_number, avatar_url")
      .in("id", participantIds);
    otherUsersRaw = response.data;
  }
  const otherUsers =
    (otherUsersRaw as Array<{
      id: string;
      main_user_id: string;
      username: string;
      account_number: number | null;
      avatar_url: string | null;
    }> | null) ?? [];

  const serialized = memberships.map((membership) => {
    const conversation = conversations.find((row) => row.id === membership.conversation_id);
    const otherMembership = participants.find((row) => row.conversation_id === membership.conversation_id);
    const otherUser = otherUsers.find((row) => row.id === otherMembership?.user_id);

    return {
      id: membership.conversation_id,
      createdAt: conversation?.created_at ?? null,
      lastMessageAt: conversation?.last_message_at ?? null,
      lastMessagePreview: conversation?.last_message_preview ?? null,
      unreadCount: membership.unread_count_cache ?? 0,
      lastReadAt: membership.last_read_at ?? null,
      keychain:
        keys
          .filter((row) => row.conversation_id === membership.conversation_id)
          .map((row) => ({
            deviceId: row.device_id,
            encryptedKey: row.encrypted_key,
          })),
      otherUser: otherUser
        ? {
            id: otherUser.id,
            mainUserId: otherUser.main_user_id,
            username: otherUser.username,
            accountNumber: otherUser.account_number,
            avatarUrl: otherUser.avatar_url,
          }
        : null,
    };
  });

  serialized.sort((left, right) => {
    const leftTime = left.lastMessageAt ? new Date(left.lastMessageAt).getTime() : 0;
    const rightTime = right.lastMessageAt ? new Date(right.lastMessageAt).getTime() : 0;
    return rightTime - leftTime;
  });

  return json({ conversations: serialized });
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await request.json().catch(() => null);
  const recipientMainUserId = typeof body?.recipientMainUserId === "string" ? body.recipientMainUserId : null;
  const keychain = Array.isArray(body?.keychain) ? body.keychain : [];

  if (!recipientMainUserId || keychain.length < 2) {
    return json({ error: "Invalid conversation payload" }, 400);
  }

  const self = await getOrCreateMessengerUser({
    mainUserId: session.sub,
    username: session.username,
    accountNumber: session.accountNumber,
    avatarUrl: session.avatarUrl,
  });

  const recipient = await getMessengerUserByMainId(recipientMainUserId);
  if (!recipient) {
    return json({ error: "Recipient has not activated messenger yet" }, 409);
  }

  const directKey = [self.main_user_id, recipient.main_user_id].sort().join(":");
  const admin = messengerAdmin();

  const { data: existingConversationRaw } = await admin
    .from("messenger_conversations")
    .select("id")
    .eq("direct_key", directKey)
    .maybeSingle();
  const existingConversation = (existingConversationRaw as { id: string } | null) ?? null;

  let conversationId = existingConversation?.id ?? null;

  if (!conversationId) {
    const { data: createdConversationRaw, error: createError } = await admin
      .from("messenger_conversations")
      .insert({
        direct_key: directKey,
        created_by: self.id,
      })
      .select("id")
      .single();
    const createdConversation = (createdConversationRaw as { id: string } | null) ?? null;

    if (createError || !createdConversation) {
      return json({ error: "Failed to create conversation" }, 500);
    }

    conversationId = createdConversation.id;
  }

  const { error: membersError } = await admin.from("messenger_conversation_members").upsert(
    [
      { conversation_id: conversationId, user_id: self.id },
      { conversation_id: conversationId, user_id: recipient.id },
    ],
    { onConflict: "conversation_id,user_id" }
  );

  if (membersError) {
    return json({ error: "Failed to save conversation members" }, 500);
  }

  if (existingConversation) {
    return json({ conversation: { id: conversationId, existed: true } });
  }

  const normalizedKeychain = keychain
    .filter(
      (entry: any): entry is {
        userId: string;
        deviceId: string;
        encryptedKey: string;
      } =>
        typeof entry?.userId === "string" &&
        typeof entry?.deviceId === "string" &&
        typeof entry?.encryptedKey === "string"
    )
    .map((entry: { userId: string; deviceId: string; encryptedKey: string }) => ({
      conversation_id: conversationId,
      user_id: entry.userId,
      device_id: entry.deviceId,
      encrypted_key: entry.encryptedKey,
      key_version: 1,
    }));

  const { error: keyError } = await admin.from("messenger_conversation_keys").upsert(normalizedKeychain, {
    onConflict: "conversation_id,user_id,device_id",
  });

  if (keyError) {
    return json({ error: "Failed to save conversation keys" }, 500);
  }

  return json({ conversation: { id: conversationId } });
}
