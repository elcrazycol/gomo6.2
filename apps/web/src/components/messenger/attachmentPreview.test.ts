import { describe, expect, it } from "vitest";
import { attachmentPreviewText } from "./attachmentPreview";
import type { Attachment } from "./types";

const image = (name = "a.jpg"): Attachment => ({ id: name, url: `u/${name}`, type: "image", name, size: 1, mime: "image/jpeg" });
const video = (): Attachment => ({ id: "v", url: "u/v.mp4", type: "video", name: "v.mp4", size: 1, mime: "video/mp4" });
const voice = (): Attachment => ({ id: "vo", url: "u/v.weba", type: "audio", name: "v.weba", size: 1, mime: "audio/webm", meta: '{"voice":true,"duration":3}' });
const audio = (): Attachment => ({ id: "au", url: "u/a.mp3", type: "audio", name: "a.mp3", size: 1, mime: "audio/mpeg" });
const file = (): Attachment => ({ id: "f", url: "u/a.pdf", type: "file", name: "a.pdf", size: 1, mime: "application/pdf" });

describe("attachmentPreviewText", () => {
  it("names photos and albums like the server does", () => {
    expect(attachmentPreviewText([image()])).toBe("📷 Фото");
    expect(attachmentPreviewText([image("a"), image("b")])).toBe("📷 2 фото");
  });

  it("names videos, voice notes, audio and files", () => {
    expect(attachmentPreviewText([video()])).toBe("🎬 Видео");
    expect(attachmentPreviewText([voice()])).toBe("Голосовое сообщение");
    expect(attachmentPreviewText([audio()])).toBe("🎵 Аудио");
    expect(attachmentPreviewText([file()])).toBe("📎 a.pdf");
  });

  it("falls back to a file count for mixed attachments and handles an empty list", () => {
    expect(attachmentPreviewText([image(), file()])).toBe("📎 2 файлов");
    expect(attachmentPreviewText([])).toBe("");
  });
});
