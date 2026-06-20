import { describe, it, expect } from 'vitest';
import { formatDropsLabel } from './formatDropsLabel';

describe('formatDropsLabel', () => {
  it('returns "дропс" for 1', () => {
    expect(formatDropsLabel(1)).toBe('дропс');
  });

  it('returns "дропс" for -1', () => {
    expect(formatDropsLabel(-1)).toBe('дропс');
  });

  it('returns "дропса" for 2-4', () => {
    expect(formatDropsLabel(2)).toBe('дропса');
    expect(formatDropsLabel(3)).toBe('дропса');
    expect(formatDropsLabel(4)).toBe('дропса');
  });

  it('returns "дропсов" for 5-20', () => {
    expect(formatDropsLabel(5)).toBe('дропсов');
    expect(formatDropsLabel(10)).toBe('дропсов');
    expect(formatDropsLabel(11)).toBe('дропсов');
    expect(formatDropsLabel(12)).toBe('дропсов');
    expect(formatDropsLabel(20)).toBe('дропсов');
  });

  it('returns "дропс" for 21, 31, 41', () => {
    expect(formatDropsLabel(21)).toBe('дропс');
    expect(formatDropsLabel(31)).toBe('дропс');
    expect(formatDropsLabel(41)).toBe('дропс');
  });

  it('returns "дропса" for 22-24, 32-34', () => {
    expect(formatDropsLabel(22)).toBe('дропса');
    expect(formatDropsLabel(23)).toBe('дропса');
    expect(formatDropsLabel(24)).toBe('дропса');
    expect(formatDropsLabel(32)).toBe('дропса');
  });

  it('returns "дропсов" for 111, 112', () => {
    expect(formatDropsLabel(111)).toBe('дропсов');
    expect(formatDropsLabel(112)).toBe('дропсов');
  });

  it('handles zero', () => {
    expect(formatDropsLabel(0)).toBe('дропсов');
  });

  it('handles large numbers', () => {
    expect(formatDropsLabel(1001)).toBe('дропс');
    expect(formatDropsLabel(1002)).toBe('дропса');
    expect(formatDropsLabel(1005)).toBe('дропсов');
  });
});
