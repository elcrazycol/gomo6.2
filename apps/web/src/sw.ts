/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { NetworkFirst, CacheFirst, StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare let self: ServiceWorkerGlobalScope;

// Precache the app shell (js/css/html). __WB_MANIFEST is injected by
// vite-plugin-pwa during the build.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA navigation fallback. The comment in the original generateSW config was
// load-bearing: serving index.html for /api/* and /oauth/* (which Caddy proxies
// to the Go backend) returns the SPA's own 404 page. Reproduced as a
// NavigationRoute denylist so those routes never fall back to the shell.
registerRoute(
  new NavigationRoute(async ({ request }) => {
    // Prefer the network; fall back to the precached index.html when offline
    // and the URL is not backend-routed.
    try {
      const response = await fetch(request);
      if (response && response.status === 200) {
        return response;
      }
    } catch {
      // offline — fall through to the cached shell
    }
    const cache = await caches.open("workbox-precache-v2");
    const cached = await cache.match("index.html");
    if (cached) return cached;
    return Response.error();
  }, {
    denylist: [/^\/api\//, /^\/oauth\//],
  })
);

// Messenger conversation list: NetworkFirst with a tiny single-entry cache
// (decrypted previews are privacy-sensitive, never persisted beyond 5 min).
registerRoute(
  /^https?:\/\/.*\/api\/v1\/messenger\/conversations$/,
  new NetworkFirst({
    cacheName: "messenger-conversations",
    networkTimeoutSeconds: 3,
    plugins: [
      {
        cacheWillUpdate: async ({ response }) =>
          response && response.status === 200 ? response : null,
      },
    ],
  })
);

// Public read-only API: boards, threads, posts, search, invites, translations
// and emoji data are the same for everyone, so they're safe to serve from
// cache on a slow connection while the network refreshes them in the
// background (stale-while-revalidate). Nothing user-specific or
// privacy-filtered is matched — auth, messenger, notifications, feed, wall,
// profiles, users, friends, likes and /api/rpc are all excluded. The cache is
// tiny (100 entries, 10 min) so it can't grow unbounded.
const PUBLIC_API_GET_PATTERN = /^\/api\/v1\/(boards|threads|posts|search|invites|translations|custom_emojis|emojis|emoji_packs)(\/|\?|$)/;

registerRoute(
  ({ url, request }) => request.method === "GET" && PUBLIC_API_GET_PATTERN.test(url.pathname),
  new StaleWhileRevalidate({
    cacheName: "public-api-v1",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 10 * 60,
      }),
      {
        cacheWillUpdate: async ({ response }) =>
          response && response.status === 200 ? response : null,
      },
    ],
  })
);

// Public storage buckets only (negative lookahead excludes the privacy-gated
// uploads/wall buckets). CacheFirst keeps public avatars/post-images fast.
registerRoute(
  /^https?:\/\/.*\/storage\/v1\/object\/(?!uploads\/|wall\/)/,
  new CacheFirst({
    cacheName: "storage-objects-v2",
    plugins: [
      {
        cacheWillUpdate: async ({ response }) =>
          response && response.status === 200 ? response : null,
      },
    ],
  })
);

// ── Push notifications ─────────────────────────────────────────────────────
// Payload comes from the backend (webpush) as JSON:
//   { title, body, icon?, badge?, url, data? }
const DEFAULT_ICON = "/pwa-192x192.png";

self.addEventListener("push", (event) => {
  let payload: {
    title?: string;
    body?: string;
    icon?: string;
    badge?: string;
    url?: string;
    data?: unknown;
  } = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // non-JSON payload — show a generic notification
  }

  const title = payload.title || "gomo6";
  const options: NotificationOptions = {
    body: payload.body || "",
    icon: payload.icon || DEFAULT_ICON,
    badge: payload.badge || DEFAULT_ICON,
    data: { url: payload.url || "/notify", notification: payload.data },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/notify";
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of allClients) {
        if ("focus" in client) {
          await client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
      return undefined;
    })()
  );
});
