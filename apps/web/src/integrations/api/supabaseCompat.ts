// Re-export module — combines auth.ts and dataApi.ts
// Keeps the familiar `supabase.auth.getSession()` / `supabase.from()` API
// while cleanly separating auth logic from data access.
import { supabaseAuth } from './auth';
import { from, rpc, storage, channel, removeChannel } from './dataApi';

export const supabase = {
  auth: supabaseAuth,
  from,
  rpc,
  storage,
  channel,
  removeChannel,
};
