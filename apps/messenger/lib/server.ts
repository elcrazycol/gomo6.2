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
