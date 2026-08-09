import { useEffect, useState } from "react";
import { storageUrl } from "@/utils/storage";
import { apiClient } from "@/integrations/api/client";
import {
  getAttachmentAspectRatio as getCachedAspectRatio,
  rememberAttachmentAspectRatio,
  fallbackAttachmentAspectRatio,
} from "@/utils/attachmentRatioCache";
import type { Attachment } from "./types";

// ─── Shared media helpers ───────────────────────────────────────────────────
// Extracted from MessageContent so the carousel and the lightbox can reuse the
// exact same fetch/auth/ratio logic without circular imports.

export function parseImageMeta(attachment: Attachment): {
  width?: number;
  height?: number;
  preview_key?: string;
  lqip?: string;
} {
  if (!attachment.meta) return {};
  try {
    const parsed = JSON.parse(attachment.meta) as Record<string, unknown>;
    return {
      ...(typeof parsed.width === "number" ? { width: parsed.width } : {}),
      ...(typeof parsed.height === "number" ? { height: parsed.height } : {}),
      ...(typeof parsed.preview_key === "string" ? { preview_key: parsed.preview_key } : {}),
      ...(typeof parsed.lqip === "string" && parsed.lqip.startsWith("data:image/") ? { lqip: parsed.lqip } : {}),
    };
  } catch {
    return {};
  }
}

const decodeImageWithTimeout = async (url: string, timeoutMs = 5000): Promise<void> => {
  const image = new Image();
  image.src = url;
  if (typeof image.decode !== "function") return;

  let timer: number | undefined;
  try {
    await Promise.race([
      image.decode(),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error("Image decode timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
};

/**
 * Fetch an attachment through the authenticated storage endpoint and expose it
 * as a blob object URL. The blob is decoded before it is swapped into the DOM
 * so the CSS blur-up transition begins only with a renderable preview, and the
 * object URL is revoked on unmount / re-run.
 */
export function useAuthenticatedAttachmentUrl(attachment: Attachment, requestedKey = attachment.url, enabled = true): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    const controller = new AbortController();
    if (!enabled) {
      setObjectUrl(null);
      return () => controller.abort();
    }

    const sourceUrl = storageUrl("uploads", requestedKey);
    const token = apiClient.getToken();
    if (!sourceUrl || (!token && !apiClient.getCSRFToken())) {
      setObjectUrl(null);
      return () => controller.abort();
    }

    const load = async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let candidateUrl: string | null = null;
        try {
          const response = await fetch(sourceUrl, {
            credentials: "include",
            signal: controller.signal,
            headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          });
          if (!response.ok) throw new Error(`Attachment request failed: ${response.status}`);
          const blob = await response.blob();
          candidateUrl = URL.createObjectURL(blob);

          if (blob.type.startsWith("image/")) {
            await decodeImageWithTimeout(candidateUrl);
          }
          if (cancelled) {
            URL.revokeObjectURL(candidateUrl);
            return;
          }
          createdUrl = candidateUrl;
          setObjectUrl(candidateUrl);
          return;
        } catch (error) {
          if (candidateUrl) URL.revokeObjectURL(candidateUrl);
          lastError = error;
          if (controller.signal.aborted || attempt === 2) break;
          await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
        }
      }
      if (!cancelled && !controller.signal.aborted) {
        setObjectUrl(null);
        console.debug("Attachment preview failed after retries", lastError);
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [attachment.url, requestedKey, enabled]);

  return objectUrl;
}

export function getAttachmentAspectRatio(attachment: Attachment): number {
  const parsed = parseImageMeta(attachment);
  if (parsed.width && parsed.height && parsed.width > 0 && parsed.height > 0) {
    return parsed.width / parsed.height;
  }

  // Old photos have no width/height in the payload. Use the remembered ratio
  // from a previous session so the reserved space matches on re-opens.
  const remembered = getCachedAspectRatio(attachment.url);
  if (remembered !== null) return remembered;

  return attachment.type === "video" ? 16 / 9 : 4 / 3;
}

export function getAttachmentDisplayWidth(aspectRatio: number, viewportHeight: number): number {
  if (typeof window === "undefined") return Math.min(640, 640 * aspectRatio);
  // Keep very tall photos inside the viewport while retaining their exact
  // proportions. The CSS max-width still lets the chat column shrink this
  // value further on narrow screens.
  const maxHeight = Math.min(viewportHeight * 0.68, 640);
  return Math.min(640, Math.max(1, maxHeight * aspectRatio));
}

export function rememberMeasuredAttachmentRatio(attachment: Attachment, ratio: number): void {
  if (ratio <= 0 || !Number.isFinite(ratio)) return;
  rememberAttachmentAspectRatio(
    attachment.url,
    ratio,
    fallbackAttachmentAspectRatio(attachment.type === "video" ? "video" : "image"),
  );
}
