import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useEmblaCarousel from "embla-carousel-react";
import { X, Download, ZoomOut, ChevronLeft, ChevronRight } from "lucide-react";
import type { Attachment } from "./types";
import { parseImageMeta, useAuthenticatedAttachmentUrl } from "./attachmentMedia";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const WHEEL_ZOOM_STEP = 1.25;
const BUTTON_ZOOM_STEP = 1.4;
const DOUBLE_CLICK_ZOOM = 2.5;

type Pan = { x: number; y: number };
const IDENTITY_PAN: Pan = { x: 0, y: 0 };

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
  const mediaRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);
  const dragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  const panRef = useRef(pan);
  const [isAnimating, setIsAnimating] = useState(false);
  panRef.current = pan;

  const isImage = attachment.type === "image";
  const isZoomed = zoom > MIN_ZOOM;

  useEffect(() => {
    if (url) onOriginalLoaded(index, url);
  }, [index, url, onOriginalLoaded]);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el || !active || !isImage) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const anchorX = event.clientX - rect.left - rect.width / 2;
      const anchorY = event.clientY - rect.top - rect.height / 2;
      const factor = event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
      const next = zoomAround(zoom, pan, zoom * factor, anchorX, anchorY);
      setIsAnimating(true);
      onZoom(next.zoom, next.pan);
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [active, isImage, zoom, pan, onZoom]);

  useEffect(() => {
    const el = mediaRef.current as HTMLImageElement | null;
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
      try { el.releasePointerCapture(event.pointerId); } catch { /* already released */ }
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

  useEffect(() => {
    if (!isAnimating) return;
    const timer = window.setTimeout(() => setIsAnimating(false), 200);
    return () => window.clearTimeout(timer);
  }, [isAnimating]);

  const handleDoubleClick = (event: React.MouseEvent<HTMLImageElement>) => {
    if (!isImage) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const anchorX = event.clientX - rect.left - rect.width / 2;
    const anchorY = event.clientY - rect.top - rect.height / 2;
    setIsAnimating(true);
    if (isZoomed) onZoom(MIN_ZOOM, IDENTITY_PAN);
    else onZoom(DOUBLE_CLICK_ZOOM, { x: anchorX, y: anchorY });
  };

  return (
    <div className="msg-lightbox-slide" data-active={active || undefined}>
      {isImage ? (
        url ? (
          <img
            ref={mediaRef as React.RefObject<HTMLImageElement>}
            src={url}
            alt={attachment.name}
            decoding="async"
            draggable={false}
            className={`msg-lightbox-media${isAnimating ? " is-zooming" : ""}${isZoomed ? " is-pannable" : ""}`}
            style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }}
            onDoubleClick={handleDoubleClick}
          />
        ) : <span className="msg-attachment-loading-shimmer" aria-label="Загрузка оригинала" />
      ) : (
        url ? (
          <video ref={mediaRef as React.RefObject<HTMLVideoElement>} src={url} controls autoPlay playsInline className="msg-lightbox-media" />
        ) : <span className="msg-attachment-loading-shimmer" aria-label="Загрузка видео" />
      )}
    </div>
  );
}

function LightboxThumbnail({ attachment, index, active, onSelect }: { attachment: Attachment; index: number; active: boolean; onSelect: (index: number) => void }) {
  const meta = parseImageMeta(attachment);
  const previewKey = meta.preview_key || attachment.url;
  const url = useAuthenticatedAttachmentUrl(attachment, previewKey, true);
  return (
    <button type="button" className={`msg-lightbox-thumbnail${active ? " is-active" : ""}`} onClick={() => onSelect(index)} aria-label={`Фото ${index + 1}`} aria-current={active ? "true" : undefined}>
      {url ? <img src={url} alt="" loading="lazy" /> : <span className="msg-lightbox-thumbnail-placeholder" />}
    </button>
  );
}

type MessengerLightboxProps = {
  attachments: Attachment[];
  initialIndex: number;
  onClose: () => void;
};

export function MessengerLightbox({ attachments, initialIndex, onClose }: MessengerLightboxProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ startIndex: initialIndex, containScroll: "trimSnaps", duration: 30 });
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState<Pan>(IDENTITY_PAN);
  const [originalUrls, setOriginalUrls] = useState<(string | null)[]>(() => attachments.map(() => null));
  const current = attachments[selectedIndex];
  const isImage = current?.type === "image";

  const handleSelect = useCallback(() => setSelectedIndex(emblaApi?.selectedScrollSnap() ?? 0), [emblaApi]);
  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on("select", handleSelect);
    return () => { emblaApi.off("select", handleSelect); };
  }, [emblaApi, handleSelect]);

  useEffect(() => {
    setZoom(MIN_ZOOM);
    setPan(IDENTITY_PAN);
  }, [selectedIndex]);

  const handleOriginalLoaded = useCallback((index: number, url: string) => {
    setOriginalUrls((prev) => prev.map((existing, i) => i === index ? url : existing));
  }, []);
  const handleZoom = useCallback((nextZoom: number, nextPan: Pan) => { setZoom(nextZoom); setPan(nextPan); }, []);
  const handlePan = useCallback((nextPan: Pan) => setPan(nextPan), []);
  const scrollTo = useCallback((index: number) => emblaApi?.scrollTo(index), [emblaApi]);
  const selectThumbnail = useCallback((index: number) => {
    setSelectedIndex(index);
    scrollTo(index);
  }, [scrollTo]);
  const resetZoom = useCallback(() => { setZoom(MIN_ZOOM); setPan(IDENTITY_PAN); }, []);
  const zoomAroundCenter = useCallback((factor: number) => {
    const next = zoomAround(zoom, pan, zoom * factor, 0, 0);
    setZoom(next.zoom);
    setPan(next.pan);
  }, [zoom, pan]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") return onClose();
      if (zoom === MIN_ZOOM && event.key === "ArrowLeft") scrollTo(Math.max(0, selectedIndex - 1));
      else if (zoom === MIN_ZOOM && event.key === "ArrowRight") scrollTo(Math.min(attachments.length - 1, selectedIndex + 1));
      else if (isImage && (event.key === "+" || event.key === "=")) { event.preventDefault(); zoomAroundCenter(BUTTON_ZOOM_STEP); }
      else if (isImage && event.key === "-") { event.preventDefault(); zoomAroundCenter(1 / BUTTON_ZOOM_STEP); }
      else if (isImage && event.key === "0") resetZoom();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, zoom, isImage, scrollTo, selectedIndex, attachments.length, zoomAroundCenter, resetZoom]);

  const handleRootMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target || target.closest(".msg-lightbox-slide,.msg-lightbox-topbar,.msg-lightbox-arrow,.msg-lightbox-thumbnails")) return;
    onClose();
  };
  const currentOriginal = originalUrls[selectedIndex];
  const showArrows = attachments.length > 1;

  return createPortal(
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div className="msg-lightbox" role="dialog" aria-modal="true" aria-label="Просмотр медиа" onMouseDown={handleRootMouseDown}>
      <div className="msg-lightbox-topbar">
        <span className="msg-lightbox-counter">{selectedIndex + 1} / {attachments.length}</span>
        <div className="msg-lightbox-actions">
          <a className={`msg-lightbox-action${currentOriginal ? "" : " is-disabled"}`} href={currentOriginal ?? undefined} download={current?.name} aria-label="Скачать" onClick={(event) => { if (!currentOriginal) event.preventDefault(); }}><Download size={18} /></a>
          <button type="button" className="msg-lightbox-action" onClick={resetZoom} disabled={zoom === MIN_ZOOM} aria-label="Сбросить масштаб" title="Сбросить масштаб (0)"><ZoomOut size={18} /></button>
          <button type="button" className="msg-lightbox-action" onClick={onClose} aria-label="Закрыть" title="Закрыть (Esc)"><X size={18} /></button>
        </div>
      </div>
      {showArrows && <>
        <button type="button" className="msg-lightbox-arrow prev" onClick={() => scrollTo(Math.max(0, selectedIndex - 1))} aria-label="Предыдущее фото" disabled={zoom > MIN_ZOOM}><ChevronLeft size={26} /></button>
        <button type="button" className="msg-lightbox-arrow next" onClick={() => scrollTo(Math.min(attachments.length - 1, selectedIndex + 1))} aria-label="Следующее фото" disabled={zoom > MIN_ZOOM}><ChevronRight size={26} /></button>
      </>}
      <div className="msg-lightbox-viewport" ref={emblaRef}>
        <div className="msg-lightbox-track">
          {attachments.map((attachment, index) => <LightboxSlide key={attachment.id || attachment.url + index} attachment={attachment} index={index} active={index === selectedIndex} enabled={Math.abs(index - selectedIndex) <= 1} zoom={index === selectedIndex ? zoom : MIN_ZOOM} pan={index === selectedIndex ? pan : IDENTITY_PAN} onZoom={handleZoom} onPan={handlePan} onOriginalLoaded={handleOriginalLoaded} />)}
        </div>
      </div>
      <div className="msg-lightbox-thumbnails" role="tablist" aria-label="Миниатюры фотографий">
        {attachments.map((attachment, index) => <LightboxThumbnail key={attachment.id || attachment.url + index} attachment={attachment} index={index} active={index === selectedIndex} onSelect={selectThumbnail} />)}
      </div>
      <div className="msg-lightbox-hint">{isImage ? "Колесо — масштаб · двойной клик — зум · Esc — закрыть" : "Свайп — переключение · Esc — закрыть"}</div>
    </div>,
    document.body,
  );
}
