import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import type { Attachment } from "./types";
import { getAttachmentAspectRatio, parseImageMeta, rememberMeasuredAttachmentRatio as rememberMeasuredRatio, useAuthenticatedAttachmentUrl } from "./attachmentMedia";

type CarouselSlideProps = {
  attachment: Attachment;
  index: number;
  onOpen: (index: number) => void;
};

function CarouselSlide({ attachment, index, onOpen }: CarouselSlideProps) {
  const meta = useMemo(() => parseImageMeta(attachment), [attachment]);
  const previewKey = meta.preview_key || (attachment.type === "image" ? "" : attachment.url);
  const url = useAuthenticatedAttachmentUrl(attachment, previewKey, true);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setIsLoaded(false);
  }, [url]);

  const isVideo = attachment.type === "video";

  return (
    <div className="msg-media-slide">
      <button
        type="button"
        className={`msg-media-slide-open${isLoaded ? " is-loaded" : " is-loading"}`}
        onClick={() => onOpen(index)}
        aria-label={`Открыть ${attachment.name}`}
      >
        {meta.lqip && <img className="msg-attachment-lqip" src={meta.lqip} alt="" aria-hidden="true" />}
        {url && (
          <img
            className="msg-attachment-preview"
            src={url}
            alt={attachment.name}
            loading="lazy"
            decoding="async"
            onLoad={(event) => {
              setIsLoaded(true);
              if (isVideo) return;
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (naturalWidth > 0 && naturalHeight > 0 && !attachment.meta) {
                rememberMeasuredRatio(attachment, naturalWidth / naturalHeight);
              }
            }}
          />
        )}
        {!url && meta.lqip && <span className="msg-attachment-loading-shimmer" aria-hidden="true" />}
        {!url && !meta.lqip && <span className="msg-attachment-legacy-placeholder" aria-hidden="true">Открыть</span>}
        {isVideo && (
          <span className="msg-media-play-badge" aria-hidden="true">
            <Play size={26} />
          </span>
        )}
      </button>
    </div>
  );
}

type MessageMediaCarouselProps = {
  attachments: Attachment[];
  onOpen: (index: number) => void;
};

export function MessageMediaCarousel({ attachments, onOpen }: MessageMediaCarouselProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ containScroll: "trimSnaps" });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Isolate carousel gestures from the bubble's swipe-to-reply and long-press
  // (@use-gesture attaches NATIVE listeners to .bubble-row-inner). React's
  // synthetic stopPropagation fires at the app root — after the event already
  // bubbled through .bubble-row-inner. A native bubble-phase listener on this
  // root stops the event before it reaches the bubble, while embla (which
  // listens on the inner .msg-media-viewport) still receives it first.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const stop = (event: Event) => event.stopPropagation();
    root.addEventListener("pointerdown", stop);
    root.addEventListener("touchstart", stop);
    root.addEventListener("dblclick", stop);
    return () => {
      root.removeEventListener("pointerdown", stop);
      root.removeEventListener("touchstart", stop);
      root.removeEventListener("dblclick", stop);
    };
  }, []);

  // The frame keeps the proportions of the first photo, so the bubble height is
  // stable while the user flips through the slides (no scroll jumps).
  const frameRatio = useMemo(() => getAttachmentAspectRatio(attachments[0]), [attachments]);

  const updateButtons = useCallback(() => {
    if (!emblaApi) return;
    setCanPrev(emblaApi.canScrollPrev());
    setCanNext(emblaApi.canScrollNext());
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    updateButtons();
    emblaApi.on("select", updateButtons);
    emblaApi.on("reInit", updateButtons);
    return () => {
      emblaApi.off("select", updateButtons);
      emblaApi.off("reInit", updateButtons);
    };
  }, [emblaApi, updateButtons]);

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

  return (
    <div
      ref={rootRef}
      className="msg-media-carousel"
      style={{ "--media-frame-ratio": frameRatio } as React.CSSProperties}
    >
      <div className="msg-media-viewport" ref={emblaRef}>
        <div className="msg-media-track">
          {attachments.map((attachment, index) => (
            <CarouselSlide key={attachment.id || attachment.url + index} attachment={attachment} index={index} onOpen={onOpen} />
          ))}
        </div>
      </div>

      {attachments.length > 1 && (
        <>
          <span className="msg-media-counter" aria-hidden="true">
            {selectedIndex + 1} / {attachments.length}
          </span>
          <button
            type="button"
            className="msg-media-nav prev"
            onClick={scrollPrev}
            disabled={!canPrev}
            aria-label="Предыдущее фото"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            className="msg-media-nav next"
            onClick={scrollNext}
            disabled={!canNext}
            aria-label="Следующее фото"
          >
            <ChevronRight size={18} />
          </button>
        </>
      )}
    </div>
  );
}
