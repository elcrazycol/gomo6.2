"use client";

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

const getUrl = () => {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
  }
  return value;
};

const getKey = () => {
  const value = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!value) {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not configured");
  }
  return value;
};

export const getBrowserSupabase = () => {
  if (!browserClient) {
    browserClient = createClient(getUrl(), getKey(), {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: "gomo6-messenger-auth",
      },
    });
  }

  return browserClient;
};

export const applySessionFromUrlHash = async () => {
  if (typeof window === "undefined") return null;

  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  if (!hash) return null;

  const params = new URLSearchParams(hash);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const expiresAt = params.get("expires_at");
  const targetUserId = params.get("targetUserId");
  const conversationId = params.get("conversationId");

  if (!accessToken || !refreshToken) {
    return null;
  }

  const client = getBrowserSupabase();
  await client.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  const nextUrl = new URL(window.location.href);
  nextUrl.hash = "";
  if (targetUserId && !nextUrl.searchParams.get("user")) {
    nextUrl.searchParams.set("user", targetUserId);
  }
  if (conversationId && !nextUrl.searchParams.get("conversation")) {
    nextUrl.searchParams.set("conversation", conversationId);
  }
  if (expiresAt) {
    nextUrl.searchParams.set("handoff", "1");
  }
  window.history.replaceState({}, "", nextUrl.toString());

  return { targetUserId, conversationId };
};

export const getActiveSession = async (): Promise<Session | null> => {
  const client = getBrowserSupabase();
  const {
    data: { session },
  } = await client.auth.getSession();
  return session;
};
