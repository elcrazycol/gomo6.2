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

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

const isHttpUrl = (v: string) => /^https?:\/\//i.test(v);

/**
 * Convert a (bucket, key) pair into a backend URL for displaying files.
 * If the value already looks like an absolute URL, returns it unchanged.
 */
export const storageUrl = (bucket: string, keyOrUrl?: string | null): string | null => {
  if (!keyOrUrl) return null;
  const v = keyOrUrl.trim();
  if (!v) return null;

  // Already an absolute HTTP URL — return as-is
  if (isHttpUrl(v)) return v;

  // Already a relative API path
  if (v.startsWith("/storage/v1/")) return `${API_BASE_URL}${v}`;
  if (v.startsWith(`${API_BASE_URL}/storage/v1/`)) return v;

  const encodedKey = v
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/");

  return `${API_BASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedKey}`;
};

/**
 * Upload a file to the backend, which stores it server-side in Garage (S3-compatible).
 * Returns { path: key } on success — same shape as api.storage.from().upload().
 *
 * @param bucket — S3 bucket name (must be in backend allowlist)
 * @param key — object key (path within bucket)
 * @param file — File to upload
 * @param token — optional Bearer token (prevents stale localStorage read). Falls back to auth_token.
 *
 * Throws on failure (no error-object pattern — use try/catch).
 */
export const uploadFile = async (
  bucket: string,
  key: string,
  file: File,
  token?: string,
): Promise<{ path: string }> => {
  const safeBucket = bucket.trim();
  const safeKey = key.replace(/^\/+/, "");

  const formData = new FormData();
  formData.append("file", file);
  formData.append("bucket", safeBucket);
  formData.append("key", safeKey);

  // Auth: use provided token, or fall back to localStorage
  const headers: Record<string, string> = {};
  const authToken = token || localStorage.getItem("auth_token");
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const res = await fetch(`${API_BASE_URL}/storage/v1/upload`, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = (body as any)?.error || `Upload failed: ${res.status}`;
    throw new Error(message);
  }

  return { path: safeKey };
};

/**
 * Get a public URL for a stored file.
 * This constructs the backend URL — files are served via /storage/v1/object/<bucket>/<key>.
 */
export const getPublicUrl = (bucket: string, key: string): { publicUrl: string } => {
  const url = storageUrl(bucket, key);
  return { publicUrl: url || "" };
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
  const authToken = token || localStorage.getItem("auth_token");
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const res = await fetch(
    `${API_BASE_URL}/storage/v1/object/${safeBucket}/${safeKey}`,
    { method: "DELETE", headers },
  );

  if (!res.ok && res.status !== 404) {
    const body = await res.json().catch(() => ({}));
    const message = (body as any)?.error || `Delete failed: ${res.status}`;
    throw new Error(message);
  }
};
