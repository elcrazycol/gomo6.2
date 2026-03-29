import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export type MessengerSession = {
  sub: string;
  username: string;
  accountNumber: number | null;
  avatarUrl: string | null;
  targetUserId: string | null;
  exp: number;
};

const parseToken = (token: string): MessengerSession | null => {
  const secret = process.env.MESSENGER_SHARED_SESSION_SECRET;
  if (!secret) {
    throw new Error("MESSENGER_SHARED_SESSION_SECRET is not configured");
  }

  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = createHmac("sha256", secret).update(body).digest();
  const received = Buffer.from(signature, "base64url");

  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null;
  }

  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as MessengerSession;
  if (payload.exp * 1000 < Date.now()) {
    return null;
  }

  return payload;
};

export const getSessionFromCookies = async () => {
  const store = await cookies();
  const raw = store.get("gomo6_messenger_session")?.value;
  return raw ? parseToken(raw) : null;
};
