import { useEffect, useState, type CSSProperties } from "react";
import { thumbHashToDataURL } from "thumbhash";
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
  thumb_hash?: string;
} {
  if (!attachment.meta) return {};
  try {
    const parsed = JSON.parse(attachment.meta) as Record<string, unknown>;
    return {
      ...(typeof parsed.width === "number" ? { width: parsed.width } : {}),
      ...(typeof parsed.height === "number" ? { height: parsed.height } : {}),
      ...(typeof parsed.preview_key === "string" ? { preview_key: parsed.preview_key } : {}),
      ...(typeof parsed.lqip === "string" && parsed.lqip.startsWith("data:image/") ? { lqip: parsed.lqip } : {}),
      ...(typeof parsed.thumb_hash === "string" ? { thumb_hash: parsed.thumb_hash } : {}),
    };
  } catch {
    return {};
  }
}

/**
 * Render a ThumbHash (base64, ~30 bytes) as a small colored PNG data URL that
 * paints instantly — the placeholder for every new messenger image. Pure JS
 * (no canvas), so it works anywhere and costs nothing on re-renders when
 * memoized by the caller. Returns null for missing/garbage hashes (legacy
 * attachments fall back to their LQIP instead).
 */
export function thumbHashToPlaceholderDataUrl(thumbHash?: string): string | null {
  if (!thumbHash) return null;
  try {
    const binary = atob(thumbHash);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return thumbHashToDataURL(bytes);
  } catch {
    return null;
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

/**
 * Stable display size for a single image bubble. The box is sized from the
 * attachment's own width/height ratio ONLY — no visual-viewport reactivity,
 * no max-height clamp fighting the aspect-ratio. The keyboard / URL-bar
 * resizes (which shrink `visualViewport.height` on mobile) can no longer
 * reflow every photo in the list; the reserved space stays put and Virtuoso
 * keeps the exact size. `width` is expressed as `min(100%, Xpx)` so the chat
 * column still shrinks the image on narrow screens without breaking the box.
 *
 * Legacy images without meta keep the remembered/fallback ratio; the box
 * corrects once on first load (see rememberMeasuredAttachmentRatio).
 */
export function getAttachmentDisplayStyle(
  ratio: number,
  opts: { maxWidth?: number; maxHeight?: number } = {},
): CSSProperties {
  const maxWidth = opts.maxWidth ?? 640;
  const maxHeight = opts.maxHeight ?? 480;
  // Tall images cap their WIDTH (never their height) so the aspect-ratio box
  // always matches the real proportions: width = min(maxWidth, maxHeight*ratio).
  const boxWidth = Math.min(maxWidth, Math.max(1, maxHeight * ratio));
  return {
    width: `min(100%, ${Math.round(boxWidth)}px)`,
    aspectRatio: ratio,
    "--attachment-ratio": ratio,
  } as CSSProperties;
}

export function rememberMeasuredAttachmentRatio(attachment: Attachment, ratio: number): void {
  if (ratio <= 0 || !Number.isFinite(ratio)) return;
  rememberAttachmentAspectRatio(
    attachment.url,
    ratio,
    fallbackAttachmentAspectRatio(attachment.type === "video" ? "video" : "image"),
  );
}
