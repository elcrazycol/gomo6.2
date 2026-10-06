import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { formatShortRelativeTime } from "./relativeTimeShort";

const NOW = new Date("2026-09-26T12:00:00Z");

/** A date `ms` milliseconds before the frozen "now". */
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("formatShortRelativeTime", () => {
  it("says 'сейчас' for anything under a minute (and for future skew)", () => {
    expect(formatShortRelativeTime(ago(0), "ru")).toBe("сейчас");
    expect(formatShortRelativeTime(ago(44 * SECOND), "ru")).toBe("сейчас");
    // A clock skewed into the future must not render a negative number.
    expect(formatShortRelativeTime(new Date(NOW.getTime() + 5000), "ru")).toBe("сейчас");
  });

  it("uses minutes, hours and days", () => {
    expect(formatShortRelativeTime(ago(5 * MINUTE), "ru")).toBe("5м");
    expect(formatShortRelativeTime(ago(59 * MINUTE), "ru")).toBe("59м");
    expect(formatShortRelativeTime(ago(3 * HOUR), "ru")).toBe("3ч");
    expect(formatShortRelativeTime(ago(23 * HOUR), "ru")).toBe("23ч");
    expect(formatShortRelativeTime(ago(DAY), "ru")).toBe("1д");
    expect(formatShortRelativeTime(ago(6 * DAY), "ru")).toBe("6д");
  });

  it("uses weeks, months and years for older posts", () => {
    expect(formatShortRelativeTime(ago(10 * DAY), "ru")).toBe("1нед");
    expect(formatShortRelativeTime(ago(3 * MONTH), "ru")).toBe("3мес");
    expect(formatShortRelativeTime(ago(2 * YEAR), "ru")).toBe("2г");
  });

  it("returns English abbreviations for English", () => {
    expect(formatShortRelativeTime(ago(30 * SECOND), "en")).toBe("now");
    expect(formatShortRelativeTime(ago(5 * MINUTE), "en")).toBe("5m");
    expect(formatShortRelativeTime(ago(2 * DAY), "en")).toBe("2d");
    expect(formatShortRelativeTime(ago(2 * YEAR), "en")).toBe("2y");
  });

  it("falls back to Russian for languages without their own table", () => {
    expect(formatShortRelativeTime(ago(5 * MINUTE), "de")).toBe("5м");
    expect(formatShortRelativeTime(ago(5 * MINUTE))).toBe("5м");
  });

  it("returns an empty string for an unparseable date", () => {
    expect(formatShortRelativeTime("not a date", "ru")).toBe("");
  });
});
