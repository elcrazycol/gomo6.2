import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

type HandoffPayload = {
  sub: string;
  username: string;
  accountNumber: number | null;
  avatarUrl: string | null;
  targetUserId: string | null;
  exp: number;
};

const json = (res: any, status: number, payload: Record<string, unknown>) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
};

const encode = (value: string) => Buffer.from(value).toString("base64url");

const signPayload = (payload: HandoffPayload) => {
  const secret = process.env.MESSENGER_SHARED_SESSION_SECRET;
  if (!secret) {
    throw new Error("MESSENGER_SHARED_SESSION_SECRET is not configured");
  }

  const body = encode(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
};

const verifyOrigin = (value: string | undefined) => {
  if (!value) return false;
  const allowed = [
    process.env.APP_BASE_URL,
    "https://gomo6.ru",
    "https://www.gomo6.ru",
    "https://gomo6.wtf",
    "https://www.gomo6.wtf",
  ].filter(Boolean);
  return allowed.some((origin) => origin === value);
};

const sanitizeCookieDomain = () => {
  const raw = process.env.SHARED_COOKIE_DOMAIN || ".gomo6.ru";
  return raw.startsWith(".") ? raw : `.${raw}`;
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed" });
  }

  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const refererOrigin = referer ? new URL(referer).origin : undefined;

  if (!verifyOrigin(origin) && !verifyOrigin(refererOrigin)) {
    return json(res, 403, { error: "Untrusted origin" });
  }

  const bearer = req.headers.authorization;
  if (!bearer?.startsWith("Bearer ")) {
    return json(res, 401, { error: "Missing access token" });
  }

  const accessToken = bearer.slice("Bearer ".length);

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return json(res, 500, { error: "Main Supabase admin env is not configured" });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data: authData, error: authError } = await admin.auth.getUser(accessToken);

  if (authError || !authData.user) {
    return json(res, 401, { error: "Invalid session" });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("username, account_number, avatar_url")
    .eq("id", authData.user.id)
    .single();

  const targetUserId = typeof req.body?.targetUserId === "string" ? req.body.targetUserId : null;

  const token = signPayload({
    sub: authData.user.id,
    username: profile?.username || authData.user.user_metadata?.username || "unknown",
    accountNumber: profile?.account_number ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    targetUserId,
    exp: Math.floor(Date.now() / 1000) + 60 * 10,
  });

  const cookieDomain = sanitizeCookieDomain();
  const cookie = [
    `gomo6_messenger_session=${token}`,
    "Path=/",
    `Domain=${cookieDomain}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${60 * 60 * 24 * 7}`,
  ].join("; ");

  res.setHeader("Set-Cookie", cookie);

  const baseUrl = process.env.MESSENGER_BASE_URL || "https://m.gomo6.ru";
  const redirectUrl = new URL(baseUrl);
  if (targetUserId) {
    redirectUrl.searchParams.set("user", targetUserId);
  }

  return json(res, 200, {
    redirectTo: redirectUrl.toString(),
  });
}
