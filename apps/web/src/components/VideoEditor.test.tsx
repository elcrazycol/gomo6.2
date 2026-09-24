import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VideoEditor } from "./VideoEditor";

// The stage is fitted from the measured container, so give every element a
// non-zero rect (jsdom returns zeros by default and the crop overlay would
// never render).
function stubRect(width: number, height: number) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

function loadVideo(baseElement: HTMLElement, width: number, height: number, duration: number) {
  const video = baseElement.querySelector("video") as HTMLVideoElement;
  Object.defineProperty(video, "videoWidth", { value: width, configurable: true });
  Object.defineProperty(video, "videoHeight", { value: height, configurable: true });
  Object.defineProperty(video, "duration", { value: duration, configurable: true });
  fireEvent.loadedMetadata(video);
  return video;
}

describe("VideoEditor", () => {
  beforeEach(() => {
    stubRect(400, 300);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    // The filmstrip hook draws frames to a canvas; jsdom has no 2D context, so
    // keep it quiet — the timeline still renders without thumbnails.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderEditor = () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    const result = render(
      <VideoEditor src="blob:test" fileName="clip.mp4" onApply={onApply} onCancel={onCancel} />,
    );
    return { ...result, onApply, onCancel };
  };

  it("toggles the aspect panel from the crop button", async () => {
    const { baseElement } = renderEditor();
    loadVideo(baseElement, 640, 360, 10);
    await screen.findByLabelText("Готово");

    const cropButton = screen.getByLabelText("Кадрирование");
    expect(cropButton).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(cropButton);
    expect(cropButton).toHaveAttribute("aria-expanded", "true");

    // Any tap outside the panel dismisses it.
    fireEvent.click(baseElement.querySelector(".ve-tools-backdrop") as HTMLElement);
    expect(cropButton).toHaveAttribute("aria-expanded", "false");
  });

  it("applies null when nothing was changed", async () => {
    const { baseElement, onApply } = renderEditor();
    loadVideo(baseElement, 640, 360, 10);

    const apply = await screen.findByLabelText("Готово");
    await waitFor(() => expect(apply).not.toBeDisabled());
    fireEvent.click(apply);

    expect(onApply).toHaveBeenCalledWith(null);
  });

  it("applies a centered crop when an aspect preset is chosen", async () => {
    const { baseElement, onApply } = renderEditor();
    loadVideo(baseElement, 640, 360, 10);
    await screen.findByLabelText("Готово");

    fireEvent.click(screen.getByLabelText("Кадрирование"));
    fireEvent.click(screen.getByRole("button", { name: "1:1" }));
    fireEvent.click(screen.getByLabelText("Готово"));

    const edit = onApply.mock.calls.at(-1)?.[0];
    expect(edit?.crop).toBeDefined();
    expect(edit.crop.w).toBeCloseTo(0.563, 2);
    expect(edit.crop.h).toBeCloseTo(1, 2);
  });

  it("resizes the crop frame with a corner handle", async () => {
    const { baseElement, onApply } = renderEditor();
    loadVideo(baseElement, 640, 360, 10);
    await screen.findByLabelText("Готово");

    fireEvent.click(screen.getByLabelText("Кадрирование"));
    fireEvent.click(screen.getByRole("button", { name: "1:1" }));
    const cropBefore = (baseElement.querySelector(".ve-crop") as HTMLElement).style.width;

    const handle = baseElement.querySelector(".ve-handle-se") as HTMLElement;
    const overlay = baseElement.querySelector(".ve-overlay") as HTMLElement;
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 150, clientY: 150 });
    fireEvent.pointerUp(overlay, { pointerId: 1 });

    const cropAfter = (baseElement.querySelector(".ve-crop") as HTMLElement).style.width;
    expect(parseFloat(cropAfter)).toBeLessThan(parseFloat(cropBefore));

    fireEvent.click(screen.getByLabelText("Готово"));
    const edit = onApply.mock.calls.at(-1)?.[0];
    expect(edit?.crop?.w).toBeLessThan(0.563);
  });

  it("mirrors and rotates the clip", async () => {
    const { baseElement, onApply } = renderEditor();
    const video = loadVideo(baseElement, 640, 360, 10);
    await screen.findByLabelText("Готово");

    fireEvent.click(screen.getByLabelText("Отзеркалить"));
    fireEvent.click(screen.getByLabelText("Повернуть"));

    // The preview transform mirrors the backend's hflip/transpose order.
    expect(video.style.transform).toContain("rotate(90deg)");
    expect(video.style.transform).toContain("scaleX(-1)");

    fireEvent.click(screen.getByLabelText("Готово"));
    const edit = onApply.mock.calls.at(-1)?.[0];
    expect(edit?.mirror).toBe(true);
    expect(edit?.rotate).toBe(90);
  });

  it("cycles rotation through 90/180/270/0", async () => {
    const { baseElement, onApply } = renderEditor();
    loadVideo(baseElement, 640, 360, 10);
    await screen.findByLabelText("Готово");

    const rotate = screen.getByLabelText("Повернуть");
    fireEvent.click(rotate);
    fireEvent.click(rotate);
    fireEvent.click(rotate);
    fireEvent.click(screen.getByLabelText("Готово"));

    expect(onApply.mock.calls.at(-1)?.[0]?.rotate).toBe(270);
  });

  it("turns the clip into a soundless GIF", async () => {
    const { baseElement, onApply } = renderEditor();
    const video = loadVideo(baseElement, 640, 360, 10);
    await screen.findByLabelText("Готово");

    const gif = screen.getByLabelText("GIF (без звука)");
    expect(gif).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(gif);
    expect(gif).toHaveAttribute("aria-pressed", "true");
    // The preview goes silent to match the processed output.
    expect(video.muted).toBe(true);

    fireEvent.click(screen.getByLabelText("Готово"));
    expect(onApply.mock.calls.at(-1)?.[0]?.muted).toBe(true);
  });

  it("trims the clip by dragging the timeline's end handle", async () => {
    const { baseElement, onApply } = renderEditor();
    loadVideo(baseElement, 640, 360, 10);
    await screen.findByLabelText("Готово");

    const film = baseElement.querySelector(".ve-film") as HTMLElement;
    const endHandle = baseElement.querySelector(".ve-film-handle-end") as HTMLElement;
    // Grab the end handle at the far right (t=10), drag it to 60% (t=6).
    fireEvent.pointerDown(endHandle, { pointerId: 1, clientX: 400, clientY: 30 });
    fireEvent.pointerMove(film, { pointerId: 1, clientX: 240, clientY: 30 });
    fireEvent.pointerUp(film, { pointerId: 1 });

    fireEvent.click(screen.getByLabelText("Готово"));
    const edit = onApply.mock.calls.at(-1)?.[0];
    expect(edit?.start).toBe(0);
    expect(edit?.end).toBeCloseTo(6, 1);
  });

  it("moves the timeline's start handle past one second", async () => {
    const { baseElement, onApply } = renderEditor();
    loadVideo(baseElement, 640, 360, 10);
    await screen.findByLabelText("Готово");

    const film = baseElement.querySelector(".ve-film") as HTMLElement;
    const startHandle = baseElement.querySelector(".ve-film-handle-start") as HTMLElement;
    // Grab the start handle at the far left (t=0), drag it to 50% (t=5).
    fireEvent.pointerDown(startHandle, { pointerId: 1, clientX: 0, clientY: 30 });
    fireEvent.pointerMove(film, { pointerId: 1, clientX: 200, clientY: 30 });
    fireEvent.pointerUp(film, { pointerId: 1 });

    fireEvent.click(screen.getByLabelText("Готово"));
    const edit = onApply.mock.calls.at(-1)?.[0];
    expect(edit?.start).toBeCloseTo(5, 1);
    expect(edit?.end).toBe(10);
  });

  it("moves the playhead and starts playback from it", async () => {
    const { baseElement } = renderEditor();
    const video = loadVideo(baseElement, 640, 360, 10);
    await screen.findByLabelText("Готово");

    const film = baseElement.querySelector(".ve-film") as HTMLElement;
    // Tap at 30% of the strip → playhead lands at t=3.
    fireEvent.pointerDown(film, { pointerId: 1, clientX: 120, clientY: 30 });
    fireEvent.pointerUp(film, { pointerId: 1 });

    fireEvent.click(baseElement.querySelector(".ve-play") as HTMLButtonElement);

    expect(video.currentTime).toBeCloseTo(3);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("cancels without an edit", async () => {
    const { baseElement, onCancel } = renderEditor();
    loadVideo(baseElement, 640, 360, 10);
    await screen.findByLabelText("Отмена");

    fireEvent.click(screen.getByLabelText("Отмена"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
