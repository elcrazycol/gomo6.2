import { createClient } from "@supabase/supabase-js";

export type AuthenticatedUser = {
  id: string;
  username: string;
  avatarUrl: string | null;
  accountNumber: number | null;
  isOnline: boolean | null;
  lastSeenAt: string | null;
  usernameColor: string | null;
};

const getSupabaseUrl = () => {
  const value = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) {
    throw new Error("Supabase URL is not configured");
  }
  return value;
};

const getServiceRoleKey = () => {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  return value;
};

export const messengerAdmin = () =>
  createClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

export const getAuthenticatedUser = async (authorizationHeader: string | null) => {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return null;
  }

  const accessToken = authorizationHeader.slice("Bearer ".length);
  const admin = messengerAdmin();
  const { data: authData, error: authError } = await admin.auth.getUser(accessToken);

  if (authError || !authData.user) {
    return null;
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("username, avatar_url, account_number, is_online, last_seen_at, username_color")
    .eq("id", authData.user.id)
    .maybeSingle();

  return {
    id: authData.user.id,
    username: profile?.username || authData.user.user_metadata?.username || "gomo6 user",
    avatarUrl: profile?.avatar_url ?? null,
    accountNumber: profile?.account_number ?? null,
    isOnline: profile?.is_online ?? null,
    lastSeenAt: profile?.last_seen_at ?? null,
    usernameColor: profile?.username_color ?? null,
  } satisfies AuthenticatedUser;
};
