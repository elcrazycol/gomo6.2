import { describe, it, expect } from "vitest";
import {
  buildTrophies,
  compareTrophiesRarestFirst,
  formatOwnerShare,
  mapUserAchievementRaw,
  mapUserAwardRaw,
  ownerShareFor,
  trophyArt,
  trophyDescription,
  trophyFromAchievement,
  trophyFromAward,
  trophyName,
  trophyTier,
  type AchievementData,
  type Trophy,
  type UserAchievementRaw,
  type UserAwardRaw,
} from "./trophies";

function makeAchievement(overrides: Partial<AchievementData> = {}): AchievementData {
  return {
    id: "ach-1",
    group_key: "entries",
    name: "Писец",
    description: "25 записей",
    icon: "message-square",
    category: "content",
    level: 1,
    ...overrides,
  };
}

const translator = (key: string, options?: Record<string, unknown>) =>
  options && "count" in options ? `${key}:${String(options.count)}` : key;

describe("mapUserAchievementRaw", () => {
  it("maps the new catalog fields and the current level", () => {
    const raw: UserAchievementRaw = {
      current_level: 2,
      unlocked_at: "2026-01-02T00:00:00Z",
      achievements: {
        id: "ach-1",
        group_key: "entries",
        title: "achievements.entries.title",
        name: "achievements.entries.title",
        description: "achievements.entries.title",
        icon: "message-square",
        category: "content",
        kind: "milestone",
        origin: "code",
        image_url: "/img/group.png",
        level_images: { "1": "/img/1.png", "2": "/img/2.png" },
        owner_share: { "1": 10, "2": 2.5 },
        levels: [
          {
            level: 1,
            threshold: 25,
            name_key: "achievements.entries.1.name",
            description_key: "achievements.entries.1.description",
          },
          {
            level: 2,
            threshold: 100,
            name_key: "achievements.entries.2.name",
            description_key: "achievements.entries.2.description",
          },
        ],
      },
    };

    const a = mapUserAchievementRaw(raw);
    expect(a.kind).toBe("milestone");
    expect(a.origin).toBe("code");
    expect(a.level).toBe(2);
    expect(a.maxLevel).toBe(2);
    expect(a.locked).toBe(false);
    expect(a.level_images).toEqual({ "1": "/img/1.png", "2": "/img/2.png" });
    expect(a.owner_share).toEqual({ "1": 10, "2": 2.5 });
    expect(a.unlocked_at).toBe("2026-01-02T00:00:00Z");
  });

  it("falls back to a locked stub when the definition is missing", () => {
    const a = mapUserAchievementRaw({ current_level: 0 });
    expect(a.locked).toBe(true);
    expect(a.id).toBe("");
    expect(a.icon).toBe("sparkles");
  });
});

describe("mapUserAwardRaw", () => {
  it("maps author, reason and share", () => {
    const raw: UserAwardRaw = {
      id: "grant-1",
      award_key: "award_bughunter",
      awarded_at: "2026-02-01T00:00:00Z",
      awarded_by: "u-admin",
      awarded_by_username: "admin",
      reason: "Found the crash",
      award: {
        group_key: "award_bughunter",
        title: "achievements.award_bughunter.title",
        name: "achievements.award_bughunter.title",
        description: "achievements.award_bughunter.description",
        icon: "bug",
        origin: "code",
        image_url: "/a.png",
        owner_share: { "1": 0.5 },
      },
    };

    const w = mapUserAwardRaw(raw);
    expect(w.awardKey).toBe("award_bughunter");
    expect(w.awardedByUsername).toBe("admin");
    expect(w.reason).toBe("Found the crash");
    expect(w.awardedAt).toBe("2026-02-01T00:00:00Z");
    expect(w.imageUrl).toBe("/a.png");
    expect(w.ownerShare).toEqual({ "1": 0.5 });
  });
});

describe("trophyArt", () => {
  it("prefers the per-level upload", () => {
    expect(trophyArt("entries", 2, { "2": "/lvl2.png" }, "/group.png")).toBe("/lvl2.png");
  });

  it("falls back to the group image", () => {
    expect(trophyArt("entries", 3, { "2": "/lvl2.png" }, "/group.png")).toBe("/group.png");
  });

  it("falls back to the bundled registry", () => {
    expect(trophyArt("likes_received", 1)).toBe("/trophies/likes_received-1.png");
  });

  it("returns null when nothing has artwork", () => {
    expect(trophyArt("unknown", 1)).toBeNull();
  });
});

describe("owner share", () => {
  it("reads the share for a level", () => {
    expect(ownerShareFor({ "1": 0, "2": 2.5 }, 1)).toBe(0);
    expect(ownerShareFor({ "1": 0 }, 2)).toBeNull();
    expect(ownerShareFor(undefined, 1)).toBeNull();
  });

  it("maps shares to glow tiers, rarest first", () => {
    expect(trophyTier(0.4)).toBe("mythic");
    expect(trophyTier(2)).toBe("legendary");
    expect(trophyTier(5)).toBe("epic");
    expect(trophyTier(20)).toBe("rare");
    expect(trophyTier(55)).toBe("common");
    expect(trophyTier(null)).toBe("common");
  });

  it("formats a share with at most one decimal", () => {
    expect(formatOwnerShare(2.5, "en-US")).toBe("2.5%");
    expect(formatOwnerShare(10, "en-US")).toBe("10%");
    expect(formatOwnerShare(null)).toBeNull();
  });
});

describe("buildTrophies", () => {
  it("merges milestones and awards, rarest first, unknown shares last", () => {
    const rare = makeAchievement({ id: "a", level: 1, owner_share: { "1": 10 } });
    const unknown = makeAchievement({ id: "b", level: 1 });
    const award = mapUserAwardRaw({
      id: "g1",
      award_key: "award_ktitor",
      awarded_at: "2026-01-01T00:00:00Z",
      award: { group_key: "award_ktitor", owner_share: { "1": 0.5 } },
    });

    const trophies = buildTrophies([rare, unknown], [award]);
    expect(trophies.map((t) => t.kind)).toEqual(["award", "milestone", "milestone"]);
    expect(trophies[0].key).toBe("w:g1");
    expect(trophies[1].key).toBe("a:a");
    expect(trophies[2].ownerShare).toBeNull();
  });

  it("drops locked milestones", () => {
    const locked = makeAchievement({ locked: true, level: 0 });
    expect(buildTrophies([locked], [])).toEqual([]);
  });

  it("orders by share, then level, then unlock date", () => {
    const a: Trophy = { ...trophyFromAchievement(makeAchievement({ id: "a", level: 1, owner_share: { "1": 5 } })) };
    const b = trophyFromAchievement(makeAchievement({ id: "b", level: 3, owner_share: { "3": 5 } }));
    // Same share, higher level wins.
    expect(compareTrophiesRarestFirst(a, b)).toBeGreaterThan(0);
  });
});

describe("trophyName / trophyDescription", () => {
  it("uses the level name key for milestones", () => {
    const trophy = trophyFromAchievement(
      makeAchievement({
        levels: [
          {
            level: 1,
            threshold: 25,
            name_key: "achievements.entries.1.name",
            description_key: "achievements.entries.1.description",
          },
        ],
      }),
    );
    expect(trophyName(translator, trophy)).toBe("achievements.entries.1.name");
    expect(trophyDescription(translator, trophy)).toBe("achievements.entries.1.description");
  });

  it("formats the dynamic tenure term from the level", () => {
    const half = trophyFromAchievement(makeAchievement({ group_key: "tenure", level: 1 }));
    expect(trophyName(translator, half)).toBe("achievements.tenure.half");

    const years = trophyFromAchievement(makeAchievement({ group_key: "tenure", level: 3 }));
    expect(trophyName(translator, years)).toBe("achievements.tenure.years:2");
  });

  it("falls back to the award title when no level key exists", () => {
    const award = mapUserAwardRaw({
      id: "g1",
      award_key: "award_ktitor",
      awarded_at: "2026-01-01T00:00:00Z",
      award: { title: "Ктитор" },
    });
    expect(trophyName(translator, trophyFromAward(award))).toBe("Ктитор");
  });
});
