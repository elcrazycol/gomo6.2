// ─── Attachment upload helpers (shared by the paperclip button and drag&drop) ──
import type { Attachment } from "./types";
import type { VideoEdit } from "@/components/videoEditor/types";
import { messengerApi } from "@/services/messengerApi";
import { prepareMessengerImage } from "@/lib/imageProcessing";
import { openVideoEditor } from "@/stores/videoEditorStore";

function detectAttachmentType(file: File): Attachment["type"] {
  // GIFs are transcoded to silent mp4 server-side, so they take the video path.
  if (file.type === "image/gif") return "video";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

/** Per-file upload progress. `index` matches the position in the files array. */
export type AttachmentUploadProgress = {
  index: number;
  name: string;
  percent: number;
};

/**
 * Upload raw files to the messenger backend and build the Attachment objects
 * used by the composer. Images are compressed/processed first so the server
 * returns preview variants. Files that fail to upload are skipped silently —
 * callers can check the returned length against the input.
 *
 * The optional `onProgress` callback fires per file: real bytes progress while
 * the body uploads (capped at 95%) and a final 100% when the server responds.
 */
export async function uploadFilesAsAttachments(
  files: File[],
  onProgress?: (progress: AttachmentUploadProgress) => void,
): Promise<Attachment[]> {
  const attachments: Attachment[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    try {
      const type = detectAttachmentType(file);
      const isGif = file.type === "image/gif";
      const prepared = type === "image" ? await prepareMessengerImage(file) : null;
      const uploadSource = prepared?.file ?? file;
      // Videos get the trim/crop editor before upload (not GIFs — already short
      // loops); the server applies the picked edit during transcoding.
      const videoEdit: VideoEdit | null =
        type === "video" && !isGif ? await openVideoEditor(uploadSource) : null;
      const uploaded = await messengerApi.uploadFile(
        uploadSource,
        (percent) => {
          onProgress?.({
            index,
            name: file.name,
            percent: Math.min(95, Math.max(2, percent)),
          });
        },
        videoEdit,
      );
      onProgress?.({ index, name: file.name, percent: 100 });
      if (type === "image" && !uploaded.variants) {
        throw new Error("Сервер не вернул preview для изображения");
      }
      const imageMeta = type === "image" && uploaded.variants
        ? {
            width: uploaded.variants.width,
            height: uploaded.variants.height,
            preview_key: uploaded.variants.preview_key,
            // ThumbHash (~30 bytes) is the placeholder for new attachments —
            // the LQIP data URL (1-3KB) was dropped to keep the DB payload
            // tiny. Old messages still carry lqip and render through the
            // fallback path.
            thumb_hash: uploaded.variants.thumb_hash,
            pipeline: "messenger-image-v2",
            source_size: file.size,
            stored_size: uploadSource.size,
          }
        : null;
      // Soundless clip (editor "GIF" mode): keep the flag so renderers can
      // later autoplay/loop it without a player.
      const videoMeta = type === "video" && uploaded.video?.animated ? { animated: true } : null;
      attachments.push({
        url: uploaded.path,
        type,
        name: file.name,
        size: uploadSource.size,
        mime: uploadSource.type || file.type || "application/octet-stream",
        ...(imageMeta
          ? { meta: JSON.stringify(imageMeta) }
          : videoMeta
            ? { meta: JSON.stringify(videoMeta) }
            : {}),
      });
    } catch (err) {
      console.error("Upload failed:", err);
    }
  }

  return attachments;
}
