// Shared context connecting the read/editor media views to the post's
// attachment pool and its interaction callbacks (lightbox / video open).
//
// The renderer (ProseMirrorRenderer) is generic and has no way to receive the
// attachment pool through props, so the wall cards provide it here once and
// every MediaBlockView underneath resolves its `attachmentId` from it.

import { createContext, useContext, type ReactNode } from "react";
import type { LightboxItem } from "@/components/Lightbox";
import type { MediaAttachment } from "./mediaSchema";

export interface MediaViewContextValue {
  /** The post's attachment pool, ids filled in (see ensureAttachmentIds). */
  attachments: MediaAttachment[];
  /**
   * Whether media nodes render inline. False is the legacy presentation:
   * media nodes are skipped and attachments render as the bottom gallery —
   * a kill-switch for the feature flag.
   */
  inlineMedia: boolean;
  /** Namespace for lightbox gallery keys. */
  galleryKey: string;
  onImageClick?: (items: LightboxItem[], index: number) => void;
  onVideoOpen?: () => void;
  /** Open a specific attachment in the viewer (used by the editor to resolve
      the full post gallery instead of the per-block single item). */
  onOpenMedia?: (attachmentId: string) => void;
  autoPlayVideo?: boolean;
}

const DEFAULT_VALUE: MediaViewContextValue = {
  attachments: [],
  inlineMedia: false,
  galleryKey: "media",
};

const MediaViewContext = createContext<MediaViewContextValue>(DEFAULT_VALUE);

export const MediaAttachmentsProvider = ({
  value,
  children,
}: {
  value: MediaViewContextValue;
  children: ReactNode;
}) => <MediaViewContext.Provider value={value}>{children}</MediaViewContext.Provider>;

export const useMediaView = (): MediaViewContextValue => useContext(MediaViewContext);

/** Resolve a node's attachmentId against the pool; null when missing. */
export const useAttachmentById = (id?: string | null): MediaAttachment | null => {
  const { attachments } = useMediaView();
  if (!id) return null;
  return attachments.find((att) => att.id === id) ?? null;
};
