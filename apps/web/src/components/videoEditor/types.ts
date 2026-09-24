/**
 * Video editor contract shared by the UI, the upload pipeline and the backend.
 * Crop is expressed as fractions (0..1) of the displayed frame — the same shape
 * the Go handler parses from the `video_edit` field.
 */
export type CropRect = { x: number; y: number; w: number; h: number };

export type VideoEdit = {
  /** Trim start in seconds. */
  start?: number;
  /** Trim end in seconds. */
  end?: number;
  /** Crop window as fractions of the displayed frame. */
  crop?: CropRect;
  /** Clockwise rotation in degrees: 0, 90, 180 or 270. */
  rotate?: number;
  /** Horizontal mirror. */
  mirror?: boolean;
  /** Drop the audio track (the "GIF" mode). */
  muted?: boolean;
};

export type AspectPreset = "free" | "1:1" | "4:3" | "3:4" | "16:9" | "9:16";

/** Pixel aspect ratio of each preset; `free` has none. */
export const ASPECT_PRESETS: { id: AspectPreset; label: string; ratio: number | null }[] = [
  { id: "free", label: "Свободно", ratio: null },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "3:4", label: "3:4", ratio: 3 / 4 },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
];
