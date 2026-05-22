// OAuth client for dev-dashboard — uses gomo6's own OAuth for login
// PKCE S256 flow, public client (no client_secret)

interface OAuthConfig {
  clientId: string;
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  revocationUrl: string;
  redirectUri: string;
  scopes: string[];
}

let cachedConfig: OAuthConfig | null = null;

export async function fetchOAuthConfig(): Promise<OAuthConfig> {
  if (cachedConfig) return cachedConfig;
  const res = await fetch("/api/v1/dev-dashboard/config");
  if (!res.ok) throw new Error("Failed to fetch OAuth config");
  const data = await res.json();
  cachedConfig = {
    clientId: data.client_id,
    authorizationUrl: data.authorization_url,
    tokenUrl: data.token_url,
    userinfoUrl: data.userinfo_url,
    revocationUrl: data.revocation_url,
    redirectUri: data.redirect_uri,
    scopes: data.scopes,
  };
  return cachedConfig;
}

// PKCE helpers using Web Crypto API
async function generateCodeVerifier(): Promise<string> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64URLEncode(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64URLEncode(new Uint8Array(digest));
}

function base64URLEncode(buffer: Uint8Array): string {
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Token storage
const TOKEN_KEY = "dev_oauth_access_token";
const REFRESH_KEY = "dev_oauth_refresh_token";
const USER_KEY = "dev_oauth_user";

export interface OAuthUser {
  sub: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  picture?: string;
}

export function saveTokens(accessToken: string, refreshToken?: string) {
  localStorage.setItem(TOKEN_KEY, accessToken);
  if (refreshToken) {
    localStorage.setItem(REFRESH_KEY, refreshToken);
  }
}

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

export function saveUser(user: OAuthUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getSavedUser(): OAuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Initiate login — generates PKCE and redirects to authorize endpoint
export async function loginWithGomo6() {
  const config = await fetchOAuthConfig();
  const verifier = await generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = crypto.randomUUID();

  // Save PKCE verifier + state for the callback
  sessionStorage.setItem("oauth_verifier", verifier);
  sessionStorage.setItem("oauth_state", state);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: state,
    scope: config.scopes.join(" "),
  });

  window.location.href = `${config.authorizationUrl}?${params.toString()}`;
}

// Handle the callback — exchange code for tokens
export async function handleCallback(url: string): Promise<{ user: OAuthUser; accessToken: string }> {
  const config = await fetchOAuthConfig();
  const parsed = new URL(url);
  const code = parsed.searchParams.get("code");
  const state = parsed.searchParams.get("state");
  const error = parsed.searchParams.get("error");

  if (error) {
    throw new Error(`Authorization failed: ${error}`);
  }

  if (!code) {
    throw new Error("No authorization code in callback URL");
  }

  // Validate state
  const savedState = sessionStorage.getItem("oauth_state");
  if (state && savedState && state !== savedState) {
    throw new Error("State mismatch — possible CSRF attack");
  }

  // Get verifier
  const verifier = sessionStorage.getItem("oauth_verifier");
  if (!verifier) {
    throw new Error("No PKCE verifier found — login session expired");
  }

  // Clean up session storage
  sessionStorage.removeItem("oauth_verifier");
  sessionStorage.removeItem("oauth_state");

  // Exchange code for tokens
  const tokenRes = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      code_verifier: verifier,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({ error: "Token exchange failed" }));
    throw new Error(err.error_description || err.error || "Token exchange failed");
  }

  const tokens = await tokenRes.json();
  saveTokens(tokens.access_token, tokens.refresh_token);

  // Fetch user info
  const userRes = await fetch(config.userinfoUrl, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  let user: OAuthUser = { sub: "" };
  if (userRes.ok) {
    user = await userRes.json();
    saveUser(user);
  }

  return { user, accessToken: tokens.access_token };
}

// Refresh the access token
export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  const config = await fetchOAuthConfig();

  try {
    const res = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: config.clientId,
      }),
    });

    if (!res.ok) {
      clearTokens();
      return null;
    }

    const data = await res.json();
    saveTokens(data.access_token, data.refresh_token);
    return data.access_token;
  } catch {
    clearTokens();
    return null;
  }
}

// Logout — revoke tokens and clear storage
export async function logout() {
  const config = await fetchOAuthConfig().catch(() => null);
  const accessToken = getAccessToken();

  if (config && accessToken) {
    try {
      await fetch(config.revocationUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: accessToken,
          token_type_hint: "access_token",
          client_id: config.clientId,
        }),
      });
    } catch {
      // revoke best-effort
    }
  }

  clearTokens();
}

// Check if user is authenticated
export async function checkAuth(): Promise<boolean> {
  const token = getAccessToken();
  if (!token) return false;

  // Token exists — we can try to refresh if needed
  // For simplicity, just check if we have a stored user
  return !!getSavedUser();
}
