import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import {
  getChatPublicKeyForUser,
  loadProfileAppearance,
  loadProfileSummaryOrFallback,
  upsertChatUserKey,
} from "@/lib/messenger";

const json = (payload: Record<string, unknown>, status = 200) => NextResponse.json(payload, { status });

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("authorization"));
    if (!user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await request.json().catch(() => null);
    const publicKey = typeof body?.publicKey === "string" ? body.publicKey : null;
    const targetUserId = request.nextUrl.searchParams.get("targetUserId");

    if (!publicKey) {
      return json({ error: "Invalid sodium bootstrap payload" }, 400);
    }

    await upsertChatUserKey(user.id, publicKey);

    let target = null;
    if (targetUserId && targetUserId !== user.id) {
      const [profile, appearance, targetPublicKey] = await Promise.all([
        loadProfileSummaryOrFallback(targetUserId),
        loadProfileAppearance(targetUserId),
        getChatPublicKeyForUser(targetUserId),
      ]);

      target = {
        id: profile.id,
        username: profile.username,
        avatarUrl: profile.avatar_url,
        accountNumber: profile.account_number,
        isOnline: profile.is_online,
        lastSeenAt: profile.last_seen_at,
        usernameColor: appearance.usernameColor,
        usernameCss: appearance.usernameCss,
        usernameIconSvg: appearance.usernameIconSvg,
        usernameIconFill: appearance.usernameIconFill,
        usernameIconStroke: appearance.usernameIconStroke,
        profileBadgeText: appearance.profileBadgeText,
        profileBadgeCss: appearance.profileBadgeCss,
        publicKey: targetPublicKey,
      };
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
        usernameCss: user.usernameCss,
        usernameIconSvg: user.usernameIconSvg,
        usernameIconFill: user.usernameIconFill,
        usernameIconStroke: user.usernameIconStroke,
        profileBadgeText: user.profileBadgeText,
        profileBadgeCss: user.profileBadgeCss,
        publicKey,
      },
      target,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bootstrap failed";
    return json({ error: message }, 500);
  }
}
