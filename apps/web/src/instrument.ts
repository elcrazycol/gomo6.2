// Sentry must initialize BEFORE any other code runs, so this file is imported
// as the very first import in main.tsx. The SDK is a no-op when the DSN is
// missing (local dev without VITE_SENTRY_DSN), so it's safe to ship.
//
// Analytics consent: error + performance reporting is opt-in (see
// lib/cookieConsent). Until the visitor grants «Аналитика» we send nothing;
// granting it starts the SDK in the same session.
import * as Sentry from "@sentry/react";
import { useEffect } from "react";
import {
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
} from "react-router-dom";

import { analyticsAllowed, CONSENT_EVENT } from "@/lib/cookieConsent";

// Tracing: full fidelity in dev, 20% of sessions in prod (free tier budget).
const TRACES_SAMPLE_RATE = import.meta.env.PROD ? 0.2 : 1.0;

let started = false;

const startSentry = () => {
  if (started || !analyticsAllowed()) return;
  started = true;

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

    tracesSampleRate: TRACES_SAMPLE_RATE,
    // Attach trace headers to same-origin API calls (Caddy proxies /api to Go).
    tracePropagationTargets: ["localhost", /^\//],

    // Privacy: never ship cookies (incl. the readable CSRF cookie) to Sentry.
    // IP/user-agent still go for geo/debugging; disable via userInfo: false if
    // that's ever a concern.
    dataCollection: {
      cookies: false,
    },
  });
};

startSentry();
// Consent granted mid-session (the banner) turns analytics on without a reload.
window.addEventListener(CONSENT_EVENT, startSentry);
