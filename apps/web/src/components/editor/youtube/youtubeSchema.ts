// YouTube embed node: schema helpers + URL parsing.
//
// A post stores only the 11-char video id; the embed/thumbnail URLs are derived.
// Playback is a click-to-load facade (youtube-nocookie) so nothing loads from
// YouTube until the reader presses play.

export const YOUTUBE_EMBED_NODE = "youtubeEmbed";

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export const isYouTubeId = (value: unknown): value is string =>
  typeof value === "string" && VIDEO_ID_RE.test(value);

/**
 * Extract a YouTube video id from a URL (watch/shorts/live/embed/youtu.be) or a
 * bare id. Returns null when the input is not a recognizable video reference.
 */
export const parseYouTubeId = (input: string): string | null => {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  if (VIDEO_ID_RE.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return isYouTubeId(id) ? id : null;
  }

  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "music.youtube.com") {
    const fromQuery = url.searchParams.get("v");
    if (isYouTubeId(fromQuery)) return fromQuery;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && ["embed", "shorts", "live", "v"].includes(parts[0])) {
      return isYouTubeId(parts[1]) ? parts[1] : null;
    }
  }

  return null;
};

export const youtubeThumbnailUrl = (videoId: string): string =>
  `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

export const youtubeEmbedUrl = (videoId: string): string =>
  `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`;

export const youtubeWatchUrl = (videoId: string): string =>
  `https://www.youtube.com/watch?v=${videoId}`;
