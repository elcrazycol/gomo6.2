import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getDeviceBundlesForUser, loadProfileSummary, upsertChatDeviceBundle } from "@/lib/messenger";

const json = (payload: Record<string, unknown>, status = 200) => NextResponse.json(payload, { status });

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("authorization"));
    if (!user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await request.json().catch(() => null);
    const clientDeviceId = typeof body?.clientDeviceId === "string" ? body.clientDeviceId : null;
    const signalDeviceId = typeof body?.signalDeviceId === "number" ? body.signalDeviceId : null;
    const registrationId = typeof body?.registrationId === "number" ? body.registrationId : null;
    const identityPublicKey = typeof body?.identityPublicKey === "string" ? body.identityPublicKey : null;
    const signedPreKeyId = typeof body?.signedPreKeyId === "number" ? body.signedPreKeyId : null;
    const signedPreKeyPublic = typeof body?.signedPreKeyPublic === "string" ? body.signedPreKeyPublic : null;
    const signedPreKeySignature = typeof body?.signedPreKeySignature === "string" ? body.signedPreKeySignature : null;
    const kyberPreKeyId = typeof body?.kyberPreKeyId === "number" ? body.kyberPreKeyId : 1;
    const kyberPreKeyPublic =
      typeof body?.kyberPreKeyPublic === "string" && body.kyberPreKeyPublic.length > 0
        ? body.kyberPreKeyPublic
        : signedPreKeyPublic;
    const kyberPreKeySignature =
      typeof body?.kyberPreKeySignature === "string" && body.kyberPreKeySignature.length > 0
        ? body.kyberPreKeySignature
        : signedPreKeySignature;
    const oneTimePreKeys = Array.isArray(body?.oneTimePreKeys) ? body.oneTimePreKeys : [];
    const targetUserId = request.nextUrl.searchParams.get("targetUserId");

    if (
      !clientDeviceId ||
      !registrationId ||
      !identityPublicKey ||
      !signedPreKeyId ||
      !signedPreKeyPublic ||
      !signedPreKeySignature ||
      !kyberPreKeyId ||
      !kyberPreKeyPublic ||
      !kyberPreKeySignature
    ) {
      return json({ error: "Invalid device bootstrap payload" }, 400);
    }

    const device = await upsertChatDeviceBundle(user, {
      clientDeviceId,
      signalDeviceId,
      registrationId,
      deviceLabel: "browser",
      identityPublicKey,
      signedPreKeyId,
      signedPreKeyPublic,
      signedPreKeySignature,
      kyberPreKeyId,
      kyberPreKeyPublic,
      kyberPreKeySignature,
      oneTimePreKeys: oneTimePreKeys.filter(
        (entry: unknown): entry is { preKeyId: number; publicKey: string } =>
          typeof entry === "object" &&
          entry !== null &&
          "preKeyId" in entry &&
          "publicKey" in entry &&
          typeof (entry as { preKeyId?: unknown }).preKeyId === "number" &&
          typeof (entry as { publicKey?: unknown }).publicKey === "string"
      ),
    });

    const selfDevices = await getDeviceBundlesForUser(user.id);

    let target = null;
    if (targetUserId && targetUserId !== user.id) {
      try {
        const profile = await loadProfileSummary(targetUserId);
        const devices = await getDeviceBundlesForUser(targetUserId);

        target = {
          id: profile.id,
          username: profile.username,
          avatarUrl: profile.avatar_url,
          accountNumber: profile.account_number,
          isOnline: profile.is_online,
          lastSeenAt: profile.last_seen_at,
          usernameColor: profile.username_color,
          devices,
        };
      } catch {
        target = null;
      }
    }

    return json({
      me: {
        id: user.id,
        username: user.username,
        avatarUrl: user.avatarUrl,
        accountNumber: user.accountNumber,
        isOnline: user.isOnline,
        lastSeenAt: user.lastSeenAt,
        usernameColor: user.usernameColor,
        clientDeviceId,
        signalDeviceId: device.signalDeviceId,
      },
      selfDevices,
      target,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bootstrap failed";
    return json({ error: message }, 500);
  }
}
