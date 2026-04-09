import { useState, useEffect, useMemo } from "react";
import { X, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

export const AvatarGallery = ({
  avatars,
  initialIndex = 0,
  onClose,
  onDelete,
  canDelete = false
}: AvatarGalleryProps) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setCurrentIndex(initialIndex);
  }, [initialIndex]);

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
        setIsFullscreen(true);
      }
    };

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

  const handlePrevious = () => {
    setCurrentIndex((prev) => (prev === 0 ? avatars.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev === avatars.length - 1 ? 0 : prev + 1));
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const handleTouchEnd = () => {
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

  const handleDeleteClick = () => {
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = async () => {
    if (!onDelete || !canDelete) return;

    const currentAvatar = avatars[currentIndex];
    if (!currentAvatar) return;

    setIsDeleting(true);
    try {
      await onDelete(currentAvatar.id);

      // If this was the last avatar, close the gallery
      if (avatars.length === 1) {
        onClose();
      } else {
        // Move to previous avatar if we deleted the last one
        if (currentIndex >= avatars.length - 1) {
          setCurrentIndex(Math.max(0, currentIndex - 1));
        }
      }
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  if (avatars.length === 0) return null;

  const currentAvatar = avatars[currentIndex];
  const currentSrc = currentAvatar?.url;

  return (
    <>
      <div
        className={cn(
          "fixed z-50 bg-black flex items-center justify-center",
          isFullscreen ? "inset-0" : "inset-0 bg-black/80 backdrop-blur-md"
        )}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
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
              onClose();
            }}
          >
            <X className="h-6 w-6" />
          </Button>
        )}

        {/* Delete button - only for owner */}
        {showControls && canDelete && onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-16 z-10 text-red-500 hover:bg-red-500/20"
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteClick();
            }}
            disabled={isDeleting}
          >
            <Trash2 className="h-6 w-6" />
          </Button>
        )}

        {/* Previous button */}
        {avatars.length > 1 && showControls && (
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
          className={cn(
            "relative flex items-center justify-center",
            isFullscreen ? "w-full h-full" : "w-[92vw] h-[85vh] max-w-[1400px]"
          )}
          onClick={handleImageClick}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <img
            src={currentSrc}
            alt={`Avatar ${currentIndex + 1}`}
            className={cn(
              "object-contain",
              isFullscreen ? "w-full h-full" : "w-full h-full rounded-lg"
            )}
            draggable={false}
          />
        </div>

        {/* Next button */}
        {avatars.length > 1 && showControls && (
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
        {avatars.length > 1 && showControls && (
          <div
            className="absolute bottom-4 left-0 right-0 flex justify-center gap-2 px-4 overflow-x-auto pb-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex gap-2 max-w-full">
              {avatars.map((avatar, index) => (
                <button
                  key={avatar.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrentIndex(index);
                  }}
                  className={cn(
                    "flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-full border-2 overflow-hidden transition-all relative",
                    currentIndex === index
                      ? "border-white scale-110"
                      : "border-white/30 hover:border-white/60"
                  )}
                >
                  <img
                    src={avatar.url}
                    alt={`Thumbnail ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                  {avatar.is_current && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <span className="text-white text-xs font-bold">Текущий</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Image counter */}
        {avatars.length > 1 && showControls && (
          <div className="absolute top-4 left-4 z-10 text-white/80 text-sm bg-black/50 px-3 py-1 rounded">
            {currentIndex + 1} / {avatars.length}
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
