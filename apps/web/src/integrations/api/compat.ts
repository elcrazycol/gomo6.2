// API compatibility module — combines auth.ts, query-builder.ts, rpc.ts, and storage.ts
// Keeps the familiar `api.auth.getSession()` / `api.from()` API
// while cleanly separating auth logic from data access.
import { apiAuth } from './auth';
import { from, channel, removeChannel } from './query-builder';
import { rpc } from './rpc';
import { storage } from './storage';

export const api = {
  auth: apiAuth,
  from,
  rpc,
  storage,
  channel,
  removeChannel,
};
