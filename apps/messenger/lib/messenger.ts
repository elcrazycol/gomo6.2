import { messengerAdmin } from "@/lib/auth";

export type ProfileAppearance = {
  usernameColor: string | null;
  usernameCss: string | null;
  usernameIconSvg: string | null;
  usernameIconFill: string | null;
  usernameIconStroke: string | null;
  profileBadgeText: string | null;
  profileBadgeCss: string | null;
};

const usernameColorPriority = ["purple", "gold", "orange", "red", "blue", "green", "yellow", "cyan"];

export const upsertChatUserKey = async (userId: string, publicKey: string) => {
  const admin = messengerAdmin();
  const { error } = await admin
    .from("chat_user_keys")
    .upsert({ user_id: userId, public_key: publicKey }, { onConflict: "user_id" });

  if (error) {
    throw new Error(`Failed to save messenger key: ${error.message}`);
  }
};

export const getChatPublicKeyForUser = async (userId: string) => {
  const admin = messengerAdmin();
  const { data, error } = await admin
    .from("chat_user_keys")
    .select("public_key")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load messenger key: ${error.message}`);
  }

  return data?.public_key ?? null;
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

  return {
    usernameColor: usernameColorPriority.find((value) => colorRewards.includes(value)) ?? null,
    usernameCss: customization?.username_css ?? null,
    usernameIconSvg: customization?.username_icon_svg ?? null,
    usernameIconFill: customization?.username_icon_fill ?? null,
    usernameIconStroke: customization?.username_icon_stroke ?? null,
    profileBadgeText: customization?.profile_badge_text ?? null,
    profileBadgeCss: customization?.profile_badge_css ?? null,
  };
};

export const loadProfileAppearanceMap = async (userIds: string[]) => {
  if (userIds.length === 0) {
    return new Map<string, ProfileAppearance>();
  }

  const admin = messengerAdmin();
  const [{ data: customizations, error: customizationError }, { data: achievements, error: achievementsError }] =
    await Promise.all([
      admin
        .from("profile_customization")
        .select("user_id, username_css, username_icon_svg, username_icon_fill, username_icon_stroke, profile_badge_text, profile_badge_css")
        .in("user_id", userIds),
      admin
        .from("user_achievements")
        .select(`
          user_id,
          achievements (
            reward_type,
            reward_value
          )
        `)
        .in("user_id", userIds),
    ]);

  if (customizationError) {
    throw new Error(`Failed to load profile customizations: ${customizationError.message}`);
  }

  if (achievementsError) {
    throw new Error(`Failed to load profile achievements: ${achievementsError.message}`);
  }

  const customizationMap = new Map(((customizations as any[]) ?? []).map((entry) => [entry.user_id, entry]));
  const colorRewardMap = new Map<string, string[]>();

  for (const entry of (achievements as any[]) ?? []) {
    if (entry.achievements?.reward_type !== "username_color" || typeof entry.achievements?.reward_value !== "string") {
      continue;
    }
    const current = colorRewardMap.get(entry.user_id) ?? [];
    current.push(entry.achievements.reward_value);
    colorRewardMap.set(entry.user_id, current);
  }

  const appearanceMap = new Map<string, ProfileAppearance>();
  for (const userId of userIds) {
    const customization = customizationMap.get(userId) ?? null;
    const colorRewards = colorRewardMap.get(userId) ?? [];

    appearanceMap.set(userId, {
      usernameColor: usernameColorPriority.find((value) => colorRewards.includes(value)) ?? null,
      usernameCss: customization?.username_css ?? null,
      usernameIconSvg: customization?.username_icon_svg ?? null,
      usernameIconFill: customization?.username_icon_fill ?? null,
      usernameIconStroke: customization?.username_icon_stroke ?? null,
      profileBadgeText: customization?.profile_badge_text ?? null,
      profileBadgeCss: customization?.profile_badge_css ?? null,
    });
  }

  return appearanceMap;
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

  let safeLastReadMessageId: string | null = lastReadMessageId;
  let resolvedReadAt = new Date().toISOString();
  if (safeLastReadMessageId) {
    const { data: messageRow, error: messageError } = await admin
      .from("chat_messages")
      .select("sent_at")
      .eq("id", safeLastReadMessageId)
      .eq("conversation_id", conversationId)
      .maybeSingle();

    if (messageError) {
      throw new Error(`Failed to resolve last read message: ${messageError.message}`);
    }

    if (messageRow?.sent_at) {
      resolvedReadAt = messageRow.sent_at;
    } else {
      safeLastReadMessageId = null;
    }
  }

  const { error: memberUpdateError } = await admin
    .from("chat_conversation_members")
    .update({
      last_read_message_id: safeLastReadMessageId,
      last_read_at: resolvedReadAt,
      unread_count_cache: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);

  if (memberUpdateError) {
    throw new Error(`Failed to update read state: ${memberUpdateError.message}`);
  }

  const { data: messageRows, error: messageRowsError } = await admin
    .from("chat_messages")
    .select("id")
    .eq("conversation_id", conversationId);

  if (messageRowsError) {
    throw new Error(`Failed to list conversation messages: ${messageRowsError.message}`);
  }

  const messageIds = ((messageRows as Array<{ id: string }> | null) ?? []).map((row) => row.id);
  if (messageIds.length > 0) {
    const { error: receiptsError } = await admin
      .from("chat_receipts")
      .update({
        read_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .in("message_id", messageIds);

    if (receiptsError) {
      throw new Error(`Failed to update receipts: ${receiptsError.message}`);
    }
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
  const { data: memberships, error: membershipsError } = await admin
    .from("chat_conversation_members")
    .select("conversation_id, unread_count_cache, last_read_at")
    .eq("user_id", userId);

  if (membershipsError) {
    throw new Error(`Failed to load conversation memberships: ${membershipsError.message}`);
  }

  const conversationIds = ((memberships as Array<{ conversation_id: string }> | null) ?? []).map(
    (membership) => membership.conversation_id
  );

  if (conversationIds.length === 0) {
    return [];
  }

  const [{ data: conversations, error: conversationsError }, { data: members, error: membersError }] =
    await Promise.all([
      admin
        .from("chat_conversations")
        .select("id, kind, last_message_at, last_message_sender_id")
        .in("id", conversationIds),
      admin
        .from("chat_conversation_members")
        .select("conversation_id, user_id")
        .in("conversation_id", conversationIds),
    ]);

  if (conversationsError) {
    throw new Error(`Failed to load conversations: ${conversationsError.message}`);
  }

  if (membersError) {
    throw new Error(`Failed to load conversation members: ${membersError.message}`);
  }

  const otherUserIds = [...new Set(((members as any[]) ?? []).map((row) => row.user_id).filter((value) => value !== userId))];
  const profileMap = new Map<string, Awaited<ReturnType<typeof loadProfileSummaryOrFallback>>>();
  const appearanceMap = await loadProfileAppearanceMap(otherUserIds);
  const publicKeyMap = new Map<string, string | null>();

  await Promise.all(
    otherUserIds.map(async (otherUserId) => {
      const [profile, publicKey] = await Promise.all([
        loadProfileSummaryOrFallback(otherUserId),
        getChatPublicKeyForUser(otherUserId),
      ]);
      profileMap.set(otherUserId, profile);
      publicKeyMap.set(otherUserId, publicKey);
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
          publicKey: publicKeyMap.get(otherProfile.id) ?? null,
        },
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
