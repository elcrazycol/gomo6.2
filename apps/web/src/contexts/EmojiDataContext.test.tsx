import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReactNode } from 'react';
import { EmojiDataProvider, useEmojiData } from './EmojiDataContext';

// The provider fetches the current user and the user's emoji subscriptions on
// mount. Stub all of it so the test exercises resolveEmojis in isolation.
const mockRawRequest = vi.fn();
const mockRpc = vi.fn();
const mockGetUser = vi.fn();

vi.mock('@/integrations/api/client', () => ({
  apiClient: {
    rawRequest: (...args: unknown[]) => mockRawRequest(...args),
    getCurrentUser: () => Promise.resolve(null),
  },
}));

vi.mock('@/integrations/api/compat', () => ({
  api: {
    auth: {
      getUser: () => mockGetUser(),
    },
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

vi.mock('@/utils/emojiCache', () => ({
  loadEmojiCache: () => null,
  saveEmojiCache: () => {},
}));

// TanStack Query is used for the shared auth query; give it a real client.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><EmojiDataProvider>{children}</EmojiDataProvider></QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Signed-in user so the subscriptions fetch path runs (and fails fast).
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u-1' } } });
  mockRawRequest.mockRejectedValue(new Error('Rate limit exceeded. Please slow down.'));
  mockRpc.mockRejectedValue(new Error('Rate limit exceeded. Please slow down.'));
});

describe('EmojiDataContext resolveEmojis failure', () => {
  it('marks ids as failed on error so components stop re-requesting', async () => {
    const { result } = renderHook(() => useEmojiData(), { wrapper });

    await act(async () => {
      await result.current.resolveEmojis(['emoji-1']);
    });

    // A failed resolve must record the id as failed — otherwise every render
    // of EmojiInline/CustomEmojiNode re-fires the request (REST + RPC = 2
    // requests per emoji per render), turning a 429 into a self-sustaining
    // storm that burns the global rate-limit budget.
    await waitFor(() => {
      expect(result.current.failedEmojiIds.has('emoji-1')).toBe(true);
    });

    // Subsequent calls with the same id are no-ops (no network traffic).
    const callsBefore = mockRawRequest.mock.calls.length + mockRpc.mock.calls.length;
    await act(async () => {
      await result.current.resolveEmojis(['emoji-1']);
    });
    expect(mockRawRequest.mock.calls.length + mockRpc.mock.calls.length).toBe(callsBefore);
  });

  it('still resolves emojis when the REST path succeeds', async () => {
    mockRawRequest.mockResolvedValue({
      data: [{ id: 'emoji-2', pack_id: 'p', name: 'e', image_url: '/e.webp', is_animated: false }],
    });

    const { result } = renderHook(() => useEmojiData(), { wrapper });

    await act(async () => {
      await result.current.resolveEmojis(['emoji-2']);
    });

    await waitFor(() => {
      expect(result.current.allEmojis.has('emoji-2')).toBe(true);
    });
    expect(result.current.failedEmojiIds.has('emoji-2')).toBe(false);
  });
});
