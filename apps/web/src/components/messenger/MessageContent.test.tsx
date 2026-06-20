import { describe, it, expect } from 'vitest';
import { parseGiftContent } from './MessageContent';

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
