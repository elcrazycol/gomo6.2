// Pure S3-compatible storage layer.
// All file operations go through backend → Garage. No direct browser-to-S3.
// Replaces all scattered api.storage.from() calls across the app.
//
// Usage:
//   import { storageUrl, uploadFile } from "@/utils/storage";
//
//   // Display:
//   <img src={storageUrl("post-images", avatarUrl)} />
//
//   // Upload:
//   const { path } = await uploadFile("post-images", `${userId}/avatar.jpg`, file);
//
//   // Public URL (for storing in DB):
//   const url = storageUrl("content", fileKey);

import { apiClient } from "@/integrations/api/client";
import { prepareMessengerImage } from "@/lib/imageProcessing";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

const isHttpUrl = (v: string) => /^https?:\/\//i.test(v);

/**
 * A logged-in browser session is signaled by the CSRF cookie the backend sets
 * next to the HttpOnly auth cookies (the same hint the API client uses to
 * decide whether to attempt a refresh). Its absence means anonymous.
 */
const hasSessionCookie = (): boolean => apiClient.getCSRFToken() !== null;

/**
 * Convert a (bucket, key) pair into a backend URL for displaying files.
 * If the value already looks like an absolute URL, returns it unchanged.
 *
 * Wall media lives in a private bucket: the /storage/v1/object/wall route
 * requires an authenticated session, so anonymous visitors would get 401 on
 * every wall photo. Guests are served the public /og/wall proxy instead,
 * which enforces the exact same per-wall visibility predicate (private walls
 * stay unreadable even with a known key) and is IP-rate-limited.
 */
export const storageUrl = (bucket: string, keyOrUrl?: string | null): string | null => {
  if (!keyOrUrl) return null;
  const v = keyOrUrl.trim();
  if (!v) return null;

  // Messenger uploads must never fall back to an arbitrary third-party URL.
  // Public legacy buckets may still contain absolute URLs during migration.
  if (isHttpUrl(v)) return bucket === "uploads" ? null : v;

  // Already a relative API path
  if (v.startsWith("/storage/v1/")) {
    if (v.startsWith("/storage/v1/object/wall/") && !hasSessionCookie()) {
      return `${API_BASE_URL}${v.replace("/storage/v1/object/wall/", "/og/wall/")}`;
    }
    return `${API_BASE_URL}${v}`;
  }
  if (v.startsWith(`${API_BASE_URL}/storage/v1/`)) return v;

  const encodedKey = v
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/");

  if (bucket === "wall" && !hasSessionCookie()) {
    return `${API_BASE_URL}/og/wall/${encodedKey}`;
  }
  return `${API_BASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedKey}`;
};

/**
 * Upload a file to the backend, which stores it server-side in Garage (S3-compatible).
 * Returns { path: key } on success — same shape as api.storage.from().upload().
 *
 * @param bucket — S3 bucket name (must be in backend allowlist)
 * @param key — object key (path within bucket)
 * @param file — File to upload
 * @param token — optional Bearer token for non-browser API clients. Browser sessions use HttpOnly cookies.
 *
 * Throws on failure (no error-object pattern — use try/catch).
 */
export type UploadedImageVariants = {
  preview_key: string;
  lqip: string;
  thumb_hash?: string;
  width: number;
  height: number;
  content_type: string;
};

export type UploadFileResult = {
  path: string;
  variants?: UploadedImageVariants;
  video?: { poster_key: string; content_type: string };
};

type UploadBody = {
  data?: { key?: string; variants?: UploadedImageVariants; video?: { poster_key: string; content_type: string } };
  error?: string;
};

const toResult = (body: UploadBody, fallbackKey: string, ok: boolean, status?: number): UploadFileResult => {
  if (!ok) {
    throw new Error(body.error || `Upload failed${status ? `: ${status}` : ""}`);
  }
  return {
    path: body.data?.key || fallbackKey,
    ...(body.data?.variants ? { variants: body.data.variants } : {}),
    ...(body.data?.video ? { video: body.data.video } : {}),
  };
};

// fetch() exposes no upload progress, so callers that need it (messenger
// attachment progress) go through XHR instead. Cookies + CSRF behave the same.
function uploadWithProgress(
  url: string,
  formData: FormData,
  headers: Record<string, string>,
  fallbackKey: string,
  onProgress: (percent: number) => void,
  onUploadComplete?: () => void,
): Promise<UploadFileResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    // Fires when the request body (the whole file) has reached the server but
    // BEFORE the server replies — i.e. while it is still processing (for
    // videos: the ffmpeg transcode). Lets the UI switch to a clear
    // "processing" state instead of freezing on the last byte percentage.
    xhr.upload.onload = () => {
      onUploadComplete?.();
    };
    xhr.onload = () => {
      let body: UploadBody = {};
      try {
        body = JSON.parse(xhr.responseText) as UploadBody;
      } catch {
        // non-JSON response
      }
      resolve(toResult(body, fallbackKey, xhr.status >= 200 && xhr.status < 300, xhr.status));
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(formData);
  });
}

export const uploadFile = async (
  bucket: string,
  key: string,
  file: File,
  token?: string,
  prepareImage = true,
  onProgress?: (percent: number) => void,
  onUploadComplete?: () => void,
): Promise<UploadFileResult> => {
  const safeBucket = bucket.trim();
  let safeKey = key.replace(/^\/+/, "");
  let uploadSource = file;

  // Keep all normal image upload callers on the same storage policy. Messenger
  // and mediaUpload already prepare their files explicitly, so they pass false
  // to avoid a second lossy encode.
  const canPrepare = prepareImage && ["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type);
  if (canPrepare) {
    try {
      const prepared = await prepareMessengerImage(file);
      uploadSource = prepared.file;
      if (prepared.compressed && uploadSource.type === "image/webp") {
        safeKey = safeKey.replace(/\.[^/.]+$/, ".webp");
      }
    } catch {
      // Preserve existing upload behavior when a browser cannot decode an
      // uncommon image format; the backend still validates and serves it.
    }
  }

  const formData = new FormData();
  formData.append("file", uploadSource);
  formData.append("bucket", safeBucket);
  formData.append("key", safeKey);

  // Browser sessions authenticate with HttpOnly cookies; explicit tokens are
  // retained only for non-browser/API clients.
  const headers: Record<string, string> = {};
  const authToken = token || null;
  const csrf = apiClient.getCSRFToken();
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  if (csrf) headers["X-CSRF-Token"] = csrf;

  const url = `${API_BASE_URL}/storage/v1/upload`;

  // Real upload progress requires XHR — fetch has none.
  if (onProgress || onUploadComplete) {
    return uploadWithProgress(url, formData, headers, safeKey, onProgress, onUploadComplete);
  }

  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers,
    body: formData,
  });

  const body = typeof res.json === "function"
    ? await res.json().catch(() => ({})) as UploadBody
    : {};
  return toResult(body, safeKey, res.ok, res.status);
};

/**
 * Get a public URL for a stored file.
 * This constructs the backend URL — files are served via /storage/v1/object/<bucket>/<key>.
 */
export const getPublicUrl = (bucket: string, key: string): { publicUrl: string } => {
  const url = storageUrl(bucket, key);
  return { publicUrl: url || "" };
};

// The admin dashboard uploads gift catalog images and upgrade layers to the
// admin-managed `gift-layers` bucket under keys like `gifts/<id>/base.png`,
// and stores the literal placeholder "pending" while an upload is in flight
// (and on upload failures). Treat that placeholder as "no image" so the UI
// never fires a request for it.
const GIFT_PENDING_PLACEHOLDER = "pending";

/**
 * Resolve a gift catalog image / upgrade-layer key to a display URL.
 * Returns null when there is no usable image (empty, whitespace, or the
 * admin's "pending" placeholder) — callers should render their fallback.
 */
export const giftImageUrl = (keyOrUrl?: string | null): string | null => {
  if (!keyOrUrl) return null;
  const v = keyOrUrl.trim();
  if (!v || v.toLowerCase() === GIFT_PENDING_PLACEHOLDER) return null;
  return storageUrl("gift-layers", v) || v;
};

/**
 * Delete a file from S3-compatible storage.
 *
 * @param bucket — S3 bucket name
 * @param key — object key to delete
 * @param token — optional Bearer token. Falls back to auth_token from localStorage.
 *
 * Throws on failure.
 */
export const removeFile = async (
  bucket: string,
  key: string,
  token?: string,
): Promise<void> => {
  const safeBucket = encodeURIComponent(bucket.trim());
  const safeKey = key
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/");

  const headers: Record<string, string> = {};
  const authToken = token || null;
  const csrf = apiClient.getCSRFToken();
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  if (csrf) headers["X-CSRF-Token"] = csrf;

  const res = await fetch(
    `${API_BASE_URL}/storage/v1/object/${safeBucket}/${safeKey}`,
    { method: "DELETE", credentials: "include", headers },
  );

  if (!res.ok && res.status !== 404) {
    const body = await res.json().catch(() => ({}));
    const message = ((body as Record<string, unknown>)?.error as string) || `Delete failed: ${res.status}`;
    throw new Error(message);
  }
};
