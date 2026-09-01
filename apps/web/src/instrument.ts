// Sentry must initialize BEFORE any other code runs, so this file is imported
// as the very first import in main.tsx. The SDK is a no-op when the DSN is
// missing (local dev without VITE_SENTRY_DSN), so it's safe to ship.
import * as Sentry from "@sentry/react";
import { useEffect } from "react";
import {
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
} from "react-router-dom";

Sentry.init({
  // Public DSN — safe to ship to the browser. Set via VITE_SENTRY_DSN
  // (Docker build arg / .env.local for local dev).
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  release: import.meta.env.VITE_APP_VERSION || undefined,

  // Page load + SPA navigation + every XHR/fetch become spans — this is what
  // surfaces "too many requests" and slow API calls per page (waterfall view).
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.reactRouterV7BrowserTracingIntegration({
      useEffect,
      useLocation,
      useNavigationType,
      matchRoutes,
      createRoutesFromChildren,
    }),
  ],

  // Tracing: full fidelity in dev, 20% of sessions in prod (free tier budget).
  tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
  // Attach trace headers to same-origin API calls (Caddy proxies /api to Go).
  tracePropagationTargets: ["localhost", /^\//],

  // Privacy: never ship cookies (incl. the readable CSRF cookie) to Sentry.
  // IP/user-agent still go for geo/debugging; disable via userInfo: false if
  // that's ever a concern.
  dataCollection: {
    cookies: false,
  },
});
