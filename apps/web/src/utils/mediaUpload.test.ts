import { describe, it, expect, beforeEach, vi } from "vitest";

// jsdom does not implement URL.createObjectURL; the audio-duration fallback
// in extractAudioMetadata uses it.
if (typeof URL.createObjectURL !== "function") {
  let objectUrlCounter = 0;
  URL.createObjectURL = () => `blob:mock-poster-${++objectUrlCounter}`;
  URL.revokeObjectURL = () => {};
}

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockAuth, mockUploadFile, mockStorageUrl, mockPrepareMessengerImage, mockToast, mockParseBlob } = vi.hoisted(() => ({
  mockAuth: { getSession: vi.fn(), getUser: vi.fn(), onAuthStateChange: vi.fn() },
  mockUploadFile: vi.fn(),
  mockStorageUrl: vi.fn<[bucket: string, key: string], string | undefined>(() => undefined),
  mockPrepareMessengerImage: vi.fn(),
  mockToast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
  mockParseBlob: vi.fn(),
}));

vi.mock("@/integrations/api/compat", () => ({ api: { from: vi.fn(), rpc: vi.fn(), auth: mockAuth } }));
vi.mock("@/utils/storage", () => ({ storageUrl: mockStorageUrl, uploadFile: mockUploadFile }));
vi.mock("@/lib/imageProcessing", () => ({ prepareMessengerImage: mockPrepareMessengerImage }));
vi.mock("sonner", () => ({ toast: mockToast }));
vi.mock("music-metadata", () => ({ parseBlob: mockParseBlob }));

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeFile(name: string, type: string, size = 1024): File {
  const file = new File([new Uint8Array(size)], name, { type });
  return file;
}

const variants = {
  preview_key: "user-1/photo.webp.preview.jpg",
  lqip: "data:image/jpeg;base64,AAAA",
  width: 800,
  height: 600,
  content_type: "image/jpeg",
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("uploadAttachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.getSession.mockResolvedValue({
      data: { session: { user: { id: "user-1" }, access_token: "token-abc" } },
      error: null,
    });
    mockUploadFile.mockResolvedValue({ path: "user-1/photo.webp", variants });
    mockPrepareMessengerImage.mockImplementation(async (file: File) => ({
      file,
      width: 800,
      height: 600,
      sourceSize: file.size,
      storedSize: file.size,
      compressed: false,
    }));
  });

  it("rejects when the user is not logged in", async () => {
    mockAuth.getSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(uploadAttachments([makeFile("a.png", "image/png")])).rejects.toThrow(
      "Нужно войти для загрузки",
    );
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it("uploads an image through the backend and returns attachment metadata", async () => {
    const file = makeFile("photo.png", "image/png");
    const prepared = new File(["prepared"], "photo.webp", { type: "image/webp" });
    mockPrepareMessengerImage.mockResolvedValue({
      file: prepared,
      width: 800,
      height: 600,
      sourceSize: file.size,
      storedSize: 100,
      compressed: true,
    });
    // The backend stores under the generated key and returns it as `path`.
    mockUploadFile.mockImplementation(async (_bucket: string, key: string) => ({ path: key, variants }));

    const results = await uploadAttachments([file]);

    expect(results).toHaveLength(1);
    const result = results[0];
    expect(result.type).toBe("image");
    expect(result.name).toBe("photo.webp");
    expect(result.mime).toBe("image/webp");
    expect(result.meta?.preview_key).toBe("user-1/photo.webp.preview.jpg");
    expect(result.meta?.width).toBe(800);
    expect(result.meta?.height).toBe(600);
    expect(result.meta?.lqip).toContain("base64");
    expect(result.meta?.pipeline).toBe("image-v2");
    expect(result.meta?.source_size).toBe(file.size);
    // content bucket: the generated key itself is the stored URL.
    expect(result.url).toMatch(/^user-1\/\d+_[a-z0-9]+\.webp$/);

    // The backend upload runs with the user's access token and no double
    // image preparation (mediaUpload prepares explicitly).
    expect(mockUploadFile).toHaveBeenCalledWith(
      "content",
      expect.stringMatching(/^user-1\/\d+_[a-z0-9]+\.webp$/),
      prepared,
      "token-abc",
      false,
      expect.any(Function),
      // Images have no server-side processing phase, so no onUploadComplete.
      undefined,
    );
  });

  it("throws when the server returns no image variants", async () => {
    mockUploadFile.mockResolvedValue({ path: "user-1/photo.webp" });

    await expect(uploadAttachments([makeFile("photo.png", "image/png")])).rejects.toThrow(
      "Сервер не вернул preview для изображения",
    );
  });

  it("uses storageUrl for private buckets (wall) instead of the bare key", async () => {
    mockStorageUrl.mockImplementation((_bucket: string, key: string) => `https://cdn.test/${key}`);
    mockUploadFile.mockImplementation(async (_bucket: string, key: string) => ({ path: key, variants }));

    const results = await uploadAttachments([makeFile("wall.png", "image/png")], "wall");

    expect(results[0].url).toMatch(/^https:\/\/cdn\.test\/user-1\/\d+_[a-z0-9]+\.png$/);
    expect(mockStorageUrl).toHaveBeenCalledWith("wall", expect.stringMatching(/^user-1\//));
    expect(mockUploadFile).toHaveBeenCalledWith(
      "wall",
      expect.stringMatching(/^user-1\//),
      expect.any(File),
      "token-abc",
      false,
      expect.any(Function),
      undefined,
    );
  });

  it("uploads plain files without image processing or variants", async () => {
    const file = makeFile("doc.txt", "text/plain");

    const results = await uploadAttachments([file]);

    expect(results[0].type).toBe("file");
    expect(results[0].meta).toBeUndefined();
    expect(results[0].mime).toBe("text/plain");
    expect(mockPrepareMessengerImage).not.toHaveBeenCalled();
  });

  it("rejects files that are too large to even upload", async () => {
    const huge = makeFile("big.bin", "application/octet-stream", 51 * 1024 * 1024);

    await expect(uploadAttachments([huge])).rejects.toThrow("Файл слишком большой и не удалось сжать");
    expect(mockToast.warning).toHaveBeenCalledWith(
      "Файл больше 50MB — прикрепите меньший",
      { id: "big.bin" },
    );
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  // Video compression runs server-side (ffmpeg): the backend returns the
  // transcoded mp4 key plus a generated poster; there is no browser-side webm.
  it("uploads videos and attaches the server-transcoded mp4 and poster", async () => {
    const video = makeFile("clip.mp4", "video/mp4", 2 * 1024 * 1024);
    mockUploadFile.mockImplementation(async (_bucket: string, key: string) => ({
      path: key,
      video: { poster_key: `${key}.poster.jpg`, content_type: "video/mp4" },
    }));

    const results = await uploadAttachments([video]);

    expect(results[0].type).toBe("video");
    expect(results[0].mime).toBe("video/mp4");
    expect(results[0].name).toBe("clip.mp4");
    // content bucket: the bare poster key is used as-is.
    expect(results[0].poster).toContain(".poster.jpg");
    expect(mockUploadFile).toHaveBeenCalledWith(
      "content",
      expect.stringMatching(/\.mp4$/),
      expect.any(File),
      "token-abc",
      false,
      expect.any(Function),
      // Videos get an onUploadComplete callback for the processing phase.
      expect.any(Function),
    );
  });

  it("rejects oversized videos before transcoding", async () => {
    const video = makeFile("huge.mp4", "video/mp4", 51 * 1024 * 1024);

    await expect(uploadAttachments([video])).rejects.toThrow(
      "Файл слишком большой и не удалось сжать",
    );
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it("extracts audio metadata and attaches it to the result", async () => {
    mockParseBlob.mockResolvedValue({
      common: { title: "My Song", artist: "Artist Name", picture: [] },
      format: { duration: 210 },
    });
    const audio = makeFile("song.mp3", "audio/mpeg");

    const results = await uploadAttachments([audio]);

    expect(results[0].type).toBe("audio");
    expect(results[0].title).toBe("My Song");
    expect(results[0].artist).toBe("Artist Name");
    expect(results[0].duration).toBe(210);
  });

  it("uploads extracted audio cover art to the content bucket", async () => {
    mockParseBlob.mockResolvedValue({
      common: {
        title: "Song",
        artist: "Artist",
        picture: [{ format: "image/jpeg", data: new Uint8Array([1, 2, 3]) }],
      },
      format: { duration: 60 },
    });
    mockUploadFile.mockResolvedValue({ path: "user-1/song.mp3" });

    const results = await uploadAttachments([makeFile("song.mp3", "audio/mpeg")]);

    expect(results[0].coverArt).toMatch(/^user-1\//);
    // One upload for the audio itself, one for the cover art.
    expect(mockUploadFile).toHaveBeenCalledTimes(2);
  });

  it("falls back to the original file when image preparation fails", async () => {
    mockPrepareMessengerImage.mockRejectedValue(new Error("decode failed"));
    mockUploadFile.mockResolvedValue({ path: "user-1/photo.jpg", variants });
    const file = makeFile("photo.jpg", "image/jpeg");

    const results = await uploadAttachments([file]);

    expect(mockToast.warning).toHaveBeenCalled();
    expect(results[0].mime).toBe("image/jpeg");
    // Upload still happens with the original file.
    expect(mockUploadFile).toHaveBeenCalled();
  });

  it("reports progress from 2% through upload to 100%", async () => {
    mockUploadFile.mockImplementation(
      async (_bucket: string, _key: string, _file: File, _token?: string, _prepare?: boolean, onProgress?: (p: number) => void) => {
        onProgress?.(50);
        return { path: "user-1/photo.webp", variants };
      },
    );
    const progress: Array<{ index: number; percent: number }> = [];
    const onProgress = (p: { index: number; name: string; percent: number }) => progress.push({ index: p.index, percent: p.percent });

    await uploadAttachments([makeFile("photo.png", "image/png")], "content", onProgress);

    expect(progress[0].percent).toBe(2);
    expect(progress[progress.length - 1].percent).toBe(100);
    expect(progress.some((p) => p.percent > 2 && p.percent < 100)).toBe(true);
  });

  // Videos are transcoded server-side after the bytes arrive: the progress
  // flow must go upload → processing → done so the UI can show a "waiting"
  // state instead of a frozen bar at 95%.
  it("signals a processing phase for videos while the server transcodes", async () => {
    mockUploadFile.mockImplementation(
      async (_b: string, _k: string, _f: File, _t?: string, _p?: boolean, _onProgress?: (p: number) => void, onUploadComplete?: () => void) => {
        // The body reached the server (no further byte progress) — this is
        // what triggers the "processing" phase.
        onUploadComplete?.();
        return {
          path: "user-1/clip.mp4",
          video: { poster_key: "user-1/clip.mp4.poster.jpg", content_type: "video/mp4" },
        };
      },
    );
    const phases: string[] = [];
    const onProgress = (p: { index: number; name: string; percent: number; phase?: string }) => {
      if (p.phase) phases.push(p.phase);
    };

    await uploadAttachments([makeFile("clip.mp4", "video/mp4")], "content", onProgress);

    expect(phases).toEqual(["upload", "processing", "done"]);
  });

  it("processes multiple files in order", async () => {
    mockUploadFile.mockResolvedValue({ path: "key", variants });

    const results = await uploadAttachments([
      makeFile("one.png", "image/png"),
      makeFile("two.txt", "text/plain"),
    ]);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.type)).toEqual(["image", "file"]);
    expect(mockUploadFile).toHaveBeenCalledTimes(2);
  });
});

// Import after mocks are installed (hoisted) so the module sees them.
import { uploadAttachments } from "./mediaUpload";
