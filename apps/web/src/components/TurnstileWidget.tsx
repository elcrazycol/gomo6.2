import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

// Public widget sitekey — safe to ship to the browser. Set via VITE_TURNSTILE_SITEKEY.
const SITEKEY = import.meta.env.VITE_TURNSTILE_SITEKEY as string | undefined;

/** True when Turnstile is configured (sitekey present). Forms use this to decide whether a token is required. */
export const isTurnstileEnabled = () => Boolean(SITEKEY);

let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Turnstile"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export interface TurnstileWidgetHandle {
  /** Re-renders a fresh challenge (single-use tokens must be reset after a failed submit). */
  reset: () => void;
}

interface TurnstileWidgetProps {
  /** Turnstile action — must match the backend's expected action for this surface. */
  action: string;
  /** Called with the fresh token on success, or null when expired/errored. */
  onToken: (token: string | null) => void;
  className?: string;
}

/**
 * Explicitly-rendered Cloudflare Turnstile widget.
 *
 * The page stays active after a failed submit, so callers keep a ref to this
 * component and invoke reset() after the request completes to allow a retry.
 * When the sitekey is not configured (e.g. tests), renders nothing.
 */
const TurnstileWidget = forwardRef<TurnstileWidgetHandle, TurnstileWidgetProps>(
  ({ action, onToken, className }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const onTokenRef = useRef(onToken);
    onTokenRef.current = onToken;

    useImperativeHandle(ref, () => ({
      reset: () => {
        if (widgetIdRef.current && window.turnstile) {
          try {
            window.turnstile.reset(widgetIdRef.current);
          } catch {
            // ignore — widget already gone
          }
        }
        onTokenRef.current(null);
      },
    }));

    useEffect(() => {
      if (!SITEKEY) return;
      let cancelled = false;

      loadTurnstileScript()
        .then(() => {
          if (cancelled || !containerRef.current || !window.turnstile) return;
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: SITEKEY,
            action,
            callback: (token: string) => onTokenRef.current(token),
            "expired-callback": () => onTokenRef.current(null),
            "error-callback": () => onTokenRef.current(null),
          });
        })
        .catch(() => {
          onTokenRef.current(null);
        });

      return () => {
        cancelled = true;
        if (widgetIdRef.current && window.turnstile) {
          try {
            window.turnstile.remove(widgetIdRef.current);
          } catch {
            // ignore
          }
        }
        widgetIdRef.current = null;
      };
    }, [action]);

    if (!SITEKEY) return null;
    return <div ref={containerRef} className={className} />;
  }
);

TurnstileWidget.displayName = "TurnstileWidget";
export default TurnstileWidget;
