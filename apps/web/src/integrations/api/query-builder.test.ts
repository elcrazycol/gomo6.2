import { describe, it, expect, vi, beforeEach } from 'vitest';
import { from, channel, removeChannel } from './query-builder';

vi.mock('./client', () => ({
  apiClient: {
    rawRequest: vi.fn().mockResolvedValue({ data: [], error: null }),
  },
}));

import { apiClient } from './client';
const mockRawRequest = vi.mocked(apiClient.rawRequest);

beforeEach(() => {
  vi.clearAllMocks();
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
    mockRawRequest.mockResolvedValue({ data: [{ id: 1 }], error: null });

    const result = await from('posts').select('*');
    expect(mockRawRequest).toHaveBeenCalledTimes(1);
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toMatch(/^\/api\/v1\/posts/);
  });

  it('passes eq filter', async () => {
    mockRawRequest.mockResolvedValue({ data: [], error: null });

    await from('posts').select('*').eq('thread_id', 't1');
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('thread_id=eq.t1');
  });

  it('passes neq filter', async () => {
    mockRawRequest.mockResolvedValue({ data: [], error: null });

    await from('posts').select('*').neq('user_id', 'u1');
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('user_id=neq.u1');
  });

  it('passes is filter', async () => {
    mockRawRequest.mockResolvedValue({ data: [], error: null });

    await from('posts').select('*').is('deleted_at', null);
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('deleted_at=is.null');
  });

  it('passes like filter', async () => {
    mockRawRequest.mockResolvedValue({ data: [], error: null });

    await from('posts').select('*').like('content', '%hello%');
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('content=like.%25hello%25');
  });

  it('passes gt/gte/lt/lte filters', async () => {
    mockRawRequest.mockResolvedValue({ data: [], error: null });

    await from('posts').select('*').gt('likes', 5).lt('likes', 100);
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('likes=gt.5');
    expect(url).toContain('likes=lt.100');
  });

  it('passes in filter', async () => {
    mockRawRequest.mockResolvedValue({ data: [], error: null });

    await from('posts').select('*').in('id', ['a', 'b', 'c']);
    const url = mockRawRequest.mock.calls[0][0] as string;
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('id=in.(a,b,c)');
  });

  it('passes or filter', async () => {
    mockRawRequest.mockResolvedValue({ data: [], error: null });

    await from('posts').select('*').or('user_id.eq.u1,user_id.eq.u2');
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('or=');
  });

  it('sets order clause', async () => {
    mockRawRequest.mockResolvedValue({ data: [], error: null });

    await from('posts').select('*').order('created_at', { ascending: false });
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('order=created_at.desc');
  });

  it('sets ascending order by default', async () => {
    mockRawRequest.mockResolvedValue({ data: [], error: null });

    await from('posts').select('*').order('name');
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('order=name.asc');
  });

  it('sets limit', async () => {
    mockRawRequest.mockResolvedValue({ data: [], error: null });

    await from('posts').select('*').limit(10);
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('limit=10');
  });

  it('sets range (offset + limit)', async () => {
    mockRawRequest.mockResolvedValue({ data: [], error: null });

    await from('posts').select('*').range(20, 29);
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('offset=20');
    expect(url).toContain('limit=10');
  });

  it('single() flattens array response', async () => {
    mockRawRequest.mockResolvedValue({ data: [{ id: 1, name: 'test' }], error: null });

    const result = await from('posts').select('*').single();
    expect(result.data).toEqual({ id: 1, name: 'test' });
    expect(result.error).toBeNull();
  });

  it('single() returns null data for empty array', async () => {
    mockRawRequest.mockResolvedValue({ data: [], error: null });

    const result = await from('posts').select('*').single();
    expect(result.data).toBeNull();
  });

  it('maybeSingle() returns first item', async () => {
    mockRawRequest.mockResolvedValue({ data: [{ id: 1 }], error: null });

    const result = await from('posts').select('*').maybeSingle();
    expect(result.data).toEqual({ id: 1 });
  });

  it('maybeSingle() returns null for empty array', async () => {
    mockRawRequest.mockResolvedValue({ data: [], error: null });

    const result = await from('posts').select('*').maybeSingle();
    expect(result.data).toBeNull();
  });

  it('custom select columns', async () => {
    mockRawRequest.mockResolvedValue({ data: [], error: null });

    await from('posts').select('id,content');
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('select=');
    expect(url).toContain('id');
    expect(url).toContain('content');
  });

  it('chained filters work together', async () => {
    mockRawRequest.mockResolvedValue({ data: [], error: null });

    await from('posts').select('*').eq('board_id', 'b1').eq('is_deleted', false).order('created_at', { ascending: false }).limit(20);
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('board_id=eq.b1');
    expect(url).toContain('is_deleted=eq.false');
    expect(url).toContain('order=created_at.desc');
    expect(url).toContain('limit=20');
  });

  it('count option', async () => {
    mockRawRequest.mockResolvedValue({ data: [{ id: 1 }, { id: 2 }], error: null });

    const result = await from('posts').select('*', { count: 'exact' });
    expect(result.count).toBe(2);
  });

  it('count with head option returns null data', async () => {
    mockRawRequest.mockResolvedValue({ data: [{ id: 1 }], error: null });

    const result = await from('posts').select('*', { count: 'exact', head: true });
    expect(result.data).toBeNull();
    expect(result.count).toBe(1);
  });
});

describe('query-builder: from().insert()', () => {
  it('sends POST request', async () => {
    mockRawRequest.mockResolvedValue({ data: { id: 'new-id' }, error: null });

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
    mockRawRequest.mockResolvedValue({ data: { id: '1' }, error: null });

    await from('posts').update({ content: 'edited' }).eq('id', '1');
    const url = mockRawRequest.mock.calls[0][0] as string;
    const opts = mockRawRequest.mock.calls[0][1] as RequestInit;
    expect(opts.method).toBe('PUT');
    expect(url).toContain('/api/v1/posts/1');
  });
});

describe('query-builder: from().delete()', () => {
  it('sends DELETE request', async () => {
    mockRawRequest.mockResolvedValue({ data: null, error: null });

    await from('posts').delete().eq('id', '1');
    const url = mockRawRequest.mock.calls[0][0] as string;
    const opts = mockRawRequest.mock.calls[0][1] as RequestInit;
    expect(opts.method).toBe('DELETE');
    expect(url).toContain('id=eq.1');
  });
});

describe('query-builder: not filter', () => {
  it('passes not filter', async () => {
    mockRawRequest.mockResolvedValue({ data: [], error: null });

    await from('posts').select('*').not('status', 'eq', 'deleted');
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('status=not.eq.deleted');
  });
});

describe('query-builder: boolean encoding', () => {
  it('encodes boolean true/false', async () => {
    mockRawRequest.mockResolvedValue({ data: [], error: null });

    await from('posts').select('*').eq('is_active', true).eq('is_deleted', false);
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('is_active=eq.true');
    expect(url).toContain('is_deleted=eq.false');
  });

  it('encodes null values', async () => {
    mockRawRequest.mockResolvedValue({ data: [], error: null });

    await from('posts').select('*').eq('deleted_at', null);
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('deleted_at=eq.null');
  });
});

describe('query-builder: special table routing', () => {
  it('routes thread_likes POST to /like endpoint', async () => {
    mockRawRequest.mockResolvedValue({ data: { liked: true }, error: null });

    await from('thread_likes').insert({ thread_id: 't1' });
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/threads/t1/like');
  });

  it('routes post_likes POST to /like endpoint', async () => {
    mockRawRequest.mockResolvedValue({ data: { liked: true }, error: null });

    await from('post_likes').insert({ post_id: 'p1' });
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/posts/p1/like');
  });

  it('routes thread_likes DELETE to /like endpoint', async () => {
    mockRawRequest.mockResolvedValue({ data: null, error: null });

    await from('thread_likes').delete().eq('thread_id', 't1');
    const url = mockRawRequest.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/threads/t1/like');
  });
});
