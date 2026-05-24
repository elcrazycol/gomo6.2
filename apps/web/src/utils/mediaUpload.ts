import { supabase } from "@/integrations/api/supabaseCompat";
import { uploadFile } from "@/utils/storage";
import { compressImageWithMetadataRemoval } from "@/lib/imageProcessing";
import { FFmpeg } from "@ffmpeg/ffmpeg";
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
}

// Оптимизированные настройки
const MAX_IMAGE_DIMENSION = 1200; // Уменьшили для лучшего сжатия
const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB для изображений
const MAX_VIDEO_WIDTH = 1080; // Уменьшили для веба
const MAX_VIDEO_HEIGHT = 1080;
const MAX_VIDEO_BITRATE = "1200k"; // Уменьшили битрейт
const MAX_AUDIO_BITRATE = "96k"; // Уменьшили для аудио
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

// Кэш для обработанных файлов
const processedCache = new Map<string, { file: File; poster?: string; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 минут

let ffmpegInstance: FFmpeg | null = null;
const CORE_VERSION = "0.12.9";
const FF_CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;
const FF_CORE_URL = `${FF_CORE_BASE}/ffmpeg-core.js`;
const FF_WASM_URL = `${FF_CORE_BASE}/ffmpeg-core.wasm`;
const FF_WORKER_URL = `${FF_CORE_BASE}/ffmpeg-core.worker.js`;

const generateFileHash = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

const getCachedFile = (file: File) => {
  const key = `${file.name}_${file.size}_${file.lastModified}`;
  const cached = processedCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('Using cached file:', key);
    return cached;
  }
  return null;
};

const setCachedFile = (file: File, result: { file: File; poster?: string }) => {
  const key = `${file.name}_${file.size}_${file.lastModified}`;
  processedCache.set(key, { ...result, timestamp: Date.now() });
  
  // Очистка старого кэша
  if (processedCache.size > 50) {
    const oldest = Array.from(processedCache.entries())
      .sort(([, a], [, b]) => a.timestamp - b.timestamp)[0];
    if (oldest) processedCache.delete(oldest[0]);
  }
};

const loadFFmpeg = async () => {
  if (ffmpegInstance) return ffmpegInstance;
  ffmpegInstance = new FFmpeg();
  await ffmpegInstance.load({
    coreURL: FF_CORE_URL,
    wasmURL: FF_WASM_URL,
    workerURL: FF_WORKER_URL,
  });
  return ffmpegInstance;
};

const compressImage = async (file: File): Promise<File> => {
  // Проверяем кэш
  const cached = getCachedFile(file);
  if (cached) return cached.file;

  console.log('Compressing image:', file.name);
  
  // Адаптивное качество в зависимости от размера
  const quality = file.size > MAX_IMAGE_SIZE ? 0.7 : 0.85;
  const compressed = await compressImageWithMetadataRemoval(file, MAX_IMAGE_DIMENSION, quality, true);
  
  // Кэшируем результат
  setCachedFile(file, { file: compressed });
  
  return compressed;
};

const transcodeVideoToWebm = async (file: File): Promise<{ file: File; poster?: string }> => {
  // Проверяем кэш
  const cached = getCachedFile(file);
  if (cached) return cached;

  if (file.size > MAX_FILE_SIZE) {
    throw new Error("Видео больше 25MB — сожмите перед загрузкой");
  }

  console.log('Transcoding video:', file.name);

  const ffmpeg = await loadFFmpeg();
  const inputName = `input.${file.name.split(".").pop() || "mp4"}`;
  const outputName = "output.webm";
  const posterName = "thumb.jpg";

  try {
    ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));

    // Улучшенные параметры для веба
    await ffmpeg.exec([
      "-i", inputName,
      "-vf", `scale='min(${MAX_VIDEO_WIDTH}\\,iw):-2'`,
      "-maxsize", `${MAX_VIDEO_WIDTH}x${MAX_VIDEO_HEIGHT}`,
      "-b:v", MAX_VIDEO_BITRATE,
      "-c:v", "libvpx-vp9",
      "-c:a", "libvorbis",
      "-threads", "2",
      "-deadline", "good",
      "-cpu-used", "2",
      outputName
    ]);

    const data = await ffmpeg.readFile(outputName);
    const arrayBuffer = data instanceof Uint8Array ? data.buffer : (data as any).buffer || data;
    const outFile = new File([arrayBuffer], file.name.replace(/\.[^.]+$/, "") + ".webm", { type: "video/webm" });

    let poster: string | undefined;
    try {
      await ffmpeg.exec([
        "-i", inputName, "-ss", "00:00:01", "-vframes", "1", 
        "-vf", "scale=640:-2", "-q:v", "2", posterName
      ]);
      const posterData = await ffmpeg.readFile(posterName);
      const posterArrayBuffer = posterData instanceof Uint8Array ? posterData.buffer : (posterData as any).buffer || posterData;
      const posterFile = new File([posterArrayBuffer], "poster.jpg", { type: "image/jpeg" });
      poster = URL.createObjectURL(posterFile);
    } catch (e) {
      console.warn("Failed to generate poster:", e);
    }

    const result = { file: outFile, poster };
    setCachedFile(file, result);
    return result;
  } finally {
    // cleanup to free wasm memory
    try { ffmpeg.deleteFile(inputName); } catch (e) { console.debug("ffmpeg cleanup input failed", e); }
    try { ffmpeg.deleteFile(outputName); } catch (e) { console.debug("ffmpeg cleanup output failed", e); }
    try { ffmpeg.deleteFile(posterName); } catch (e) { console.debug("ffmpeg cleanup poster failed", e); }
  }
};

const extractAudioMetadata = async (file: File): Promise<{
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  coverArt?: string;
}> => {
  try {
    
    // Сначала пробуем извлечь через music-metadata
    let metadata: any = null;
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
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
              const timestamp = Date.now();
              const randomStr = Math.random().toString(36).substring(7);
              const coverKey = `${session.user.id}/${timestamp}_${randomStr}.${ext}`;

              try {
                await uploadFile('content', coverKey, coverFile);
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

const transcodeAudio = async (file: File): Promise<{ file: File; metadata?: any }> => {
  // Извлекаем метаданные ПЕРЕД transcoding
  const metadata = await extractAudioMetadata(file);

  // Проверяем кэш
  const cached = getCachedFile(file);
  if (cached) return { file: cached.file, metadata };

  if (file.size > MAX_FILE_SIZE) {
    throw new Error("Аудио больше 25MB — сожмите перед загрузкой");
  }

  const ffmpeg = await loadFFmpeg();
  const inputName = `input.${file.name.split(".").pop() || "wav"}`;
  const outputName = "output.ogg";

  try {
    ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));

    // Улучшенные параметры для аудио
    await ffmpeg.exec([
      "-i", inputName,
      "-c:a", "libvorbis",
      "-b:a", MAX_AUDIO_BITRATE,
      "-ar", "44100",
      "-ac", "2",
      "-compression_level", "5",
      outputName
    ]);

    const data = await ffmpeg.readFile(outputName);
    const arrayBuffer = data instanceof Uint8Array ? data.buffer : (data as any).buffer || data;
    const outFile = new File([arrayBuffer], file.name.replace(/\.[^.]+$/, "") + ".ogg", { type: "audio/ogg" });
    
    setCachedFile(file, { file: outFile });
    return { file: outFile, metadata };
  } finally {
    try { ffmpeg.deleteFile(inputName); } catch (e) { console.debug("ffmpeg cleanup input failed", e); }
    try { ffmpeg.deleteFile(outputName); } catch (e) { console.debug("ffmpeg cleanup output failed", e); }
  }
};

const inferType = (file: File): AttachmentType => {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
};

export const uploadAttachments = async (files: File[]): Promise<AttachmentMeta[]> => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error("Нужно войти для загрузки");
  const user = session.user;

  const results: AttachmentMeta[] = [];

  for (const original of files) {
    const type = inferType(original);
    let file: File = original;
    let poster: string | undefined;
    let audioMetadata: any;

    // Показываем прогресс для больших файлов
    // const showProgress = original.size > 5 * 1024 * 1024; // > 5MB
    // if (showProgress) {
    //   toast.loading(`Обработка ${original.name}...`, { id: original.name });
    // }

    try {
      if (type === "image") {
        file = await compressImage(original);
      } else if (type === "video") {
        const transcoded = await transcodeVideoToWebm(original);
        file = transcoded.file;
        poster = transcoded.poster;
      } else if (type === "audio") {
        // Для MP3 файлов не делаем transcoding, чтобы сохранить метаданные
        if (file.type === 'audio/mpeg' || file.type === 'audio/mp3' || file.name.toLowerCase().endsWith('.mp3')) {
          file = original;
          // Все равно извлекаем метаданные для MP3
          audioMetadata = await extractAudioMetadata(original);
        } else {
          const audioResult = await transcodeAudio(original);
          file = audioResult.file;
          audioMetadata = audioResult.metadata;
        }
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

    // Upload file through backend (avoids CORS/S3-signature issues with direct Garage access)
    await uploadFile('content', key, file, session.access_token);

    results.push({
      url: key,
      type,
      mime: file.type,
      name: file.name,
      size: file.size,
      poster,
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
