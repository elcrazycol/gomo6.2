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
type Snapshot = { width: number; height: number; dataUrl: string };

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
    if (typeof img.decode === "function") {
      img.decode().then(done).catch(() => {});
    }
  });
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

export const PhotoEditor = ({ src, onApply, onCancel }: PhotoEditorProps) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);

  const [tool, setTool] = useState<Tool>("crop");
  const [color, setColor] = useState("#e53935");
  const [brushSize, setBrushSize] = useState(12);
  const [aspect, setAspect] = useState<string | null>(null);
  const [aspectMenuOpen, setAspectMenuOpen] = useState(false);
  // The crop window lives in SCREEN coordinates on a layer that never zooms:
  // pinch/wheel zoom the photo underneath while the frame stays put, exactly
  // like Telegram. The image-space crop box is derived from it for export.
  const [cropScreen, setCropScreen] = useState<Box>({ x: 0, y: 0, w: 1, h: 1 });
  const [fit, setFit] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>(IDENTITY_VIEW);
  const viewRef = useRef<View>(IDENTITY_VIEW);
  viewRef.current = view;
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Refs mirroring state for use inside event handlers without re-subscribing.
  const toolRef = useRef<Tool>("crop");
  toolRef.current = tool;
  const colorRef = useRef(color);
  colorRef.current = color;
  const brushSizeRef = useRef(brushSize);
  brushSizeRef.current = brushSize;
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;
  const cropScreenRef = useRef(cropScreen);
  cropScreenRef.current = cropScreen;
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const readyRef = useRef(ready);
  readyRef.current = ready;

  const imageRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  // Image-space crop box derived from the fixed on-screen window; this is what
  // gets exported when applying the crop / pressing "Готово".
  const cropBoxRef = useRef<Box>({ x: 0, y: 0, w: 1, h: 1 });
  const undoStackRef = useRef<Snapshot[]>([]);
  const redoStackRef = useRef<Snapshot[]>([]);
  const strokeRef = useRef<{ x: number; y: number; drawing: boolean } | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ dist: number; zoom: number; x: number; y: number; midX: number; midY: number } | null>(null);
  const cropDragRef = useRef<{ handle: Handle | "move"; startX: number; startY: number; box: Box } | null>(null);
  const blurCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastImgSizeRef = useRef({ w: 0, h: 0 });

  const isTouch = useMemo(
    () => typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0),
    []
  );

  // ─── Stage / overlay ──────────────────────────────────────────────────────

  const getOverlayCtx = useCallback(() => overlayRef.current?.getContext("2d") ?? null, []);

  /** Screen rect of the visible (zoomed + panned) photo, in stage coordinates.
      Computed analytically so it works before the browser has laid the frame
      out (and in tests). */
  const getImageScreenRect = useCallback((): Box => {
    const stage = stageRef.current;
    const f = fitRef.current;
    const v = viewRef.current;
    const cx = (stage?.clientWidth ?? 0) / 2 + v.x;
    const cy = (stage?.clientHeight ?? 0) / 2 + v.y;
    const w = f.w * v.zoom;
    const h = f.h * v.zoom;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }, []);

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
  }, [getOverlayCtx, isTouch]);

  const clearOverlay = useCallback(() => {
    const ctx = getOverlayCtx();
    const stage = stageRef.current;
    if (!ctx || !stage) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, stage.clientWidth, stage.clientHeight);
  }, [getOverlayCtx]);

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
      setCropScreen({
        x: Math.max(0, (stage.clientWidth - w) / 2),
        y: Math.max(0, (stage.clientHeight - h) / 2),
        w,
        h,
      });
    }

    redrawOverlay();
  }, [redrawOverlay]);

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
        imageRef.current = { width, height };

        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);

        setView(IDENTITY_VIEW);
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
  }, [src, reloadKey]);

  // Fit the photo into the stage once it is ready.
  useEffect(() => {
    if (ready) syncStage();
  }, [ready, syncStage]);

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
  }, []);

  useEffect(() => {
    syncCropBox();
  }, [cropScreen, view, fit, syncCropBox]);

  // Redraw the overlay whenever the visible state changes.
  useEffect(() => {
    if (!ready) return;
    if (tool === "crop") redrawOverlay();
    else clearOverlay();
  }, [ready, tool, cropScreen, view, fit, redrawOverlay, clearOverlay]);

  // ─── Snapshots (undo / redo) ──────────────────────────────────────────────

  const takeSnapshot = useCallback((): Snapshot | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return { width: canvas.width, height: canvas.height, dataUrl: canvas.toDataURL("image/png") };
  }, []);

  const pushUndo = useCallback(() => {
    const snap = takeSnapshot();
    if (!snap) return;
    undoStackRef.current.push(snap);
    if (undoStackRef.current.length > 25) undoStackRef.current.shift();
    redoStackRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, [takeSnapshot]);

  const restoreSnapshot = useCallback(
    (snap: Snapshot) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const apply = (img: HTMLImageElement) => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = snap.width;
        canvas.height = snap.height;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, snap.width, snap.height);
        imageRef.current = { width: snap.width, height: snap.height };
        setView(IDENTITY_VIEW);
        setAspect(null);
        syncStage();
      };
      const img = new Image();
      img.src = snap.dataUrl;
      if (typeof img.decode === "function") {
        img.decode().then(() => apply(img)).catch(() => { img.onload = () => apply(img); });
      } else {
        img.onload = () => apply(img);
      }
    },
    [syncStage]
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
  }, [takeSnapshot, restoreSnapshot]);

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
  }, [takeSnapshot, restoreSnapshot]);

  // ─── Zoom / pan (pinch + mouse wheel) ────────────────────────────────────

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
  }, []);

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
  }, [applyView]);

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
  }, [zoomAt]);

  // ─── Pointer handling ─────────────────────────────────────────────────────

  /** Pointer position in stage (screen) coordinates. */
  const getScreenPoint = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const el = overlayRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

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
  }, []);

  const hitTestHandle = useCallback(
    (x: number, y: number, box: Box): Handle | null => {
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
    },
    [isTouch]
  );

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

  /**
   * Build a strongly blurred copy of the canvas to stamp from. Uses a
   * downscale-then-upscale pass instead of ctx.filter, which is not supported
   * in Safari/iOS — so the blur brush works everywhere.
   */
  const makeBlurLayer = (canvas: HTMLCanvasElement | null): HTMLCanvasElement | null => {
    if (!canvas) return null;
    const longEdge = Math.max(canvas.width, canvas.height);
    const s = Math.min(1, 80 / longEdge);
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

  const beginPinch = (p1: { x: number; y: number }, p2: { x: number; y: number }) => {
    pinchRef.current = {
      dist: Math.hypot(p2.x - p1.x, p2.y - p1.y),
      zoom: viewRef.current.zoom,
      x: viewRef.current.x,
      y: viewRef.current.y,
      midX: (p1.x + p2.x) / 2,
      midY: (p1.y + p2.y) / 2,
    };
  };

  const updatePinch = (p1: { x: number; y: number }, p2: { x: number; y: number }) => {
    const base = pinchRef.current;
    if (!base || base.dist === 0) return;
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const zoom = base.zoom * (dist / base.dist);
    applyView({
      zoom,
      x: base.x + (midX - base.midX),
      y: base.y + (midY - base.midY),
    });
  };

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
      strokeRef.current = null;
      cropDragRef.current = null;
      return;
    }

    if (toolRef.current === "crop") {
      const point = getCanvasPoint(e);
      if (!point?.inside) return;
      const box = cropScreenRef.current;
      const handle = hitTestHandle(screen.x, screen.y, box);
      if (handle) {
        cropDragRef.current = { handle, startX: screen.x, startY: screen.y, box };
      } else if (screen.x >= box.x && screen.x <= box.x + box.w && screen.y >= box.y && screen.y <= box.y + box.h) {
        cropDragRef.current = { handle: "move", startX: screen.x, startY: screen.y, box };
      }
      return;
    }

    // Brush / blur stroke: snapshot once per stroke so undo steps are strokes.
    const point = getCanvasPoint(e);
    if (!point?.inside) return;
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

    if (toolRef.current === "crop") {
      const drag = cropDragRef.current;
      if (!drag) return;
      const screen = getScreenPoint(e);
      if (!screen) return;
      if (drag.handle === "move") {
        const dx = screen.x - drag.startX;
        const dy = screen.y - drag.startY;
        const img = getImageScreenRect();
        const box = drag.box;
        const x = clamp(box.x + dx, img.x, img.x + img.w - box.w);
        const y = clamp(box.y + dy, img.y, img.y + img.h - box.h);
        setCropScreen({ x, y, w: box.w, h: box.h });
      } else {
        setCropScreen(resizeBox(drag.box, drag.handle, screen.x, screen.y));
      }
      return;
    }

    const stroke = strokeRef.current;
    if (!stroke?.drawing) return;
    const point = getCanvasPoint(e);
    if (!point) return;
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

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    strokeRef.current = null;
    cropDragRef.current = null;
    blurCanvasRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.clear();
    pinchRef.current = null;
    strokeRef.current = null;
    cropDragRef.current = null;
    blurCanvasRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
  };

  // ─── Aspect presets & apply ───────────────────────────────────────────────

  const applyAspect = (id: string) => {
    setAspect(id);
    const ratio = ASPECTS.find((a) => a.id === id)?.ratio;
    if (!ratio) return;

    // Keep the current centre, grow/shrink to the largest box that fits the
    // visible photo, all in screen coordinates.
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

  const brushMin = tool === "blur" ? 6 : 2;
  const brushMax = tool === "blur" ? 96 : 48;

  const currentAspectLabel = ASPECTS.find((a) => a.id === aspect)?.label ?? "Свободно";

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
  }, [aspectMenuOpen]);

  const applyCrop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const box = cropBoxRef.current;
    const w = Math.max(1, Math.round(box.w));
    const h = Math.max(1, Math.round(box.h));
    if (w >= canvas.width && h >= canvas.height) return;

    pushUndo();
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const octx = out.getContext("2d");
    if (!octx) return;
    octx.drawImage(canvas, box.x, box.y, w, h, 0, 0, w, h);

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(out, 0, 0, w, h);

    imageRef.current = { width: w, height: h };
    setView(IDENTITY_VIEW);
    syncStage();
  }, [pushUndo, syncStage]);

  /** "Готово": export the canvas with any pending crop applied. */
  const handleApply = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const box = cropBoxRef.current;
    const w = Math.round(box.w);
    const h = Math.round(box.h);
    if (w < canvas.width || h < canvas.height) {
      const out = document.createElement("canvas");
      out.width = Math.max(1, w);
      out.height = Math.max(1, h);
      const octx = out.getContext("2d");
      if (!octx) return;
      octx.drawImage(canvas, box.x, box.y, out.width, out.height, 0, 0, out.width, out.height);
      onApply(out.toDataURL("image/png"));
    } else {
      onApply(canvas.toDataURL("image/png"));
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="pe-root">
      <div className="pe-topbar">
        <button type="button" className="pe-top-btn" onClick={onCancel} aria-label="Отмена" title="Отмена">
          <X size={22} />
        </button>
        <span className="pe-title">Редактирование фото</span>
        <button type="button" className="pe-top-btn pe-done" onClick={handleApply} aria-label="Готово" title="Готово">
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
        <button type="button" className="pe-tool" onClick={handleUndo} disabled={!canUndo} aria-label="Отменить" title="Отменить">
          <Undo2 size={20} />
        </button>
        <button type="button" className="pe-tool" onClick={handleRedo} disabled={!canRedo} aria-label="Повторить" title="Повторить">
          <Redo2 size={20} />
        </button>
      </div>
    </div>
  );
};
