export type WallReturnUnderlay = {
  node: HTMLElement;
  scrollY: number;
};

let captured: WallReturnUnderlay | null = null;

/**
 * Snapshots the page the user is leaving (the profile or feed) before opening
 * a wall post. The wall-post page reveals this frozen frame underneath while
 * the post is dragged back — the same idea as iOS Safari's swipe-back preview:
 * a static frame of the previous screen during the gesture, swapped for the
 * live page once the transition commits.
 */
export function captureWallReturnUnderlay(): void {
  clearWallReturnUnderlay();
  const source = document.getElementById("main-content");
  if (!source) return;

  const node = source.cloneNode(true) as HTMLElement;
  // The snapshot is inert and must not collide with the live page (duplicate
  // ids) or falsely satisfy the readiness poll used by the return transition.
  node.removeAttribute("id");
  node.removeAttribute("tabindex");
  node.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  node.querySelectorAll("[data-wall-return-ready]").forEach((el) => {
    el.removeAttribute("data-wall-return-ready");
  });

  const scrollY = typeof window !== "undefined" ? window.scrollY || 0 : 0;
  // The clone is the full page at its natural top; shift it up so the snapshot
  // reproduces whatever the user was actually looking at when they left.
  node.style.transform = `translate3d(0, ${-scrollY}px, 0)`;

  captured = { node, scrollY };
}

export function consumeWallReturnUnderlay(): WallReturnUnderlay | null {
  const value = captured;
  captured = null;
  return value;
}

export function clearWallReturnUnderlay(): void {
  captured = null;
}
