import { useCallback, useEffect, useRef } from "react";
import type { CropRect } from "./types";

const PREVIEW_MAX = 200;

/**
 * Draw one video frame to a canvas, applying the same orientation + crop the
 * backend will bake into the poster, so the preview is frame-for-frame what the
 * stored thumbnail will be.
 */
function renderFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  crop: CropRect,
  rotate: number,
  mirror: boolean,
): string | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  const rot = ((rotate % 360) + 360) % 360;
  const quarter = rot % 180 !== 0;
  const dispW = quarter ? vh : vw;
  const dispH = quarter ? vw : vh;
  const outW = Math.max(1, dispW * crop.w);
  const outH = Math.max(1, dispH * crop.h);
  const scale = Math.min(PREVIEW_MAX / outW, PREVIEW_MAX / outH, 1);

  canvas.width = Math.max(1, Math.round(outW * scale));
  canvas.height = Math.max(1, Math.round(outH * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Canvas transforms post-multiply, so this composes as scale ∘ crop ∘
  // (rotate ∘ mirror) — mirror first then rotate, matching the CSS preview and
  // the backend's hflip/transpose order.
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-crop.x * dispW, -crop.y * dispH);
  ctx.translate(dispW / 2, dispH / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.scale(mirror ? -1 : 1, 1);
  ctx.translate(-vw / 2, -vh / 2);
  ctx.drawImage(video, 0, 0, vw, vh);
  ctx.restore();

  return canvas.toDataURL("image/jpeg", 0.75);
}

/**
 * Returns a function that captures the frame at `time` as a JPEG data URL.
 * Uses a detached, muted <video> so the visible player is never disturbed.
 */
export function useFrameCapture(src: string) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const readyRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    return () => {
      videoRef.current?.removeAttribute("src");
      videoRef.current = null;
      canvasRef.current = null;
      readyRef.current = null;
    };
  }, [src]);

  return useCallback(
    async (time: number, crop: CropRect, rotate: number, mirror: boolean): Promise<string | null> => {
      if (!videoRef.current) {
        const video = document.createElement("video");
        video.src = src;
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        videoRef.current = video;
        canvasRef.current = document.createElement("canvas");
        readyRef.current = new Promise<void>((resolve, reject) => {
          if (video.readyState >= 1 && video.videoWidth > 0) {
            resolve();
            return;
          }
          video.addEventListener("loadedmetadata", () => resolve(), { once: true });
          video.addEventListener("error", () => reject(new Error("frame capture load failed")), {
            once: true,
          });
        });
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !readyRef.current) return null;

      try {
        await readyRef.current;
      } catch {
        return null;
      }

      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          resolve();
        };
        video.addEventListener("seeked", onSeeked);
        video.currentTime = time;
      });

      return renderFrame(video, canvas, crop, rotate, mirror);
    },
    [src],
  );
}
