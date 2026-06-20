import { describe, it, expect } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('merges class names', () => {
    const result = cn('foo', 'bar');
    expect(result).toBe('foo bar');
  });

  it('handles falsy values', () => {
    const result = cn('foo', false, null, undefined, 0, '');
    expect(result).toBe('foo');
  });

  it('handles conditional classes', () => {
    const isActive = true;
    const result = cn('base', isActive && 'active', !isActive && 'inactive');
    expect(result).toBe('base active');
  });

  it('resolves Tailwind conflicts', () => {
    const result = cn('px-4', 'px-8');
    expect(result).toBe('px-8');
  });

  it('handles empty input', () => {
    expect(cn()).toBe('');
  });

  it('handles arrays', () => {
    const result = cn(['foo', 'bar'], 'baz');
    expect(result).toBe('foo bar baz');
  });
});
