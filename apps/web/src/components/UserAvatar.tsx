import { useState } from "react";
import { User } from "lucide-react";
import { storageUrl } from "@/utils/storage";
import { AnimatedVideo } from "@/components/AnimatedVideo";
import "./UserAvatar.css";

export type UserAvatarProps = {
  /** Storage key or absolute URL. */
  src?: string | null;
  alt?: string;
  /** Size/shape classes for the container (e.g. "h-10 w-10"). */
  className?: string;
  /** Explicit animated flag (from `avatar_animated`); falls back to the URL. */
  animated?: boolean;
  /** Storage bucket; defaults to post-images. */
  bucket?: string;
  /** Square instead of a circle. */
  square?: boolean;
};

/** A video avatar key ends in .mp4/.webm; its poster is `<key>.poster.jpg`. */
export function isAnimatedAvatarUrl(url: string): boolean {
  return /\.(mp4|webm)(\?|#|$)/i.test(url);
}

/**
 * The one place user avatars render. An animated avatar (soundless short clip)
 * autoplays and loops through AnimatedVideo; everything else is a plain image.
 * The poster is derived from the URL, so no extra column is needed.
 */
export function UserAvatar({
  src,
  alt = "",
  className,
  animated,
  bucket = "post-images",
  square = false,
}: UserAvatarProps) {
  const [failed, setFailed] = useState(false);
  const url = src ? storageUrl(bucket, src) || src : null;
  const isAnimated = Boolean(url && (animated ?? isAnimatedAvatarUrl(url)));

  const containerClass = `user-avatar${square ? "" : " user-avatar--round"}${className ? ` ${className}` : ""}`;

  if (!url) {
    return (
      <span className={containerClass}>
        <User className="user-avatar-icon" aria-hidden="true" />
      </span>
    );
  }

  if (isAnimated) {
    return (
      <span className={containerClass}>
        <AnimatedVideo
          src={url}
          poster={`${url}.poster.jpg`}
          fill
          interactive={false}
          ariaLabel={alt || undefined}
        />
      </span>
    );
  }

  return (
    <span className={containerClass}>
      {failed ? (
        <User className="user-avatar-icon" aria-hidden="true" />
      ) : (
        <img
          className="user-avatar-img"
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

export default UserAvatar;
