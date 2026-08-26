import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { Lightbox, type LightboxItem } from "./Lightbox";

vi.mock("@/utils/storage", () => ({
  storageUrl: (_bucket: string, keyOrUrl?: string | null) => keyOrUrl || null,
}));

// Deterministic embla stub: scrollTo updates the selected snap and synchronously
// fires the "select" listeners, so keyboard/thumbnail navigation is testable
// without real animation timing.
vi.mock("embla-carousel-react", () => {
  type EmblaApi = {
    on: (event: string, cb: () => void) => EmblaApi;
    off: (event: string, cb: () => void) => EmblaApi;
    scrollTo: (index: number) => EmblaApi;
    selectedScrollSnap: () => number;
  };
  return {
    __esModule: true,
    default: () => {
      let currentIndex = 0;
      const listeners: Record<string, Array<() => void>> = {};
      const api: EmblaApi = {
        on(event, cb) {
          (listeners[event] ??= []).push(cb);
          return api;
        },
        off(event, cb) {
          listeners[event] = (listeners[event] ?? []).filter((f) => f !== cb);
          return api;
        },
        scrollTo(index) {
          currentIndex = index;
          (listeners.select ?? []).forEach((cb) => cb());
          return api;
        },
        selectedScrollSnap() {
          return currentIndex;
        },
      };
      return [() => {}, api];
    },
  };
});

function makeItem(url: string, type: LightboxItem["type"] = "image"): LightboxItem {
  return {
    url,
    type,
    name: url,
    size: 1000,
    mime: type === "image" ? "image/jpeg" : "video/mp4",
    ...(type === "image" ? { meta: JSON.stringify({ width: 800, height: 600 }) } : {}),
  };
}

function query(selector: string): HTMLElement {
  const el = document.body.querySelector(selector);
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

function resetButton(): HTMLButtonElement {
  return query('[aria-label="Сбросить масштаб"]') as HTMLButtonElement;
}

function counterText(): string {
  return query(".msg-lightbox-counter").textContent ?? "";
}

describe("Lightbox", () => {
  const items = [makeItem("a.jpg"), makeItem("b.jpg"), makeItem("c.jpg")];

  it("renders a fullscreen dialog with counter and controls", () => {
    render(<Lightbox items={items} initialIndex={0} onClose={vi.fn()} />);
    const dialog = document.body.querySelector(".msg-lightbox");
    expect(dialog).toBeInTheDocument();
    expect(document.body.querySelector(".msg-lightbox-counter")).toHaveTextContent("/ 3");
    expect(document.body.querySelector('[aria-label="Закрыть"]')).toBeInTheDocument();
    expect(document.body.querySelector('[aria-label="Скачать"]')).toBeInTheDocument();
    expect(document.body.querySelector('[aria-label="Сбросить масштаб"]')).toBeInTheDocument();
    expect(document.body.querySelectorAll(".msg-lightbox-slide")).toHaveLength(3);
    expect(document.body.querySelectorAll(".msg-lightbox-thumbnail")).toHaveLength(3);
  });

  it("selects a photo from the thumbnail strip", () => {
    render(<Lightbox items={items} initialIndex={0} onClose={vi.fn()} />);
    const thumbnails = document.body.querySelectorAll(".msg-lightbox-thumbnail");
    fireEvent.click(thumbnails[2]);
    expect(thumbnails[2]).toHaveAttribute("aria-current", "true");
  });

  it("closes via the close button", () => {
    const onClose = vi.fn();
    render(<Lightbox items={items} initialIndex={0} onClose={onClose} />);
    fireEvent.click(document.body.querySelector('[aria-label="Закрыть"]')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes via Escape", () => {
    const onClose = vi.fn();
    render(<Lightbox items={items} initialIndex={0} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when clicking the stage outside slides and controls", () => {
    const onClose = vi.fn();
    render(<Lightbox items={items} initialIndex={0} onClose={onClose} />);
    fireEvent.mouseDown(document.body.querySelector(".msg-lightbox")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when clicking a slide", () => {
    const onClose = vi.fn();
    render(<Lightbox items={items} initialIndex={0} onClose={onClose} />);
    fireEvent.mouseDown(document.body.querySelector(".msg-lightbox-slide")!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close when clicking the topbar, arrows or thumbnails", () => {
    const onClose = vi.fn();
    render(<Lightbox items={items} initialIndex={0} onClose={onClose} />);
    fireEvent.mouseDown(document.body.querySelector(".msg-lightbox-topbar")!);
    fireEvent.mouseDown(document.body.querySelector(".msg-lightbox-arrow.prev")!);
    fireEvent.mouseDown(document.body.querySelector(".msg-lightbox-arrow.next")!);
    fireEvent.mouseDown(document.body.querySelector(".msg-lightbox-thumbnails")!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the zoom reset disabled at scale 1", () => {
    render(<Lightbox items={items} initialIndex={0} onClose={vi.fn()} />);
    expect(resetButton().disabled).toBe(true);
  });

  it("locks body scroll while open and restores it on unmount", () => {
    const { unmount } = render(<Lightbox items={items} initialIndex={0} onClose={vi.fn()} />);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("navigates slides with the arrow keys", () => {
    render(<Lightbox items={items} initialIndex={0} onClose={vi.fn()} />);
    expect(counterText()).toBe("1 / 3");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(counterText()).toBe("2 / 3");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(counterText()).toBe("3 / 3");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(counterText()).toBe("3 / 3");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(counterText()).toBe("2 / 3");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(counterText()).toBe("1 / 3");
  });

  it("zooms in and out with the keyboard and resets with 0", () => {
    render(<Lightbox items={items} initialIndex={0} onClose={vi.fn()} />);
    fireEvent.keyDown(window, { key: "+" });
    expect(resetButton().disabled).toBe(false);
    fireEvent.keyDown(window, { key: "0" });
    expect(resetButton().disabled).toBe(true);
    fireEvent.keyDown(window, { key: "=" });
    expect(resetButton().disabled).toBe(false);
    fireEvent.keyDown(window, { key: "-" });
    expect(resetButton().disabled).toBe(true);
  });

  it("ignores arrow navigation while zoomed", () => {
    render(<Lightbox items={items} initialIndex={0} onClose={vi.fn()} />);
    fireEvent.keyDown(window, { key: "+" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(counterText()).toBe("1 / 3");
  });

  it("zooms in on double click and resets on a second double click", () => {
    render(<Lightbox items={items} initialIndex={0} onClose={vi.fn()} />);
    const img = query(".msg-lightbox-slide img");
    fireEvent.doubleClick(img, { clientX: 50, clientY: 50 });
    expect(resetButton().disabled).toBe(false);
    expect((img as HTMLImageElement).style.transform).toContain("scale(2.5)");
    fireEvent.doubleClick(img, { clientX: 50, clientY: 50 });
    expect(resetButton().disabled).toBe(true);
    expect((img as HTMLImageElement).style.transform).toContain("scale(1)");
  });

  it("zooms with the mouse wheel", () => {
    render(<Lightbox items={items} initialIndex={0} onClose={vi.fn()} />);
    const img = query(".msg-lightbox-slide img");
    fireEvent.wheel(img, { deltaY: -100 });
    expect(resetButton().disabled).toBe(false);
    fireEvent.wheel(img, { deltaY: 100 });
    expect(resetButton().disabled).toBe(true);
  });

  it("pans a zoomed image with pointer drag", () => {
    render(<Lightbox items={items} initialIndex={0} onClose={vi.fn()} />);
    const img = query(".msg-lightbox-slide img") as HTMLImageElement;
    // Zoom in first so the pan handlers attach (they only run while zoomed).
    fireEvent.doubleClick(img, { clientX: 50, clientY: 50 });
    img.setPointerCapture = vi.fn();
    img.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(img, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(img, { clientX: 120, clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(img, { clientX: 120, clientY: 130, pointerId: 1 });
    // Pan moved by (20, 30) on top of the double-click anchor (50, 50).
    expect(img.style.transform).toContain("translate3d(70px, 80px, 0) scale(2.5)");
  });

  it("links the download action to the resolved original URL", async () => {
    render(<Lightbox items={items} initialIndex={0} onClose={vi.fn()} />);
    const link = document.body.querySelector('[aria-label="Скачать"]') as HTMLAnchorElement;
    await waitFor(() => expect(link.getAttribute("href")).toBe("a.jpg"));
    expect(link.getAttribute("download")).toBe("a.jpg");
  });

  it("does not show the edit button without onEditImage", () => {
    render(<Lightbox items={items} initialIndex={0} onClose={vi.fn()} />);
    expect(document.body.querySelector('[aria-label="Редактировать"]')).not.toBeInTheDocument();
  });

  it("hides the editor for the uploads bucket even with onEditImage", () => {
    const onEditImage = vi.fn();
    render(<Lightbox items={items} initialIndex={0} onClose={vi.fn()} onEditImage={onEditImage} bucket="uploads" />);
    expect(document.body.querySelector('[aria-label="Редактировать"]')).not.toBeInTheDocument();
  });

  it("renders video slides as a video element", () => {
    render(<Lightbox items={[makeItem("movie.mp4", "video")]} initialIndex={0} onClose={vi.fn()} />);
    expect(document.body.querySelector(".msg-lightbox-slide video")).toBeInTheDocument();
  });
});

// ─── Editor (crop / brush / blur) ───────────────────────────────────────────
// jsdom has no canvas implementation: stub getContext/toDataURL and the image
// loading flags the editor reads (complete, naturalWidth/Height, decode).

describe("Lightbox editor", () => {
  const items = [makeItem("a.jpg"), makeItem("b.jpg"), makeItem("c.jpg")];

  // Shared spy: the mocked canvas context is one object for every getContext
  // call, so tests can assert on the drawImage arguments (e.g. the crop box).
  let drawImageSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    drawImageSpy = vi.fn();
    const ctx = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      drawImage: drawImageSpy,
      fillRect: vi.fn(),
      save: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      restore: vi.fn(),
      strokeRect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high",
      filter: "none",
      lineCap: "round",
      lineJoin: "round",
      strokeStyle: "#000",
      fillStyle: "#000",
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,FAKE");
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => true });
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => 800 });
    Object.defineProperty(HTMLImageElement.prototype, "naturalHeight", { configurable: true, get: () => 600 });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).decode;
    delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).complete;
    delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).naturalWidth;
    delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).naturalHeight;
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
  });

  function openEditor(onEditImage: (i: number, dataUrl: string) => void) {
    render(<Lightbox items={items} initialIndex={0} onClose={vi.fn()} onEditImage={onEditImage} />);
    fireEvent.click(document.body.querySelector('[aria-label="Редактировать"]')!);
  }

  // The photo loads asynchronously (decode → draw → setReady), so tests that
  // depend on the working canvas state (fit, crop window, undo) must wait for
  // it: the main canvas gets its real size only once init has finished.
  async function openEditorReady(onEditImage: (i: number, dataUrl: string) => void) {
    openEditor(onEditImage);
    await waitFor(() => {
      const main = document.body.querySelector(".pe-canvas:not(.pe-overlay)") as HTMLCanvasElement | null;
      expect(main?.width).toBe(800);
    });
  }

  function stubCanvasPointer(canvas: HTMLCanvasElement) {
    // Screen coordinates are read from the full-stage overlay; image
    // coordinates are mapped through the zoomed photo canvas. Stub both.
    const main = document.body.querySelector(".pe-canvas:not(.pe-overlay)") as HTMLCanvasElement;
    const rect = {
      left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(rect);
    if (main && main !== canvas) vi.spyOn(main, "getBoundingClientRect").mockReturnValue(rect);
    (canvas as unknown as Record<string, unknown>).setPointerCapture = vi.fn();
    (canvas as unknown as Record<string, unknown>).releasePointerCapture = vi.fn();
  }

  it("opens the editor when onEditImage is provided", () => {
    openEditor(vi.fn());
    expect(document.body.querySelector('[aria-label="Кадрировать"]')).toBeInTheDocument();
    expect(document.body.querySelector('[aria-label="Кисть"]')).toBeInTheDocument();
    expect(document.body.querySelector('[aria-label="Размытие"]')).toBeInTheDocument();
    expect(document.body.querySelector('[aria-label="Отменить"]')).toBeInTheDocument();
    expect(document.body.querySelector('[aria-label="Повторить"]')).toBeInTheDocument();
    expect(document.body.querySelectorAll(".msg-lightbox-thumbnail")).toHaveLength(0);
  });

  it("opens straight into the editor with startInEditMode", () => {
    render(
      <Lightbox items={items} initialIndex={0} onClose={vi.fn()} onEditImage={vi.fn()} startInEditMode />,
    );
    expect(document.body.querySelector('[aria-label="Кадрировать"]')).toBeInTheDocument();
    expect(document.body.querySelector('[aria-label="Редактировать"]')).not.toBeInTheDocument();
  });

  it("ignores startInEditMode when onEditImage is missing", () => {
    render(<Lightbox items={items} initialIndex={0} onClose={vi.fn()} startInEditMode />);
    expect(document.body.querySelector('[aria-label="Кадрировать"]')).not.toBeInTheDocument();
  });

  it("cancels the editor back to the viewer", () => {
    openEditor(vi.fn());
    fireEvent.click(document.body.querySelector('[aria-label="Отмена"]')!);
    expect(document.body.querySelector('[aria-label="Кадрировать"]')).not.toBeInTheDocument();
    expect(document.body.querySelectorAll(".msg-lightbox-thumbnail")).toHaveLength(3);
    expect(document.body.querySelector('[aria-label="Редактировать"]')).toBeInTheDocument();
  });

  it("switches between the crop, brush and blur tools", () => {
    openEditor(vi.fn());
    const crop = document.body.querySelector('[aria-label="Кадрировать"]')!;
    const brush = document.body.querySelector('[aria-label="Кисть"]')!;
    const blur = document.body.querySelector('[aria-label="Размытие"]')!;
    expect(crop.className).toContain("is-active");
    expect(brush.className).not.toContain("is-active");
    fireEvent.click(brush);
    expect(brush.className).toContain("is-active");
    expect(crop.className).not.toContain("is-active");
    fireEvent.click(blur);
    expect(blur.className).toContain("is-active");
    expect(brush.className).not.toContain("is-active");
  });

  it("applies the edit and reports the edited data URL", async () => {
    const onEditImage = vi.fn();
    // Готово stays disabled until the photo has loaded, so wait for ready.
    await openEditorReady(onEditImage);
    fireEvent.click(document.body.querySelector('[aria-label="Готово"]')!);
    await waitFor(() => expect(onEditImage).toHaveBeenCalledTimes(1));
    expect(onEditImage).toHaveBeenCalledWith(0, "data:image/png;base64,FAKE");
    // Editor closes back to the viewer after applying.
    expect(document.body.querySelectorAll(".msg-lightbox-thumbnail")).toHaveLength(3);
  });

  it("resizes the crop box by dragging the south-east handle", async () => {
    const onEditImage = vi.fn();
    await openEditorReady(onEditImage);
    const canvas = document.body.querySelector(".pe-overlay") as HTMLCanvasElement;
    expect(canvas).not.toBeNull();
    stubCanvasPointer(canvas);
    fireEvent.pointerDown(canvas, { clientX: 796, clientY: 596, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 600, clientY: 450, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 600, clientY: 450, pointerId: 1 });
    fireEvent.click(document.body.querySelector('[aria-label="Готово"]')!);
    await waitFor(() => expect(onEditImage).toHaveBeenCalledTimes(1));
    expect(onEditImage).toHaveBeenCalledWith(0, "data:image/png;base64,FAKE");
  });

  it("draws with the brush tool and reports the edited data URL", async () => {
    const onEditImage = vi.fn();
    await openEditorReady(onEditImage);
    fireEvent.click(document.body.querySelector('[aria-label="Кисть"]')!);
    const canvas = document.body.querySelector(".pe-overlay") as HTMLCanvasElement;
    stubCanvasPointer(canvas);
    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 300, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 300, clientY: 200, pointerId: 1 });
    fireEvent.click(document.body.querySelector('[aria-label="Готово"]')!);
    await waitFor(() => expect(onEditImage).toHaveBeenCalledTimes(1));
    expect(onEditImage).toHaveBeenCalledWith(0, "data:image/png;base64,FAKE");
  });

  it("enables undo after a brush stroke and redo after undo", async () => {
    const onEditImage = vi.fn();
    openEditor(onEditImage);
    const undo = document.body.querySelector('[aria-label="Отменить"]') as HTMLButtonElement;
    const redo = document.body.querySelector('[aria-label="Повторить"]') as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(true);

    // Draw a stroke: undo becomes available.
    fireEvent.click(document.body.querySelector('[aria-label="Кисть"]')!);
    const canvas = document.body.querySelector(".pe-overlay") as HTMLCanvasElement;
    stubCanvasPointer(canvas);
    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 200, clientY: 150, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 200, clientY: 150, pointerId: 1 });
    expect(undo.disabled).toBe(false);

    fireEvent.click(undo);
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(false);

    fireEvent.click(redo);
    expect(redo.disabled).toBe(true);
    expect(undo.disabled).toBe(false);
  });

  it("zooms in and out with the mouse wheel around the cursor", async () => {
    openEditor(vi.fn());
    const canvas = document.body.querySelector(".pe-overlay") as HTMLCanvasElement;
    stubCanvasPointer(canvas);
    const frame = document.body.querySelector(".pe-frame") as HTMLElement;
    expect(frame.style.transform).toContain("scale(1)");

    // Wheel up (deltaY < 0) zooms in.
    fireEvent.wheel(canvas, { clientX: 400, clientY: 300, deltaY: -100 });
    expect(frame.style.transform).toContain("scale(1.15)");

    // Wheel down zooms back out to exactly scale 1.
    fireEvent.wheel(canvas, { clientX: 400, clientY: 300, deltaY: 100 });
    expect(frame.style.transform).toContain("scale(1)");
  });

  it("pinches with two fingers to zoom the canvas", () => {
    openEditor(vi.fn());
    const canvas = document.body.querySelector(".pe-overlay") as HTMLCanvasElement;
    const frame = document.body.querySelector(".pe-frame") as HTMLElement;
    stubCanvasPointer(canvas);

    // First finger down, then second finger: pinch starts.
    fireEvent.pointerDown(canvas, { clientX: 300, clientY: 300, pointerId: 1 });
    fireEvent.pointerDown(canvas, { clientX: 500, clientY: 300, pointerId: 2 });
    expect(frame.style.transform).toContain("scale(1)");

    // Spread the fingers: distance doubles → zoom doubles.
    fireEvent.pointerMove(canvas, { clientX: 200, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 600, clientY: 300, pointerId: 2 });
    expect(frame.style.transform).toContain("scale(2)");

    // Bring them back together → back to scale 1.
    fireEvent.pointerMove(canvas, { clientX: 300, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 500, clientY: 300, pointerId: 2 });
    expect(frame.style.transform).toContain("scale(1)");

    fireEvent.pointerUp(canvas, { clientX: 300, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 500, clientY: 300, pointerId: 2 });
  });

  it("pans the photo with a two-finger drag after zooming in", async () => {
    await openEditorReady(vi.fn());
    const canvas = document.body.querySelector(".pe-overlay") as HTMLCanvasElement;
    const pan = document.body.querySelector(".pe-frame-pan") as HTMLElement;
    stubCanvasPointer(canvas);

    // Zoom in first: pan is clamped to zero at scale 1.
    fireEvent.wheel(canvas, { clientX: 400, clientY: 300, deltaY: -100 });

    // Two fingers moving together shift the midpoint → the photo pans.
    fireEvent.pointerDown(canvas, { clientX: 300, clientY: 300, pointerId: 1 });
    fireEvent.pointerDown(canvas, { clientX: 500, clientY: 300, pointerId: 2 });
    fireEvent.pointerMove(canvas, { clientX: 330, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 530, clientY: 300, pointerId: 2 });
    expect(pan.style.transform).toContain("translate3d(30px, 0px, 0)");
    fireEvent.pointerUp(canvas, { clientX: 330, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 530, clientY: 300, pointerId: 2 });
  });

  it("draws with the blur brush and reports the edited data URL", async () => {
    const onEditImage = vi.fn();
    await openEditorReady(onEditImage);
    fireEvent.click(document.body.querySelector('[aria-label="Размытие"]')!);
    const canvas = document.body.querySelector(".pe-overlay") as HTMLCanvasElement;
    stubCanvasPointer(canvas);
    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 300, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 300, clientY: 200, pointerId: 1 });
    fireEvent.click(document.body.querySelector('[aria-label="Готово"]')!);
    await waitFor(() => expect(onEditImage).toHaveBeenCalledTimes(1));
    expect(onEditImage).toHaveBeenCalledWith(0, "data:image/png;base64,FAKE");
  });

  it("exports the pending crop from Готово without applying it first", async () => {
    const onEditImage = vi.fn();
    await openEditorReady(onEditImage);
    const canvas = document.body.querySelector(".pe-overlay") as HTMLCanvasElement;
    stubCanvasPointer(canvas);
    fireEvent.pointerDown(canvas, { clientX: 796, clientY: 596, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 600, clientY: 450, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 600, clientY: 450, pointerId: 1 });
    fireEvent.click(document.body.querySelector('[aria-label="Готово"]')!);
    await waitFor(() => expect(onEditImage).toHaveBeenCalledTimes(1));
    // The pending crop goes through cropCanvas: drawImage receives the crop
    // box as (source, sx, sy, sw, sh, dx, dy, dw, dh).
    expect(drawImageSpy).toHaveBeenCalledWith(expect.anything(), 0, 0, 600, 450, 0, 0, 600, 450);
  });

  it("bakes the crop into the canvas with Применить кадр and exports it", async () => {
    const onEditImage = vi.fn();
    await openEditorReady(onEditImage);
    const canvas = document.body.querySelector(".pe-overlay") as HTMLCanvasElement;
    stubCanvasPointer(canvas);
    fireEvent.pointerDown(canvas, { clientX: 796, clientY: 596, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 600, clientY: 450, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 600, clientY: 450, pointerId: 1 });
    fireEvent.click(document.body.querySelector(".pe-apply-crop")!);

    // The working canvas is now the cropped size and the crop is undoable.
    const main = document.body.querySelector(".pe-canvas:not(.pe-overlay)") as HTMLCanvasElement;
    expect(main.width).toBe(600);
    expect(main.height).toBe(450);
    expect((document.body.querySelector('[aria-label="Отменить"]') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(document.body.querySelector('[aria-label="Готово"]')!);
    await waitFor(() => expect(onEditImage).toHaveBeenCalledTimes(1));
    expect(onEditImage).toHaveBeenCalledWith(0, "data:image/png;base64,FAKE");
  });

  it("keeps the crop square when a 1:1 aspect preset is applied", async () => {
    const onEditImage = vi.fn();
    await openEditorReady(onEditImage);

    // Pick the 1:1 preset from the dropdown.
    fireEvent.click(document.body.querySelector(".pe-aspect-trigger")!);
    const option = Array.from(document.body.querySelectorAll(".pe-aspect-option")).find(
      (el) => el.textContent === "1:1"
    ) as HTMLElement;
    fireEvent.click(option);
    // The menu closes on selection; the trigger now shows the chosen preset.
    expect(document.body.querySelector(".pe-aspect-trigger-label")).toHaveTextContent("1:1");

    // Drag the south-east corner of the now-square window.
    const canvas = document.body.querySelector(".pe-overlay") as HTMLCanvasElement;
    stubCanvasPointer(canvas);
    fireEvent.pointerDown(canvas, { clientX: 700, clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 500, clientY: 450, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 500, clientY: 450, pointerId: 1 });
    fireEvent.click(document.body.querySelector('[aria-label="Готово"]')!);
    await waitFor(() => expect(onEditImage).toHaveBeenCalledTimes(1));
    // Exported box {100, 0, 400, 400} — width equals height.
    expect(drawImageSpy).toHaveBeenCalledWith(expect.anything(), 100, 0, 400, 400, 0, 0, 400, 400);
  });

  it("nudges the crop window with the arrow keys and switches tools with 1/2/3", () => {
    openEditor(vi.fn());
    // Arrow keys only move the window in crop mode; the toolbar stays on crop.
    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: "2" });
    expect(document.body.querySelector('[aria-label="Кисть"]')!.className).toContain("is-active");
    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: "1" });
    expect(document.body.querySelector('[aria-label="Кадрировать"]')!.className).toContain("is-active");
  });

  it("shows a retry button when the photo fails to load and recovers on retry", async () => {
    // First decode attempt fails, subsequent ones succeed.
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: vi.fn().mockRejectedValueOnce(new Error("decode failed")).mockResolvedValue(undefined),
    });
    openEditor(vi.fn());
    await waitFor(() => expect(document.body.querySelector(".pe-error")).toBeInTheDocument());
    fireEvent.click(document.body.querySelector(".pe-error button")!);
    await waitFor(() => expect(document.body.querySelector(".pe-error")).not.toBeInTheDocument());
    expect(document.body.querySelector(".pe-overlay")).toBeInTheDocument();
  });
});
