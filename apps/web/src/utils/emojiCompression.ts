const MAX_STATIC_SIZE = 3 * 1024; // 3KB
const MAX_ANIMATED_SIZE = 15 * 1024; // 15KB
const MAX_DIMENSION = 128;
const EMOJI_SIZE = 64;

export interface CompressionResult {
  file: File;
  width: number;
  height: number;
  isAnimated: boolean;
}

export async function processEmojiImage(file: File): Promise<CompressionResult> {
  const isAnimated = file.type === 'image/gif' || file.type === 'image/webp';

  if (isAnimated) {
    return processAnimatedEmoji(file);
  }

  return processStaticEmoji(file);
}

async function processStaticEmoji(file: File): Promise<CompressionResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Cannot get canvas context'));
        return;
      }

      let { width, height } = img;

      if (width > height) {
        if (width > EMOJI_SIZE) {
          height = (height * EMOJI_SIZE) / width;
          width = EMOJI_SIZE;
        }
      } else {
        if (height > EMOJI_SIZE) {
          width = (width * EMOJI_SIZE) / height;
          height = EMOJI_SIZE;
        }
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to create blob'));
            return;
          }

          if (blob.size > MAX_STATIC_SIZE) {
            // Try lower quality
            canvas.toBlob(
              (blob2) => {
                if (!blob2 || blob2.size > MAX_STATIC_SIZE) {
                  reject(new Error(`Image too large: ${blob.size} bytes (max ${MAX_STATIC_SIZE})`));
                  return;
                }
                resolve({
                  file: new File([blob2], file.name.replace(/\.[^.]+$/, '.webp'), { type: 'image/webp' }),
                  width,
                  height,
                  isAnimated: false,
                });
              },
              'image/webp',
              0.6
            );
            return;
          }

          resolve({
            file: new File([blob], file.name.replace(/\.[^.]+$/, '.webp'), { type: 'image/webp' }),
            width,
            height,
            isAnimated: false,
          });
        },
        'image/webp',
        0.85
      );
    };

    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

async function processAnimatedEmoji(file: File): Promise<CompressionResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);

      if (img.width > MAX_DIMENSION || img.height > MAX_DIMENSION) {
        reject(new Error(`Animated emoji too large: ${img.width}x${img.height} (max ${MAX_DIMENSION}x${MAX_DIMENSION})`));
        return;
      }

      if (file.size > MAX_ANIMATED_SIZE) {
        reject(new Error(`Animated emoji file too large: ${file.size} bytes (max ${MAX_ANIMATED_SIZE})`));
        return;
      }

      resolve({
        file,
        width: img.width,
        height: img.height,
        isAnimated: true,
      });
    };

    img.onerror = () => reject(new Error('Failed to load animated image'));
    img.src = URL.createObjectURL(file);
  });
}

export function validateEmojiFile(file: File): { valid: boolean; error?: string } {
  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

  if (!allowedTypes.includes(file.type)) {
    return { valid: false, error: 'Unsupported format. Use PNG, JPG, WebP, or GIF.' };
  }

  const maxSize = file.type === 'image/gif' || file.type === 'image/webp' ? MAX_ANIMATED_SIZE : 10 * 1024;
  if (file.size > maxSize) {
    return { valid: false, error: `File too large: ${(file.size / 1024).toFixed(1)}KB (max ${maxSize / 1024}KB)` };
  }

  return { valid: true };
}
