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

const normalizeOrigin = (value: string) => {
  const parsed = new URL(value);
  const hostname = parsed.hostname.replace(/^www\./, "");
  return `${parsed.protocol}//${hostname}`;
};

const expandAllowedOrigins = () => {
  const raw = [process.env.APP_BASE_URL, process.env.MESSENGER_BASE_URL].filter(
    (value): value is string => Boolean(value)
  );

  const expanded = new Set<string>();
  raw.forEach((value) => {
    const parsed = new URL(value);
    const bareHostname = parsed.hostname.replace(/^www\./, "");
    expanded.add(`${parsed.protocol}//${bareHostname}`);
    expanded.add(`${parsed.protocol}//www.${bareHostname}`);
    if (!bareHostname.startsWith("m.")) {
      expanded.add(`${parsed.protocol}//m.${bareHostname}`);
    }
  });

  return expanded;
};

const verifyOrigin = (value: string | undefined) => {
  if (!value) return false;

  try {
    const normalized = normalizeOrigin(value);
    return expandAllowedOrigins().has(normalized);
  } catch {
    return false;
  }
};

const inferCookieDomain = (origin: string | undefined, refererOrigin: string | undefined) => {
  const source = origin || refererOrigin || process.env.APP_BASE_URL || "https://gomo6.wtf";
  const hostname = new URL(source).hostname.replace(/^www\./, "");
  if (hostname.startsWith("m.")) {
    return `.${hostname.slice(2)}`;
  }
  return `.${hostname}`;
};

const sanitizeCookieDomain = (origin: string | undefined, refererOrigin: string | undefined) => {
  const raw = process.env.SHARED_COOKIE_DOMAIN || inferCookieDomain(origin, refererOrigin);
  return raw.startsWith(".") ? raw : `.${raw}`;
};

const inferMessengerBaseUrl = (origin: string | undefined, refererOrigin: string | undefined) => {
  const source = origin || refererOrigin || process.env.APP_BASE_URL || "https://gomo6.wtf";
  const parsed = new URL(source);
  const hostname = parsed.hostname.replace(/^www\./, "");
  if (hostname.startsWith("m.")) {
    return `${parsed.protocol}//${hostname}`;
  }
  return `${parsed.protocol}//m.${hostname}`;
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

  const cookieDomain = sanitizeCookieDomain(origin, refererOrigin);
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

  const baseUrl = process.env.MESSENGER_BASE_URL || inferMessengerBaseUrl(origin, refererOrigin);
  const redirectUrl = new URL(baseUrl);
  if (targetUserId) {
    redirectUrl.searchParams.set("user", targetUserId);
  }

  return json(res, 200, {
    redirectTo: redirectUrl.toString(),
  });
}
