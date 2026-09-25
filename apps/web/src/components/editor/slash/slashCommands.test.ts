import { describe, expect, it } from "vitest";
import { filterSlashItems, slashItems } from "./slashCommands";

describe("filterSlashItems", () => {
  it("returns every command for an empty query", () => {
    expect(filterSlashItems("")).toHaveLength(slashItems.length);
  });

  it("filters by title", () => {
    expect(filterSlashItems("раздел").map((item) => item.key)).toEqual(["divider"]);
  });

  it("filters by keyword, case-insensitively", () => {
    expect(filterSlashItems("GALLERY").map((item) => item.key)).toEqual(["gallery"]);
    expect(filterSlashItems("видео").map((item) => item.key)).toEqual(["media"]);
    expect(filterSlashItems("ссылка").map((item) => item.key)).toEqual(["link"]);
  });

  it("returns nothing for an unknown query", () => {
    expect(filterSlashItems("zzz")).toHaveLength(0);
  });
});
