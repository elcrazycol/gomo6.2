import { useEffect, useState } from "react";

const THUMB_WIDTH = 160;

/**
 * Capture `count` evenly spaced frames of a video into JPEG data URLs, for the
 * editor's Telegram-style filmstrip. Uses a detached, muted <video> so the
 * visible player is never disturbed. Frames stream in as they are captured; a
 * failure keeps whatever was already collected.
 */
export function useFilmstrip(src: string, duration: number, count: number): string[] {
  const [frames, setFrames] = useState<string[]>([]);

  useEffect(() => {
    if (!src || !Number.isFinite(duration) || duration <= 0 || count <= 0) {
      setFrames([]);
      return;
    }
    let cancelled = false;
    const video = document.createElement("video");
    video.src = src;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const collected: string[] = [];

    const seek = (time: number) =>
      new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          resolve();
        };
        video.addEventListener("seeked", onSeeked);
        video.currentTime = time;
      });

    const run = async () => {
      if (!ctx) return;
      try {
        await new Promise<void>((resolve, reject) => {
          if (video.readyState >= 1 && video.videoWidth > 0) {
            resolve();
            return;
          }
          video.addEventListener("loadedmetadata", () => resolve(), { once: true });
          video.addEventListener("error", () => reject(new Error("filmstrip load failed")), { once: true });
        });
        if (cancelled) return;

        const ratio = video.videoHeight / video.videoWidth || 9 / 16;
        canvas.width = THUMB_WIDTH;
        canvas.height = Math.max(1, Math.round(THUMB_WIDTH * ratio));

        for (let i = 0; i < count; i += 1) {
          if (cancelled) return;
          const time = Math.min(duration * ((i + 0.5) / count), Math.max(0, duration - 0.05));
          await seek(time);
          if (cancelled) return;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          collected.push(canvas.toDataURL("image/jpeg", 0.6));
          setFrames([...collected]);
        }
      } catch {
        // Keep whatever frames were captured before the failure.
      }
    };

    void run();
    return () => {
      cancelled = true;
      // Drop the source so the detached element stops buffering; the element
      // itself is discarded with the closure.
      video.removeAttribute("src");
    };
  }, [src, duration, count]);

  return frames;
}
