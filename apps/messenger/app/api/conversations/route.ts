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

  const { data: memberships } = await admin
    .from("conversation_memberships")
    .select("conversation_id, encrypted_key, last_read_at, conversations(id, created_at, last_message_at)")
    .eq("user_id", self.id);

  const conversationIds = memberships?.map((membership) => membership.conversation_id) ?? [];
  if (conversationIds.length === 0) {
    return json({ conversations: [] });
  }

  const { data: participants } = await admin
    .from("conversation_memberships")
    .select("conversation_id, user_id, messenger_users(id, main_user_id, username)")
    .in("conversation_id", conversationIds)
    .neq("user_id", self.id);

  const { data: unreadRows } = await admin
    .from("messenger_messages")
    .select("conversation_id, sender_user_id, created_at")
    .in("conversation_id", conversationIds)
    .neq("sender_user_id", self.id);

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
    const other = participants?.find((participant) => participant.conversation_id === membership.conversation_id);
    return {
      id: membership.conversation_id,
      createdAt: (membership as any).conversations?.created_at ?? null,
      encryptedKey: membership.encrypted_key,
      unreadCount: unreadMap.get(membership.conversation_id) ?? 0,
      lastMessageAt: (membership as any).conversations?.last_message_at ?? null,
      otherUser: {
        id: (other as any)?.messenger_users?.id ?? "",
        mainUserId: (other as any)?.messenger_users?.main_user_id ?? "",
        username: (other as any)?.messenger_users?.username ?? "Unknown",
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

  const { data: existingConversation } = await admin
    .from("messenger_conversations")
    .select("id")
    .eq("direct_key", directKey)
    .maybeSingle();

  const conversation =
    existingConversation ??
    (
      await admin
        .from("messenger_conversations")
        .insert({
          direct_key: directKey,
          created_by: self.id,
        })
        .select("id")
        .single()
    ).data;

  if (!conversation) {
    return json({ error: "Failed to create conversation" }, 500);
  }

  await admin.from("conversation_memberships").upsert(
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

  return json({
    conversation: {
      id: conversation.id,
    },
  });
}
