import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Minus, Plus, RotateCcw } from "lucide-react";

interface AvatarCropperProps {
  imageSrc: string;
  onCropComplete: (croppedImage: string) => void;
  onCancel: () => void;
}

const OUTPUT_SIZE = 512;

type Point = { x: number; y: number };
type PointerMap = Map<number, Point>;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const AvatarCropper = ({ imageSrc, onCropComplete, onCancel }: AvatarCropperProps) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<Point | null>(null);
  const offsetStartRef = useRef<Point>({ x: 0, y: 0 });
  const pointersRef = useRef<PointerMap>(new Map());
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef(1);

  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [frameSize, setFrameSize] = useState(280);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isPinching, setIsPinching] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setNaturalSize({ width: img.width, height: img.height });
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    img.src = imageSrc;
  }, [imageSrc]);

  useEffect(() => {
    const updateSize = () => {
      if (!frameRef.current) return;
      setFrameSize(frameRef.current.clientWidth);
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  const baseScale = useMemo(() => {
    if (!naturalSize.width || !naturalSize.height || !frameSize) return 1;
    return Math.max(frameSize / naturalSize.width, frameSize / naturalSize.height);
  }, [naturalSize, frameSize]);

  const imageScale = baseScale * zoom;

  const maxOffset = useMemo(() => {
    if (!naturalSize.width || !naturalSize.height) return { x: 0, y: 0 };
    return {
      x: Math.max(0, (naturalSize.width * imageScale - frameSize) / 2),
      y: Math.max(0, (naturalSize.height * imageScale - frameSize) / 2),
    };
  }, [naturalSize, imageScale, frameSize]);

  const clampOffset = useCallback((next: Point) => ({
    x: clamp(next.x, -maxOffset.x, maxOffset.x),
    y: clamp(next.y, -maxOffset.y, maxOffset.y),
  }), [maxOffset.x, maxOffset.y]);

  useEffect(() => {
    setOffset((current) => clampOffset(current));
  }, [clampOffset]);

  useEffect(() => {
    if (!isDragging && !isPinching) return;

    const previousUserSelect = document.body.style.userSelect;
    const previousWebkitUserSelect = (document.body.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect;
    document.body.style.userSelect = "none";
    (document.body.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = "none";

    return () => {
      document.body.style.userSelect = previousUserSelect;
      (document.body.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = previousWebkitUserSelect;
    };
  }, [isDragging, isPinching]);

  const getDistance = (a: Point, b: Point) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!naturalSize.width || !naturalSize.height) return;
    event.preventDefault();
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);

    if (pointersRef.current.size === 2) {
      const [first, second] = Array.from(pointersRef.current.values());
      pinchStartDistanceRef.current = getDistance(first, second);
      pinchStartZoomRef.current = zoom;
      dragStartRef.current = null;
      setIsDragging(false);
      setIsPinching(true);
      return;
    }

    dragStartRef.current = { x: event.clientX, y: event.clientY };
    offsetStartRef.current = offset;
    setIsDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    event.preventDefault();
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 2) {
      const [first, second] = Array.from(pointersRef.current.values());
      const distance = getDistance(first, second);
      const pinchStartDistance = pinchStartDistanceRef.current;
      if (pinchStartDistance) {
        const nextZoom = clamp(pinchStartZoomRef.current * (distance / pinchStartDistance), 1, 3);
        setZoom(nextZoom);
      }
      setIsPinching(true);
      setIsDragging(false);
      return;
    }

    if (!isDragging || !dragStartRef.current) return;

    const deltaX = event.clientX - dragStartRef.current.x;
    const deltaY = event.clientY - dragStartRef.current.y;

    setOffset(clampOffset({
      x: offsetStartRef.current.x + deltaX,
      y: offsetStartRef.current.y + deltaY,
    }));
  };

  const finishDrag = (event?: React.PointerEvent<HTMLDivElement>) => {
    if (event) {
      pointersRef.current.delete(event.pointerId);
    }

    if (event && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (pointersRef.current.size >= 2) {
      const [first, second] = Array.from(pointersRef.current.values());
      pinchStartDistanceRef.current = getDistance(first, second);
      pinchStartZoomRef.current = zoom;
      setIsPinching(true);
      return;
    }

    if (pointersRef.current.size === 1) {
      const [remaining] = Array.from(pointersRef.current.values());
      dragStartRef.current = remaining;
      offsetStartRef.current = offset;
      pinchStartDistanceRef.current = null;
      setIsPinching(false);
      setIsDragging(true);
      return;
    }

    dragStartRef.current = null;
    pinchStartDistanceRef.current = null;
    setIsDragging(false);
    setIsPinching(false);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const nextZoom = clamp(zoom - event.deltaY * 0.0015, 1, 3);
    setZoom(nextZoom);
  };

  const handleReset = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const handleCrop = () => {
    if (!naturalSize.width || !naturalSize.height || !frameSize) return;

    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      const imageLeft = (frameSize - naturalSize.width * imageScale) / 2 + offset.x;
      const imageTop = (frameSize - naturalSize.height * imageScale) / 2 + offset.y;

      const sourceX = (0 - imageLeft) / imageScale;
      const sourceY = (0 - imageTop) / imageScale;
      const sourceWidth = frameSize / imageScale;
      const sourceHeight = frameSize / imageScale;

      ctx.save();
      ctx.beginPath();
      ctx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(
        img,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        OUTPUT_SIZE,
        OUTPUT_SIZE
      );
      ctx.restore();

      onCropComplete(canvas.toDataURL("image/png"));
    };
    img.src = imageSrc;
  };

  return (
    <div className="space-y-4">
      <div className="mx-auto w-full max-w-[22rem]">
        <div
          ref={frameRef}
          className="relative aspect-square w-full touch-none select-none overflow-hidden border border-border bg-black/80"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onWheel={handleWheel}
          style={{ cursor: isDragging ? "grabbing" : "grab", userSelect: "none", WebkitUserSelect: "none" }}
        >
          <img
            src={imageSrc}
            alt="Предпросмотр аватара"
            draggable={false}
            className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
            style={{
              width: naturalSize.width || "auto",
              height: naturalSize.height || "auto",
              transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${imageScale})`,
              transformOrigin: "center center",
            }}
          />

          <div className="pointer-events-none absolute inset-0 bg-black/45" />
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 rounded-full border border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
            style={{
              width: frameSize,
              height: frameSize,
              transform: "translate(-50%, -50%)",
            }}
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" size="icon" onClick={() => setZoom((current) => clamp(current - 0.1, 1, 3))}>
            <Minus className="h-4 w-4" />
          </Button>
          <Slider
            value={[zoom]}
            min={1}
            max={3}
            step={0.01}
            onValueChange={(value) => setZoom(value[0] ?? 1)}
          />
          <Button type="button" variant="outline" size="icon" onClick={() => setZoom((current) => clamp(current + 0.1, 1, 3))}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Перетащите изображение</span>
          <span>Масштаб {zoom.toFixed(2)}x</span>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" onClick={onCancel} variant="outline" className="flex-1">
          Отмена
        </Button>
        <Button type="button" onClick={handleReset} variant="secondary" className="flex-1">
          <RotateCcw className="mr-2 h-4 w-4" />
          Сбросить
        </Button>
        <Button type="button" onClick={handleCrop} className="flex-1">
          Сохранить
        </Button>
      </div>
    </div>
  );
};
