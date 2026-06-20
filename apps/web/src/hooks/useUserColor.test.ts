import { describe, it, expect } from 'vitest';
import { extractColor } from './useUserColor';

describe('extractColor', () => {
  it('returns empty string for empty data', () => {
    expect(extractColor([])).toBe('');
  });

  it('returns empty string when no username_color achievements', () => {
    expect(extractColor([
      { reward_type: 'garma', reward_value: '10' },
      { reward_type: 'badge', reward_value: 'gold' },
    ])).toBe('');
  });

  it('returns purple (highest priority)', () => {
    expect(extractColor([
      { reward_type: 'username_color', reward_value: 'green' },
      { reward_type: 'username_color', reward_value: 'purple' },
    ])).toBe('purple');
  });

  it('returns first matching priority color', () => {
    expect(extractColor([
      { reward_type: 'username_color', reward_value: 'gold' },
    ])).toBe('gold');
  });

  it('prefers higher priority colors', () => {
    expect(extractColor([
      { reward_type: 'username_color', reward_value: 'blue' },
      { reward_type: 'username_color', reward_value: 'orange' },
    ])).toBe('orange');
  });

  it('returns cyan for lowest priority color', () => {
    expect(extractColor([
      { reward_type: 'username_color', reward_value: 'cyan' },
    ])).toBe('cyan');
  });

  it('ignores non-username_color types', () => {
    expect(extractColor([
      { reward_type: 'garma', reward_value: '100' },
      { reward_type: 'username_color', reward_value: 'red' },
      { reward_type: 'badge', reward_value: 'diamond' },
    ])).toBe('red');
  });

  it('handles unknown color values', () => {
    expect(extractColor([
      { reward_type: 'username_color', reward_value: 'unknown' },
    ])).toBe('');
  });
});
