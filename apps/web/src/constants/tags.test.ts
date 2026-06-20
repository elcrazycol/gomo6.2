import { describe, it, expect } from 'vitest';
import {
  CONTENT_TAGS,
  FORMAT_TAGS,
  ATMOSPHERE_TAGS,
  FLAG_TAGS,
  getContentTagLabel,
  getFormatTagLabel,
  getAtmosphereTagLabel,
} from './tags';

describe('tag constants', () => {
  it('CONTENT_TAGS has correct entries', () => {
    expect(CONTENT_TAGS.length).toBe(8);
    expect(CONTENT_TAGS[0]).toEqual({ value: 'anime', label: 'Аниме' });
  });

  it('FORMAT_TAGS has correct entries', () => {
    expect(FORMAT_TAGS.length).toBe(6);
    expect(FORMAT_TAGS[0]).toEqual({ value: 'shitpost', label: 'Щитпост' });
  });

  it('ATMOSPHERE_TAGS has correct entries', () => {
    expect(ATMOSPHERE_TAGS.length).toBe(4);
    expect(ATMOSPHERE_TAGS[0]).toEqual({ value: 'serious', label: 'Серьёзно' });
  });

  it('FLAG_TAGS has correct entries', () => {
    expect(FLAG_TAGS.length).toBe(3);
    expect(FLAG_TAGS[0]).toEqual({ value: 'normal', label: 'Обычный' });
  });
});

describe('getContentTagLabel', () => {
  it('returns label for known value', () => {
    expect(getContentTagLabel('anime')).toBe('Аниме');
    expect(getContentTagLabel('games')).toBe('Игры');
    expect(getContentTagLabel('music')).toBe('Музыка');
  });

  it('returns value itself for unknown tag', () => {
    expect(getContentTagLabel('unknown')).toBe('unknown');
    expect(getContentTagLabel('')).toBe('');
  });
});

describe('getFormatTagLabel', () => {
  it('returns label for known value', () => {
    expect(getFormatTagLabel('shitpost')).toBe('Щитпост');
    expect(getFormatTagLabel('discussion')).toBe('Обсуждение');
    expect(getFormatTagLabel('question')).toBe('Вопрос');
  });

  it('returns value itself for unknown tag', () => {
    expect(getFormatTagLabel('unknown')).toBe('unknown');
  });
});

describe('getAtmosphereTagLabel', () => {
  it('returns label for known value', () => {
    expect(getAtmosphereTagLabel('serious')).toBe('Серьёзно');
    expect(getAtmosphereTagLabel('irony')).toBe('Ирония');
    expect(getAtmosphereTagLabel('vent')).toBe('Выплеск');
    expect(getAtmosphereTagLabel('doom')).toBe('Тьма');
  });

  it('returns value itself for unknown tag', () => {
    expect(getAtmosphereTagLabel('unknown')).toBe('unknown');
  });
});
