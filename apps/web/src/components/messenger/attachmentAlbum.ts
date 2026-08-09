import type { Attachment } from "./types";

/** The visual album limit used by the messenger composer and renderer. */
export const MAX_ALBUM_ATTACHMENTS = 6;

/** Split pending attachments into ordered message-sized album chunks. */
export function chunkAttachments(attachments: Attachment[], chunkSize = MAX_ALBUM_ATTACHMENTS): Attachment[][] {
  if (chunkSize <= 0 || attachments.length === 0) return [];
  const chunks: Attachment[][] = [];
  for (let index = 0; index < attachments.length; index += chunkSize) {
    chunks.push(attachments.slice(index, index + chunkSize));
  }
  return chunks;
}
