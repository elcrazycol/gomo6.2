import { createClient } from "@supabase/supabase-js";

export type AuthenticatedUser = {
  id: string;
  username: string;
  avatarUrl: string | null;
  accountNumber: number | null;
  isOnline: boolean | null;
  lastSeenAt: string | null;
  usernameColor: string | null;
  usernameCss: string | null;
  usernameIconSvg: string | null;
  usernameIconFill: string | null;
  usernameIconStroke: string | null;
  profileBadgeText: string | null;
  profileBadgeCss: string | null;
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
    .select("username, avatar_url, account_number, is_online, last_seen_at")
    .eq("id", authData.user.id)
    .maybeSingle();

  const { data: customization } = await admin
    .from("profile_customization")
    .select("username_css, username_icon_svg, username_icon_fill, username_icon_stroke, profile_badge_text, profile_badge_css")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  const { data: achievements } = await admin
    .from("user_achievements")
    .select(`
      achievement_id,
      achievements (
        reward_type,
        reward_value
      )
    `)
    .eq("user_id", authData.user.id);

  const colorRewards = ((achievements as any[]) ?? [])
    .filter((entry) => entry.achievements?.reward_type === "username_color")
    .map((entry) => entry.achievements?.reward_value)
    .filter((value): value is string => typeof value === "string");

  const colorPriority = ["purple", "gold", "orange", "red", "blue", "green", "yellow", "cyan"];
  const usernameColor = colorPriority.find((value) => colorRewards.includes(value)) ?? null;

  return {
    id: authData.user.id,
    username: profile?.username || authData.user.user_metadata?.username || "gomo6 user",
    avatarUrl: profile?.avatar_url ?? null,
    accountNumber: profile?.account_number ?? null,
    isOnline: profile?.is_online ?? null,
    lastSeenAt: profile?.last_seen_at ?? null,
    usernameColor,
    usernameCss: customization?.username_css ?? null,
    usernameIconSvg: customization?.username_icon_svg ?? null,
    usernameIconFill: customization?.username_icon_fill ?? null,
    usernameIconStroke: customization?.username_icon_stroke ?? null,
    profileBadgeText: customization?.profile_badge_text ?? null,
    profileBadgeCss: customization?.profile_badge_css ?? null,
  } satisfies AuthenticatedUser;
};
