// Read-view renderer for the "justified" gallery layout: rows of equal height,
// widths proportional to aspect, no cropping. Sizes are recomputed on resize.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { computeJustifiedSizes } from "./justifiedLayout";

const useElementWidth = () => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(element.clientWidth);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
};

interface JustifiedGalleryProps {
  aspects: number[];
  renderItem: (index: number) => ReactNode;
  gap?: number;
  targetRowHeight?: number;
}

export const JustifiedGallery = ({
  aspects,
  renderItem,
  gap = 4,
  targetRowHeight = 220,
}: JustifiedGalleryProps) => {
  const { ref, width } = useElementWidth();
  const sizes = useMemo(
    () => computeJustifiedSizes(aspects, width, { gap, targetRowHeight }),
    [aspects, width, gap, targetRowHeight],
  );

  return (
    <div ref={ref} data-media-group="true" className="media-group media-group--justified" style={{ gap }}>
      {aspects.map((_, index) => (
        <div
          key={index}
          className="justified-item"
          style={sizes[index]?.width ? { width: sizes[index].width, height: sizes[index].height } : undefined}
        >
          {renderItem(index)}
        </div>
      ))}
    </div>
  );
};
