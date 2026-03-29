import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/session";
import { getMessengerUserByMainId, getOrCreateMessengerUser, touchMessengerDevice } from "@/lib/server";
import { messengerAdmin } from "@/lib/supabase";

const json = (payload: Record<string, unknown>, status = 200) => NextResponse.json(payload, { status });

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromCookies();
    if (!session) {
      return json({ error: "Сессия messenger не найдена" }, 401);
    }

    const body = await request.json().catch(() => null);
    const publicKey = typeof body?.publicKey === "string" ? body.publicKey : null;
    const deviceId = typeof body?.deviceId === "string" ? body.deviceId : null;
    const deviceLabel = typeof body?.deviceLabel === "string" ? body.deviceLabel : "browser";

    if (!publicKey || publicKey.length < 20 || !deviceId || deviceId.length < 8) {
      return json({ error: "Невалидные данные устройства" }, 400);
    }

    const me = await getOrCreateMessengerUser({
      mainUserId: session.sub,
      username: session.username,
      accountNumber: session.accountNumber,
      avatarUrl: session.avatarUrl,
    });

    await touchMessengerDevice({
      userId: me.id,
      deviceId,
      label: deviceLabel,
      publicKey,
    });

    const targetMainUserId = request.nextUrl.searchParams.get("targetUserId");
    let target = null;

    if (targetMainUserId) {
      const existingTarget = await getMessengerUserByMainId(targetMainUserId);

      if (existingTarget) {
        const admin = messengerAdmin();
        const { data: devices } = await admin
          .from("messenger_devices")
          .select("device_id, label, public_key")
          .eq("user_id", existingTarget.id)
          .order("last_seen_at", { ascending: false });

        target = {
          id: existingTarget.id,
          mainUserId: existingTarget.main_user_id,
          username: existingTarget.username,
          avatarUrl: existingTarget.avatar_url,
          devices:
            ((devices as Array<{ device_id: string; label: string; public_key: string }> | null) ?? []).map(
              (device) => ({
                deviceId: device.device_id,
                label: device.label,
                publicKey: device.public_key,
              })
            ),
        };
      } else {
        target = {
          id: "",
          mainUserId: targetMainUserId,
          username: "Пользователь gomo6",
          avatarUrl: null,
          devices: [],
        };
      }
    }

    return json({
      me: {
        id: me.id,
        mainUserId: me.main_user_id,
        username: me.username,
        avatarUrl: me.avatar_url,
        deviceId,
        publicKey,
      },
      target,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось инициализировать messenger";
    return json({ error: message }, 500);
  }
}
