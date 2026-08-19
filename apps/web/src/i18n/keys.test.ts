import { describe, it, expect } from "vitest";
import { getSourceKeys, getNamespaces, pluralFormKey } from "./keys";

describe("getSourceKeys", () => {
  it("flattens namespaced keys into dotted keys", () => {
    const keys = getSourceKeys();
    const byKey = new Map(keys.map((k) => [k.key, k]));
    expect(byKey.get("common.save")?.source).toBe("Сохранить");
    expect(byKey.get("nav.settings")?.source).toBe("Настройки");
  });

  it("groups plural forms under a single base key", () => {
    const keys = getSourceKeys();
    const posts = keys.find((k) => k.key === "common.posts");
    expect(posts).toBeDefined();
    expect(posts?.plural).toBe(true);
    const forms = posts?.forms.map((f) => f.form) ?? [];
    expect(forms).toContain("one");
    expect(forms).toContain("few");
    expect(forms).toContain("many");
  });

  it("reports the storage key for each plural form", () => {
    expect(pluralFormKey("common.posts", "one")).toBe("common.posts_one");
    expect(pluralFormKey("common.posts", "few")).toBe("common.posts_few");
  });

  it("lists every namespace", () => {
    const namespaces = getNamespaces();
    expect(namespaces).toContain("common");
    expect(namespaces).toContain("nav");
    expect(namespaces).toContain("auth");
    expect(namespaces).toContain("settings");
  });
});
