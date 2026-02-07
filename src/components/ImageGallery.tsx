import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { X, ChevronLeft, ChevronRight, Scissors, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ImageGalleryProps {
  images: string[];
  initialIndex?: number;
  onClose: () => void;
  onEditImage?: (index: number, dataUrl: string) => void;
}

type Tool = "crop" | "epstein";
type Box = { x: number; y: number; w: number; h: number };
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const ImageGallery = ({ images, initialIndex = 0, onClose, onEditImage }: ImageGalleryProps) => {
  const [localImages, setLocalImages] = useState(images);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [tool, setTool] = useState<Tool>("crop");
  const [redacts, setRedacts] = useState<Box[]>([]);
  const [cropBox, setCropBox] = useState<Box>({ x: 0, y: 0, w: 1, h: 1 });
  const [draftRedact, setDraftRedact] = useState<Box | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [renderRect, setRenderRect] = useState<Box | null>(null);
  const activeHandleRef = useRef<Handle | null>(null);
  const cropStartRef = useRef<{ x: number; y: number; box: Box } | null>(null);
  const redactStartRef = useRef<{ x: number; y: number } | null>(null);
  const isTouch = useMemo(
    () => typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0),
    []
  );

  useEffect(() => {
    setCurrentIndex(initialIndex);
    setLocalImages(images);
  }, [initialIndex, images]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft") {
        handlePrevious();
      } else if (e.key === "ArrowRight") {
        handleNext();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    // Try to enter fullscreen on mobile
    const enterFullscreen = async () => {
      try {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
          setIsFullscreen(true);
        }
      } catch (error) {
        // Fallback: just make it full viewport
        setIsFullscreen(true);
      }
    };

    // Check if mobile device
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) {
      enterFullscreen();
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    };
  }, [currentIndex]);

  useEffect(() => {
    refreshRenderRect();
    const handleResize = () => refreshRenderRect();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [currentIndex, images, isFullscreen, isEditing, showControls, isTouch]);

  const handlePrevious = () => {
    setCurrentIndex((prev) => (prev === 0 ? localImages.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev === localImages.length - 1 ? 0 : prev + 1));
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (isEditing) return;
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isEditing) return;
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const handleTouchEnd = () => {
    if (isEditing) return;
    if (!touchStart || !touchEnd) return;

    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > 50;
    const isRightSwipe = distance < -50;

    if (isLeftSwipe) {
      handleNext();
    } else if (isRightSwipe) {
      handlePrevious();
    }
  };

  const handleImageClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowControls(!showControls);
  };

  const activeImages = useMemo(() => localImages, [localImages]);

  if (activeImages.length === 0) return null;

  const currentSrc = activeImages[currentIndex];

  const computeRenderRect = () => {
    if (!containerRef.current || !imgRef.current) return null;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const iw = imgRef.current.naturalWidth;
    const ih = imgRef.current.naturalHeight;
    if (!iw || !ih) return null;
    const topInset = isEditing && showControls ? (isTouch ? 120 : 80) : 0;
    const availableHeight = Math.max(1, ch - topInset);
    const scale = Math.min(cw / iw, availableHeight / ih);
    const w = iw * scale;
    const h = ih * scale;
    const x = (cw - w) / 2;
    const y = topInset + (availableHeight - h) / 2;
    return { x, y, w, h };
  };

  const refreshRenderRect = () => {
    const rect = computeRenderRect();
    if (rect) {
      setRenderRect(rect);
    }
  };

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

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
      if (dx * dx + dy * dy <= radiusSq) {
        return handle.id;
      }
    }
    return null;
  };

  const drawEditor = useCallback(() => {
    if (!isEditing) return;
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
    } else if (tool === "epstein") {
      ctx.fillStyle = "#000";
      redacts.forEach((r) => {
        ctx.fillRect(r.x * width, r.y * height, r.w * width, r.h * height);
      });
      if (draftRedact) {
        ctx.fillRect(
          draftRedact.x * width,
          draftRedact.y * height,
          draftRedact.w * width,
          draftRedact.h * height
        );
      }
    }
  }, [cropBox, currentSrc, draftRedact, isEditing, isTouch, redacts, renderRect, tool]);

  useEffect(() => {
    drawEditor();
  }, [drawEditor]);

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
        image.src = currentSrc;
        await image.decode();
        ctx.drawImage(image, x1, y1, w, h, 0, 0, w, h);
      } else {
        canvas.width = naturalWidth;
        canvas.height = naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.src = currentSrc;
        await image.decode();
        ctx.drawImage(image, 0, 0, naturalWidth, naturalHeight);
        const allRedacts = draftRedact ? [...redacts, draftRedact] : redacts;
        allRedacts.forEach((r) => {
          ctx.fillStyle = "rgba(0,0,0,1)";
          ctx.fillRect(
            r.x * naturalWidth,
            r.y * naturalHeight,
            r.w * naturalWidth,
            r.h * naturalHeight
          );
        });
      }

      const dataUrl = canvas.toDataURL("image/png");
      setLocalImages((imgs) =>
        imgs.map((img, idx) => (idx === currentIndex ? dataUrl : img))
      );
      onEditImage?.(currentIndex, dataUrl);
      setIsEditing(false);
      setRedacts([]);
      setDraftRedact(null);
      activeHandleRef.current = null;
      cropStartRef.current = null;
      redactStartRef.current = null;
    } catch (e) {
      console.error("Edit failed", e);
    }
  };

  const resetEdit = () => {
    setIsEditing(false);
    setRedacts([]);
    setDraftRedact(null);
    setCropBox({ x: 0, y: 0, w: 1, h: 1 });
    activeHandleRef.current = null;
    cropStartRef.current = null;
    redactStartRef.current = null;
  };

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

  return (
    <div
      className={cn(
        "fixed z-50 bg-black flex items-center justify-center",
        isFullscreen ? "inset-0" : "inset-0 bg-black/80 backdrop-blur-md"
      )}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isEditing) onClose();
      }}
    >
      {/* Close button */}
      {showControls && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-4 right-4 z-10 text-white hover:bg-white/20"
          onClick={(e) => {
            e.stopPropagation();
            if (!isEditing) onClose();
          }}
        >
          <X className="h-6 w-6" />
        </Button>
      )}

      {/* Previous button */}
      {activeImages.length > 1 && showControls && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-4 z-10 text-white hover:bg-white/20 hidden sm:flex"
          onClick={(e) => {
            e.stopPropagation();
            handlePrevious();
          }}
        >
          <ChevronLeft className="h-8 w-8" />
        </Button>
      )}

      {/* Main image */}
      <div
        ref={containerRef}
        className={cn(
          "relative flex items-center justify-center",
          isFullscreen ? "w-full h-full" : "max-w-[90vw] max-h-[85vh]"
        )}
        onClick={isEditing ? undefined : handleImageClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <img
          ref={imgRef}
          src={currentSrc}
          alt={`Image ${currentIndex + 1}`}
          className={cn(
            "object-contain",
            isFullscreen ? "w-full h-full" : "max-w-full max-h-[85vh] rounded-lg",
            isEditing ? "opacity-0 pointer-events-none" : "opacity-100"
          )}
          draggable={false}
          onLoad={refreshRenderRect}
        />

        {isEditing && renderRect && (
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

      {/* Next button */}
      {activeImages.length > 1 && showControls && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-4 z-10 text-white hover:bg-white/20 hidden sm:flex"
          onClick={(e) => {
            e.stopPropagation();
            handleNext();
          }}
        >
          <ChevronRight className="h-8 w-8" />
        </Button>
      )}

      {/* Thumbnails */}
      {activeImages.length > 1 && showControls && (
        <div
          className="absolute bottom-4 left-0 right-0 flex justify-center gap-2 px-4 overflow-x-auto pb-2"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex gap-2 max-w-full">
            {activeImages.map((img, index) => (
              <button
                key={index}
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentIndex(index);
                }}
                className={cn(
                  "flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded border-2 overflow-hidden transition-all",
                  currentIndex === index
                    ? "border-white scale-110"
                    : "border-white/30 hover:border-white/60"
                )}
              >
                <img
                  src={img}
                  alt={`Thumbnail ${index + 1}`}
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Image counter */}
      {activeImages.length > 1 && showControls && (
        <div className="absolute top-4 left-4 z-10 text-white/80 text-sm bg-black/50 px-3 py-1 rounded">
          {currentIndex + 1} / {activeImages.length}
        </div>
      )}

      {/* Edit toolbar */}
      {showControls && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex flex-wrap sm:flex-nowrap gap-2 bg-black/40 backdrop-blur px-3 py-2 rounded-2xl max-w-[92vw] justify-center">
          <Button
            variant={isEditing && tool === "crop" ? "default" : "ghost"}
            size="sm"
            className="h-8 px-3 text-white"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
              setTool("crop");
              setRedacts([]);
              setDraftRedact(null);
              setCropBox({ x: 0, y: 0, w: 1, h: 1 });
              activeHandleRef.current = null;
              cropStartRef.current = null;
              redactStartRef.current = null;
            }}
          >
            <Scissors className="w-4 h-4 mr-1" /> Кадрировать
          </Button>
          <Button
            variant={isEditing && tool === "epstein" ? "default" : "ghost"}
            size="sm"
            className="h-8 px-3 text-white"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
              setTool("epstein");
              setDraftRedact(null);
              activeHandleRef.current = null;
              cropStartRef.current = null;
              redactStartRef.current = null;
            }}
          >
            <Square className="w-4 h-4 mr-1" /> Epstein
          </Button>
          {isEditing && (
            <div className="flex w-full sm:w-auto gap-2 justify-center">
              <Button
                variant="secondary"
                size="sm"
                className="h-8 px-3"
                onClick={(e) => {
                  e.stopPropagation();
                  applyEdit();
                }}
              >
                Применить
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-3 text-white"
                onClick={(e) => {
                  e.stopPropagation();
                  resetEdit();
                }}
              >
                Отмена
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
