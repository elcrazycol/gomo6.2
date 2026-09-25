// "Before / after" comparison slider for a mediaGroup with exactly two photos.
//
// The first photo is the "before" layer (bottom), the second is the "after"
// layer (top) clipped to the region right of the handle. Dragging the handle
// (pointer, touch, or keyboard) moves the divider. Shared by the read renderer
// and the editor NodeView, so the published post and the editor behave alike.

import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { ChevronsLeftRight } from "lucide-react";

const clampPosition = (value: number): number => Math.min(100, Math.max(0, value));

export interface CompareHandleProps {
  /** Divider position as a percentage (0 = all "after", 100 = all "before"). */
  position: number;
  onPositionChange: (position: number) => void;
  /** Resolves the element whose box maps pointer X to the divider position. */
  getContainer: () => HTMLElement | null;
}

/** The draggable divider plus the "До"/"После" labels. */
export const CompareHandle = ({ position, onPositionChange, getContainer }: CompareHandleProps) => {
  const draggingRef = useRef(false);

  const updateFromClientX = useCallback(
    (clientX: number) => {
      const container = getContainer();
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      onPositionChange(clampPosition(((clientX - rect.left) / rect.width) * 100));
    },
    [getContainer, onPositionChange],
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType !== "touch") return;
    event.preventDefault();
    event.stopPropagation();
    draggingRef.current = true;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic or already-released pointers cannot be captured — the drag
      // still works through the element's own move events.
    }
    updateFromClientX(event.clientX);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    event.preventDefault();
    updateFromClientX(event.clientX);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture may already be gone (e.g. pointercancel) — ignore.
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onPositionChange(clampPosition(position - 2));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onPositionChange(clampPosition(position + 2));
    } else if (event.key === "Home") {
      event.preventDefault();
      onPositionChange(0);
    } else if (event.key === "End") {
      event.preventDefault();
      onPositionChange(100);
    }
  };

  return (
    <>
      <span className="media-compare-label media-compare-label--before" aria-hidden="true">
        До
      </span>
      <span className="media-compare-label media-compare-label--after" aria-hidden="true">
        После
      </span>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Сравнение «до» и «после»"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(position)}
        aria-orientation="horizontal"
        className="media-compare-handle"
        style={{ left: `${position}%` }}
        contentEditable={false}
        data-compare-handle="true"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        <span className="media-compare-grip" aria-hidden="true">
          <ChevronsLeftRight className="h-4 w-4" />
        </span>
      </div>
    </>
  );
};

export interface CompareGalleryProps {
  /** The two rendered media items (before first, after second). */
  children: ReactNode;
  /** Aspect ratio (w/h) of the first photo, so the frame does not jump. */
  aspectRatio?: number | null;
}

/** Read-view wrapper: owns the position state and the clipping container. */
export const CompareGallery = ({ children, aspectRatio }: CompareGalleryProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState(50);
  const getContainer = useCallback(() => containerRef.current, []);

  const style = {
    aspectRatio: aspectRatio && aspectRatio > 0 ? String(aspectRatio) : undefined,
    "--compare-pos": `${position}%`,
  } as CSSProperties;

  return (
    <div className="media-compare-wrap" data-compare-wrapper="true">
      <div
        ref={containerRef}
        data-media-group="true"
        data-compare="true"
        className="media-group media-group--compare"
        style={style}
      >
        {children}
      </div>
      <CompareHandle position={position} onPositionChange={setPosition} getContainer={getContainer} />
    </div>
  );
};
