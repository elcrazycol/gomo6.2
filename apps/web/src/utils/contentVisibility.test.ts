import { describe, it, expect, vi, beforeEach } from "vitest";
import { processVisibilityTags } from "./contentVisibility";

const mockFrom = vi.fn();
vi.mock("@/integrations/api/compat", () => ({
  api: {
    from: (...args: any[]) => mockFrom(...args),
  },
}));

function makeChain<T>(resolveValue: T): any {
  const p = Promise.resolve(resolveValue) as any;
  p.select = () => p;
  p.eq = () => p;
  p.single = () => p;
  return p;
}

const defaultOpts = {
  currentUserId: "user-1",
  isAdmin: false,
  currentUsername: "alice",
  postAuthorId: "author-1",
};

describe("processVisibilityTags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockImplementation((table: string) => {
      if (table === "profiles") return makeChain({ data: null, error: null });
      return makeChain({ data: null, error: null });
    });
  });

  it("returns content as-is when no tags present", async () => {
    const result = await processVisibilityTags("Hello world", defaultOpts);
    expect(result.processedContent).toBe("Hello world");
    expect(result.isHidden).toBe(false);
  });

  it("returns empty content unchanged", async () => {
    const result = await processVisibilityTags("", defaultOpts);
    expect(result.processedContent).toBe("");
    expect(result.isHidden).toBe(false);
  });

  it("returns null content unchanged", async () => {
    const result = await processVisibilityTags(null as any, defaultOpts);
    expect(result.processedContent).toBe(null);
  });

  it("replaces [dude][/dude] with DUDE_LINK marker", async () => {
    const result = await processVisibilityTags("[dude][/dude] said hi", defaultOpts);
    expect(result.processedContent).toContain("__DUDE_LINK__");
  });

  it("replaces [me]...[/me] with ME_LINK marker", async () => {
    const result = await processVisibilityTags("[me]Author name[/me] posted", defaultOpts);
    expect(result.processedContent).toContain("__ME_LINK__Author name__");
  });

  it("hides [adm]...[/adm] content for non-admin", async () => {
    const result = await processVisibilityTags("[adm]secret admin text[/adm]", { ...defaultOpts, isAdmin: false });
    expect(result.processedContent).not.toContain("secret admin text");
    expect(result.isHidden).toBe(true);
    expect(result.hiddenReason).toBe("adm");
  });

  it("shows [adm]...[/adm] content for admin", async () => {
    const result = await processVisibilityTags("[adm]admin only[/adm]", { ...defaultOpts, isAdmin: true });
    expect(result.processedContent).toContain("admin only");
    expect(result.isHidden).toBe(false);
  });

  it("shows [adm]...[/adm] for post author", async () => {
    const result = await processVisibilityTags("[adm]author content[/adm]", { ...defaultOpts, currentUserId: "author-1" });
    expect(result.processedContent).toContain("author content");
  });

  it("processes [seeusers=...]...[/seeusers] tag", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "profiles") return makeChain({ data: { id: "user-1", username: "alice" }, error: null });
      return makeChain({ data: null, error: null });
    });

    const result = await processVisibilityTags("[seeusers=alice]secret content[/seeusers]", defaultOpts);
    expect(result.processedContent).toContain("secret content");
  });

  it("hides [seeusers=...] for unauthorized user", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "profiles") return makeChain({ data: { id: "other-user", username: "bob" }, error: null });
      return makeChain({ data: null, error: null });
    });

    const result = await processVisibilityTags("[seeusers=bob]secret content[/seeusers]", defaultOpts);
    expect(result.processedContent).not.toContain("secret content");
    expect(result.hasHiddenParts).toBe(true);
  });

  it("processes [nousers=...] tag - hides from specified user", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "profiles") return makeChain({ data: { id: "user-1", username: "alice" }, error: null });
      return makeChain({ data: null, error: null });
    });

    const result = await processVisibilityTags("[nousers=alice]hidden from alice[/nousers]", defaultOpts);
    expect(result.processedContent).not.toContain("hidden from alice");
    expect(result.hasHiddenParts).toBe(true);
  });

  it("shows [nousers=...] content for non-specified user", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "profiles") return makeChain({ data: { id: "other-user", username: "bob" }, error: null });
      return makeChain({ data: null, error: null });
    });

    const result = await processVisibilityTags("[nousers=bob]visible to alice[/nousers]", defaultOpts);
    expect(result.processedContent).toContain("visible to alice");
  });

  it("handles mixed tags in content", async () => {
    const content = "Before [dude][/dude] middle [adm]admin only[/adm] after";
    const result = await processVisibilityTags(content, { ...defaultOpts, isAdmin: false });
    expect(result.processedContent).toContain("__DUDE_LINK__");
    expect(result.processedContent).not.toContain("admin only");
    expect(result.processedContent).toContain("Before");
    expect(result.processedContent).toContain("after");
  });

  it("returns empty result for [adm] with no content", async () => {
    const result = await processVisibilityTags("[adm][/adm] rest", { ...defaultOpts, isAdmin: false });
    expect(result.processedContent).toContain("rest");
  });
});
