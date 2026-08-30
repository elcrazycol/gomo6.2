import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Maximize, Minimize, Pause, Play, Volume2, VolumeX } from "lucide-react";

/** Minimalist, X/Telegram-style video player with curated, custom controls.
    No third-party player library — just a thin skin over <video> that behaves
    the same on desktop and mobile:
    - transparent inline post with a blurred poster backdrop;
    - full screen runs through the native Fullscreen API on the player's own
      container, so it is genuinely "on top of everything" with a single
      stutter-free <video> element and one place that owns playback state.
    - thin seek line at the bottom, auto-hidden controls while playing, and a
      full keyboard map (space, arrows, m, f, Esc).
    - the design spends its one accent on the seek progress fill; everything
      else stays quiet white-on-black. */

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
};

const HIDE_DELAY = 2500;
const SEEK_STEP = 5;

interface MediaSource {
  src: string;
  type?: string;
}

interface VideoPlayerProps {
  sources: MediaSource[];
  poster?: string;
  className?: string;
  title?: string;
  /** Let full screen actually request the browser's fullscreen surface. */
  canFullscreen?: boolean;
}

const iconButtonClass = "flex items-center justify-center rounded-full p-2 text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60";

/** Thin seek line: a 3px track with live buffer + progress fill tinted by the
    theme primary, a dot that appears on hover/scrub, and full pointer+keyboard
    scrubbing. */
function SeekBar({
  current,
  duration,
  buffered,
  onChange,
}: {
  current: number;
  duration: number;
  buffered: number;
  onChange: (next: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const ratio = duration > 0 ? Math.min(1, Math.max(0, current / duration)) : 0;
  const bufferRatio = duration > 0 ? Math.min(1, Math.max(0, buffered / duration)) : 0;

  const positionFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    if (rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrubbing(true);
    onChange(positionFromClientX(e.clientX) * duration);
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = positionFromClientX(e.clientX);
    setHoverX(r);
    if (scrubbing) onChange(r * duration);
  };
  const endScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    setScrubbing(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); onChange(Math.max(0, current - SEEK_STEP)); }
    if (e.key === "ArrowRight") { e.preventDefault(); onChange(Math.min(duration, current + SEEK_STEP)); }
    if (e.key === "Home") { e.preventDefault(); onChange(0); }
    if (e.key === "End") { e.preventDefault(); onChange(duration); }
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label="Прогресс"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(current)}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endScrub}
      onPointerCancel={endScrub}
      onPointerLeave={() => setHoverX(null)}
      onKeyDown={handleKeyDown}
      className="group/seek relative h-5 w-full cursor-pointer touch-none select-none"
    >
      <div className="absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/20">
        <div className="absolute inset-y-0 left-0 rounded-full bg-white/25" style={{ width: `${bufferRatio * 100}%` }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${ratio * 100}%` }} />
      </div>
      {/* Preview dot while hovering/scrubbing. */}
      {hoverX !== null && (
        <div
          className="absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
          style={{ left: `${hoverX * 100}%` }}
        />
      )}
      <div
        className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow transition-opacity group-hover/seek:opacity-100 group-focus-visible/seek:opacity-100"
        style={{ left: `${ratio * 100}%`, opacity: scrubbing ? 1 : undefined }}
      />
    </div>
  );
}

export const VideoPlayer = ({ sources, poster, className = "", title, canFullscreen = true }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [backdropLoaded, setBackdropLoaded] = useState(false);
  const [error, setError] = useState(false);

  const togglePlay = useCallback(async () => {
    const el = videoRef.current;
    if (!el) return;
    try {
      if (el.paused || el.ended) await el.play();
      else el.pause();
    } catch {
      setBuffering(false);
    }
  }, []);

  const toggleMute = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  }, []);

  const seekTo = useCallback((next: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = next;
    setCurrent(next);
  }, []);

  const armHideTimer = useCallback(() => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    if (!playing) return;
    hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), HIDE_DELAY);
  }, [playing]);

  useEffect(() => () => { if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current); }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    armHideTimer();
  }, [armHideTimer]);

  // Track native full screen state via the Fullscreen API.
  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement === containerRef.current));
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // Show controls whenever the playback or visibility state changes.
  useEffect(() => {
    setControlsVisible(true);
    armHideTimer();
  }, [playing, isFullscreen, armHideTimer]);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el || !canFullscreen) return;
    if (document.fullscreenElement === el) {
      await document.exitFullscreen().catch(() => {});
    } else {
      await el.requestFullscreen?.().catch(() => {});
    }
  }, [canFullscreen]);

  const controlsHidden = isFullscreen ? !controlsVisible : false;
  const showCenterPlay = !playing && !buffering && !error;

  const handleContainerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.defaultPrevented) return;
    if (e.key === " ") { e.preventDefault(); togglePlay(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); seekTo(Math.max(0, current - SEEK_STEP)); }
    else if (e.key === "ArrowRight") { e.preventDefault(); seekTo(Math.min(duration || current, current + SEEK_STEP)); }
    else if (e.key.toLowerCase() === "m") { toggleMute(); }
    else if (e.key.toLowerCase() === "f") { toggleFullscreen(); }
    else if (e.key === "Escape" && isFullscreen) { toggleFullscreen(); }
  }, [togglePlay, seekTo, current, duration, toggleMute, toggleFullscreen, isFullscreen]);

  // Click toggles play; double-click toggles full screen (X-style).
  const clickTimerRef = useRef<number | null>(null);
  const handleClick = useCallback(() => {
    if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
    clickTimerRef.current = window.setTimeout(() => { togglePlay(); }, 200);
  }, [togglePlay]);
  const handleDoubleClick = useCallback(() => {
    if (clickTimerRef.current) { window.clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
    toggleFullscreen();
  }, [toggleFullscreen]);
  useEffect(() => () => { if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current); }, []);

  const setVolumeFromInput = useCallback((v: number) => {
    const el = videoRef.current;
    if (!el) return;
    const next = Math.min(1, Math.max(0, v));
    el.volume = next;
    el.muted = next === 0;
    setVolume(next);
    setMuted(next === 0);
  }, []);
  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="group"
      aria-label={title || "Видео"}
      onKeyDown={handleContainerKeyDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onPointerMove={revealControls}
      className={`group relative cursor-pointer select-none overflow-hidden rounded-xl bg-black outline-none ${isFullscreen ? "fixed inset-0 z-[1000] h-full max-h-[100vh] w-full max-w-[100vw]" : className}`}
    >
      {/* Instagram-style letterboxed backdrop for portrait clips. */}
      {poster && (
        <>
          <img
            src={poster}
            alt=""
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover blur-2xl transition-opacity duration-300 ${backdropLoaded ? "opacity-100" : "opacity-0"}`}
            onLoad={() => setBackdropLoaded(true)}
          />
          <div className="pointer-events-none absolute inset-0 bg-black/30" />
        </>
      )}

      <div className="relative flex h-full w-full items-center justify-center">
        <video
          ref={videoRef}
          className={`block bg-black object-contain ${isFullscreen ? "h-full w-full" : "mx-auto h-auto max-h-[70vh] w-auto max-w-full"}`}
          playsInline
          preload="metadata"
          poster={poster}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onPlay={() => { setPlaying(true); setBuffering(false); }}
          onPause={() => setPlaying(false)}
          onWaiting={() => setBuffering(true)}
          onPlaying={() => setBuffering(false)}
          onCanPlay={() => setBuffering(false)}
          onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
          onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
          onProgress={(e) => {
            const br = e.currentTarget.buffered;
            if (br.length > 0) setBuffered(br.end(br.length - 1));
          }}
          onVolumeChange={(e) => { setMuted(e.currentTarget.muted); setVolume(e.currentTarget.volume); }}
          onError={() => setError(true)}
        >
          {sources.map((s, i) => <source key={i} src={s.src} type={s.type} />)}
          Ваш браузер не поддерживает воспроизведение.
        </video>
      </div>

      {showCenterPlay && (          <button
            type="button"
            aria-label="Воспроизвести"
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/45 p-4 text-white shadow-lg backdrop-blur-sm transition hover:scale-105 hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            // The container also listens to clicks (for click-to-toggle and
            // double-click fullscreen). Without stopPropagation a centre-button
            // play would bubble up, schedule the delayed container toggle, and
            // the video would pause ~200ms after it started playing.
            onClick={(e) => { e.stopPropagation(); togglePlay(); }}
          >
            <Play className="h-8 w-8 fill-current pl-0.5" />
          </button>
      )}

      {buffering && !error && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white">
          <Loader2 className="h-9 w-9 animate-spin" />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-4 text-center text-sm text-white/85">
          Не удалось воспроизвести видео
        </div>
      )}

      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pb-2.5 pt-10 transition-opacity duration-300 ${controlsHidden ? "pointer-events-none opacity-0" : "opacity-100"}`}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <SeekBar current={current} duration={duration} buffered={buffered} onChange={seekTo} />
        <div className="mt-1 flex items-center gap-1">
          <button type="button" aria-label={playing ? "Поставить на паузу" : "Воспроизвести"} className={iconButtonClass} onClick={togglePlay}>
            {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current pl-0.5" />}
          </button>

          <button type="button" aria-label={muted ? "Включить звук" : "Выключить звук"} className={iconButtonClass} onClick={toggleMute}>
            {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>

          <div className="relative hidden w-20 items-center sm:flex" onClick={(e) => e.stopPropagation()}>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={muted ? 0 : volume}
              aria-label="Громкость"
              onChange={(e) => setVolumeFromInput(Number(e.target.value))}
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/25 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            />
          </div>

          <span className="px-2 font-mono text-xs tabular-nums text-white/85">
            {formatTime(current)}<span className="text-white/50"> / {formatTime(duration)}</span>
          </span>

          <div className="flex-1" />

          {title && isFullscreen && <span className="truncate px-2 text-sm text-white/85">{title}</span>}

          <button type="button" aria-label={isFullscreen ? "Выйти из полного экрана" : "На весь экран"} className={iconButtonClass} onClick={toggleFullscreen} disabled={!canFullscreen}>
            {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
          </button>
        </div>
      </div>
    </div>
  );
};