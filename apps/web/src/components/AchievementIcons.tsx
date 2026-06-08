import { cn } from "@/lib/utils";
import { useId } from "react";

interface IconProps {
  className?: string;
  size?: number;
}

/**
 * MessageSquare — Posts achievement
 */
export function IconMessageSquare({ className, size = 24 }: IconProps) {
  const gid = useId().replace(/:/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("text-sky-400", className)}
    >
      <defs>
        <linearGradient id={`msg-${gid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#818cf8" />
        </linearGradient>
      </defs>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke={`url(#msg-${gid})`} />
      <path d="M8 9h8" stroke={`url(#msg-${gid})`} opacity={0.7} />
      <path d="M8 13h5" stroke={`url(#msg-${gid})`} opacity={0.4} />
    </svg>
  );
}

/**
 * Layers — Threads achievement
 */
export function IconLayers({ className, size = 24 }: IconProps) {
  const gid = useId().replace(/:/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("text-emerald-400", className)}
    >
      <defs>
        <linearGradient id={`layers-${gid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#2dd4bf" />
        </linearGradient>
      </defs>
      <polygon points="12 2 22 8.5 12 15 2 8.5 12 2" stroke={`url(#layers-${gid})`} />
      <polyline points="2 15.5 12 22 22 15.5" stroke={`url(#layers-${gid})`} opacity={0.5} />
    </svg>
  );
}

/**
 * Heart — Likes received achievement
 */
export function IconHeart({ className, size = 24 }: IconProps) {
  const gid = useId().replace(/:/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("text-rose-400", className)}
    >
      <defs>
        <linearGradient id={`heart-${gid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fb7185" />
          <stop offset="100%" stopColor="#f43f5e" />
        </linearGradient>
      </defs>
      <path
        d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"
        stroke={`url(#heart-${gid})`}
      />
    </svg>
  );
}

/**
 * ThumbsUp — Likes given achievement
 */
export function IconThumbsUp({ className, size = 24 }: IconProps) {
  const gid = useId().replace(/:/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("text-amber-400", className)}
    >
      <defs>
        <linearGradient id={`thumb-${gid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <path d="M7 10v12" stroke={`url(#thumb-${gid})`} />
      <path
        d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"
        stroke={`url(#thumb-${gid})`}
      />
    </svg>
  );
}

/**
 * Image — Images achievement
 */
export function IconImageIcon({ className, size = 24 }: IconProps) {
  const gid = useId().replace(/:/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("text-purple-400", className)}
    >
      <defs>
        <linearGradient id={`image-${gid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c084fc" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" stroke={`url(#image-${gid})`} />
      <circle cx="9" cy="9" r="2" stroke={`url(#image-${gid})`} opacity={0.7} />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" stroke={`url(#image-${gid})`} opacity={0.4} />
    </svg>
  );
}

/**
 * Camera — Avatar achievement
 */
export function IconCamera({ className, size = 24 }: IconProps) {
  const gid = useId().replace(/:/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("text-indigo-400", className)}
    >
      <defs>
        <linearGradient id={`camera-${gid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <path
        d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"
        stroke={`url(#camera-${gid})`}
      />
      <circle cx="12" cy="13" r="3" stroke={`url(#camera-${gid})`} opacity={0.7} />
    </svg>
  );
}

/**
 * FileText — Bio achievement
 */
export function IconFileText({ className, size = 24 }: IconProps) {
  const gid = useId().replace(/:/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("text-teal-400", className)}
    >
      <defs>
        <linearGradient id={`file-${gid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2dd4bf" />
          <stop offset="100%" stopColor="#14b8a6" />
        </linearGradient>
      </defs>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" stroke={`url(#file-${gid})`} />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" stroke={`url(#file-${gid})`} opacity={0.5} />
      <path d="M10 9H8" stroke={`url(#file-${gid})`} opacity={0.7} />
      <path d="M16 13H8" stroke={`url(#file-${gid})`} opacity={0.4} />
      <path d="M16 17H8" stroke={`url(#file-${gid})`} opacity={0.3} />
    </svg>
  );
}

/**
 * Palette — Style/Customization achievement
 */
export function IconPalette({ className, size = 24 }: IconProps) {
  const gid = useId().replace(/:/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("text-pink-400", className)}
    >
      <defs>
        <linearGradient id={`palette-${gid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f472b6" />
          <stop offset="50%" stopColor="#c084fc" />
          <stop offset="100%" stopColor="#818cf8" />
        </linearGradient>
      </defs>
      <circle cx="13.5" cy="6.5" r="0.5" fill={`url(#palette-${gid})`} stroke="none" />
      <circle cx="17.5" cy="10.5" r="0.5" fill={`url(#palette-${gid})`} stroke="none" />
      <circle cx="8.5" cy="7.5" r="0.5" fill={`url(#palette-${gid})`} stroke="none" />
      <circle cx="6.5" cy="12.5" r="0.5" fill={`url(#palette-${gid})`} stroke="none" />
      <path
        d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"
        stroke={`url(#palette-${gid})`}
      />
    </svg>
  );
}

/**
 * Sparkles — Secret achievement
 */
export function IconSparkles({ className, size = 24 }: IconProps) {
  const gid = useId().replace(/:/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("text-amber-400", className)}
    >
      <defs>
        <linearGradient id={`sparkle-${gid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="50%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#fbbf24" />
        </linearGradient>
      </defs>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z" stroke={`url(#sparkle-${gid})`} />
    </svg>
  );
}

/**
 * Zap — Secret posts achievement
 */
export function IconZap({ className, size = 24 }: IconProps) {
  const gid = useId().replace(/:/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("text-yellow-400", className)}
    >
      <defs>
        <linearGradient id={`zap-${gid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#facc15" />
          <stop offset="100%" stopColor="#f97316" />
        </linearGradient>
      </defs>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" stroke={`url(#zap-${gid})`} />
    </svg>
  );
}

/**
 * Map icon name string to component
 */
export const ACHIEVEMENT_ICONS: Record<string, React.FC<IconProps>> = {
  "message-square": IconMessageSquare,
  layers: IconLayers,
  heart: IconHeart,
  "thumbs-up": IconThumbsUp,
  image: IconImageIcon,
  camera: IconCamera,
  "file-text": IconFileText,
  palette: IconPalette,
  sparkles: IconSparkles,
  zap: IconZap,
};

/**
 * Get the correct icon component, falling back to Sparkles
 */
export function getAchievementIcon(iconName: string): React.FC<IconProps> {
  return ACHIEVEMENT_ICONS[iconName] || IconSparkles;
}
