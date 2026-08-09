const MAX_STATIC_UPLOAD_SIZE = 20 * 1024 * 1024;
const MAX_ANIMATED_UPLOAD_SIZE = 5 * 1024 * 1024;
const MAX_STATIC_OUTPUT_SIZE = 128 * 1024;
const MAX_ANIMATED_SIZE = 512 * 1024;
const MAX_DIMENSION = 128;

export interface CompressionResult {
  file: File;
  width: number;
  height: number;
  isAnimated: boolean;
  originalBytes: number;
  outputBytes: number;
}

const isAnimatedType = (type: string) => type === 'image/gif' || type === 'image/webp';

/** Detect animation without decoding/re-encoding the asset. Canvas only draws
 * the first frame, so this distinction must happen before processing. */
async function detectAnimation(file: File): Promise<boolean> {
  if (file.type === 'image/gif') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length < 13) return true;
    let offset = 13;
    const packed = bytes[10];
    if (packed & 0x80) offset += 3 * (2 ** ((packed & 0x07) + 1));
    let frames = 0;
    while (offset < bytes.length) {
      const marker = bytes[offset++];
      if (marker === 0x2c) {
        // Image descriptor: left, top, width, height, packed.
        if (offset + 9 > bytes.length) return true;
        frames++;
        const descriptorPacked = bytes[offset + 8];
        offset += 9;
        if (descriptorPacked & 0x80) offset += 3 * (2 ** ((descriptorPacked & 0x07) + 1));
        if (offset >= bytes.length) return true;
        offset++; // LZW minimum code size.
        while (offset < bytes.length) {
          const blockSize = bytes[offset++];
          if (blockSize === 0) break;
          offset += blockSize;
        }
        if (frames > 1) return true;
      } else if (marker === 0x21) {
        // Extension: skip label and data sub-blocks.
        if (offset >= bytes.length) return true;
        offset++;
        while (offset < bytes.length) {
          const blockSize = bytes[offset++];
          if (blockSize === 0) break;
          offset += blockSize;
        }
      } else if (marker === 0x3b) {
        return false;
      } else {
        return true;
      }
    }
    return true;
  }

  if (file.type === 'image/webp') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length < 16 || String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...bytes.slice(8, 12)) !== 'WEBP') return true;
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const chunk = String.fromCharCode(...bytes.slice(offset, offset + 4));
      const size = bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24);
      if (chunk === 'ANIM') return true;
      if (chunk === 'VP8X' && offset + 9 < bytes.length) return (bytes[offset + 8 + 0] & 0x02) !== 0;
      offset += 8 + size + (size & 1);
    }
  }
  // A valid RIFF/WEBP container without ANIM/VP8X animation flags is static.
  // Unknown GIF/WebP containers are handled conservatively.
  return file.type === 'image/gif';
}

const readImageSize = (file: File): Promise<{ width: number; height: number }> => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Не удалось прочитать изображение'));
  };
  img.src = url;
});

const toWebp = (canvas: HTMLCanvasElement, quality: number): Promise<Blob> => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Не удалось сжать изображение')), 'image/webp', quality);
});

/**
 * Normalizes static images locally. Canvas deliberately handles only static
 * images: drawing an animated GIF/WebP would silently destroy the animation.
 */
async function processStaticEmoji(file: File): Promise<CompressionResult> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    });
    img.src = url;
    await loaded;

    const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Браузер не поддерживает обработку изображений');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    let quality = 0.9;
    let blob = await toWebp(canvas, quality);
    while (blob.size > MAX_STATIC_OUTPUT_SIZE && quality > 0.45) {
      quality -= 0.1;
      blob = await toWebp(canvas, quality);
    }
    if (blob.size > MAX_STATIC_OUTPUT_SIZE) {
      throw new Error('Не удалось сжать изображение до 128 КБ. Попробуйте картинку попроще.');
    }

    const outputName = file.name.replace(/\.[^.]+$/, '') || 'emoji';
    const output = new File([blob], `${outputName}.webp`, { type: 'image/webp' });
    return {
      file: output,
      width,
      height,
      isAnimated: false,
      originalBytes: file.size,
      outputBytes: output.size,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Animated assets are kept lossless on the client because Canvas cannot encode
 * animation. We still normalize metadata and enforce a generous, practical cap.
 */
async function processAnimatedEmoji(file: File): Promise<CompressionResult> {
  const { width, height } = await readImageSize(file);
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error(`Анимация больше ${MAX_DIMENSION}×${MAX_DIMENSION}px. Уменьшите её перед загрузкой.`);
  }
  if (file.size > MAX_ANIMATED_SIZE) {
    throw new Error(`Анимация больше ${(MAX_ANIMATED_SIZE / 1024).toFixed(0)} КБ. Сожмите GIF/WebP и повторите.`);
  }
  return { file, width, height, isAnimated: true, originalBytes: file.size, outputBytes: file.size };
}

export async function processEmojiImage(file: File): Promise<CompressionResult> {
  return isAnimatedType(file.type) && await detectAnimation(file)
    ? processAnimatedEmoji(file)
    : processStaticEmoji(file);
}

export function validateEmojiFile(file: File): { valid: boolean; error?: string } {
  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(file.type)) {
    return { valid: false, error: 'Поддерживаются PNG, JPG, WebP и GIF.' };
  }

  // GIF/WebP may be animated, so keep their input cap conservative until the
  // browser has inspected the container. Static PNG/JPEG files get the larger
  // source allowance and are reduced locally to the output cap.
  const maxSize = isAnimatedType(file.type) ? MAX_ANIMATED_UPLOAD_SIZE : MAX_STATIC_UPLOAD_SIZE;
  if (file.size > maxSize) {
    return { valid: false, error: `Файл слишком большой: ${(file.size / 1024 / 1024).toFixed(1)} МБ (максимум ${maxSize / 1024 / 1024} МБ)` };
  }
  return { valid: true };
}

export const EMOJI_LIMITS = {
  maxDimension: MAX_DIMENSION,
  staticOutputBytes: MAX_STATIC_OUTPUT_SIZE,
  animatedBytes: MAX_ANIMATED_SIZE,
} as const;
