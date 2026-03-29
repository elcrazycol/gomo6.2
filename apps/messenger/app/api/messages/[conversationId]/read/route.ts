import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, messengerAdmin } from "@/lib/auth";

const json = (payload: Record<string, unknown>, status = 200) => NextResponse.json(payload, { status });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const user = await getAuthenticatedUser(request.headers.get("authorization"));
  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const { conversationId } = await params;
  const body = await request.json().catch(() => null);
  const lastReadMessageId = typeof body?.lastReadMessageId === "string" ? body.lastReadMessageId : null;

  const admin = messengerAdmin();
  const { error } = await admin.rpc("chat_mark_read", {
    target_conversation_id: conversationId,
    target_message_id: lastReadMessageId,
  });

  if (error) {
    return json({ error: error.message }, 500);
  }

  return json({ ok: true });
}
