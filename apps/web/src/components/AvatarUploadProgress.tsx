import { useTranslation } from "react-i18next";
import "./AvatarUploadProgress.css";

export type AvatarUploadProgressProps = {
  /** Upload progress, 0..100. */
  percent: number;
  className?: string;
};

const RADIUS = 46;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const SPINNER_RADIUS = 19;
const SPINNER_CIRCUMFERENCE = 2 * Math.PI * SPINNER_RADIUS;

/**
 * Avatar upload indicator: a determinate ring that fills clockwise from the
 * bottom of the circle and a spinner in the middle. Rendered on top of the
 * optimistically shown new avatar; the ring reaches its starting point exactly
 * when the upload finishes.
 */
export function AvatarUploadProgress({ percent, className }: AvatarUploadProgressProps) {
  const { t } = useTranslation();
  const clamped = Math.min(100, Math.max(0, percent));
  const dashOffset = CIRCUMFERENCE * (1 - clamped / 100);

  return (
    <div
      className={`avatar-upload-progress${className ? ` ${className}` : ""}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={t("profile.uploadingAvatar")}
    >
      <svg className="avatar-upload-progress-ring" viewBox="0 0 100 100" aria-hidden="true">
        <circle className="avatar-upload-progress-track" cx="50" cy="50" r={RADIUS} />
        <circle
          className="avatar-upload-progress-arc"
          cx="50"
          cy="50"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <svg className="avatar-upload-progress-spinner" viewBox="0 0 50 50" aria-hidden="true">
        <circle
          cx="25"
          cy="25"
          r={SPINNER_RADIUS}
          strokeDasharray={`${SPINNER_CIRCUMFERENCE * 0.28} ${SPINNER_CIRCUMFERENCE}`}
        />
      </svg>
    </div>
  );
}

export default AvatarUploadProgress;
