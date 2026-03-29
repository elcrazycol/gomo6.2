import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient<any> | null = null;

export const messengerAdmin = () => {
  const url =
    process.env.MESSENGER_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_MESSENGER_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL;
  const key =
    process.env.MESSENGER_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Messenger Supabase admin environment is not configured");
  }

  if (!adminClient) {
    adminClient = createClient<any>(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return adminClient;
};
