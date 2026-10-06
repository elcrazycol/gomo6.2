import { threadQueryOptions } from "@/hooks/queries";
import { registerRouteData, warmQuery } from "@/lib/routeData";

/**
 * Warm the thread row through the same TanStack entry `useThread` reads, so the
 * Thread page paints from cache the moment the router swaps to it.
 */
export const warmThread = (param: string) => warmQuery(threadQueryOptions(param));

export function registerThreadRouteData(): void {
  registerRouteData({
    id: "thread",
    match: [
      "/thread/:threadId",
      "/g/:slug/thread/:threadId",
      "/g/:slug/c/:channelSlug/thread/:threadId",
    ],
    warm: async ({ params }) => {
      const param = params.threadId;
      if (!param) return;
      await warmThread(param);
    },
  });
}
