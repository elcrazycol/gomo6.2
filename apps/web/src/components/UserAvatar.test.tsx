import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { UserAvatar } from "./UserAvatar";
import { useAvatarOverrideStore } from "@/stores/avatarOverrideStore";

describe("UserAvatar", () => {
  beforeEach(() => {
    useAvatarOverrideStore.setState({ overrides: {} });
  });

  it("renders the given src", () => {
    render(<UserAvatar src="blob:stored" userId="u1" alt="A" />);
    expect(screen.getByAltText("A")).toHaveAttribute("src", "blob:stored");
  });

  it("shows a pending local upload for that user instead of the stored src", () => {
    useAvatarOverrideStore
      .getState()
      .setAvatarOverride("u1", { url: "blob:fresh", animated: false });
    render(<UserAvatar src="blob:stored" userId="u1" alt="A" />);
    expect(screen.getByAltText("A")).toHaveAttribute("src", "blob:fresh");
  });

  it("ignores overrides belonging to another user", () => {
    useAvatarOverrideStore
      .getState()
      .setAvatarOverride("u2", { url: "blob:fresh", animated: false });
    render(<UserAvatar src="blob:stored" userId="u1" alt="A" />);
    expect(screen.getByAltText("A")).toHaveAttribute("src", "blob:stored");
  });

  it("ignores overrides when no userId is given", () => {
    useAvatarOverrideStore
      .getState()
      .setAvatarOverride("u1", { url: "blob:fresh", animated: false });
    render(<UserAvatar src="blob:stored" alt="A" />);
    expect(screen.getByAltText("A")).toHaveAttribute("src", "blob:stored");
  });

  it("renders a clip (not an image) when an animated upload is pending", () => {
    useAvatarOverrideStore
      .getState()
      .setAvatarOverride("u1", { url: "blob:clip", animated: true });
    const { container } = render(<UserAvatar src="blob:stored" userId="u1" alt="A" />);
    // The clip's src is attached lazily by AnimatedVideo once it is near the
    // viewport; here we only assert the animated branch was chosen.
    expect(container.querySelector("video")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("falls back to the stored src once the override is cleared", () => {
    const store = useAvatarOverrideStore.getState();
    store.setAvatarOverride("u1", { url: "blob:fresh", animated: false });
    const { rerender } = render(<UserAvatar src="blob:stored" userId="u1" alt="A" />);
    expect(screen.getByAltText("A")).toHaveAttribute("src", "blob:fresh");

    store.clearAvatarOverride("u1");
    rerender(<UserAvatar src="blob:stored" userId="u1" alt="A" />);
    expect(screen.getByAltText("A")).toHaveAttribute("src", "blob:stored");
  });
});
