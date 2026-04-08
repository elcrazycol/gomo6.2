import { useEffect, useMemo, useRef, useState } from "react";

const PLYR_SCRIPT = "https://cdn.plyr.io/3.8.4/plyr.polyfilled.js";
const PLYR_CSS = "https://cdn.plyr.io/3.8.4/plyr.css";

declare global {
  interface Window {
    Plyr?: any;
  }
}

let plyrLoader: Promise<any> | null = null;
const audioPool = new Map<string, { wasPlaying: boolean; currentTime?: number; src?: string }>();

// Global persistent audio host that never gets removed from DOM
let globalAudioHost: HTMLElement | null = null;
const ensureGlobalAudioHost = () => {
  if (!globalAudioHost) {
    globalAudioHost = document.createElement("div");
    globalAudioHost.id = "global-audio-host";
    globalAudioHost.style.position = "fixed";
    globalAudioHost.style.top = "-9999px";
    globalAudioHost.style.left = "-9999px";
    globalAudioHost.style.visibility = "hidden";
    globalAudioHost.style.pointerEvents = "none";
    globalAudioHost.style.zIndex = "-9999";
    globalAudioHost.style.width = "1px";
    globalAudioHost.style.height = "1px";
    globalAudioHost.style.overflow = "hidden";
    document.body.appendChild(globalAudioHost);
  }
  return globalAudioHost;
};

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
  if (!container) return;
  
  const currentParent = container.parentElement;
  
  // Only try to remove if we have a different parent
  if (currentParent && currentParent !== target) {
    try {
      currentParent.removeChild(container);
    } catch (e) {
      // Container might already be removed, ignore
    }
  }
  
  // Only append if container is not already in target
  if (container.parentElement !== target) {
    try {
      target.appendChild(container);
    } catch (e) {
      // Container might already be in target, ignore
    }
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
  const [usingPooled, setUsingPooled] = useState(false);
  const instanceRef = useRef<any>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const isUnmountingRef = useRef(false);

  useEffect(() => {
    let instance: any;
    const controls =
      kind === "audio"
        ? ["play", "progress", "current-time", "duration", "mute"]
        : ["play", "progress", "current-time", "mute", "volume", "settings", "pip", "fullscreen"];

    // Check if we have saved state to restore
    if (kind === "audio" && audioPool.has(playerKey) && mountRef.current) {
      const pooled = audioPool.get(playerKey)!;
      
      // We'll create a new instance but restore the state
      const restoreState = () => {
        if (pooled.wasPlaying && pooled.currentTime) {
          setTimeout(() => {
            if (instance && instance.media) {
              // Stop any other playing instances first
              window.dispatchEvent(
                new CustomEvent("global-audio-play", {
                  detail: { playerId: playerKey, src: sources?.[0]?.src },
                })
              );
              
              // Then restore this instance
              instance.media.currentTime = pooled.currentTime || 0;
              instance.play().catch(() => {});
            }
          }, 100);
        }
      };

      // Continue with normal instance creation, but mark for state restoration
      setTimeout(restoreState, 200);
      
      // Clear the pool entry after using it to prevent duplicates
      audioPool.delete(playerKey);
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
        // DISABLED: Container movement causes DOM errors
        // Let React handle the DOM naturally
        containerRef.current = mountRef.current?.firstElementChild as HTMLElement || null;
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

        instance.on("pause", () => {
          if (!isUnmountingRef.current) {
            onPause?.(instance);
          }
        });

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

    // Cleanup for new instances (not from pool)
    return () => {
        isUnmountingRef.current = true;
        
        if (!instance) return;
        if (kind === "audio") {
          const container = containerRef.current || instance.elements?.container as HTMLElement | undefined;
          if (container) {
            // Get actual media element state, not Plyr's paused property
            const media = instance.media;
            const isPlaying = media && !media.paused && !media.ended;

            // NEW STRATEGY: Save only playback state
            const mediaElement = instance.media;
            const currentTime = mediaElement?.currentTime || 0;
            audioPool.set(playerKey, { 
              wasPlaying: isPlaying,
              currentTime,
              src: sources?.[0]?.src
            });
            
            // Force resume if it was playing - DOM movement might have paused it
            if (isPlaying) {
              requestAnimationFrame(() => {
                if (instance && instance.media && instance.media.paused && !instance.media.ended) {
                  (window as any).isBackgroundResume = true;
                  instance.play().catch(() => {});
                }
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
