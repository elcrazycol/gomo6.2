import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  MESSENGER_IMAGE_MAX_DIMENSION,
  MESSENGER_IMAGE_QUALITY,
  prepareMessengerImage,
} from "./imageProcessing";

type MockBitmap = { width: number; height: number; close: ReturnType<typeof vi.fn> };

const createCanvasMock = (blob: Blob, webpSupported = true) => {
  const context = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    drawImage: vi.fn(),
  };
  return {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toDataURL: vi.fn(() =>
      webpSupported ? "data:image/webp;base64,probe" : "data:image/png;base64,probe",
    ),
    toBlob: vi.fn((callback: BlobCallback) => callback(blob)),
  } as unknown as HTMLCanvasElement;
};

describe("prepareMessengerImage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("downscales large photos and exports high-quality WebP", async () => {
    const bitmap: MockBitmap = { width: 6000, height: 4000, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    const output = new Blob([new Uint8Array(100)], { type: "image/webp" });
    vi.spyOn(document, "createElement").mockReturnValue(createCanvasMock(output) as unknown as HTMLElement);

    const source = new File([new Uint8Array(5000)], "camera.jpg", { type: "image/jpeg" });
    const result = await prepareMessengerImage(source);

    expect(result.compressed).toBe(true);
    expect(result.file.type).toBe("image/webp");
    expect(result.file.name).toBe("camera.webp");
    expect(result.width).toBe(2560);
    expect(result.height).toBe(1707);
    expect(result.sourceSize).toBe(source.size);
    expect(result.storedSize).toBe(result.file.size);
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(MESSENGER_IMAGE_MAX_DIMENSION).toBe(2560);
    expect(MESSENGER_IMAGE_QUALITY).toBe(0.9);
  });

  it("keeps animated GIFs instead of collapsing them to one frame", async () => {
    const bitmap: MockBitmap = { width: 800, height: 600, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    const canvas = createCanvasMock(new Blob(["unused"], { type: "image/webp" }));
    vi.spyOn(document, "createElement").mockReturnValue(canvas as unknown as HTMLElement);

    const source = new File(["gif"], "animation.gif", { type: "image/gif" });
    const result = await prepareMessengerImage(source);

    expect(result.file).toBe(source);
    expect(result.compressed).toBe(false);
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(canvas.toBlob).not.toHaveBeenCalled();
  });

  it("re-encodes WebP (first frame) so an animated file cannot reach the decoder", async () => {
    const bitmap: MockBitmap = { width: 320, height: 240, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    // The derivative is LARGER than the (tiny) source, yet must still win for
    // WebP — returning the original could hand an undecodable animated file up.
    const output = new Blob([new Uint8Array(4096)], { type: "image/webp" });
    const canvas = createCanvasMock(output);
    vi.spyOn(document, "createElement").mockReturnValue(canvas as unknown as HTMLElement);

    const source = new File([new Uint8Array(10)], "anim.webp", { type: "image/webp" });
    const result = await prepareMessengerImage(source);

    expect(result.file).not.toBe(source);
    expect(result.file.type).toBe("image/webp");
    expect(result.file.name).toBe("anim.webp");
    expect(result.compressed).toBe(true);
    expect(canvas.toBlob).toHaveBeenCalled();
  });

  it("falls back to JPEG for WebP when the browser cannot encode WebP", async () => {
    const bitmap: MockBitmap = { width: 100, height: 100, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    const jpeg = new Blob([new Uint8Array(500)], { type: "image/jpeg" });
    const canvas = createCanvasMock(jpeg, false);
    vi.spyOn(document, "createElement").mockReturnValue(canvas as unknown as HTMLElement);

    const source = new File([new Uint8Array(400)], "photo.webp", { type: "image/webp" });
    const result = await prepareMessengerImage(source);

    expect(result.file.type).toBe("image/jpeg");
    expect(result.file.name).toBe("photo.jpg");
  });
});
