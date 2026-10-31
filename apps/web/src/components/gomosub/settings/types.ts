import { api } from "@/integrations/api/compat";
import { apiClient } from "@/integrations/api/client";

// ─── Shared types for the GomoSub settings surface ───────────────────────────

export type Role = {
  id: string;
  board_id: string;
  name: string;
  color: string;
  position: number;
  permissions: Record<string, boolean>;
  is_everyone?: boolean;
};

export type Member = {
  user_id: string;
  role_id: string | null;
  timed_out_until?: string | null;
  profiles?: { username?: string };
};

export type MemberRoleGrant = {
  board_id: string;
  user_id: string;
  role_id: string;
};

export type SettingsChannel = {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  sort_order: number;
  is_private: boolean;
  kind?: "forum" | "text";
  category_id: string | null;
};

export type SettingsCategory = {
  id: string;
  board_id: string;
  name: string;
  sort_order: number;
  is_private: boolean;
};

export type ChannelOverwrite = {
  id?: string;
  channel_id: string;
  role_id: string;
  allow: Record<string, boolean>;
  deny: Record<string, boolean>;
  can_read: boolean;
  can_write: boolean;
};

export type BanItem = {
  user_id: string;
  username: string;
  reason: string | null;
  created_by: string | null;
  expires_at: string | null;
  created_at: string;
};

// ─── Request helpers ─────────────────────────────────────────────────────────

// Raw fetches to the universal CRUD surface authenticate via HttpOnly cookies:
// every write echoes the CSRF cookie in X-CSRF-Token (double-submit).
export const csrfHeaders = (withJson = false): Record<string, string> => {
  const csrf = apiClient.getCSRFToken();
  const h: Record<string, string> = {};
  if (csrf) h["X-CSRF-Token"] = csrf;
  if (withJson) h["Content-Type"] = "application/json";
  return h;
};

// RPC calls authenticate with the Bearer session token.
export const rpcPost = async (path: string, body: unknown): Promise<{ ok: boolean; data: unknown; error?: string }> => {
  const { data: { session } } = await api.auth.getSession();
  const r = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => null);
  return { ok: r.ok && !!d?.success, data: d?.data, error: d?.error };
};

export const rpcGet = async (path: string): Promise<{ ok: boolean; data: unknown }> => {
  const { data: { session } } = await api.auth.getSession();
  const r = await fetch(path, {
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
  });
  const d = await r.json().catch(() => null);
  return { ok: r.ok && !!d?.success, data: d?.data };
};

export const parsePerms = (v: unknown): Record<string, boolean> => {
  if (!v) return {};
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return typeof p === "object" && p !== null ? (p as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  }
  return v as Record<string, boolean>;
};
