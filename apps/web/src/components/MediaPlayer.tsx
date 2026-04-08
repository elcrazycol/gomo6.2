import { useEffect, useMemo, useRef, useState } from "react";

const PLYR_SCRIPT = "https://cdn.plyr.io/3.8.4/plyr.polyfilled.js";
const PLYR_CSS = "https://cdn.plyr.io/3.8.4/plyr.css";

declare global {
  interface Window {
    Plyr?: any;
  }
}

let plyrLoader: Promise<any> | null = null;
const audioPool = new Map<string, { container: HTMLElement; instance: any; wasPlaying: boolean }>();

const ensurePoolHost = () => {
  let host = document.getElementById("global-audio-pool");
  if (!host) {
    host = document.createElement("div");
    host.id = "global-audio-pool";
    host.style.position = "fixed";
    host.style.opacity = "0";
    host.style.pointerEvents = "none";
    host.style.inset = "0";
    host.style.zIndex = "-1";
    document.body.appendChild(host);
  }
  return host;
};

const moveContainer = (container: HTMLElement, target: HTMLElement) => {
  if (container.parentElement && container.parentElement !== target) {
    if (container.parentElement.contains(container)) {
      container.parentElement.removeChild(container);
    }
  }
  if (container.parentElement !== target) {
    target.appendChild(container);
  }
};

const ensurePlyrAssets = () => {
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
  onReady?: (instance: any) => void;
  onPlay?: (instance: any) => void;
  onPause?: (instance: any) => void;
}

export const MediaPlayer = ({ kind, sources, poster, className = "", playerId, title, playlistId, playlistIndex, onReady, onPlay, onPause }: MediaPlayerProps) => {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerKey = useMemo(() => playerId || sources[0]?.src || "global-audio", [playerId, sources]);
  const [usingPooled, setUsingPooled] = useState(() => audioPool.has(playerKey));
  const instanceRef = useRef<any>(null);

  useEffect(() => {
    let instance: any;
    const controls =
      kind === "audio"
        ? ["play", "progress", "current-time", "duration", "mute"]
        : ["play", "progress", "current-time", "mute", "volume", "settings", "pip", "fullscreen"];

    // Reattach pooled audio instance if it exists
    if (kind === "audio" && audioPool.has(playerKey) && mountRef.current) {
      const pooled = audioPool.get(playerKey)!;
      const host = mountRef.current;
      host.innerHTML = "";
      moveContainer(pooled.container, host);
      instance = pooled.instance;
      instanceRef.current = instance;
      setUsingPooled(true);
      onReady?.(instance);

      // Force resume if was playing - use requestAnimationFrame for better timing
      if (pooled.wasPlaying) {
        requestAnimationFrame(() => {
          if (!instance || !instance.media) return;
          const media = instance.media;
          if (!media.paused && !media.ended) {
            // Already playing
            return;
          }
          // Force play
          instance.play().catch((err: any) => {
            console.warn("Failed to resume playback:", err);
          });
        });
      }

      return () => {
        if (!instance) return;
        const poolHost = ensurePoolHost();
        const container = instance.elements?.container;
        if (container) {
          moveContainer(container, poolHost);
        }
        // Get actual media element state
        const media = instance.media;
        const isPlaying = media && !media.paused && !media.ended;
        audioPool.set(playerKey, {
          container: container || pooled.container,
          instance,
          wasPlaying: isPlaying
        });
      };
    }

    ensurePlyrAssets()
      .then((Plyr) => {
        if (!Plyr || !mediaRef.current || !mountRef.current) return;
        instance = new Plyr(mediaRef.current, {
          ratio: "16:9",
          controls,
          autopause: false,
          autoplay: false,
          storage: { enabled: false },
          previewThumbnails: { enabled: false },
        });
        instanceRef.current = instance;
        onReady?.(instance);

        if (kind === "audio" && playlistId !== undefined && playlistIndex !== undefined) {
          window.dispatchEvent(
            new CustomEvent("global-audio-register", {
              detail: { instance, title, playerId: playerKey, src: sources?.[0]?.src, playlistId, playlistIndex },
            })
          );
        }

        instance.on("play", () => {
          onPlay?.(instance);
          if (kind === "audio") {
            window.dispatchEvent(
              new CustomEvent("global-audio-play", {
                detail: { instance, title, playerId: playerKey, src: sources?.[0]?.src, playlistId, playlistIndex },
              })
            );
          }
        });

        instance.on("pause", () => onPause?.(instance));

        instance.on("error", (event: any) => {
          console.error("Media playback error:", event);
          if (kind === "audio") {
            window.dispatchEvent(
              new CustomEvent("global-audio-error", {
                detail: { playerId: playerKey, error: event, title },
              })
            );
          }
        });
      })
      .catch((e) => console.error(e));

    return () => {
      if (!instance) return;
      if (kind === "audio") {
        const container = instance.elements?.container as HTMLElement | undefined;
        if (container) {
          // Get actual media element state, not Plyr's paused property
          const media = instance.media;
          const isPlaying = media && !media.paused && !media.ended;

          audioPool.set(playerKey, { container, instance, wasPlaying: isPlaying });
          const poolHost = ensurePoolHost();
          moveContainer(container, poolHost);

          // Keep playing in background - force it
          if (isPlaying) {
            requestAnimationFrame(() => {
              if (instance && instance.media && !instance.media.paused) {
                // Already playing, good
                return;
              }
              instance.play().catch(() => {});
            });
          }
        }
      } else {
        instance.destroy?.();
      }
    };
  }, []);

  const Element = kind === "video" ? "video" : "audio";

  return (
    <div className={`w-full rounded-xl border border-border bg-card/80 shadow-sm overflow-hidden ${className}`}>
      <div ref={mountRef}>
        {!usingPooled && (
          <Element
            ref={mediaRef as any}
            className="w-full"
            playsInline
            controls
            preload="metadata"
            crossOrigin="anonymous"
            data-poster={poster}
          >
            {sources.map((s, i) => (
              <source key={i} src={s.src} type={s.type} />
            ))}
            Ваш браузер не поддерживает воспроизведение.
          </Element>
        )}
      </div>
    </div>
  );
};
