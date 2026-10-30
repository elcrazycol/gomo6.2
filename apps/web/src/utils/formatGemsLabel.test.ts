import { describe, it, expect } from 'vitest';
import { formatGemsLabel } from './formatGemsLabel';

describe('formatGemsLabel', () => {
  it('returns "гем" for 1', () => {
    expect(formatGemsLabel(1)).toBe('гем');
  });

  it('returns "гем" for -1', () => {
    expect(formatGemsLabel(-1)).toBe('гем');
  });

  it('returns "гема" for 2-4', () => {
    expect(formatGemsLabel(2)).toBe('гема');
    expect(formatGemsLabel(3)).toBe('гема');
    expect(formatGemsLabel(4)).toBe('гема');
  });

  it('returns "гемов" for 5-20', () => {
    expect(formatGemsLabel(5)).toBe('гемов');
    expect(formatGemsLabel(10)).toBe('гемов');
    expect(formatGemsLabel(11)).toBe('гемов');
    expect(formatGemsLabel(12)).toBe('гемов');
    expect(formatGemsLabel(20)).toBe('гемов');
  });

  it('returns "гем" for 21, 31, 41', () => {
    expect(formatGemsLabel(21)).toBe('гем');
    expect(formatGemsLabel(31)).toBe('гем');
    expect(formatGemsLabel(41)).toBe('гем');
  });

  it('returns "гема" for 22-24, 32-34', () => {
    expect(formatGemsLabel(22)).toBe('гема');
    expect(formatGemsLabel(23)).toBe('гема');
    expect(formatGemsLabel(24)).toBe('гема');
    expect(formatGemsLabel(32)).toBe('гема');
  });

  it('returns "гемов" for 111, 112', () => {
    expect(formatGemsLabel(111)).toBe('гемов');
    expect(formatGemsLabel(112)).toBe('гемов');
  });

  it('returns "гемов" for 0', () => {
    expect(formatGemsLabel(0)).toBe('гемов');
  });

  it('handles large numbers', () => {
    expect(formatGemsLabel(1001)).toBe('гем');
    expect(formatGemsLabel(1002)).toBe('гема');
    expect(formatGemsLabel(1005)).toBe('гемов');
  });
});
