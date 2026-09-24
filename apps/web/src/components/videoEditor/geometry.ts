import { ASPECT_PRESETS, type AspectPreset, type CropRect } from "./types";

/** Smallest allowed crop window, as a fraction of the frame. */
export const MIN_CROP = 0.05;

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

export type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Pixel aspect ratio for a preset, or null for the free-form option. */
export function pixelAspectOf(preset: AspectPreset): number | null {
  return ASPECT_PRESETS.find((p) => p.id === preset)?.ratio ?? null;
}

/**
 * Fraction ratio (w/h) that yields a crop of the given pixel aspect inside a
 * video whose displayed aspect is `videoAspect` (width / height). Fractions are
 * relative to width and height separately, so a pixel aspect A maps to
 * A / videoAspect.
 */
export function fractionRatio(pixelAspect: number, videoAspect: number): number {
  if (videoAspect <= 0) return pixelAspect;
  return pixelAspect / videoAspect;
}

export function isFullCrop(c: CropRect): boolean {
  return c.x <= 0.001 && c.y <= 0.001 && c.w >= 0.999 && c.h >= 0.999;
}

/** Largest centered crop with the preset's pixel aspect. */
export function centeredCrop(videoAspect: number, preset: AspectPreset): CropRect {
  const pixelAspect = pixelAspectOf(preset);
  if (pixelAspect == null || videoAspect <= 0) return { ...FULL_CROP };
  const ratio = fractionRatio(pixelAspect, videoAspect);
  let w = 1;
  let h = 1;
  if (ratio >= 1) h = 1 / ratio;
  else w = ratio;
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

/** Translate the crop window, clamped inside the frame. */
export function moveCrop(start: CropRect, dx: number, dy: number): CropRect {
  return {
    ...start,
    x: clamp(start.x + dx, 0, 1 - start.w),
    y: clamp(start.y + dy, 0, 1 - start.h),
  };
}

/**
 * Resize the crop window by dragging a handle. `dx`/`dy` are pointer deltas as
 * fractions of the stage size. `ratio` is the locked fraction w/h (0 = free).
 * Locked resizing anchors the opposite corner (or edge) and keeps the window
 * inside the frame by shifting rather than shrinking.
 */
export function resizeCrop(
  start: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  ratio: number,
): CropRect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  const moveL = handle.includes("w");
  const moveR = handle.includes("e");
  const moveT = handle.includes("n");
  const moveB = handle.includes("s");

  if (moveL) left = clamp(left + dx, 0, right - MIN_CROP);
  if (moveR) right = clamp(right + dx, left + MIN_CROP, 1);
  if (moveT) top = clamp(top + dy, 0, bottom - MIN_CROP);
  if (moveB) bottom = clamp(bottom + dy, top + MIN_CROP, 1);

  if (ratio > 0) {
    let w = right - left;
    let h = bottom - top;
    // Fit the requested aspect into the proposed box (grow the smaller axis).
    if (w / ratio >= h) h = w / ratio;
    else w = h * ratio;
    w = Math.min(w, 1);
    h = Math.min(h, 1);

    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const horizontal = moveL || moveR;
    const vertical = moveT || moveB;
    if (horizontal && vertical) {
      // Corner: keep the opposite corner pinned.
      if (moveL) left = right - w;
      else right = left + w;
      if (moveT) top = bottom - h;
      else bottom = top + h;
    } else if (horizontal) {
      // Left/right edge: expand symmetrically in the vertical axis.
      if (moveL) left = right - w;
      else right = left + w;
      top = cy - h / 2;
      bottom = cy + h / 2;
    } else {
      // Top/bottom edge: expand symmetrically in the horizontal axis.
      if (moveT) top = bottom - h;
      else bottom = top + h;
      left = cx - w / 2;
      right = cx + w / 2;
    }

    // Shift (never resize) back inside the frame, preserving the aspect.
    if (left < 0) {
      right -= left;
      left = 0;
    }
    if (top < 0) {
      bottom -= top;
      top = 0;
    }
    if (right > 1) {
      left -= right - 1;
      right = 1;
    }
    if (bottom > 1) {
      top -= bottom - 1;
      bottom = 1;
    }
  }

  left = clamp(left, 0, 1);
  top = clamp(top, 0, 1);
  right = clamp(right, left + MIN_CROP, 1);
  bottom = clamp(bottom, top + MIN_CROP, 1);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
