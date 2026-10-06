import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { ProfileHeader } from "./ProfileHeader";
import type { Profile } from "./types";

vi.mock("@/components/AdminBadge", () => ({ AdminBadge: () => null }));
vi.mock("@/components/FriendButton", () => ({ FriendButton: () => null }));
vi.mock("@/components/NicknameEmoji", () => ({ NicknameEmoji: () => null }));
vi.mock("@/components/OnlineStatus", () => ({ OnlineStatus: () => null }));
vi.mock("@/components/UserAvatar", () => ({ UserAvatar: () => null }));
vi.mock("@/components/AvatarUploadProgress", () => ({ AvatarUploadProgress: () => null }));

const baseProfile: Profile = {
  id: "u1",
  username: "demo",
  display_name: "Демо Аккаунт",
  bio: null,
  is_anonymous: false,
  thread_count: 0,
  post_count: 0,
  wall_post_count: 0,
  comment_count: 0,
  likes_received_count: 0,
  views_received_count: 0,
  garma: 0,
  drops: 0,
  created_at: "2026-01-01T00:00:00Z",
};

type HeaderProps = React.ComponentProps<typeof ProfileHeader>;

function renderHeader(overrides: Partial<HeaderProps> = {}) {
  const props: HeaderProps = {
    profile: baseProfile,
    isOwnProfile: true,
    isEditing: false,
    avatarVisible: true,
    avatarUrl: null,
    avatarUploading: false,
    avatarUploadPercent: 0,
    isAvatarDragging: false,
    avatarDragHandlers: {} as HeaderProps["avatarDragHandlers"],
    newDisplayName: "",
    onNewDisplayNameChange: vi.fn(),
    customization: null,
    nicknameEmojiId: null,
    showOnlineStatus: false,
    currentUser: { id: "u1" },
    onAvatarClick: vi.fn(),
    onAvatarUpload: vi.fn(),
    onNicknameEmojiSelect: vi.fn(),
    onNicknameEmojiRemove: vi.fn(),
    onEditClick: vi.fn(),
    onUsernameClick: vi.fn(),
    onOpenMessages: vi.fn(),
    ...overrides,
  };
  return render(<ProfileHeader {...props} />);
}

const name = () => document.querySelector("h1") as HTMLElement;
const usernameButton = () =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "@demo") as HTMLButtonElement;

describe("ProfileHeader nickname", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies the owner's nickname CSS to the display name", () => {
    renderHeader({
      customization: { username_css: "color: rgb(255, 45, 149)", profile_badge_text: null, profile_badge_css: null, background_url: null },
    });

    expect(name().style.color).toBe("rgb(255, 45, 149)");
  });

  // A white text-shadow used to be layered on the name whenever the profile had
  // a banner, to keep it readable over the image. With a gradient nickname
  // (background-clip: text + -webkit-text-fill-color: transparent) that blur is
  // painted ON TOP of the glyphs, so every gradient nickname rendered washed
  // out. Legibility now comes from a scrim on the banner itself.
  it("never paints a halo over the display name", () => {
    renderHeader({
      customization: {
        username_css:
          "background: linear-gradient(90deg, #667eea, #764ba2); -webkit-background-clip: text; -webkit-text-fill-color: transparent",
        profile_badge_text: null,
        profile_badge_css: null,
        background_url: null,
      },
    });

    expect(name().style.textShadow).toBe("");
    expect(getComputedStyle(name()).textShadow).toBe("");
    expect(name().getAttribute("style") ?? "").not.toContain("text-shadow");
  });

  it("never paints a halo over the @username either", () => {
    renderHeader();

    expect(usernameButton().className).not.toContain("text-shadow");
  });

  it("keeps the halo guard meaningful in jsdom", () => {
    // Positive control for the assertions above: jsdom does round-trip
    // text-shadow, so `.not.toContain("text-shadow")` cannot pass vacuously.
    const el = document.createElement("div");
    el.style.textShadow = "0 1px 3px rgba(255,255,255,0.75)";
    expect(el.style.textShadow).not.toBe("");
  });

  it("falls back to the username when the display name is blank", () => {
    renderHeader({ profile: { ...baseProfile, display_name: "   " } });

    expect(name().textContent).toBe("demo");
  });
});
