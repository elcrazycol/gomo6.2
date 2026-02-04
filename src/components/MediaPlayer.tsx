import { useEffect, useRef, useState } from "react";

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
  onReady?: (instance: any) => void;
  onPlay?: (instance: any) => void;
  onPause?: (instance: any) => void;
}

export const MediaPlayer = ({ kind, sources, poster, className = "", playerId, title, onReady, onPlay, onPause }: MediaPlayerProps) => {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [usingPooled, setUsingPooled] = useState(false);

  useEffect(() => {
    let instance: any;
    const playerKey = playerId || sources[0]?.src || "global-audio";
    const controls =
      kind === "audio"
        ? ["play", "progress", "current-time", "duration", "mute"]
        : ["play", "progress", "current-time", "mute", "volume", "settings", "pip", "fullscreen"];

    // Reattach pooled audio instance if it exists
    if (kind === "audio" && audioPool.has(playerKey) && mountRef.current) {
      const pooled = audioPool.get(playerKey)!;
      const host = mountRef.current;
      host.innerHTML = "";
      host.appendChild(pooled.container);
      instance = pooled.instance;
      setUsingPooled(true);
      onReady?.(instance);
      if (pooled.wasPlaying && instance?.play) {
        setTimeout(() => instance.play().catch(() => {}), 0);
      }
      return () => {
        // keep pooled instance alive; no destroy
        const poolHost = ensurePoolHost();
        if (pooled.container.parentElement !== poolHost) {
          poolHost.appendChild(pooled.container);
        }
        audioPool.set(playerKey, { ...pooled, wasPlaying: !instance?.paused && !instance?.ended });
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
        });
        onReady?.(instance);
        instance.on("play", () => {
          onPlay?.(instance);
          if (kind === "audio") {
            window.dispatchEvent(new CustomEvent("global-audio-play", { detail: { instance, title, playerId: playerKey } }));
          }
        });
        instance.on("pause", () => onPause?.(instance));
      })
      .catch((e) => console.error(e));

    return () => {
      if (!instance) return;
      if (kind === "audio") {
        // persist audio instance across route changes
        const container = instance.elements?.container as HTMLElement | undefined;
        if (container) {
          const wasPlaying = !instance.paused && !instance.ended;
          audioPool.set(playerKey, { container, instance, wasPlaying });
          const poolHost = ensurePoolHost();
          if (container.parentElement !== poolHost) {
            poolHost.appendChild(container);
          }
          if (wasPlaying && instance.play) {
            // ensure playback keeps running after move
            setTimeout(() => instance.play().catch(() => {}), 0);
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
