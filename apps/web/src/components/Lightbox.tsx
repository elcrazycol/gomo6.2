import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useEmblaCarousel from "embla-carousel-react";
import { X, Download, ZoomOut, ChevronLeft, ChevronRight, Scissors, Square } from "lucide-react";
import { storageUrl } from "@/utils/storage";
import { parseImageMeta, useAuthenticatedAttachmentUrl } from "@/components/messenger/attachmentMedia";
import type { Attachment } from "@/components/messenger/types";
import { cn } from "@/lib/utils";

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
  /** When provided, the lightbox gains the crop/epstein image editor. */
  onEditImage?: (index: number, dataUrl: string) => void;
  /** Open straight into the editor instead of the viewer (used from draft
      attachment thumbnails, where editing is the primary action). */
  startInEditMode?: boolean;
  /** "uploads" resolves through the authenticated messenger endpoint; any
      other bucket (default "content") resolves via plain storageUrl. */
  bucket?: string;
};

type Tool = "crop" | "epstein";
type Box = { x: number; y: number; w: number; h: number };
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

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

// ─── Editor (crop / epstein redact) — from the legacy ImageGallery ──────────

function EditorCanvas({
  src,
  onApply,
  onCancel,
}: {
  src: string;
  onApply: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const [tool, setTool] = useState<Tool>("crop");
  const [redacts, setRedacts] = useState<Box[]>([]);
  const [cropBox, setCropBox] = useState<Box>({ x: 0, y: 0, w: 1, h: 1 });
  const [draftRedact, setDraftRedact] = useState<Box | null>(null);
  const [renderRect, setRenderRect] = useState<Box | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeHandleRef = useRef<Handle | null>(null);
  const cropStartRef = useRef<{ x: number; y: number; box: Box } | null>(null);
  const redactStartRef = useRef<{ x: number; y: number } | null>(null);
  const isTouch = useMemo(
    () => typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0),
    []
  );

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  const computeRenderRect = useCallback(() => {
    if (!containerRef.current || !imgRef.current) return null;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const iw = imgRef.current.naturalWidth;
    const ih = imgRef.current.naturalHeight;
    if (!iw || !ih) return null;
    const scale = Math.min(cw / iw, ch / ih);
    const w = iw * scale;
    const h = ih * scale;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
  }, []);

  const refreshRenderRect = useCallback(() => {
    const rect = computeRenderRect();
    if (rect) setRenderRect(rect);
  }, [computeRenderRect]);

  useEffect(() => {
    refreshRenderRect();
    const handleResize = () => refreshRenderRect();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [refreshRenderRect]);

  const getHandlePositions = (box: Box, width: number, height: number) => {
    const left = box.x * width;
    const top = box.y * height;
    const right = left + box.w * width;
    const bottom = top + box.h * height;
    const midX = (left + right) / 2;
    const midY = (top + bottom) / 2;
    return [
      { id: "nw" as Handle, x: left, y: top },
      { id: "n" as Handle, x: midX, y: top },
      { id: "ne" as Handle, x: right, y: top },
      { id: "e" as Handle, x: right, y: midY },
      { id: "se" as Handle, x: right, y: bottom },
      { id: "s" as Handle, x: midX, y: bottom },
      { id: "sw" as Handle, x: left, y: bottom },
      { id: "w" as Handle, x: left, y: midY },
    ];
  };

  const hitTestHandle = (x: number, y: number, width: number, height: number, box: Box, radius: number) => {
    const handles = getHandlePositions(box, width, height);
    const radiusSq = radius * radius;
    for (const handle of handles) {
      const dx = x - handle.x;
      const dy = y - handle.y;
      if (dx * dx + dy * dy <= radiusSq) return handle.id;
    }
    return null;
  };

  const drawEditor = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !renderRect) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = Math.max(1, Math.round(renderRect.w));
    const height = Math.max(1, Math.round(renderRect.h));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    if (tool === "crop") {
      const cx = cropBox.x * width;
      const cy = cropBox.y * height;
      const cw = cropBox.w * width;
      const ch = cropBox.h * height;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, width, height);
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx, cy, cw, ch);
      ctx.clip();
      ctx.drawImage(img, 0, 0, width, height);
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 2;
      ctx.strokeRect(cx, cy, cw, ch);
      const handleRadius = isTouch ? 12 : 8;
      const handles = getHandlePositions(cropBox, width, height);
      ctx.fillStyle = "rgba(0,0,0,0.85)";
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      handles.forEach((handle) => {
        ctx.beginPath();
        ctx.arc(handle.x, handle.y, handleRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    } else {
      ctx.fillStyle = "#000";
      redacts.forEach((r) => {
        ctx.fillRect(r.x * width, r.y * height, r.w * width, r.h * height);
      });
      if (draftRedact) {
        ctx.fillRect(draftRedact.x * width, draftRedact.y * height, draftRedact.w * width, draftRedact.h * height);
      }
    }
  }, [cropBox, draftRedact, isTouch, redacts, renderRect, tool]);

  useEffect(() => {
    drawEditor();
  }, [drawEditor]);

  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left, 0, rect.width);
    const y = clamp(e.clientY - rect.top, 0, rect.height);
    return { x, y, width: rect.width, height: rect.height };
  };

  const handleEditorPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!renderRect) return;
    const info = getCanvasPoint(e);
    if (!info) return;
    const { x, y, width, height } = info;
    const nx = x / width;
    const ny = y / height;
    const target = e.currentTarget;
    const handleRadius = isTouch ? 18 : 12;

    if (tool === "crop") {
      const handle = hitTestHandle(x, y, width, height, cropBox, handleRadius);
      if (!handle) return;
      activeHandleRef.current = handle;
      cropStartRef.current = { x: nx, y: ny, box: cropBox };
    } else {
      redactStartRef.current = { x: nx, y: ny };
      setDraftRedact({ x: nx, y: ny, w: 0, h: 0 });
    }

    e.preventDefault();
    target.setPointerCapture(e.pointerId);
  };

  const handleEditorPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const info = getCanvasPoint(e);
    if (!info) return;
    const { x, y, width, height } = info;
    const nx = x / width;
    const ny = y / height;

    if (tool === "crop") {
      const handle = activeHandleRef.current;
      const start = cropStartRef.current;
      if (!handle || !start) return;
      const dx = nx - start.x;
      const dy = ny - start.y;
      const minW = (isTouch ? 44 : 24) / width;
      const minH = (isTouch ? 44 : 24) / height;
      const startLeft = start.box.x;
      const startRight = start.box.x + start.box.w;
      const startTop = start.box.y;
      const startBottom = start.box.y + start.box.h;
      let left = startLeft;
      let right = startRight;
      let top = startTop;
      let bottom = startBottom;

      if (handle.includes("w")) left = startLeft + dx;
      if (handle.includes("e")) right = startRight + dx;
      if (handle.includes("n")) top = startTop + dy;
      if (handle.includes("s")) bottom = startBottom + dy;

      left = clamp(left, 0, right - minW);
      right = clamp(right, left + minW, 1);
      top = clamp(top, 0, bottom - minH);
      bottom = clamp(bottom, top + minH, 1);

      setCropBox({ x: left, y: top, w: right - left, h: bottom - top });
    } else {
      const start = redactStartRef.current;
      if (!start) return;
      const x1 = Math.min(start.x, nx);
      const y1 = Math.min(start.y, ny);
      const w = Math.abs(nx - start.x);
      const h = Math.abs(ny - start.y);
      setDraftRedact({ x: x1, y: y1, w, h });
    }

    e.preventDefault();
  };

  const handleEditorPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const info = getCanvasPoint(e);
    const width = info?.width ?? 1;
    const height = info?.height ?? 1;

    if (tool === "crop") {
      activeHandleRef.current = null;
      cropStartRef.current = null;
    } else {
      const start = redactStartRef.current;
      if (start && info) {
        const nx = info.x / width;
        const ny = info.y / height;
        const x1 = Math.min(start.x, nx);
        const y1 = Math.min(start.y, ny);
        const w = Math.abs(nx - start.x);
        const h = Math.abs(ny - start.y);
        const wPx = w * width;
        const hPx = h * height;
        if (wPx >= 4 && hPx >= 4) {
          setRedacts((prev) => [...prev, { x: x1, y: y1, w, h }]);
        }
      }
      setDraftRedact(null);
      redactStartRef.current = null;
    }

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    e.preventDefault();
  };

  const handleEditorPointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    activeHandleRef.current = null;
    cropStartRef.current = null;
    redactStartRef.current = null;
    setDraftRedact(null);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    e.preventDefault();
  };

  const applyEdit = async () => {
    try {
      const img = imgRef.current;
      if (!img || !img.complete) return;
      const canvas = document.createElement("canvas");
      const { naturalWidth, naturalHeight } = img;

      if (tool === "crop") {
        const nx = clamp(cropBox.x, 0, 1);
        const ny = clamp(cropBox.y, 0, 1);
        const nw = clamp(cropBox.w, 0.01, 1 - nx);
        const nh = clamp(cropBox.h, 0.01, 1 - ny);
        const x1 = Math.round(nx * naturalWidth);
        const y1 = Math.round(ny * naturalHeight);
        const w = Math.max(1, Math.round(nw * naturalWidth));
        const h = Math.max(1, Math.round(nh * naturalHeight));
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.src = src;
        await image.decode();
        ctx.drawImage(image, x1, y1, w, h, 0, 0, w, h);
      } else {
        canvas.width = naturalWidth;
        canvas.height = naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.src = src;
        await image.decode();
        ctx.drawImage(image, 0, 0, naturalWidth, naturalHeight);
        const allRedacts = draftRedact ? [...redacts, draftRedact] : redacts;
        allRedacts.forEach((r) => {
          ctx.fillStyle = "rgba(0,0,0,1)";
          ctx.fillRect(r.x * naturalWidth, r.y * naturalHeight, r.w * naturalWidth, r.h * naturalHeight);
        });
      }

      onApply(canvas.toDataURL("image/png"));
    } catch (e) {
      console.error("Edit failed", e);
    }
  };

  const switchTool = (next: Tool) => {
    setTool(next);
    setRedacts([]);
    setDraftRedact(null);
    setCropBox({ x: 0, y: 0, w: 1, h: 1 });
    activeHandleRef.current = null;
    cropStartRef.current = null;
    redactStartRef.current = null;
  };

  return (
    <>
      <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 bg-black/40 backdrop-blur px-3 py-2 rounded-2xl">
        <button
          type="button"
          className={cn("h-8 px-3 text-white text-xs rounded-md transition-colors", tool === "crop" ? "bg-white/25" : "hover:bg-white/10")}
          onClick={() => switchTool("crop")}
        >
          <Scissors className="w-4 h-4 inline mr-1" /> Кадрировать
        </button>
        <button
          type="button"
          className={cn("h-8 px-3 text-white text-xs rounded-md transition-colors", tool === "epstein" ? "bg-white/25" : "hover:bg-white/10")}
          onClick={() => switchTool("epstein")}
        >
          <Square className="w-4 h-4 inline mr-1" /> Epstein
        </button>
        <button
          type="button"
          className="h-8 px-3 bg-white text-black text-xs font-semibold rounded-md hover:bg-white/90"
          onClick={() => void applyEdit()}
        >
          Применить
        </button>
        <button
          type="button"
          className="h-8 px-3 text-white text-xs rounded-md hover:bg-white/10"
          onClick={onCancel}
        >
          Отмена
        </button>
      </div>
      <div ref={containerRef} className="relative flex items-center justify-center w-full h-full">
        <img
          ref={imgRef}
          src={src}
          alt="Редактирование"
          className="opacity-0 pointer-events-none max-w-full max-h-full"
          draggable={false}
          onLoad={refreshRenderRect}
        />
        {renderRect && (
          <canvas
            ref={canvasRef}
            className="absolute z-10 select-none touch-none cursor-crosshair"
            style={{
              left: `${renderRect.x}px`,
              top: `${renderRect.y}px`,
              width: `${renderRect.w}px`,
              height: `${renderRect.h}px`,
            }}
            onPointerDown={handleEditorPointerDown}
            onPointerMove={handleEditorPointerMove}
            onPointerUp={handleEditorPointerUp}
            onPointerCancel={handleEditorPointerCancel}
          />
        )}
      </div>
    </>
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

  const canEdit = !!onEditImage && bucket !== "uploads";
  const current = localItems[selectedIndex];
  const isImage = current?.type === "image";

  useEffect(() => {
    setLocalItems(items);
    setSelectedIndex(initialIndex);
    // Keep the original-URL slots in sync when the item list is swapped.
    setOriginalUrls(items.map(() => null));
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
            <button type="button" className="msg-lightbox-action" onClick={() => setIsEditing(true)} aria-label="Редактировать" title="Редактировать (обрезка / затемнение)">
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
            <EditorCanvas src={currentEditSrc} onApply={handleApplyEdit} onCancel={() => setIsEditing(false)} />
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
      <div className="msg-lightbox-hint">{isEditing ? "Обрезка · затемнение · Esc — закрыть" : (isImage ? "Колесо — масштаб · двойной клик — зум · Esc — закрыть" : "Свайп — переключение · Esc — закрыть")}</div>
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
