import { NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/session";
import { messengerAdmin } from "@/lib/supabase";

const json = (payload: Record<string, unknown>, status = 200) => NextResponse.json(payload, { status });

export async function POST(
  _request: Request,
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

  await admin
    .from("conversation_memberships")
    .update({
      last_read_at: new Date().toISOString(),
    })
    .eq("conversation_id", conversationId)
    .eq("user_id", self.id);

  return json({ ok: true });
}
