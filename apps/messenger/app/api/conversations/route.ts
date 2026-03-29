import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createOrLoadDirectConversation, getDeviceBundlesForUser, listConversationsForUser } from "@/lib/messenger";

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
    return json({
      conversation: {
        id: conversationId,
        recipientUserId,
        recipientDevices: devices,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create conversation";
    return json({ error: message }, 500);
  }
}
