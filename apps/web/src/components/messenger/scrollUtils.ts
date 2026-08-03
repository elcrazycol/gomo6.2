export function getMaxScrollTop(scrollHeight: number, clientHeight: number): number {
  return Math.max(0, scrollHeight - clientHeight);
}

export function isNearScrollBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold = 32,
): boolean {
  // Browsers can expose a negative scrollTop during rubber-band overscroll.
  // That is never the logical bottom, even when content is shorter than the
  // viewport.
  if (scrollTop < 0) return false;
  const maxScrollTop = getMaxScrollTop(scrollHeight, clientHeight);
  return maxScrollTop - Math.min(maxScrollTop, scrollTop) <= threshold;
}
