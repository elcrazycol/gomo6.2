// Simple API client for dev-dashboard
// Reads auth token from localStorage, provides login/session helpers

const API_BASE = ""; // proxied by Vite

interface AuthResponse {
  token: string;
  user: {
    id: string;
    username: string;
    email: string;
    avatar_url?: string;
  };
}

export const api = {
  getToken: (): string | null => {
    return localStorage.getItem("auth_token");
  },

  setToken: (token: string) => {
    localStorage.setItem("auth_token", token);
  },

  clearToken: () => {
    localStorage.removeItem("auth_token");
  },

  login: async (email: string, password: string): Promise<AuthResponse> => {
    const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Login failed" }));
      throw new Error(err.error || "Login failed");
    }
    return res.json();
  },

  logout: async () => {
    const token = api.getToken();
    if (token) {
      await fetch(`${API_BASE}/api/v1/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    api.clearToken();
  },

  getSession: async (): Promise<{ session: { access_token: string } | null }> => {
    const token = api.getToken();
    if (!token) return { session: null };
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        api.clearToken();
        return { session: null };
      }
      return { session: { access_token: token } };
    } catch {
      return { session: null };
    }
  },

  getCurrentUser: async () => {
    const token = api.getToken();
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

  fetch: async (url: string, options: RequestInit = {}): Promise<Response> => {
    const token = api.getToken();
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> || {}),
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (options.body && typeof options.body === "string" && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    return fetch(url, { ...options, headers });
  },
};
