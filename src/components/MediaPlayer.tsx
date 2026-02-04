import { useEffect, useRef } from "react";

const PLYR_SCRIPT = "https://cdn.plyr.io/3.8.4/plyr.polyfilled.js";
const PLYR_CSS = "https://cdn.plyr.io/3.8.4/plyr.css";

declare global {
  interface Window {
    Plyr?: any;
  }
}

let plyrLoader: Promise<any> | null = null;

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
  const ref = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  useEffect(() => {
    let instance: any;
    const controls =
      kind === "audio"
        ? ["play", "progress", "current-time", "duration", "mute"]
        : ["play", "progress", "current-time", "mute", "volume", "settings", "pip", "fullscreen"];

    ensurePlyrAssets()
      .then((Plyr) => {
        if (!Plyr || !ref.current) return;
        instance = new Plyr(ref.current, {
          ratio: "16:9",
          controls,
        });
        onReady?.(instance);
        instance.on("play", () => {
          onPlay?.(instance);
          if (kind === "audio") {
            window.dispatchEvent(new CustomEvent("global-audio-play", { detail: { instance, title, playerId: playerId || sources[0]?.src } }));
          }
        });
        instance.on("pause", () => onPause?.(instance));
      })
      .catch((e) => console.error(e));

    return () => {
      if (instance) {
        instance.destroy?.();
      }
    };
  }, []);

  const Element = kind === "video" ? "video" : "audio";

  return (
    <div className={`w-full rounded-xl border border-border bg-card/80 shadow-sm overflow-hidden ${className}`}>
      <Element
        ref={ref as any}
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
    </div>
  );
};
