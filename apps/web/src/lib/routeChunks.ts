/**
 * The route → lazy-chunk table used for intent prefetch.
 *
 * It is the single source for "which chunk does this URL need". `App.tsx`
 * still declares its lazy imports explicitly (wrapped in `lazyWithRetry`), but
 * this table must stay in sync with them: hovering a link whose pathname is
 * missing here logs a dev-only `console.debug` (see `noteMissingChunk`), which
 * catches drift.
 */
import type { ComponentType } from "react";
import { matchPath } from "react-router-dom";

type RouteModule = { default: ComponentType<Record<string, unknown>> };

interface RouteChunk {
  /** react-router path pattern. More specific patterns come first. */
  match: string;
  load: () => Promise<RouteModule>;
}

// Order matters only where a static segment could be swallowed by a param at
// the same depth (e.g. `/g/create` before `/g/:slug`); `end: true` matching
// handles every other case.
export const ROUTE_CHUNKS: RouteChunk[] = [
  { match: "/", load: () => import("@/pages/Index") },
  { match: "/feed", load: () => import("@/pages/Index") },
  { match: "/mine", load: () => import("@/pages/Index") },
  { match: "/history", load: () => import("@/pages/Index") },
  { match: "/favorites", load: () => import("@/pages/Index") },
  { match: "/c/:sectionSlug", load: () => import("@/pages/Index") },
  { match: "/c/:sectionSlug/:subSlug", load: () => import("@/pages/Index") },
  { match: "/auth", load: () => import("@/pages/Auth") },
  { match: "/oauth/consent", load: () => import("@/pages/OAuthConsent") },
  { match: "/messages", load: () => import("@/pages/Messages") },
  { match: "/achievements/:userId", load: () => import("@/pages/Achievements") },
  { match: "/profile/:userId/wall/:postId", load: () => import("@/pages/WallPost") },
  { match: "/profile/:userId", load: () => import("@/pages/Profile") },
  { match: "/moderation", load: () => import("@/pages/ModerationDashboard") },
  { match: "/moderation/reports", load: () => import("@/pages/ModerationPosts") },
  { match: "/moderation/reports/:reportId", load: () => import("@/pages/ModerationReport") },
  { match: "/moderation/audit", load: () => import("@/pages/ModerationAudit") },
  { match: "/moderation/actions/:actionId", load: () => import("@/pages/ModerationAction") },
  { match: "/moderation/users/:userId", load: () => import("@/pages/ModerationUser") },
  { match: "/moderation/appeals", load: () => import("@/pages/ModerationAppeals") },
  { match: "/moderation/staff", load: () => import("@/pages/ModerationStaff") },
  { match: "/appeals", load: () => import("@/pages/Appeals") },
  { match: "/emojis", load: () => import("@/pages/EmojiPacks") },
  { match: "/emojis/pack/:slug", load: () => import("@/pages/EmojiPackDetail") },
  { match: "/emojis/create", load: () => import("@/pages/EmojiPackCreate") },
  { match: "/emojis/my", load: () => import("@/pages/EmojiMyPacks") },
  { match: "/emojis/edit/:id", load: () => import("@/pages/EmojiPackEdit") },
  { match: "/settings/prof-studio", load: () => import("@/pages/settings/ProfileStudio") },
  { match: "/settings/placeholders", load: () => import("@/pages/settings/Placeholders") },
  { match: "/settings/:section", load: () => import("@/pages/Settings") },
  { match: "/settings", load: () => import("@/pages/Settings") },
  { match: "/stats", load: () => import("@/pages/Stats") },
  { match: "/wallet", load: () => import("@/pages/Wallet") },
  { match: "/notify", load: () => import("@/pages/Notify") },
  { match: "/notify/wall-likes/:notificationId", load: () => import("@/pages/NotificationLikes") },
  { match: "/translate", load: () => import("@/pages/Translate") },
  { match: "/search", load: () => import("@/pages/SearchResults") },
  { match: "/legal", load: () => import("@/pages/Legal") },
  { match: "/legal/:docId", load: () => import("@/pages/Legal") },
  { match: "/gomosubs", load: () => import("@/pages/GomoSubs") },
  { match: "/g/create", load: () => import("@/pages/GomoSubCreate") },
  { match: "/g/:slug/create", load: () => import("@/pages/CreateGomoThread") },
  { match: "/g/:slug/c/:channelSlug/create", load: () => import("@/pages/CreateGomoThread") },
  { match: "/g/:slug/settings", load: () => import("@/pages/GomoSubSettings") },
  { match: "/g/:slug/join/:code", load: () => import("@/pages/GomoSubJoin") },
  { match: "/g/:slug/thread/:threadId", load: () => import("@/pages/Thread") },
  { match: "/g/:slug/c/:channelSlug/thread/:threadId", load: () => import("@/pages/Thread") },
  { match: "/g/:slug/c/:channelSlug", load: () => import("@/pages/Board") },
  { match: "/g/:slug", load: () => import("@/pages/Board") },
  { match: "/g", load: () => import("@/pages/GomoSubs") },
  { match: "/create", load: () => import("@/pages/CreateThread") },
  { match: "/thread/:threadId", load: () => import("@/pages/Thread") },
];

/** Import the chunk for `pathname` ahead of time. Never rejects. */
export function loadRouteChunk(pathname: string): Promise<void> {
  const chunk = ROUTE_CHUNKS.find((candidate) =>
    matchPath({ path: candidate.match, end: true }, pathname),
  );
  if (!chunk) {
    noteMissingChunk(pathname);
    return Promise.resolve();
  }
  return chunk.load().then(
    () => undefined,
    () => {
      // A failed prefetch is harmless — the real navigation will retry (and
      // App's lazyWithRetry handles a stale chunk after a deploy).
      return undefined;
    },
  );
}

// Dev-only: a link whose pathname matches no entry is a real bug (the route
// table drifted). Deduped so a repeated hover does not spam the console.
const warnedChunkPaths = new Set<string>();
function noteMissingChunk(pathname: string): void {
  if (!import.meta.env.DEV || import.meta.env.MODE === "test" || warnedChunkPaths.has(pathname)) return;
  warnedChunkPaths.add(pathname);
  console.debug(`[route-chunks] no lazy chunk registered for ${pathname}`);
}

/** Fire-and-forget chunk warm-up (link intent). */
export function prefetchRouteChunk(pathname: string): void {
  void loadRouteChunk(pathname);
}
