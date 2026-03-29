import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, messengerAdmin } from "@/lib/auth";
import { getDeviceBundlesForUser, listConversationsForUser } from "@/lib/messenger";

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

  const admin = messengerAdmin();
  const { data, error } = await admin.rpc("get_or_create_direct_chat", {
    target_user_id: recipientUserId,
  });

  if (error || !data) {
    return json({ error: error?.message ?? "Failed to create conversation" }, 500);
  }

  const devices = await getDeviceBundlesForUser(recipientUserId);
  return json({
    conversation: {
      id: data,
      recipientUserId,
      recipientDevices: devices,
    },
  });
}
