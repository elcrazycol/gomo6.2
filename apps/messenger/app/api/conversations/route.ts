import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/session";
import { messengerAdmin } from "@/lib/supabase";

const json = (payload: Record<string, unknown>, status = 200) => NextResponse.json(payload, { status });

const getSelfUser = async (admin: ReturnType<typeof messengerAdmin>, mainUserId: string) => {
  const { data } = await admin
    .from("messenger_users")
    .select("id, main_user_id, username")
    .eq("main_user_id", mainUserId)
    .single();

  return data;
};

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) {
    return json({ error: "Unauthorized" }, 401);
  }

  const admin = messengerAdmin();
  const self = await getSelfUser(admin, session.sub);
  if (!self) {
    return json({ conversations: [] });
  }

  const { data: memberships, error: membershipsError } = await admin
    .from("conversation_memberships")
    .select("conversation_id, encrypted_key, last_read_at")
    .eq("user_id", self.id);

  if (membershipsError) {
    return json({ error: "Failed to load conversation memberships" }, 500);
  }

  const conversationIds = memberships?.map((membership) => membership.conversation_id) ?? [];
  if (conversationIds.length === 0) {
    return json({ conversations: [] });
  }

  const { data: conversationRows, error: conversationsError } = await admin
    .from("messenger_conversations")
    .select("id, created_at, last_message_at")
    .in("id", conversationIds);

  if (conversationsError) {
    return json({ error: "Failed to load conversations" }, 500);
  }

  const { data: participants, error: participantsError } = await admin
    .from("conversation_memberships")
    .select("conversation_id, user_id")
    .in("conversation_id", conversationIds)
    .neq("user_id", self.id);

  if (participantsError) {
    return json({ error: "Failed to load conversation participants" }, 500);
  }

  const participantUserIds = [...new Set((participants ?? []).map((participant) => participant.user_id))];

  const { data: participantUsers, error: participantUsersError } = participantUserIds.length
    ? await admin
        .from("messenger_users")
        .select("id, main_user_id, username")
        .in("id", participantUserIds)
    : { data: [], error: null };

  if (participantUsersError) {
    return json({ error: "Failed to load participant profiles" }, 500);
  }

  const { data: unreadRows, error: unreadError } = await admin
    .from("messenger_messages")
    .select("conversation_id, sender_user_id, created_at")
    .in("conversation_id", conversationIds)
    .neq("sender_user_id", self.id);

  if (unreadError) {
    return json({ error: "Failed to load unread counters" }, 500);
  }

  const unreadMap = new Map<string, number>();
  memberships?.forEach((membership) => {
    const count = (unreadRows ?? []).filter((row) => {
      if (row.conversation_id !== membership.conversation_id) return false;
      if (!membership.last_read_at) return true;
      return new Date(row.created_at).getTime() > new Date(membership.last_read_at).getTime();
    }).length;
    unreadMap.set(membership.conversation_id, count);
  });

  const conversations = (memberships ?? []).map((membership) => {
    const conversation = conversationRows?.find((row) => row.id === membership.conversation_id);
    const otherParticipant = participants?.find((participant) => participant.conversation_id === membership.conversation_id);
    const other = participantUsers?.find((user) => user.id === otherParticipant?.user_id);

    return {
      id: membership.conversation_id,
      createdAt: conversation?.created_at ?? null,
      encryptedKey: membership.encrypted_key,
      unreadCount: unreadMap.get(membership.conversation_id) ?? 0,
      lastMessageAt: conversation?.last_message_at ?? null,
      otherUser: {
        id: other?.id ?? "",
        mainUserId: other?.main_user_id ?? "",
        username: other?.username ?? "Unknown",
      },
    };
  });

  conversations.sort((left, right) => {
    const leftDate = left.lastMessageAt ? new Date(left.lastMessageAt).getTime() : 0;
    const rightDate = right.lastMessageAt ? new Date(right.lastMessageAt).getTime() : 0;
    return rightDate - leftDate;
  });

  return json({ conversations });
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await request.json();
  const recipientMainUserId = typeof body.recipientMainUserId === "string" ? body.recipientMainUserId : null;
  const senderEncryptedKey = typeof body.senderEncryptedKey === "string" ? body.senderEncryptedKey : null;
  const recipientEncryptedKey = typeof body.recipientEncryptedKey === "string" ? body.recipientEncryptedKey : null;

  if (!recipientMainUserId || !senderEncryptedKey || !recipientEncryptedKey) {
    return json({ error: "Invalid conversation payload" }, 400);
  }

  const admin = messengerAdmin();
  const self = await getSelfUser(admin, session.sub);

  if (!self) {
    return json({ error: "Current messenger user not found" }, 404);
  }

  const { data: recipient } = await admin
    .from("messenger_users")
    .select("id, main_user_id, username")
    .eq("main_user_id", recipientMainUserId)
    .maybeSingle();

  if (!recipient) {
    return json({ error: "Recipient has not activated messenger yet" }, 409);
  }

  const directKey = [self.main_user_id, recipient.main_user_id].sort().join(":");

  const { data: existingConversation, error: existingConversationError } = await admin
    .from("messenger_conversations")
    .select("id")
    .eq("direct_key", directKey)
    .maybeSingle();

  if (existingConversationError) {
    return json({ error: "Failed to check existing conversation" }, 500);
  }

  let conversation = existingConversation;

  if (!conversation) {
    const { data: createdConversation, error: createConversationError } = await admin
      .from("messenger_conversations")
      .insert({
        direct_key: directKey,
        created_by: self.id,
      })
      .select("id")
      .single();

    if (createConversationError || !createdConversation) {
      return json({ error: "Failed to create conversation" }, 500);
    }

    conversation = createdConversation;
  }

  if (!conversation) {
    return json({ error: "Failed to create conversation" }, 500);
  }

  const { error: membershipUpsertError } = await admin.from("conversation_memberships").upsert(
    [
      {
        conversation_id: conversation.id,
        user_id: self.id,
        encrypted_key: senderEncryptedKey,
      },
      {
        conversation_id: conversation.id,
        user_id: recipient.id,
        encrypted_key: recipientEncryptedKey,
      },
    ],
    {
      onConflict: "conversation_id,user_id",
    }
  );

  if (membershipUpsertError) {
    return json({ error: "Failed to save conversation members" }, 500);
  }

  return json({
    conversation: {
      id: conversation.id,
    },
  });
}
