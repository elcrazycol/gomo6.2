/**
 * jsdom (CI) has no Element.animate: taps must never throw, the ceremony
 * state advances anyway. Guards the unhandled-rejection failure that turned
 * CI shard 1/2 red while every test stayed green.
 */
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MotionConfig } from "motion/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChestOpenModal } from "./ChestOpenModal";

vi.mock("@/hooks/useTransitionStyle", () => ({ useMotionOff: () => false }));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const TRACE = [
  { type: "failed", rarity: "common", attempts_left: 4 },
  { type: "upgraded", rarity: "unusual", attempts_left: 5 },
  { type: "opened", rarity: "unusual", attempts_left: 0 },
];

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            rarities: [
              { rarity: "common", color: "#9ca3af", image_url: "/c.png", opened_image_url: "/c_o.png" },
              { rarity: "unusual", color: "#22c55e", image_url: "/u.png", opened_image_url: "/u_o.png" },
            ],
            mechanics: [{ key: "rarity_chest", config: { attempts_per_tier: 5 } }],
          },
        }),
      text: () => Promise.resolve("{}"),
    }),
  );
});

describe("ChestOpenModal without WAAPI", () => {
  it("replays the trace without throwing when Element.animate is missing", async () => {
    const proto = window.Element.prototype as any;
    const realAnimate = proto.animate;
    const realGetAnimations = proto.getAnimations;
    delete proto.animate;
    delete proto.getAnimations;
    try {
      const errors: unknown[] = [];
      const onError = (e: ErrorEvent) => errors.push(e.error);
      window.addEventListener("error", onError);
      try {
        render(
          <MotionConfig reducedMotion="never">
            <ChestOpenModal
              title="Сундук"
              openChest={() => Promise.resolve({ rarity: "unusual", drops: 60, steps: TRACE })}
              onApplied={() => {}}
              onExpired={() => {}}
              onClose={() => {}}
            />
          </MotionConfig>,
        );
        const dialog = await screen.findByRole("dialog");
        const chest = within(dialog).getByRole("button", { name: /Осталось попыток/ });
        fireEvent.click(chest);
        fireEvent.click(chest);
        fireEvent.click(chest);
        await waitFor(() => expect(within(dialog).getByText("+60")).toBeInTheDocument());
      } finally {
        window.removeEventListener("error", onError);
      }
      expect(errors).toHaveLength(0);
    } finally {
      if (realAnimate) proto.animate = realAnimate;
      if (realGetAnimations) proto.getAnimations = realGetAnimations;
    }
  });
});
