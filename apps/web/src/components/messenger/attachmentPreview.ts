import type { Attachment } from "./types";

/**
 * Chat-list preview for an attachment-only message — the same wording the
 * server uses (`attachmentPreviewLabel` in backend-go), so the optimistic row
 * does not flip from «📎 1 файлов» to «Фото» after the list refetch.
 */
export function attachmentPreviewText(attachments: Attachment[]): string {
  if (!attachments.length) return "";
  const images = attachments.filter((a) => a.type === "image").length;
  const videos = attachments.filter((a) => a.type === "video").length;
  const voice = attachments.filter((a) => a.type === "audio" && isVoice(a)).length;
  const audio = attachments.filter((a) => a.type === "audio" && !isVoice(a)).length;
  const files = attachments.filter((a) => !["image", "video", "audio"].includes(a.type)).length;

  if (images === attachments.length) return images === 1 ? "📷 Фото" : `📷 ${images} фото`;
  if (videos === attachments.length) return videos === 1 ? "🎬 Видео" : `🎬 ${videos} видео`;
  if (attachments.length === 1) {
    if (voice === 1) return "Голосовое сообщение";
    if (audio === 1) return "🎵 Аудио";
    if (files === 1) return `📎 ${attachments[0].name}`;
  }
  return `📎 ${attachments.length} файлов`;
}

function isVoice(attachment: Attachment): boolean {
  if (!attachment.meta) return false;
  try {
    return (JSON.parse(attachment.meta) as { voice?: unknown }).voice === true;
  } catch {
    return false;
  }
}
