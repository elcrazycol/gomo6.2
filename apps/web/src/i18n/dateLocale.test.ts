import { describe, expect, it } from "vitest";
import { uk, ru } from "date-fns/locale";
import { getDateLocale, getIntlLanguage } from "./dateLocale";

describe("date locale mapping", () => {
  it("uses Ukrainian date-fns locale instead of the Russian fallback", () => {
    expect(getDateLocale("uk")).toBe(uk);
    expect(getDateLocale("ru")).toBe(ru);
  });

  it("normalizes language tags for Intl while preserving regional Chinese", () => {
    expect(getIntlLanguage("uk-UA")).toBe("uk");
    expect(getIntlLanguage("zh-TW")).toBe("zh-CN");
  });
});
