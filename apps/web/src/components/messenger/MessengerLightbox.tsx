import { Lightbox, type LightboxItem } from "@/components/Lightbox";
import type { Attachment } from "./types";

type MessengerLightboxProps = {
  attachments: Attachment[];
  initialIndex: number;
  onClose: () => void;
};

const toLightboxItem = (attachment: Attachment): LightboxItem => ({
  id: attachment.id,
  url: attachment.url,
  type: attachment.type,
  name: attachment.name,
  size: attachment.size,
  mime: attachment.mime,
  meta: attachment.meta ?? null,
});

/**
 * Messenger lightbox — thin wrapper over the unified site-wide Lightbox.
 * Messenger attachments live in the private "uploads" bucket and are resolved
 * through the authenticated storage endpoint.
 */
export function MessengerLightbox({ attachments, initialIndex, onClose }: MessengerLightboxProps) {
  return (
    <Lightbox
      items={attachments.map(toLightboxItem)}
      initialIndex={initialIndex}
      onClose={onClose}
      bucket="uploads"
    />
  );
}
