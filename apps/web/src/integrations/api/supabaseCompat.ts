// Re-export module — combines auth.ts, query-builder.ts, rpc.ts, and storage.ts
// Keeps the familiar `supabase.auth.getSession()` / `supabase.from()` API
// while cleanly separating auth logic from data access.
import { supabaseAuth } from './auth';
import { from, channel, removeChannel } from './query-builder';
import { rpc } from './rpc';
import { storage } from './storage';

export const supabase = {
  auth: supabaseAuth,
  from,
  rpc,
  storage,
  channel,
  removeChannel,
};
