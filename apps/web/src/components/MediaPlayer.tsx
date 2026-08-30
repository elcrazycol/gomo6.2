import { useEffect, useMemo, useRef } from "react";
import { VideoPlayer } from "@/components/VideoPlayer";

const PLYR_SCRIPT = "https://cdn.plyr.io/3.8.4/plyr.polyfilled.js";
const PLYR_CSS = "https://cdn.plyr.io/3.8.4/plyr.css";

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Plyr?: any;
  }
}

interface PlyrInstance {
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  play: () => Promise<void>;
  pause: () => void;
  destroy: () => void;
  media: HTMLMediaElement;
}

let plyrLoader: Promise<unknown> | null = null;

// Global audio element - single source of truth for audio playback
let globalAudioElement: HTMLAudioElement | null = null;
let globalAudioCurrentSrc: string | null = null;

const ensureGlobalAudio = () => {
  if (!globalAudioElement) {
    globalAudioElement = document.createElement("audio");
    globalAudioElement.preload = "metadata";
    globalAudioElement.crossOrigin = "anonymous";

    // Keep it in DOM but hidden
    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.top = "-9999px";
    container.style.left = "-9999px";
    container.style.visibility = "hidden";
    container.style.pointerEvents = "none";
    container.appendChild(globalAudioElement);
    document.body.appendChild(container);
  }
  return globalAudioElement;
};

const ensurePlyrAssets = () => {
  // CSP deliberately permits scripts/styles only from first-party origins.
  // Native browser controls handle video/audio, range seeking and posters
  // without a remote CDN dependency; returning null keeps the existing
  // component's fallback controls intact and avoids CSP console errors.
  return Promise.resolve(null);

  /* v8 ignore start -- retained only as a reference while the old Plyr
     integration is phased out. */
  if (typeof window === "undefined") return Promise.resolve(null);

  // CSS
  if (!document.querySelector(`link[data-plyr="true"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = PLYR_CSS;
    link.setAttribute("data-plyr", "true");
    document.head.appendChild(link);
  }

  // JS
  if (window.Plyr) return Promise.resolve(window.Plyr);
  if (plyrLoader) return plyrLoader;

  plyrLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PLYR_SCRIPT;
    script.async = true;
    script.onload = () => resolve(window.Plyr);
    script.onerror = () => reject(new Error("Не удалось загрузить плеер"));
    document.body.appendChild(script);
  });

  return plyrLoader;
  /* v8 ignore stop */
};

interface MediaPlayerProps {
  kind: "video" | "audio";
  sources: { src: string; type?: string }[];
  poster?: string;
  className?: string;
  playerId?: string;
  title?: string;
  playlistId?: string;
  playlistIndex?: number;
  onReady?: (instance: PlyrInstance) => void;
  onPlay?: (instance: PlyrInstance) => void;
  onPause?: (instance: PlyrInstance) => void;
  /** For kind="video": open-mode callback (X-style wall thumbs navigate to the
      post page instead of playing inline). See VideoPlayer.onOpen. */
  onVideoOpen?: () => void;
  /** For kind="video": autoplay once ready (post page resumes the clip). */
  autoPlayVideo?: boolean;
}

export const MediaPlayer = ({ kind, sources, poster, className = "", playerId, title, playlistId, playlistIndex, onReady, onPlay, onPause, onVideoOpen, autoPlayVideo = false }: MediaPlayerProps) => {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerKey = useMemo(() => playerId || sources[0]?.src || "global-audio", [playerId, sources]);
  const instanceRef = useRef<PlyrInstance | null>(null);
  const isUnmountingRef = useRef(false);

  useEffect(() => {
    if (kind === "audio") {
      const globalAudio = ensureGlobalAudio();
      const controls = ["play", "progress", "current-time", "duration", "mute"];
      const trackSrc = sources[0]?.src;

      ensurePlyrAssets()
        .then((Plyr: unknown) => {
          if (!Plyr || !mediaRef.current || !mountRef.current) return;

          // CRITICAL: Mute local audio element so it doesn't play sound
          mediaRef.current.muted = true;
          mediaRef.current.volume = 0;

          // Create Plyr instance for UI
          const instance = new (Plyr as new (el: HTMLElement, opts: Record<string, unknown>) => PlyrInstance)(mediaRef.current, {
            ratio: "16:9",
            controls,
            autopause: false,
            autoplay: false,
            storage: { enabled: false },
            previewThumbnails: { enabled: false },
          });
          instanceRef.current = instance;

          // Intercept Plyr's play event BEFORE it actually plays
          let isHandlingPlay = false;

          instance.on("play", async (_event: Event) => {
            if (isHandlingPlay) return;
            isHandlingPlay = true;

            // Pause local immediately
            if (instance.media && !instance.media.paused) {
              instance.media.pause();
            }

            // Handle global audio
            if (globalAudioCurrentSrc !== trackSrc) {
              globalAudio.src = trackSrc ?? "";
              globalAudioCurrentSrc = trackSrc;

              // Wait for metadata
              if (globalAudio.readyState < 2) {
                await new Promise((resolve) => {
                  const onLoadedMetadata = () => {
                    globalAudio.removeEventListener('loadedmetadata', onLoadedMetadata);
                    resolve(null);
                  };
                  globalAudio.addEventListener('loadedmetadata', onLoadedMetadata);
                });
              }
            }

            globalAudio.currentTime = mediaRef.current?.currentTime || 0;

            try {
              await globalAudio.play();
              // Sync UI to show playing state
              if (instance.media && instance.media.paused) {
                await instance.media.play();
              }
            } catch (err) {
              console.error("Failed to play:", err);
            }

            // Notify AppLayout
            window.dispatchEvent(
              new CustomEvent("global-audio-play", {
                detail: { instance: globalAudio, title, playerId: playerKey, src: trackSrc, playlistId, playlistIndex },
              })
            );

            onPlay?.(instance);
            isHandlingPlay = false;
          });

          // Check if this track is currently playing
          const isCurrentTrack = globalAudioCurrentSrc === trackSrc;

          if (isCurrentTrack) {
            // Sync UI with global audio immediately and smoothly
            if (mediaRef.current) {
              mediaRef.current.currentTime = globalAudio.currentTime;
              if (!globalAudio.paused && !globalAudio.ended) {
                // Use requestAnimationFrame for smooth sync
                requestAnimationFrame(() => {
                  instance.play().catch(() => {});
                });
              }
            }
          }

          // Sync local UI with global audio state
          const syncTime = () => {
            if (globalAudioCurrentSrc === trackSrc && mediaRef.current) {
              const timeDiff = Math.abs(mediaRef.current.currentTime - globalAudio.currentTime);
              // Only sync if difference is significant (reduces lag)
              if (timeDiff > 1) {
                mediaRef.current.currentTime = globalAudio.currentTime;
              }
            }
          };

          const syncPlay = () => {
            if (globalAudioCurrentSrc === trackSrc && instance.media?.paused) {
              requestAnimationFrame(() => {
                instance.play().catch(() => {});
              });
            }
          };

          const syncPause = () => {
            if (globalAudioCurrentSrc === trackSrc && instance.media && !instance.media.paused) {
              requestAnimationFrame(() => {
                instance.pause();
              });
            }
          };

          // Use passive listeners for better performance
          globalAudio.addEventListener('timeupdate', syncTime, { passive: true });
          globalAudio.addEventListener('play', syncPlay, { passive: true });
          globalAudio.addEventListener('pause', syncPause, { passive: true });

          instance.on("pause", () => {
            if (!isUnmountingRef.current) {
              onPause?.(instance);
              if (globalAudioCurrentSrc === trackSrc) {
                globalAudio.pause();
              }
            }
          });

          instance.on("seeked", () => {
            if (globalAudioCurrentSrc === trackSrc && mediaRef.current) {
              globalAudio.currentTime = mediaRef.current.currentTime;
            }
          });

          if (playlistId !== undefined && playlistIndex !== undefined) {
            window.dispatchEvent(
              new CustomEvent("global-audio-register", {
                detail: { instance: globalAudio, title, playerId: playerKey, src: trackSrc, playlistId, playlistIndex },
              })
            );
          }

          onReady?.(instance);

          // Cleanup
          return () => {
            globalAudio.removeEventListener('timeupdate', syncTime);
            globalAudio.removeEventListener('play', syncPlay);
            globalAudio.removeEventListener('pause', syncPause);
          };
        })
        .catch((e) => console.error(e));

      return () => {
        isUnmountingRef.current = true;
        instanceRef.current?.destroy?.();
      };
    }
  }, [kind, sources, playerKey, title, playlistId, playlistIndex, onReady, onPlay, onPause]);

  if (kind === "video") {
    // Videos use the in-house X/Telegram-style player: custom controls,
    // blurred poster frame, native-fullscreen overlay. No CDN dependency.
    return (
      <VideoPlayer
        sources={sources}
        poster={poster}
        className={`w-full overflow-hidden rounded-xl border border-border bg-card/80 shadow-sm ${className}`}
        onOpen={onVideoOpen}
        autoPlay={autoPlayVideo}
      />
    );
  }

  const Element = "audio";
  const mediaClassName = "w-full";

  return (
    <div className={`relative w-full rounded-xl border border-border bg-card/80 shadow-sm overflow-hidden ${className}`}>
      <div ref={mountRef} className="relative">
        <Element
          ref={mediaRef as unknown as React.LegacyRef<HTMLVideoElement> | undefined}
          className={mediaClassName}
          playsInline
          controls
          preload="metadata"
          crossOrigin="anonymous"
        >
          {sources.map((s, i) => (
            <source key={i} src={s.src} type={s.type} />
          ))}
          Ваш браузер не поддерживает воспроизведение.
        </Element>
      </div>
    </div>
  );
};
