// RPC module — supabase.rpc() compatibility backed by Go backend
import { apiClient } from './client';

export const rpc = (functionName: string, params?: any) => {
  const executeRpc = async () => {
    try {
      switch (functionName) {
        case 'get_post_likes_count': {
          const res = await apiClient.getPostLikesCount(params?.post_uuid);
          return { data: res.data, error: null };
        }
        case 'get_thread_likes_count': {
          const res = await apiClient.getThreadLikesCount(params?.thread_uuid);
          return { data: res.data, error: null };
        }
        case 'has_user_liked_post': {
          const res = await apiClient.hasUserLikedPost(params?.post_uuid, params?.user_uuid);
          return { data: res.data, error: null };
        }
        case 'has_user_liked_thread': {
          const res = await apiClient.hasUserLikedThread(params?.thread_uuid, params?.user_uuid);
          return { data: res.data, error: null };
        }
        case 'get_recent_post_likers': {
          const res = await apiClient.getRecentPostLikers(params?.post_uuid, params?.limit_count);
          return { data: res.data, error: null };
        }
        case 'get_recent_thread_likers': {
          const res = await apiClient.getRecentThreadLikers(params?.thread_uuid, params?.limit_count);
          return { data: res.data, error: null };
        }
        case 'get_user_likes_received_count': {
          const res = await apiClient.getUserLikesReceivedCount(params?.user_uuid);
          return { data: res.data, error: null };
        }
        case 'get_user_thread_likes_received_count': {
          const res = await apiClient.getUserThreadLikesReceivedCount(params?.user_uuid);
          return { data: res.data, error: null };
        }
        case 'get_user_post_likes_received_timestamps': {
          const res = await apiClient.getUserPostLikesReceivedTimestamps(params?.user_uuid);
          return { data: res.data, error: null };
        }
        case 'get_user_thread_likes_received_timestamps': {
          const res = await apiClient.getUserThreadLikesReceivedTimestamps(params?.user_uuid);
          return { data: res.data, error: null };
        }
        case 'get_user_thread_reply_timestamps': {
          const res = await apiClient.getUserThreadReplyTimestamps(params?.user_uuid);
          return { data: res.data, error: null };
        }
        case 'toggle_wall_post_pin': {
          const res = await apiClient.toggleWallPostPin(params?._post_id, params?._user_id);
          return { data: res.data, error: null };
        }
        case 'get_avatar_history':
        case 'delete_avatar_from_history':
        case 'toggle_achievement_pin':
        case 'get_or_create_direct_chat':
        case 'chat_mark_delivered':
        case 'chat_mark_read': {
          const response = await apiClient.rawRequest(`/rpc/v1/${functionName}`, {
            method: 'POST',
            body: JSON.stringify(params || {}),
          });
          return { data: response.data, error: response.error ? { message: response.error } : null };
        }
        default:
          return { data: null, error: { message: 'Unknown RPC function' } };
      }
    } catch (error) {
      return { data: null, error: { message: (error as Error).message } };
    }
  };

  return executeRpc();
};
