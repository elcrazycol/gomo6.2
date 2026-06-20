import { describe, it, expect } from 'vitest';
import { parseMessageLinks } from './MessageLinks';

describe('parseMessageLinks', () => {
  it('returns empty array for empty content', () => {
    expect(parseMessageLinks('')).toEqual([]);
  });

  it('returns text segment for plain text', () => {
    const result = parseMessageLinks('Hello world');
    expect(result).toEqual([{ type: 'text', content: 'Hello world' }]);
  });

  it('detects external URLs', () => {
    const result = parseMessageLinks('Check https://google.com for info');
    expect(result).toEqual([
      { type: 'text', content: 'Check ' },
      { type: 'link', url: 'https://google.com', linkType: 'external', params: {} },
      { type: 'text', content: ' for info' },
    ]);
  });

  it('detects profile links', () => {
    const result = parseMessageLinks('Visit https://gomo6.wtf/profile/user-123');
    expect(result).toEqual([
      { type: 'text', content: 'Visit ' },
      { type: 'link', url: 'https://gomo6.wtf/profile/user-123', linkType: 'profile', params: { userId: 'user-123' } },
    ]);
  });

  it('detects board links', () => {
    const result = parseMessageLinks('See https://gomo6.wtf/g/myboard');
    expect(result).toEqual([
      { type: 'text', content: 'See ' },
      { type: 'link', url: 'https://gomo6.wtf/g/myboard', linkType: 'board', params: { slug: 'myboard' } },
    ]);
  });

  it('detects thread links', () => {
    const result = parseMessageLinks('Look https://gomo6.wtf/g/myboard/thread/abc-123');
    expect(result).toEqual([
      { type: 'text', content: 'Look ' },
      { type: 'link', url: 'https://gomo6.wtf/g/myboard/thread/abc-123', linkType: 'thread', params: { slug: 'myboard', threadId: 'abc-123' } },
    ]);
  });

  it('detects invite links', () => {
    const result = parseMessageLinks('Join https://gomo6.wtf/g/myboard/join/INVITE_CODE');
    expect(result).toEqual([
      { type: 'text', content: 'Join ' },
      { type: 'link', url: 'https://gomo6.wtf/g/myboard/join/INVITE_CODE', linkType: 'invite', params: { slug: 'myboard', code: 'INVITE_CODE' } },
    ]);
  });

  it('handles multiple URLs', () => {
    const result = parseMessageLinks('A https://google.com and https://gomo6.wtf/profile/u1 B');
    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ type: 'text', content: 'A ' });
    expect(result[1].type).toBe('link');
    expect(result[2]).toEqual({ type: 'text', content: ' and ' });
    expect(result[3].type).toBe('link');
    expect(result[4]).toEqual({ type: 'text', content: ' B' });
  });

  it('handles text with no URLs', () => {
    const result = parseMessageLinks('No links here');
    expect(result).toEqual([{ type: 'text', content: 'No links here' }]);
  });
});
