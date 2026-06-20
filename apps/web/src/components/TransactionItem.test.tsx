import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatRelativeTime } from './TransactionItem';

describe('formatRelativeTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "только что" for less than 1 minute ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T12:00:30Z'));
    expect(formatRelativeTime('2025-01-01T12:00:00Z')).toBe('только что');
  });

  it('returns minutes for less than 1 hour ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T12:05:00Z'));
    expect(formatRelativeTime('2025-01-01T12:00:00Z')).toBe('5 мин. назад');
  });

  it('returns hours for less than 24 hours ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T15:00:00Z'));
    expect(formatRelativeTime('2025-01-01T12:00:00Z')).toBe('3 ч. назад');
  });

  it('returns days for less than 7 days ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-04T12:00:00Z'));
    expect(formatRelativeTime('2025-01-01T12:00:00Z')).toBe('3 дн. назад');
  });

  it('returns date for 7+ days ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-08T12:00:00Z'));
    const result = formatRelativeTime('2025-01-01T12:00:00Z');
    expect(result).not.toBe('только что');
    expect(result).not.toMatch(/мин\.|ч\.|дн\./);
  });

  it('handles exactly 1 minute', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T12:01:00Z'));
    expect(formatRelativeTime('2025-01-01T12:00:00Z')).toBe('1 мин. назад');
  });

  it('handles exactly 1 hour', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T13:00:00Z'));
    expect(formatRelativeTime('2025-01-01T12:00:00Z')).toBe('1 ч. назад');
  });

  it('handles exactly 1 day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-02T12:00:00Z'));
    expect(formatRelativeTime('2025-01-01T12:00:00Z')).toBe('1 дн. назад');
  });

  it('handles exactly 59 minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T12:59:00Z'));
    expect(formatRelativeTime('2025-01-01T12:00:00Z')).toBe('59 мин. назад');
  });

  it('handles exactly 23 hours', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-02T11:00:00Z'));
    expect(formatRelativeTime('2025-01-01T12:00:00Z')).toBe('23 ч. назад');
  });
});
