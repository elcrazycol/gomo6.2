import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { markConversationRead } from "@/lib/messenger";

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

  try {
    await markConversationRead(user.id, conversationId, lastReadMessageId);
    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to mark conversation read";
    return json({ error: message }, 500);
  }
}
