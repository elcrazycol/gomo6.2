import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/session";
import { messengerAdmin } from "@/lib/supabase";

const json = (payload: Record<string, unknown>, status = 200) => NextResponse.json(payload, { status });

export async function POST(request: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) {
    return json({ error: "Unauthorized" }, 401);
  }

  const { publicKey } = await request.json();
  if (typeof publicKey !== "string" || publicKey.length < 20) {
    return json({ error: "Invalid public key" }, 400);
  }

  const targetUserId = request.nextUrl.searchParams.get("targetUserId");
  const admin = messengerAdmin();

  const { data: existingUser } = await admin
    .from("messenger_users")
    .upsert(
      {
        main_user_id: session.sub,
        username: session.username,
        account_number: session.accountNumber,
      },
      {
        onConflict: "main_user_id",
      }
    )
    .select("id, main_user_id, username")
    .single();

  if (!existingUser) {
    return json({ error: "Failed to create messenger user" }, 500);
  }

  await admin.from("messenger_user_keys").upsert(
    {
      user_id: existingUser.id,
      public_key: publicKey,
    },
    {
      onConflict: "user_id",
    }
  );

  let target = null;
  if (targetUserId) {
    const { data: targetUser } = await admin
      .from("messenger_users")
      .select("id, main_user_id, username, messenger_user_keys(public_key)")
      .eq("main_user_id", targetUserId)
      .maybeSingle();

    if (targetUser) {
      target = {
        id: targetUser.id,
        mainUserId: targetUser.main_user_id,
        username: targetUser.username,
        publicKey: (targetUser as any).messenger_user_keys?.public_key ?? null,
      };
    } else {
      target = {
        id: "",
        mainUserId: targetUserId,
        username: "Пользователь gomo6",
        publicKey: null,
      };
    }
  }

  return json({
    me: {
      id: existingUser.id,
      mainUserId: existingUser.main_user_id,
      username: existingUser.username,
      publicKey,
    },
    target,
  });
}
