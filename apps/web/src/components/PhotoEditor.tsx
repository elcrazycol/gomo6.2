import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Crop, Droplets, Paintbrush, Ratio, Redo2, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import "./PhotoEditor.css";

const MAX_IMAGE_DIMENSION = 2560;

const MIN_VIEW_ZOOM = 1;
const MAX_VIEW_ZOOM = 8;
const WHEEL_ZOOM_STEP = 1.15;

type View = { zoom: number; x: number; y: number };
const IDENTITY_VIEW: View = { zoom: 1, x: 0, y: 0 };
type Point = { x: number; y: number };

const BRUSH_COLORS = [
  "#ffffff",
  "#000000",
  "#e53935",
  "#f4511e",
  "#fdd835",
  "#43a047",
  "#00acc1",
  "#1e88e5",
  "#5e35b1",
  "#d81b60",
];

const ASPECTS: { id: string; label: string; ratio: number | null }[] = [
  { id: "free", label: "Свободно", ratio: null },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "3:4", label: "3:4", ratio: 3 / 4 },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
];

type Tool = "crop" | "brush" | "blur";
type Box = { x: number; y: number; w: number; h: number };
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type Snapshot = { width: number; height: number; ready: Promise<string> };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve(img);
      }
    };
    img.onload = done;
    img.onerror = () => {
      if (!settled) {
        settled = true;
        reject(new Error("Не удалось загрузить изображение"));
      }
    };
    img.src = src;
    // decode() resolves once the image is fully decoded (and works in jsdom
    // tests where onload never fires); onload remains as the browser fallback.
    // A decode rejection while onload has not fired means the image genuinely
    // cannot be drawn — fail fast instead of hanging forever.
    if (typeof img.decode === "function") {
      img.decode().then(done).catch(() => {
        if (!settled) {
          settled = true;
          reject(new Error("Не удалось загрузить изображение"));
        }
      });
    }
  });
}

/** Read a Blob back into a data URL (asynchronously). */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("readAsDataURL failed"));
    reader.readAsDataURL(blob);
  });
}

/** Encode a canvas to a PNG data URL without blocking the calling task:
    OffscreenCanvas.convertToBlob where available, canvas.toBlob otherwise,
    and a synchronous toDataURL only as a last resort (older browsers, and
    test environments that only mock toDataURL). */
function encodeSnapshotAsync(canvas: HTMLCanvasElement): Promise<string> {
  const fallback = () => Promise.resolve(canvas.toDataURL("image/png"));
  if (typeof OffscreenCanvas !== "undefined") {
    try {
      const off = new OffscreenCanvas(canvas.width, canvas.height);
      const octx = off.getContext("2d");
      if (octx) {
        octx.drawImage(canvas, 0, 0);
        return off.convertToBlob({ type: "image/png" }).then(blobToDataUrl, fallback);
      }
    } catch {
      // fall through to the toBlob path
    }
  }
  if (typeof canvas.toBlob === "function") {
    try {
      return new Promise<string>((resolve) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blobToDataUrl(blob));
          else resolve(canvas.toDataURL("image/png"));
        }, "image/png");
      });
    } catch {
      // fall through to the synchronous fallback
    }
  }
  return fallback();
}

/** Render the region covered by a crop box into a new canvas at the box size.
    Shared by "Применить кадр" (which bakes the crop into the working canvas)
    and "Готово" (which exports the pending crop), so the two export paths can
    never drift apart. */
function cropCanvas(source: HTMLCanvasElement, box: Box): HTMLCanvasElement | null {
  const w = Math.max(1, Math.round(box.w));
  const h = Math.max(1, Math.round(box.h));
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const octx = out.getContext("2d");
  if (!octx) return null;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(source, box.x, box.y, w, h, 0, 0, w, h);
  return out;
}

interface PhotoEditorProps {
  src: string;
  onApply: (dataUrl: string) => void;
  onCancel: () => void;
}

/** Vertical brush-size slider: dragging up increases the size, down decreases
    it. The track widens towards the top and the thumb grows with the value, so
    bigger is visually "up". Bounded height keeps it neat on any screen.
    Pointer capture is taken on the element on pointer-down and move/up are
    tracked on window, so a fast drag that leaves the track still updates it. */
function VerticalBrushSize({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const updateRef = useRef<(clientY: number) => void>(() => {});
  const pct = clamp(((value - min) / (max - min)) * 100, 0, 100);
  const thumbSize = 12 + pct * 0.22;

  // Keep the value-mapping callback fresh without re-subscribing window
  // listeners on every render (they read it through the ref).
  updateRef.current = (clientY: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) return;
    const ratio = clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
    onChange(Math.round(min + ratio * (max - min)));
  };

  const handleWindowMove = useCallback((e: PointerEvent) => {
    if (draggingRef.current) updateRef.current(e.clientY);
  }, []);

  const stopDrag = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    window.removeEventListener("pointermove", handleWindowMove);
    window.removeEventListener("pointerup", stopDrag);
    window.removeEventListener("pointercancel", stopDrag);
  }, [handleWindowMove]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    updateRef.current(e.clientY);
    window.addEventListener("pointermove", handleWindowMove);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
  }, [handleWindowMove, stopDrag]);

  // Safety net: never leak window listeners if the component unmounts mid-drag.
  useEffect(() => stopDrag, [stopDrag]);

  return (
    <div className="pe-vsize">
      <div
        ref={trackRef}
        className="pe-vsize-track-wrap"
        onPointerDown={handlePointerDown}
      >
        <div className="pe-vsize-track">
          <div className="pe-vsize-fill" style={{ height: `${pct}%` }} />
        </div>
        <div
          className="pe-vsize-thumb"
          style={{
            width: thumbSize,
            height: thumbSize,
            bottom: `calc(${pct}% - ${thumbSize / 2}px)`,
          }}
        />
      </div>
      <span className="pe-vsize-value">{value}px</span>
    </div>
  );
}

// ─── Pinch / wheel zoom ─────────────────────────────────────────────────────
// Owns the view transform (zoom + pan). The photo zooms under a screen-fixed
// crop overlay, so zooming never moves the crop frame.

function usePinchZoom({
  overlayRef,
  fitRef,
}: {
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  fitRef: React.MutableRefObject<{ w: number; h: number }>;
}) {
  const [view, setView] = useState<View>(IDENTITY_VIEW);
  const viewRef = useRef<View>(IDENTITY_VIEW);
  viewRef.current = view;
  const pinchRef = useRef<{ dist: number; zoom: number; x: number; y: number; midX: number; midY: number } | null>(null);

  const clampView = useCallback((next: View): View => {
    const zoom = clamp(next.zoom, MIN_VIEW_ZOOM, MAX_VIEW_ZOOM);
    // Pan is applied as a plain screen-space translate on a wrapper, so the
    // visible displacement is exactly (x, y); bound it so the photo edge can
    // never cross the stage centre.
    const maxX = (fitRef.current.w * (zoom - 1)) / 2;
    const maxY = (fitRef.current.h * (zoom - 1)) / 2;
    return {
      zoom,
      x: zoom === MIN_VIEW_ZOOM ? 0 : clamp(next.x, -maxX, maxX),
      y: zoom === MIN_VIEW_ZOOM ? 0 : clamp(next.y, -maxY, maxY),
    };
  }, [fitRef]);

  const applyView = useCallback((next: View) => {
    setView(clampView(next));
  }, [clampView]);

  // Zoom around an on-screen point (cursor for wheel, finger midpoint for pinch).
  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const el = overlayRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const zoom = viewRef.current.zoom * factor;
    const x = clientX - rect.left - rect.width / 2 - ((clientX - rect.left - rect.width / 2 - viewRef.current.x) / viewRef.current.zoom) * zoom;
    const y = clientY - rect.top - rect.height / 2 - ((clientY - rect.top - rect.height / 2 - viewRef.current.y) / viewRef.current.zoom) * zoom;
    applyView({ zoom, x, y });
  }, [overlayRef, applyView]);

  // Mouse-wheel zoom on desktop: wheel up zooms in around the cursor.
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
      zoomAt(event.clientX, event.clientY, factor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [overlayRef, zoomAt]);

  const beginPinch = useCallback((p1: Point, p2: Point) => {
    pinchRef.current = {
      dist: Math.hypot(p2.x - p1.x, p2.y - p1.y),
      zoom: viewRef.current.zoom,
      x: viewRef.current.x,
      y: viewRef.current.y,
      midX: (p1.x + p2.x) / 2,
      midY: (p1.y + p2.y) / 2,
    };
  }, []);

  const updatePinch = useCallback((p1: Point, p2: Point) => {
    const base = pinchRef.current;
    if (!base || base.dist === 0) return;
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    applyView({
      zoom: base.zoom * (dist / base.dist),
      x: base.x + (midX - base.midX),
      y: base.y + (midY - base.midY),
    });
  }, [applyView]);

  const endPinch = useCallback(() => {
    pinchRef.current = null;
  }, []);

  const resetView = useCallback(() => {
    setView(IDENTITY_VIEW);
  }, []);

  /** Zoom by a fixed factor around the stage centre (keyboard +/-, mouse). */
  const zoomBy = useCallback((factor: number) => {
    const el = overlayRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }, [overlayRef, zoomAt]);

  return { view, viewRef, resetView, zoomBy, beginPinch, updatePinch, endPinch };
}

// ─── Crop window ────────────────────────────────────────────────────────────
// Owns the on-screen crop window (screen coordinates, never zoomed), the
// derived image-space crop box used for export, the aspect presets and the
// overlay drawing. The component decides when to draw; this hook knows how.

function useCropWindow({
  canvasRef,
  overlayRef,
  stageRef,
  viewRef,
  view,
  fitRef,
  fit,
  tool,
  ready,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  stageRef: React.RefObject<HTMLDivElement | null>;
  viewRef: React.MutableRefObject<View>;
  view: View;
  fitRef: React.MutableRefObject<{ w: number; h: number }>;
  fit: { w: number; h: number };
  tool: Tool;
  ready: boolean;
}) {
  // The crop window lives in SCREEN coordinates on a layer that never zooms:
  // pinch/wheel zoom the photo underneath while the frame stays put, exactly
  // like Telegram. The image-space crop box is derived from it for export.
  const [cropScreen, setCropScreen] = useState<Box>({ x: 0, y: 0, w: 1, h: 1 });
  const [aspect, setAspect] = useState<string | null>(null);
  const [aspectMenuOpen, setAspectMenuOpen] = useState(false);

  const cropScreenRef = useRef(cropScreen);
  cropScreenRef.current = cropScreen;
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const readyRef = useRef(ready);
  readyRef.current = ready;
  // Image-space crop box derived from the fixed on-screen window; this is what
  // gets exported when applying the crop / pressing "Готово".
  const cropBoxRef = useRef<Box>({ x: 0, y: 0, w: 1, h: 1 });
  const cropDragRef = useRef<{ handle: Handle | "move"; startX: number; startY: number; box: Box } | null>(null);

  const isTouch = useMemo(
    () => typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0),
    []
  );

  const getOverlayCtx = useCallback(() => overlayRef.current?.getContext("2d") ?? null, [overlayRef]);

  /** Screen rect of the visible (zoomed + panned) photo, in stage coordinates.
      Computed analytically so it works before the browser has laid the frame
      out (and in tests). Reads refs only, so it is stable. */
  const getImageScreenRect = useCallback((): Box => {
    const stage = stageRef.current;
    const f = fitRef.current;
    const v = viewRef.current;
    const cx = (stage?.clientWidth ?? 0) / 2 + v.x;
    const cy = (stage?.clientHeight ?? 0) / 2 + v.y;
    const w = f.w * v.zoom;
    const h = f.h * v.zoom;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }, [stageRef, fitRef, viewRef]);

  /** Redraw the crop overlay: darkening, grid, frame and grips — all in screen
      pixels at the FIXED on-screen window position, independent of the view
      transform (so the frame never moves when the photo zooms). */
  const redrawOverlay = useCallback(() => {
    const ctx = getOverlayCtx();
    const stage = stageRef.current;
    if (!ctx || !stage) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    ctx.clearRect(0, 0, W, H);
    if (!readyRef.current || toolRef.current !== "crop") return;

    const s = cropScreenRef.current;

    // Darken everything outside the crop frame.
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, W, s.y);
    ctx.fillRect(0, s.y + s.h, W, H - s.y - s.h);
    ctx.fillRect(0, s.y, s.x, s.h);
    ctx.fillRect(s.x + s.w, s.y, W - s.x - s.w, s.h);

    // Rule-of-thirds grid.
    if (s.w >= 60 && s.h >= 60) {
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1;
      for (let i = 1; i <= 2; i += 1) {
        const gx = s.x + (s.w * i) / 3;
        const gy = s.y + (s.h * i) / 3;
        ctx.beginPath();
        ctx.moveTo(gx, s.y);
        ctx.lineTo(gx, s.y + s.h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s.x, gy);
        ctx.lineTo(s.x + s.w, gy);
        ctx.stroke();
      }
    }

    // Thin frame.
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(s.x, s.y, s.w, s.h);

    // Telegram-style grips: thick short strips along the frame with constant
    // on-screen size (no canvas-scale factor — the overlay never zooms).
    const thickness = isTouch ? 5 : 4;
    const cornerLen = isTouch ? 26 : 22;
    const midLen = isTouch ? 18 : 14;
    ctx.fillStyle = "#ffffff";

    const corners: { x: number; y: number; hx: 1 | -1; hy: 1 | -1 }[] = [
      { x: s.x, y: s.y, hx: 1, hy: 1 },
      { x: s.x + s.w, y: s.y, hx: -1, hy: 1 },
      { x: s.x + s.w, y: s.y + s.h, hx: -1, hy: -1 },
      { x: s.x, y: s.y + s.h, hx: 1, hy: -1 },
    ];
    corners.forEach((c) => {
      // Horizontal strip along the top/bottom edge.
      ctx.fillRect(c.hx < 0 ? c.x - cornerLen : c.x, c.y - thickness / 2, cornerLen, thickness);
      // Vertical strip along the left/right edge.
      ctx.fillRect(c.x - thickness / 2, c.hy < 0 ? c.y - cornerLen : c.y, thickness, cornerLen);
    });

    const midX = s.x + s.w / 2;
    const midY = s.y + s.h / 2;
    ctx.fillRect(midX - midLen / 2, s.y - thickness / 2, midLen, thickness);
    ctx.fillRect(midX - midLen / 2, s.y + s.h - thickness / 2, midLen, thickness);
    ctx.fillRect(s.x - thickness / 2, midY - midLen / 2, thickness, midLen);
    ctx.fillRect(s.x + s.w - thickness / 2, midY - midLen / 2, thickness, midLen);
  }, [getOverlayCtx, stageRef, isTouch]);

  const clearOverlay = useCallback(() => {
    const ctx = getOverlayCtx();
    const stage = stageRef.current;
    if (!ctx || !stage) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, stage.clientWidth, stage.clientHeight);
  }, [getOverlayCtx, stageRef]);

  /** Reset the crop window to cover the whole photo (centred). Called by the
      component whenever the photo itself changed size. */
  const resetCropWindow = useCallback((w: number, h: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    setCropScreen({
      x: Math.max(0, (stage.clientWidth - w) / 2),
      y: Math.max(0, (stage.clientHeight - h) / 2),
      w,
      h,
    });
  }, [stageRef]);

  /** Keep the crop window inside the visible photo after a stage-only resize
      (e.g. rotating the phone), where the window is otherwise left untouched.
      The photo rect is passed in because it reflects the NEW fit size. */
  const clampCropWindow = useCallback((img: Box) => {
    const s = cropScreenRef.current;
    const x = clamp(s.x, img.x, img.x + Math.max(0, img.w - s.w));
    const y = clamp(s.y, img.y, img.y + Math.max(0, img.h - s.h));
    if (x !== s.x || y !== s.y) setCropScreen({ ...s, x, y });
  }, []);

  /** Move the crop window by whole pixels (keyboard nudging). */
  const nudgeCropWindow = useCallback((dx: number, dy: number) => {
    const s = cropScreenRef.current;
    const img = getImageScreenRect();
    setCropScreen({
      ...s,
      x: clamp(s.x + dx, img.x, img.x + Math.max(0, img.w - s.w)),
      y: clamp(s.y + dy, img.y, img.y + Math.max(0, img.h - s.h)),
    });
  }, [getImageScreenRect]);

  /** Derive the image-space crop box from the fixed on-screen window through
      the current view transform. */
  const syncCropBox = useCallback(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const v = viewRef.current;
    const f = fitRef.current;
    const cx = stage.clientWidth / 2 + v.x;
    const cy = stage.clientHeight / 2 + v.y;
    const fw = f.w * v.zoom || 1;
    const fh = f.h * v.zoom || 1;
    const left = cx - fw / 2;
    const top = cy - fh / 2;
    const s = cropScreenRef.current;
    const bx = clamp(((s.x - left) / fw) * canvas.width, 0, canvas.width);
    const by = clamp(((s.y - top) / fh) * canvas.height, 0, canvas.height);
    const bw = clamp((s.w / fw) * canvas.width, 0, canvas.width - bx);
    const bh = clamp((s.h / fh) * canvas.height, 0, canvas.height - by);
    cropBoxRef.current = { x: bx, y: by, w: bw, h: bh };
  }, [canvasRef, stageRef, viewRef, fitRef]);

  useEffect(() => {
    syncCropBox();
  }, [cropScreen, view, fit, syncCropBox]);

  const hitTestHandle = (x: number, y: number, box: Box): Handle | null => {
    // Hit zones as rectangles around the Telegram-style grips — generous
    // enough for touch, in the same screen coordinates as the overlay.
    const half = (isTouch ? 26 : 18) / 2;
    const midX = box.x + box.w / 2;
    const midY = box.y + box.h / 2;
    const zones: { id: Handle; cx: number; cy: number }[] = [
      { id: "nw", cx: box.x, cy: box.y },
      { id: "ne", cx: box.x + box.w, cy: box.y },
      { id: "se", cx: box.x + box.w, cy: box.y + box.h },
      { id: "sw", cx: box.x, cy: box.y + box.h },
      { id: "n", cx: midX, cy: box.y },
      { id: "s", cx: midX, cy: box.y + box.h },
      { id: "w", cx: box.x, cy: midY },
      { id: "e", cx: box.x + box.w, cy: midY },
    ];
    for (const zone of zones) {
      if (Math.abs(x - zone.cx) <= half && Math.abs(y - zone.cy) <= half) return zone.id;
    }
    return null;
  };

  /** Resize the on-screen crop window while dragging one handle, honouring a
      locked aspect. Works in screen coordinates against the visible photo. */
  const resizeBox = (start: Box, handle: Handle, nx: number, ny: number): Box => {
    const ratio = aspectRef.current ? ASPECTS.find((a) => a.id === aspectRef.current)?.ratio ?? null : null;
    const minSize = isTouch ? 44 : 24;
    const img = getImageScreenRect();

    let left = start.x;
    let top = start.y;
    let right = start.x + start.w;
    let bottom = start.y + start.h;

    const fixedX = handle.includes("w") ? start.x + start.w : start.x;
    const fixedY = handle.includes("n") ? start.y + start.h : start.y;
    let w = Math.abs(nx - fixedX);
    let h = Math.abs(ny - fixedY);

    if (ratio) {
      if (handle === "e" || handle === "w") {
        h = w / ratio;
      } else if (handle === "n" || handle === "s") {
        w = h * ratio;
      } else {
        if (w / h > ratio) w = h * ratio;
        else h = w / ratio;
      }
    }
    w = Math.max(minSize, w);
    h = Math.max(minSize, h);

    if (handle.includes("w")) left = fixedX - w;
    else if (handle.includes("e")) right = fixedX + w;
    if (handle.includes("n")) top = fixedY - h;
    else if (handle.includes("s")) bottom = fixedY + h;

    // Clamp into the visible photo rect, keeping the fixed edge anchored.
    if (handle.includes("w")) {
      left = clamp(left, img.x, fixedX - minSize);
      right = fixedX;
    }
    if (handle.includes("e")) {
      right = clamp(right, fixedX + minSize, img.x + img.w);
      left = fixedX;
    }
    if (handle.includes("n")) {
      top = clamp(top, img.y, fixedY - minSize);
      bottom = fixedY;
    }
    if (handle.includes("s")) {
      bottom = clamp(bottom, fixedY + minSize, img.y + img.h);
      top = fixedY;
    }

    // After clamping, re-fit the secondary axis to the aspect ratio.
    if (ratio) {
      const cw = right - left;
      const ch = bottom - top;
      if (cw / ch > ratio) {
        const newW = ch * ratio;
        if (handle.includes("w")) left = right - newW;
        else if (handle.includes("e")) right = left + newW;
      } else {
        const newH = cw / ratio;
        if (handle.includes("n")) top = bottom - newH;
        else if (handle.includes("s")) bottom = top + newH;
      }
    }

    return { x: left, y: top, w: right - left, h: bottom - top };
  };

  /** Begin a crop drag (grip resize or window move) at a screen point. */
  const startCropDrag = (x: number, y: number) => {
    const box = cropScreenRef.current;
    const handle = hitTestHandle(x, y, box);
    if (handle) {
      cropDragRef.current = { handle, startX: x, startY: y, box };
    } else if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
      cropDragRef.current = { handle: "move", startX: x, startY: y, box };
    }
  };

  const moveCropDrag = (x: number, y: number) => {
    const drag = cropDragRef.current;
    if (!drag) return;
    if (drag.handle === "move") {
      const dx = x - drag.startX;
      const dy = y - drag.startY;
      const img = getImageScreenRect();
      const box = drag.box;
      setCropScreen({
        x: clamp(box.x + dx, img.x, img.x + img.w - box.w),
        y: clamp(box.y + dy, img.y, img.y + img.h - box.h),
        w: box.w,
        h: box.h,
      });
    } else {
      setCropScreen(resizeBox(drag.box, drag.handle, x, y));
    }
  };

  const endCropDrag = () => {
    cropDragRef.current = null;
  };

  /** Apply an aspect preset: keep the current centre, grow/shrink to the
      largest box that fits the visible photo, all in screen coordinates. */
  const applyAspect = (id: string) => {
    setAspect(id);
    const ratio = ASPECTS.find((a) => a.id === id)?.ratio;
    if (!ratio) return;

    const img = getImageScreenRect();
    const s = cropScreenRef.current;
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    let w = img.w;
    let h = img.h;
    if (ratio >= 1) {
      h = w / ratio;
      if (h > img.h) {
        h = img.h;
        w = h * ratio;
      }
    } else {
      w = h * ratio;
      if (w > img.w) {
        w = img.w;
        h = w / ratio;
      }
    }
    const x = clamp(cx - w / 2, img.x, img.x + img.w - w);
    const y = clamp(cy - h / 2, img.y, img.y + img.h - h);
    setCropScreen({ x, y, w, h });
  };

  return {
    cropScreen,
    aspect,
    setAspect,
    aspectMenuOpen,
    setAspectMenuOpen,
    cropBoxRef,
    redrawOverlay,
    clearOverlay,
    resetCropWindow,
    clampCropWindow,
    nudgeCropWindow,
    startCropDrag,
    moveCropDrag,
    endCropDrag,
    applyAspect,
  };
}

// ─── Undo / redo history ────────────────────────────────────────────────────
// Owns the snapshot stacks. Snapshots are async-encoded PNG data URLs (see
// encodeSnapshotAsync); restoring redraws the canvas and lets the caller
// re-sync the stage via onRestore.

function useCanvasHistory({
  canvasRef,
  onRestore,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onRestore: () => void;
}) {
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const undoStackRef = useRef<Snapshot[]>([]);
  const redoStackRef = useRef<Snapshot[]>([]);

  const takeSnapshot = useCallback((): Snapshot | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    // Freeze the pre-stroke pixels synchronously (a cheap drawImage copy); the
    // PNG encoding runs in the background via encodeSnapshotAsync, so starting
    // a stroke never blocks on a synchronous toDataURL of a multi-megapixel
    // canvas.
    const copy = document.createElement("canvas");
    copy.width = canvas.width;
    copy.height = canvas.height;
    const cctx = copy.getContext("2d");
    if (!cctx) return null;
    cctx.drawImage(canvas, 0, 0);
    return { width: canvas.width, height: canvas.height, ready: encodeSnapshotAsync(copy) };
  }, [canvasRef]);

  const pushUndo = useCallback(() => {
    const snap = takeSnapshot();
    if (!snap) return;
    undoStackRef.current.push(snap);
    // A bounded history keeps memory in check: each entry is a full-resolution
    // PNG of a photo up to 2560px, so 10 steps is already tens of MB.
    if (undoStackRef.current.length > 10) undoStackRef.current.shift();
    redoStackRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, [takeSnapshot]);

  const restoreSnapshot = useCallback(
    (snap: Snapshot) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      snap.ready
        .then((dataUrl) => {
          const img = new Image();
          img.src = dataUrl;
          const apply = () => {
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            // No black flash on undo/redo: when the snapshot has the same size
            // as the canvas we never reassign width/height (that would clear
            // the buffer), so the previous frame stays visible until the
            // decoded snapshot replaces it. When the size differs (undoing an
            // applied crop), copy the current pixels out, resize, and draw the
            // copy back before painting the snapshot on top.
            if (canvas.width !== snap.width || canvas.height !== snap.height) {
              const prev = document.createElement("canvas");
              prev.width = canvas.width;
              prev.height = canvas.height;
              const pctx = prev.getContext("2d");
              if (pctx) pctx.drawImage(canvas, 0, 0);
              canvas.width = snap.width;
              canvas.height = snap.height;
              if (pctx) ctx.drawImage(prev, 0, 0, prev.width, prev.height);
            }
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(img, 0, 0, snap.width, snap.height);
            // Restoring pixels must not touch the view (zoom/pan) or the aspect
            // lock: undo of a brush stroke keeps the user's context, and the
            // derived crop box simply re-syncs with the unchanged screen window.
            // The crop window is only reset inside onRestore when the photo
            // size itself changed (e.g. undoing an applied crop).
            onRestore();
          };
          if (typeof img.decode === "function") {
            img.decode().then(() => apply()).catch(() => { img.onload = apply; });
          } else {
            img.onload = apply;
          }
        })
        .catch((error) => console.error("Snapshot restore failed", error));
    },
    [canvasRef, onRestore]
  );

  const handleUndo = useCallback(() => {
    const stack = undoStackRef.current;
    const canvas = canvasRef.current;
    if (stack.length === 0 || !canvas) return;
    const current = takeSnapshot();
    const prev = stack.pop();
    if (current) redoStackRef.current.push(current);
    if (prev) restoreSnapshot(prev);
    setCanUndo(stack.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  }, [takeSnapshot, restoreSnapshot, canvasRef]);

  const handleRedo = useCallback(() => {
    const stack = redoStackRef.current;
    const canvas = canvasRef.current;
    if (stack.length === 0 || !canvas) return;
    const current = takeSnapshot();
    const next = stack.pop();
    if (current) undoStackRef.current.push(current);
    if (next) restoreSnapshot(next);
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(stack.length > 0);
  }, [takeSnapshot, restoreSnapshot, canvasRef]);

  return { canUndo, canRedo, pushUndo, handleUndo, handleRedo };
}

// ─── Brush / blur gesture ───────────────────────────────────────────────────
// Owns the in-flight stroke: one undo step per stroke, a blur layer prepared
// once at stroke start, and segment-interpolated stamping for fast swipes.

function useBrushGesture({
  canvasRef,
  pushUndo,
  tool,
  color,
  brushSize,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  pushUndo: () => void;
  tool: Tool;
  color: string;
  brushSize: number;
}) {
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const colorRef = useRef(color);
  colorRef.current = color;
  const brushSizeRef = useRef(brushSize);
  brushSizeRef.current = brushSize;
  const strokeRef = useRef<{ x: number; y: number; drawing: boolean } | null>(null);
  const blurCanvasRef = useRef<HTMLCanvasElement | null>(null);

  /**
   * Build a blurred copy of the canvas to stamp from. Uses a
   * downscale-then-upscale pass instead of ctx.filter, which is not supported
   * in Safari/iOS — so the blur brush works everywhere. The downscale factor
   * is derived from the brush size alone (bigger brush = stronger blur), not
   * from the photo resolution, so the same brush looks the same on any image.
   */
  const makeBlurLayer = (canvas: HTMLCanvasElement | null): HTMLCanvasElement | null => {
    if (!canvas) return null;
    // Blur radius ≈ 1.5 / s in image pixels: size 6 → ~4px, 48 → ~29px,
    // 96 → ~50px. Clamped so tiny brushes stay subtle and huge ones do not
    // smear the whole image into one blob.
    const s = clamp(2.5 / Math.max(1, brushSizeRef.current), 0.03, 0.5);
    const tw = Math.max(1, Math.round(canvas.width * s));
    const th = Math.max(1, Math.round(canvas.height * s));
    const small = document.createElement("canvas");
    small.width = tw;
    small.height = th;
    const sctx = small.getContext("2d");
    if (!sctx) return null;
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(canvas, 0, 0, tw, th);

    const blur = document.createElement("canvas");
    blur.width = canvas.width;
    blur.height = canvas.height;
    const bctx = blur.getContext("2d");
    if (!bctx) return null;
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = "high";
    bctx.drawImage(small, 0, 0, canvas.width, canvas.height);
    return blur;
  };

  const stampBlur = (x: number, y: number) => {
    const canvas = canvasRef.current;
    const blurCanvas = blurCanvasRef.current;
    if (!canvas || !blurCanvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const radius = brushSizeRef.current / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(blurCanvas, 0, 0);
    ctx.restore();
  };

  /** Begin a stroke at an image-space point: snapshot once per stroke so undo
      steps are strokes. For blur, prepare the blurred stamp layer. */
  const beginStroke = (point: Point) => {
    pushUndo();
    strokeRef.current = { x: point.x, y: point.y, drawing: true };

    if (toolRef.current === "blur") {
      blurCanvasRef.current = makeBlurLayer(canvasRef.current);
    } else {
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = colorRef.current;
        ctx.lineWidth = brushSizeRef.current;
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        ctx.lineTo(point.x + 0.01, point.y + 0.01);
        ctx.stroke();
      }
    }
  };

  /** Extend the stroke towards a new image-space point. */
  const continueStroke = (point: Point) => {
    const stroke = strokeRef.current;
    if (!stroke?.drawing) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    if (toolRef.current === "blur") {
      // Stamp along the segment so a fast swipe leaves a continuous smear.
      const dist = Math.hypot(point.x - stroke.x, point.y - stroke.y);
      const step = Math.max(2, brushSizeRef.current / 2);
      const steps = Math.max(1, Math.ceil(dist / step));
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        stampBlur(stroke.x + (point.x - stroke.x) * t, stroke.y + (point.y - stroke.y) * t);
      }
    } else {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = colorRef.current;
      ctx.lineWidth = brushSizeRef.current;
      ctx.beginPath();
      ctx.moveTo(stroke.x, stroke.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
    strokeRef.current = { x: point.x, y: point.y, drawing: true };
  };

  const endStroke = () => {
    strokeRef.current = null;
    blurCanvasRef.current = null;
  };

  return { beginStroke, continueStroke, endStroke };
}

// ─── Editor component ───────────────────────────────────────────────────────
// Slim shell: owns the DOM refs, the toolbar/tool state and the stage fit, and
// coordinates the gesture hooks. The public interface stays src/onApply/onCancel.

export const PhotoEditor = ({ src, onApply, onCancel }: PhotoEditorProps) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const pointersRef = useRef<Map<number, Point>>(new Map());
  const lastImgSizeRef = useRef({ w: 0, h: 0 });

  const [tool, setTool] = useState<Tool>("crop");
  const [color, setColor] = useState("#e53935");
  const [brushSize, setBrushSize] = useState(12);
  const [fit, setFit] = useState({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const fitRef = useRef(fit);
  fitRef.current = fit;

  const brushMin = tool === "blur" ? 6 : 2;
  const brushMax = tool === "blur" ? 96 : 48;

  const pinch = usePinchZoom({ overlayRef, fitRef });
  const { viewRef, view, resetView, zoomBy, beginPinch, updatePinch, endPinch } = pinch;
  const crop = useCropWindow({
    canvasRef,
    overlayRef,
    stageRef,
    viewRef,
    view,
    fitRef,
    fit,
    tool,
    ready,
  });
  const {
    cropScreen,
    aspect,
    setAspect,
    aspectMenuOpen,
    setAspectMenuOpen,
    cropBoxRef,
    redrawOverlay,
    clearOverlay,
    resetCropWindow,
    clampCropWindow,
    nudgeCropWindow,
    startCropDrag,
    moveCropDrag,
    endCropDrag,
    applyAspect,
  } = crop;

  /** Recompute the contain fit for the photo and keep the screen-fixed overlay
      sized to the stage. Resets the crop window to the whole photo whenever
      the image itself changed (load, undo/redo, applied crop). */
  const syncStage = useCallback(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!stage || !canvas || !overlay) return;
    const iw = canvas.width;
    const ih = canvas.height;
    if (!iw || !ih) return;
    const scale = Math.min(stage.clientWidth / iw, stage.clientHeight / ih);
    const w = Math.max(1, Math.floor(iw * scale));
    const h = Math.max(1, Math.floor(ih * scale));
    setFit((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));

    // Size the overlay buffer to the stage in device pixels.
    const dpr = window.devicePixelRatio || 1;
    const ow = Math.max(1, Math.round(stage.clientWidth * dpr));
    const oh = Math.max(1, Math.round(stage.clientHeight * dpr));
    if (overlay.width !== ow || overlay.height !== oh) {
      overlay.width = ow;
      overlay.height = oh;
    }

    const imgChanged = lastImgSizeRef.current.w !== iw || lastImgSizeRef.current.h !== ih;
    lastImgSizeRef.current = { w: iw, h: ih };
    if (imgChanged) {
      resetCropWindow(w, h);
    } else if (ready) {
      // Stage-only resize (rotation, browser chrome): the crop window keeps
      // its position and size but must stay inside the (newly fit) photo.
      const v = viewRef.current;
      const fw = w * v.zoom;
      const fh = h * v.zoom;
      clampCropWindow({
        x: stage.clientWidth / 2 + v.x - fw / 2,
        y: stage.clientHeight / 2 + v.y - fh / 2,
        w: fw,
        h: fh,
      });
    }

    redrawOverlay();
  }, [resetCropWindow, clampCropWindow, redrawOverlay, ready, viewRef]);

  const history = useCanvasHistory({ canvasRef, onRestore: syncStage });
  const brush = useBrushGesture({ canvasRef, pushUndo: history.pushUndo, tool, color, brushSize });

  // Keep everything in sync with the stage size (rotation, browser chrome).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(syncStage);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [syncStage]);

  // ─── Initial load ─────────────────────────────────────────────────────────
  // Loads the photo ONCE per src (plus manual retry). Deliberately has no
  // other deps: re-running would wipe the canvas (drawings, crop) and flash a
  // black screen while decoding — the cause of the phone glitches.
  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    (async () => {
      try {
        const img = await loadImage(src);
        if (cancelled) return;
        const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));

        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);

        resetView();
        setAspect(null);
        setReady(true);
      } catch (error) {
        console.error("PhotoEditor init failed", error);
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src, reloadKey, resetView, setAspect]);

  // Fit the photo into the stage once it is ready.
  useEffect(() => {
    if (ready) syncStage();
  }, [ready, syncStage]);

  // Redraw the overlay whenever the visible state changes.
  useEffect(() => {
    if (!ready) return;
    if (tool === "crop") redrawOverlay();
    else clearOverlay();
  }, [ready, tool, cropScreen, view, fit, redrawOverlay, clearOverlay]);

  // Close the aspect menu on outside click / Escape.
  useEffect(() => {
    if (!aspectMenuOpen) return;
    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".pe-aspect-trigger-wrap")) setAspectMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAspectMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [aspectMenuOpen, setAspectMenuOpen]);

  // Keyboard access for the canvas tools: 1/2/3 switch tools, arrows nudge the
  // crop window (Shift = 10px), +/- zoom, [ ] resize the brush, 0 resets zoom.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case "1":
          setTool("crop");
          break;
        case "2":
          setTool("brush");
          break;
        case "3":
          setTool("blur");
          break;
        case "0":
          resetView();
          break;
        case "+":
        case "=":
          zoomBy(WHEEL_ZOOM_STEP);
          break;
        case "-":
        case "_":
          zoomBy(1 / WHEEL_ZOOM_STEP);
          break;
        case "[":
          setBrushSize((size) => clamp(size - 2, brushMin, brushMax));
          break;
        case "]":
          setBrushSize((size) => clamp(size + 2, brushMin, brushMax));
          break;
        case "ArrowUp":
        case "ArrowDown":
        case "ArrowLeft":
        case "ArrowRight": {
          if (tool !== "crop" || aspectMenuOpen) return;
          event.preventDefault();
          const step = event.shiftKey ? 10 : 1;
          const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
          const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
          nudgeCropWindow(dx, dy);
          break;
        }
        default:
          break;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [tool, aspectMenuOpen, brushMin, brushMax, zoomBy, resetView, nudgeCropWindow, setBrushSize]);

  // ─── Pointer handling ─────────────────────────────────────────────────────

  /** Pointer position in stage (screen) coordinates. */
  const getScreenPoint = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const el = overlayRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, [overlayRef]);

  /** Pointer position in image coordinates, mapped through the zoomed frame. */
  const getCanvasPoint = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: clamp(((e.clientX - rect.left) / rect.width) * canvas.width, 0, canvas.width),
      y: clamp(((e.clientY - rect.top) / rect.height) * canvas.height, 0, canvas.height),
      inside: e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom,
    };
  }, [canvasRef]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const screen = getScreenPoint(e);
    if (!screen) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Two fingers down: start pinch-zoom, pause any in-flight stroke/crop.
    if (pointersRef.current.size >= 2) {
      const [p1, p2] = Array.from(pointersRef.current.values());
      beginPinch(p1, p2);
      brush.endStroke();
      endCropDrag();
      return;
    }

    if (tool === "crop") {
      const point = getCanvasPoint(e);
      if (!point?.inside) return;
      startCropDrag(screen.x, screen.y);
      return;
    }

    // Brush / blur stroke.
    const point = getCanvasPoint(e);
    if (!point?.inside) return;
    brush.beginStroke(point);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Keep pointer positions fresh for pinch tracking.
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (pointersRef.current.size >= 2) {
      const [p1, p2] = Array.from(pointersRef.current.values());
      updatePinch(p1, p2);
      return;
    }

    if (tool === "crop") {
      const screen = getScreenPoint(e);
      if (!screen) return;
      moveCropDrag(screen.x, screen.y);
      return;
    }

    const point = getCanvasPoint(e);
    if (!point) return;
    brush.continueStroke(point);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) endPinch();
    brush.endStroke();
    endCropDrag();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.clear();
    endPinch();
    brush.endStroke();
    endCropDrag();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
  };

  // ─── Crop apply & export ──────────────────────────────────────────────────

  const applyCrop = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const box = cropBoxRef.current;
    if (Math.round(box.w) >= canvas.width && Math.round(box.h) >= canvas.height) return;

    history.pushUndo();
    const out = cropCanvas(canvas, box);
    if (!out) return;

    canvas.width = out.width;
    canvas.height = out.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(out, 0, 0, out.width, out.height);

    resetView();
    syncStage();
  };

  /** "Готово": export the canvas with any pending crop applied. */
  const handleApply = () => {
    if (!ready || loadError) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const box = cropBoxRef.current;
    if (Math.round(box.w) < canvas.width || Math.round(box.h) < canvas.height) {
      const out = cropCanvas(canvas, box);
      if (!out) return;
      onApply(out.toDataURL("image/png"));
    } else {
      onApply(canvas.toDataURL("image/png"));
    }
  };

  const currentAspectLabel = ASPECTS.find((a) => a.id === aspect)?.label ?? "Свободно";

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="pe-root">
      <div className="pe-topbar">
        <button type="button" className="pe-top-btn" onClick={onCancel} aria-label="Отмена" title="Отмена">
          <X size={22} />
        </button>
        <span className="pe-title">Редактирование фото</span>
        <button type="button" className="pe-top-btn pe-done" onClick={handleApply} disabled={!ready || loadError} aria-label="Готово" title="Готово">
          <Check size={22} />
        </button>
      </div>

      <div ref={stageRef} className="pe-stage">
        {/* The pan wrapper moves the photo on screen; the frame inside scales
            it. The crop overlay below is a separate screen-fixed layer, so
            zooming never moves the crop frame. */}
        <div
          className="pe-frame-pan"
          style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0)` }}
        >
          <div
            className="pe-frame"
            style={{
              width: fit.w || undefined,
              height: fit.h || undefined,
              transform: `scale(${view.zoom})`,
            }}
          >
            <canvas ref={canvasRef} className="pe-canvas" />
          </div>
        </div>
        <canvas
          ref={overlayRef}
          className="pe-canvas pe-overlay"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        />
        {loadError ? (
          <div className="pe-error">
            <span>Не удалось загрузить изображение</span>
            <button type="button" onClick={() => setReloadKey((k) => k + 1)}>
              Повторить
            </button>
          </div>
        ) : (
          (tool === "brush" || tool === "blur") &&
          ready && <VerticalBrushSize value={brushSize} min={brushMin} max={brushMax} onChange={setBrushSize} />
        )}
      </div>

      {/* Tool-specific settings */}
      <div className="pe-settings">
        {tool === "brush" && (
          <div className="pe-colors">
            {BRUSH_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={cn("pe-swatch", color === c && "is-active")}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={`Цвет ${c}`}
              />
            ))}
            <span className="pe-swatch pe-custom" style={{ background: color }}>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                aria-label="Свой цвет"
              />
            </span>
          </div>
        )}

        {tool === "crop" && (
          <div className="pe-crop-row">
            <div className="pe-aspect-trigger-wrap">
              <button
                type="button"
                className={cn("pe-aspect-trigger", aspectMenuOpen && "is-open")}
                onClick={() => setAspectMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={aspectMenuOpen}
              >
                <Ratio size={16} />
                <span className="pe-aspect-trigger-label">{currentAspectLabel}</span>
                <ChevronDown size={14} className={cn("pe-aspect-chevron", aspectMenuOpen && "is-open")} />
              </button>
              {aspectMenuOpen && (
                <div className="pe-aspect-menu" role="menu">
                  {ASPECTS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      role="menuitem"
                      className={cn("pe-aspect-option", aspect === a.id && "is-active")}
                      onClick={() => {
                        applyAspect(a.id);
                        setAspectMenuOpen(false);
                      }}
                    >
                      <span>{a.label}</span>
                      {aspect === a.id && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" className="pe-apply-crop" onClick={applyCrop} disabled={!ready}>
              <Crop size={16} />
              Применить кадр
            </button>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="pe-toolbar">
        <button type="button" className={cn("pe-tool", tool === "crop" && "is-active")} onClick={() => setTool("crop")} aria-label="Кадрировать" title="Кадрировать">
          <Crop size={20} />
        </button>
        <button type="button" className={cn("pe-tool", tool === "brush" && "is-active")} onClick={() => setTool("brush")} aria-label="Кисть" title="Кисть">
          <Paintbrush size={20} />
        </button>
        <button type="button" className={cn("pe-tool", tool === "blur" && "is-active")} onClick={() => setTool("blur")} aria-label="Размытие" title="Размытие">
          <Droplets size={20} />
        </button>
        <div className="pe-toolbar-divider" />
        <button type="button" className="pe-tool" onClick={history.handleUndo} disabled={!history.canUndo} aria-label="Отменить" title="Отменить">
          <Undo2 size={20} />
        </button>
        <button type="button" className="pe-tool" onClick={history.handleRedo} disabled={!history.canRedo} aria-label="Повторить" title="Повторить">
          <Redo2 size={20} />
        </button>
      </div>
    </div>
  );
};
