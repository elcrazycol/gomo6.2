import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EmojiInline } from './EmojiInline';

const mockEmojis = new Map([
  ['test-id', { id: 'test-id', pack_id: 'pack1', name: 'test emoji', image_url: '/test.webp', is_animated: false }],
]);

vi.mock('@/contexts/EmojiDataContext', () => ({
  useEmojiData: () => ({
    allEmojis: mockEmojis,
    resolveEmojis: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/utils/storage', () => ({
  storageUrl: (bucket: string, key: string) => `https://example.com/${bucket}/${key}`,
}));

describe('EmojiInline', () => {
  it('renders emoji by id', () => {
    render(<EmojiInline emojiId="test-id" />);
    const img = screen.getByAltText('test emoji');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/emojis//test.webp');
  });

  it('renders legacy code as text', () => {
    render(<EmojiInline code="smile" />);
    expect(screen.getByText(':smile:')).toBeInTheDocument();
  });

  it('renders fallback when emoji not found after resolve', async () => {
    render(<EmojiInline emojiId="unknown-id" />);
    // After resolve completes, emoji is still not in map, so shows [?]
    const { findByText } = screen;
    const fallback = await findByText('[?]');
    expect(fallback).toBeInTheDocument();
  });
});
