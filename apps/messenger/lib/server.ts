import { messengerAdmin } from "@/lib/supabase";

export type MessengerUser = {
  id: string;
  main_user_id: string;
  username: string;
  account_number: number | null;
  avatar_url: string | null;
};

export const getOrCreateMessengerUser = async (input: {
  mainUserId: string;
  username: string;
  accountNumber: number | null;
  avatarUrl: string | null;
}) => {
  const admin = messengerAdmin();
  const { data, error } = await admin
    .from("messenger_users")
    .upsert(
      {
        main_user_id: input.mainUserId,
        username: input.username,
        account_number: input.accountNumber,
        avatar_url: input.avatarUrl,
      },
      {
        onConflict: "main_user_id",
      }
    )
    .select("id, main_user_id, username, account_number, avatar_url")
    .single();

  if (error || !data) {
    throw new Error("Failed to create messenger user");
  }

  return data as MessengerUser;
};

export const getMessengerUserByMainId = async (mainUserId: string) => {
  const admin = messengerAdmin();
  const { data } = await admin
    .from("messenger_users")
    .select("id, main_user_id, username, account_number, avatar_url")
    .eq("main_user_id", mainUserId)
    .maybeSingle();

  return (data as MessengerUser | null) ?? null;
};

export const touchMessengerDevice = async (input: {
  userId: string;
  deviceId: string;
  label?: string;
  publicKey: string;
}) => {
  const admin = messengerAdmin();
  const { error } = await admin.from("messenger_devices").upsert(
    {
      user_id: input.userId,
      device_id: input.deviceId,
      label: input.label ?? "browser",
      public_key: input.publicKey,
      last_seen_at: new Date().toISOString(),
    },
    {
      onConflict: "user_id,device_id",
    }
  );

  if (error) {
    throw new Error("Failed to register messenger device");
  }
};

export const getConversationForUser = async (conversationId: string, userId: string) => {
  const admin = messengerAdmin();
  const { data } = await admin
    .from("messenger_conversation_members")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();

  return data;
};

export const purgeBrokenEmptyConversations = async (
  userId: string,
  conversations: Array<{
    id: string;
    last_message_at: string | null;
  }>,
  participants: Array<{
    conversation_id: string;
    user_id: string;
  }>,
  keys: Array<{
    conversation_id: string;
    device_id: string;
    encrypted_key: string;
  }>
) => {
  const admin = messengerAdmin();
  const conversationIds = conversations.map((conversation) => conversation.id);
  if (!conversationIds.length) return new Set<string>();

  const { data: messagesRaw } = await admin
    .from("messenger_messages")
    .select("conversation_id")
    .in("conversation_id", conversationIds);

  const conversationsWithMessages = new Set(
    ((messagesRaw as Array<{ conversation_id: string | null }> | null) ?? [])
      .map((message) => message.conversation_id)
      .filter((value): value is string => typeof value === "string")
  );

  const brokenIds = conversations
    .filter((conversation) => {
      const hasMessages = conversationsWithMessages.has(conversation.id) || Boolean(conversation.last_message_at);
      const hasPeer = participants.some((participant) => participant.conversation_id === conversation.id);
      const hasOwnKey = keys.some((key) => key.conversation_id === conversation.id);
      return !hasMessages && (!hasPeer || !hasOwnKey);
    })
    .map((conversation) => conversation.id);

  if (brokenIds.length > 0) {
    await admin.from("messenger_conversations").delete().in("id", brokenIds);
  }

  return new Set(brokenIds);
};

export const getMessengerConversationSnapshot = async (userId: string, conversationId?: string | null) => {
  const admin = messengerAdmin();

  const { data: membershipsRaw } = await admin
    .from("messenger_conversation_members")
    .select("conversation_id, unread_count_cache, updated_at")
    .eq("user_id", userId);

  const memberships =
    (membershipsRaw as Array<{
      conversation_id: string | null;
      unread_count_cache: number | null;
      updated_at: string | null;
    }> | null) ?? [];

  const conversationIds = memberships
    .map((membership) => membership.conversation_id)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  let conversationRows: Array<{
    id: string;
    last_message_at: string | null;
    updated_at: string | null;
  }> = [];

  if (conversationIds.length > 0) {
    const { data: conversationsRaw } = await admin
      .from("messenger_conversations")
      .select("id, last_message_at, updated_at")
      .in("id", conversationIds);

    conversationRows =
      (conversationsRaw as Array<{
        id: string;
        last_message_at: string | null;
        updated_at: string | null;
      }> | null) ?? [];
  }

  let selectedMessageRows: Array<{
    id: string;
    sent_at: string | null;
  }> = [];

  if (conversationId) {
    const { data: messagesRaw } = await admin
      .from("messenger_messages")
      .select("id, sent_at")
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: false })
      .limit(1);

    selectedMessageRows =
      (messagesRaw as Array<{
        id: string;
        sent_at: string | null;
      }> | null) ?? [];
  }

  return JSON.stringify({
    memberships: memberships
      .filter((membership) => typeof membership.conversation_id === "string")
      .sort((left, right) => `${left.conversation_id}`.localeCompare(`${right.conversation_id}`))
      .map((membership) => ({
        conversationId: membership.conversation_id,
        unreadCount: membership.unread_count_cache ?? 0,
        updatedAt: membership.updated_at ?? null,
      })),
    conversations: conversationRows
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((conversation) => ({
        id: conversation.id,
        lastMessageAt: conversation.last_message_at ?? null,
        updatedAt: conversation.updated_at ?? null,
      })),
    selectedConversation: selectedMessageRows[0]
      ? {
          id: selectedMessageRows[0].id,
          sentAt: selectedMessageRows[0].sent_at ?? null,
        }
      : null,
  });
};
