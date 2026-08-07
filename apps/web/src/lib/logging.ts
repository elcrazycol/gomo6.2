/**
 * Client-side error logging.
 *
 * Sends JavaScript errors to the backend so we can investigate production
 * issues (stale chunks, failed dynamic imports, unhandled rejections, etc.).
 * Falls back to console if the network request fails.
 */

const LOG_ENDPOINT = '/api/v1/client-errors';

export interface ClientErrorReport {
  type: string;
  message: string;
  stack?: string;
  url?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

const MAX_MESSAGE_LENGTH = 4000;
const MAX_STACK_LENGTH = 16000;

// Rate-limit the backend report channel: an error storm (e.g. a rate-limited
// page flooding every endpoint) would otherwise POST /client-errors per error,
// each of which can itself fail — amplifying the very load we are reporting.
const MIN_REPORT_INTERVAL_MS = 5000;
const MAX_REPORTS_PER_SESSION = 200;
let lastReportAt = 0;
let reportCount = 0;

function truncate(value: string, max: number): string {
  if (!value) return value;
  return value.length > max ? value.slice(0, max) : value;
}

export function logClientError(
  error: unknown,
  type: string,
  metadata: Record<string, unknown> = {}
): void {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: string }).message)
      : String(error);

  const stack =
    typeof error === 'object' && error !== null && 'stack' in error
      ? String((error as { stack?: string }).stack)
      : undefined;

  const report: ClientErrorReport = {
    type,
    message: truncate(message, MAX_MESSAGE_LENGTH),
    stack: stack ? truncate(stack, MAX_STACK_LENGTH) : undefined,
    url: window.location.href,
    userAgent: navigator.userAgent,
    metadata: {
      ...metadata,
      referrer: document.referrer || undefined,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    },
  };

  // Always log to console so devtools can see it.
  console.error('[ClientError]', report.type, report.message, error);

  // Send to backend in the background; don't block or throw. Throttled so a
  // burst of identical failures reports once per window instead of spamming.
  const now = Date.now();
  if (now - lastReportAt < MIN_REPORT_INTERVAL_MS || reportCount >= MAX_REPORTS_PER_SESSION) {
    return;
  }
  lastReportAt = now;
  reportCount += 1;
  try {
    fetch(LOG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      // Errors should be fire-and-forget.
      keepalive: true,
    }).catch(() => {
      // Ignore network failures — the user is likely offline.
    });
  } catch {
    // Ignore sync errors (e.g., fetch unavailable).
  }
}

export function setupGlobalErrorHandlers(): () => void {
  const handleError = (event: ErrorEvent) => {
    logClientError(event.error, 'window.error', {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  };

  const handleRejection = (event: PromiseRejectionEvent) => {
    logClientError(event.reason, 'unhandledrejection');
  };

  window.addEventListener('error', handleError);
  window.addEventListener('unhandledrejection', handleRejection);

  return () => {
    window.removeEventListener('error', handleError);
    window.removeEventListener('unhandledrejection', handleRejection);
  };
}
