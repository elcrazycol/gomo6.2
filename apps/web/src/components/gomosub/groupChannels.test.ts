import { describe, expect, it } from "vitest";
import { groupChannels } from "./groupChannels";

const ch = (id: string, sort_order: number, extra: Record<string, unknown> = {}) => ({
  id, slug: id, name: id, sort_order, ...extra,
});

describe("groupChannels", () => {
  it("puts uncategorized first, then categories in order, then legacy buckets", () => {
    const channels = [
      ch("a", 0, { category_id: "c2", category: null }),
      ch("b", 1, { category_id: null, category: null }),
      ch("c", 2, { category_id: "c1", category: null }),
      ch("d", 3, { category_id: null, category: "Старое" }),
    ];
    const groups = groupChannels(channels, [
      { id: "c1", name: "Основное", sort_order: 0 },
      { id: "c2", name: "Флуд", sort_order: 1 },
    ]);
    expect(groups.map((g) => g.key)).toEqual(["", "cat:c1", "cat:c2", "legacy:Старое"]);
    expect(groups[0].channels.map((c) => c.id)).toEqual(["b"]);
    expect(groups[1].channels.map((c) => c.id)).toEqual(["c"]);
  });

  it("drops category_id pointing at unknown categories into legacy/uncategorized", () => {
    const groups = groupChannels([ch("x", 0, { category_id: "gone", category: null })], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("");
  });

  it("keeps channels sorted by sort_order inside groups", () => {
    const groups = groupChannels(
      [ch("b", 5, { category_id: null }), ch("a", 1, { category_id: null })],
      [],
    );
    expect(groups[0].channels.map((c) => c.id)).toEqual(["a", "b"]);
  });
});
