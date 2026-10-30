import { describe, expect, it } from "vitest";
import { applyTriState, buildOverwriteBody, canModerateTarget, memberRoleIds, memberTop, overwriteTriState } from "./permissions";

describe("overwriteTriState", () => {
  it("reads allow/deny first", () => {
    expect(overwriteTriState({ allow: { view_channel: true }, deny: {} }, "view_channel")).toBe("allow");
    expect(overwriteTriState({ allow: {}, deny: { send_messages: true } }, "send_messages")).toBe("deny");
    expect(overwriteTriState(undefined, "view_channel")).toBe("inherit");
  });

  it("falls back to legacy booleans", () => {
    expect(overwriteTriState({ can_read: false }, "view_channel")).toBe("deny");
    expect(overwriteTriState({ can_write: true }, "send_messages")).toBe("allow");
  });
});

describe("applyTriState", () => {
  it("deny wins over a previous allow", () => {
    const p = applyTriState({ allow: { view_channel: true }, deny: {} }, "view_channel", "deny");
    expect(p.deny.view_channel).toBe(true);
    expect(p.allow.view_channel).toBeUndefined();
    expect(p.can_read).toBe(false);
  });

  it("inherit clears both", () => {
    const p = applyTriState({ allow: { send_messages: true }, deny: {} }, "send_messages", "inherit");
    expect(p.allow.send_messages).toBeUndefined();
    expect(p.can_write).toBe(false);
  });
});

describe("memberTop", () => {
  const roles = [
    { id: "everyone", board_id: "b", name: "@everyone", color: "#666", position: 0, permissions: {}, is_everyone: true },
    { id: "mod", board_id: "b", name: "Мод", color: "#f00", position: 5, permissions: {} },
  ];
  it("plain member sits at 0, role holder at its position", () => {
    expect(memberTop({ user_id: "u", role_id: null }, roles, [])).toBe(0);
    expect(memberTop({ user_id: "u", role_id: null }, roles, [{ board_id: "b", user_id: "u", role_id: "mod" }])).toBe(5);
  });

  it("legacy role_id counts too", () => {
    expect(memberTop({ user_id: "u", role_id: "mod" }, roles, [])).toBe(5);
  });

  it("memberRoleIds unions both grant sources", () => {
    const ids = memberRoleIds(
      { user_id: "u", role_id: "a" },
      [{ board_id: "b", user_id: "u", role_id: "b2" }],
    );
    expect(ids.sort()).toEqual(["a", "b2"]);
  });
});

describe("buildOverwriteBody", () => {
  it("sets one side, keeps the other, syncs legacy", () => {
    const b = buildOverwriteBody(undefined, "view_channel", "allow");
    expect(b.allow).toEqual({ view_channel: true });
    expect(b.deny).toEqual({});
    expect(b.can_read).toBe(true);
    expect(b.can_write).toBe(false);
  });

  it("deny on send keeps an existing view allow", () => {
    const b = buildOverwriteBody({ allow: { view_channel: true }, deny: {} }, "send_messages", "deny");
    expect(b.allow).toEqual({ view_channel: true });
    expect(b.deny).toEqual({ send_messages: true });
    expect(b.can_read).toBe(true);
    expect(b.can_write).toBe(false);
  });

  it("inherit clears only its own side", () => {
    const b = buildOverwriteBody(
      { allow: { view_channel: true, send_messages: true }, deny: {} },
      "send_messages",
      "inherit",
    );
    expect(b.allow).toEqual({ view_channel: true });
    expect(b.can_read).toBe(true);
    expect(b.can_write).toBe(false);
  });
});

describe("canModerateTarget", () => {
  it("owner bypasses, nobody touches the owner", () => {
    expect(canModerateTarget({ isOwner: true, isAdmin: false, top: 0 }, 99, false)).toBe(true);
    expect(canModerateTarget({ isOwner: true, isAdmin: false, top: 0 }, 0, true)).toBe(false);
  });

  it("requires strictly higher top", () => {
    expect(canModerateTarget({ isOwner: false, isAdmin: false, top: 5 }, 5, false)).toBe(false);
    expect(canModerateTarget({ isOwner: false, isAdmin: false, top: 6 }, 5, false)).toBe(true);
    expect(canModerateTarget({ isOwner: false, isAdmin: true, top: 0 }, 99, false)).toBe(true);
  });
});
