import { Loader2 } from "lucide-react";
import type { AttachmentUploadPhase } from "@/utils/mediaUpload";
import "./SquareUploadProgress.css";

export type SquareUploadProgressProps = {
  /** Upload progress, 0..100. */
  percent: number;
  /** "upload" (bytes leaving), "processing" (server transcode) or "done". */
  phase?: AttachmentUploadPhase;
  className?: string;
};

// The frame hugs the tile: a rounded square inset by a few units.
const INSET = 3;
const RADIUS = 12;

// Perimeter of the rounded square (used to drive the dash offset). Four
// straight edges + four quarter-circle corners.
const STRAIGHT = 100 - 2 * INSET - 2 * RADIUS;
const PERIMETER = 4 * STRAIGHT + 2 * Math.PI * RADIUS;

// One continuous path, starting at the middle of the bottom edge and running
// clockwise (bottom → left → top → right), so the scale fills the same way the
// avatar ring does.
const FRAME_PATH =
  `M 50 ${100 - INSET} L ${INSET + RADIUS} ${100 - INSET} ` +
  `A ${RADIUS} ${RADIUS} 0 0 1 ${INSET} ${100 - INSET - RADIUS} ` +
  `L ${INSET} ${INSET + RADIUS} A ${RADIUS} ${RADIUS} 0 0 1 ${INSET + RADIUS} ${INSET} ` +
  `L ${100 - INSET - RADIUS} ${INSET} A ${RADIUS} ${RADIUS} 0 0 1 ${100 - INSET} ${INSET + RADIUS} ` +
  `L ${100 - INSET} ${100 - INSET - RADIUS} ` +
  `A ${RADIUS} ${RADIUS} 0 0 1 ${100 - INSET - RADIUS} ${100 - INSET} ` +
  `L 50 ${100 - INSET}`;

/**
 * Determinate upload indicator for square media tiles: a frame that fills
 * clockwise from the middle of the bottom edge up to the real upload
 * percentage, with a spinner (and the live percent) in the middle. While the
 * server transcodes a video the percent is dropped — the frame sits complete
 * and only the spinner keeps moving.
 */
export function SquareUploadProgress({ percent, phase, className }: SquareUploadProgressProps) {
  const clamped = Math.min(100, Math.max(0, percent));
  const dashOffset = PERIMETER * (1 - clamped / 100);

  return (
    <div
      className={`square-upload-progress${className ? ` ${className}` : ""}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
    >
      <svg className="square-upload-progress-ring" viewBox="0 0 100 100" aria-hidden="true">
        <path className="square-upload-progress-track" d={FRAME_PATH} />
        <path
          className="square-upload-progress-arc"
          d={FRAME_PATH}
          strokeDasharray={PERIMETER}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="square-upload-progress-center">
        <Loader2 className="square-upload-progress-spinner" aria-hidden="true" />
        {phase !== "processing" && (
          <span className="square-upload-progress-percent">{Math.round(clamped)}%</span>
        )}
      </div>
    </div>
  );
}

export default SquareUploadProgress;
