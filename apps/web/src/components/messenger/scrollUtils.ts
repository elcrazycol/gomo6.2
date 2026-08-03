export function estimatePrependedHeight<T extends { id: string }>(
  messages: readonly T[],
  boundaryMessageId: string,
  estimate: (message: T) => number,
): number {
  const boundaryIndex = messages.findIndex((message) => message.id === boundaryMessageId);
  if (boundaryIndex <= 0) return 0;

  return messages
    .slice(0, boundaryIndex)
    .reduce((total, message) => total + Math.max(0, estimate(message)), 0);
}
