// Go Backend API Client
// API Configuration
// In Docker production, API goes through Caddy reverse proxy at same origin.
// In dev mode (npm run dev), Vite proxy forwards /api to localhost:8080.
// Set VITE_API_BASE_URL to override (e.g., for direct backend access during dev).
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// Types — re-exported from auto-generated OpenAPI spec (api.d.ts)
import type { components } from '@/api';

export type User = components['schemas']['User'];
export type Board = components['schemas']['Board'];
export type Thread = components['schemas']['Thread'];
export type ThreadWithBoards = components['schemas']['ThreadWithBoards'];
export type Post = components['schemas']['Post'];
export type PostLike = components['schemas']['PostLike'];
export type ThreadLike = components['schemas']['ThreadLike'];
export type Notification = components['schemas']['Notification'];
export type AuthResponse = components['schemas']['AuthResponse'];
export type TOTPSetupResponse = components['schemas']['TOTPSetupResponse'];
export type TwoFAStatus = components['schemas']['TwoFAStatus'];
export type ConversationResponse = components['schemas']['ConversationResponse'];
export type MessageResponse = components['schemas']['MessageResponse'];
export type SendMessageRequest = components['schemas']['SendMessageRequest'];
export type RegisterRequest = components['schemas']['RegisterRequest'];
export type LoginRequest = components['schemas']['LoginRequest'];
export type CreateThreadRequest = components['schemas']['CreateThreadRequest'];
export type CreatePostRequest = components['schemas']['CreatePostRequest'];

export interface SessionInfo {
  id: string;
  user_agent: string;
  os_name: string;
  browser_name: string;
  device_type: string;
  ip_address: string;
  country_code: string;
  country_name: string;
  created_at: string;
  last_active_at: string;
  is_current: boolean;
  online: boolean;
}

// APIResponse wrapper (not from OpenAPI — hand-written generic for {success, data, error} format)
export interface ApiResponse<T> {
  success: boolean;
  data: T | T[] | null;
  count?: number;
  error?: string | null;
  code?: string | null;
  params?: unknown;
  has_more?: boolean;
}

// An Error thrown by ApiClient, augmented with the structured error code/params
// the backend emits for client-rendered messages.
export interface ApiClientError extends Error {
  status?: number;
  code?: string;
  params?: unknown;
}

// Decode JWT payload without verification (for expiry check only)
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // Decode base64url
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// HTTP Client with auth
class ApiClient {
  private token: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiresAt: number | null = null;
  private refreshPromise: Promise<string | null> | null = null;
  private lastRefreshAt = 0;
  private lastRefreshAuthFailed = false;

  constructor() {
    // Browser auth is restored from HttpOnly cookies by the backend. Access and
    // refresh tokens are kept only in memory when an API client explicitly needs
    // the legacy Bearer compatibility path.
    // One-time migration cleanup: older builds persisted the token pair to Web
    // Storage. Drop any leftovers on load so secrets never linger in localStorage
    // for an XSS to steal, even if the page never logs out.
    removeLegacyStoredTokens();
  }

  setToken(token: string) {
    this.setTokens(token, this.refreshToken);
  }

  setTokens(accessToken: string, refreshToken: string | null) {
    this.token = accessToken;
    this.refreshToken = refreshToken || null;
    // Never persist access or refresh tokens in Web Storage. The backend also
    // sets HttpOnly cookies for browser sessions.
    const payload = decodeJwtPayload(accessToken);
    this.tokenExpiresAt = (payload?.exp && typeof payload.exp === 'number') ? payload.exp * 1000 : null;
  }

  clearToken() {
    this.clearTokens();
  }

  clearTokens() {
    this.token = null;
    this.refreshToken = null;
    this.tokenExpiresAt = null;
    this.cachedUser = null;
    this.currentUserPromise = null;
    this.currentUserCacheTime = 0;
    removeLegacyStoredTokens();
  }

  getToken(): string | null {
    return this.token;
  }

  getRefreshToken(): string | null {
    return this.refreshToken;
  }

  getCSRFToken(): string | null {
    if (typeof document === 'undefined') return null;
    const value = document.cookie.split('; ').find((part) => part.startsWith('gomo6_csrf='));
    return value ? decodeURIComponent(value.slice('gomo6_csrf='.length)) : null;
  }

  /** Try to refresh the access token using the HttpOnly refresh cookie or legacy token. */
  async tryRefreshToken(force = false): Promise<string | null> {
    // If there is neither a legacy token nor a browser session hint, avoid a
    // pointless network request. The refresh token itself is HttpOnly, while
    // the CSRF cookie is the deliberately readable session hint.
    if (!this.refreshToken && !this.getCSRFToken()) return null;

    // Deduplicate concurrent refresh attempts. This join is honored even for
    // a FORCED refresh: if another caller already has a network refresh in
    // flight, its result is used instead of firing a duplicate request. Only
    // the fresh-token and cooldown short-circuits below are bypassed by force.
    if (this.refreshPromise) return this.refreshPromise;

    // No-op when we already hold a fresh access token: nothing to refresh.
    // A FORCED refresh (second chance after a retry-401) bypasses this: the
    // token we hold was just rejected, so it must be replaced by a real
    // network refresh, not returned as-is.
    if (!force && this.token && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt - 60 * 1000) {
      return this.token;
    }

    // Cooldown: at most one network refresh per 10s per tab. Many components
    // call getSession()/getCurrentUser() on mount and every 401 path triggers
    // a refresh; without this guard a single page load fires dozens of refresh
    // requests (observed on prod: ~1 refresh per 5s around the clock).
    // A FORCED refresh skips the cooldown: it is the recovery path after a
    // concurrent refresh (another tab) blacklisted our just-issued token, and
    // waiting out 10s would strand the user on a logout screen.
    if (!force && this.lastRefreshAt && Date.now() - this.lastRefreshAt < 10 * 1000 && this.token) {
      return this.token;
    }

    this.lastRefreshAt = Date.now();
    // Reset the "session dead" flag ONLY when actually hitting the network.
    // The early returns above (dedup/cooldown/fresh) must preserve the previous
    // value: if the last real refresh was rejected with 401 (dead session), a
    // cooldown-limited call that returns the stale token must NOT clear that
    // fact, or request() would fail to force-logout and the user would sit on
    // a permanent 401 storm instead of being redirected to /auth.
    this.lastRefreshAuthFailed = false;

    this.refreshPromise = (async () => {
      try {
        const csrf = this.getCSRFToken();
        const res = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
            ...(this.token && this.refreshToken ? { Authorization: `Bearer ${this.token}` } : {}),
          },
          body: JSON.stringify(this.refreshToken ? { refresh_token: this.refreshToken } : {}),
        });
        // Only a 401/403 from the refresh endpoint means the session is truly
        // dead (expired/revoked refresh token). Anything else is a transient
        // server problem — keep the current session instead of logging out.
        if (res.status === 401 || res.status === 403) {
          this.lastRefreshAuthFailed = true;
          return null;
        }
        if (!res.ok) {
          return this.token;
        }
        const json = await res.json();
        const data = json.data ?? json;
        const newToken = data.token;
        const newRefresh = data.refresh_token;
        if (newToken) {
          this.setTokens(newToken, newRefresh || this.refreshToken);
          return newToken;
        }
        return this.token;
      } catch {
        // Network error — never treat it as "session expired".
        return this.token;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  /**
   * True when the LAST refresh attempt was rejected by the server with a
   * 401/403 (genuinely dead session), as opposed to a transient network/5xx
   * failure. Callers use this to decide whether to force-logout.
   */
  getRefreshAuthFailed(): boolean {
    return this.lastRefreshAuthFailed;
  }

  public async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    // Proactive refresh: if token expires in < 5 minutes, refresh now
    if (this.token && this.tokenExpiresAt && Date.now() > this.tokenExpiresAt - 5 * 60 * 1000) {
      await this.tryRefreshToken();
    }

    const doFetch = async (): Promise<ApiResponse<T>> => {
      const url = `${API_BASE_URL}${endpoint}`;
      const csrf = this.getCSRFToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(this.token && { 'Authorization': `Bearer ${this.token}` }),
        ...(csrf && options.method && options.method !== 'GET' && options.method !== 'HEAD' ? { 'X-CSRF-Token': csrf } : {}),
        ...(options.headers as Record<string, string> || {}),
      };

      const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include',
      });

      // Read the body once, then parse. Must NOT call response.json() and on
      // failure fall back to response.text(): after a failed json() the body
      // stream is already consumed and text() rejects. A body that claims
      // application/json but is not (upstream proxy error page, server
      // double-write) must surface as a clean error object, not a SyntaxError.
      const text = await response.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { error: text || `HTTP ${response.status}` };
      }

      if (!response.ok) {
        const err = new Error(data.error || `HTTP ${response.status}`) as ApiClientError;
        err.status = response.status;
        err.code = data.code ?? undefined;
        err.params = data.params;
        throw err;
      }

      // Check unified {success, data} format
      if (data != null && data.success === false) {
        const err = new Error(data.error || 'Request failed') as ApiClientError;
        err.code = data.code ?? undefined;
        err.params = data.params;
        throw err;
      }
      return data;
    };

    const hadAuth = Boolean(this.token || this.getCSRFToken());
    const tokenIsFresh = () =>
      this.tokenExpiresAt != null && Date.now() < this.tokenExpiresAt - 60 * 1000;
    try {
      return await doFetch();
    } catch (error) {
      const err = error as Error & { status?: number };
      // A public login/register request must surface its own 401. Refresh is
      // only meaningful when this request already had a browser or bearer session.
      if (err.status === 401 && hadAuth) {
        const tokenAtCatch = this.token;
        let refreshedToken = await this.tryRefreshToken();
        // Refresh + retry, with a bounded second chance. The SECOND (forced)
        // cycle exists because a concurrent refresh in ANOTHER tab can
        // blacklist the token our first refresh just issued (the backend
        // supersedes the previous access token on every refresh). The retry
        // then 401s and the user gets force-logged out of a perfectly healthy
        // session — observed on prod as random "logged out, logged back in"
        // cycles while /auth/refresh kept returning 200. A genuinely revoked
        // session fails every refresh with 401/403 and still ends in a logout,
        // so this can never loop forever.
        for (let attempt = 0; attempt < 2 && refreshedToken; attempt++) {
          if (refreshedToken !== tokenAtCatch || tokenIsFresh()) {
            try {
              return await doFetch();
            } catch (retryError) {
              const re = retryError as Error & { status?: number };
              if (re.status !== 401) throw retryError;
              // 401 again — fall through to a forced second refresh.
            }
          }
          // Session already known-dead (previous real refresh was rejected):
          // do not waste a network call, go straight to the logout below.
          if (this.lastRefreshAuthFailed) break;
          refreshedToken = await this.tryRefreshToken(true);
        }
        // Genuinely dead session: the refresh endpoint rejected us (401/403),
        // or there was no refresh path at all. Force logout.
        if (this.lastRefreshAuthFailed || (!this.refreshToken && !this.getCSRFToken())) {
          this.clearTokens();
          window.dispatchEvent(new CustomEvent('auth:expired'));
          throw new Error('Session expired. Please log in again.');
        }
        // Transient refresh failure (network/5xx) — keep the session and
        // surface the original error so the caller can retry or degrade.
        throw error;
      }
      throw error;
    }
  }

  // Public method for compatibility layer
  public rawRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, options);
  }

  // Auth Methods
  async register(username: string, password: string, displayName?: string, turnstileToken?: string): Promise<AuthResponse> {
    const body: Record<string, string> = { username, password };
    if (displayName) {
      body.display_name = displayName;
    }
    if (turnstileToken) {
      body.cf_turnstile_response = turnstileToken;
    }

    const response = await this.request<Record<string, unknown>>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const data = response.data as Record<string, unknown> | null;
    if (data) {
      this.setTokens(data.token as string, (data.refresh_token as string) || null);
    }

    return data as unknown as AuthResponse;
  }

  async login(
    username: string,
    password: string,
    deviceToken?: string,
    turnstileToken?: string
  ): Promise<AuthResponse & { needs_2fa?: boolean }> {
    const body: Record<string, string | boolean> = { username, password };
    if (deviceToken) {
      body.device_token = deviceToken;
    }
    if (turnstileToken) {
      body.cf_turnstile_response = turnstileToken;
    }

    const response = await this.request<Record<string, unknown>>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const data = response.data as Record<string, unknown> & { needs_2fa?: boolean } | null;
    if (data) {
      // Only set tokens if 2FA is not needed (full token pair)
      if (!data.needs_2fa) {
        this.setTokens(data.token as string, (data.refresh_token as string) || null);
      }
    }

    return data as unknown as AuthResponse & { needs_2fa?: boolean };
  }

  async verify2FA(token: string, code: string, deviceToken?: string, trustDevice?: boolean): Promise<AuthResponse & { device_token?: string }> {
    const body: Record<string, string | boolean> = { token, code };
    if (deviceToken) {
      body.device_token = deviceToken;
    }
    if (trustDevice) {
      body.trust_device = true;
    }

    const response = await this.request<Record<string, unknown>>('/api/v1/auth/verify-2fa', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const data = response.data as Record<string, unknown> | null;
    if (data) {
      this.setTokens(data.token as string, (data.refresh_token as string) || null);
    }

    return data as unknown as AuthResponse & { device_token?: string };
  }

  // Last known good user profile (survives network errors)
  private cachedUser: User | null = null;
  private currentUserPromise: Promise<User | null> | null = null;
  private currentUserCacheTime = 0;

  async getCurrentUser(): Promise<User | null> {

    // Deduplicate concurrent calls and cache for 30s
    if (this.currentUserPromise && Date.now() - this.currentUserCacheTime < 30000) {
      return this.currentUserPromise;
    }

    if (!this.token && !this.getCSRFToken()) return null;

    this.currentUserCacheTime = Date.now();
    this.currentUserPromise = (async () => {
      try {
        const response = await this.request<User>('/api/v1/auth/me');
        const user = response.data as User;
        if (user) this.cachedUser = user;
        return user;
      } catch (error) {
        // If tokens were cleared (401 + refresh failed), we're logged out
        if (!this.token) return null;
        const err = error as Error & { status?: number };
        // Direct 401 (no refresh token available) — also logged out
        if (err.status === 401) return null;
        // Network error (502, timeout, DNS) — return cached user if available
        console.warn('[API] getCurrentUser network error, using cached profile:', err.message);
        return this.cachedUser;
      }
    })();

    return this.currentUserPromise;
  }

  async logout(): Promise<void> {
    // Re-establish an access token when a browser refreshed the page and only
    // the HttpOnly refresh cookie remains. This lets the backend revoke the
    // session instead of merely deleting client-side state.
    if (!this.token && this.getCSRFToken()) {
      await this.tryRefreshToken();
    }

    try {
      const csrf = this.getCSRFToken();
      await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        },
      });
    } finally {
      this.clearTokens();
      // L2 (security audit): purge privacy-sensitive PWA runtime caches on
      // logout — storage-objects(-v2) may hold private wall/uploads images
      // and messenger-conversations carries decrypted message previews.
      // Without this, a shared device would keep the previous user's data in
      // Cache Storage after they log out. The legacy 'storage-objects' name
      // is deleted too, so entries cached by pre-fix service workers are
      // removed on the first logout after the upgrade. Best-effort: the
      // guards skip environments without the Cache Storage API, and
      // allSettled absorbs individual deletion failures.
      if (typeof caches !== 'undefined' && 'caches' in window) {
        await Promise.allSettled([
          caches.delete('storage-objects'),
          caches.delete('storage-objects-v2'),
          caches.delete('messenger-conversations'),
        ]);
      }
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
  }

  async updatePassword(password: string, currentPassword?: string): Promise<void> {
    await this.request<unknown>('/api/v1/auth/password', {
      method: 'POST',
      body: JSON.stringify({ password, current_password: currentPassword || '' }),
    });
  }

  // 2FA Methods
  async setupTOTP(password: string): Promise<TOTPSetupResponse> {
    const response = await this.request<TOTPSetupResponse>('/api/v1/auth/2fa/setup', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    return response.data as TOTPSetupResponse;
  }

  async verifyAndEnableTOTP(code: string): Promise<{ enabled: boolean; recovery_codes?: string[] }> {
    const response = await this.request<{ enabled: boolean; recovery_codes?: string[] }>('/api/v1/auth/2fa/verify-and-enable', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    return response.data as { enabled: boolean; recovery_codes?: string[] };
  }

  async disableTOTP(code: string): Promise<void> {
    await this.request<unknown>('/api/v1/auth/2fa/disable', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  async get2FAStatus(): Promise<TwoFAStatus> {
    const response = await this.request<TwoFAStatus>('/api/v1/auth/2fa/status');
    return response.data as TwoFAStatus;
  }

  // Boards Methods
  async getBoards(params?: {
    slug?: string;
    is_gomosub?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<ApiResponse<Board[]>> {
    const searchParams = new URLSearchParams();
    if (params?.slug) searchParams.set('slug', `eq:${params.slug}`);
    if (params?.is_gomosub !== undefined) searchParams.set('is_gomosub', `eq:${params.is_gomosub}`);
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return this.request<Board[]>(`/api/v1/boards${query ? `?${query}` : ''}`);
  }

  async getBoard(slug: string): Promise<ApiResponse<Board>> {
    return this.request<Board>(`/api/v1/boards/${slug}`);
  }

  async createBoard(board: Partial<Board>): Promise<ApiResponse<Board>> {
    return this.request<Board>('/api/v1/boards', {
      method: 'POST',
      body: JSON.stringify(board),
    });
  }

  // Threads Methods
  async getThreads(params?: {
    board_id?: string;
    id?: string;
    limit?: number;
    offset?: number;
  }): Promise<ApiResponse<Thread[]>> {
    const searchParams = new URLSearchParams();
    if (params?.board_id) searchParams.set('board_id', params.board_id);
    if (params?.id) searchParams.set('id', params.id);
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return this.request<Thread[]>(`/api/v1/threads${query ? `?${query}` : ''}`);
  }

  async getThread(id: string): Promise<ApiResponse<Thread>> {
    return this.request<Thread>(`/api/v1/threads/${id}`);
  }

  async createThread(thread: Partial<Thread>): Promise<ApiResponse<Thread>> {
    return this.request<Thread>('/api/rpc/create_thread', {
      method: 'POST',
      body: JSON.stringify(thread),
    });
  }

  // Posts Methods
  async getPosts(params?: {
    thread_id?: string;
    id?: string;
    limit?: number;
    offset?: number;
  }): Promise<ApiResponse<Post[]>> {
    const searchParams = new URLSearchParams();
    if (params?.thread_id) searchParams.set('thread_id', params.thread_id);
    if (params?.id) searchParams.set('id', params.id);
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return this.request<Post[]>(`/api/v1/posts${query ? `?${query}` : ''}`);
  }

  async getPost(id: string): Promise<ApiResponse<Post>> {
    return this.request<Post>(`/api/v1/posts/${id}`);
  }

  async createPost(post: Partial<Post>): Promise<ApiResponse<Post>> {
    return this.request<Post>('/api/rpc/create_post', {
      method: 'POST',
      body: JSON.stringify(post),
    });
  }

  // Profiles Methods
  async getProfiles(params?: {
    id?: string;
    username?: string;
    domain?: string;
    limit?: number;
    offset?: number;
  }): Promise<ApiResponse<User[]>> {
    const searchParams = new URLSearchParams();
    if (params?.id) searchParams.set('id', params.id);
    if (params?.username) searchParams.set('username', params.username);
    if (params?.domain) searchParams.set('domain', params.domain);
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return this.request<User[]>(`/api/v1/profiles${query ? `?${query}` : ''}`);
  }

  async getProfile(id: string): Promise<ApiResponse<User>> {
    return this.request<User>(`/api/v1/profiles/${id}`);
  }

  async updateProfile(id: string, updates: Partial<User>): Promise<ApiResponse<User>> {
    return this.request<User>(`/api/v1/profiles/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  // Likes Methods
  async likeThread(threadId: string): Promise<ApiResponse<ThreadLike>> {
    return this.request<ThreadLike>(`/api/v1/threads/${threadId}/like`, {
      method: 'POST',
    });
  }

  async unlikeThread(threadId: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/api/v1/threads/${threadId}/like`, {
      method: 'DELETE',
    });
  }

  async likePost(postId: string): Promise<ApiResponse<PostLike>> {
    return this.request<PostLike>(`/api/v1/posts/${postId}/like`, {
      method: 'POST',
    });
  }

  async unlikePost(postId: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/api/v1/posts/${postId}/like`, {
      method: 'DELETE',
    });
  }

  async getThreadLikes(threadId: string, params?: {
    limit?: number;
    offset?: number;
  }): Promise<ApiResponse<ThreadLike[]>> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return this.request<ThreadLike[]>(`/api/v1/threads/${threadId}/likes${query ? `?${query}` : ''}`);
  }

  // RPC Methods
  async getPostLikesCount(postUuid: string): Promise<ApiResponse<number>> {
    return this.request<number>(`/api/rpc/get_post_likes_count?post_uuid=${postUuid}`);
  }

  async getPostLikesBatch(postIds: string[], userUuid?: string): Promise<ApiResponse<Array<{ post_id: string; count: number; is_liked: boolean }>>> {
    return this.request<Array<{ post_id: string; count: number; is_liked: boolean }>>(
      `/api/rpc/get_post_likes_batch?post_ids=${postIds.join(',')}${userUuid ? `&user_uuid=${userUuid}` : ''}`
    );
  }

  async getThreadLikesCount(threadUuid: string): Promise<ApiResponse<number>> {
    return this.request<number>(`/api/rpc/get_thread_likes_count?thread_uuid=${threadUuid}`);
  }

  async getThreadLikesBatch(threadIds: string[], userUuid?: string): Promise<ApiResponse<Array<{ thread_id: string; count: number; is_liked: boolean }>>> {
    return this.request<Array<{ thread_id: string; count: number; is_liked: boolean }>>(
      `/api/rpc/get_thread_likes_batch?thread_ids=${threadIds.join(',')}${userUuid ? `&user_uuid=${userUuid}` : ''}`
    );
  }

  async hasUserLikedPost(postUuid: string, userUuid: string): Promise<ApiResponse<boolean>> {
    return this.request<boolean>(`/api/rpc/has_user_liked_post?post_uuid=${postUuid}&user_uuid=${userUuid}`);
  }

  async hasUserLikedThread(threadUuid: string, userUuid: string): Promise<ApiResponse<boolean>> {
    return this.request<boolean>(`/api/rpc/has_user_liked_thread?thread_uuid=${threadUuid}&user_uuid=${userUuid}`);
  }

  async getRecentPostLikers(postUuid: string, limitCount = 10): Promise<ApiResponse<Array<{ user_id: string; created_at: string }>>> {
    return this.request<Array<{ user_id: string; created_at: string }>>(`/api/rpc/get_recent_post_likers?post_uuid=${postUuid}&limit_count=${limitCount}`);
  }

  async getRecentThreadLikers(threadUuid: string, limitCount = 10): Promise<ApiResponse<Array<{ user_id: string; created_at: string }>>> {
    return this.request<Array<{ user_id: string; created_at: string }>>(`/api/rpc/get_recent_thread_likers?thread_uuid=${threadUuid}&limit_count=${limitCount}`);
  }

  async getUserLikesReceivedCount(userUuid: string): Promise<ApiResponse<number>> {
    return this.request<number>(`/api/rpc/get_user_likes_received_count?user_uuid=${encodeURIComponent(userUuid)}`);
  }

  async getUserThreadLikesReceivedCount(userUuid: string): Promise<ApiResponse<number>> {
    return this.request<number>(`/api/rpc/get_user_thread_likes_received_count?user_uuid=${encodeURIComponent(userUuid)}`);
  }

  async getUserPostLikesReceivedTimestamps(userUuid: string): Promise<ApiResponse<Array<{ created_at: string }>>> {
    return this.request(`/api/rpc/get_user_post_likes_received_timestamps?user_uuid=${encodeURIComponent(userUuid)}`);
  }

  async getUserThreadLikesReceivedTimestamps(userUuid: string): Promise<ApiResponse<Array<{ created_at: string }>>> {
    return this.request(`/api/rpc/get_user_thread_likes_received_timestamps?user_uuid=${encodeURIComponent(userUuid)}`);
  }

  async getUserThreadReplyTimestamps(userUuid: string): Promise<ApiResponse<Array<{ created_at: string }>>> {
    return this.request(`/api/rpc/get_user_thread_reply_timestamps?user_uuid=${encodeURIComponent(userUuid)}`);
  }

  async toggleWallPostPin(postId: string, userId: string): Promise<ApiResponse<boolean>> {
    return this.request(`/api/rpc/toggle_wall_post_pin?_post_id=${encodeURIComponent(postId)}&_user_id=${encodeURIComponent(userId)}`);
  }

  // Notifications
  async getNotifications(params?: {
    limit?: number;
    offset?: number;
    is_read?: string;
  }): Promise<ApiResponse<Notification[]>> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());
    if (params?.is_read) searchParams.set('is_read', params.is_read);

    const query = searchParams.toString();
    return this.request<Notification[]>(`/api/v1/notifications${query ? `?${query}` : ''}`);
  }

  async getNotification(id: string): Promise<ApiResponse<Notification>> {
    return this.request<Notification>(`/api/v1/notifications/${id}`);
  }

  async markNotificationAsRead(id: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/api/v1/notifications/${id}/read`, {
      method: 'PUT',
    });
  }

  async markAllNotificationsAsRead(): Promise<ApiResponse<void>> {
    return this.request<void>('/api/v1/notifications/read-all', {
      method: 'PUT',
    });
  }

  async getUnreadNotificationsCount(): Promise<ApiResponse<{ unread_count: number }>> {
    return this.request<{ unread_count: number }>('/api/v1/notifications/unread-count');
  }

  async getMessengerUnreadCount(): Promise<ApiResponse<{ unread_count: number }>> {
    return this.request<{ unread_count: number }>('/api/rpc/get_messenger_unread_count');
  }

  // ── Passkeys / WebAuthn ───────────────────────────────────────────────────

  async beginPasskeyRegistration(): Promise<Record<string, unknown>> {
    const resp = await this.request<Record<string, unknown>>('/api/v1/auth/webauthn/register/begin', { method: 'POST' });
    return resp.data as Record<string, unknown>;
  }

  async finishPasskeyRegistration(name: string, credential: Record<string, unknown>): Promise<{ ok: boolean }> {
    const resp = await this.request<{ ok: boolean }>(`/api/v1/auth/webauthn/register/finish?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      body: JSON.stringify(credential),
    });
    return resp.data as { ok: boolean };
  }

  async beginPasskeyLogin(): Promise<{ options: Record<string, unknown>; session_token: string }> {
    const resp = await this.request<Record<string, unknown>>('/api/v1/auth/webauthn/login/begin');
    return resp.data as { options: Record<string, unknown>; session_token: string };
  }

  async finishPasskeyLogin(sessionToken: string, credential: Record<string, unknown>): Promise<AuthResponse> {
    const resp = await this.request<Record<string, unknown>>(`/api/v1/auth/webauthn/login/finish?session_token=${encodeURIComponent(sessionToken)}`, {
      method: 'POST',
      body: JSON.stringify(credential),
    });
    const data = resp.data as Record<string, unknown> & { token?: string; refresh_token?: string } | null;
    if (data?.token) {
      this.setTokens(data.token as string, (data.refresh_token as string) || null);
    }
    return data as unknown as AuthResponse;
  }

  async listPasskeys(): Promise<Array<{ credential_id: string; name: string; attestation_type: string; created_at: string; last_used_at?: string }>> {
    const resp = await this.request<{ credentials: Array<{ credential_id: string; name: string; attestation_type: string; created_at: string; last_used_at?: string }> }>('/api/v1/auth/webauthn/credentials');
    return (resp.data as { credentials: Array<{ credential_id: string; name: string; attestation_type: string; created_at: string; last_used_at?: string }> })?.credentials ?? [];
  }

  async deletePasskey(credentialId: string): Promise<{ ok: boolean }> {
    const resp = await this.request<{ ok: boolean }>(`/api/v1/auth/webauthn/credentials/${encodeURIComponent(credentialId)}`, { method: 'DELETE' });
    return resp.data as { ok: boolean };
  }

  // ─── Session management ───────────────────────────────────────────────────

  async getSessions(): Promise<SessionInfo[]> {
    const resp = await this.request<SessionInfo[]>('/api/v1/auth/sessions');
    return (resp.data as SessionInfo[]) ?? [];
  }

  async deleteSession(sessionId: string): Promise<{ ok: boolean; is_current: boolean; was_current: boolean }> {
    const resp = await this.request<{ ok: boolean; is_current: boolean; was_current: boolean }>(
      `/api/v1/auth/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }
    );
    return resp.data as { ok: boolean; is_current: boolean; was_current: boolean };
  }

  async deleteAllOtherSessions(): Promise<{ deleted: number }> {
    const resp = await this.request<{ deleted: number }>('/api/v1/auth/sessions', { method: 'DELETE' });
    return resp.data as { deleted: number };
  }
}

// Legacy builds stored the access/refresh pair in localStorage. Remove them so
// no previously persisted secret survives a page load.
function removeLegacyStoredTokens(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_refresh_token');
  } catch {
    // localStorage may be unavailable (private mode, sandboxed iframe)
  }
}

// Create singleton instance
export const apiClient = new ApiClient();

// Read the server-issued trusted-device token (opaque, ~256 bits of entropy,
// set by verify-2fa when the user checks "trust this device"). Never generate
// one client-side: the backend only accepts tokens it minted (matched by
// SHA-256), so a client-chosen string can never skip 2FA.
export function getDeviceToken(): string {
  try {
    return localStorage.getItem('device_token') || '';
  } catch {
    return '';
  }
}

export default apiClient;
export { API_BASE_URL };