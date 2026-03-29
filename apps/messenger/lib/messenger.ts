import { messengerAdmin, type AuthenticatedUser } from "@/lib/auth";

export type ChatDeviceBundle = {
  id: string;
  userId: string;
  clientDeviceId: string;
  signalDeviceId: number;
  registrationId: number;
  deviceLabel: string;
  identityPublicKey: string;
  signedPreKeyId: number;
  signedPreKeyPublic: string;
  signedPreKeySignature: string;
  kyberPreKeyId: number;
  kyberPreKeyPublic: string;
  kyberPreKeySignature: string;
  oneTimePreKeyId: number | null;
  oneTimePreKeyPublic: string | null;
};

export const upsertChatDeviceBundle = async (
  user: AuthenticatedUser,
  payload: {
    clientDeviceId: string;
    signalDeviceId: number | null;
    registrationId: number;
    deviceLabel: string;
    identityPublicKey: string;
    signedPreKeyId: number;
    signedPreKeyPublic: string;
    signedPreKeySignature: string;
    kyberPreKeyId: number;
    kyberPreKeyPublic: string;
    kyberPreKeySignature: string;
    oneTimePreKeys: Array<{ preKeyId: number; publicKey: string }>;
  }
) => {
  const admin = messengerAdmin();

  const { data: existingDevice } = await admin
    .from("chat_devices")
    .select("id, signal_device_id")
    .eq("user_id", user.id)
    .eq("client_device_id", payload.clientDeviceId)
    .maybeSingle();

  let signalDeviceId = payload.signalDeviceId;
  if (!signalDeviceId) {
    if (existingDevice?.signal_device_id) {
      signalDeviceId = existingDevice.signal_device_id;
    } else {
      const { data: devices } = await admin.from("chat_devices").select("signal_device_id").eq("user_id", user.id);
      const nextSignalDeviceId =
        Math.max(
          0,
          ...((devices as Array<{ signal_device_id: number | null }> | null) ?? [])
            .map((device) => device.signal_device_id ?? 0)
            .filter((value) => Number.isFinite(value))
        ) + 1;
      signalDeviceId = Math.min(nextSignalDeviceId, 127);
    }
  }

  const { data: deviceRow, error: deviceError } = await admin
    .from("chat_devices")
    .upsert(
      {
        user_id: user.id,
        client_device_id: payload.clientDeviceId,
        signal_device_id: signalDeviceId,
        registration_id: payload.registrationId,
        device_label: payload.deviceLabel,
        identity_public_key: payload.identityPublicKey,
        is_active: true,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "user_id,client_device_id" }
    )
    .select("id, signal_device_id")
    .single();

  if (deviceError || !deviceRow) {
    throw new Error(`Failed to upsert chat device: ${deviceError?.message ?? "unknown"}`);
  }

  await admin.from("chat_identity_keys").upsert({
    device_id: deviceRow.id,
    user_id: user.id,
    public_key: payload.identityPublicKey,
  });

  await admin
    .from("chat_signed_prekeys")
    .update({ replaced_at: new Date().toISOString() })
    .eq("device_id", deviceRow.id)
    .is("replaced_at", null)
    .neq("signed_prekey_id", payload.signedPreKeyId);

  await admin.from("chat_signed_prekeys").upsert(
    {
      device_id: deviceRow.id,
      user_id: user.id,
      signed_prekey_id: payload.signedPreKeyId,
      public_key: payload.signedPreKeyPublic,
      signature: payload.signedPreKeySignature,
      replaced_at: null,
    },
    { onConflict: "device_id,signed_prekey_id" }
  );

  await admin
    .from("chat_kyber_prekeys")
    .update({ replaced_at: new Date().toISOString() })
    .eq("device_id", deviceRow.id)
    .is("replaced_at", null)
    .neq("kyber_prekey_id", payload.kyberPreKeyId);

  await admin.from("chat_kyber_prekeys").upsert(
    {
      device_id: deviceRow.id,
      user_id: user.id,
      kyber_prekey_id: payload.kyberPreKeyId,
      public_key: payload.kyberPreKeyPublic,
      signature: payload.kyberPreKeySignature,
      replaced_at: null,
    },
    { onConflict: "device_id,kyber_prekey_id" }
  );

  if (payload.oneTimePreKeys.length > 0) {
    await admin.from("chat_one_time_prekeys").upsert(
      payload.oneTimePreKeys.map((preKey) => ({
        device_id: deviceRow.id,
        user_id: user.id,
        prekey_id: preKey.preKeyId,
        public_key: preKey.publicKey,
      })),
      { onConflict: "device_id,prekey_id", ignoreDuplicates: true }
    );
  }

  await admin.from("chat_user_preferences").upsert({ user_id: user.id }, { onConflict: "user_id" });

  return {
    deviceId: deviceRow.id,
    signalDeviceId: deviceRow.signal_device_id,
  };
};

export const getDeviceBundlesForUser = async (userId: string): Promise<ChatDeviceBundle[]> => {
  const admin = messengerAdmin();
  const { data: rows, error } = await admin
    .from("chat_devices")
    .select(
      `
        id,
        user_id,
        client_device_id,
        signal_device_id,
        registration_id,
        device_label,
        identity_public_key,
        chat_signed_prekeys!inner (
          signed_prekey_id,
          public_key,
          signature,
          replaced_at
        ),
        chat_kyber_prekeys!inner (
          kyber_prekey_id,
          public_key,
          signature,
          replaced_at
        ),
        chat_one_time_prekeys (
          prekey_id,
          public_key,
          claimed_at
        )
      `
    )
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load chat device bundles: ${error.message}`);
  }

  return ((rows as any[]) ?? []).map((row) => {
    const signedPreKey = (row.chat_signed_prekeys as any[]).find((entry) => !entry.replaced_at);
    const kyberPreKey = (row.chat_kyber_prekeys as any[]).find((entry) => !entry.replaced_at);
    const availablePreKey = (row.chat_one_time_prekeys as any[]).find((entry) => !entry.claimed_at) ?? null;

    return {
      id: row.id,
      userId: row.user_id,
      clientDeviceId: row.client_device_id,
      signalDeviceId: row.signal_device_id,
      registrationId: row.registration_id,
      deviceLabel: row.device_label,
      identityPublicKey: row.identity_public_key,
      signedPreKeyId: signedPreKey?.signed_prekey_id,
      signedPreKeyPublic: signedPreKey?.public_key,
      signedPreKeySignature: signedPreKey?.signature,
      kyberPreKeyId: kyberPreKey?.kyber_prekey_id,
      kyberPreKeyPublic: kyberPreKey?.public_key,
      kyberPreKeySignature: kyberPreKey?.signature,
      oneTimePreKeyId: availablePreKey?.prekey_id ?? null,
      oneTimePreKeyPublic: availablePreKey?.public_key ?? null,
    } satisfies ChatDeviceBundle;
  });
};

export const loadProfileSummary = async (userId: string) => {
  const admin = messengerAdmin();
  const { data, error } = await admin
    .from("profiles")
    .select("id, username, avatar_url, account_number, is_online, last_seen_at, username_color")
    .eq("id", userId)
    .single();

  if (error || !data) {
    throw new Error(`Failed to load profile summary: ${error?.message ?? "unknown"}`);
  }

  return data;
};

export const listConversationsForUser = async (userId: string) => {
  const admin = messengerAdmin();
  const { data: memberships } = await admin
    .from("chat_conversation_members")
    .select("conversation_id, unread_count_cache, last_read_at")
    .eq("user_id", userId);

  const conversationIds = ((memberships as Array<{ conversation_id: string }> | null) ?? []).map(
    (membership) => membership.conversation_id
  );

  if (conversationIds.length === 0) {
    return [];
  }

  const { data: conversations } = await admin
    .from("chat_conversations")
    .select("id, kind, last_message_at, last_message_sender_id")
    .in("id", conversationIds);

  const { data: members } = await admin
    .from("chat_conversation_members")
    .select("conversation_id, user_id")
    .in("conversation_id", conversationIds);

  const otherUserIds = [...new Set(((members as any[]) ?? []).map((row) => row.user_id).filter((value) => value !== userId))];
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, username, avatar_url, account_number, is_online, last_seen_at, username_color")
    .in("id", otherUserIds);

  const deviceMap = new Map<string, ChatDeviceBundle[]>();
  await Promise.all(
    otherUserIds.map(async (otherUserId) => {
      deviceMap.set(otherUserId, await getDeviceBundlesForUser(otherUserId));
    })
  );

  return ((memberships as any[]) ?? [])
    .map((membership) => {
      const conversation = (conversations as any[])?.find((row) => row.id === membership.conversation_id);
      const otherMember = (members as any[])?.find(
        (row) => row.conversation_id === membership.conversation_id && row.user_id !== userId
      );
      const otherProfile = (profiles as any[])?.find((profile) => profile.id === otherMember?.user_id);
      if (!conversation || !otherProfile) {
        return null;
      }

      return {
        id: conversation.id,
        kind: conversation.kind,
        lastMessageAt: conversation.last_message_at,
        unreadCount: membership.unread_count_cache ?? 0,
        lastReadAt: membership.last_read_at ?? null,
        otherUser: {
          id: otherProfile.id,
          username: otherProfile.username,
          avatarUrl: otherProfile.avatar_url,
          accountNumber: otherProfile.account_number,
          isOnline: otherProfile.is_online,
          lastSeenAt: otherProfile.last_seen_at,
          usernameColor: otherProfile.username_color,
        },
        devices: deviceMap.get(otherProfile.id) ?? [],
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
    .sort((left, right) => {
      const leftTime = left.lastMessageAt ? new Date(left.lastMessageAt).getTime() : 0;
      const rightTime = right.lastMessageAt ? new Date(right.lastMessageAt).getTime() : 0;
      return rightTime - leftTime;
    });
};
