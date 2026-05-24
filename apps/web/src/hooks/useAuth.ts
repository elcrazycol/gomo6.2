// Auth hook with React Query caching
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, User } from '@/integrations/api/client';

/**
 * Hook for getting current authenticated user with caching
 * Uses React Query to cache the result for 5 minutes
 * This prevents multiple simultaneous requests to /api/v1/auth/me
 */
export function useAuth() {
  const queryClient = useQueryClient();

  const { data: user, isLoading, error, refetch } = useQuery({
    queryKey: ['auth', 'currentUser'],
    queryFn: () => apiClient.getCurrentUser(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    retry: 1,
  });

  // Function to invalidate auth cache (call after login/logout)
  const invalidateAuth = () => {
    queryClient.invalidateQueries({ queryKey: ['auth'] });
  };

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    error,
    refetch,
    invalidateAuth,
  };
}

/**
 * Hook for getting current user session with caching
 * Compatible with API-style auth
 */
export function useSession() {
  const queryClient = useQueryClient();

  const { data: session, isLoading, error } = useQuery({
    queryKey: ['auth', 'session'],
    queryFn: async () => {
      const user = await apiClient.getCurrentUser();
      if (!user) return null;
      return {
        user,
        access_token: localStorage.getItem('auth_token'),
      };
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
  });

  // Function to invalidate session cache
  const invalidateSession = () => {
    queryClient.invalidateQueries({ queryKey: ['auth'] });
  };

  return {
    session,
    isLoading,
    error,
    invalidateSession,
  };
}
