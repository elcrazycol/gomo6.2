import type { ReactNode } from "react";
import { useFileDrop } from "@/hooks/useFileDrop";

interface FileDropZoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
  /**
   * Renders the zone content. The flag flips while a file drag hovers the
   * zone, so callers can swap labels/classes. Keep the swap to class or text
   * changes only — mounting/unmounting elements under the pointer can produce
   * dragenter/dragleave loops.
   */
  children: (isDragging: boolean) => ReactNode;
}

/**
 * Wraps any upload UI with drag & drop support. While a file drag hovers the
 * zone it renders a primary ring + tint; on drop the files are handed to
 * `onFiles`. The wrapper itself is not positioned, so it never changes the
 * anchoring of absolutely positioned children.
 */
export const FileDropZone = ({ onFiles, disabled = false, className = "", children }: FileDropZoneProps) => {
  const { isDragging, dragHandlers } = useFileDrop(onFiles);

  return (
    <div
      {...(disabled ? {} : dragHandlers)}
      className={`rounded-xl transition-[background-color,box-shadow] duration-150 ${
        isDragging && !disabled ? "bg-primary/5 ring-2 ring-primary/50 ring-offset-2 ring-offset-background" : ""
      } ${disabled ? "pointer-events-none opacity-60" : ""} ${className}`}
    >
      {children(isDragging)}
    </div>
  );
};
