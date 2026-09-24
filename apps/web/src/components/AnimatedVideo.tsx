import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { shouldAutoplay, useAnimatedVideoStore } from "@/stores/animatedVideoStore";
import "./AnimatedVideo.css";

export type AnimatedVideoProps = {
  src: string;
  poster?: string;
  /** Reserves the box up-front so the feed does not jump while it loads. */
  aspectRatio?: number;
  className?: string;
  /** When provided, tapping opens (e.g. the lightbox) instead of toggling. */
  onOpen?: () => void;
  /** When false the clip ignores pointer events — the parent handles taps. */
  interactive?: boolean;
  ariaLabel?: string;
  /** Fires once the first frame is decoded (for the caller's load state). */
  onReady?: () => void;
};

const NEAR_MARGIN = "300px";

/**
 * Autoplaying, looping, muted clip — Telegram-style "GIF".
 *
 * Deliberately independent of VideoPlayer: it has no controls, no fullscreen
 * and no seek bar. It lazily attaches `src` only when near the viewport, plays
 * when at least half visible (and chosen by the global manager), pauses when it
 * scrolls away or the tab is hidden, and releases the decoder when it is far.
 * Autoplay is muted-from-the-start via a ref (Safari/Chrome require it), and a
 * blocked autoplay falls back to a poster with a play button.
 */
export function AnimatedVideo({
  src,
  poster,
  aspectRatio,
  className,
  onOpen,
  interactive = true,
  ariaLabel,
  onReady,
}: AnimatedVideoProps) {
  const id = useId();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const active = useAnimatedVideoStore((state) => state.activeIds.includes(id));
  const autoplayMode = useAnimatedVideoStore((state) => state.autoplayMode);
  const register = useAnimatedVideoStore((state) => state.register);
  const unregister = useAnimatedVideoStore((state) => state.unregister);

  const autoplayAllowed = shouldAutoplay(autoplayMode);

  // muted must be a real DOM property before play() — React's `muted` attribute
  // is unreliable and an unmuted autoplay is rejected outright.
  useLayoutEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = true;
    el.defaultMuted = true;
    el.disablePictureInPicture = true;
    (el as HTMLVideoElement & { disableRemotePlayback?: boolean }).disableRemotePlayback = true;
  }, []);

  // Two observers: `near` (300px margin) gates loading, `visible` (50%) gates
  // playback. They must be separate — with a single expanded-root observer a
  // short (landscape) clip reaches ratio 1 while still off-screen, so playback
  // would never start without a tap.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setNear(true);
      setVisible(true);
      return;
    }
    const nearObserver = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      rootMargin: NEAR_MARGIN,
      threshold: 0,
    });
    const visibleObserver = new IntersectionObserver(
      ([entry]) => setVisible(entry.intersectionRatio >= 0.5),
      { threshold: [0, 0.5, 1] },
    );
    nearObserver.observe(el);
    visibleObserver.observe(el);
    return () => {
      nearObserver.disconnect();
      visibleObserver.disconnect();
    };
  }, []);

  // Compete for one of the global playback slots only while near the viewport.
  useEffect(() => {
    const el = containerRef.current;
    if (!near || !el) return;
    register(id, el);
    return () => unregister(id);
  }, [near, id, register, unregister]);

  // Attach/detach the source, releasing the decoder when far away.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (near) {
      if (el.getAttribute("src") !== src) el.setAttribute("src", src);
    } else if (el.hasAttribute("src")) {
      el.removeAttribute("src");
      el.load();
    }
  }, [near, src]);

  const shouldPlay = near && visible && active && autoplayAllowed;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (shouldPlay) {
      el.play()
        .then(() => {
          setPlaying(true);
          setBlocked(false);
        })
        .catch(() => {
          setPlaying(false);
          setBlocked(true);
        });
    } else {
      el.pause();
      setPlaying(false);
    }
  }, [shouldPlay]);

  // A hidden tab must not keep decoders busy.
  useEffect(() => {
    const onVisibility = () => {
      const el = videoRef.current;
      if (!el) return;
      if (document.hidden) el.pause();
      else if (shouldPlay) void el.play().catch(() => setBlocked(true));
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [shouldPlay]);

  const play = () => {
    void videoRef.current
      ?.play()
      .then(() => {
        setPlaying(true);
        setBlocked(false);
      })
      .catch(() => setBlocked(true));
  };

  const toggle = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) play();
    else {
      el.pause();
      setPlaying(false);
    }
  };

  const handleClick = () => {
    if (!interactive) return;
    if (onOpen) onOpen();
    else toggle();
  };

  const showFallback = near && !playing && (!autoplayAllowed || blocked);
  const showToggle = Boolean(onOpen) && interactive && playing;

  return (
    <div
      ref={containerRef}
      className={`animated-video${className ? ` ${className}` : ""}`}
      style={aspectRatio ? { aspectRatio } : undefined}
    >
      <video
        ref={videoRef}
        className="animated-video-el"
        poster={poster}
        playsInline
        loop
        muted
        preload="metadata"
        aria-label={ariaLabel}
        onClick={handleClick}
        style={{ pointerEvents: interactive ? undefined : "none" }}
        onPlaying={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedData={onReady}
      />

      {showFallback && (
        <button
          type="button"
          className="animated-video-fallback"
          onClick={(event) => {
            event.stopPropagation();
            play();
          }}
          aria-label="Воспроизвести"
        >
          <Play size={22} fill="currentColor" />
        </button>
      )}

      {showToggle && (
        <button
          type="button"
          className="animated-video-toggle"
          onClick={(event) => {
            event.stopPropagation();
            toggle();
          }}
          aria-label="Пауза"
        >
          <Pause size={16} fill="currentColor" />
        </button>
      )}
    </div>
  );
}

export default AnimatedVideo;
