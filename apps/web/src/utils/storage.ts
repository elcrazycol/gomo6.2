const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

const isHttpUrl = (v: string) => /^https?:\/\//i.test(v);

// storage key -> URL via backend redirect.
// If value already looks like a URL, returns it unchanged (for backwards compatibility).
export const storageUrl = (bucket: string, keyOrUrl?: string | null) => {
  if (!keyOrUrl) return null;
  const v = keyOrUrl.trim();
  if (!v) return null;

  if (isHttpUrl(v)) return v;

  // Already a URL on our API (or legacy storage path).
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

