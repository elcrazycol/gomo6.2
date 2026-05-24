// RPC module — supabase.rpc() compatibility backed by Go backend
import { apiClient } from './client';

export const rpc = (functionName: string, params?: any) => {
  const executeRpc = async () => {
    switch (functionName) {
      case 'get_post_likes_count':
        return apiClient.getPostLikesCount(params?.post_uuid);
      case 'get_thread_likes_count':
        return apiClient.getThreadLikesCount(params?.thread_uuid);
      case 'has_user_liked_post':
        return apiClient.hasUserLikedPost(params?.post_uuid, params?.user_uuid);
      case 'has_user_liked_thread':
        return apiClient.hasUserLikedThread(params?.thread_uuid, params?.user_uuid);
      case 'get_recent_post_likers':
        return apiClient.getRecentPostLikers(params?.post_uuid, params?.limit_count);
      case 'get_recent_thread_likers':
        return apiClient.getRecentThreadLikers(params?.thread_uuid, params?.limit_count);
      case 'get_user_likes_received_count':
        return apiClient.getUserLikesReceivedCount(params?.user_uuid);
      case 'get_user_thread_likes_received_count':
        return apiClient.getUserThreadLikesReceivedCount(params?.user_uuid);
      case 'get_user_post_likes_received_timestamps':
        return apiClient.getUserPostLikesReceivedTimestamps(params?.user_uuid);
      case 'get_user_thread_likes_received_timestamps':
        return apiClient.getUserThreadLikesReceivedTimestamps(params?.user_uuid);
      case 'get_user_thread_reply_timestamps':
        return apiClient.getUserThreadReplyTimestamps(params?.user_uuid);
      case 'toggle_wall_post_pin':
        return apiClient.toggleWallPostPin(params?._post_id, params?._user_id);
      case 'get_avatar_history':
      case 'delete_avatar_from_history':
      case 'toggle_achievement_pin':
      case 'get_or_create_direct_chat':
      case 'chat_mark_delivered':
      case 'chat_mark_read':
        try {
          const response = await apiClient.rawRequest(`/rpc/v1/${functionName}`, {
            method: 'POST',
            body: JSON.stringify(params || {}),
          });
          return { data: response.data, error: response.error ? { message: response.error } : null };
        } catch (error) {
          return { data: null, error: { message: (error as Error).message } };
        }
      default:
        return { data: null, error: { message: 'Unknown RPC function' } };
    }
  };

  return executeRpc();
};
