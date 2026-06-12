// RPC module — api.rpc() compatibility backed by Go backend
import { apiClient } from './client';

export const rpc = (functionName: string, params?: Record<string, unknown>) => {
  const executeRpc = async () => {
    try {
      switch (functionName) {
        case 'get_post_likes_count': {
          const res = await apiClient.getPostLikesCount(params?.post_uuid as string);
          return { data: res.data, error: null };
        }
        case 'get_thread_likes_count': {
          const res = await apiClient.getThreadLikesCount(params?.thread_uuid as string);
          return { data: res.data, error: null };
        }
        case 'has_user_liked_post': {
          const res = await apiClient.hasUserLikedPost(params?.post_uuid as string, params?.user_uuid as string);
          return { data: res.data, error: null };
        }
        case 'has_user_liked_thread': {
          const res = await apiClient.hasUserLikedThread(params?.thread_uuid as string, params?.user_uuid as string);
          return { data: res.data, error: null };
        }
        case 'get_recent_post_likers': {
          const res = await apiClient.getRecentPostLikers(params?.post_uuid as string, Number(params?.limit_count));
          return { data: res.data, error: null };
        }
        case 'get_recent_thread_likers': {
          const res = await apiClient.getRecentThreadLikers(params?.thread_uuid as string, Number(params?.limit_count));
          return { data: res.data, error: null };
        }
        case 'get_user_likes_received_count': {
          const res = await apiClient.getUserLikesReceivedCount(params?.user_uuid as string);
          return { data: res.data, error: null };
        }
        case 'get_user_thread_likes_received_count': {
          const res = await apiClient.getUserThreadLikesReceivedCount(params?.user_uuid as string);
          return { data: res.data, error: null };
        }
        case 'get_user_post_likes_received_timestamps': {
          const res = await apiClient.getUserPostLikesReceivedTimestamps(params?.user_uuid as string);
          return { data: res.data, error: null };
        }
        case 'get_user_thread_likes_received_timestamps': {
          const res = await apiClient.getUserThreadLikesReceivedTimestamps(params?.user_uuid as string);
          return { data: res.data, error: null };
        }
        case 'get_user_thread_reply_timestamps': {
          const res = await apiClient.getUserThreadReplyTimestamps(params?.user_uuid as string);
          return { data: res.data, error: null };
        }
        case 'toggle_wall_post_pin': {
          const res = await apiClient.toggleWallPostPin(params?._post_id as string, params?._user_id as string);
          return { data: res.data, error: null };
        }
        case 'get_avatar_history':
        case 'delete_avatar_from_history':
        case 'toggle_achievement_pin':
        case 'get_or_create_direct_chat': {
          // Go handler returns the conversation ID as a plain JSON string, NOT {success, data}
          // e.g. `c.JSON(http.StatusOK, conversationID)` → body is just "conv-uuid"
          const response = (await apiClient.rawRequest(`/api/rpc/${functionName}`, {
            method: 'POST',
            body: JSON.stringify(params || {}),
          })) as unknown;
          return { data: response, error: null };
        }
        case 'chat_mark_delivered':
        case 'chat_mark_read': {
          // Go handler returns c.JSON(http.StatusOK, nil) → body is null, not {success, data}
          // client.ts request() now handles null body safely (data != null && data.success === false)
          // On success: response is null → return { data: null, error: null }
          // On failure: request() throws → error propagates to caller
          await apiClient.rawRequest(`/api/rpc/${functionName}`, {
            method: 'POST',
            body: JSON.stringify(params || {}),
          });
          return { data: null, error: null };
        }
        default:
          return { data: null, error: { message: 'Unknown RPC function' } };
      }
    } catch {
      return { data: null, error: error as { message: string } };
    }
  };

  return executeRpc();
};
