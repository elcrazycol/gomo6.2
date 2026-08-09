import { describe, expect, it } from "vitest";
import { chunkAttachments, MAX_ALBUM_ATTACHMENTS } from "./attachmentAlbum";
import type { Attachment } from "./types";

function attachment(index: number): Attachment {
  return {
    id: `a-${index}`,
    url: `photo-${index}.jpg`,
    type: "image",
    name: `photo-${index}.jpg`,
    size: 1,
    mime: "image/jpeg",
  };
}

describe("chunkAttachments", () => {
  it("keeps six attachments in one album", () => {
    const result = chunkAttachments(Array.from({ length: 6 }, (_, index) => attachment(index)));
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(MAX_ALBUM_ATTACHMENTS);
  });

  it("splits seven attachments into 6 + 1 in order", () => {
    const result = chunkAttachments(Array.from({ length: 7 }, (_, index) => attachment(index)));
    expect(result.map((chunk) => chunk.map((item) => item.id))).toEqual([
      ["a-0", "a-1", "a-2", "a-3", "a-4", "a-5"],
      ["a-6"],
    ]);
  });

  it("returns no chunks for an empty selection", () => {
    expect(chunkAttachments([])).toEqual([]);
  });
});
