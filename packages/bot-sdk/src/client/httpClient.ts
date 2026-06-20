import axios, { type AxiosInstance, type AxiosError, isAxiosError } from "axios";
import axiosRetry, { isNetworkOrIdempotentRequestError, isRetryableError } from "axios-retry";
import type {
  ApiResponse,
  Thread,
  Post,
  Board,
  Profile,
  Message,
  Conversation,
  CreateThreadParams,
  CreatePostParams,
} from "../types/index.js";

export class HttpClient {
  private axios: AxiosInstance;

  constructor(token: string, baseUrl: string) {
    this.axios = axios.create({
      baseURL: baseUrl,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    axiosRetry(this.axios, {
      retries: 3,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (error) => {
        if (isNetworkOrIdempotentRequestError(error)) return true;
        if (isRetryableError(error)) return true;
        if (!error.response && error.code) {
          const retryableCodes = ["ECONNRESET", "EPIPE", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"];
          return retryableCodes.includes(error.code);
        }
        return false;
      },
      onRetry: (retryCount, error, requestConfig) => {
        console.warn(`[HttpClient] Retry #${retryCount} for ${requestConfig.method?.toUpperCase()} ${requestConfig.url}: ${error.message}`);
      },
    });
  }

  private async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const res = await this.axios.get<ApiResponse<T>>(path, { params });
    if (!res.data.success) throw new Error(res.data.error || "Request failed");
    return res.data.data;
  }

  private async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.axios.post<ApiResponse<T>>(path, body);
    if (!res.data.success) throw new Error(res.data.error || "Request failed");
    return res.data.data;
  }

  private async put<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.axios.put<ApiResponse<T>>(path, body);
    if (!res.data.success) throw new Error(res.data.error || "Request failed");
    return res.data.data;
  }

  private async del<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.axios.delete<ApiResponse<T>>(path, { data: body });
    if (!res.data.success) throw new Error(res.data.error || "Request failed");
    return res.data.data;
  }

  // ── Auth ──

  async getMe(): Promise<Profile> {
    return this.get<Profile>("/api/v1/auth/me");
  }

  // ── Threads ──

  async getThreads(params?: { board_id?: string; user_id?: string; limit?: number }): Promise<Thread[]> {
    return this.get<Thread[]>("/api/v1/threads", params as Record<string, unknown>);
  }

  async getThread(id: string): Promise<Thread> {
    return this.get<Thread>(`/api/v1/threads/${id}`);
  }

  // ── Posts ──

  async getPosts(params?: { thread_id?: string; user_id?: string; limit?: number }): Promise<Post[]> {
    return this.get<Post[]>("/api/v1/posts", params as Record<string, unknown>);
  }

  async getPost(id: string): Promise<Post> {
    return this.get<Post>(`/api/v1/posts/${id}`);
  }

  // ── RPC: Create ──

  async createThread(data: CreateThreadParams): Promise<Thread> {
    return this.post<Thread>("/api/rpc/create_thread", data);
  }

  async createPost(data: CreatePostParams): Promise<Post> {
    return this.post<Post>("/api/rpc/create_post", data);
  }

  // ── Boards ──

  async getBoards(params?: { slug?: string; is_gomosub?: boolean }): Promise<Board[]> {
    return this.get<Board[]>("/api/v1/boards", params as Record<string, unknown>);
  }

  async getBoard(idOrSlug: string): Promise<Board> {
    return this.get<Board>(`/api/v1/boards/${idOrSlug}`);
  }

  // ── Profiles ──

  async getProfile(id: string): Promise<Profile> {
    return this.get<Profile>(`/api/v1/profiles/${id}`);
  }

  // ── Likes ──

  async likeThread(threadId: string): Promise<void> {
    await this.post(`/api/v1/threads/${threadId}/like`);
  }

  async unlikeThread(threadId: string): Promise<void> {
    await this.del(`/api/v1/threads/${threadId}/like`);
  }

  async likePost(postId: string): Promise<void> {
    await this.post(`/api/v1/posts/${postId}/like`);
  }

  async unlikePost(postId: string): Promise<void> {
    await this.del(`/api/v1/posts/${postId}/like`);
  }

  // ── Messenger ──

  async getConversations(): Promise<Conversation[]> {
    return this.get<Conversation[]>("/api/v1/messenger/conversations");
  }

  async getMessages(conversationId: string, params?: { limit?: number; before?: string }): Promise<Message[]> {
    return this.get<Message[]>(`/api/v1/messenger/conversations/${conversationId}/messages`, params as Record<string, unknown>);
  }

  async sendMessage(conversationId: string, content: string, clientId?: string): Promise<Message> {
    return this.post<Message>(`/api/v1/messenger/conversations/${conversationId}/messages`, {
      content,
      client_id: clientId || crypto.randomUUID(),
    });
  }

  async editMessage(conversationId: string, messageId: string, content: string): Promise<void> {
    await this.put(`/api/v1/messenger/conversations/${conversationId}/messages/${messageId}`, { content });
  }

  async deleteMessage(conversationId: string, messageId: string): Promise<void> {
    await this.del(`/api/v1/messenger/conversations/${conversationId}/messages/${messageId}`);
  }

  async createConversation(userId: string): Promise<{ conversation_id: string }> {
    return this.post("/api/v1/messenger/conversations", { user_id: userId });
  }

  // ── Search ──

  async search(query: string): Promise<unknown> {
    return this.get("/api/v1/search", { q: query });
  }

  // ── Raw request (escape hatch) ──

  async request<T = unknown>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
    switch (method) {
      case "GET": return this.get<T>(path);
      case "POST": return this.post<T>(path, body);
      case "PUT": return this.put<T>(path, body);
      case "DELETE": return this.del<T>(path, body);
    }
  }
}
