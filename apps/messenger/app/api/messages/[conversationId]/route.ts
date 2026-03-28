import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/session";
import { messengerAdmin } from "@/lib/supabase";

const json = (payload: Record<string, unknown>, status = 200) => NextResponse.json(payload, { status });

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const session = await getSessionFromCookies();
  if (!session) {
    return json({ error: "Unauthorized" }, 401);
  }

  const { conversationId } = await params;
  const admin = messengerAdmin();
  const { data: self } = await admin
    .from("messenger_users")
    .select("id")
    .eq("main_user_id", session.sub)
    .single();

  if (!self) {
    return json({ error: "Messenger user not found" }, 404);
  }

  const { data: membership } = await admin
    .from("conversation_memberships")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", self.id)
    .maybeSingle();

  if (!membership) {
    return json({ error: "Conversation access denied" }, 403);
  }

  const { data: messages } = await admin
    .from("messenger_messages")
    .select("id, ciphertext, nonce, created_at, sender_user_id, messenger_users!messenger_messages_sender_user_id_fkey(main_user_id)")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  return json({
    messages: (messages ?? []).map((message: any) => ({
      id: message.id,
      ciphertext: message.ciphertext,
      nonce: message.nonce,
      createdAt: message.created_at,
      senderMainUserId: message.messenger_users?.main_user_id ?? "",
    })),
  });
}
