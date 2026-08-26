import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useEmblaCarousel from "embla-carousel-react";
import { X, Download, ZoomOut, ChevronLeft, ChevronRight, Scissors } from "lucide-react";
import { storageUrl } from "@/utils/storage";
import { parseImageMeta, useAuthenticatedAttachmentUrl } from "@/components/messenger/attachmentMedia";
import type { Attachment } from "@/components/messenger/types";
import { PhotoEditor } from "@/components/PhotoEditor";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const WHEEL_ZOOM_STEP = 1.25;
const BUTTON_ZOOM_STEP = 1.4;
const DOUBLE_CLICK_ZOOM = 2.5;

const EMPTY_ITEM: LightboxItem = { url: "", type: "image", name: "" };

type Pan = { x: number; y: number };
const IDENTITY_PAN: Pan = { x: 0, y: 0 };

export type LightboxItem = {
  id?: string;
  url: string;
  type: "image" | "video" | "audio" | "file";
  name: string;
  size?: number;
  mime?: string;
  /** JSON metadata: width/height/preview_key/lqip for images. */
  meta?: string | null;
  poster?: string;
};

export type LightboxProps = {
  items: LightboxItem[];
  initialIndex?: number;
  onClose: () => void;
  /** When provided, the lightbox gains the Telegram-style photo editor
      (crop with aspect presets, brush with colour/size, blur brush, undo/redo). */
  onEditImage?: (index: number, dataUrl: string) => void;
  /** Open straight into the editor instead of the viewer (used from draft
      attachment thumbnails, where editing is the primary action). */
  startInEditMode?: boolean;
  /** "uploads" resolves through the authenticated messenger endpoint; any
      other bucket (default "content") resolves via plain storageUrl. */
  bucket?: string;
};

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

function toAttachment(item: LightboxItem): Attachment {
  return {
    id: item.id,
    url: item.url,
    type: item.type,
    name: item.name,
    size: item.size ?? 0,
    mime: item.mime ?? "application/octet-stream",
    meta: item.meta ?? null,
  };
}

/** Resolve a display URL for an item inside the given bucket. Auth bucket
    ("uploads") goes through the authenticated messenger fetch; everything else
    uses the plain storage endpoint (absolute URLs pass through unchanged). */
function useLightboxItemUrl(item: LightboxItem, bucket: string, requestedKey = item.url, enabled = true): string | null {
  const isAuth = bucket === "uploads";
  const authUrl = useAuthenticatedAttachmentUrl(toAttachment(item), requestedKey, enabled && isAuth);
  if (isAuth) return authUrl;
  return storageUrl(bucket || "content", requestedKey) || requestedKey;
}

// ─── Carousel slide (messenger-style: zoom + pan + wheel + double-click) ────

type LightboxSlideProps = {
  item: LightboxItem;
  bucket: string;
  index: number;
  active: boolean;
  enabled: boolean;
  zoom: number;
  pan: Pan;
  onZoom: (zoom: number, pan: Pan) => void;
  onPan: (pan: Pan) => void;
  onOriginalLoaded: (index: number, url: string) => void;
};

function LightboxSlide({ item, bucket, index, active, enabled, zoom, pan, onZoom, onPan, onOriginalLoaded }: LightboxSlideProps) {
  const url = useLightboxItemUrl(item, bucket, item.url, enabled);
  const mediaRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);
  const dragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  const panRef = useRef(pan);
  const [isAnimating, setIsAnimating] = useState(false);
  panRef.current = pan;

  const isImage = item.type === "image";
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
            alt={item.name}
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

function LightboxThumbnail({ item, bucket, index, active, onSelect }: { item: LightboxItem; bucket: string; index: number; active: boolean; onSelect: (index: number) => void }) {
  const meta = parseImageMeta(toAttachment(item));
  const previewKey = meta.preview_key || item.url;
  const url = useLightboxItemUrl(item, bucket, previewKey, true);
  return (
    <button type="button" className={`msg-lightbox-thumbnail${active ? " is-active" : ""}`} onClick={() => onSelect(index)} aria-label={`Фото ${index + 1}`} aria-current={active ? "true" : undefined}>
      {url ? <img src={url} alt="" loading="lazy" /> : <span className="msg-lightbox-thumbnail-placeholder" />}
    </button>
  );
}

// ─── Unified Lightbox ────────────────────────────────────────────────────────

export function Lightbox({ items, initialIndex = 0, onClose, onEditImage, startInEditMode = false, bucket = "content" }: LightboxProps) {
  const [localItems, setLocalItems] = useState<LightboxItem[]>(items);
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [isEditing, setIsEditing] = useState(false);
  const [emblaRef, emblaApi] = useEmblaCarousel({ startIndex: initialIndex, containScroll: "trimSnaps", duration: 30 });
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState<Pan>(IDENTITY_PAN);
  const [originalUrls, setOriginalUrls] = useState<(string | null)[]>(() => items.map(() => null));
  // Track the item list each slot was resolved for, so the sync effect below
  // only clears original URLs whose item actually changed. Clears on mount would
  // race with the slides' onOriginalLoaded effect (children run first) and wipe
  // the just-resolved synchronous URLs, breaking the download link.
  const prevItemsRef = useRef(items);

  const canEdit = !!onEditImage && bucket !== "uploads";
  const current = localItems[selectedIndex];
  const isImage = current?.type === "image";

  useEffect(() => {
    setLocalItems(items);
    setSelectedIndex(initialIndex);
    // Keep the original-URL slots in sync when the item list is swapped: clear
    // only slots whose item changed (children re-fire onOriginalLoaded for new
    // urls); leave slots for unchanged items, including the initial mount.
    setOriginalUrls((prev) =>
      prev.map((existing, i) => {
        const was = prevItemsRef.current[i];
        const now = items[i];
        const unchanged = was && now && was.url === now.url && was.id === now.id;
        // Also keep a slot whose resolved URL already matches the item (e.g.
        // after an edit applied locally, the slide re-fired onOriginalLoaded
        // with the new dataUrl before this effect ran).
        const alreadyResolved = existing === now?.url;
        return unchanged || alreadyResolved ? existing : null;
      }),
    );
    prevItemsRef.current = items;
  }, [items, initialIndex]);

  // Lock body scroll while open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const handleSelect = useCallback(() => setSelectedIndex(emblaApi?.selectedScrollSnap() ?? 0), [emblaApi]);
  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on("select", handleSelect);
    return () => { emblaApi.off("select", handleSelect); };
  }, [emblaApi, handleSelect]);

  useEffect(() => {
    if (startInEditMode && canEdit) setIsEditing(true);
  }, [startInEditMode, canEdit]);

  useEffect(() => {
    setZoom(MIN_ZOOM);
    setPan(IDENTITY_PAN);
  }, [selectedIndex]);

  const handleOriginalLoaded = useCallback((index: number, url: string) => {
    setOriginalUrls((prev) => prev.map((existing, i) => (i === index ? url : existing)));
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

  const handleApplyEdit = useCallback((dataUrl: string) => {
    setLocalItems((prev) => prev.map((item, i) => (i === selectedIndex ? { ...item, url: dataUrl, meta: null } : item)));
    onEditImage?.(selectedIndex, dataUrl);
    setIsEditing(false);
  }, [onEditImage, selectedIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") return onClose();
      if (isEditing) return;
      if (zoom === MIN_ZOOM && event.key === "ArrowLeft") scrollTo(Math.max(0, selectedIndex - 1));
      else if (zoom === MIN_ZOOM && event.key === "ArrowRight") scrollTo(Math.min(localItems.length - 1, selectedIndex + 1));
      else if (isImage && (event.key === "+" || event.key === "=")) { event.preventDefault(); zoomAroundCenter(BUTTON_ZOOM_STEP); }
      else if (isImage && event.key === "-") { event.preventDefault(); zoomAroundCenter(1 / BUTTON_ZOOM_STEP); }
      else if (isImage && event.key === "0") resetZoom();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, zoom, isImage, scrollTo, selectedIndex, localItems.length, zoomAroundCenter, resetZoom, isEditing]);

  const handleRootMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target || target.closest(".msg-lightbox-slide,.msg-lightbox-topbar,.msg-lightbox-arrow,.msg-lightbox-thumbnails")) return;
    if (isEditing) return;
    onClose();
  };
  const currentOriginal = originalUrls[selectedIndex];
  const showArrows = localItems.length > 1;
  // Hook is called unconditionally (rules of hooks); only resolved while editing.
  // The editor is gated off the messenger auth bucket, so skipping the fetch
  // there avoids a duplicate authenticated original-blob request.
  const currentEditSrc = useLightboxItemUrlSafe(current, bucket, canEdit);

  return createPortal(
    <div className="msg-lightbox" role="dialog" aria-modal="true" aria-label="Просмотр медиа" onMouseDown={handleRootMouseDown}>
      <div className="msg-lightbox-topbar">
        <span className="msg-lightbox-counter">{selectedIndex + 1} / {localItems.length}</span>
        <div className="msg-lightbox-actions">
          {canEdit && !isEditing && (
            <button type="button" className="msg-lightbox-action" onClick={() => setIsEditing(true)} aria-label="Редактировать" title="Редактировать (кисть · размытие · кадрирование)">
              <Scissors size={18} />
            </button>
          )}
          <a className={`msg-lightbox-action${currentOriginal ? "" : " is-disabled"}`} href={currentOriginal ?? undefined} download={current?.name} aria-label="Скачать" onClick={(event) => { if (!currentOriginal) event.preventDefault(); }}><Download size={18} /></a>
          <button type="button" className="msg-lightbox-action" onClick={resetZoom} disabled={zoom === MIN_ZOOM} aria-label="Сбросить масштаб" title="Сбросить масштаб (0)"><ZoomOut size={18} /></button>
          <button type="button" className="msg-lightbox-action" onClick={onClose} aria-label="Закрыть" title="Закрыть (Esc)"><X size={18} /></button>
        </div>
      </div>
      {showArrows && !isEditing && <>
        <button type="button" className="msg-lightbox-arrow prev" onClick={() => scrollTo(Math.max(0, selectedIndex - 1))} aria-label="Предыдущее фото" disabled={zoom > MIN_ZOOM}><ChevronLeft size={26} /></button>
        <button type="button" className="msg-lightbox-arrow next" onClick={() => scrollTo(Math.min(localItems.length - 1, selectedIndex + 1))} aria-label="Следующее фото" disabled={zoom > MIN_ZOOM}><ChevronRight size={26} /></button>
      </>}
      <div className="msg-lightbox-viewport" ref={emblaRef} style={isEditing ? { display: "none" } : undefined}>
        <div className="msg-lightbox-track">
          {localItems.map((item, index) => <LightboxSlide key={item.id || item.url + index} item={item} bucket={bucket} index={index} active={index === selectedIndex} enabled={Math.abs(index - selectedIndex) <= 1} zoom={index === selectedIndex ? zoom : MIN_ZOOM} pan={index === selectedIndex ? pan : IDENTITY_PAN} onZoom={handleZoom} onPan={handlePan} onOriginalLoaded={handleOriginalLoaded} />)}
        </div>
      </div>
      {isEditing && current && (
        <div className="absolute inset-0 z-2">
          {currentEditSrc ? (
            <PhotoEditor src={currentEditSrc} onApply={handleApplyEdit} onCancel={() => setIsEditing(false)} />
          ) : (
            <span className="msg-attachment-loading-shimmer" aria-label="Загрузка оригинала" />
          )}
        </div>
      )}
      {!isEditing && (
        <div className="msg-lightbox-thumbnails" role="tablist" aria-label="Миниатюры фотографий">
          {localItems.map((item, index) => <LightboxThumbnail key={item.id || item.url + index} item={item} bucket={bucket} index={index} active={index === selectedIndex} onSelect={selectThumbnail} />)}
        </div>
      )}
      <div className="msg-lightbox-hint">{isEditing ? "Кадрировать · Кисть · Размытие · Отменить (по шагу) · Esc — закрыть" : (isImage ? "Колесо — масштаб · двойной клик — зум · Esc — закрыть" : "Свайп — переключение · Esc — закрыть")}</div>
    </div>,
    document.body,
  );
}

// ─── Helper: non-hook URL resolve for the editor (always enabled) ──────────
function useLightboxItemUrlSafe(item: LightboxItem | undefined, bucket: string, enabled: boolean): string | null {
  // Rules of hooks: this hook must run unconditionally; guard the fetch inside.
  const url = useLightboxItemUrl(item ?? EMPTY_ITEM, bucket, item?.url ?? "", enabled && !!item);
  return item ? url : null;
}
