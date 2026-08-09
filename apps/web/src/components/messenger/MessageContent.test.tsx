import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { parseGiftContent, MessageContent } from './MessageContent';
import type { Attachment } from './types';

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

describe('MessageContent media carousel', () => {
  it('renders a swipeable carousel for multi-photo messages', () => {
    const { container } = render(
      <MessageContent
        content=""
        attachments={[makeImageAttachment('a.jpg', 'a'), makeImageAttachment('b.jpg', 'b')]}
      />,
    );
    expect(container.querySelector('.msg-media-carousel')).toBeInTheDocument();
    expect(container.querySelector('.msg-media-counter')).toHaveTextContent('1 / 2');
    expect(container.querySelectorAll('.msg-media-slide')).toHaveLength(2);
    expect(container.querySelector('.is-media-grid')).not.toBeInTheDocument();
  });

  it('keeps a single photo as a plain attachment, not a carousel', () => {
    const { container } = render(
      <MessageContent content="" attachments={[makeImageAttachment('a.jpg', 'a')]} />,
    );
    expect(container.querySelector('.msg-media-carousel')).not.toBeInTheDocument();
    expect(container.querySelector('.msg-attachment-image')).toBeInTheDocument();
  });

  it('opens the lightbox from a carousel slide and closes on Escape', async () => {
    render(
      <MessageContent
        content=""
        attachments={[makeImageAttachment('a.jpg', 'a'), makeImageAttachment('b.jpg', 'b')]}
      />,
    );
    const slides = document.body.querySelectorAll('.msg-media-slide-open');
    fireEvent.click(slides[1]);
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
