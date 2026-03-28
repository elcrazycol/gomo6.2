import { supabase } from "@/integrations/supabase/client";
import { compressImageWithMetadataRemoval } from "@/lib/imageProcessing";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toast } from "sonner";

export type AttachmentType = "image" | "video" | "audio" | "file";

export interface AttachmentMeta {
  url: string;
  type: AttachmentType;
  mime: string;
  name: string;
  size: number;
  poster?: string; // preview for videos
}

const MAX_IMAGE_DIMENSION = 1400;
const MAX_VIDEO_WIDTH = 1280;
const MAX_VIDEO_BITRATE = "1600k";
const MAX_AUDIO_BITRATE = "128k";
// wasm ffmpeg держит файлы в памяти, поэтому ограничиваем размер сильнее
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

let ffmpegInstance: FFmpeg | null = null;
const CORE_VERSION = "0.12.9";
const FF_CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;
const FF_CORE_URL = `${FF_CORE_BASE}/ffmpeg-core.js`;
const FF_WASM_URL = `${FF_CORE_BASE}/ffmpeg-core.wasm`;
const FF_WORKER_URL = `${FF_CORE_BASE}/ffmpeg-core.worker.js`;

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
  return compressImageWithMetadataRemoval(file, MAX_IMAGE_DIMENSION, 0.8, true);
};

const transcodeVideoToWebm = async (file: File): Promise<{ file: File; poster?: string }> => {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("Видео больше 25MB — сожмите перед загрузкой");
  }

  const ffmpeg = await loadFFmpeg();
  const inputName = `input.${file.name.split(".").pop() || "mp4"}`;
  const outputName = "output.webm";
  const posterName = "thumb.jpg";

  try {
    ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));

    await ffmpeg.exec([
      "-i", inputName,
      "-vf", `scale='min(${MAX_VIDEO_WIDTH},iw)':-2`,
      "-b:v", MAX_VIDEO_BITRATE,
      "-c:v", "libvpx-vp9",
      "-c:a", "libvorbis",
      "-threads", "1",
      outputName
    ]);

    const data = await ffmpeg.readFile(outputName);
    const outFile = new File([data.buffer], file.name.replace(/\.[^.]+$/, "") + ".webm", { type: "video/webm" });

    try {
      await ffmpeg.exec([
        "-i", inputName, "-ss", "00:00:01", "-vframes", "1", "-vf", "scale=640:-2", posterName
      ]);
      const posterData = await ffmpeg.readFile(posterName);
      const posterFile = new File([posterData.buffer], "poster.jpg", { type: "image/jpeg" });
      const posterUrl = URL.createObjectURL(posterFile);
      return { file: outFile, poster: posterUrl };
    } catch {
      return { file: outFile };
    }
  } finally {
    // cleanup to free wasm memory
    try { ffmpeg.deleteFile(inputName); } catch (e) { console.debug("ffmpeg cleanup input failed", e); }
    try { ffmpeg.deleteFile(outputName); } catch (e) { console.debug("ffmpeg cleanup output failed", e); }
    try { ffmpeg.deleteFile(posterName); } catch (e) { console.debug("ffmpeg cleanup poster failed", e); }
  }
};

const transcodeAudio = async (file: File): Promise<File> => {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("Аудио больше 25MB — сожмите перед загрузкой");
  }

  const ffmpeg = await loadFFmpeg();
  const inputName = `input.${file.name.split(".").pop() || "wav"}`;
  const outputName = "output.ogg";

  ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));

  await ffmpeg.exec([
    "-i", inputName,
    "-c:a", "libvorbis",
    "-b:a", MAX_AUDIO_BITRATE,
    outputName
  ]);

  const data = await ffmpeg.readFile(outputName);
  return new File([data.buffer], file.name.replace(/\.[^.]+$/, "") + ".ogg", { type: "audio/ogg" });
};

const inferType = (file: File): AttachmentType => {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
};

export const uploadAttachments = async (files: File[]): Promise<AttachmentMeta[]> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Нужно войти для загрузки");

  const results: AttachmentMeta[] = [];

  for (const original of files) {
    const type = inferType(original);
    let file: File = original;
    let poster: string | undefined;

    try {
      if (type === "image") {
        file = await compressImage(original);
      } else if (type === "video") {
        const transcoded = await transcodeVideoToWebm(original);
        file = transcoded.file;
        poster = transcoded.poster;
      } else if (type === "audio") {
        file = await transcodeAudio(original);
      } else if (file.size > MAX_FILE_SIZE) {
        throw new Error("Файл больше 25MB — прикрепите меньший");
      }
    } catch (error: unknown) {
      console.error("Compression error", error);
      const message = error && typeof (error as { message?: string }).message === "string"
        ? (error as { message: string }).message
        : "Не удалось сжать, загружаю оригинал";
      const msg = message;
      toast.warning(msg);
      if (original.size > MAX_FILE_SIZE) {
        throw new Error("Файл слишком большой и не удалось сжать");
      }
      file = original;
    }

    const ext = file.name.split(".").pop() || "bin";
    const key = `${user.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("content")
      .upload(key, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      console.error("Upload error", uploadError);
      throw new Error(uploadError.message || "Ошибка загрузки файла");
    }

    const { data: { publicUrl } } = supabase.storage.from("content").getPublicUrl(key);

    results.push({
      url: publicUrl,
      type,
      mime: file.type,
      name: file.name,
      size: file.size,
      poster,
    });
  }

  return results;
};
