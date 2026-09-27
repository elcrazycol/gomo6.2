import { apiClient } from "@/integrations/api/client";

/**
 * Fire-and-forget "the viewer opened this" beacon for the «История» page.
 *
 * Called from the thread and wall-post pages. Goes through `apiClient` so the
 * request carries the viewer's auth (and CSRF token); a failure must never
 * affect the page. The backend upserts on (user, item), so re-opening bumps the
 * item to the top.
 */
export type ViewHistoryItemType = "thread" | "wall_post";

export const recordContentView = (itemType: ViewHistoryItemType, itemId: string): void => {
  if (!itemId) return;
  apiClient
    .request("/api/v1/history", {
      method: "POST",
      body: JSON.stringify({ item_type: itemType, item_id: itemId }),
    })
    .catch(() => {
      // Best-effort — never surface history errors to the user.
    });
};
