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

// APIResponse wrapper (not from OpenAPI — hand-written generic for {success, data, error} format)
export interface ApiResponse<T> {
  success: boolean;
  data: T | T[] | null;
  count?: number;
  error?: string | null;
  has_more?: boolean;
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

  constructor() {
    // Load tokens from localStorage on init
    this.token = localStorage.getItem('auth_token');
    this.refreshToken = localStorage.getItem('auth_refresh_token');
    if (this.token) {
      const payload = decodeJwtPayload(this.token);
      if (payload?.exp && typeof payload.exp === 'number') {
        this.tokenExpiresAt = payload.exp * 1000; // JWT exp is in seconds
      }
    }
  }

  setToken(token: string) {
    this.setTokens(token, this.refreshToken);
  }

  setTokens(accessToken: string, refreshToken: string | null) {
    this.token = accessToken;
    this.refreshToken = refreshToken || null;
    localStorage.setItem('auth_token', accessToken);
    if (refreshToken) {
      localStorage.setItem('auth_refresh_token', refreshToken);
    }
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
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_refresh_token');
  }

  getToken(): string | null {
    return this.token;
  }

  getRefreshToken(): string | null {
    return this.refreshToken;
  }

  /** Try to refresh the access token using the stored refresh token. */
  async tryRefreshToken(): Promise<string | null> {
    // Deduplicate concurrent refresh attempts
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      try {
        if (!this.refreshToken) return null;
        const res = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.token && { Authorization: `Bearer ${this.token}` }),
          },
          body: JSON.stringify({ refresh_token: this.refreshToken }),
        });
        if (!res.ok) return null;
        const json = await res.json();
        const data = json.data ?? json;
        const newToken = data.token;
        const newRefresh = data.refresh_token;
        if (newToken) {
          this.setTokens(newToken, newRefresh || this.refreshToken);
          return newToken;
        }
        return null;
      } catch {
        return null;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
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
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(this.token && { 'Authorization': `Bearer ${this.token}` }),
        ...(options.headers as Record<string, string> || {}),
      };

      const response = await fetch(url, {
        ...options,
        headers,
      });

      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      let data;

      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        // For non-JSON responses, create error object
        const text = await response.text();
        data = { error: text || `HTTP ${response.status}` };
      }

      if (!response.ok) {
        const err = new Error(data.error || `HTTP ${response.status}`) as Error & { status?: number };
        err.status = response.status;
        throw err;
      }

      // Check unified {success, data} format
      if (data != null && data.success === false) {
        const err = new Error(data.error || 'Request failed');
        throw err;
      }
      return data;
    };

    try {
      return await doFetch();
    } catch (error) {
      const err = error as Error & { status?: number };
      // On 401, try refreshing the token and retry once (only for authenticated requests)
      if (err.status === 401 && this.token) {
        if (this.refreshToken) {
          const newToken = await this.tryRefreshToken();
          if (newToken) {
            return await doFetch();
          }
        }
        // No refresh token or refresh failed — force logout
        this.clearTokens();
        window.dispatchEvent(new CustomEvent('auth:expired'));
        throw new Error('Session expired. Please log in again.');
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
  async register(email: string, username: string, password: string): Promise<AuthResponse> {
    const body: Record<string, string> = { email, username, password };

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
    email: string,
    password: string,
    deviceId?: string
  ): Promise<AuthResponse & { needs_2fa?: boolean }> {
    const body: Record<string, string | boolean> = { email, password };
    if (deviceId) {
      body.device_id = deviceId;
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

  async verify2FA(token: string, code: string, deviceId?: string, trustDevice?: boolean): Promise<AuthResponse> {
    const body: Record<string, string | boolean> = { token, code };
    if (deviceId) {
      body.device_id = deviceId;
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

    return data as unknown as AuthResponse;
  }

  // Last known good user profile (survives network errors)
  private cachedUser: User | null = null;
  private currentUserPromise: Promise<User | null> | null = null;
  private currentUserCacheTime = 0;

  async getCurrentUser(): Promise<User | null> {
    if (!this.token) { this.cachedUser = null; return null; }

    // Deduplicate concurrent calls and cache for 30s
    if (this.currentUserPromise && Date.now() - this.currentUserCacheTime < 30000) {
      return this.currentUserPromise;
    }

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

  logout() {
    this.clearTokens();
  }

  async updatePassword(password: string): Promise<void> {
    await this.request<unknown>('/api/v1/auth/password', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  }

  // 2FA Methods
  async setupTOTP(): Promise<TOTPSetupResponse> {
    const response = await this.request<TOTPSetupResponse>('/api/v1/auth/2fa/setup', {
      method: 'POST',
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

  async disableTOTP(): Promise<void> {
    await this.request<unknown>('/api/v1/auth/2fa/disable', {
      method: 'POST',
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

  async getThreadLikesCount(threadUuid: string): Promise<ApiResponse<number>> {
    return this.request<number>(`/api/rpc/get_thread_likes_count?thread_uuid=${threadUuid}`);
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
  }): Promise<ApiResponse<Notification[]>> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return this.request<Notification[]>(`/api/v1/notifications${query ? `?${query}` : ''}`);
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
}

// Create singleton instance
export const apiClient = new ApiClient();

// Generate a device ID (stable per browser)
export function getDeviceId(): string {
  let deviceId = localStorage.getItem('device_id');
  if (!deviceId) {
    deviceId = 'device_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    localStorage.setItem('device_id', deviceId);
  }
  return deviceId;
}

export default apiClient;
export { API_BASE_URL };