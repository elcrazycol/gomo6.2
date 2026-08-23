import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { from, channel, removeChannel, clearQueryCache } from './query-builder';

vi.mock('./client', () => ({
  apiClient: {
    rawRequest: vi.fn().mockResolvedValue({ success: true, data: [], error: null }),
  },
}));

import { apiClient } from './client';
const mockRawRequest = vi.mocked(apiClient.rawRequest);

beforeEach(() => {
  vi.clearAllMocks();
  // The GET cache is module-level; without this, entries from one test would
  // leak into the next (same URL → cached response → rawRequest not called).
  clearQueryCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('query-builder: channel', () => {
  it('returns subscribe/unsubscribe stub', () => {
    const ch = channel('test');
    const sub = ch.on('event', {}, () => {}).subscribe();
    expect(typeof sub.unsubscribe).toBe('function');
  });

  it('removeChannel is a no-op', () => {
    expect(() => removeChannel({})).not.toThrow();
  });
});

describe('query-builder: from().select()', () => {
  it('builds basic select URL', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [{ id: 1 }], error: null });

    const result = await from('posts').select('*');
    expect(mockRawRequest).toHaveBeenCalledTimes(1);
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toMatch(/^\/api\/v1\/posts/);
  });

  it('passes eq filter', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [], error: null });

    await from('posts').select('*').eq('thread_id', 't1');
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('thread_id=eq.t1');
  });

  it('passes neq filter', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [], error: null });

    await from('posts').select('*').neq('user_id', 'u1');
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('user_id=neq.u1');
  });

  it('passes is filter', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [], error: null });

    await from('posts').select('*').is('deleted_at', null);
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('deleted_at=is.null');
  });

  it('passes like filter', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [], error: null });

    await from('posts').select('*').like('content', '%hello%');
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('content=like.%25hello%25');
  });

  it('passes gt/gte/lt/lte filters', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [], error: null });

    await from('posts').select('*').gt('likes', 5).lt('likes', 100);
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('likes=gt.5');
    expect(url).toContain('likes=lt.100');
  });

  it('passes in filter', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [], error: null });

    await from('posts').select('*').in('id', ['a', 'b', 'c']);
    const url = mockRawRequest.mock.calls[0][0] as string;
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('id=in.(a,b,c)');
  });

  it('passes or filter', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [], error: null });

    await from('posts').select('*').or('user_id.eq.u1,user_id.eq.u2');
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('or=');
  });

  it('sets order clause', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [], error: null });

    await from('posts').select('*').order('created_at', { ascending: false });
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('order=created_at.desc');
  });

  it('sets ascending order by default', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [], error: null });

    await from('posts').select('*').order('name');
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('order=name.asc');
  });

  it('sets limit', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [], error: null });

    await from('posts').select('*').limit(10);
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('limit=10');
  });

  it('sets range (offset + limit)', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [], error: null });

    await from('posts').select('*').range(20, 29);
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('offset=20');
    expect(url).toContain('limit=10');
  });

  it('sets cursor (keyset pagination)', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [], error: null, has_more: false, next_cursor: null });

    await from('posts').select('*').cursor('2025-01-01T00:00:00Z::post-1');
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('cursor=2025-01-01T00%3A00%3A00Z%3A%3Apost-1');
  });

  it('single() flattens array response', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [{ id: 1, name: 'test' }], error: null });

    const result = await from('posts').select('*').single();
    expect(result.data).toEqual({ id: 1, name: 'test' });
    expect(result.error).toBeNull();
  });

  it('single() returns null data for empty array', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [], error: null });

    const result = await from('posts').select('*').single();
    expect(result.data).toBeNull();
  });

  it('maybeSingle() returns first item', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [{ id: 1 }], error: null });

    const result = await from('posts').select('*').maybeSingle();
    expect(result.data).toEqual({ id: 1 });
  });

  it('maybeSingle() returns null for empty array', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [], error: null });

    const result = await from('posts').select('*').maybeSingle();
    expect(result.data).toBeNull();
  });

  it('custom select columns', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [], error: null });

    await from('posts').select('id,content');
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('select=');
    expect(url).toContain('id');
    expect(url).toContain('content');
  });

  it('chained filters work together', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [], error: null });

    await from('posts').select('*').eq('board_id', 'b1').eq('is_deleted', false).order('created_at', { ascending: false }).limit(20);
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('board_id=eq.b1');
    expect(url).toContain('is_deleted=eq.false');
    expect(url).toContain('order=created_at.desc');
    expect(url).toContain('limit=20');
  });

  it('count option', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [{ id: 1 }, { id: 2 }], error: null });

    const result = await from('posts').select('*', { count: 'exact' });
    expect(result.count).toBe(2);
  });

  it('count with head option returns null data', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [{ id: 1 }], error: null });

    const result = await from('posts').select('*', { count: 'exact', head: true });
    expect(result.data).toBeNull();
    expect(result.count).toBe(1);
  });
});

describe('query-builder: from().insert()', () => {
  it('sends POST request', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: { id: 'new-id' }, error: null });

    const result = await from('posts').insert({ content: 'hello' }).single();
    expect(mockRawRequest).toHaveBeenCalledTimes(1);
    const opts = mockRawRequest.mock.calls[0][1] as RequestInit;
    expect(opts.method).toBe('POST');
    expect(opts.body).toBe(JSON.stringify({ content: 'hello' }));
    expect(result.data).toEqual({ id: 'new-id' });
  });
});

describe('query-builder: from().update()', () => {
  it('sends PUT request with eq filter', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: { id: '1' }, error: null });

    await from('posts').update({ content: 'edited' }).eq('id', '1');
    const url = mockRawRequest.mock.calls[0][0] as string;
    const opts = mockRawRequest.mock.calls[0][1] as RequestInit;
    expect(opts.method).toBe('PUT');
    expect(url).toContain('/api/v1/posts/1');
  });
});

describe('query-builder: from().delete()', () => {
  it('sends DELETE request', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: null, error: null });

    await from('posts').delete().eq('id', '1');
    const url = mockRawRequest.mock.calls[0][0] as string;
    const opts = mockRawRequest.mock.calls[0][1] as RequestInit;
    expect(opts.method).toBe('DELETE');
    expect(url).toContain('id=eq.1');
  });
});

describe('query-builder: not filter', () => {
  it('passes not filter', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [], error: null });

    await from('posts').select('*').not('status', 'eq', 'deleted');
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('status=not.eq.deleted');
  });
});

describe('query-builder: boolean encoding', () => {
  it('encodes boolean true/false', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [], error: null });

    await from('posts').select('*').eq('is_active', true).eq('is_deleted', false);
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('is_active=eq.true');
    expect(url).toContain('is_deleted=eq.false');
  });

  it('encodes null values', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [], error: null });

    await from('posts').select('*').eq('deleted_at', null);
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('deleted_at=eq.null');
  });
});

describe('query-builder: special table routing', () => {
  it('routes thread_likes POST to /like endpoint', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: { liked: true }, error: null });

    await from('thread_likes').insert({ thread_id: 't1' });
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/threads/t1/like');
  });

  it('routes post_likes POST to /like endpoint', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: { liked: true }, error: null });

    await from('post_likes').insert({ post_id: 'p1' });
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/posts/p1/like');
  });

  it('routes thread_likes DELETE to /like endpoint', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: null, error: null });

    await from('thread_likes').delete().eq('thread_id', 't1');
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/threads/t1/like');
  });
});

describe('query-builder: GET cache', () => {
  it('serves repeated identical GETs from cache without re-requesting', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [{ id: 1 }], error: null });

    await from('posts').select('*').eq('thread_id', 't1');
    await from('posts').select('*').eq('thread_id', 't1');

    expect(mockRawRequest).toHaveBeenCalledTimes(1);
  });

  it('deduplicates parallel identical GETs into a single request', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [{ id: 1 }], error: null });

    await Promise.all([
      from('posts').select('*').eq('thread_id', 't1'),
      from('posts').select('*').eq('thread_id', 't1'),
    ]);

    expect(mockRawRequest).toHaveBeenCalledTimes(1);
  });

  it('returns a deep clone so callers cannot poison the cache', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [{ id: 1, tags: ['a'] }], error: null });

    const first = await from('posts').select('*').eq('id', 'p1');
    (first.data as Array<{ id: number; tags: string[] }>)[0].tags.push('mutated');

    const second = await from('posts').select('*').eq('id', 'p1');
    expect((second.data as Array<{ id: number; tags: string[] }>)[0].tags).toEqual(['a']);
  });

  it('does not cache errored responses', async () => {
    mockRawRequest.mockResolvedValueOnce({ success: false, data: null, error: 'boom' });
    mockRawRequest.mockResolvedValueOnce({ success: true, data: [{ id: 1 }], error: null });

    const first = await from('posts').select('*').eq('thread_id', 't1');
    expect(first.error).toBeTruthy();

    const second = await from('posts').select('*').eq('thread_id', 't1');
    expect(mockRawRequest).toHaveBeenCalledTimes(2);
    expect(second.data).toEqual([{ id: 1 }]);
  });

  it('invalidates the table cache on writes', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [{ id: 1 }], error: null });

    await from('posts').select('*').eq('thread_id', 't1');
    await from('posts').update({ content: 'edited' }).eq('id', 'p1');
    await from('posts').select('*').eq('thread_id', 't1');

    // First GET cached, write invalidates, second GET must re-fetch.
    expect(mockRawRequest).toHaveBeenCalledTimes(3);
  });

  it('invalidates thread cache when a thread_likes write happens', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [], error: null });

    await from('threads').select('*').eq('id', 't1');
    await from('thread_likes').insert({ thread_id: 't1' });
    await from('threads').select('*').eq('id', 't1');

    expect(mockRawRequest).toHaveBeenCalledTimes(3);
  });

  it('does not cache count/head probes', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [{ id: 1 }], error: null });

    await from('posts').select('*', { count: 'exact' });
    await from('posts').select('*', { count: 'exact' });

    expect(mockRawRequest).toHaveBeenCalledTimes(2);
  });

  it('caches rarely-changing tables (boards) for 5 minutes', async () => {
    vi.useFakeTimers();
    mockRawRequest.mockResolvedValue({ success: true, data: [{ id: 1 }], error: null });

    await from('boards').select('*').eq('id', 'b1');
    vi.advanceTimersByTime(4 * 60 * 1000); // 4 min — still within TTL
    await from('boards').select('*').eq('id', 'b1');

    expect(mockRawRequest).toHaveBeenCalledTimes(1);
  });

  it('refetches hot tables (posts) after the short 5s TTL', async () => {
    vi.useFakeTimers();
    mockRawRequest.mockResolvedValue({ success: true, data: [{ id: 1 }], error: null });

    await from('posts').select('*').eq('id', 'p1');
    vi.advanceTimersByTime(6 * 1000); // 6s — past the 5s TTL
    await from('posts').select('*').eq('id', 'p1');

    expect(mockRawRequest).toHaveBeenCalledTimes(2);
  });

  it('keeps hot tables cached within their short TTL', async () => {
    vi.useFakeTimers();
    mockRawRequest.mockResolvedValue({ success: true, data: [{ id: 1 }], error: null });

    await from('posts').select('*').eq('id', 'p1');
    vi.advanceTimersByTime(3 * 1000); // 3s — within the 5s TTL
    await from('posts').select('*').eq('id', 'p1');

    expect(mockRawRequest).toHaveBeenCalledTimes(1);
  });

  it('allows overriding the per-table TTL via from(table, { ttlMs })', async () => {
    vi.useFakeTimers();
    mockRawRequest.mockResolvedValue({ success: true, data: [{ id: 1 }], error: null });

    await from('posts', { ttlMs: 60 * 1000 }).select('*').eq('id', 'p1');
    vi.advanceTimersByTime(30 * 1000); // 30s — would exceed the 5s default, not the override
    await from('posts', { ttlMs: 60 * 1000 }).select('*').eq('id', 'p1');

    expect(mockRawRequest).toHaveBeenCalledTimes(1);
  });

  it('caches profiles for the full 5-minute TTL (hover cards / walls / member lists)', async () => {
    vi.useFakeTimers();
    mockRawRequest.mockResolvedValue({ success: true, data: [{ id: 'u1', username: 'alice' }], error: null });

    await from('profiles').select('*').eq('id', 'u1');
    vi.advanceTimersByTime(4 * 60 * 1000); // 4min — within the 5min profiles TTL
    await from('profiles').select('*').eq('id', 'u1');

    expect(mockRawRequest).toHaveBeenCalledTimes(1);
  });

  it('caches user_achievements within the 60s TTL (hover cards / color hook)', async () => {
    vi.useFakeTimers();
    mockRawRequest.mockResolvedValue({ success: true, data: [{ id: 'a1', user_id: 'u1' }], error: null });

    await from('user_achievements').select('*').eq('user_id', 'u1');
    vi.advanceTimersByTime(45 * 1000); // 45s — within the 60s TTL
    await from('user_achievements').select('*').eq('user_id', 'u1');

    expect(mockRawRequest).toHaveBeenCalledTimes(1);
  });

  it('lets online-status reads override the 5-min profiles TTL via ttlMs', async () => {
    vi.useFakeTimers();
    mockRawRequest.mockResolvedValue({ success: true, data: [{ id: 'u1', is_online: true }], error: null });

    await from('profiles', { ttlMs: 30 * 1000 }).select('id, is_online, last_seen').eq('id', 'u1');
    vi.advanceTimersByTime(60 * 1000); // 1min — past the 30s override, within the 5min default
    await from('profiles', { ttlMs: 30 * 1000 }).select('id, is_online, last_seen').eq('id', 'u1');

    expect(mockRawRequest).toHaveBeenCalledTimes(2);
  });

  it('invalidates the threads cache when a posts write happens (post_count)', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [], error: null });

    await from('threads').select('*').eq('id', 't1');
    await from('posts').update({ content: 'edited' }).eq('id', 'p1');
    await from('threads').select('*').eq('id', 't1');

    expect(mockRawRequest).toHaveBeenCalledTimes(3);
  });

  it('invalidates the friends cache when a friend_requests write happens', async () => {
    mockRawRequest.mockResolvedValue({ success: true, data: [], error: null });

    await from('friends').select('*').eq('user_id', 'u1');
    await from('friend_requests').update({ status: 'accepted' }).eq('id', 'fr1');
    await from('friends').select('*').eq('user_id', 'u1');

    expect(mockRawRequest).toHaveBeenCalledTimes(3);
  });
});
