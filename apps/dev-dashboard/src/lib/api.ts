// Simple API client for dev-dashboard
// Uses OAuth access token from gomo6 login

import { getAccessToken, refreshAccessToken, logout } from "@/lib/oauth";

const API_BASE = ""; // proxied by Vite

export const api = {
  getToken: (): string | null => {
    return getAccessToken();
  },

  setToken: (_token: string) => {
    // Deprecated — tokens managed by OAuth module
  },

  clearToken: () => {
    logout();
  },

  // Session check — returns old format for backward compatibility
  getSession: async (): Promise<{ session: { access_token: string } | null }> => {
    const token = getAccessToken();
    if (!token) return { session: null };
    return { session: { access_token: token } };
  },

  // Get current user info
  getCurrentUser: async () => {
    const token = getAccessToken();
    if (!token) return null;
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  },

  // Authenticated fetch — auto-refreshes token if needed
  fetch: async (url: string, options: RequestInit = {}): Promise<Response> => {
    let token = getAccessToken();

    // Try to refresh if no token
    if (!token) {
      token = await refreshAccessToken();
    }

    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> || {}),
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    if (options.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, { ...options, headers });

    // If 401, try refreshing token once
    if (response.status === 401 && token) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        headers["Authorization"] = `Bearer ${newToken}`;
        return fetch(url, { ...options, headers });
      }
    }

    return response;
  },
};
