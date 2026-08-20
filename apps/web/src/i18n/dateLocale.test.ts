import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { uk, ru } from "date-fns/locale";
import i18n from "./index";
import { getDateLocale, getIntlLanguage, useDateLocale } from "./dateLocale";

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

describe("useDateLocale", () => {
  it("follows the requested language even when its resource bundle is empty", async () => {
    // Non-bundled languages (uk, …) ship with an empty resource bundle until
    // community translations load. In that state i18next resolves the fallback
    // ("ru"), which used to make dates flip back to Russian while the UI text
    // stayed on the chosen language. Dates must follow the user's choice.
    await i18n.changeLanguage("uk");
    expect(i18n.language).toBe("uk");
    expect(i18n.resolvedLanguage).toBe("ru"); // fallback-resolved, but ignored

    const { result } = renderHook(() => useDateLocale());
    expect(result.current).toBe(uk);
  });
});
