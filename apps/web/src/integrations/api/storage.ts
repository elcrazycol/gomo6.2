// Storage module — api.storage.from() compatibility backed by S3-compatible Go backend
import { uploadFile, getPublicUrl, removeFile } from '@/utils/storage';

export const storage = {
  from: (bucket: string) => {
    const token = localStorage.getItem('auth_token') || undefined;
    return {
      upload: async (path: string, file: File) => {
        try {
          const result = await uploadFile(bucket, path, file, token);
          return { data: { path: result.path }, error: null };
        } catch (error) {
          return { data: null, error: { message: (error as Error).message } };
        }
      },
      getPublicUrl: (path: string) => ({
        data: getPublicUrl(bucket, path),
      }),
      remove: async (paths: string[]) => {
        try {
          await Promise.all(paths.map((p) => removeFile(bucket, p, token)));
          return { data: null, error: null };
        } catch (error) {
          return { data: null, error: { message: (error as Error).message } };
        }
      },
    };
  },
};
