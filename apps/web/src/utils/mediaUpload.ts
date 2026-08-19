import { api } from "@/integrations/api/compat";
import { storageUrl, uploadFile } from "@/utils/storage";
import { prepareMessengerImage } from "@/lib/imageProcessing";
import { toast } from "sonner";
import * as mm from 'music-metadata';

export type AttachmentType = "image" | "video" | "audio" | "file";

export interface AttachmentMeta {
  url: string;
  type: AttachmentType;
  mime: string;
  name: string;
  size: number;
  poster?: string; // preview for videos
  title?: string; // audio track title
  artist?: string; // audio artist name
  album?: string; // audio album name
  duration?: number; // audio duration in seconds
  coverArt?: string; // audio cover art URL
  meta?: {
    preview_key: string;
    lqip: string;
    width: number;
    height: number;
    pipeline: string;
    source_size?: number;
    stored_size?: number;
  };
}

// Оптимизированные настройки
// Video compression runs on the backend. Browser-side FFmpeg relied on a
// third-party CDN and regularly failed before the original was uploaded.
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const extractAudioMetadata = async (file: File): Promise<{
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  coverArt?: string;
}> => {
  try {
    
    // Сначала пробуем извлечь через music-metadata
    let metadata: mm.IAudioMetadata | null = null;
    let coverArt: string | undefined;
    
    try {
      // Проверяем поддерживаемые форматы
      const supportedTypes = [
        'audio/mpeg', 'audio/mp3', 'audio/mpg',
        'audio/flac', 'audio/ogg', 'audio/wav', 
        'audio/x-wav', 'audio/aac', 'audio/mp4',
        'audio/m4a', 'audio/x-m4a'
      ];
      
      if (supportedTypes.includes(file.type) || file.name.match(/\.(mp3|flac|ogg|wav|m4a|aac)$/i)) {
        metadata = await mm.parseBlob(file, {
          duration: true,
          skipCovers: false,
          includeChapters: false,
        });

        // Извлекаем обложку и загружаем в S3
        if (metadata.common.picture && metadata.common.picture.length > 0) {
          const picture = metadata.common.picture[0];

          try {
            // Создаем файл из обложки
            const blob = new Blob([new Uint8Array(picture.data)], { type: picture.format });
            const ext = picture.format.split('/')[1] || 'jpg';
            const coverFile = new File([blob], `cover_${Date.now()}.${ext}`, { type: picture.format });

            // Загружаем обложку в S3
            const { data: { session } } = await api.auth.getSession();
            if (session) {
              const timestamp = Date.now();
              const randomStr = Math.random().toString(36).substring(7);
              const coverKey = `${session.user.id}/${timestamp}_${randomStr}.${ext}`;

              try {
                await uploadFile('content', coverKey, coverFile, undefined, true);
                coverArt = coverKey;
              } catch (e) {
                console.error('Failed to upload cover art:', e);
              }
            }
          } catch (e) {
            // Silently fail cover art upload
          }
        }
      }
    } catch (mmError) {
      // Silently fail
    }

    // Если music-metadata не сработал, пробуем серверное извлечение
    if (!metadata || !metadata.common.title) {
      try {
        const formData = new FormData();
        formData.append('audio', file);

        const response = await fetch('/api/v1/audio/metadata', {
          method: 'POST',
          body: formData,
        });

        if (response.ok) {
          const serverMetadata = await response.json();

          return {
            title: serverMetadata.title || undefined,
            artist: serverMetadata.artist || undefined,
            album: serverMetadata.album || undefined,
            duration: serverMetadata.duration || undefined,
            coverArt: serverMetadata.coverArt || undefined,
          };
        }
      } catch (serverError) {
        // Silently fail
      }
    }
    
    // Если ничего не сработало, пробуем получить длительность через HTML5 Audio
    let duration = metadata?.format.duration;
    if (!duration) {
      try {
        duration = await new Promise<number>((resolve) => {
          const audio = new Audio();
          audio.addEventListener('loadedmetadata', () => {
            resolve(audio.duration);
            URL.revokeObjectURL(audio.src);
          });
          audio.addEventListener('error', () => {
            resolve(0);
            URL.revokeObjectURL(audio.src);
          });
          audio.src = URL.createObjectURL(file);
        });
      } catch (audioError) {
        duration = undefined;
      }
    }

    return {
      title: metadata?.common.title || undefined,
      artist: metadata?.common.artist || undefined,
      album: metadata?.common.album || undefined,
      duration: duration || undefined,
      coverArt,
    };
  } catch (error) {
    return {};
  }
};

const inferType = (file: File): AttachmentType => {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
};

export type AttachmentUploadProgress = {
  index: number;
  name: string;
  percent: number;
};

export const uploadAttachments = async (
  files: File[],
  bucket: string = "content",
  onProgress?: (progress: AttachmentUploadProgress) => void,
): Promise<AttachmentMeta[]> => {
  const { data: { session } } = await api.auth.getSession();
  if (!session?.user) throw new Error("Нужно войти для загрузки");
  const user = session.user;

  const results: AttachmentMeta[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const original = files[index];
    const type = inferType(original);
    let file: File = original;
    let poster: string | undefined;
    let audioMetadata: Awaited<ReturnType<typeof extractAudioMetadata>> | undefined;

    // Показываем прогресс для больших файлов
    // const showProgress = original.size > 5 * 1024 * 1024; // > 5MB
    // if (showProgress) {
    //   toast.loading(`Обработка ${original.name}...`, { id: original.name });
    // }

    try {
      if (type === "image") {
        const prepared = await prepareMessengerImage(original);
        file = prepared.file;
      } else if (type === "video") {
        if (original.size > MAX_FILE_SIZE) {
          throw new Error("Видео больше 50MB — выберите файл поменьше");
        }
      } else if (type === "audio") {
        // Audio files: upload original without browser-side transcoding.
        // Browser-side FFmpeg WASM is unreliable (loads 25MB+ from CDN)
        // and often fails. Backend accepts all common audio formats.
        audioMetadata = await extractAudioMetadata(original);
      } else if (file.size > MAX_FILE_SIZE) {
        throw new Error("Файл больше 25MB — прикрепите меньший");
      }

      // Показываем сжатие
      // const compressionRatio = ((original.size - file.size) / original.size * 100).toFixed(1);
      // if (parseFloat(compressionRatio) > 5) {
      //   toast.success(`${original.name} сжат на ${compressionRatio}%`, { id: original.name });
      // }
    } catch (error: unknown) {
      console.error("Compression error", error);
      const message = error && typeof (error as { message?: string }).message === "string"
        ? (error as { message: string }).message
        : "Не удалось сжать, загружаю оригинал";
      const msg = message;
      toast.warning(msg, { id: original.name });
      if (original.size > MAX_FILE_SIZE) {
        throw new Error("Файл слишком большой и не удалось сжать");
      }
      file = original;
    } finally {
      // if (showProgress) {
      //   toast.dismiss(original.name);
      // }
    }

    const ext = file.name.split(".").pop() || "bin";
    const key = `${user.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

    // Upload file through backend (avoids CORS/S3-signature issues with direct Garage access).
    // The XHR path reports real byte progress — the local mapping keeps the bar moving
    // smoothly from 2% (processing done) to ~95% while the body uploads, then 100% below.
    onProgress?.({ index, name: original.name, percent: 2 });
    const uploaded = await uploadFile(bucket, key, file, session.access_token, false, (p) => {
      onProgress?.({
        index,
        name: original.name,
        percent: 2 + Math.round(Math.min(100, Math.max(0, p)) * 0.93),
      });
    });
    onProgress?.({ index, name: original.name, percent: 100 });
    if (type === "image" && !uploaded.variants) {
      throw new Error("Сервер не вернул preview для изображения");
    }

    // Private buckets (e.g. "wall") are served through an authorized endpoint.
    // Store the FULL storage path in the attachment so every render site that
    // resolves via storageUrl() passes it through unchanged, regardless of the
    // bucket argument it uses for legacy bare keys.
    const storedKey = uploaded.path;
    const storedUrl = bucket === "content" ? storedKey : storageUrl(bucket, storedKey) || storedKey;
    const storedPreview =
      bucket === "content" || !uploaded.variants
        ? uploaded.variants?.preview_key
        : storageUrl(bucket, uploaded.variants.preview_key) || undefined;

    results.push({
      url: storedUrl,
      type,
      mime: uploaded.video?.content_type || file.type,
      name: file.name,
      size: file.size,
      poster: uploaded.video?.poster_key
        ? (bucket === "content" ? uploaded.video.poster_key : storageUrl(bucket, uploaded.video.poster_key) || uploaded.video.poster_key)
        : poster,
      ...(type === "image" && uploaded.variants ? {
        meta: {
          preview_key: storedPreview,
          lqip: uploaded.variants.lqip,
          width: uploaded.variants.width,
          height: uploaded.variants.height,
          pipeline: "image-v2",
          source_size: original.size,
          stored_size: file.size,
        },
      } : {}),
      ...(audioMetadata && {
        title: audioMetadata.title,
        artist: audioMetadata.artist,
        album: audioMetadata.album,
        duration: audioMetadata.duration,
        coverArt: audioMetadata.coverArt,
      }),
    });
  }

  return results;
};
