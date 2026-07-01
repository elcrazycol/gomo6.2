/**
 * Convert any image file to SVG code on the client side.
 *
 * Strategy: load the image onto an off-screen <canvas>, export as a
 * data-URI, then embed that data-URI inside an <svg><image> wrapper.
 *
 * The resulting SVG is fully self-contained — no external references,
 * no server round-trips, works for ANY raster format (png, jpg, gif,
 * webp, bmp, avif, …).
 *
 * For files that are already SVG we just return their text content
 * (optionally normalised with width/height if missing).
 */

const MAX_DIMENSION = 512;

export interface ImageToSvgResult {
  /** The SVG markup string ready to paste into the icon field */
  svg: string;
  /** Original image width in px */
  originalWidth: number;
  /** Original image height in px */
  originalHeight: number;
  /** Whether the input was already SVG */
  wasVector: boolean;
}

/**
 * Detect whether a MIME type or filename extension represents an SVG.
 */
export function isSvgFile(file: File): boolean {
  return (
    file.type === "image/svg+xml" ||
    file.name.toLowerCase().endsWith(".svg")
  );
}

/**
 * Read a file and return its text content.
 */
async function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/**
 * Read a file and return a data-URI string.
 */
async function readAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Load an image source (data-URI / URL) into an HTMLImageElement.
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

/**
 * Ensure an SVG string has width / height attributes so it renders at a
 * predictable size when used inline as an icon.
 */
function normaliseSvg(svg: string, fallbackW: number, fallbackH: number): string {
  let result = svg;

  // If no width or height, inject viewBox + width/height
  if (!/\bwidth\s*=/.test(result)) {
    // Try to infer from viewBox
    const vbMatch = result.match(/viewBox\s*=\s*"([^"]+)"/);
    if (vbMatch) {
      const parts = vbMatch[1].trim().split(/\s+/);
      if (parts.length === 4) {
        result = result.replace(/<svg/, `<svg width="${parts[2]}" height="${parts[3]}"`);
      } else {
        result = result.replace(/<svg/, `<svg width="${fallbackW}" height="${fallbackH}"`);
      }
    } else {
      // No viewBox either — add both
      result = result.replace(
        /<svg/,
        `<svg width="${fallbackW}" height="${fallbackH}" viewBox="0 0 ${fallbackW} ${fallbackH}"`,
      );
    }
  }

  if (!/\bviewBox\s*=/.test(result)) {
    result = result.replace(
      /<svg/,
      `<svg viewBox="0 0 ${fallbackW} ${fallbackH}"`,
    );
  }

  return result;
}

/**
 * Main entry point: accepts a File (any image format) and returns SVG
 * markup that visually reproduces the image.
 */
export async function convertImageToSvg(file: File): Promise<ImageToSvgResult> {
  // ── Already SVG ────────────────────────────────────────────────
  if (isSvgFile(file)) {
    const text = await readAsText(file);
    // Try to extract dimensions
    const vbMatch = text.match(/viewBox\s*=\s*"([^"]+)"/);
    let w = 24, h = 24;
    if (vbMatch) {
      const parts = vbMatch[1].trim().split(/\s+/);
      if (parts.length === 4) {
        w = parseFloat(parts[2]) || 24;
        h = parseFloat(parts[3]) || 24;
      }
    }
    const wMatch = text.match(/\bwidth\s*=\s*"([^"]+)"/);
    const hMatch = text.match(/\bheight\s*=\s*"([^"]+)"/);
    if (wMatch) w = parseFloat(wMatch[1]) || w;
    if (hMatch) h = parseFloat(hMatch[1]) || h;

    return {
      svg: normaliseSvg(text, w, h),
      originalWidth: w,
      originalHeight: h,
      wasVector: true,
    };
  }

  // ── Raster image ───────────────────────────────────────────────
  const dataUri = await readAsDataUri(file);
  const img = await loadImage(dataUri);

  const { width: origW, height: origH } = img;

  // Render onto canvas (optionally down-scaled for very large images)
  let targetW = origW;
  let targetH = origH;
  if (targetW > MAX_DIMENSION || targetH > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(targetW, targetH);
    targetW = Math.round(targetW * scale);
    targetH = Math.round(targetH * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");

  ctx.drawImage(img, 0, 0, targetW, targetH);
  const resultDataUri = canvas.toDataURL("image/png");

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${targetW}" height="${targetH}" viewBox="0 0 ${targetW} ${targetH}">`,
    `  <image href="${resultDataUri}" width="${targetW}" height="${targetH}" />`,
    `</svg>`,
  ].join("\n");

  return {
    svg,
    originalWidth: origW,
    originalHeight: origH,
    wasVector: false,
  };
}

/**
 * Accept image from a data-URI string (e.g. from clipboard) instead of File.
 */
export async function convertDataUriToSvg(dataUri: string): Promise<ImageToSvgResult> {
  const img = await loadImage(dataUri);
  const { width: origW, height: origH } = img;

  let targetW = origW;
  let targetH = origH;
  if (targetW > MAX_DIMENSION || targetH > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(targetW, targetH);
    targetW = Math.round(targetW * scale);
    targetH = Math.round(targetH * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");

  ctx.drawImage(img, 0, 0, targetW, targetH);
  const resultDataUri = canvas.toDataURL("image/png");

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${targetW}" height="${targetH}" viewBox="0 0 ${targetW} ${targetH}">`,
    `  <image href="${resultDataUri}" width="${targetW}" height="${targetH}" />`,
    `</svg>`,
  ].join("\n");

  return {
    svg,
    originalWidth: origW,
    originalHeight: origH,
    wasVector: false,
  };
}
