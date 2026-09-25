// "Justified" gallery layout (Flickr-style): media are packed into rows of
// equal height; within a row each item's width is proportional to its aspect
// ratio so the row exactly fills the container. Nothing is cropped — the box
// aspect matches the media aspect.
//
// Pure math, so it is testable and shared by the read view (JustifiedGallery)
// and the editor (the group NodeView sizes its children imperatively).

export interface JustifiedOptions {
  /** Preferred row height; the last (short) row keeps this. */
  targetRowHeight?: number;
  gap?: number;
}

export interface JustifiedSize {
  width: number;
  height: number;
}

/** Size every item so the items form justified rows in `containerWidth`. */
export const computeJustifiedSizes = (
  aspects: number[],
  containerWidth: number,
  options: JustifiedOptions = {},
): JustifiedSize[] => {
  const targetRowHeight = options.targetRowHeight ?? 220;
  const gap = options.gap ?? 4;
  const sizes: JustifiedSize[] = aspects.map(() => ({ width: 0, height: 0 }));
  if (containerWidth <= 0 || aspects.length === 0) return sizes;

  const normalized = aspects.map((aspect) => (Number.isFinite(aspect) && aspect > 0 ? aspect : 1));

  let rowStart = 0;
  let aspectSum = 0;
  const finalizeRow = (end: number, height: number, stretch: boolean) => {
    const count = end - rowStart;
    if (count <= 0) return;
    let assigned = 0;
    for (let i = rowStart; i < end; i += 1) {
      // In a full (stretched) row the last item absorbs the rounding remainder
      // so widths + gaps equal the container width; in the last short row every
      // item keeps its aspect-proportional width.
      const width =
        stretch && i === end - 1
          ? Math.max(1, Math.round(containerWidth - gap * (count - 1) - assigned))
          : Math.max(1, Math.round(normalized[i] * height));
      sizes[i] = { width, height: Math.round(height) };
      assigned += width;
    }
  };

  for (let i = 0; i < normalized.length; i += 1) {
    aspectSum += normalized[i];
    const count = i - rowStart + 1;
    const height = (containerWidth - gap * (count - 1)) / aspectSum;
    if (height <= targetRowHeight) {
      finalizeRow(i + 1, Math.max(40, height), true);
      rowStart = i + 1;
      aspectSum = 0;
    }
  }
  // Last row: keep the target height (not stretched) so it stays consistent.
  if (rowStart < normalized.length) {
    finalizeRow(normalized.length, targetRowHeight, false);
  }
  return sizes;
};
