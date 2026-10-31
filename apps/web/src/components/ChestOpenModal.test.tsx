import { StrictMode } from "react";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MotionConfig } from "motion/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChestOpenModal } from "./ChestOpenModal";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const TRACE = [
  { type: "failed", rarity: "common", attempts_left: 4 },
  { type: "upgraded", rarity: "unusual", attempts_left: 5 },
  { type: "opened", rarity: "unusual", attempts_left: 0 },
];

function setupCatalog() {
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
}

function renderModal(openChest: () => Promise<any>, strict = false) {
  const onApplied = vi.fn();
  const onExpired = vi.fn();
  const onClose = vi.fn();
  const ui = (
    <MotionConfig reducedMotion="always">
      <ChestOpenModal
        title="Сундук"
        openChest={openChest}
        onApplied={onApplied}
        onExpired={onExpired}
        onClose={onClose}
      />
    </MotionConfig>
  );
  render(strict ? <StrictMode>{ui}</StrictMode> : ui);
  return { onApplied, onExpired, onClose };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("ChestOpenModal", () => {
  it("plays on mount, replays the trace tap by tap, locks exit until opened", async () => {
    setupCatalog();
    const openChest = vi.fn(() =>
      Promise.resolve({ rarity: "unusual", drops: 60, steps: TRACE }),
    );
    const { onApplied, onClose } = renderModal(openChest);

    // The single secure call fires on mount and credits at once.
    await waitFor(() => expect(openChest).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(60));

    const dialog = await screen.findByRole("dialog");
    const chest = within(dialog).getByRole("button", { name: /Осталось попыток: 5 из 5/ });

    // No backing out mid-ceremony: backdrop clicks and Escape do nothing.
    fireEvent.click(dialog);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(chest);
    await waitFor(() =>
      within(dialog).getByRole("button", { name: /Осталось попыток: 4 из 5/ }),
    );
    fireEvent.click(chest);
    await waitFor(() =>
      within(dialog).getByRole("button", { name: /Осталось попыток: 5 из 5/ }),
    );
    fireEvent.click(chest);
    await waitFor(() => expect(within(dialog).getByText("+60")).toBeInTheDocument());

    // Only now does any click dismiss.
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1); // catalog only
  });

  it("fires the play call exactly once under StrictMode double-mount and delivers the result", async () => {
    setupCatalog();
    const openChest = vi.fn(() =>
      Promise.resolve({ rarity: "common", drops: 20, steps: [{ type: "opened", rarity: "common", attempts_left: 0 }] }),
    );
    const { onApplied } = renderModal(openChest, true);
    await waitFor(() => expect(openChest).toHaveBeenCalledTimes(1));
    // The surviving mount must process the shared response (a dropped
    // response leaves the modal dead: disabled chest, eternal loading).
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(20));
    // No second POST even after settling.
    await new Promise((r) => setTimeout(r, 50));
    expect(openChest).toHaveBeenCalledTimes(1);
  });

  it.each([409, 404])("drops the row when the chest is gone (status %i)", async (status) => {
    setupCatalog();
    const err = Object.assign(new Error("gone"), { status });
    const { onExpired, onClose } = renderModal(() => Promise.reject(err));
    await waitFor(() => expect(onExpired).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes with a toast when the play call fails (nothing was committed)", async () => {
    setupCatalog();
    const { onExpired, onClose } = renderModal(() => Promise.reject(new Error("nope")));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onExpired).not.toHaveBeenCalled();
  });
});
