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
  const { supabase } = await import('@/integrations/supabase/client');

  const { data, error } = await supabase
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