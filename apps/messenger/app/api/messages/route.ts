import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/session";
import { messengerAdmin } from "@/lib/supabase";

const json = (payload: Record<string, unknown>, status = 200) => NextResponse.json(payload, { status });

export async function POST(request: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await request.json();
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : null;
  const ciphertext = typeof body.ciphertext === "string" ? body.ciphertext : null;
  const nonce = typeof body.nonce === "string" ? body.nonce : null;

  if (!conversationId || !ciphertext || !nonce) {
    return json({ error: "Invalid message payload" }, 400);
  }

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

  const { data, error } = await admin
    .from("messenger_messages")
    .insert({
      conversation_id: conversationId,
      sender_user_id: self.id,
      ciphertext,
      nonce,
    })
    .select("id")
    .single();

  if (error || !data) {
    return json({ error: "Failed to store message" }, 500);
  }

  await admin
    .from("conversation_memberships")
    .update({
      last_read_at: new Date().toISOString(),
    })
    .eq("conversation_id", conversationId)
    .eq("user_id", self.id);

  return json({ id: data.id });
}
