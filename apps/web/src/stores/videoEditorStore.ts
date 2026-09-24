import { create } from "zustand";
import type { VideoEdit } from "@/components/videoEditor/types";
import type { VideoEditorMode } from "@/components/VideoEditor";

type PendingEdit = {
  file: File;
  mode: VideoEditorMode;
  resolve: (edit: VideoEdit | null) => void;
};

export type OpenVideoEditorOptions = {
  mode?: VideoEditorMode;
};

type VideoEditorState = {
  /** The file currently being edited, if any. */
  pending: PendingEdit | null;
  /**
   * Whether <VideoEditorHost /> is mounted. When it is not (unit tests, exotic
   * embeds), open() resolves immediately with null so an upload can never hang
   * waiting for a UI that will never appear.
   */
  hostReady: boolean;
  setHostReady: (ready: boolean) => void;
  /** Open the editor for a file and resolve with the picked edit (or null). */
  open: (file: File, options?: OpenVideoEditorOptions) => Promise<VideoEdit | null>;
  /** Called by the host when the user applies or cancels. */
  finish: (edit: VideoEdit | null) => void;
};

export const useVideoEditorStore = create<VideoEditorState>((set, get) => ({
  pending: null,
  hostReady: false,
  setHostReady: (ready) => set({ hostReady: ready }),
  open: (file, options) => {
    if (!get().hostReady) return Promise.resolve(null);
    return new Promise<VideoEdit | null>((resolve) => {
      set({ pending: { file, mode: options?.mode ?? "default", resolve } });
    });
  },
  finish: (edit) => {
    const pending = get().pending;
    set({ pending: null });
    pending?.resolve(edit);
  },
}));

/**
 * Open the video editor for a picked file and resolve with the user's trim/crop
 * (or null when they skip/cancel). Safe to call from plain functions: it goes
 * through the store, so no React context is needed.
 */
export const openVideoEditor = (
  file: File,
  options?: OpenVideoEditorOptions,
): Promise<VideoEdit | null> => useVideoEditorStore.getState().open(file, options);
