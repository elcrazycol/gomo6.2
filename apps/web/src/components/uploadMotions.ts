/** Motion presets shared by every uploader so the chips animate identically. */
export const chipMotion = {
  initial: { opacity: 0, y: 6, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, height: 0, marginTop: 0, marginBottom: 0 },
  transition: { duration: 0.22, ease: "easeOut" as const },
};

/** Motion presets for already-uploaded attachment items (thumbnails, chips). */
export const itemMotion = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
  transition: { duration: 0.2, ease: "easeOut" as const },
};
