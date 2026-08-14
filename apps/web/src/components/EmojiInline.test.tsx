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

  it('renders a neutral placeholder when emoji is not yet known', () => {
    render(<EmojiInline emojiId="unknown-id" />);
    // Unknown emoji renders a subtle placeholder box, never a raw [?] — the
    // record is resolved via resolveEmojis and replaces it once it arrives.
    expect(screen.getByTestId('emoji-inline-placeholder')).toBeInTheDocument();
    expect(screen.queryByText('[?]')).not.toBeInTheDocument();
  });
});
