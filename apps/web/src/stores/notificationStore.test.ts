import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNotificationStore } from './notificationStore';

vi.mock('@/integrations/api/client', () => ({
  apiClient: {
    getNotifications: vi.fn().mockResolvedValue({ data: [], has_more: false }),
    getUnreadNotificationsCount: vi.fn().mockResolvedValue({ data: { unread_count: 0 } }),
    markNotificationAsRead: vi.fn().mockResolvedValue({}),
    markAllNotificationsAsRead: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('@/services/websocket', () => ({
  wsService: {
    subscribeToNotifications: vi.fn(),
    on: vi.fn().mockReturnValue(() => {}),
    connected: false,
  },
}));

describe('notificationStore', () => {
  beforeEach(() => {
    useNotificationStore.getState().cleanup();
    vi.clearAllMocks();
  });

  it('has correct initial state', () => {
    const state = useNotificationStore.getState();
    expect(state.notifications).toEqual([]);
    expect(state.unreadCount).toBe(0);
    expect(state.hasMore).toBe(true);
    expect(state.offset).toBe(0);
    expect(state.initialized).toBe(false);
    expect(state.lastUnlockedAchievement).toBeNull();
  });

  it('markAsRead updates notification and decrements count', () => {
    const store = useNotificationStore;
    store.setState({
      notifications: [
        { id: 'n1', is_read: false, type: 'test', created_at: new Date().toISOString(), user_id: 'u1', title: 'test', message: 'test' },
        { id: 'n2', is_read: true, type: 'test', created_at: new Date().toISOString(), user_id: 'u1', title: 'test2', message: 'test2' },
      ],
      unreadCount: 1,
    });

    act(() => {
      store.getState().markAsRead('n1');
    });

    const state = store.getState();
    expect(state.notifications.find((n) => n.id === 'n1')?.is_read).toBe(true);
    expect(state.unreadCount).toBe(0);
  });

  it('markAsRead does nothing for already-read notification', () => {
    const store = useNotificationStore;
    store.setState({
      notifications: [
        { id: 'n1', is_read: true, type: 'test', created_at: new Date().toISOString(), user_id: 'u1', title: 'test', message: 'test' },
      ],
      unreadCount: 0,
    });

    act(() => {
      store.getState().markAsRead('n1');
    });

    expect(store.getState().unreadCount).toBe(0);
  });

  it('markAllAsRead marks all as read', () => {
    const store = useNotificationStore;
    store.setState({
      notifications: [
        { id: 'n1', is_read: false, type: 'test', created_at: new Date().toISOString(), user_id: 'u1', title: 'test1', message: 'test1' },
        { id: 'n2', is_read: false, type: 'test', created_at: new Date().toISOString(), user_id: 'u1', title: 'test2', message: 'test2' },
      ],
      unreadCount: 2,
    });

    act(() => {
      store.getState().markAllAsRead();
    });

    const state = store.getState();
    expect(state.notifications.every((n) => n.is_read)).toBe(true);
    expect(state.unreadCount).toBe(0);
  });

  it('clearAchievement resets lastUnlockedAchievement', () => {
    const store = useNotificationStore;
    store.setState({
      lastUnlockedAchievement: {
        notification_id: 'n1',
        id: 'a1',
        group_key: 'test',
        name: 'Test Achievement',
        description: 'Test desc',
        icon: 'sparkles',
        rarity: 'common',
        level: 1,
        max_level: 1,
        is_first_time: true,
        prev_level: 0,
      },
    });

    act(() => {
      store.getState().clearAchievement();
    });

    expect(store.getState().lastUnlockedAchievement).toBeNull();
  });

  it('cleanup resets all state', () => {
    const store = useNotificationStore;
    store.setState({
      notifications: [{ id: 'n1', is_read: false, type: 'test', created_at: new Date().toISOString(), user_id: 'u1', title: 'test', message: 'test' }],
      unreadCount: 5,
      initialized: true,
      offset: 10,
      hasMore: false,
    });

    act(() => {
      store.getState().cleanup();
    });

    const state = store.getState();
    expect(state.notifications).toEqual([]);
    expect(state.unreadCount).toBe(0);
    expect(state.initialized).toBe(false);
    expect(state.offset).toBe(0);
    expect(state.hasMore).toBe(true);
  });

  it('fetchMore does nothing when hasMore is false', async () => {
    const store = useNotificationStore;
    store.setState({ hasMore: false, isLoadingMore: false });

    await act(async () => {
      await store.getState().fetchMore();
    });

    expect(store.getState().isLoadingMore).toBe(false);
  });

  it('fetchMore does nothing when isLoadingMore is true', async () => {
    const store = useNotificationStore;
    store.setState({ hasMore: true, isLoadingMore: true });

    await act(async () => {
      await store.getState().fetchMore();
    });

    expect(store.getState().isLoadingMore).toBe(true);
  });
});
