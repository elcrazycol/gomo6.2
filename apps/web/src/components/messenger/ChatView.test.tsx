import { describe, it, expect, vi } from 'vitest';

// Re-implementing pure logic from ChatView.tsx for testing

type MessageView = {
  id: string;
  sender_user_id: string;
  sent_at: string;
  content: string;
  parent_message_id?: string | null;
};

const isConsecutive = (prev: MessageView | null, curr: MessageView): boolean => {
  return (
    prev != null &&
    prev.sender_user_id === curr.sender_user_id &&
    new Date(curr.sent_at).getTime() - new Date(prev.sent_at).getTime() < 120_000
  );
};

const getDateSeparator = (prev: MessageView | null, curr: MessageView, now: Date = new Date()): string | null => {
  const currDate = new Date(curr.sent_at).toDateString();
  if (prev && new Date(prev.sent_at).toDateString() === currDate) return null;

  const today = now.toDateString();
  const yesterday = new Date(now.getTime() - 86400000).toDateString();

  if (currDate === today) return "сегодня";
  if (currDate === yesterday) return "вчера";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(curr.sent_at));
};

const msg = (id: string, sender: string, sentAt: string, content = ''): MessageView => ({
  id, sender_user_id: sender, sent_at: sentAt, content,
});

describe('isConsecutive', () => {
  it('returns false when prev is null', () => {
    expect(isConsecutive(null, msg('1', 'u1', '2025-01-01T12:00:00Z'))).toBe(false);
  });

  it('returns true for same sender within 2 minutes', () => {
    const prev = msg('1', 'u1', '2025-01-01T12:00:00Z');
    const curr = msg('2', 'u1', '2025-01-01T12:01:00Z'); // 60s later
    expect(isConsecutive(prev, curr)).toBe(true);
  });

  it('returns false for same sender after 2+ minutes', () => {
    const prev = msg('1', 'u1', '2025-01-01T12:00:00Z');
    const curr = msg('2', 'u1', '2025-01-01T12:03:00Z'); // 180s later
    expect(isConsecutive(prev, curr)).toBe(false);
  });

  it('returns false for different senders', () => {
    const prev = msg('1', 'u1', '2025-01-01T12:00:00Z');
    const curr = msg('2', 'u2', '2025-01-01T12:00:30Z');
    expect(isConsecutive(prev, curr)).toBe(false);
  });

  it('returns true at exactly 119 seconds', () => {
    const prev = msg('1', 'u1', '2025-01-01T12:00:00Z');
    const curr = msg('2', 'u1', '2025-01-01T12:01:59Z'); // 119s
    expect(isConsecutive(prev, curr)).toBe(true);
  });

  it('returns false at exactly 120 seconds', () => {
    const prev = msg('1', 'u1', '2025-01-01T12:00:00Z');
    const curr = msg('2', 'u1', '2025-01-01T12:02:00Z'); // 120s
    expect(isConsecutive(prev, curr)).toBe(false);
  });

  it('returns true for immediate follow-up', () => {
    const prev = msg('1', 'u1', '2025-01-01T12:00:00Z');
    const curr = msg('2', 'u1', '2025-01-01T12:00:01Z');
    expect(isConsecutive(prev, curr)).toBe(true);
  });
});

describe('getDateSeparator', () => {
  const today = new Date('2025-06-20T14:00:00Z');

  it('returns null when prev is same day', () => {
    const prev = msg('1', 'u1', '2025-06-20T10:00:00Z');
    const curr = msg('2', 'u1', '2025-06-20T14:00:00Z');
    expect(getDateSeparator(prev, curr, today)).toBeNull();
  });

  it('returns "сегодня" when prev is null and message is today', () => {
    const curr = msg('2', 'u1', '2025-06-20T14:00:00Z');
    expect(getDateSeparator(null, curr, today)).toBe('сегодня');
  });

  it('returns "вчера" for yesterday messages', () => {
    const curr = msg('2', 'u1', '2025-06-19T14:00:00Z');
    expect(getDateSeparator(null, curr, today)).toBe('вчера');
  });

  it('returns formatted date for older messages', () => {
    const curr = msg('2', 'u1', '2025-06-15T14:00:00Z');
    const result = getDateSeparator(null, curr, today);
    expect(result).not.toBe('сегодня');
    expect(result).not.toBe('вчера');
    expect(result).toContain('15');
  });

  it('returns separator when prev is different day', () => {
    const prev = msg('1', 'u1', '2025-06-19T10:00:00Z');
    const curr = msg('2', 'u1', '2025-06-20T14:00:00Z');
    expect(getDateSeparator(prev, curr, today)).toBe('сегодня');
  });

  it('returns null when prev and curr are both today', () => {
    const prev = msg('1', 'u1', '2025-06-20T10:00:00Z');
    const curr = msg('2', 'u1', '2025-06-20T12:00:00Z');
    expect(getDateSeparator(prev, curr, today)).toBeNull();
  });
});
