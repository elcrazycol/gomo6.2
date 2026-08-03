// Функция для удаления EXIF метаданных из изображения
export const removeExifData = (file: File): Promise<File> => {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      // Устанавливаем размеры canvas равными размерам изображения
      canvas.width = img.width;
      canvas.height = img.height;

      // Рисуем изображение на canvas (это автоматически удаляет EXIF данные)
      ctx?.drawImage(img, 0, 0);

      // Конвертируем canvas обратно в файл
      canvas.toBlob((blob) => {
        if (blob) {
          // Создаем новый файл с тем же именем и типом
          const cleanFile = new File([blob], file.name, {
            type: file.type,
            lastModified: Date.now(),
          });
          resolve(cleanFile);
        } else {
          reject(new Error('Failed to remove EXIF data'));
        }
      }, file.type, 1.0); // Максимальное качество
    };

    img.onerror = () => reject(new Error('Failed to load image for EXIF removal'));
    img.src = URL.createObjectURL(file);
  });
};

// Функция для получения настроек приватности пользователя
export const getUserPrivacySettings = async (userId: string) => {
  const { api } = await import('@/integrations/api/compat');

  const { data, error } = await api
    .from('privacy_settings')
    .select('remove_image_metadata')
    .eq('user_id', userId)
    .single();

  if (error) {
    // Если настройки не найдены, возвращаем значение по умолчанию (включено)
    return { remove_image_metadata: true };
  }

  return data || { remove_image_metadata: true };
};

// Улучшенная функция сжатия с опциональным удалением метаданных
export const compressImageWithMetadataRemoval = async (
  file: File,
  maxWidth: number = 1200,
  quality: number = 0.8,
  removeMetadata: boolean = true
): Promise<File> => {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = async () => {
      try {
        // Рассчитываем новые размеры
        let { width, height } = img;
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;

        // Рисуем изображение (это удаляет EXIF если нужно)
        ctx?.drawImage(img, 0, 0, width, height);

        // Создаем blob
        canvas.toBlob(async (blob) => {
          if (blob) {
            let processedBlob = blob;

            // Если нужно удалить метаданные, создаем новый canvas для полной очистки
            if (removeMetadata) {
              const cleanCanvas = document.createElement('canvas');
              const cleanCtx = cleanCanvas.getContext('2d');
              const cleanImg = new Image();

              cleanImg.onload = () => {
                cleanCanvas.width = width;
                cleanCanvas.height = height;
                cleanCtx?.drawImage(cleanImg, 0, 0, width, height);

                cleanCanvas.toBlob((cleanBlob) => {
                  if (cleanBlob) {
                    processedBlob = cleanBlob;
                  }
                  createFinalFile(processedBlob);
                }, file.type, quality);
              };

              cleanImg.src = URL.createObjectURL(blob);
            } else {
              createFinalFile(processedBlob);
            }

            function createFinalFile(blob: Blob) {
              const compressedFile = new File([blob], file.name, {
                type: file.type,
                lastModified: Date.now(),
              });
              resolve(compressedFile);
            }
          } else {
            reject(new Error('Failed to compress image'));
          }
        }, file.type, quality);
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
};

// Объект с утилитами для обработки изображений
export const MESSENGER_IMAGE_MAX_DIMENSION = 2560;
export const MESSENGER_IMAGE_QUALITY = 0.9;

export type PreparedMessengerImage = {
  file: File;
  width: number;
  height: number;
  sourceSize: number;
  storedSize: number;
  compressed: boolean;
};

type DecodedImageSource = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close?: () => void;
};

const decodeImageSource = async (file: File): Promise<DecodedImageSource> => {
  if (file.size > 50 * 1024 * 1024) {
    throw new Error("Image is too large to process safely");
  }
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
        premultiplyAlpha: "default",
      });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall back to HTMLImageElement for browsers without ImageBitmap EXIF support.
    }
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    const source = URL.createObjectURL(file);
    image.decoding = "async";
    image.onload = () => {
      URL.revokeObjectURL(source);
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(new Error("Image has invalid dimensions"));
        return;
      }
      resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(source);
      reject(new Error("Unable to decode image"));
    };
    image.src = source;
  });
};

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Prepare a messenger photo before upload. The result is deliberately called
 * "stored" rather than "original": it keeps the source dimensions up to 2560px,
 * strips EXIF/GPS and uses high-quality WebP where the browser supports it.
 * This is perceptual-lossless, not mathematical lossless: the visual image is
 * preserved while the storage footprint is normally much smaller.
 */
export const prepareMessengerImage = async (file: File): Promise<PreparedMessengerImage> => {
  const decoded = await decodeImageSource(file);
  const sourceWidth = decoded.width;
  const sourceHeight = decoded.height;
  const scale = Math.min(1, MESSENGER_IMAGE_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  try {
    // Preserve animated formats. Decoding is used only for dimensions; a
    // canvas round-trip would silently keep one frame and destroy animation.
    if (file.type === "image/gif" || file.type === "image/webp") {
      return { file, width: sourceWidth, height: sourceHeight, sourceSize: file.size, storedSize: file.size, compressed: false };
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(decoded.source, 0, 0, width, height);

    let webpSupported = false;
    try {
      webpSupported = canvas.toDataURL("image/webp").startsWith("data:image/webp");
    } catch {
      webpSupported = false;
    }
    let blob = webpSupported
      ? await canvasToBlob(canvas, "image/webp", MESSENGER_IMAGE_QUALITY)
      : null;
    let outputType = "image/webp";
    let extension = "webp";

    // JPEG is a compatibility fallback only for photographic inputs. Keep
    // PNGs untouched when WebP is unavailable so alpha is never destroyed.
    if (!blob && file.type === "image/jpeg") {
      blob = await canvasToBlob(canvas, "image/jpeg", 0.92);
      outputType = "image/jpeg";
      extension = "jpg";
    }
    if (!blob || blob.size === 0) {
      return { file, width: sourceWidth, height: sourceHeight, sourceSize: file.size, storedSize: file.size, compressed: false };
    }

    // Never replace an already efficient source with a larger derivative,
    // unless downscaling was necessary to stay within the safe display budget.
    const downscaled = width !== sourceWidth || height !== sourceHeight;
    if (!downscaled && blob.size >= file.size * 0.98) {
      return { file, width: sourceWidth, height: sourceHeight, sourceSize: file.size, storedSize: file.size, compressed: false };
    }

    const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
    const storedFile = new File([blob], `${baseName}.${extension}`, {
      type: outputType,
      lastModified: Date.now(),
    });
    return { file: storedFile, width, height, sourceSize: file.size, storedSize: storedFile.size, compressed: true };
  } finally {
    decoded.close?.();
  }
};

export const imageProcessing = {
  processImage: compressImageWithMetadataRemoval,
  removeExifData,
  getUserPrivacySettings,
  compressImageWithMetadataRemoval,
  prepareMessengerImage,
};
