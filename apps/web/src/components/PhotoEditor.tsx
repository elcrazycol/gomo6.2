import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Crop, Droplets, Paintbrush, Ratio, Redo2, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import "./PhotoEditor.css";

const MAX_IMAGE_DIMENSION = 2560;

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

const FULL_BOX = (w: number, h: number): Box => ({ x: 0, y: 0, w, h });

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
  const [cropBox, setCropBox] = useState<Box>({ x: 0, y: 0, w: 1, h: 1 });
  const [fit, setFit] = useState({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);
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
  const cropBoxRef = useRef(cropBox);
  cropBoxRef.current = cropBox;

  const imageRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const undoStackRef = useRef<Snapshot[]>([]);
  const redoStackRef = useRef<Snapshot[]>([]);
  const strokeRef = useRef<{ x: number; y: number; drawing: boolean } | null>(null);
  const cropDragRef = useRef<{ handle: Handle | "move"; startX: number; startY: number; box: Box } | null>(null);
  const blurCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const isTouch = useMemo(
    () => typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0),
    []
  );

  // ─── Canvas setup ─────────────────────────────────────────────────────────

  const recalcFit = useCallback(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const iw = canvas.width;
    const ih = canvas.height;
    if (!iw || !ih) return;
    const scale = Math.min(stage.clientWidth / iw, stage.clientHeight / ih);
    setFit({ w: Math.max(1, Math.floor(iw * scale)), h: Math.max(1, Math.floor(ih * scale)) });
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(recalcFit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [recalcFit]);

  const getOverlayCtx = useCallback(() => overlayRef.current?.getContext("2d") ?? null, []);

  const drawCropOverlay = useCallback(() => {
    const ctx = getOverlayCtx();
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    const W = canvas.width;
    const H = canvas.height;
    const box = cropBoxRef.current;
    // Canvas → screen scale: all overlay geometry is drawn in canvas pixels
    // but must look the same on screen regardless of the photo resolution.
    const scale = canvas.width / Math.max(1, fit.w);
    ctx.clearRect(0, 0, W, H);

    // Darken everything outside the crop frame.
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, W, box.y);
    ctx.fillRect(0, box.y + box.h, W, H - box.y - box.h);
    ctx.fillRect(0, box.y, box.x, box.h);
    ctx.fillRect(box.x + box.w, box.y, W - box.x - box.w, box.h);

    // Rule-of-thirds grid.
    if (box.w >= 60 && box.h >= 60) {
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = Math.max(1, 1 * scale);
      for (let i = 1; i <= 2; i += 1) {
        const gx = box.x + (box.w * i) / 3;
        const gy = box.y + (box.h * i) / 3;
        ctx.beginPath();
        ctx.moveTo(gx, box.y);
        ctx.lineTo(gx, box.y + box.h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(box.x, gy);
        ctx.lineTo(box.x + box.w, gy);
        ctx.stroke();
      }
    }

    // Thin frame.
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = Math.max(1, 1.5 * scale);
    ctx.strokeRect(box.x, box.y, box.w, box.h);

    // Telegram-style grips: thick short strips along the frame. Corners get a
    // right-angle pair, side midpoints get a small centred strip.
    const handleThickness = Math.max(2, (isTouch ? 5 : 4) * scale);
    const cornerLen = (isTouch ? 26 : 22) * scale;
    const midLen = (isTouch ? 18 : 14) * scale;
    ctx.fillStyle = "#ffffff";

    const corners: { x: number; y: number; hx: 1 | -1; hy: 1 | -1 }[] = [
      { x: box.x, y: box.y, hx: 1, hy: 1 },
      { x: box.x + box.w, y: box.y, hx: -1, hy: 1 },
      { x: box.x + box.w, y: box.y + box.h, hx: -1, hy: -1 },
      { x: box.x, y: box.y + box.h, hx: 1, hy: -1 },
    ];
    corners.forEach((c) => {
      // Horizontal strip along the top/bottom edge.
      ctx.fillRect(c.hx < 0 ? c.x - cornerLen : c.x, c.y - handleThickness / 2, cornerLen, handleThickness);
      // Vertical strip along the left/right edge.
      ctx.fillRect(c.x - handleThickness / 2, c.hy < 0 ? c.y - cornerLen : c.y, handleThickness, cornerLen);
    });

    const midX = box.x + box.w / 2;
    const midY = box.y + box.h / 2;
    ctx.fillRect(midX - midLen / 2, box.y - handleThickness / 2, midLen, handleThickness);
    ctx.fillRect(midX - midLen / 2, box.y + box.h - handleThickness / 2, midLen, handleThickness);
    ctx.fillRect(box.x - handleThickness / 2, midY - midLen / 2, handleThickness, midLen);
    ctx.fillRect(box.x + box.w - handleThickness / 2, midY - midLen / 2, handleThickness, midLen);
  }, [getOverlayCtx, isTouch, fit.w]);

  // Initial load: decode the source at most 2560px on the long edge, then
  // render it onto the main canvas. The canvas always stays inside the stage
  // via a contain fit, so the photo is never clipped.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const img = await loadImage(src);
        if (cancelled) return;
        const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));
        imageRef.current = { width, height };

        const canvas = canvasRef.current;
        const overlay = overlayRef.current;
        if (!canvas || !overlay) return;
        canvas.width = width;
        canvas.height = height;
        overlay.width = width;
        overlay.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);

        setCropBox(FULL_BOX(width, height));
        setReady(true);
        recalcFit();
        drawCropOverlay();
      } catch (error) {
        console.error("PhotoEditor init failed", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src, recalcFit, drawCropOverlay]);

  // Redraw the crop overlay whenever the box or canvas size changes.
  useEffect(() => {
    if (ready && toolRef.current === "crop") drawCropOverlay();
  }, [cropBox, ready, drawCropOverlay]);

  useEffect(() => {
    if (ready && tool === "crop") drawCropOverlay();
    if (ready && tool !== "crop") getOverlayCtx()?.clearRect(0, 0, imageRef.current.width, imageRef.current.height);
  }, [tool, ready, drawCropOverlay, getOverlayCtx]);

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
      const overlay = overlayRef.current;
      if (!canvas || !overlay) return;
      const apply = (img: HTMLImageElement) => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = snap.width;
        canvas.height = snap.height;
        overlay.width = snap.width;
        overlay.height = snap.height;
        ctx.drawImage(img, 0, 0, snap.width, snap.height);
        imageRef.current = { width: snap.width, height: snap.height };
        setCropBox(FULL_BOX(snap.width, snap.height));
        recalcFit();
        drawCropOverlay();
      };
      const img = new Image();
      img.src = snap.dataUrl;
      if (typeof img.decode === "function") {
        img.decode().then(() => apply(img)).catch(() => { img.onload = () => apply(img); });
      } else {
        img.onload = () => apply(img);
      }
    },
    [recalcFit, drawCropOverlay]
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

  // ─── Pointer handling ─────────────────────────────────────────────────────

  const getCanvasPoint = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!canvas || !rect.width || !rect.height) return null;
    return {
      x: clamp(((e.clientX - rect.left) / rect.width) * canvas.width, 0, canvas.width),
      y: clamp(((e.clientY - rect.top) / rect.height) * canvas.height, 0, canvas.height),
    };
  }, []);

  const hitTestHandle = useCallback(
    (x: number, y: number, box: Box): Handle | null => {
      // Hit zones as rectangles around the Telegram-style grips: generous
      // enough for touch, matching the drawn strips on desktop.
      const scale = canvasRef.current ? canvasRef.current.width / Math.max(1, fit.w) : 1;
      const half = ((isTouch ? 26 : 18) * scale) / 2;
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
    [isTouch, fit.w]
  );

  /** Resize a crop box while dragging one handle, honouring a locked aspect. */
  const resizeBox = (start: Box, handle: Handle, nx: number, ny: number): Box => {
    const ratio = aspectRef.current ? ASPECTS.find((a) => a.id === aspectRef.current)?.ratio ?? null : null;
    const minSize = (isTouch ? 44 : 24) * (canvasRef.current ? canvasRef.current.width / Math.max(1, fit.w) : 1);

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

    // Clamp into image bounds, keeping the fixed edge anchored.
    const imgW = imageRef.current.width;
    const imgH = imageRef.current.height;
    if (handle.includes("w")) {
      left = clamp(left, 0, fixedX - minSize);
      right = fixedX;
    }
    if (handle.includes("e")) {
      right = clamp(right, fixedX + minSize, imgW);
      left = fixedX;
    }
    if (handle.includes("n")) {
      top = clamp(top, 0, fixedY - minSize);
      bottom = fixedY;
    }
    if (handle.includes("s")) {
      bottom = clamp(bottom, fixedY + minSize, imgH);
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

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(e);
    if (!point) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();

    if (toolRef.current === "crop") {
      const handle = hitTestHandle(point.x, point.y, cropBoxRef.current);
      if (handle) {
        cropDragRef.current = { handle, startX: point.x, startY: point.y, box: cropBoxRef.current };
      } else if (
        point.x >= cropBoxRef.current.x &&
        point.x <= cropBoxRef.current.x + cropBoxRef.current.w &&
        point.y >= cropBoxRef.current.y &&
        point.y <= cropBoxRef.current.y + cropBoxRef.current.h
      ) {
        cropDragRef.current = { handle: "move", startX: point.x, startY: point.y, box: cropBoxRef.current };
      }
      return;
    }

    // Brush / blur stroke: snapshot once per stroke so undo steps are strokes.
    pushUndo();
    strokeRef.current = { x: point.x, y: point.y, drawing: true };

    if (toolRef.current === "blur") {
      // Prepare a blurred copy of the current canvas: stamping regions from it
      // into the main canvas smears/blurs whatever the brush passes over.
      const canvas = canvasRef.current;
      if (!canvas) return;
      const blurCanvas = document.createElement("canvas");
      blurCanvas.width = canvas.width;
      blurCanvas.height = canvas.height;
      const bctx = blurCanvas.getContext("2d");
      if (!bctx) return;
      bctx.filter = `blur(${Math.max(2, brushSizeRef.current * 0.6)}px)`;
      bctx.drawImage(canvas, 0, 0);
      blurCanvasRef.current = blurCanvas;
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

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(e);
    if (!point) return;

    if (toolRef.current === "crop") {
      const drag = cropDragRef.current;
      if (!drag) return;
      if (drag.handle === "move") {
        const dx = point.x - drag.startX;
        const dy = point.y - drag.startY;
        const imgW = imageRef.current.width;
        const imgH = imageRef.current.height;
        const box = drag.box;
        const x = clamp(box.x + dx, 0, imgW - box.w);
        const y = clamp(box.y + dy, 0, imgH - box.h);
        setCropBox({ x, y, w: box.w, h: box.h });
      } else {
        setCropBox(resizeBox(drag.box, drag.handle, point.x, point.y));
      }
      return;
    }

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

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
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
    const box = cropBoxRef.current;
    const imgW = imageRef.current.width;
    const imgH = imageRef.current.height;
    const ratio = ASPECTS.find((a) => a.id === id)?.ratio;
    if (!ratio) return;

    // Keep the current centre, grow/shrink to the largest box that fits.
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    let w = imgW;
    let h = imgH;
    if (ratio >= 1) {
      h = w / ratio;
      if (h > imgH) {
        h = imgH;
        w = h * ratio;
      }
    } else {
      w = h * ratio;
      if (w > imgW) {
        w = imgW;
        h = w / ratio;
      }
    }
    const x = clamp(cx - w / 2, 0, imgW - w);
    const y = clamp(cy - h / 2, 0, imgH - h);
    setCropBox({ x, y, w, h });
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
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;
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
    overlay.width = w;
    overlay.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(out, 0, 0, w, h);

    imageRef.current = { width: w, height: h };
    setCropBox(FULL_BOX(w, h));
    recalcFit();
    drawCropOverlay();
  }, [pushUndo, recalcFit, drawCropOverlay]);

  const handleApply = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onApply(canvas.toDataURL("image/png"));
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
        <div
          className="pe-frame"
          style={{ width: fit.w || undefined, height: fit.h || undefined }}
        >
          <canvas ref={canvasRef} className="pe-canvas" />
          <canvas
            ref={overlayRef}
            className="pe-canvas pe-overlay"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
        </div>
        {(tool === "brush" || tool === "blur") && ready && (
          <VerticalBrushSize
            value={brushSize}
            min={brushMin}
            max={brushMax}
            onChange={setBrushSize}
          />
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
          <>
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
              <button
                type="button"
                className="pe-apply-crop"
                onClick={applyCrop}
                disabled={!ready}
              >
                <Crop size={16} />
                Применить кадр
              </button>
            </div>
          </>
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
