import { createClient } from "@supabase/supabase-js";

export const messengerAdmin = () => {
  const url = process.env.MESSENGER_SUPABASE_URL;
  const key = process.env.MESSENGER_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Messenger Supabase admin environment is not configured");
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};
