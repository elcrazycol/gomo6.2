import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { POST_CARD_CLASS, PostCardShell } from "./PostCardChrome";

// Perf guard for the feed / wall / board cards.
//
// These lists paginate forever, so a long session adds hundreds of cards to the
// DOM. Off-screen cards skip layout and paint via `content-visibility: auto`,
// with `contain-intrinsic-size` supplying a placeholder height so the scrollbar
// does not jump. Both declarations are load-bearing: dropping either one
// silently brings back the full cost, so they are asserted here.
describe("POST_CARD_CLASS content-visibility", () => {
  it("skips rendering off-screen cards", () => {
    expect(POST_CARD_CLASS).toContain("[content-visibility:auto]");
  });

  it("reserves a placeholder size so the scrollbar stays stable", () => {
    expect(POST_CARD_CLASS).toContain("[contain-intrinsic-size:auto_300px]");
  });

  it("applies both declarations to the rendered card root", () => {
    const { container } = render(
      <PostCardShell>
        <span>card body</span>
      </PostCardShell>,
    );
    const root = container.firstElementChild as HTMLElement;

    expect(root.className).toContain("[content-visibility:auto]");
    expect(root.className).toContain("[contain-intrinsic-size:auto_300px]");
  });
});
