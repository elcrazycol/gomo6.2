import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Crop, FlipHorizontal, Pause, Play, RotateCw, X } from "lucide-react";
import {
  ASPECT_PRESETS,
  type AspectPreset,
  type CropRect,
  type VideoEdit,
} from "@/components/videoEditor/types";
import {
  centeredCrop,
  fractionRatio,
  FULL_CROP,
  isFullCrop,
  moveCrop,
  pixelAspectOf,
  resizeCrop,
  round3,
  type CropHandle,
} from "@/components/videoEditor/geometry";
import { useFilmstrip } from "@/components/videoEditor/useFilmstrip";
import { useFrameCapture } from "@/components/videoEditor/useFrameCapture";
import "./VideoEditor.css";

export type VideoEditorProps = {
  /** Local object URL (or any playable URL) of the clip being edited. */
  src: string;
  fileName?: string;
  /** Called with the picked trim/crop, or null when nothing was changed. */
  onApply: (edit: VideoEdit | null) => void;
  onCancel: () => void;
};

/** Trim shorter than this (seconds) is treated as "no trim". */
const TRIM_EPSILON = 0.05;
/** Smallest gap between the trim handles. */
const MIN_TRIM = 0.1;
/** Number of filmstrip thumbnails. */
const FILMSTRIP_FRAMES = 8;

const HANDLES: CropHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
/** Visible Telegram-style corner brackets (interaction still uses HANDLES). */
const CORNERS = ["nw", "ne", "sw", "se"] as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Clock with tenths, like Telegram's 00:22.2 readout. */
function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00.0";
  return `${formatTime(seconds)}.${Math.floor((seconds * 10) % 10)}`;
}

type CropGesture = {
  handle: CropHandle;
  startX: number;
  startY: number;
  rect: CropRect;
  stageW: number;
  stageH: number;
};

type FilmGesture = {
  kind: "start" | "end" | "playhead";
  left: number;
  width: number;
  /** Playhead dragged by its knob (above the strip): pick a poster frame. */
  poster: boolean;
};

export function VideoEditor({ src, fileName, onApply, onCancel }: VideoEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const filmRef = useRef<HTMLDivElement>(null);
  const cropGestureRef = useRef<CropGesture | null>(null);
  const filmGestureRef = useRef<FilmGesture | null>(null);

  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [trim, setTrim] = useState<[number, number]>([0, 0]);
  const [crop, setCrop] = useState<CropRect>({ ...FULL_CROP });
  const [aspect, setAspect] = useState<AspectPreset>("free");
  const [rotate, setRotate] = useState(0);
  const [mirror, setMirror] = useState(false);
  const [gif, setGif] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [pickingPoster, setPickingPoster] = useState(false);
  const [posterPreview, setPosterPreview] = useState<string | null>(null);
  const [posterTime, setPosterTime] = useState<number | null>(null);

  const frames = useFilmstrip(src, duration, FILMSTRIP_FRAMES);
  const captureFrame = useFrameCapture(src);

  // Refs mirror the latest values for pointer handlers, which may fire between
  // renders while a gesture is in flight.
  const trimRef = useRef(trim);
  trimRef.current = trim;
  const currentRef = useRef(current);
  currentRef.current = current;
  const cropRef = useRef(crop);
  cropRef.current = crop;
  const rotateRef = useRef(rotate);
  rotateRef.current = rotate;
  const mirrorRef = useRef(mirror);
  mirrorRef.current = mirror;
  const lastPreviewAtRef = useRef(0);
  const previewSeqRef = useRef(0);

  // A 90/270° rotation swaps the displayed width and height.
  const quarterTurn = rotate % 180 !== 0;
  const displayedW = quarterTurn ? videoSize.h : videoSize.w;
  const displayedH = quarterTurn ? videoSize.w : videoSize.h;
  const videoAspect = displayedW > 0 && displayedH > 0 ? displayedW / displayedH : 0;

  // Fit the *displayed* (post-rotation) frame into the available area. The
  // video element keeps its natural size and is rotated via CSS, so the crop
  // overlay (in stage coordinates) always matches the frame the user sees.
  const fit = useMemo(() => {
    if (!box.w || !box.h || !displayedW || !displayedH) return { w: 0, h: 0, scale: 0 };
    const scale = Math.min(box.w / displayedW, box.h / displayedH);
    return { w: displayedW * scale, h: displayedH * scale, scale };
  }, [box, displayedW, displayedH]);

  const videoStyle = {
    width: fit.scale ? videoSize.w * fit.scale : undefined,
    height: fit.scale ? videoSize.h * fit.scale : undefined,
    // Mirror first (pre-rotation), then rotate — the same order the backend
    // applies hflip/transpose, so preview and output match.
    transform: `translate(-50%, -50%) rotate(${rotate}deg) scaleX(${mirror ? -1 : 1})`,
  };

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    if (!toolsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setToolsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toolsOpen]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    const d = Number.isFinite(video.duration) ? video.duration : 0;
    setVideoSize({ w: video.videoWidth, h: video.videoHeight });
    setDuration(d);
    setTrim([0, d]);
    setReady(true);
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    setCurrent(video.currentTime);
    const [start, end] = trimRef.current;
    // Loop inside the selected range while previewing a partial trim.
    if (!video.paused && end < duration - TRIM_EPSILON && video.currentTime >= end) {
      video.currentTime = start;
    }
  };

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      const [start, end] = trimRef.current;
      const now = currentRef.current;
      // Resume from the playhead when it sits inside the range; otherwise jump
      // back to the start of the selection.
      const from = now >= start - TRIM_EPSILON && now < end - TRIM_EPSILON ? now : start;
      video.currentTime = from;
      setCurrent(from);
      void video.play();
    } else {
      video.pause();
    }
  }, []);

  // ── Crop frame gestures ──────────────────────────────────────────────────

  const beginCropGesture = (event: React.PointerEvent, handle: CropHandle) => {
    event.preventDefault();
    event.stopPropagation();
    if (!fit.w || !fit.h) return;
    overlayRef.current?.setPointerCapture?.(event.pointerId);
    cropGestureRef.current = {
      handle,
      startX: event.clientX,
      startY: event.clientY,
      rect: crop,
      stageW: fit.w,
      stageH: fit.h,
    };
  };

  const handleCropPointerMove = (event: React.PointerEvent) => {
    const gesture = cropGestureRef.current;
    if (!gesture) return;
    const dx = (event.clientX - gesture.startX) / gesture.stageW;
    const dy = (event.clientY - gesture.startY) / gesture.stageH;
    const pixelAspect = pixelAspectOf(aspect);
    const ratio = pixelAspect != null && videoAspect > 0 ? fractionRatio(pixelAspect, videoAspect) : 0;
    setCrop(
      gesture.handle === "move"
        ? moveCrop(gesture.rect, dx, dy)
        : resizeCrop(gesture.rect, gesture.handle, dx, dy, ratio),
    );
  };

  const endCropGesture = (event: React.PointerEvent) => {
    if (!cropGestureRef.current) return;
    cropGestureRef.current = null;
    overlayRef.current?.releasePointerCapture?.(event.pointerId);
  };

  // ── Filmstrip gestures (trim handles + playhead scrubbing) ───────────────

  // Capture the frame at `time` for the poster preview, throttled so a drag
  // does not queue a seek per pointer move. Only the newest capture is kept.
  const requestPosterPreview = (time: number) => {
    const now = performance.now();
    if (now - lastPreviewAtRef.current < 110) return;
    lastPreviewAtRef.current = now;
    const seq = (previewSeqRef.current += 1);
    void captureFrame(time, cropRef.current, rotateRef.current, mirrorRef.current).then((url) => {
      if (url && seq === previewSeqRef.current) setPosterPreview(url);
    });
  };

  const applyFilmPoint = (clientX: number) => {
    const gesture = filmGestureRef.current;
    if (!gesture || gesture.width <= 0 || duration <= 0) return;
    const fraction = clamp((clientX - gesture.left) / gesture.width, 0, 1);
    const time = fraction * duration;
    const [start, end] = trimRef.current;
    if (gesture.kind === "start") {
      setTrim([clamp(Math.min(time, end - MIN_TRIM), 0, duration), end]);
    } else if (gesture.kind === "end") {
      setTrim([start, clamp(Math.max(time, start + MIN_TRIM), 0, duration)]);
    } else {
      const t = clamp(time, 0, duration);
      const video = videoRef.current;
      if (video) video.currentTime = t;
      setCurrent(t);
      if (gesture.poster) requestPosterPreview(t);
    }
  };

  const beginFilmGesture = (event: React.PointerEvent) => {
    const el = filmRef.current;
    if (!el || duration <= 0) return;
    event.preventDefault();
    const rect = el.getBoundingClientRect();
    const target = event.target as HTMLElement;
    const role = target.dataset.role;
    const kind: FilmGesture["kind"] = role === "start" ? "start" : role === "end" ? "end" : "playhead";
    // Dragging the playhead *knob* (the circle above the strip) picks a poster
    // frame; dragging anywhere else on the strip just scrubs.
    const poster = kind === "playhead" && !!target.closest(".ve-film-playhead");
    filmGestureRef.current = { kind, left: rect.left, width: rect.width, poster };
    el.setPointerCapture?.(event.pointerId);
    // Scrubbing/trimming should not fight live playback.
    videoRef.current?.pause();
    if (kind === "playhead") {
      setScrubbing(true);
      if (poster) {
        setPickingPoster(true);
        lastPreviewAtRef.current = 0; // force the first capture immediately
      }
      applyFilmPoint(event.clientX);
    }
  };

  const handleFilmPointerMove = (event: React.PointerEvent) => {
    if (filmGestureRef.current) applyFilmPoint(event.clientX);
  };

  const endFilmGesture = (event: React.PointerEvent) => {
    const gesture = filmGestureRef.current;
    if (!gesture) return;
    filmGestureRef.current = null;
    setScrubbing(false);
    if (gesture.poster) {
      // Where the knob is released becomes the poster frame.
      setPosterTime(currentRef.current);
      setPickingPoster(false);
      setPosterPreview(null);
    }
    filmRef.current?.releasePointerCapture?.(event.pointerId);
  };

  // ── Misc ─────────────────────────────────────────────────────────────────

  const selectAspect = (preset: AspectPreset) => {
    setAspect(preset);
    if (preset !== "free") setCrop(centeredCrop(videoAspect, preset));
  };

  const resetAll = () => {
    setTrim([0, duration]);
    setAspect("free");
    setCrop({ ...FULL_CROP });
    setRotate(0);
    setMirror(false);
    setGif(false);
    setPosterTime(null);
    setPosterPreview(null);
    setPickingPoster(false);
  };

  const handleApply = () => {
    const edit: VideoEdit = {};
    const trimmed = trim[0] > TRIM_EPSILON || (duration > 0 && trim[1] < duration - TRIM_EPSILON);
    if (trimmed) {
      edit.start = round3(trim[0]);
      edit.end = round3(trim[1]);
    }
    if (!isFullCrop(crop)) {
      edit.crop = {
        x: round3(crop.x),
        y: round3(crop.y),
        w: round3(crop.w),
        h: round3(crop.h),
      };
    }
    if (rotate % 360 !== 0) edit.rotate = ((rotate % 360) + 360) % 360;
    if (mirror) edit.mirror = true;
    if (gif) edit.muted = true;
    if (posterTime != null && posterTime > TRIM_EPSILON) edit.poster = round3(posterTime);
    onApply(Object.keys(edit).length > 0 ? edit : null);
  };

  const cropStyle = {
    left: `${crop.x * 100}%`,
    top: `${crop.y * 100}%`,
    width: `${crop.w * 100}%`,
    height: `${crop.h * 100}%`,
  };

  const showOverlay = ready && fit.w > 0 && fit.h > 0;
  const pct = (value: number) => (duration > 0 ? clamp((value / duration) * 100, 0, 100) : 0);
  const startPct = pct(trim[0]);
  const endPct = pct(trim[1]);
  const currentPct = pct(current);
  const posterPct = posterTime != null ? pct(posterTime) : 0;

  return createPortal(
    <div
      className="ve-root"
      role="dialog"
      aria-modal="true"
      aria-label={fileName ? `Редактор видео: ${fileName}` : "Редактор видео"}
    >
      <div className="ve-stage-area">
        <div ref={containerRef} className="ve-stage-fit">
          {loadError ? (
            <div className="ve-error">
              <p>Не удалось открыть видео</p>
              <button type="button" className="ve-secondary" onClick={onCancel}>
                Закрыть
              </button>
            </div>
          ) : (
            <div
              className="ve-stage"
              style={{ width: fit.w || undefined, height: fit.h || undefined }}
            >
              <video
                ref={videoRef}
                className="ve-video"
                style={videoStyle}
                src={src}
                playsInline
                muted={gif}
                preload="metadata"
                onClick={togglePlay}
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleTimeUpdate}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onError={() => setLoadError(true)}
              />

              {showOverlay && (
                <div
                  ref={overlayRef}
                  className="ve-overlay"
                  onPointerMove={handleCropPointerMove}
                  onPointerUp={endCropGesture}
                  onPointerCancel={endCropGesture}
                >
                  <div
                    className="ve-crop"
                    style={cropStyle}
                    onPointerDown={(e) => beginCropGesture(e, "move")}
                  >
                    {CORNERS.map((corner) => (
                      <span
                        key={corner}
                        aria-hidden="true"
                        className={`ve-corner ve-corner-${corner}`}
                      />
                    ))}
                    {HANDLES.map((handle) => (
                      <button
                        key={handle}
                        type="button"
                        tabIndex={-1}
                        aria-hidden="true"
                        className={`ve-handle ve-handle-${handle}`}
                        onPointerDown={(e) => beginCropGesture(e, handle)}
                      />
                    ))}
                  </div>
                </div>
              )}

              <button
                type="button"
                className="ve-play"
                onClick={togglePlay}
                aria-label={playing ? "Пауза" : "Воспроизвести"}
              >
                {playing ? <Pause size={22} /> : <Play size={22} />}
              </button>
            </div>
          )}
        </div>
      </div>

      <footer className="ve-footer">
        <div
          ref={filmRef}
          className="ve-film"
          onPointerDown={beginFilmGesture}
          onPointerMove={handleFilmPointerMove}
          onPointerUp={endFilmGesture}
          onPointerCancel={endFilmGesture}
        >
          {/* Frames + selection are clipped to the rounded strip; the playhead
              stays outside so its knob can sit above the strip. */}
          <div className="ve-film-clip">
            <div className="ve-film-frames">
              {frames.length > 0 ? (
                frames.map((frame, index) => (
                  <img key={index} src={frame} alt="" draggable={false} />
                ))
              ) : (
                <div className="ve-film-empty" />
              )}
            </div>

            <div className="ve-film-dim" style={{ left: 0, width: `${startPct}%` }} />
            <div className="ve-film-dim" style={{ right: 0, width: `${100 - endPct}%` }} />

            <div
              className="ve-film-selection"
              style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
            >
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                data-role="start"
                className="ve-film-handle ve-film-handle-start"
              />
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                data-role="end"
                className="ve-film-handle ve-film-handle-end"
              />
            </div>
          </div>

          <div
            className={`ve-film-playhead ${scrubbing ? "is-active" : ""}`}
            data-role="playhead"
            style={{ left: `${currentPct}%` }}
          >
            <span className="ve-film-playhead-dot" />
          </div>

          {/* Red marker: where the poster (thumbnail) frame sits. */}
          {posterTime != null && (
            <div className="ve-film-poster" style={{ left: `${posterPct}%` }} />
          )}

          {/* Frame-accurate preview shown while dragging the playhead knob. */}
          {pickingPoster && posterPreview && (
            <div className="ve-film-frame" style={{ left: `${currentPct}%` }}>
              <img src={posterPreview} alt="" draggable={false} />
            </div>
          )}
        </div>

        <div className="ve-times">
          <span>{formatTime(trim[0])}</span>
          <span className="ve-current">{formatClock(current)}</span>
          <span>{formatTime(trim[1])}</span>
        </div>

        {toolsOpen && (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="ve-tools-backdrop"
            onClick={() => setToolsOpen(false)}
          />
        )}

        {/* The whole bottom bar is one pill: round buttons on a shared body.
            Pressing a tool grows the pill upward, revealing its panel. */}
        <div className={`ve-dock ${toolsOpen ? "is-open" : ""}`}>
          <div className="ve-dock-expander">
            <div className="ve-dock-expander-inner">
              <div className="ve-dock-panel" role="group" aria-label="Соотношение сторон">
                {ASPECT_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`ve-aspect ${aspect === preset.id ? "is-active" : ""}`}
                    onClick={() => {
                      selectAspect(preset.id);
                      setToolsOpen(false);
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="ve-tools-reset"
                  onClick={() => {
                    resetAll();
                    setToolsOpen(false);
                  }}
                  disabled={!ready}
                >
                  Сбросить
                </button>
              </div>
            </div>
          </div>

          <div className="ve-dock-row">
            <button
              type="button"
              className="ve-dock-btn ve-dock-btn--plain"
              onClick={onCancel}
              aria-label="Отмена"
            >
              <X size={22} />
            </button>
            <button
              type="button"
              className={`ve-dock-btn ve-dock-btn--plain ${toolsOpen ? "is-active" : ""}`}
              onClick={() => setToolsOpen((open) => !open)}
              aria-label="Кадрирование"
              aria-expanded={toolsOpen}
            >
              <Crop size={21} />
            </button>
            <button
              type="button"
              className={`ve-dock-btn ve-dock-btn--plain ${mirror ? "is-active" : ""}`}
              onClick={() => setMirror((value) => !value)}
              aria-label="Отзеркалить"
              aria-pressed={mirror}
            >
              <FlipHorizontal size={21} />
            </button>
            <button
              type="button"
              className={`ve-dock-btn ve-dock-btn--plain ${rotate % 360 !== 0 ? "is-active" : ""}`}
              onClick={() => setRotate((value) => (value + 90) % 360)}
              aria-label="Повернуть"
            >
              <RotateCw size={21} />
            </button>
            <button
              type="button"
              className={`ve-dock-btn ve-dock-btn--gif ${gif ? "is-active" : ""}`}
              onClick={() => setGif((value) => !value)}
              aria-label="GIF (без звука)"
              aria-pressed={gif}
            >
              <span className="ve-dock-label">GIF</span>
            </button>
            <button
              type="button"
              className="ve-dock-btn ve-dock-btn--primary"
              onClick={handleApply}
              disabled={!ready}
              aria-label="Готово"
            >
              <Check size={22} />
            </button>
          </div>
        </div>
      </footer>
    </div>,
    document.body,
  );
}

export default VideoEditor;
