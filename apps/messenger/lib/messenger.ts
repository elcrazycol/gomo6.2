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

export type ProfileAppearance = {
  usernameColor: string | null;
  usernameCss: string | null;
  usernameIconSvg: string | null;
  usernameIconFill: string | null;
  usernameIconStroke: string | null;
  profileBadgeText: string | null;
  profileBadgeCss: string | null;
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

  const { data: existingDevice, error: existingDeviceError } = await admin
    .from("chat_devices")
    .select("id, signal_device_id")
    .eq("user_id", user.id)
    .eq("client_device_id", payload.clientDeviceId)
    .maybeSingle();

  if (existingDeviceError) {
    throw new Error(`Failed to load existing chat device: ${existingDeviceError.message}`);
  }

  let signalDeviceId = payload.signalDeviceId;
  if (!signalDeviceId) {
    if (existingDevice?.signal_device_id) {
      signalDeviceId = existingDevice.signal_device_id;
    } else {
      const { data: devices, error: devicesError } = await admin
        .from("chat_devices")
        .select("signal_device_id")
        .eq("user_id", user.id);
      if (devicesError) {
        throw new Error(`Failed to list chat devices: ${devicesError.message}`);
      }
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

  const { error: identityError } = await admin.from("chat_identity_keys").upsert({
    device_id: deviceRow.id,
    user_id: user.id,
    public_key: payload.identityPublicKey,
  });
  if (identityError) {
    throw new Error(`Failed to upsert identity key: ${identityError.message}`);
  }

  const { error: signedRotateError } = await admin
    .from("chat_signed_prekeys")
    .update({ replaced_at: new Date().toISOString() })
    .eq("device_id", deviceRow.id)
    .is("replaced_at", null)
    .neq("signed_prekey_id", payload.signedPreKeyId);
  if (signedRotateError) {
    throw new Error(`Failed to rotate signed prekeys: ${signedRotateError.message}`);
  }

  const { error: signedPreKeyError } = await admin.from("chat_signed_prekeys").upsert(
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
  if (signedPreKeyError) {
    throw new Error(`Failed to upsert signed prekey: ${signedPreKeyError.message}`);
  }

  const { error: kyberRotateError } = await admin
    .from("chat_kyber_prekeys")
    .update({ replaced_at: new Date().toISOString() })
    .eq("device_id", deviceRow.id)
    .is("replaced_at", null)
    .neq("kyber_prekey_id", payload.kyberPreKeyId);
  if (kyberRotateError) {
    throw new Error(`Failed to rotate kyber prekeys: ${kyberRotateError.message}`);
  }

  const { error: kyberError } = await admin.from("chat_kyber_prekeys").upsert(
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
  if (kyberError) {
    throw new Error(`Failed to upsert kyber prekey: ${kyberError.message}`);
  }

  if (payload.oneTimePreKeys.length > 0) {
    const { error: prekeysError } = await admin.from("chat_one_time_prekeys").upsert(
      payload.oneTimePreKeys.map((preKey) => ({
        device_id: deviceRow.id,
        user_id: user.id,
        prekey_id: preKey.preKeyId,
        public_key: preKey.publicKey,
      })),
      { onConflict: "device_id,prekey_id", ignoreDuplicates: true }
    );
    if (prekeysError) {
      throw new Error(`Failed to upsert one-time prekeys: ${prekeysError.message}`);
    }
  }

  const { error: preferencesError } = await admin
    .from("chat_user_preferences")
    .upsert({ user_id: user.id }, { onConflict: "user_id" });
  if (preferencesError) {
    throw new Error(`Failed to upsert messenger preferences: ${preferencesError.message}`);
  }

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
    .select("id, username, avatar_url, account_number, is_online, last_seen_at")
    .eq("id", userId)
    .single();

  if (error || !data) {
    throw new Error(`Failed to load profile summary: ${error?.message ?? "unknown"}`);
  }

  return data;
};

export const loadProfileSummaryOrFallback = async (userId: string) => {
  const admin = messengerAdmin();
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, username, avatar_url, account_number, is_online, last_seen_at")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    throw new Error(`Failed to load profile summary: ${profileError.message}`);
  }

  if (profile) {
    return profile;
  }

  const { data: authData, error: authError } = await admin.auth.admin.getUserById(userId);
  if (authError || !authData.user) {
    return {
      id: userId,
      username: "gomo6 user",
      avatar_url: null,
      account_number: null,
      is_online: null,
      last_seen_at: null,
    };
  }

  return {
    id: userId,
    username:
      typeof authData.user.user_metadata?.username === "string" && authData.user.user_metadata.username.length > 0
        ? authData.user.user_metadata.username
        : "gomo6 user",
    avatar_url:
      typeof authData.user.user_metadata?.avatar_url === "string" ? authData.user.user_metadata.avatar_url : null,
    account_number: null,
    is_online: null,
    last_seen_at: null,
  };
};

export const loadProfileAppearance = async (userId: string): Promise<ProfileAppearance> => {
  const admin = messengerAdmin();

  const [{ data: customization, error: customizationError }, { data: achievements, error: achievementsError }] =
    await Promise.all([
      admin
        .from("profile_customization")
        .select("username_css, username_icon_svg, username_icon_fill, username_icon_stroke, profile_badge_text, profile_badge_css")
        .eq("user_id", userId)
        .maybeSingle(),
      admin
        .from("user_achievements")
        .select(`
          achievement_id,
          achievements (
            reward_type,
            reward_value
          )
        `)
        .eq("user_id", userId),
    ]);

  if (customizationError) {
    throw new Error(`Failed to load profile customization: ${customizationError.message}`);
  }

  if (achievementsError) {
    throw new Error(`Failed to load profile achievements: ${achievementsError.message}`);
  }

  const colorRewards = ((achievements as any[]) ?? [])
    .filter((entry) => entry.achievements?.reward_type === "username_color")
    .map((entry) => entry.achievements?.reward_value)
    .filter((value): value is string => typeof value === "string");

  const colorPriority = ["purple", "gold", "orange", "red", "blue", "green", "yellow", "cyan"];

  return {
    usernameColor: colorPriority.find((value) => colorRewards.includes(value)) ?? null,
    usernameCss: customization?.username_css ?? null,
    usernameIconSvg: customization?.username_icon_svg ?? null,
    usernameIconFill: customization?.username_icon_fill ?? null,
    usernameIconStroke: customization?.username_icon_stroke ?? null,
    profileBadgeText: customization?.profile_badge_text ?? null,
    profileBadgeCss: customization?.profile_badge_css ?? null,
  };
};

export const createOrLoadDirectConversation = async (userId: string, recipientUserId: string) => {
  const admin = messengerAdmin();
  const directKey = [userId, recipientUserId].sort().join(":");

  const { data: existingConversation, error: existingConversationError } = await admin
    .from("chat_conversations")
    .select("id")
    .eq("direct_key", directKey)
    .maybeSingle();

  if (existingConversationError) {
    throw new Error(`Failed to load direct conversation: ${existingConversationError.message}`);
  }

  let conversationId = existingConversation?.id ?? null;

  if (!conversationId) {
    const { data: createdConversation, error: createConversationError } = await admin
      .from("chat_conversations")
      .insert({
        kind: "direct",
        direct_key: directKey,
        created_by: userId,
      })
      .select("id")
      .single();

    if (createConversationError || !createdConversation) {
      throw new Error(`Failed to create direct conversation: ${createConversationError?.message ?? "unknown"}`);
    }

    conversationId = createdConversation.id;
  }

  const { error: membersError } = await admin.from("chat_conversation_members").upsert(
    [
      { conversation_id: conversationId, user_id: userId },
      { conversation_id: conversationId, user_id: recipientUserId },
    ],
    { onConflict: "conversation_id,user_id" }
  );

  if (membersError) {
    throw new Error(`Failed to upsert conversation members: ${membersError.message}`);
  }

  return conversationId;
};

export const markConversationRead = async (userId: string, conversationId: string, lastReadMessageId: string | null) => {
  const admin = messengerAdmin();
  const { data: membership, error: membershipError } = await admin
    .from("chat_conversation_members")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipError) {
    throw new Error(`Failed to load conversation membership: ${membershipError.message}`);
  }

  if (!membership) {
    throw new Error("Conversation access denied");
  }

  let resolvedReadAt = new Date().toISOString();
  if (lastReadMessageId) {
    const { data: messageRow, error: messageError } = await admin
      .from("chat_messages")
      .select("sent_at")
      .eq("id", lastReadMessageId)
      .eq("conversation_id", conversationId)
      .maybeSingle();

    if (messageError) {
      throw new Error(`Failed to resolve last read message: ${messageError.message}`);
    }

    resolvedReadAt = messageRow?.sent_at ?? resolvedReadAt;
  }

  const { error: memberUpdateError } = await admin
    .from("chat_conversation_members")
    .update({
      last_read_message_id: lastReadMessageId,
      last_read_at: resolvedReadAt,
      unread_count_cache: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);

  if (memberUpdateError) {
    throw new Error(`Failed to update read state: ${memberUpdateError.message}`);
  }

  const { error: receiptsError } = await admin
    .from("chat_receipts")
    .update({
      read_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .in(
      "message_id",
      (
        (
          await admin
            .from("chat_messages")
            .select("id")
            .eq("conversation_id", conversationId)
        ).data ?? []
      ).map((row: { id: string }) => row.id)
    );

  if (receiptsError) {
    throw new Error(`Failed to update receipts: ${receiptsError.message}`);
  }

  await admin
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", userId)
    .eq("type", "message")
    .eq("related_conversation_id", conversationId);
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
  const profileMap = new Map<string, Awaited<ReturnType<typeof loadProfileSummaryOrFallback>>>();
  const appearanceMap = new Map<string, ProfileAppearance>();
  await Promise.all(
    otherUserIds.map(async (otherUserId) => {
      const [profile, appearance] = await Promise.all([
        loadProfileSummaryOrFallback(otherUserId),
        loadProfileAppearance(otherUserId),
      ]);
      profileMap.set(otherUserId, profile);
      appearanceMap.set(otherUserId, appearance);
    })
  );

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
      const otherProfile = otherMember?.user_id ? profileMap.get(otherMember.user_id) : null;
      const appearance = otherMember?.user_id ? appearanceMap.get(otherMember.user_id) : null;
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
          usernameColor: appearance?.usernameColor ?? null,
          usernameCss: appearance?.usernameCss ?? null,
          usernameIconSvg: appearance?.usernameIconSvg ?? null,
          usernameIconFill: appearance?.usernameIconFill ?? null,
          usernameIconStroke: appearance?.usernameIconStroke ?? null,
          profileBadgeText: appearance?.profileBadgeText ?? null,
          profileBadgeCss: appearance?.profileBadgeCss ?? null,
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

export const buildConversationSummary = async (userId: string, conversationId: string) => {
  const conversations = await listConversationsForUser(userId);
  return conversations.find((conversation) => conversation.id === conversationId) ?? null;
};
