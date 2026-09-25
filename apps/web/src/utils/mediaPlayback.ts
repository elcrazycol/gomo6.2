// Playback helpers shared across wall/feed media.
//
// The post page opens as an overlay over the profile (backgroundLocation keeps
// the list mounted underneath), so an inline clip would keep playing behind it.
// Call pauseAllInlineMedia() right before such a navigation.
//
// Only the real player (VideoPlayer) and audio are stopped: animated avatars
// and GIF-like clips keep looping (they are decorative and hidden behind the
// overlay, and once paused they would stay frozen after closing it).

/** Pause the inline video players and audio currently in the document. */
export const pauseAllInlineMedia = (): void => {
  if (typeof document === "undefined") return;
  document
    .querySelectorAll<HTMLMediaElement>('video[data-video-player="true"], audio')
    .forEach((element) => {
      try {
        element.pause();
      } catch {
        // Media not ready / already detached — nothing to stop.
      }
    });
};
