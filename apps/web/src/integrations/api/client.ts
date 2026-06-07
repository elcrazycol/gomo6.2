// Go Backend API Client
import { toast } from "sonner";

// API Configuration
// In Docker production, API goes through Caddy reverse proxy at same origin.
// In dev mode (npm run dev), Vite proxy forwards /api to localhost:8080.
// Set VITE_API_BASE_URL to override (e.g., for direct backend access during dev).
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// Types
export interface User {
  id: string;
  username: string;
  email: string;
  domain: string;
  avatar_url?: string | null;
  bio?: string | null;
  garma?: number | null;
  post_count?: number | null;
  thread_count?: number | null;
  created_at: string;
  is_remote: boolean;
  is_anonymous: boolean;
}

export interface Board {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  is_gomosub: boolean;
  is_rules_board: boolean;
  owner_id?: string | null;
  gomosub_avatar_url?: string | null;
  cover_image_url?: string | null;
  gomosub_tags?: string[] | null;
  rules_markdown?: string | null;
  rules_updated_at?: string | null;
  created_at: string;
}

export interface Thread {
  id: string;
  board_id: string;
  user_id: string;
  title: string;
  content: string;
  content_json?: Record<string, unknown> | null;
  image_url?: string | null;
  image_urls?: string[] | null;
  post_count: number;
  server_domain: string;
  created_at: string;
  updated_at: string;
  is_remote: boolean;
}

export interface Post {
  id: string;
  thread_id: string;
  user_id: string;
  content: string;
  content_json?: Record<string, unknown> | null;
  image_url?: string | null;
  image_urls?: string[] | null;
  reply_to?: string | null;
  is_private: boolean;
  private_recipient_id?: string | null;
  server_domain: string;
  created_at: string;
  is_remote: boolean;
}

export interface PostLike {
  id: string;
  post_id: string;
  user_id: string;
  created_at: string;
}

export interface ThreadLike {
  id: string;
  thread_id: string;
  user_id: string;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  related_thread_id?: string | null;
  related_post_id?: string | null;
  is_read: boolean;
  created_at: string;
}

// Auth Response
export interface AuthResponse {
  token: string;
  user: User;
  needs_2fa?: boolean;
}

// 2FA Types
export interface TOTPSetupResponse {
  secret: string;
  uri: string;
}

export interface TwoFAStatus {
  enabled: boolean;
  has_pending_secret: boolean;
}

// Unified API Response Format ({success: bool, data: T})
export interface ApiResponse<T> {
  success: boolean;
  data: T | T[] | null;
  count?: number;
  error?: string | null;
}

// HTTP Client with auth
class ApiClient {
  private token: string | null = null;

  constructor() {
    // Load token from localStorage on init
    this.token = localStorage.getItem('auth_token');
  }

  setToken(token: string) {
    this.token = token;
    localStorage.setItem('auth_token', token);
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('auth_token');
  }

  getToken(): string | null {
    return this.token;
  }

  public async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${API_BASE_URL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(this.token && { 'Authorization': `Bearer ${this.token}` }),
      ...options.headers,
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
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    // Check unified {success, data} format
    if (data != null && data.success === false) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
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
    const response = await this.request<AuthResponse>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, username, password }),
    });

    if (response.data) {
      this.setToken((response.data as AuthResponse).token);
    }

    return response.data as AuthResponse;
  }

  async login(email: string, password: string, deviceId?: string): Promise<AuthResponse & { needs_2fa?: boolean }> {
    const body: Record<string, string | boolean> = { email, password };
    if (deviceId) {
      body.device_id = deviceId;
    }

    const response = await this.request<AuthResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const data = response.data as AuthResponse & { needs_2fa?: boolean } | null;
    if (data) {
      // Only set token if 2FA is not needed (full token)
      if (!data.needs_2fa) {
        this.setToken(data.token);
      }
    }

    return data as AuthResponse & { needs_2fa?: boolean };
  }

  async verify2FA(token: string, code: string, deviceId?: string, trustDevice?: boolean): Promise<AuthResponse> {
    const body: Record<string, string | boolean> = { token, code };
    if (deviceId) {
      body.device_id = deviceId;
    }
    if (trustDevice) {
      body.trust_device = true;
    }

    const response = await this.request<AuthResponse>('/api/v1/auth/verify-2fa', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (response.data) {
      this.setToken((response.data as AuthResponse).token);
    }

    return response.data as AuthResponse;
  }

  async getCurrentUser(): Promise<User | null> {
    if (!this.token) return null;

    try {
      const response = await this.request<User>('/api/v1/auth/me');
      return response.data as User;
    } catch (error) {
      // Only clear token on explicit 401 (expired/invalid).
      // Network errors (502, CORS, timeout) should NOT log out the user.
      if (error instanceof Error && error.message.includes('HTTP 401')) {
        this.clearToken();
      }
      return null;
    }
  }

  logout() {
    this.clearToken();
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

// Export for backward compatibility with existing code
export const api = {
  // Auth
  auth: {
    signUp: async ({ email, password, options }: { email: string; password: string; options?: { data?: { username?: string } } }) => {
      try {
        const result = await apiClient.register(email, options?.data?.username || email.split('@')[0], password);
        return { data: { user: result.user, session: { access_token: result.token } }, error: null };
      } catch (error) {
        return { data: null, error: { message: (error as Error).message } };
      }
    },
    signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
      try {
        const deviceId = getDeviceId();
        const result = await apiClient.login(email, password, deviceId);
        
        if (result.needs_2fa) {
          // Return session with partial token and needs_2fa flag
          return { 
            data: { user: result.user, session: { access_token: result.token, needs_2fa: true } }, 
            error: null 
          };
        }
        
        return { data: { user: result.user, session: { access_token: result.token } }, error: null };
      } catch (error) {
        return { data: null, error: { message: (error as Error).message } };
      }
    },
    signOut: async () => {
      apiClient.logout();
      return { error: null };
    },
    getUser: async () => {
      try {
        const user = await apiClient.getCurrentUser();
        return { data: { user }, error: null };
      } catch (error) {
        return { data: { user: null }, error: { message: (error as Error).message } };
      }
    },
    getSession: async () => {
      try {
        const user = await apiClient.getCurrentUser();
        return { data: { session: user ? { user, access_token: apiClient.getToken() } : null }, error: null };
      } catch (error) {
        return { data: { session: null }, error: { message: (error as Error).message } };
      }
    },
    onAuthStateChange: (callback: (event: string, session: { user: User } | null) => void) => {
      // Simple implementation - in real app would use event listeners
      const checkAuth = async () => {
        const user = await apiClient.getCurrentUser();
        callback('SIGNED_IN', user ? { user } : null);
      };
      
      // Initial check
      checkAuth();
      
      // Return unsubscribe function
      return { data: { subscription: { unsubscribe: () => {} } } };
    }
  },

  // Database
  from: (table: string) => ({
    select: (columns: string = '*') => ({
      eq: (column: string, value: string | number | boolean) => ({
        single: () => apiClient.request<Record<string, unknown>>(`/api/v1/${table}?${column}=eq.${value}&select=${columns}`),
        then: (callback: (value: ApiResponse<Record<string, unknown>>) => void) => apiClient.request<Record<string, unknown>>(`/api/v1/${table}?${column}=eq.${value}&select=${columns}`).then(callback)
      }),
      order: (column: string, options?: { ascending?: boolean }) => ({
        then: (callback: (value: ApiResponse<Record<string, unknown>>) => void) => {
          const direction = options?.ascending ? 'asc' : 'desc';
          return apiClient.request<Record<string, unknown>>(`/api/v1/${table}?select=${columns}&order=${column}.${direction}`).then(callback);
        }
      }),
      then: (callback: (value: ApiResponse<Record<string, unknown>>) => void) => apiClient.request<Record<string, unknown>>(`/api/v1/${table}?select=${columns}`).then(callback)
    }),
    insert: (data: Record<string, unknown>) => ({
      select: (columns: string = '*') => ({
        single: () => apiClient.request<Record<string, unknown>>(`/api/v1/${table}?select=${columns}`, {
          method: 'POST',
          body: JSON.stringify(data)
        }),
        then: (callback: (value: ApiResponse<Record<string, unknown>>) => void) => apiClient.request<Record<string, unknown>>(`/api/v1/${table}?select=${columns}`, {
          method: 'POST',
          body: JSON.stringify(data)
        }).then(callback)
      })
    }),
    update: (data: Record<string, unknown>) => ({
      eq: (column: string, value: string | number | boolean) => ({
        then: (callback: (value: ApiResponse<Record<string, unknown>>) => void) => {
          // Use REST path for /profiles/:id PUT — paths with query params get 404
          const url = column === 'id'
            ? `/api/v1/${table}/${encodeURIComponent(String(value))}`
            : `/api/v1/${table}?${column}=eq.${encodeURIComponent(String(value))}`;
          return apiClient.request<Record<string, unknown>>(url, {
            method: 'PUT',
            body: JSON.stringify(data)
          }).then(callback);
        }
      })
    }),
    delete: () => ({
      eq: (column: string, value: string | number | boolean) => ({
        then: (callback: (value: ApiResponse<Record<string, unknown>>) => void) => apiClient.request<Record<string, unknown>>(`/api/v1/${table}?${column}=eq.${value}`, {
          method: 'DELETE'
        }).then(callback)
      })
    })
  }),

  // RPC
  rpc: (functionName: string, params?: Record<string, string | number | boolean>) => {
    const url = `/api/rpc/${functionName}`;
    const searchParams = new URLSearchParams();
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        searchParams.set(key, String(value));
      });
    }
    
    const fullUrl = `${url}${searchParams.toString() ? `?${searchParams}` : ''}`;
    
    // Return a proper Promise that can be awaited
    return apiClient.request<Record<string, unknown>>(fullUrl).then(response => {
      return { data: response.data, error: response.error || null };
    }).catch(error => {
      return { data: null, error: { message: (error as Error).message } };
    });
  },

  // Storage (placeholder - not implemented in Go backend yet)
  storage: {
    from: (bucket: string) => ({
      upload: (path: string, file: File) => {
        toast.error("Storage not implemented yet");
        return Promise.reject(new Error("Storage not implemented"));
      },
      getPublicUrl: (path: string) => {
        toast.error("Storage not implemented yet");
        return { data: { publicUrl: '' } };
      }
    })
  }
};

export default apiClient;
export { API_BASE_URL };