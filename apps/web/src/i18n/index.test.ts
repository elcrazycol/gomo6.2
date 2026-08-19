import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n, { loadCommunityTranslations } from "./index";
import { LANGUAGES } from "./languages";

describe("community translation resources", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("ru");
    i18n.removeResourceBundle("uk", "translation");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            key: "settings.language",
            value: "Застаріле значення",
            votes: 1,
            created_at: "2026-08-20T12:00:00Z",
          },
          {
            key: "settings.language",
            value: "Мова",
            votes: 4,
            created_at: "2026-08-20T11:00:00Z",
          },
          {
            key: "settings.languageDescription",
            value: "Мова інтерфейсу. Переклади створюються спільнотою.",
            votes: 0,
            created_at: "2026-08-20T10:00:00Z",
          },
          {
            key: "common.save",
            value: "Зберегти старе",
            votes: 1,
            created_at: "2026-08-20T13:00:00Z",
          },
          {
            key: "common.save",
            value: "Зберегти",
            votes: 3,
            created_at: "2026-08-20T09:00:00Z",
          },
        ],
      }),
    }));
  });

  afterEach(async () => {
    await i18n.changeLanguage("ru");
    i18n.removeResourceBundle("uk", "translation");
    vi.unstubAllGlobals();
  });

  it("registers every picker language with i18next", () => {
    const configured = i18n.options.supportedLngs;
    const supported = new Set(Array.isArray(configured) ? configured.map(String) : []);
    for (const language of LANGUAGES) {
      expect(supported.has(language.code)).toBe(true);
    }
  });

  it("applies several Ukrainian keys and picks the highest-voted proposal", async () => {
    await i18n.changeLanguage("uk");
    await loadCommunityTranslations("uk");

    expect(i18n.t("settings.language")).toBe("Мова");
    expect(i18n.t("settings.languageDescription")).toBe("Мова інтерфейсу. Переклади створюються спільнотою.");
    expect(i18n.t("common.save")).toBe("Зберегти");
  });
});
