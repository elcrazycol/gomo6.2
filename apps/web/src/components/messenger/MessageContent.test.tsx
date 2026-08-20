import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { parseGiftContent, MessageContent } from './MessageContent';
import type { Attachment } from './types';

vi.mock('@/components/share/ShareCard', () => ({
  ShareCard: ({ target }: any) => (
    <div data-testid="share-card" data-type={target.type} data-id={target.id} />
  ),
}));

describe('parseGiftContent', () => {
  it('parses valid gift content', () => {
    const result = parseGiftContent('__GIFT__:gift-123:Розовый единорог:gifts/unicorn.png');
    expect(result).toEqual({
      giftId: 'gift-123',
      giftName: 'Розовый единорог',
      imageUrl: 'gifts/unicorn.png',
    });
  });

  it('parses gift with empty imageUrl', () => {
    const result = parseGiftContent('__GIFT__:gift-456:Подарок:');
    expect(result).toEqual({
      giftId: 'gift-456',
      giftName: 'Подарок',
      imageUrl: '',
    });
  });

  it('parses gift with complex name', () => {
    const result = parseGiftContent('__GIFT__:abc:Gift with spaces and emojis 🎉:img.png');
    expect(result).toEqual({
      giftId: 'abc',
      giftName: 'Gift with spaces and emojis 🎉',
      imageUrl: 'img.png',
    });
  });

  it('returns null for non-gift content', () => {
    expect(parseGiftContent('Hello world')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseGiftContent('')).toBeNull();
  });

  it('returns null for partial gift format', () => {
    expect(parseGiftContent('__GIFT__:gift-123')).toBeNull();
    expect(parseGiftContent('__GIFT__:gift-123:name')).toBeNull();
  });

  it('returns null for content without __GIFT__ prefix', () => {
    expect(parseGiftContent('GIFT__:id:name:url')).toBeNull();
  });
});

function makeImageAttachment(url: string, id: string): Attachment {
  return {
    id,
    url,
    type: 'image',
    name: `${id}.jpg`,
    size: 1000,
    mime: 'image/jpeg',
    meta: JSON.stringify({ width: 800, height: 600 }),
  };
}

describe('MessageContent share token', () => {
  it('renders a ShareCard for a __SHARE__ token', () => {
    const { container } = render(<MessageContent content="__SHARE__:thread:t-123" />);
    const card = container.querySelector('[data-testid="share-card"]');
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute('data-type', 'thread');
    expect(card).toHaveAttribute('data-id', 't-123');
    expect(screen.queryByText('__SHARE__:thread:t-123')).not.toBeInTheDocument();
  });

  it('renders a ShareCard for a wall share token', () => {
    const { container } = render(<MessageContent content="__SHARE__:wall:w-9" />);
    const card = container.querySelector('[data-testid="share-card"]');
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute('data-type', 'wall');
  });

  it('does not render a ShareCard for plain text', () => {
    const { container } = render(<MessageContent content="обычный текст" />);
    expect(container.querySelector('[data-testid="share-card"]')).not.toBeInTheDocument();
  });
});

describe('MessageContent media mosaic', () => {
  it('renders every photo in a six-item album mosaic', () => {
    const { container } = render(
      <MessageContent
        content=""
        attachments={[makeImageAttachment('a.jpg', 'a'), makeImageAttachment('b.jpg', 'b')]}
      />,
    );
    const mosaic = container.querySelector('.msg-media-mosaic');
    expect(mosaic).toBeInTheDocument();
    expect(mosaic).toHaveClass('mosaic-count-2');
    expect(container.querySelectorAll('.msg-media-mosaic-tile')).toHaveLength(2);
    expect(container.querySelector('.is-media-grid')).not.toBeInTheDocument();
  });

  it('renders a six-photo mosaic without hiding any tile', () => {
    const attachments = Array.from({ length: 6 }, (_, index) => makeImageAttachment(`${index}.jpg`, `${index}`));
    const { container } = render(<MessageContent content="" attachments={attachments} />);
    expect(container.querySelector('.msg-media-mosaic')).toHaveClass('mosaic-count-6');
    expect(container.querySelectorAll('.msg-media-mosaic-tile')).toHaveLength(6);
  });

  it('keeps a single photo in the stable single-attachment renderer', () => {
    const { container } = render(
      <MessageContent content="" attachments={[makeImageAttachment('a.jpg', 'a')]} />,
    );
    expect(container.querySelector('.msg-media-mosaic')).not.toBeInTheDocument();
    expect(container.querySelector('.msg-attachment-image')).toBeInTheDocument();
  });

  it('opens the lightbox from a carousel slide and closes on Escape', async () => {
    render(
      <MessageContent
        content=""
        attachments={[makeImageAttachment('a.jpg', 'a'), makeImageAttachment('b.jpg', 'b')]}
      />,
    );
    const tiles = document.body.querySelectorAll('.msg-media-mosaic-tile');
    fireEvent.click(tiles[1]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('opens the lightbox from a single photo', async () => {
    render(<MessageContent content="" attachments={[makeImageAttachment('a.jpg', 'a')]} />);
    const openButton = document.body.querySelector('.msg-attachment-open');
    expect(openButton).toBeInTheDocument();
    fireEvent.click(openButton!);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});
