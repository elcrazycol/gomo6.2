import { useQuery } from '@tanstack/react-query';
import { api } from '@/integrations/api/compat';

interface AchievementColor {
  reward_type: string;
  reward_value: string;
}

const PRIORITY = ['purple', 'gold', 'orange', 'red', 'blue', 'green', 'yellow', 'cyan'] as const;

function extractColor(data: AchievementColor[]): string {
  for (const p of PRIORITY) {
    if (data.some(a => a.reward_type === 'username_color' && a.reward_value === p)) {
      return p;
    }
  }
  return '';
}

/**
 * Shared hook that fetches username color from user_achievements.
 * Replaces duplicated color-fetching logic in UserBadge, ProcessedContent,
 * MentionLink, AppLayout, Index.
 */
export function useUserColor(userId: string | undefined) {
  return useQuery({
    queryKey: ['user-color', userId],
    queryFn: async () => {
      if (!userId) return '';
      const { data } = await api
        .from('user_achievements')
        .select('achievement_id, achievements(reward_type, reward_value)')
        .eq('user_id', userId);
      if (!data) return '';
      return extractColor(data as unknown as AchievementColor[]);
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
