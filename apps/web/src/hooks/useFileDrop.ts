import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shared drag & drop state for file upload zones.
 *
 * - Tracks whether a file drag is currently over the target (depth counter
 *   absorbs dragenter/dragleave noise from child elements).
 * - Only reacts to drags that actually carry files (text/image selections are
 *   ignored), so the zone never hijacks normal drag interactions.
 * - Resets itself when a drag is cancelled mid-flight (Esc, window blur, …).
 */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);

  // Safety net: a drag cancelled outside the zone (Esc, dropping elsewhere)
  // may skip the final dragleave — always reset on dragend.
  useEffect(() => {
    const reset = () => {
      dragDepth.current = 0;
      setIsDragging(false);
    };
    window.addEventListener("dragend", reset);
    return () => window.removeEventListener("dragend", reset);
  }, []);

  const hasFiles = useCallback((e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes("Files"), []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  }, [hasFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, [hasFiles]);

  const handleDragLeave = useCallback(() => {
    // Decrement unconditionally — dataTransfer.types can be transiently empty
    // on dragleave, and the overlay must never get stuck.
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // Stop propagation so nested drop zones never double-handle the same drop
    // (e.g. a card-wide zone wrapping a component that keeps its own zone).
    e.stopPropagation();
    dragDepth.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onFiles(files);
  }, [onFiles]);

  return {
    isDragging,
    dragHandlers: {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  };
}
