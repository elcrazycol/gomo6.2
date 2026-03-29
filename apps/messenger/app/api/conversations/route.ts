import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import {
  buildConversationSummary,
  createOrLoadDirectConversation,
  getDeviceBundlesForUser,
  listConversationsForUser,
  loadProfileSummaryOrFallback,
} from "@/lib/messenger";

const json = (payload: Record<string, unknown>, status = 200) => NextResponse.json(payload, { status });

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request.headers.get("authorization"));
  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const conversations = await listConversationsForUser(user.id);
  return json({ conversations });
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request.headers.get("authorization"));
  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await request.json().catch(() => null);
  const recipientUserId = typeof body?.recipientUserId === "string" ? body.recipientUserId : null;

  if (!recipientUserId || recipientUserId === user.id) {
    return json({ error: "Invalid recipient user" }, 400);
  }

  try {
    const conversationId = await createOrLoadDirectConversation(user.id, recipientUserId);
    const devices = await getDeviceBundlesForUser(recipientUserId);
    const conversation =
      (await buildConversationSummary(user.id, conversationId)) ??
      (() => {
        throw new Error("Conversation was created but could not be loaded");
      })();
    const targetProfile = await loadProfileSummaryOrFallback(recipientUserId);
    return json({
      conversation: {
        ...conversation,
        recipientUserId,
        recipientProfile: {
          id: targetProfile.id,
          username: targetProfile.username,
          avatarUrl: targetProfile.avatar_url,
          accountNumber: targetProfile.account_number,
          isOnline: targetProfile.is_online,
          lastSeenAt: targetProfile.last_seen_at,
          usernameColor: targetProfile.username_color,
        },
        recipientDevices: devices,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create conversation";
    return json({ error: message }, 500);
  }
}
