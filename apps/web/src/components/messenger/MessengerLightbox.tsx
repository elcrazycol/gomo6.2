import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useEmblaCarousel from "embla-carousel-react";
import { X, Download, ZoomOut, ChevronLeft, ChevronRight } from "lucide-react";
import type { Attachment } from "./types";
import { useAuthenticatedAttachmentUrl } from "./attachmentMedia";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const WHEEL_ZOOM_STEP = 1.25;
const BUTTON_ZOOM_STEP = 1.4;
const DOUBLE_CLICK_ZOOM = 2.5;

type Pan = { x: number; y: number };
const IDENTITY_PAN: Pan = { x: 0, y: 0 };

/** Zoom around an anchor point expressed relative to the slide center. */
function zoomAround(prevZoom: number, prevPan: Pan, newZoom: number, anchorX: number, anchorY: number): { zoom: number; pan: Pan } {
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom));
  if (clamped === MIN_ZOOM) return { zoom: MIN_ZOOM, pan: IDENTITY_PAN };
  const ratio = clamped / prevZoom;
  return {
    zoom: clamped,
    pan: {
      x: anchorX - (anchorX - prevPan.x) * ratio,
      y: anchorY - (anchorY - prevPan.y) * ratio,
    },
  };
}

type LightboxSlideProps = {
  attachment: Attachment;
  index: number;
  active: boolean;
  enabled: boolean;
  zoom: number;
  pan: Pan;
  onZoom: (zoom: number, pan: Pan) => void;
  onPan: (pan: Pan) => void;
  onOriginalLoaded: (index: number, url: string) => void;
};

function LightboxSlide({ attachment, index, active, enabled, zoom, pan, onZoom, onPan, onOriginalLoaded }: LightboxSlideProps) {
  const url = useAuthenticatedAttachmentUrl(attachment, attachment.url, enabled);
  const imgRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);
  const dragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  // Live mirror of pan so the native pointer listeners never need to re-attach
  // on every pan step.
  const panRef = useRef(pan);
  panRef.current = pan;

  const isImage = attachment.type === "image";
  const isZoomed = zoom > MIN_ZOOM;

  useEffect(() => {
    if (url) onOriginalLoaded(index, url);
  }, [index, url, onOriginalLoaded]);

  // Wheel zoom around the cursor. Attached natively so we can preventDefault
  // (React's wheel listeners are passive on some roots).
  useEffect(() => {
    const el = imgRef.current;
    if (!el || !active || !isImage) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const anchorX = event.clientX - rect.left - rect.width / 2;
      const anchorY = event.clientY - rect.top - rect.height / 2;
      const direction = event.deltaY < 0 ? 1 : -1;
      if (zoom === MIN_ZOOM && direction < 0) {
        setIsAnimating(true);
        const next = zoomAround(zoom, pan, WHEEL_ZOOM_STEP, anchorX, anchorY);
        onZoom(next.zoom, next.pan);
      } else if (zoom > MIN_ZOOM) {
        const factor = direction > 0 ? 1 / WHEEL_ZOOM_STEP : WHEEL_ZOOM_STEP;
        const next = zoomAround(zoom, pan, zoom * factor, anchorX, anchorY);
        onZoom(next.zoom, next.pan);
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [active, isImage, zoom, pan, onZoom]);

  // While zoomed, dragging pans the image. A native capture-phase pointerdown
  // stops the event before it reaches embla's viewport listener — React's
  // delegated stopPropagation would fire too late (after embla already saw it).
  useEffect(() => {
    const el = imgRef.current as HTMLImageElement | null;
    if (!el || !active || !isImage || !isZoomed) return;

    const onPointerDown = (event: PointerEvent) => {
      event.stopPropagation();
      el.setPointerCapture(event.pointerId);
      dragRef.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
    };
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.lastX;
      const dy = event.clientY - drag.lastY;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      onPan({ x: panRef.current.x + dx, y: panRef.current.y + dy });
    };
    const onPointerUp = (event: PointerEvent) => {
      if (dragRef.current?.pointerId !== event.pointerId) return;
      dragRef.current = null;
      try {
        el.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer already released.
      }
    };

    el.addEventListener("pointerdown", onPointerDown, { capture: true });
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown, { capture: true });
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
    };
  }, [active, isImage, isZoomed, onPan]);

  const handleDoubleClick = (event: React.MouseEvent<HTMLImageElement>) => {
    if (!isImage) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const anchorX = event.clientX - rect.left - rect.width / 2;
    const anchorY = event.clientY - rect.top - rect.height / 2;
    setIsAnimating(true);
    if (isZoomed) {
      onZoom(MIN_ZOOM, IDENTITY_PAN);
    } else {
      onZoom(DOUBLE_CLICK_ZOOM, { x: anchorX, y: anchorY });
    }
  };

  // Fade the transition class out so panning stays 1:1 with the pointer.
  useEffect(() => {
    if (!isAnimating) return;
    const timer = window.setTimeout(() => setIsAnimating(false), 200);
    return () => window.clearTimeout(timer);
  }, [isAnimating]);

  return (
    <div className="msg-lightbox-slide" data-active={active || undefined}>
      {isImage ? (
        url ? (
          <img
            ref={imgRef as React.RefObject<HTMLImageElement>}
            src={url}
            alt={attachment.name}
            decoding="async"
            draggable={false}
            className={`msg-lightbox-media${isAnimating ? " is-zooming" : ""}${isZoomed ? " is-pannable" : ""}`}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            onDoubleClick={handleDoubleClick}
          />
        ) : (
          <span className="msg-attachment-loading-shimmer" aria-label="Загрузка оригинала" />
        )
      ) : (
        url ? (
          <video
            ref={imgRef as React.RefObject<HTMLVideoElement>}
            src={url}
            controls
            autoPlay
            playsInline
            className="msg-lightbox-media"
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <span className="msg-attachment-loading-shimmer" aria-label="Загрузка видео" />
        )
      )}
    </div>
  );
}

type MessengerLightboxProps = {
  attachments: Attachment[];
  initialIndex: number;
  onClose: () => void;
};

export function MessengerLightbox({ attachments, initialIndex, onClose }: MessengerLightboxProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    startIndex: initialIndex,
    containScroll: "trimSnaps",
    duration: 30,
  });
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState<Pan>(IDENTITY_PAN);
  const [originalUrls, setOriginalUrls] = useState<(string | null)[]>(() => attachments.map(() => null));

  const current = attachments[selectedIndex];
  const isImage = current?.type === "image";

  const handleSelect = useCallback(() => {
    setSelectedIndex(emblaApi?.selectedScrollSnap() ?? 0);
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on("select", handleSelect);
    return () => {
      emblaApi.off("select", handleSelect);
    };
  }, [emblaApi, handleSelect]);

  // Switching slides resets zoom/pan (Telegram behaviour).
  useEffect(() => {
    setZoom(MIN_ZOOM);
    setPan(IDENTITY_PAN);
  }, [selectedIndex]);

  const handleOriginalLoaded = useCallback((index: number, url: string) => {
    setOriginalUrls((prev) => prev.map((existing, i) => (i === index ? url : existing)));
  }, []);

  const handleZoom = useCallback((nextZoom: number, nextPan: Pan) => {
    setZoom(nextZoom);
    setPan(nextPan);
  }, []);

  const handlePan = useCallback((nextPan: Pan) => {
    setPan(nextPan);
  }, []);

  const scrollTo = useCallback(
    (index: number) => {
      if (!emblaApi) return;
      emblaApi.scrollTo(index);
    },
    [emblaApi],
  );

  const resetZoom = useCallback(() => {
    setZoom(MIN_ZOOM);
    setPan(IDENTITY_PAN);
  }, []);

  const zoomAroundCenter = useCallback(
    (factor: number) => {
      const next = zoomAround(zoom, pan, zoom * factor, 0, 0);
      setZoom(next.zoom);
      setPan(next.pan);
    },
    [zoom, pan],
  );

  // Keyboard: Esc closes, arrows navigate (only while not zoomed), +/- zoom.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (zoom === MIN_ZOOM && event.key === "ArrowLeft") {
        scrollTo(Math.max(0, selectedIndex - 1));
      } else if (zoom === MIN_ZOOM && event.key === "ArrowRight") {
        scrollTo(Math.min(attachments.length - 1, selectedIndex + 1));
      } else if (isImage && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        zoomAroundCenter(BUTTON_ZOOM_STEP);
      } else if (isImage && event.key === "-") {
        event.preventDefault();
        zoomAroundCenter(1 / BUTTON_ZOOM_STEP);
      } else if (isImage && event.key === "0") {
        resetZoom();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, zoom, isImage, scrollTo, selectedIndex, attachments.length, zoomAroundCenter, resetZoom]);

  const currentOriginal = originalUrls[selectedIndex];
  const canZoomOut = zoom > MIN_ZOOM;
  const showArrows = attachments.length > 1;

  // Clicking anywhere outside the media (and the top bar / arrows) closes the
  // viewer. Guarded with closest() because slides and controls cover the stage.
  const handleRootMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest(".msg-lightbox-slide")) return;
    if (target.closest(".msg-lightbox-topbar")) return;
    if (target.closest(".msg-lightbox-arrow")) return;
    onClose();
  };

  return createPortal(
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div className="msg-lightbox" role="dialog" aria-modal="true" aria-label="Просмотр медиа" onMouseDown={handleRootMouseDown}>

      <div className="msg-lightbox-topbar">
        <span className="msg-lightbox-counter">
          {selectedIndex + 1} / {attachments.length}
        </span>
        <div className="msg-lightbox-actions">
          <a
            className={`msg-lightbox-action${currentOriginal ? "" : " is-disabled"}`}
            href={currentOriginal ?? undefined}
            download={current?.name}
            aria-label="Скачать"
            onClick={(event) => {
              if (!currentOriginal) event.preventDefault();
            }}
          >
            <Download size={18} />
          </a>
          <button
            type="button"
            className="msg-lightbox-action"
            onClick={resetZoom}
            disabled={!canZoomOut}
            aria-label="Сбросить масштаб"
            title="Сбросить масштаб (0)"
          >
            <ZoomOut size={18} />
          </button>
          <button type="button" className="msg-lightbox-action" onClick={onClose} aria-label="Закрыть" title="Закрыть (Esc)">
            <X size={18} />
          </button>
        </div>
      </div>

      {showArrows && (
        <>
          <button
            type="button"
            className="msg-lightbox-arrow prev"
            onClick={() => scrollTo(Math.max(0, selectedIndex - 1))}
            aria-label="Предыдущее фото"
            disabled={zoom > MIN_ZOOM}
          >
            <ChevronLeft size={26} />
          </button>
          <button
            type="button"
            className="msg-lightbox-arrow next"
            onClick={() => scrollTo(Math.min(attachments.length - 1, selectedIndex + 1))}
            aria-label="Следующее фото"
            disabled={zoom > MIN_ZOOM}
          >
            <ChevronRight size={26} />
          </button>
        </>
      )}

      <div className="msg-lightbox-viewport" ref={emblaRef}>
        <div className="msg-lightbox-track">
          {attachments.map((attachment, index) => (
            <LightboxSlide
              key={attachment.id || attachment.url + index}
              attachment={attachment}
              index={index}
              active={index === selectedIndex}
              enabled={Math.abs(index - selectedIndex) <= 1}
              zoom={index === selectedIndex ? zoom : MIN_ZOOM}
              pan={index === selectedIndex ? pan : IDENTITY_PAN}
              onZoom={handleZoom}
              onPan={handlePan}
              onOriginalLoaded={handleOriginalLoaded}
            />
          ))}
        </div>
      </div>

      <div className="msg-lightbox-hint">
        {isImage ? "Колесо — масштаб · двойной клик — зум · Esc — закрыть" : "Свайп — переключение · Esc — закрыть"}
      </div>
    </div>,
    document.body,
  );
}
