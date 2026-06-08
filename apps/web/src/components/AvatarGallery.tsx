import { useState, useEffect, useCallback, useRef } from "react";
import { X, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface AvatarGalleryProps {
  avatars: Array<{ id: string; url: string; is_current: boolean }>;
  initialIndex?: number;
  onClose: () => void;
  onDelete?: (avatarId: string) => Promise<void>;
  canDelete?: boolean;
}

const SWIPE_THRESHOLD = 60;

export const AvatarGallery = ({
  avatars,
  initialIndex = 0,
  onClose,
  onDelete,
  canDelete = false
}: AvatarGalleryProps) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [direction, setDirection] = useState<"left" | "right" | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const touchCurrentX = useRef<number | null>(null);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goTo = useCallback(
    (index: number, dir?: "left" | "right") => {
      if (isAnimating || avatars.length <= 1) return;
      setIsAnimating(true);
      setDirection(dir || (index > currentIndex ? "left" : "right"));
      setCurrentIndex(index);

      // Reset animation state after transition
      setTimeout(() => {
        setIsAnimating(false);
        setDirection(null);
      }, 250);
    },
    [isAnimating, avatars.length, currentIndex]
  );

  const handlePrevious = useCallback(() => {
    const next = currentIndex === 0 ? avatars.length - 1 : currentIndex - 1;
    goTo(next, "right");
  }, [currentIndex, avatars.length, goTo]);

  const handleNext = useCallback(() => {
    const next = currentIndex === avatars.length - 1 ? 0 : currentIndex + 1;
    goTo(next, "left");
  }, [currentIndex, avatars.length, goTo]);

  // Reset index when initialIndex changes
  useEffect(() => {
    setCurrentIndex(initialIndex);
  }, [initialIndex]);

  // Keyboard navigation
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
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, handlePrevious, handleNext]);

  // Lock body scroll
  useEffect(() => {
    const scrollY = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.width = "";
      document.body.style.overflow = "";
      window.scrollTo(0, scrollY);
    };
  }, []);

  // Auto-hide controls after inactivity
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setShowControls(false), 3000);
  }, []);

  useEffect(() => {
    resetControlsTimer();
    return () => {
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
    };
  }, [currentIndex, resetControlsTimer]);

  // Touch handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.targetTouches[0].clientX;
    touchStartY.current = e.targetTouches[0].clientY;
    touchCurrentX.current = e.targetTouches[0].clientX;
    resetControlsTimer();
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchCurrentX.current = e.targetTouches[0].clientX;
  };

  const handleTouchEnd = () => {
    const startX = touchStartX.current;
    const endX = touchCurrentX.current;
    if (startX === null || endX === null) return;

    const dx = startX - endX;
    const dy = Math.abs((touchStartY.current || 0) - (touchCurrentX.current === startX ? 0 : touchCurrentX.current || 0));

    // Only swipe if horizontal movement dominates
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > dy) {
      if (dx > 0) {
        handleNext();
      } else {
        handlePrevious();
      }
    }

    touchStartX.current = null;
    touchStartY.current = null;
    touchCurrentX.current = null;
  };

  const handleImageClick = () => {
    resetControlsTimer();
  };

  const handleDeleteClick = () => {
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = async () => {
    if (!onDelete || !canDelete) return;
    const currentAvatar = avatars[currentIndex];
    if (!currentAvatar?.id) return;

    setIsDeleting(true);
    try {
      await onDelete(currentAvatar.id);
      if (avatars.length === 1) {
        onClose();
      } else if (currentIndex >= avatars.length - 1) {
        setCurrentIndex(Math.max(0, currentIndex - 1));
      }
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  const currentAvatar = avatars[currentIndex];

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {/* Top bar */}
        <div
          className={cn(
            "absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3 py-3 sm:px-4 sm:py-4 transition-opacity duration-300",
            showControls ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
        >
          {/* Counter */}
          <div className="text-white/70 text-sm sm:text-base font-medium tabular-nums">
            {currentIndex + 1} / {avatars.length}
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-1">
            {canDelete && onDelete && (
              <button
                className="w-10 h-10 flex items-center justify-center rounded-full text-white/60 hover:text-red-400 hover:bg-white/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteClick();
                }}
                disabled={isDeleting}
                aria-label="Удалить аватар"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            )}
            <button
              className="w-10 h-10 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              aria-label="Закрыть"
            >
              <X className="h-6 w-6" />
            </button>
          </div>
        </div>

        {/* Main image area */}
        <div
          className="relative w-full flex-1 flex items-center justify-center overflow-hidden"
          onClick={handleImageClick}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Navigation arrows */}
          {avatars.length > 1 && (
            <>
              <button
                className={cn(
                  "absolute left-2 sm:left-4 z-10 w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm transition-all duration-300",
                  showControls ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-4"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  handlePrevious();
                }}
                aria-label="Предыдущий"
              >
                <ChevronLeft className="h-5 w-5 sm:h-6 sm:w-6" />
              </button>
              <button
                className={cn(
                  "absolute right-2 sm:right-4 z-10 w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm transition-all duration-300",
                  showControls ? "opacity-100 translate-x-0" : "opacity-0 translate-x-4"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  handleNext();
                }}
                aria-label="Следующий"
              >
                <ChevronRight className="h-5 w-5 sm:h-6 sm:w-6" />
              </button>
            </>
          )}

          {/* Image with smooth transition */}
          <div className="relative w-full h-full flex items-center justify-center px-12 sm:px-16">
            {currentAvatar?.url ? (
              <img
                key={currentIndex}
                src={currentAvatar.url}
                alt={`Аватар ${currentIndex + 1}`}
                className={cn(
                  "max-w-full max-h-[80vh] object-contain select-none",
                  direction === "left" ? "animate-slide-in-right" : direction === "right" ? "animate-slide-in-left" : ""
                )}
                draggable={false}
              />
            ) : (
              <div className="w-64 h-64 rounded-full bg-white/5 flex items-center justify-center">
                <span className="text-white/20 text-6xl">?</span>
              </div>
            )}
          </div>
        </div>

        {/* Dot indicators (Telegram-style) */}
        {avatars.length > 1 && (
          <div
            className={cn(
              "absolute bottom-8 left-0 right-0 z-20 flex justify-center gap-2 transition-opacity duration-300",
              showControls ? "opacity-100" : "opacity-0"
            )}
          >
            {avatars.map((_, index) => (
              <button
                key={index}
                onClick={(e) => {
                  e.stopPropagation();
                  if (index !== currentIndex) goTo(index, index > currentIndex ? "left" : "right");
                }}
                className={cn(
                  "rounded-full transition-all duration-300",
                  index === currentIndex
                    ? "w-6 h-2 bg-white"
                    : "w-2 h-2 bg-white/30 hover:bg-white/50"
                )}
                aria-label={`Аватар ${index + 1}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить аватар?</AlertDialogTitle>
            <AlertDialogDescription>
              {currentAvatar?.is_current
                ? "Вы удаляете текущий аватар. Предыдущий аватар станет активным."
                : "Это действие нельзя отменить. Аватар будет удален из истории."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-red-500 hover:bg-red-600"
              disabled={isDeleting}
            >
              {isDeleting ? "Удаление..." : "Удалить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
