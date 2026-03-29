import { createClient } from "@supabase/supabase-js";

const json = (res: any, status: number, payload: Record<string, unknown>) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
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

  const targetUserId = typeof req.body?.targetUserId === "string" ? req.body.targetUserId : null;
  const refreshToken = typeof req.body?.refreshToken === "string" ? req.body.refreshToken : null;
  const expiresAt = typeof req.body?.expiresAt === "number" ? req.body.expiresAt : null;

  const baseUrl = process.env.MESSENGER_BASE_URL || inferMessengerBaseUrl(origin, refererOrigin);
  const redirectUrl = new URL(baseUrl);
  const fragment = new URLSearchParams();
  fragment.set("access_token", accessToken);
  if (refreshToken) {
    fragment.set("refresh_token", refreshToken);
  }
  if (expiresAt) {
    fragment.set("expires_at", String(expiresAt));
  }
  if (targetUserId) {
    fragment.set("targetUserId", targetUserId);
  }
  redirectUrl.hash = fragment.toString();

  return json(res, 200, {
    redirectTo: redirectUrl.toString(),
  });
}
