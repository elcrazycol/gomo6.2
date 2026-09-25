// Editor-only capabilities for a media node: replace the file, open the photo
// editor, toggle the composer fullscreen. Provided by the composer; absent on
// the read path (the read views never need them).

import { createContext, useContext, type ReactNode } from "react";
import type { MediaAttachment } from "./mediaSchema";

export interface MediaEditorContextValue {
  /** Upload a new file and swap it in for the attachment behind a node. */
  replaceAttachment: (attachmentId: string, file: File) => Promise<MediaAttachment | null>;
  openImageEditor?: (attachmentId: string) => void;
  toggleFullscreen?: () => void;
  /** False when the post already holds MAX_MEDIA_NODES. */
  canAddMore: boolean;
}

const MediaEditorContext = createContext<MediaEditorContextValue | null>(null);

export const MediaEditorProvider = ({
  value,
  children,
}: {
  value: MediaEditorContextValue;
  children: ReactNode;
}) => <MediaEditorContext.Provider value={value}>{children}</MediaEditorContext.Provider>;

export const useMediaEditor = (): MediaEditorContextValue | null => useContext(MediaEditorContext);
